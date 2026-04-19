// matrix.js — routing matrix tab render and crosspoint interactions

import * as st  from './state.js';
import * as api from './api.js';
import { toast } from './toast.js';
import { openPanel } from './panels.js';
import { DSP_COLOURS } from './dsp/colours.js';
import { confirmModal } from './modal.js';
import { undo } from './undo.js';

let _container = null;

// ── Corner cell module-level state ────────────────────────────────────────
let _locked   = false;
let _soloMode = null;   // null | 'pending' | {channelId, savedRoutes}
let _copyMode = null;   // null | 'pick-src' | {src}
const _clipMap = new Map(); // chId -> bool (currently clipping)
const _pendingCrosspoints = new Map(); // key (rx|tx) -> Date.now()
const _xpGain = new Map(); // key (rx|tx) -> gain_db (0.0 = unity)

// ── Warnings state ─────────────────────────────────────────────────────
let _showWarnings = localStorage.getItem('patchbox.matrix.showWarnings') !== 'false'; // default true
let _currentWarnings = []; // {id, severity, title, description, cellKeys}
const _warningIdCounter = { count: 0 };

function _genWarnId() {
  return 'warn_' + (++_warningIdCounter.count);
}

// ── Compute routing warnings ───────────────────────────────────────────────────
function _computeWarnings(channels, outputs, routes, buses, busMatrix, stereoLinks) {
  const warnings = [];
  const routesByRx = new Map(); // rx -> [routes]
  const routesByTx = new Map(); // tx -> [routes]
  const highFanOut = new Map(); // rx -> count of routed tx

  // Build lookup maps
  routes.forEach(r => {
    if (!routesByRx.has(r.rx_id)) routesByRx.set(r.rx_id, []);
    if (!routesByTx.has(r.tx_id)) routesByTx.set(r.tx_id, []);
    routesByRx.get(r.rx_id).push(r);
    routesByTx.get(r.tx_id).push(r);
  });

  // 1. Detect stereo mismatches
  const stereoByIdx = new Map();
  stereoLinks.forEach(sl => {
    if (sl.linked) {
      stereoByIdx.set(sl.left_channel, sl);
      stereoByIdx.set(sl.right_channel, sl);
    }
  });

  channels.forEach(ch => {
    const chIdx = parseInt(ch.id.replace('rx_', ''), 10);
    const stereo = stereoByIdx.get(chIdx);
    const isStereoLeft = stereo && stereo.left_channel === chIdx;
    const isStereoRight = stereo && stereo.right_channel === chIdx;

    if (stereo && isStereoLeft) {
      const leftRoutes = routesByRx.get(ch.id) || [];
      const rightChId = `rx_${stereo.right_channel}`;
      const rightRoutes = routesByRx.get(rightChId) || [];

      // Find all unique tx across both stereo channels
      const allTxIds = new Set([...leftRoutes.map(r => r.tx_id), ...rightRoutes.map(r => r.tx_id)]);

      allTxIds.forEach(txId => {
        const out = outputs.find(o => o.id === txId);
        if (!out) return;

        const leftHasRoute = leftRoutes.some(r => r.tx_id === txId);
        const rightHasRoute = rightRoutes.some(r => r.tx_id === txId);

        // Both channels to mono output = warning
        if (leftHasRoute && rightHasRoute) {
          const txIdx = parseInt(txId.replace('tx_', ''), 10);
          // Detect if output is mono (simple heuristic: name doesn't contain stereo keywords)
          const isMono = !out.name.toLowerCase().includes('stereo') &&
                         !out.name.toLowerCase().includes('pair') &&
                         !out.name.toLowerCase().includes('(l') &&
                         !out.name.toLowerCase().includes('(r');
          if (isMono) {
            warnings.push({
              id: _genWarnId(),
              severity: 'amber',
              title: '⚠ Stereo routed to mono',
              description: `Channels ${chIdx + 1} & ${stereo.right_channel + 1} (stereo pair) both routed to ${out.name} — will sum to mono.`,
              cellKeys: [`${ch.id}|${txId}`, `${rightChId}|${txId}`],
            });
          }
        }
      });
    }
  });

  // 2. Over-routed detection (single rx feeding many tx)
  const fanOutThreshold = 8;
  routesByRx.forEach((routes, rxId) => {
    const count = routes.length;
    if (count > fanOutThreshold) {
      warnings.push({
        id: _genWarnId(),
        severity: 'blue',
        title: '💡 High fan-out',
        description: `Channel ${rxId} is feeding ${count} destinations — monitor gain.`,
        cellKeys: routes.map(r => `${r.rx_id}|${r.tx_id}`),
      });
    }
  });

  // 3. Feedback loop detection (conservative: same local route, both directions)
  const localRoutesByPair = new Map(); // "rx_0|tx_1" -> bool
  routes.filter(r => r.route_type === 'local').forEach(r => {
    localRoutesByPair.set(`${r.rx_id}|${r.tx_id}`, true);
  });

  localRoutesByPair.forEach((_, key) => {
    const [rxId, txId] = key.split('|');
    const rxIdx = parseInt(rxId.replace('rx_', ''), 10);
    const txIdx = parseInt(txId.replace('tx_', ''), 10);

    // Check if output at txIdx is physically routed back to input at rxIdx (simplified)
    // Conservative: only flag if we detect a local loop pattern
    // In practice: if an output is also an input source (rare), and there's a route from that output back, flag it
    // For now, we skip this as we can't definitively detect device-level loops from API responses alone
  });

  // 4. Zone + Bus double-tap (same source feeding both bus and zone output)
  const rxToTxsViaBus = new Map(); // rx -> Set of tx
  buses.forEach(bus => {
    const busId = bus.id;
    channels.forEach((ch, chIdx) => {
      const isRouted = Array.isArray(bus.routing) && bus.routing[chIdx] === true;
      if (isRouted) {
        // This channel feeds this bus; now check where bus feeds
        const txsFromBus = busMatrix[busId] ? Object.keys(busMatrix[busId]).filter(txId => busMatrix[busId][txId]) : [];
        if (!rxToTxsViaBus.has(ch.id)) rxToTxsViaBus.set(ch.id, new Set());
        txsFromBus.forEach(txId => rxToTxsViaBus.get(ch.id).add(txId));
      }
    });
  });

  // Check for same source → bus output AND direct route
  routesByRx.forEach((directRoutes, rxId) => {
    const viabus = rxToTxsViaBus.get(rxId);
    if (viabus) {
      directRoutes.forEach(r => {
        if (viabus.has(r.tx_id)) {
          const out = outputs.find(o => o.id === r.tx_id);
          warnings.push({
            id: _genWarnId(),
            severity: 'info',
            title: '✓ Routed via bus + direct',
            description: `${rxId} feeds ${out?.name ?? r.tx_id} both via bus and direct route — may cause phase issues.`,
            cellKeys: [`${rxId}|${r.tx_id}`],
          });
        }
      });
    }
  });

  return warnings.sort((a, b) => {
    const severityOrder = { amber: 0, blue: 1, info: 2 };
    return (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99);
  });
}

// ── Build warning banner ───────────────────────────────────────────────────────
function _buildWarningBanner(warnings) {
  const banner = document.createElement('div');
  banner.className = 'matrix-warning-banner';
  if (!_showWarnings || warnings.length === 0) {
    banner.style.display = 'none';
  }

  const header = document.createElement('div');
  header.className = 'warning-banner-header';

  const title = document.createElement('span');
  title.className = 'warning-banner-title';
  title.textContent = `⚠ ${warnings.length} potential issue${warnings.length !== 1 ? 's' : ''}`;
  header.appendChild(title);

  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.className = 'warning-banner-toggle';
  toggle.checked = _showWarnings;
  toggle.title = 'Show/hide routing warnings';
  toggle.addEventListener('change', () => {
    _showWarnings = toggle.checked;
    localStorage.setItem('patchbox.matrix.showWarnings', _showWarnings ? 'true' : 'false');
    if (!_showWarnings) {
      banner.style.display = 'none';
    } else {
      banner.style.display = '';
    }
    // Clear any cell highlights
    document.querySelectorAll('.xp-cell.warning-highlight').forEach(c => c.classList.remove('warning-highlight'));
  });
  header.appendChild(toggle);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'warning-banner-close';
  closeBtn.textContent = '×';
  closeBtn.title = 'Dismiss';
  closeBtn.addEventListener('click', () => { banner.style.display = 'none'; });
  header.appendChild(closeBtn);

  banner.appendChild(header);

  const list = document.createElement('div');
  list.className = 'warning-list';
  warnings.forEach(w => {
    const item = document.createElement('div');
    item.className = `warning-item warning-${w.severity}`;
    item.textContent = w.title + ' — ' + w.description;
    item.style.cursor = 'pointer';
    item.addEventListener('click', () => {
      // Highlight cells for this warning
      document.querySelectorAll('.xp-cell.warning-highlight').forEach(c => c.classList.remove('warning-highlight'));
      w.cellKeys.forEach(key => {
        document.querySelectorAll(`.xp-cell[data-rx-id="${key.split('|')[0]}"][data-tx-id="${key.split('|')[1]}"]`).forEach(c => {
          c.classList.add('warning-highlight');
        });
      });
    });
    list.appendChild(item);
  });
  banner.appendChild(list);

  return banner;
}

// ── Public render entry point ──────────────────────────────────────────────
export function render(container) {
  _container = container;
  const wasActive = container.classList.contains('active');

  // Preserve scroll position across re-renders
  const vp = container.querySelector('.matrix-viewport');
  const prevScrollX = vp?.scrollLeft ?? 0;
  const prevScrollY = vp?.scrollTop  ?? 0;

  _container.innerHTML = '';
  _container.className = `tab-content${wasActive ? ' active' : ''}`;
  _container.id = 'tab-matrix';


  const channels = st.channelList();
  const outputs  = st.outputList();
  const zones    = st.zoneList();

  if (!channels.length && !outputs.length) {
    _container.innerHTML = '<div style="padding:24px;color:var(--text-muted);font-size:10px;">Loading…</div>';
    return;
  }

  // Build output→zone lookup
  const txZoneMap = new Map();
  zones.forEach(zone => {
    (zone.tx_ids ?? []).forEach(txId => txZoneMap.set(txId, zone));
  });

  const orderedOutputs = _orderOutputsByZone(outputs, zones);
  const buses = st.busList();

  // Single scroll container wraps everything
  const viewport = document.createElement('div');
  viewport.className = 'matrix-viewport';
  _applyStoredLabelW(viewport);

  const grid = document.createElement('div');
  grid.className = 'matrix-grid';
  // +1 for the bus-column divider (only when buses exist)
  const busDividerCols = buses.length > 0 ? 1 : 0;
  grid.style.setProperty('--num-cols', orderedOutputs.length + busDividerCols + buses.length);

  grid.appendChild(_buildHdrRow(orderedOutputs, txZoneMap, buses));
  channels.forEach((ch, i) => grid.appendChild(_buildRow(ch, i, orderedOutputs, txZoneMap, buses)));

  if (buses.length > 0) {
    const sep = document.createElement('div');
    sep.className = 'xp-row bus-separator-row';
    const sepLabel = document.createElement('div');
    sepLabel.className = 'ch-label bus-sep-label';
    sepLabel.textContent = 'BUSES';
    sep.appendChild(sepLabel);
    // spacers for output cols + bus-col divider + bus cols
    orderedOutputs.forEach(() => {
      const spacer = document.createElement('div');
      spacer.className = 'xp-cell bus-sep-cell';
      sep.appendChild(spacer);
    });
    // bus-column divider spacer
    const divSpacer = document.createElement('div');
    divSpacer.className = 'xp-cell bus-sep-cell bus-col-div-cell';
    sep.appendChild(divSpacer);
    buses.forEach(() => {
      const spacer = document.createElement('div');
      spacer.className = 'xp-cell bus-sep-cell';
      sep.appendChild(spacer);
    });
    grid.appendChild(sep);

    buses.forEach((bus, busIdx) => {
      grid.appendChild(_buildBusRow(bus, busIdx, orderedOutputs, buses));
    });
  }

  // Generator rows section
  const generators = st.generatorList ? st.generatorList() : (st.state.generators ?? []);
  if (generators.length > 0) {
    const genSep = document.createElement('div');
    genSep.className = 'xp-row gen-separator-row';
    const genSepLabel = document.createElement('div');
    genSepLabel.className = 'ch-label gen-sep-label';
    genSepLabel.textContent = 'GENERATORS';
    genSep.appendChild(genSepLabel);
    orderedOutputs.forEach(() => {
      const s = document.createElement('div');
      s.className = 'xp-cell gen-sep-cell';
      genSep.appendChild(s);
    });
    if (buses.length > 0) {
      const d = document.createElement('div');
      d.className = 'xp-cell gen-sep-cell bus-col-div-cell';
      genSep.appendChild(d);
      buses.forEach(() => {
        const s = document.createElement('div');
        s.className = 'xp-cell gen-sep-cell';
        genSep.appendChild(s);
      });
    }
    grid.appendChild(genSep);

    generators.forEach((gen, genIdx) => {
      grid.appendChild(_buildGenRow(gen, genIdx, orderedOutputs, buses));
    });
  }

  viewport.appendChild(grid);
  
  // Compute and display routing warnings
  const routes = st.routeList();
  const busMatrix = st.state.busMatrix ?? {};
  const stereoLinks = st.state.stereoLinks ?? [];
  _currentWarnings = _computeWarnings(channels, outputs, routes, buses, busMatrix, stereoLinks);
  const warningBanner = _buildWarningBanner(_currentWarnings);
  
  _container.appendChild(warningBanner);
  _container.appendChild(viewport);

  // C5: Show empty matrix hint when no routes exist (only after state has loaded — channels populated)
  const routeCount = (st.routeList?.() ?? []).length;
  const busRouteCount = Object.values(st.state.busMatrix ?? {}).reduce((n, m) => n + Object.values(m).filter(Boolean).length, 0)
    + st.busList().reduce((n, b) => n + (Array.isArray(b.routing) ? b.routing.filter(Boolean).length : 0), 0);
  const stateLoaded = st.state.channels.size > 0;
  if (routeCount === 0 && busRouteCount === 0 && stateLoaded) {
    const hint = document.createElement('div');
    hint.className = 'matrix-empty-hint';
    hint.innerHTML = `
      <div class="matrix-hint-box">
        <p>No routes yet.</p>
        <p style="font-size:11px;color:var(--text-muted);">Tap any crosspoint cell to connect an input to an output.</p>
        <button class="matrix-hint-dismiss">Got it</button>
      </div>
    `;
    hint.querySelector('.matrix-hint-dismiss').addEventListener('click', e => { e.stopPropagation(); hint.remove(); });
    viewport.appendChild(hint);
  }

  // Restore scroll position after paint
  if (prevScrollX || prevScrollY) {
    requestAnimationFrame(() => {
      viewport.scrollLeft = prevScrollX;
      viewport.scrollTop  = prevScrollY;
    });
  }

  const { rx, tx } = _currentMeterMaps();
  updateMetering(rx, tx);
}

// ── Column ordering ────────────────────────────────────────────────────────
function _orderOutputsByZone(outputs, zones) {
  const ordered = [];
  const seen = new Set();
  zones.forEach(zone => {
    (zone.tx_ids ?? []).forEach(txId => {
      const o = outputs.find(x => x.id === txId);
      if (o && !seen.has(o.id)) { ordered.push(o); seen.add(o.id); }
    });
  });
  outputs.forEach(o => { if (!seen.has(o.id)) ordered.push(o); });
  return ordered;
}

// ── Header row: corner + output column headers ────────────────────────────
function _buildHdrRow(outputs, txZoneMap, buses) {
  const row = document.createElement('div');
  row.className = 'matrix-hdr-row';

  // Corner cell (sticky top + left)
  const corner = document.createElement('div');
  corner.className = 'corner-cell';

  const inputs = st.channelList();

  // Inner content column — resize handle stays outside at right edge
  const inner = document.createElement('div');
  inner.className = 'corner-inner';

  // ── Dims ──────────────────────────────────────────────────────────────
  const dimsEl = document.createElement('span');
  dimsEl.className = 'corner-dims';
  dimsEl.textContent = `${inputs.length} IN × ${outputs.length} OUT`;
  inner.appendChild(dimsEl);

  // ── Filter input ──────────────────────────────────────────────────────
  const filterRow = document.createElement('div');
  filterRow.className = 'corner-filter-row';
  const filterInput = document.createElement('input');
  filterInput.type = 'text';
  filterInput.className = 'corner-filter-input';
  filterInput.placeholder = 'filter channels…';
  filterInput.addEventListener('input', () => {
    const q = filterInput.value.toLowerCase();
    const grid = corner.closest('.matrix-grid');
    if (!grid) return;
    grid.querySelectorAll('.xp-row').forEach(xpRow => {
      const lbl  = xpRow.querySelector('.ch-label');
      const name = (lbl?.querySelector('.ch-name')?.textContent ?? '').toLowerCase();
      const id   = (lbl?.dataset.chId ?? '').toLowerCase();
      xpRow.style.display = (!q || name.includes(q) || id.includes(q)) ? '' : 'none';
    });
  });
  filterRow.appendChild(filterInput);
  inner.appendChild(filterRow);

  // ── Action buttons ─────────────────────────────────────────────────────
  const actionsRow = document.createElement('div');
  actionsRow.className = 'corner-actions-row';

  // Clear all routes
  const btnClear = document.createElement('button');
  btnClear.className = 'corner-btn';
  btnClear.textContent = '✕ clear';
  btnClear.title = 'Clear all routes';
  btnClear.addEventListener('click', () => {
    const activeCount = st.routeList().length;
    confirmModal({
      title: 'Clear all routes?',
      body: `Removes all ${activeCount} active route${activeCount !== 1 ? 's' : ''}. Cannot be undone.`,
      confirmLabel: 'Clear routes',
      danger: true,
      onConfirm: async () => {
        const routes = st.routeList().slice();
        for (const r of routes) {
          try { await api.deleteRoute(`${r.rx_id}|${r.tx_id}`); st.removeRoute(r.rx_id, r.tx_id); } catch (_) {}
        }
        render(_container);
      },
    });
  });
  actionsRow.appendChild(btnClear);

  // 1:1 patch
  const btn1to1 = document.createElement('button');
  btn1to1.className = 'corner-btn';
  btn1to1.textContent = '1:1';
  btn1to1.title = 'Auto-patch inputs to outputs 1-to-1';
  btn1to1.addEventListener('click', async () => {
    const chs  = st.channelList();
    const outs = _orderOutputsByZone(st.outputList(), st.zoneList());
    for (let i = 0; i < Math.min(chs.length, outs.length); i++) {
      const rxId = chs[i].id;
      const txId = outs[i].id;
      if (!st.getRouteType(rxId, txId)) {
        try {
          const route = await api.postRoute(rxId, txId, 'local');
          st.setRoute({ route_type: 'local', ...route });
        } catch (_) {}
      }
    }
    render(_container);
  });
  actionsRow.appendChild(btn1to1);

  // Snapshot
  const btnSnap = document.createElement('button');
  btnSnap.className = 'corner-btn';
  btnSnap.textContent = '📷 snap';
  btnSnap.title = 'Save route snapshot';
  btnSnap.addEventListener('click', async () => {
    try {
      await api.postScene('snap-' + Date.now());
      toast('Snapshot saved');
    } catch (e) { toast('Snapshot failed: ' + e.message, true); }
  });
  actionsRow.appendChild(btnSnap);

  // Solo toggle
  const isSoloed   = typeof _soloMode === 'object' && _soloMode !== null;
  const isSoloPend = _soloMode === 'pending';
  const btnSolo = document.createElement('button');
  btnSolo.className = 'corner-btn corner-btn-solo' +
    (isSoloed || isSoloPend ? ' active' : '') +
    (isSoloPend ? ' pending' : '');
  btnSolo.textContent = isSoloed ? 'un-solo' : 'solo';
  btnSolo.title = isSoloed ? 'Restore all routes' :
    isSoloPend ? 'Pick a channel (or click to cancel)' : 'Solo a channel';
  btnSolo.addEventListener('click', async () => {
    if (typeof _soloMode === 'object' && _soloMode !== null) {
      await _restoreSolo();
    } else if (_soloMode === 'pending') {
      _soloMode = null; _refreshCornerButtons();
    } else {
      _soloMode = 'pending'; _refreshCornerButtons();
    }
  });
  actionsRow.appendChild(btnSolo);

  // Copy channel
  const isCopyActive  = !!_copyMode;
  const isCopyPickSrc = _copyMode === 'pick-src';
  const isCopyHasSrc  = typeof _copyMode === 'object' && _copyMode !== null;
  const btnCopy = document.createElement('button');
  btnCopy.className = 'corner-btn corner-btn-copy' +
    (isCopyActive ? ' active' : '') +
    (isCopyActive ? ' pending' : '');
  btnCopy.textContent = 'copy';
  btnCopy.title = isCopyPickSrc  ? 'Pick source channel (click to cancel)' :
    isCopyHasSrc  ? `Copy from "${_copyMode.src}" — pick destination` :
    'Copy channel routes to another channel';
  btnCopy.addEventListener('click', () => {
    if (_copyMode) { _copyMode = null; _refreshCornerButtons(); }
    else           { _copyMode = 'pick-src'; _refreshCornerButtons(); }
  });
  actionsRow.appendChild(btnCopy);

  inner.appendChild(actionsRow);

  // ── Status + lock row ──────────────────────────────────────────────────
  const statusRow = document.createElement('div');
  statusRow.className = 'corner-status-row';

  const routes      = st.routeList();
  const routedChIds = new Set(routes.map(r => r.rx_id));
  const unroutedN   = inputs.filter(ch => !routedChIds.has(ch.id)).length;
  const clipN       = Array.from(_clipMap.values()).filter(Boolean).length;
  const danteN      = routes.filter(r => r.route_type === 'dante').length;

  const statUnrouted = document.createElement('span');
  statUnrouted.className = 'corner-stat corner-stat-unrouted' + (unroutedN > 0 ? ' danger' : '');
  statUnrouted.textContent = `○ ${unroutedN} unrouted`;
  statUnrouted.title = 'Click to highlight / scroll to unrouted rows';
  statUnrouted.style.cursor = 'pointer';
  statUnrouted.addEventListener('click', () => {
    const grid = _container?.querySelector('.matrix-grid');
    if (!grid) return;
    const curRoutes = st.routeList();
    const routedIds = new Set(curRoutes.map(r => r.rx_id));
    const anyHigh   = !!grid.querySelector('.xp-row.unrouted-highlight');
    grid.querySelectorAll('.xp-row').forEach(xpRow => {
      xpRow.classList.toggle('unrouted-highlight', !anyHigh && !routedIds.has(xpRow.dataset.rxId));
    });
    if (!anyHigh) {
      grid.querySelector('.xp-row.unrouted-highlight')
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
  statusRow.appendChild(statUnrouted);

  const statClip = document.createElement('span');
  statClip.className = 'corner-stat corner-stat-clip' + (clipN > 0 ? ' danger' : '');
  statClip.textContent = `▲ ${clipN} clip`;
  statClip.title = 'Channels clipping (> −3 dB)';
  statusRow.appendChild(statClip);

  const statDante = document.createElement('span');
  statDante.className = 'corner-stat corner-stat-dante';
  statDante.textContent = `⊕ ${danteN} dante`;
  statDante.title = 'Active Dante routes';
  statusRow.appendChild(statDante);

  // Lock toggle
  const btnLock = document.createElement('button');
  btnLock.className = 'corner-btn corner-lock-btn' + (_locked ? ' active' : '');
  btnLock.textContent = _locked ? '🔒' : '🔓';
  btnLock.title = _locked ? 'Routes locked — click to unlock' : 'Click to lock routes';
  btnLock.addEventListener('click', () => { _locked = !_locked; _refreshCornerButtons(); });
  statusRow.appendChild(btnLock);

  inner.appendChild(statusRow);

  // ── Legend ────────────────────────────────────────────────────────────
  const legendEl = document.createElement('div');
  legendEl.className = 'corner-legend';
  legendEl.innerHTML = `
    <span class="corner-legend-item"><span class="corner-legend-dot corner-dot-local"></span>local</span>
    <span class="corner-legend-item"><span class="corner-legend-dot corner-dot-dante"></span>dante</span>
    <span class="corner-legend-item"><span class="corner-legend-dot corner-dot-bus"></span>bus</span>`;
  inner.appendChild(legendEl);

  corner.appendChild(inner);

  // Resize handle — must remain last direct child of corner-cell (row layout)
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'ch-label-resize';
  corner.appendChild(resizeHandle);
  _initLabelResize(resizeHandle);
  row.appendChild(corner);

  let prevZoneId = null;
  outputs.forEach((out, i) => {
    const zone = txZoneMap.get(out.id);
    const isZoneStart = zone && zone.id !== prevZoneId;
    prevZoneId = zone?.id ?? null;

    const col = document.createElement('div');
    col.className = 'out-hdr' + (isZoneStart ? ' zone-start' : '');
    col.dataset.outId = out.id;
    col.dataset.txId  = out.id;
    if (isZoneStart && zone) {
      col.style.setProperty('--zone-color', st.getZoneColour(zone.colour_index ?? 0));
    }

    const numEl = document.createElement('span');
    numEl.className = 'out-num';
    numEl.textContent = i + 1;
    col.appendChild(numEl);

    const label = out.name ?? out.id;
    const nameWrap = document.createElement('div');
    nameWrap.className = 'out-name-wrap';
    const nameEl = document.createElement('span');
    nameEl.className = 'out-name';
    nameEl.title = 'Double-click to rename';
    nameEl.textContent = label;
    nameEl.addEventListener('dblclick', e => { e.stopPropagation(); _startOutputRename(nameEl, nameWrap, out); });
    nameWrap.appendChild(nameEl);
    col.appendChild(nameWrap);

    // Output DSP badges
    const outObj = st.state.outputs.get(out.id);
    const outDsp = outObj?.dsp ?? {};
    Object.keys(outDsp).forEach(blk => {
      const block = outDsp[blk];
      const colour = DSP_COLOURS[blk] ?? { bg: '#333', fg: '#fff', label: blk.toUpperCase() };
      const badgeState = _getDspBadgeState(block);
      const badge = document.createElement('button');
      badge.className = 'ch-dsp-badge out-dsp-badge' + (badgeState.isByp ? ' byp' : '');
      badge.dataset.block = blk;
      badge.dataset.ch = out.id;
      badge.textContent = colour.label ?? blk.toUpperCase();
      badge.title = blk + badgeState.titleSuffix;
      badge.style.background = colour.bg;
      badge.style.color = colour.fg;
      badge.onclick = (e) => { e.stopPropagation(); openPanel(blk, out.id, badge); };
      col.appendChild(badge);
    });

    row.appendChild(col);
  });  // end outputs.forEach

  // Bus column headers (input→bus routing)
  if (buses && buses.length > 0) {
    // Vertical divider column
    const divHdr = document.createElement('div');
    divHdr.className = 'out-hdr bus-col-div-hdr';
    row.appendChild(divHdr);

    buses.forEach((bus, bi) => {
      const col = document.createElement('div');
      col.className = 'out-hdr bus-col-hdr';
      col.dataset.busId = bus.id;
      col.style.borderLeft = '2px solid var(--vu-amber)';

      const numEl = document.createElement('span');
      numEl.className = 'out-num';
      numEl.textContent = 'B' + (bi + 1);
      col.appendChild(numEl);

      const nameWrap = document.createElement('div');
      nameWrap.className = 'out-name-wrap';
      const nameEl = document.createElement('span');
      nameEl.className = 'out-name';
      nameEl.textContent = bus.name ?? bus.id;
      nameWrap.appendChild(nameEl);
      col.appendChild(nameWrap);

      row.appendChild(col);
    });
  }

  return row;
}

// ── Channel row: sticky label + crosspoint cells ───────────────────────────
function _buildRow(ch, idx, outputs, txZoneMap, buses) {
  const row = document.createElement('div');
  row.className = 'xp-row';
  row.dataset.rxId = ch.id;

  // Channel label — sticky left
  const label = document.createElement('div');
  label.className = 'ch-label';
  label.dataset.chId = ch.id;

  // Apply colour accent if set
  if (ch.colour_index != null) {
    const colour = `var(--zone-color-${ch.colour_index % 10})`;
    label.style.setProperty('--ch-accent', colour);
  }

  const num = document.createElement('span');
  num.className = 'ch-num';
  num.textContent = idx + 1;
  label.appendChild(num);

  const name = document.createElement('span');
  name.className = 'ch-name';
  name.title = 'Double-click to rename';
  name.textContent = ch.name ?? ch.id;
  name.addEventListener('dblclick', e => { e.stopPropagation(); _startRename(name, ch); });
  label.appendChild(name);

  // Stereo link tag — rendered BEFORE DSP badges so it appears to the left
  const chIdx = parseInt(ch.id.replace('rx_', ''), 10);
  const stereoLink = st.getStereoLink(chIdx);
  if (stereoLink && stereoLink.linked) {
    const isLeft = stereoLink.left_channel === chIdx;
    const stereoTag = document.createElement('span');
    stereoTag.className = 'ch-stereo-tag';
    stereoTag.textContent = isLeft ? 'L' : 'R';
    stereoTag.title = isLeft
      ? `Stereo L — linked with ch ${stereoLink.right_channel + 1}`
      : `Stereo R — linked with ch ${stereoLink.left_channel + 1}`;
    label.appendChild(stereoTag);
    row.classList.add(isLeft ? 'stereo-left' : 'stereo-right');
  }

  // DSP badges inline to the right of stereo tag
  const dsp = ch.dsp ?? {};
  Object.keys(dsp).forEach(blk => {
    const block = dsp[blk];

    const colour = DSP_COLOURS[blk] ?? { bg: '#333', fg: '#fff', label: blk.toUpperCase() };
    const badgeState = _getDspBadgeState(block);
    const badge = document.createElement('button');
    badge.className = 'ch-dsp-badge' + (badgeState.isByp ? ' byp' : '');
    badge.dataset.block = blk;
    badge.dataset.ch = ch.id;
    badge.textContent = colour.label ?? blk.toUpperCase();
    badge.title = blk + badgeState.titleSuffix;
    badge.style.background = colour.bg;
    badge.style.color = colour.fg;
    badge.onclick = (e) => { e.stopPropagation(); openPanel(blk, ch.id, badge); };
    label.appendChild(badge);
  });

  // Right-edge resize affordance on every label cell
  label.addEventListener('pointerdown', e => {
    const r = label.getBoundingClientRect();
    if (e.clientX >= r.right - 8) {
      e.preventDefault();
      const viewport = label.closest('.matrix-viewport');
      if (!viewport) return;
      const startX = e.clientX;
      const startW = parseInt(getComputedStyle(viewport).getPropertyValue('--label-w').trim(), 10) || 380;
      label.setPointerCapture(e.pointerId);
      label.classList.add('resizing');
      const onMove = mv => {
        const newW = Math.max(120, startW + (mv.clientX - startX));
        viewport.style.setProperty('--label-w', newW + 'px');
      };
      const onUp = () => {
        label.classList.remove('resizing');
        label.removeEventListener('pointermove', onMove);
        label.removeEventListener('pointerup', onUp);
      };
      label.addEventListener('pointermove', onMove);
      label.addEventListener('pointerup', onUp);
    }
  });
  label.addEventListener('pointermove', e => {
    const r = label.getBoundingClientRect();
    label.style.cursor = e.clientX >= r.right - 8 ? 'col-resize' : '';
  });
  label.addEventListener('pointerleave', () => { label.style.cursor = ''; });

  // Solo / copy pick handler
  label.addEventListener('click', e => {
    const r = label.getBoundingClientRect();
    if (e.clientX >= r.right - 8) return; // ignore resize zone
    if (_soloMode === 'pending') {
      e.stopPropagation();
      _execSolo(ch.id);
    } else if (_copyMode === 'pick-src') {
      e.stopPropagation();
      _copyMode = { src: ch.id };
      _refreshCornerButtons();
    } else if (typeof _copyMode === 'object' && _copyMode !== null) {
      e.stopPropagation();
      _execCopy(_copyMode.src, ch.id);
    }
  });

  row.appendChild(label);

  // Crosspoint cells
  let prevZoneId = null;
  outputs.forEach((out, outIdx) => {
    const zone = txZoneMap.get(out.id);
    const isZoneStart = zone && zone.id !== prevZoneId;
    prevZoneId = zone?.id ?? null;

    const txIdx = parseInt(out.id.split('_')[1], 10);
    const rxIdx = parseInt(ch.id.split('_')[1], 10);

    const routeType = st.getRouteType(ch.id, out.id);
    const cell = document.createElement('div');
    cell.className = 'xp-cell' + (routeType ? ' ' + routeType : '');
    cell.dataset.rxId = ch.id;
    cell.dataset.txId = out.id;
    
    // ARIA label for crosspoint
    const cellLabel = `${ch.name || `Input ${rxIdx + 1}`} to ${out.name || `Output ${txIdx + 1}`}`;
    cell.setAttribute('role', 'button');
    cell.setAttribute('aria-label', cellLabel);
    cell.setAttribute('aria-pressed', routeType ? 'true' : 'false');
    cell.tabIndex = 0;
    
    if (isZoneStart && zone) {
      cell.style.borderLeft = `2px solid ${st.getZoneColour(zone.colour_index ?? 0)}`;
    }

    const dot = document.createElement('div');
    dot.className = 'xp-dot';
    cell.appendChild(dot);

    // Gain label — shown only when gain != 0
    const gainLabel = document.createElement('span');
    gainLabel.className = 'xp-gain-label';
    const gainDb = st.getMatrixGain(txIdx, rxIdx);
    gainLabel.textContent = gainDb !== 0 ? (gainDb > 0 ? `+${gainDb.toFixed(1)}` : gainDb.toFixed(1)) : '';
    gainLabel.style.display = gainDb !== 0 ? '' : 'none';
    gainLabel.setAttribute('aria-hidden', 'true');
    if (gainDb !== 0) cell.classList.add('xp-gain-nonunity');
    cell.appendChild(gainLabel);

    cell.addEventListener('click', () => _toggleRoute(ch.id, out.id, cell));
    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        _toggleRoute(ch.id, out.id, cell);
      }
    });
    cell.addEventListener('wheel', (e) => _onXpWheel(e, ch.id, out.id, txIdx, rxIdx, cell, gainLabel), { passive: false });
    row.appendChild(cell);
  });

  // Bus crosspoint columns (input→bus routing)
  if (buses && buses.length > 0) {
    // Vertical divider cell
    const divCell = document.createElement('div');
    divCell.className = 'xp-cell bus-col-div-cell';
    row.appendChild(divCell);

    buses.forEach(bus => {
      const active = Array.isArray(bus.routing) && bus.routing[chIdx] === true;
      const cell = document.createElement('div');
      cell.className = 'xp-cell bus-src' + (active ? ' active' : '');
      cell.dataset.rxId = ch.id;
      cell.dataset.busId = bus.id;

      const cellLabel = `${ch.name || `Input ${chIdx + 1}`} to ${bus.name || bus.id}`;
      cell.setAttribute('role', 'button');
      cell.setAttribute('aria-label', cellLabel);
      cell.setAttribute('aria-pressed', active ? 'true' : 'false');
      cell.tabIndex = 0;

      const dot = document.createElement('div');
      dot.className = 'xp-dot';
      cell.appendChild(dot);

      // Gain label for bus crosspoints
      const busGainLabel = document.createElement('span');
      busGainLabel.className = 'xp-gain-label';
      const busGainDb = bus.routing_gain?.[chIdx] ?? 0;
      busGainLabel.textContent = busGainDb !== 0 ? (busGainDb > 0 ? `+${busGainDb.toFixed(1)}` : busGainDb.toFixed(1)) : '';
      busGainLabel.style.display = busGainDb !== 0 ? '' : 'none';
      busGainLabel.setAttribute('aria-hidden', 'true');
      if (busGainDb !== 0) cell.classList.add('xp-gain-nonunity');
      cell.appendChild(busGainLabel);

      cell.addEventListener('click', () => _toggleInputToBus(bus, chIdx, cell));
      cell.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          _toggleInputToBus(bus, chIdx, cell);
        }
      });
      cell.addEventListener('wheel', (e) => _onBusXpWheel(e, bus, chIdx, cell, busGainLabel), { passive: false });
      row.appendChild(cell);
    });
  }

  return row;
}

// ── Bus row builder ────────────────────────────────────────────────────────
function _buildBusRow(bus, busIdx, outputs, buses) {
  const row = document.createElement('div');
  row.className = 'xp-row bus-row';
  row.dataset.busId = bus.id;

  const label = document.createElement('div');
  label.className = 'ch-label bus-label';
  label.dataset.busId = bus.id;

  const num = document.createElement('span');
  num.className = 'ch-num';
  num.textContent = 'B' + (busIdx + 1);
  label.appendChild(num);

  const name = document.createElement('span');
  name.className = 'ch-name';
  name.title = 'Double-click to rename';
  name.textContent = bus.name ?? bus.id;
  name.addEventListener('dblclick', e => { e.stopPropagation(); _startBusRename(name, bus); });
  label.appendChild(name);

  const dsp = bus.dsp ?? {};
  Object.keys(dsp).forEach(blk => {
    const block = dsp[blk];

    const colour = DSP_COLOURS[blk] ?? { bg: '#333', fg: '#fff', label: blk.toUpperCase() };
    const badgeState = _getDspBadgeState(block);
    const badge = document.createElement('button');
    badge.className = 'ch-dsp-badge' + (badgeState.isByp ? ' byp' : '');
    badge.dataset.block = blk;
    badge.dataset.busId = bus.id;
    badge.textContent = colour.label ?? blk.toUpperCase();
    badge.title = blk + badgeState.titleSuffix;
    badge.style.background = colour.bg;
    badge.style.color = colour.fg;
    badge.onclick = (e) => { e.stopPropagation(); openPanel(blk, bus.id, badge); };
    label.appendChild(badge);
  });

  row.appendChild(label);

  let prevZoneId = null;
  outputs.forEach(out => {
    const routeActive = st.hasBusRoute(bus.id, out.id);
    const cell = document.createElement('div');
    cell.className = 'xp-cell' + (routeActive ? ' bus' : '');
    cell.dataset.busId = bus.id;
    cell.dataset.txId = out.id;
    
    // ARIA label for bus→output routing
    const outIdx = parseInt(out.id.split('_')[1], 10);
    const cellLabel = `${bus.name || bus.id} to ${out.name || `Output ${outIdx + 1}`}`;
    cell.setAttribute('role', 'button');
    cell.setAttribute('aria-label', cellLabel);
    cell.setAttribute('aria-pressed', routeActive ? 'true' : 'false');
    cell.tabIndex = 0;

    const dot = document.createElement('div');
    dot.className = 'xp-dot';
    cell.appendChild(dot);

    cell.addEventListener('click', () => _toggleBusRoute(bus.id, out.id, cell));
    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        _toggleBusRoute(bus.id, out.id, cell);
      }
    });
    row.appendChild(cell);
  });

  // Bus-to-bus crosspoint columns (this bus as destination, other buses as sources)
  if (buses && buses.length > 0) {
    const divSpacer = document.createElement('div');
    divSpacer.className = 'xp-cell bus-col-div-cell';
    row.appendChild(divSpacer);

    buses.forEach((srcBus, srcIdx) => {
      const cell = document.createElement('div');
      if (srcBus.id === bus.id) {
        // Self — always disabled
        cell.className = 'xp-cell bus-feed-self';
        cell.setAttribute('aria-label', `${bus.name || bus.id} to self (disabled)`);
        row.appendChild(cell);
        return;
      }
      const active = st.hasBusFeed(srcBus.id, bus.id);
      cell.className = 'xp-cell bus-feed' + (active ? ' active' : '');
      cell.dataset.srcBusId = srcBus.id;
      cell.dataset.dstBusId = bus.id;
      
      // ARIA label for bus feed
      const cellLabel = `${srcBus.name || srcBus.id} to ${bus.name || bus.id}`;
      cell.setAttribute('role', 'button');
      cell.setAttribute('aria-label', cellLabel);
      cell.setAttribute('aria-pressed', active ? 'true' : 'false');
      cell.tabIndex = 0;
      
      const dot = document.createElement('div');
      dot.className = 'xp-dot';
      cell.appendChild(dot);
      cell.addEventListener('click', () => _toggleBusFeed(srcBus.id, bus.id, cell));
      cell.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          _toggleBusFeed(srcBus.id, bus.id, cell);
        }
      });
      row.appendChild(cell);
    });
  }

  return row;
}

// ── Bus route toggle ───────────────────────────────────────────────────────
async function _toggleBusRoute(busId, txId, cell) {
  if (_locked) return;

  const key = `${busId}|${txId}`;
  if (_pendingCrosspoints.has(key)) return;

  _pendingCrosspoints.set(key, Date.now());
  cell.classList.add('pending');
  cell.style.pointerEvents = 'none';

  const routeActive = st.hasBusRoute(busId, txId);
  const prevClass = cell.className;

  const setBusMatrixCell = (on) => {
    const row = { ...(st.state.busMatrix?.[txId] ?? {}) };
    row[busId] = on;
    st.setBusMatrix({ ...(st.state.busMatrix ?? {}), [txId]: row });
  };

  try {
    if (routeActive) {
      cell.className = 'xp-cell pending';
      await api.deleteRoute(`${busId}|${txId}`);
      setBusMatrixCell(false);
    } else {
      cell.className = 'xp-cell bus pending';
      await api.postRoute(busId, txId, 'bus');
      setBusMatrixCell(true);
    }

    const busName = st.state.buses.get(busId)?.name ?? busId;
    const outName = st.state.outputs.get(txId)?.name ?? txId;

    undo.push({
      label: `${routeActive ? 'Unroute' : 'Route'} bus: ${busName} → ${outName}`,
      apply: async () => {
        if (routeActive) {
          await api.deleteRoute(`${busId}|${txId}`);
          setBusMatrixCell(false);
        } else {
          await api.postRoute(busId, txId, 'bus');
          setBusMatrixCell(true);
        }
      },
      revert: async () => {
        if (routeActive) {
          await api.postRoute(busId, txId, 'bus');
          setBusMatrixCell(true);
        } else {
          await api.deleteRoute(`${busId}|${txId}`);
          setBusMatrixCell(false);
        }
      },
    });

  } catch (e) {
    cell.className = prevClass;
    toast('Bus route error: ' + e.message, true);
  } finally {
    _pendingCrosspoints.delete(key);
    cell.classList.remove('pending');
    cell.style.pointerEvents = '';
  }
}

// ── Bus→Bus feed crosspoint toggle ────────────────────────────────────────
async function _toggleBusFeed(srcId, dstId, cell) {
  if (_locked) return;
  const key = `feed:${srcId}|${dstId}`;
  if (_pendingCrosspoints.has(key)) return;
  _pendingCrosspoints.set(key, Date.now());
  cell.style.pointerEvents = 'none';

  const active = st.hasBusFeed(srcId, dstId);
  const newActive = !active;
  cell.classList.toggle('active', newActive);

  const setFeedCell = (val) => {
    const srcIdx = parseInt(srcId.replace('bus_', ''), 10);
    const dstIdx = parseInt(dstId.replace('bus_', ''), 10);
    const matrix = st.state.busFeedMatrix.map(row => [...row]);
    while (matrix.length <= dstIdx) matrix.push([]);
    while ((matrix[dstIdx] ?? []).length <= srcIdx) matrix[dstIdx].push(false);
    matrix[dstIdx][srcIdx] = val;
    st.setBusFeedMatrix(matrix);
  };

  try {
    await api.putBusFeed(srcId, dstId, newActive);
    setFeedCell(newActive);

    const srcName = st.state.buses.get(srcId)?.name ?? srcId;
    const dstName = st.state.buses.get(dstId)?.name ?? dstId;

    undo.push({
      label: `${newActive ? 'Enable' : 'Disable'} bus feed: ${srcName} → ${dstName}`,
      apply: async () => {
        await api.putBusFeed(srcId, dstId, newActive);
        setFeedCell(newActive);
      },
      revert: async () => {
        await api.putBusFeed(srcId, dstId, active);
        setFeedCell(active);
      },
    });

  } catch (e) {
    cell.classList.toggle('active', active);
    toast('Bus feed error: ' + e.message, true);
  } finally {
    _pendingCrosspoints.delete(key);
    cell.style.pointerEvents = '';
  }
}

// ── Input→Bus crosspoint toggle ────────────────────────────────────────────
async function _toggleInputToBus(bus, chIdx, cell) {
  if (_locked) return;
  const beforeRouting = Array.isArray(bus.routing) ? [...bus.routing] : [];
  const routing = Array.isArray(bus.routing) ? [...bus.routing] : [];
  while (routing.length <= chIdx) routing.push(false);
  const newVal = !routing[chIdx];
  routing[chIdx] = newVal;

  cell.classList.toggle('active', newVal);
  cell.style.pointerEvents = 'none';
  try {
    await api.setBusRouting(bus.id, routing);
    bus.routing = routing;
    st.setBus(bus);

    const busName = st.state.buses.get(bus.id)?.name ?? bus.id;
    const rxId = `rx_${chIdx}`;
    const rxName = st.state.channels.get(rxId)?.name ?? rxId;

    undo.push({
      label: `${newVal ? 'Route' : 'Unroute'} input→bus: ${rxName} → ${busName}`,
      apply: async () => {
        const b = st.state.buses.get(bus.id) ?? bus;
        await api.setBusRouting(bus.id, routing);
        st.setBus({ ...b, routing: [...routing] });
      },
      revert: async () => {
        const b = st.state.buses.get(bus.id) ?? bus;
        await api.setBusRouting(bus.id, beforeRouting);
        st.setBus({ ...b, routing: [...beforeRouting] });
      },
    });

  } catch (e) {
    routing[chIdx] = !newVal;
    bus.routing = routing;
    cell.classList.toggle('active', !newVal);
    toast('Bus routing error: ' + e.message, true);
  } finally {
    cell.style.pointerEvents = '';
  }
}

async function _toggleRoute(rxId, txId, cell) {
  if (_locked) return;
  if (_soloMode === 'pending' || _copyMode) return;

  const key = `${rxId}|${txId}`;
  if (_pendingCrosspoints.has(key)) return;

  _pendingCrosspoints.set(key, Date.now());
  cell.classList.add('pending');
  cell.style.pointerEvents = 'none';

  const routeType = st.getRouteType(rxId, txId);
  const prevClass = cell.className;
  try {
    if (routeType) {
      // Optimistic: show as unrouted immediately
      cell.className = 'xp-cell pending';
      const routeId = `${rxId}|${txId}`;
      await api.deleteRoute(routeId);
      st.removeRoute(rxId, txId);
    } else {
      // Optimistic: show as routed immediately
      cell.className = 'xp-cell local pending';
      const route = await api.postRoute(rxId, txId, 'local');
      st.setRoute({ route_type: 'dante', ...route });
      cell.className = 'xp-cell ' + (st.getRouteType(rxId, txId) ?? 'dante') + ' pending';
    }
    _updateAllStats();

    const rxName = st.state.channels.get(rxId)?.name ?? rxId;
    const txName = st.state.outputs.get(txId)?.name ?? txId;
    const wasActive = !!routeType;

    undo.push({
      label: `${wasActive ? 'Unroute' : 'Route'}: ${rxName} → ${txName}`,
      apply: async () => {
        if (wasActive) {
          await api.deleteRoute(`${rxId}|${txId}`);
          st.removeRoute(rxId, txId);
        } else {
          const route = await api.postRoute(rxId, txId, 'local');
          st.setRoute({ route_type: 'dante', ...route });
        }
        _updateAllStats();
      },
      revert: async () => {
        if (wasActive) {
          const route = await api.postRoute(rxId, txId, 'local');
          st.setRoute({ route_type: 'dante', ...route });
        } else {
          await api.deleteRoute(`${rxId}|${txId}`);
          st.removeRoute(rxId, txId);
        }
        _updateAllStats();
      },
    });

  } catch (e) {
    cell.className = prevClass; // revert on error
    toast('Route error: ' + e.message, true);
  } finally {
    _pendingCrosspoints.delete(key);
    cell.classList.remove('pending');
    cell.style.pointerEvents = '';
  }
}

// ── Per-crosspoint gain scroll wheel ──────────────────────────────────────
const _xpWheelThrottle = new Map();
const _xpWheelUndo = new Map(); // key -> {from, to, timer, ...}

function _onXpWheel(e, rxId, txId, txIdx, rxIdx, cell, gainLabel) {
  if (!st.getRouteType(rxId, txId)) return; // only active routes
  e.preventDefault();
  e.stopPropagation();

  const now = Date.now();
  const throttleKey = `${rxId}|${txId}`;
  const last = _xpWheelThrottle.get(throttleKey) ?? 0;
  if (now - last < 80) return;
  _xpWheelThrottle.set(throttleKey, now);

  const step = e.shiftKey ? 0.1 : 1.0;
  const delta = e.deltaY < 0 ? step : -step;
  const current = st.getMatrixGain(txIdx, rxIdx);
  const next = Math.round((current + delta) * 10) / 10;
  const clamped = Math.max(-40, Math.min(12, next));

  st.setMatrixGainCell(txIdx, rxIdx, clamped);
  gainLabel.textContent = clamped !== 0 ? (clamped > 0 ? `+${clamped.toFixed(1)}` : clamped.toFixed(1)) : '';
  gainLabel.style.display = clamped !== 0 ? '' : 'none';
  cell.classList.toggle('xp-gain-nonunity', clamped !== 0);

  api.putMatrixGain(txIdx, rxIdx, clamped).catch(err => toast('Gain error: ' + err.message, true));

  const uKey = `xp:${rxId}|${txId}`;
  const u = _xpWheelUndo.get(uKey) ?? { from: current, to: clamped, txIdx, rxIdx, timer: null, rxId, txId };
  u.to = clamped;
  clearTimeout(u.timer);
  u.timer = setTimeout(() => {
    _xpWheelUndo.delete(uKey);
    if (u.from === u.to) return;

    const rxName = st.state.channels.get(u.rxId)?.name ?? u.rxId;
    const txName = st.state.outputs.get(u.txId)?.name ?? u.txId;

    undo.push({
      label: `Crosspoint gain: ${rxName} → ${txName}`,
      apply: async () => {
        st.setMatrixGainCell(u.txIdx, u.rxIdx, u.to);
        await api.putMatrixGain(u.txIdx, u.rxIdx, u.to);
      },
      revert: async () => {
        st.setMatrixGainCell(u.txIdx, u.rxIdx, u.from);
        await api.putMatrixGain(u.txIdx, u.rxIdx, u.from);
      },
    });
  }, 600);
  _xpWheelUndo.set(uKey, u);
}

function _onBusXpWheel(e, bus, rxIdx, cell, gainLabel) {
  if (!(Array.isArray(bus.routing) && bus.routing[rxIdx])) return; // only active routes
  e.preventDefault();
  e.stopPropagation();

  const now = Date.now();
  const key = `bus:${bus.id}|${rxIdx}`;
  const last = _xpWheelThrottle.get(key) ?? 0;
  if (now - last < 80) return;
  _xpWheelThrottle.set(key, now);

  const step = e.shiftKey ? 0.1 : 1.0;
  const delta = e.deltaY < 0 ? step : -step;
  const current = bus.routing_gain?.[rxIdx] ?? 0;
  const next = Math.round((current + delta) * 10) / 10;
  const clamped = Math.max(-40, Math.min(12, next));

  st.setBusRoutingGainCell(bus.id, rxIdx, clamped);
  if (!bus.routing_gain) bus.routing_gain = [];
  bus.routing_gain[rxIdx] = clamped;

  gainLabel.textContent = clamped !== 0 ? (clamped > 0 ? `+${clamped.toFixed(1)}` : clamped.toFixed(1)) : '';
  gainLabel.style.display = clamped !== 0 ? '' : 'none';
  cell.classList.toggle('xp-gain-nonunity', clamped !== 0);

  api.setBusInputGain(bus.id, rxIdx, clamped).catch(err => toast('Bus gain error: ' + err.message, true));

  const uKey = `busxp:${bus.id}|${rxIdx}`;
  const u = _xpWheelUndo.get(uKey) ?? { from: current, to: clamped, busId: bus.id, rxIdx, timer: null };
  u.to = clamped;
  clearTimeout(u.timer);
  u.timer = setTimeout(() => {
    _xpWheelUndo.delete(uKey);
    if (u.from === u.to) return;

    const busName = st.state.buses.get(u.busId)?.name ?? u.busId;
    const rxId = `rx_${u.rxIdx}`;
    const rxName = st.state.channels.get(rxId)?.name ?? rxId;

    undo.push({
      label: `Bus send gain: ${rxName} → ${busName}`,
      apply: async () => {
        st.setBusRoutingGainCell(u.busId, u.rxIdx, u.to);
        await api.setBusInputGain(u.busId, u.rxIdx, u.to);
      },
      revert: async () => {
        st.setBusRoutingGainCell(u.busId, u.rxIdx, u.from);
        await api.setBusInputGain(u.busId, u.rxIdx, u.from);
      },
    });
  }, 600);
  _xpWheelUndo.set(uKey, u);
}


// ── Metering update (called from ws.js) ───────────────────────────────────
export function updateMetering(rxData, txData) {
  if (rxData) {
    Object.entries(rxData).forEach(([id, db]) => {
      // Clipping tracking
      const nowClipping = isFinite(db) && db > -3;
      if (nowClipping !== (_clipMap.get(id) ?? false)) {
        _clipMap.set(id, nowClipping);
        _updateAllStats();
      }
      // Signal-flow bar on channel label
      const label = _container?.querySelector(`.ch-label[data-ch-id="${id}"]`);
      if (label) {
        const pct = _dbToPercent(db);
        label.style.setProperty('--signal-pct', pct + '%');
        label.style.setProperty('--signal-color', _dbToColour(db));
      }
      // Crosspoint dot glow: active routes light up proportional to signal level
      const pct = _dbToPercent(db);
      const alpha = Math.max(0.08, pct / 100);
      document.querySelectorAll(`.xp-cell[data-rx-id="${id}"]`).forEach(cell => {
        if (!cell.classList.contains('local') && !cell.classList.contains('dante')) return;
        const dot = cell.querySelector('.xp-dot');
        if (!dot) return;
        dot.style.background = `rgba(40, 210, 80, ${alpha})`;
        dot.style.boxShadow = pct > 15 ? `0 0 ${Math.max(2, Math.round(pct / 18))}px rgba(40,210,80,0.55)` : '';
      });
    });
  }
  if (txData) {
    Object.entries(txData).forEach(([id, db]) => {
      const col = _container?.querySelector(`.out-hdr[data-tx-id="${id}"]`);
      if (!col) return;
      const pct = _dbToPercent(db);
      col.style.setProperty('--signal-pct', pct + '%');
      col.style.setProperty('--signal-color', _dbToColour(db));
    });
  }
}

function _currentMeterMaps() {
  const rx = {};
  const tx = {};
  for (const [id, db] of st.state.metering.entries()) {
    if (id.startsWith('rx_')) rx[id] = db;
    else if (id.startsWith('tx_')) tx[id] = db;
  }
  return { rx, tx };
}

// ── Helpers ────────────────────────────────────────────────────────────────
function _dbToPercent(db) {
  if (!isFinite(db) || db <= -60) return 0;
  if (db >= 0) return 100;
  return Math.round(((db + 60) / 60) * 100);
}

function _dbToColour(db) {
  if (db > -3)  return 'var(--vu-red)';
  if (db > -12) return 'var(--vu-amber)';
  return 'var(--vu-green)';
}

function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── DSP block picker ────────────────────────────────────────────────────────
let _activePicker = null;

function _toggleDspPicker(btn, ch) {
  // Close existing picker
  if (_activePicker) {
    _activePicker.remove();
    _activePicker = null;
    if (_activePicker === null && _lastBtn === btn) return;
  }
  _lastBtn = btn;

  const dsp = ch.dsp ?? {};
  const blocks = Object.keys(dsp);
  if (!blocks.length) return;

  // Capture rect NOW while btn is still visible (hover state)
  const btnRect = btn.getBoundingClientRect();

  const picker = document.createElement('div');
  picker.className = 'dsp-picker';

  blocks.forEach(blk => {
    const block = dsp[blk];
    const colour = DSP_COLOURS[blk] ?? { bg: '#333', fg: '#fff', label: blk.toUpperCase() };
    const badgeState = _getDspBadgeState(block);
    const b = document.createElement('button');
    b.className = 'dsp-picker-btn';
    b.style.background = colour.bg;
    b.style.color = colour.fg;
    b.textContent = (colour.label ?? blk.toUpperCase()) + (badgeState.isActive ? ' ●' : '');
    b.title = blk + badgeState.titleSuffix;
    b.onclick = (e) => {
      e.stopPropagation();
      picker.remove();
      _activePicker = null;
      openPanel(blk, ch.id, btnRect);
    };
    picker.appendChild(b);
  });

  // Position below the DSP button
  const rect = btn.getBoundingClientRect();
  picker.style.position = 'fixed';
  picker.style.top = (rect.bottom + 2) + 'px';
  picker.style.left = rect.left + 'px';
  document.body.appendChild(picker);
  _activePicker = picker;

  // Close on outside click
  const close = (e) => {
    if (!picker.contains(e.target)) {
      picker.remove();
      _activePicker = null;
      document.removeEventListener('click', close);
    }
  };
  setTimeout(() => document.addEventListener('click', close), 0);
}

function _getDspBadgeState(block) {
  const enabled = !!block?.enabled;
  const bypassed = !!block?.bypassed;
  return {
    isByp: bypassed || !enabled,
    isActive: enabled && !bypassed,
    titleSuffix: enabled ? (bypassed ? ' (bypassed)' : ' (active)') : ' (disabled)',
  };
}

let _lastBtn = null;

// ── Label column drag-resize ────────────────────────────────────────────────
const _LABEL_W_KEY = 'minos:matrix:label-w';

function _applyStoredLabelW(viewport) {
  const stored = localStorage.getItem(_LABEL_W_KEY);
  if (stored) viewport.style.setProperty('--label-w', stored);
}

function _initLabelResize(handle) {
  handle.addEventListener('pointerdown', e => {
    e.preventDefault();
    const viewport = handle.closest('.matrix-viewport');
    if (!viewport) return;
    const startX = e.clientX;
    const startW = parseInt(getComputedStyle(viewport).getPropertyValue('--label-w').trim(), 10) || 380;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');

    const onMove = mv => {
      const newW = Math.max(160, startW + (mv.clientX - startX));
      viewport.style.setProperty('--label-w', newW + 'px');
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      const finalW = getComputedStyle(viewport).getPropertyValue('--label-w').trim();
      localStorage.setItem(_LABEL_W_KEY, finalW);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  });
}

// ── Output column rename ────────────────────────────────────────────────────
function _startOutputRename(nameEl, nameWrap, out) {
  const prev = nameEl.textContent;
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = prev;
  inp.className = 'out-rename-input';
  nameEl.style.display = 'none';
  nameWrap.appendChild(inp);
  inp.focus();
  inp.select();

  const commit = async () => {
    const next = inp.value.trim() || prev;
    inp.remove();
    nameEl.style.display = '';
    nameEl.textContent = next;
    nameEl.title = 'Double-click to rename';
    if (next === prev) return;
    try {
      await api.putOutput(out.id, { name: next });
      const cur = st.state.outputs.get(out.id);
      if (cur) st.setOutput({ ...cur, name: next });

      const outId = out.id;
      undo.push({
        label: `Rename output: ${prev} → ${next}`,
        apply: async () => {
          await api.putOutput(outId, { name: next });
          const o = st.state.outputs.get(outId);
          if (o) st.setOutput({ ...o, name: next });
        },
        revert: async () => {
          await api.putOutput(outId, { name: prev });
          const o = st.state.outputs.get(outId);
          if (o) st.setOutput({ ...o, name: prev });
        },
      });

      toast(`Renamed to "${next}"`);
    } catch (e) {
      nameEl.textContent = prev;
      toast('Rename failed: ' + e.message, true);
    }
  };

  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
    if (e.key === 'Escape') {
      inp.removeEventListener('blur', commit);
      inp.remove();
      nameEl.style.display = '';
    }
  });
}


function _startBusRename(nameEl, bus) {
  const prev = nameEl.textContent;
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = prev;
  inp.className = 'ch-rename-input';
  nameEl.textContent = '';
  nameEl.style.overflow = 'visible';
  nameEl.appendChild(inp);
  inp.focus();
  inp.select();

  const commit = async () => {
    const next = inp.value.trim() || prev;
    nameEl.textContent = next;
    nameEl.style.overflow = '';
    nameEl.title = 'Double-click to rename';
    if (next === prev) return;
    try {
      await api.updateBus(bus.id, { name: next });
      const cur = st.state.buses.get(bus.id);
      if (cur) st.setBus({ ...cur, name: next });

      const busId = bus.id;
      undo.push({
        label: `Rename bus: ${prev} → ${next}`,
        apply: async () => {
          await api.updateBus(busId, { name: next });
          const b = st.state.buses.get(busId);
          if (b) st.setBus({ ...b, name: next });
        },
        revert: async () => {
          await api.updateBus(busId, { name: prev });
          const b = st.state.buses.get(busId);
          if (b) st.setBus({ ...b, name: prev });
        },
      });

      toast(`Renamed to "${next}"`);
    } catch (e) {
      nameEl.textContent = prev;
      nameEl.style.overflow = '';
      toast('Rename failed: ' + e.message, true);
    }
  };

  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
    if (e.key === 'Escape') {
      inp.removeEventListener('blur', commit);
      nameEl.textContent = prev;
      nameEl.style.overflow = '';
    }
  });
}

function _startRename(nameEl, ch) {
  const prev = nameEl.textContent;
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = prev;
  inp.className = 'ch-rename-input';
  nameEl.textContent = '';
  nameEl.style.overflow = 'visible';
  nameEl.appendChild(inp);
  inp.focus();
  inp.select();

  const commit = async () => {
    const next = inp.value.trim() || prev;
    nameEl.textContent = next;
    nameEl.style.overflow = '';
    nameEl.title = 'Double-click to rename';
    if (next === prev) return;
    try {
      await api.putChannel(ch.id, { name: next });
      const cur = st.state.channels.get(ch.id);
      if (cur) st.setChannel({ ...cur, name: next });
      // Update mixer strip name if rendered
      document.querySelectorAll(`#strip-${ch.id} .strip-name`).forEach(el => {
        el.textContent = next;
      });

      const chId = ch.id;
      const syncStripName = (nm) => {
        document.querySelectorAll(`#strip-${chId} .strip-name`).forEach(el => {
          el.textContent = nm;
        });
      };

      undo.push({
        label: `Rename input: ${prev} → ${next}`,
        apply: async () => {
          await api.putChannel(chId, { name: next });
          const c = st.state.channels.get(chId);
          if (c) st.setChannel({ ...c, name: next });
          syncStripName(next);
        },
        revert: async () => {
          await api.putChannel(chId, { name: prev });
          const c = st.state.channels.get(chId);
          if (c) st.setChannel({ ...c, name: prev });
          syncStripName(prev);
        },
      });

      toast(`Renamed to "${next}"`);
    } catch (e) {
      nameEl.textContent = prev;
      nameEl.style.overflow = '';
      toast('Rename failed: ' + e.message, true);
    }
  };

  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
    if (e.key === 'Escape') {
      inp.removeEventListener('blur', commit);
      nameEl.textContent = prev;
      nameEl.style.overflow = '';
    }
  });
}

// ── Corner stat live update ────────────────────────────────────────────────
function _updateAllStats() {
  if (!_container) return;
  const channels   = st.channelList();
  const routes     = st.routeList();
  const routedIds  = new Set(routes.map(r => r.rx_id));
  const unroutedN  = channels.filter(ch => !routedIds.has(ch.id)).length;
  const danteN     = routes.filter(r => r.route_type === 'dante').length;
  const clipN      = Array.from(_clipMap.values()).filter(Boolean).length;

  const unrEl = _container.querySelector('.corner-stat-unrouted');
  if (unrEl) {
    unrEl.textContent = `○ ${unroutedN} unrouted`;
    unrEl.classList.toggle('danger', unroutedN > 0);
  }
  const danteEl = _container.querySelector('.corner-stat-dante');
  if (danteEl) danteEl.textContent = `⊕ ${danteN} dante`;

  const clipEl = _container.querySelector('.corner-stat-clip');
  if (clipEl) {
    clipEl.textContent = `▲ ${clipN} clip`;
    clipEl.classList.toggle('danger', clipN > 0);
  }
}

// ── Corner button state refresh (no full re-render) ────────────────────────
function _refreshCornerButtons() {
  if (!_container) return;
  const picking = _soloMode === 'pending' || _copyMode === 'pick-src' || (typeof _copyMode === 'object' && _copyMode !== null);
  document.body.style.cursor = picking ? 'crosshair' : '';
  _container.querySelector('.matrix-grid')?.classList.toggle('pick-mode', picking);

  const btnSolo = _container.querySelector('.corner-btn-solo');
  if (btnSolo) {
    const soloed  = typeof _soloMode === 'object' && _soloMode !== null;
    const pending = _soloMode === 'pending';
    btnSolo.textContent = soloed ? 'un-solo' : 'solo';
    btnSolo.className = 'corner-btn corner-btn-solo' +
      (soloed || pending ? ' active' : '') + (pending ? ' pending' : '');
    btnSolo.title = soloed ? 'Restore all routes' :
      pending ? 'Pick a channel (click to cancel)' : 'Solo a channel';
  }

  const btnCopy = _container.querySelector('.corner-btn-copy');
  if (btnCopy) {
    const active  = !!_copyMode;
    const pickSrc = _copyMode === 'pick-src';
    const hasSrc  = typeof _copyMode === 'object' && _copyMode !== null;
    btnCopy.className = 'corner-btn corner-btn-copy' +
      (active ? ' active' : '') + (active ? ' pending' : '');
    btnCopy.title = pickSrc  ? 'Pick source channel (click to cancel)' :
      hasSrc ? `Copy from "${_copyMode.src}" — pick destination` :
      'Copy channel routes to another channel';
  }

  const btnLock = _container.querySelector('.corner-lock-btn');
  if (btnLock) {
    btnLock.textContent = _locked ? '🔒' : '🔓';
    btnLock.className = 'corner-btn corner-lock-btn' + (_locked ? ' active' : '');
    btnLock.title = _locked ? 'Routes locked — click to unlock' : 'Click to lock routes';
  }
}

// ── Solo mode ──────────────────────────────────────────────────────────────
async function _execSolo(channelId) {
  const allRoutes = st.routeList().slice();
  _soloMode = { channelId, savedRoutes: allRoutes };
  _refreshCornerButtons();

  // Tell backend which RX to PFL-monitor (channelId = "rx_N" → index N)
  const rxIdx = parseInt(channelId.replace('rx_', ''), 10);
  if (!isNaN(rxIdx)) api.putSolo([rxIdx]).catch(() => {});

  for (const r of allRoutes) {
    try { await api.deleteRoute(`${r.rx_id}|${r.tx_id}`); st.removeRoute(r.rx_id, r.tx_id); } catch (_) {}
  }
  for (const r of allRoutes.filter(r => r.rx_id === channelId)) {
    try {
      const route = await api.postRoute(r.rx_id, r.tx_id, r.route_type ?? 'local');
      st.setRoute({ route_type: r.route_type ?? 'local', ...route });
    } catch (_) {}
  }
  render(_container);
}

async function _restoreSolo() {
  if (!_soloMode || typeof _soloMode !== 'object') return;
  const { savedRoutes } = _soloMode;
  _soloMode = null;

  // Clear PFL monitor
  api.clearSolo().catch(() => {});

  const current = st.routeList().slice();
  for (const r of current) {
    try { await api.deleteRoute(`${r.rx_id}|${r.tx_id}`); st.removeRoute(r.rx_id, r.tx_id); } catch (_) {}
  }
  for (const r of savedRoutes) {
    try {
      const route = await api.postRoute(r.rx_id, r.tx_id, r.route_type ?? 'local');
      st.setRoute({ route_type: r.route_type ?? 'local', ...route });
    } catch (_) {}
  }
  render(_container);
}

// ── Copy mode ──────────────────────────────────────────────────────────────
async function _execCopy(srcId, dstId) {
  if (srcId === dstId) { _copyMode = null; _refreshCornerButtons(); return; }
  const srcRoutes = st.routeList().filter(r => r.rx_id === srcId);
  _copyMode = null;
  document.body.style.cursor = '';

  for (const r of srcRoutes) {
    if (!st.getRouteType(dstId, r.tx_id)) {
      try {
        const route = await api.postRoute(dstId, r.tx_id, r.route_type ?? 'local');
        st.setRoute({ route_type: r.route_type ?? 'local', ...route });
      } catch (_) {}
    }
  }
  render(_container);
}


// ── Generator row builder ──────────────────────────────────────────────────
function _buildGenRow(gen, genIdx, outputs, buses) {
  const row = document.createElement('div');
  row.className = 'xp-row gen-row';
  row.dataset.genId = gen.id;

  const label = document.createElement('div');
  label.className = 'ch-label';
  label.dataset.genId = gen.id;

  const num = document.createElement('span');
  num.className = 'ch-num';
  num.textContent = 'G' + (genIdx + 1);
  label.appendChild(num);

  const name = document.createElement('span');
  name.className = 'ch-name';
  name.textContent = gen.name ?? gen.id;
  label.appendChild(name);

  const typeBadge = document.createElement('span');
  typeBadge.className = 'gen-type-badge';
  typeBadge.textContent = gen.gen_type === 'sine' ? 'SINE' : gen.gen_type === 'white_noise' ? 'WHT' : 'PNK';
  label.appendChild(typeBadge);

  row.appendChild(label);

  // Output columns — generators route directly to outputs
  outputs.forEach((out, txIdx) => {
    const currentGain = st.state.generatorBusMatrix?.[genIdx]?.[txIdx];
    const isActive = currentGain !== undefined && currentGain !== null && currentGain > -90;
    const cell = document.createElement('div');
    cell.className = 'xp-cell gen-out-cell' + (isActive ? ' gen-bus-active' : '');
    cell.dataset.genId = gen.id;
    cell.dataset.txId  = out.id;

    const dot = document.createElement('div');
    dot.className = 'xp-dot';
    cell.appendChild(dot);

    cell.addEventListener('click', () => _toggleGenOutput(gen, genIdx, txIdx, out.id, cell, outputs));
    row.appendChild(cell);
  });

  // Bus columns — disabled (bus routing not used for generators)
  if (buses && buses.length > 0) {
    const divCell = document.createElement('div');
    divCell.className = 'xp-cell bus-col-div-cell';
    row.appendChild(divCell);

    buses.forEach(() => {
      const cell = document.createElement('div');
      cell.className = 'xp-cell disabled-cell';
      const dot = document.createElement('div');
      dot.className = 'xp-dot';
      cell.appendChild(dot);
      row.appendChild(cell);
    });
  }

  return row;
}

// ── Generator→Output crosspoint toggle ────────────────────────────────────
async function _toggleGenOutput(gen, genIdx, txIdx, txId, cell, outputs) {
  if (_locked) return;
  const currentGain = st.state.generatorBusMatrix?.[genIdx]?.[txIdx];
  const isActive = currentGain !== undefined && currentGain !== null && currentGain > -90;
  const newGain = isActive ? -96.0 : 0.0;
  cell.classList.toggle('gen-bus-active', !isActive);
  cell.classList.add('pending');
  try {
    const gains = outputs.map((_, oi) => {
      if (oi === txIdx) return newGain;
      return st.state.generatorBusMatrix?.[genIdx]?.[oi] ?? -96.0;
    });
    await api.putGeneratorRouting(gen.id, gains);
    const mat = [...(st.state.generatorBusMatrix ?? [])];
    while (mat.length <= genIdx) mat.push([]);
    mat[genIdx] = gains;
    st.setGeneratorMatrix(mat);
  } catch(e) {
    toast(e.message, true);
    cell.classList.toggle('gen-bus-active', isActive);
  } finally {
    cell.classList.remove('pending');
  }
}

// ── Bus change listener ───────────────────────────────────────────────────
window.addEventListener('pb:buses-changed', () => {
  if (st.state.activeTab === 'matrix') render(_container);
});

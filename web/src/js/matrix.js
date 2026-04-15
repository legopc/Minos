// matrix.js — routing matrix tab render and crosspoint interactions

import * as st  from './state.js';
import * as api from './api.js';
import { toast } from './toast.js';
import { openPanel } from './panels.js';
import { DSP_COLOURS } from './dsp/colours.js';
import { confirmModal } from './modal.js';

let _container = null;

// ── Corner cell module-level state ────────────────────────────────────────
let _locked   = false;
let _soloMode = null;   // null | 'pending' | {channelId, savedRoutes}
let _copyMode = null;   // null | 'pick-src' | {src}
const _clipMap = new Map(); // chId -> bool (currently clipping)
const _pendingCrosspoints = new Map(); // key (rx|tx) -> Date.now()

// ── Public render entry point ──────────────────────────────────────────────
export function render(container) {
  _container = container;

  // Preserve scroll position across re-renders
  const vp = container.querySelector('.matrix-viewport');
  const prevScrollX = vp?.scrollLeft ?? 0;
  const prevScrollY = vp?.scrollTop  ?? 0;

  _container.innerHTML = '';
  _container.className = 'tab-content active';
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

  viewport.appendChild(grid);
  _container.appendChild(viewport);

  // C5: Show empty matrix hint when no routes exist (only after state has loaded — channels populated)
  const routeCount = (st.routeList?.() ?? []).length;
  const stateLoaded = st.state.channels.size > 0;
  if (routeCount === 0 && stateLoaded) {
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
      const badge = document.createElement('button');
      badge.className = 'ch-dsp-badge out-dsp-badge' + ((!block.enabled || block.bypassed) ? ' byp' : '');
      badge.dataset.block = blk;
      badge.dataset.ch = out.id;
      badge.textContent = colour.label ?? blk.toUpperCase();
      badge.title = blk + (block.enabled ? (block.bypassed ? ' (bypassed)' : ' (active)') : ' (disabled)');
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

  // DSP badges inline to the right of name
  const dsp = ch.dsp ?? {};
  Object.keys(dsp).forEach(blk => {
    const block = dsp[blk];

    const colour = DSP_COLOURS[blk] ?? { bg: '#333', fg: '#fff', label: blk.toUpperCase() };
    const badge = document.createElement('button');
    badge.className = 'ch-dsp-badge' + (block.bypassed ? ' byp' : '');
    badge.dataset.block = blk;
    badge.dataset.ch = ch.id;
    badge.textContent = colour.label ?? blk.toUpperCase();
    badge.title = blk + (block.bypassed ? ' (bypassed)' : ' (active)');
    badge.style.background = colour.bg;
    badge.style.color = colour.fg;
    badge.onclick = (e) => { e.stopPropagation(); openPanel(blk, ch.id, badge); };
    label.appendChild(badge);
  });

  // Right-edge resize affordance on every label cell
  label.addEventListener('mousedown', e => {
    const r = label.getBoundingClientRect();
    if (e.clientX >= r.right - 8) {
      e.preventDefault();
      const viewport = label.closest('.matrix-viewport');
      if (!viewport) return;
      const startX = e.clientX;
      const startW = parseInt(getComputedStyle(viewport).getPropertyValue('--label-w').trim(), 10) || 380;
      label.classList.add('resizing');
      const onMove = mv => {
        const newW = Math.max(120, startW + (mv.clientX - startX));
        viewport.style.setProperty('--label-w', newW + 'px');
      };
      const onUp = () => {
        label.classList.remove('resizing');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }
  });
  label.addEventListener('mousemove', e => {
    const r = label.getBoundingClientRect();
    label.style.cursor = e.clientX >= r.right - 8 ? 'col-resize' : '';
  });
  label.addEventListener('mouseleave', () => { label.style.cursor = ''; });

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
  outputs.forEach(out => {
    const zone = txZoneMap.get(out.id);
    const isZoneStart = zone && zone.id !== prevZoneId;
    prevZoneId = zone?.id ?? null;

    const routeType = st.getRouteType(ch.id, out.id);
    const cell = document.createElement('div');
    cell.className = 'xp-cell' + (routeType ? ' ' + routeType : '');
    cell.dataset.rxId = ch.id;
    cell.dataset.txId = out.id;
    if (isZoneStart && zone) {
      cell.style.borderLeft = `2px solid ${st.getZoneColour(zone.colour_index ?? 0)}`;
    }

    const dot = document.createElement('div');
    dot.className = 'xp-dot';
    cell.appendChild(dot);

    cell.addEventListener('click', () => _toggleRoute(ch.id, out.id, cell));
    row.appendChild(cell);
  });

  // Bus crosspoint columns (input→bus routing)
  if (buses && buses.length > 0) {
    // Vertical divider cell
    const divCell = document.createElement('div');
    divCell.className = 'xp-cell bus-col-div-cell';
    row.appendChild(divCell);

    buses.forEach(bus => {
      const active = Array.isArray(bus.routing) && bus.routing[idx] === true;
      const cell = document.createElement('div');
      cell.className = 'xp-cell bus-src' + (active ? ' active' : '');
      cell.dataset.rxId = ch.id;
      cell.dataset.busId = bus.id;

      const dot = document.createElement('div');
      dot.className = 'xp-dot';
      cell.appendChild(dot);

      cell.addEventListener('click', () => _toggleInputToBus(bus, idx, cell));
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
    const badge = document.createElement('button');
    badge.className = 'ch-dsp-badge' + (block.bypassed ? ' byp' : '');
    badge.dataset.block = blk;
    badge.dataset.busId = bus.id;
    badge.textContent = colour.label ?? blk.toUpperCase();
    badge.title = blk + (block.bypassed ? ' (bypassed)' : ' (active)');
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

    const dot = document.createElement('div');
    dot.className = 'xp-dot';
    cell.appendChild(dot);

    cell.addEventListener('click', () => _toggleBusRoute(bus.id, out.id, cell));
    row.appendChild(cell);
  });

  // Empty spacers for bus columns (bus→bus routing n/a)
  if (buses && buses.length > 0) {
    // Divider spacer
    const divSpacer = document.createElement('div');
    divSpacer.className = 'xp-cell bus-col-div-cell';
    row.appendChild(divSpacer);

    buses.forEach(() => {
      const spacer = document.createElement('div');
      spacer.className = 'xp-cell';
      row.appendChild(spacer);
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
  try {
    if (routeActive) {
      cell.className = 'xp-cell pending';
      const routeId = `${busId}|${txId}`;
      await api.deleteRoute(routeId);
      st.setBusMatrix({ ...st.state.busMatrix, [txId]: { ...st.state.busMatrix[txId], [busId]: false } });
    } else {
      cell.className = 'xp-cell bus pending';
      const route = await api.postRoute(busId, txId, 'bus');
      st.setBusMatrix({ ...st.state.busMatrix, [txId]: { ...st.state.busMatrix[txId], [busId]: true } });
    }
  } catch (e) {
    cell.className = prevClass;
    toast('Bus route error: ' + e.message, true);
  } finally {
    _pendingCrosspoints.delete(key);
    cell.classList.remove('pending');
    cell.style.pointerEvents = '';
  }
}

// ── Input→Bus crosspoint toggle ────────────────────────────────────────────
async function _toggleInputToBus(bus, chIdx, cell) {
  if (_locked) return;
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
  } catch (e) {
    cell.className = prevClass; // revert on error
    toast('Route error: ' + e.message, true);
  } finally {
    _pendingCrosspoints.delete(key);
    cell.classList.remove('pending');
    cell.style.pointerEvents = '';
  }
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
    const b = document.createElement('button');
    b.className = 'dsp-picker-btn';
    b.style.background = colour.bg;
    b.style.color = colour.fg;
    const active = block.enabled && !block.bypassed;
    b.textContent = (colour.label ?? blk.toUpperCase()) + (active ? ' ●' : '');
    b.title = blk + (block.enabled ? (block.bypassed ? ' (bypassed)' : ' (active)') : ' (disabled)');
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

let _lastBtn = null;

// ── Label column drag-resize ────────────────────────────────────────────────
function _initLabelResize(handle) {
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    const viewport = handle.closest('.matrix-viewport');
    if (!viewport) return;
    const startX = e.clientX;
    const startW = parseInt(getComputedStyle(viewport).getPropertyValue('--label-w').trim(), 10) || 380;
    handle.classList.add('dragging');

    const onMove = mv => {
      const newW = Math.max(160, startW + (mv.clientX - startX));
      viewport.style.setProperty('--label-w', newW + 'px');
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
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


// ── Bus change listener ───────────────────────────────────────────────────
window.addEventListener('pb:buses-changed', () => {
  if (st.state.activeTab === 'matrix') render(_container);
});

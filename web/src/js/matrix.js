// matrix.js — routing matrix tab render and crosspoint interactions

import * as st  from './state.js';
import * as api from './api.js';
import { toast } from './toast.js';
import { openPanel } from './panels.js';
import { DSP_COLOURS } from './dsp/colours.js';

let _container = null;

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

  // Single scroll container wraps everything
  const viewport = document.createElement('div');
  viewport.className = 'matrix-viewport';

  const grid = document.createElement('div');
  grid.className = 'matrix-grid';
  grid.style.setProperty('--num-cols', orderedOutputs.length);

  grid.appendChild(_buildHdrRow(orderedOutputs, txZoneMap));
  channels.forEach((ch, i) => grid.appendChild(_buildRow(ch, i, orderedOutputs, txZoneMap)));

  viewport.appendChild(grid);
  _container.appendChild(viewport);

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
function _buildHdrRow(outputs, txZoneMap) {
  const row = document.createElement('div');
  row.className = 'matrix-hdr-row';

  // Corner cell (sticky top + left)
  const corner = document.createElement('div');
  corner.className = 'corner-cell';
  corner.textContent = `${outputs.length} OUT`;
  row.appendChild(corner);

  let prevZoneId = null;
  outputs.forEach((out, i) => {
    const zone = txZoneMap.get(out.id);
    const isZoneStart = zone && zone.id !== prevZoneId;
    prevZoneId = zone?.id ?? null;

    const col = document.createElement('div');
    col.className = 'out-hdr' + (isZoneStart ? ' zone-start' : '');
    col.dataset.outId = out.id;
    if (isZoneStart && zone) {
      col.style.setProperty('--zone-color', st.getZoneColour(zone.colour_index ?? 0));
    }

    const numEl = document.createElement('span');
    numEl.className = 'out-num';
    numEl.textContent = i + 1;
    col.appendChild(numEl);

    const label = out.name ?? out.id;
    const nameEl = document.createElement('span');
    nameEl.className = 'out-name';
    nameEl.title = label;
    nameEl.textContent = label.length > 7 ? label.slice(0, 7) : label;
    col.appendChild(nameEl);

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

    const vuWrap = document.createElement('div');
    vuWrap.className = 'out-vu-wrap';
    const vuFill = document.createElement('div');
    vuFill.className = 'out-vu-fill';
    vuFill.id = `vu-out-${out.id}`;
    vuWrap.appendChild(vuFill);
    col.appendChild(vuWrap);

    row.appendChild(col);
  });

  return row;
}

// ── Channel row: sticky label + crosspoint cells ───────────────────────────
function _buildRow(ch, idx, outputs, txZoneMap) {
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
    badge.className = 'ch-dsp-badge' + ((!block.enabled || block.bypassed) ? ' byp' : '');
    badge.dataset.block = blk;
    badge.dataset.ch = ch.id;
    badge.textContent = colour.label ?? blk.toUpperCase();
    badge.title = blk + (block.enabled ? (block.bypassed ? ' (bypassed)' : ' (active)') : ' (disabled)');
    badge.style.background = colour.bg;
    badge.style.color = colour.fg;
    badge.onclick = (e) => { e.stopPropagation(); openPanel(blk, ch.id, badge); };
    label.appendChild(badge);
  });

  const vu = document.createElement('span');
  vu.className = 'ch-vu';
  vu.id = 'vu-rx-' + ch.id;
  const vuFill = document.createElement('span');
  vuFill.className = 'vu-fill';
  vuFill.id = 'vu-fill-' + ch.id;
  vu.appendChild(vuFill);
  label.appendChild(vu);

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

  return row;
}

// ── Crosspoint toggle ──────────────────────────────────────────────────────
async function _toggleRoute(rxId, txId, cell) {
  const routeType = st.getRouteType(rxId, txId);
  const prevClass = cell.className;
  try {
    if (routeType) {
      // Optimistic: show as unrouted immediately
      cell.className = 'xp-cell';
      const routeId = `${rxId}|${txId}`;
      await api.deleteRoute(routeId);
      st.removeRoute(rxId, txId);
    } else {
      // Optimistic: show as routed immediately
      cell.className = 'xp-cell local';
      const route = await api.postRoute(rxId, txId, 'local');
      st.setRoute({ route_type: 'dante', ...route });
      cell.className = 'xp-cell ' + (st.getRouteType(rxId, txId) ?? 'dante');
    }
  } catch (e) {
    cell.className = prevClass; // revert on error
    toast('Route error: ' + e.message, true);
  }
}

// ── Metering update (called from ws.js) ───────────────────────────────────
export function updateMetering(rxData, txData) {
  if (rxData) {
    Object.entries(rxData).forEach(([id, db]) => {
      const fill = document.getElementById(`vu-fill-${id}`);
      if (fill) {
        const pct = _dbToPercent(db);
        fill.style.height = pct + '%';
        fill.style.background = _dbToColour(db);
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
      const fill = document.getElementById(`vu-out-${id}`);
      if (!fill) return;
      const pct = _dbToPercent(db);
      fill.style.width = pct + '%';
      fill.style.background = _dbToColour(db);
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

// ── Inline channel rename ──────────────────────────────────────────────────
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

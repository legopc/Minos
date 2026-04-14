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

  const wrap = document.createElement('div');
  wrap.className = 'matrix-main';

  // Build output→zone lookup
  const txZoneMap = new Map();
  zones.forEach(zone => {
    (zone.tx_ids ?? []).forEach(txId => txZoneMap.set(txId, zone));
  });

  // Order outputs: group by zone, then ungrouped
  const orderedOutputs = _orderOutputsByZone(outputs, zones);

  wrap.appendChild(_buildLeft(channels, outputs));
  wrap.appendChild(_buildScrollArea(channels, orderedOutputs, zones, txZoneMap));

  _container.appendChild(wrap);
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

// ── Left panel (channel names + mini VU) ──────────────────────────────────
function _buildLeft(channels) {
  const left = document.createElement('div');
  left.className = 'matrix-left';

  const hdr = document.createElement('div');
  hdr.className = 'left-header';
  left.appendChild(hdr);

  const rows = document.createElement('div');
  rows.className = 'left-rows';
  channels.forEach((ch, i) => {
    const row = document.createElement('div');
    row.className = 'ch-label';
    row.dataset.chId = ch.id;

    // Wrap num+name+vu in mainRow
    const mainRow = document.createElement('div');
    mainRow.className = 'ch-label-main';

    const num = document.createElement('span');
    num.className = 'ch-num';
    num.textContent = i + 1;
    mainRow.appendChild(num);

    const name = document.createElement('span');
    name.className = 'ch-name';
    name.title = ch.name ?? ch.id;
    name.textContent = ch.name ?? ch.id;
    mainRow.appendChild(name);

    const vu = document.createElement('span');
    vu.className = 'ch-vu';
    vu.id = 'vu-rx-' + ch.id;
    const vuFill = document.createElement('span');
    vuFill.className = 'vu-fill';
    vuFill.id = 'vu-fill-' + ch.id;
    vu.appendChild(vuFill);
    mainRow.appendChild(vu);

    row.appendChild(mainRow);

    // Inline DSP block badges (sibling of mainRow)
    const dspRow = document.createElement('div');
    dspRow.className = 'ch-dsp-inline';
    const dsp = ch.dsp ?? {};
    Object.keys(dsp).forEach(blk => {
      const block = dsp[blk];
      const colour = DSP_COLOURS[blk] ?? { bg: '#333', fg: '#fff', label: blk.toUpperCase() };
      const badge = document.createElement('button');
      badge.className = 'ch-dsp-badge' + ((!block.enabled || block.bypassed) ? ' byp' : '');
      badge.textContent = colour.label ?? blk.toUpperCase();
      badge.title = blk + (block.enabled ? (block.bypassed ? ' (bypassed)' : ' (active)') : ' (disabled)');
      badge.style.background = colour.bg;
      badge.style.color = colour.fg;
      badge.onclick = (e) => {
        e.stopPropagation();
        openPanel(blk, ch.id, badge);
      };
      dspRow.appendChild(badge);
    });
    row.appendChild(dspRow);

    rows.appendChild(row);
  });
  left.appendChild(rows);
  return left;
}

// ── Scroll area (output headers + crosspoint grid) ────────────────────────
function _buildScrollArea(channels, outputs, zones, txZoneMap) {
  const scroll = document.createElement('div');
  scroll.className = 'matrix-scroll';
  scroll.id = 'matrix-scroll';

  scroll.appendChild(_buildHeader(outputs, txZoneMap));
  scroll.appendChild(_buildBody(channels, outputs, txZoneMap));

  // Sync left panel scroll with body scroll
  scroll.addEventListener('scroll', () => {
    const leftRows = document.querySelector('.left-rows');
    if (leftRows) leftRows.scrollTop = scroll.scrollTop;
  });

  return scroll;
}

// ── Output header row ──────────────────────────────────────────────────────
function _buildHeader(outputs, txZoneMap) {
  const hdr = document.createElement('div');
  hdr.className = 'matrix-header';

  let prevZoneId = null;
  outputs.forEach((out, i) => {
    const zone = txZoneMap.get(out.id);
    const isZoneStart = zone && zone.id !== prevZoneId;
    prevZoneId = zone?.id ?? null;

    const col = document.createElement('div');
    col.className = 'output-col' + (isZoneStart ? ' zone-start' : '');
    col.dataset.outId = out.id;
    if (isZoneStart && zone) {
      col.style.setProperty('--zone-sep-color', st.getZoneColour(zone.colour_index ?? 0));
    }

    // Short label: number + abbreviated name
    const label = out.name ?? out.id;
    const abbr  = label.length > 6 ? label.slice(0, 6) : label;
    col.innerHTML = `
      <span style="font-size:13px;font-weight:700;color:var(--text-primary)">${i + 1}</span>
      <span style="font-size:11px;color:var(--text-secondary);overflow:hidden;max-width:52px;text-overflow:ellipsis;white-space:nowrap" title="${_esc(label)}">${_esc(abbr)}</span>
    `;
    col.style.flexDirection = 'column';
    col.style.alignItems = 'center';
    hdr.appendChild(col);
  });

  return hdr;
}

// ── Crosspoint grid ────────────────────────────────────────────────────────
function _buildBody(channels, outputs, txZoneMap) {
  const body = document.createElement('div');
  body.className = 'matrix-body';

  channels.forEach(ch => {
    const row = document.createElement('div');
    row.className = 'matrix-row';
    row.dataset.rxId = ch.id;

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

    body.appendChild(row);
  });

  return body;
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
    }
  } catch (e) {
    cell.className = prevClass; // revert on error
    toast('Route error: ' + e.message, true);
  }
}

// ── Metering update (called from ws.js) ───────────────────────────────────
export function updateMetering(rxData) {
  if (!rxData) return;
  Object.entries(rxData).forEach(([id, db]) => {
    const fill = document.getElementById(`vu-fill-${id}`);
    if (!fill) return;
    const pct = _dbToPercent(db);
    fill.style.height = pct + '%';
    fill.style.background = _dbToColour(db);
  });
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

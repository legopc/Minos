// matrix.js — routing matrix tab render and crosspoint interactions

import * as st  from './state.js';
import * as api from './api.js';
import { toast } from './main.js';

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
    row.innerHTML = `
      <span class="ch-num">${i + 1}</span>
      <span class="ch-name" title="${_esc(ch.name ?? ch.id)}">${_esc(ch.name ?? ch.id)}</span>
      <span class="ch-vu" id="vu-rx-${ch.id}"><span class="vu-fill" id="vu-fill-${ch.id}"></span></span>
    `;
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
    const abbr  = label.length > 4 ? label.slice(0, 4) : label;
    col.innerHTML = `
      <span style="font-size:8px;color:var(--text-dim)">${i + 1}</span>
      <span style="font-size:7px;color:var(--text-muted);overflow:hidden;max-width:26px;text-overflow:ellipsis;white-space:nowrap" title="${_esc(label)}">${_esc(abbr)}</span>
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
  try {
    if (routeType) {
      // Remove route
      const routeId = `${rxId}|${txId}`;
      await api.deleteRoute(routeId);
      st.removeRoute(rxId, txId);
      cell.className = 'xp-cell';
    } else {
      // Add local route
      const route = await api.postRoute(rxId, txId, 'local');
      st.setRoute(route);
      cell.className = 'xp-cell local';
    }
  } catch (e) {
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

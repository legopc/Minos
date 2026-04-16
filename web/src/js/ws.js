// ws.js — WebSocket client with reconnect, typed message dispatch

import * as st     from './state.js';
import * as meter  from './metering.js';

let _ws       = null;
let _retryMs  = 1000;
let _retryTmr = null;
let _meterFilter = null;  // null = all, Set = filtered ids

export function initWs() {
  _connect();
}

export function subscribeMeteringIds(ids) {
  _meterFilter = ids ? new Set(ids) : null;
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify({ type: 'subscribe_metering', ids: ids ?? null }));
  }
}

function _connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = localStorage.getItem('pb_token') ?? '';
  const url   = `${proto}//${location.host}/ws${token ? '?token=' + encodeURIComponent(token) : ''}`;

  _ws = new WebSocket(url);

  _ws.onopen = () => {
    _retryMs = 1000;
    st.setConnState('connected');
    window.dispatchEvent(new CustomEvent('pb:ws-state', { detail: 'connected' }));
    // Re-subscribe if we had a filter
    if (_meterFilter) {
      _ws.send(JSON.stringify({ type: 'subscribe_metering', ids: [..._meterFilter] }));
    }
  };

  _ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    _dispatch(msg);
  };

  _ws.onclose = () => {
    _ws = null;
    st.setConnState('offline');
    window.dispatchEvent(new CustomEvent('pb:ws-state', { detail: 'offline' }));
    _scheduleRetry();
  };

  _ws.onerror = () => {
    _ws?.close();
  };
}

function _scheduleRetry() {
  clearTimeout(_retryTmr);
  _retryTmr = setTimeout(() => _connect(), _retryMs);
  _retryMs  = Math.min(_retryMs * 2, 30000);
}

// ── Message dispatch ───────────────────────────────────────────────────────
function _dispatch(msg) {
  switch (msg.type) {
    case 'hello':
      _handleHello(msg);
      break;

    case 'metering':
      st.setMetering(msg.rx, msg.tx, msg.gr, msg.bus);
      meter.updateAll(msg);
      window.dispatchEvent(new CustomEvent('pb:metering', { detail: msg }));
      break;

    case 'route_update':
      if (msg.route) {
        if (msg.action === 'deleted') {
          st.removeRoute(msg.route.rx_id, msg.route.tx_id);
        } else {
          st.setRoute(msg.route);
        }
        _refreshMatrixCell(msg.route.rx_id, msg.route.tx_id);
      }
      break;

    case 'bus_created':
      if (msg.bus) {
        st.setBus(msg.bus);
        window.dispatchEvent(new CustomEvent('pb:buses-changed'));
      }
      break;

    case 'bus_deleted':
      if (msg.id) {
        st.removeBus(msg.id);
        window.dispatchEvent(new CustomEvent('pb:buses-changed'));
      }
      break;

    case 'bus_update':
      if (msg.id) {
        const existing = st.state.buses.get(msg.id);
        if (existing) {
          if (msg.name !== undefined) existing.name = msg.name;
          if (msg.muted !== undefined) existing.muted = msg.muted;
          window.dispatchEvent(new CustomEvent('pb:buses-changed'));
        }
      }
      break;

    case 'bus_routing_update':
      if (msg.id) {
        const bus = st.state.buses.get(msg.id);
        if (bus && msg.routing) {
          bus.routing = msg.routing;
          window.dispatchEvent(new CustomEvent('pb:buses-changed'));
        }
      }
      break;

    case 'bus_dsp_update':
      if (msg.id) {
        const bus = st.state.buses.get(msg.id);
        if (bus && msg.block && msg.params) {
          if (!bus.dsp) bus.dsp = {};
          bus.dsp[msg.block] = msg.params;
        }
      }
      break;

    case 'bus_matrix_update':
      if (msg.matrix) {
        const bm = {};
        const outputs = st.outputList();
        msg.matrix.forEach((row, txIdx) => {
          const txId = outputs[txIdx]?.id;
          if (!txId) return;
          bm[txId] = {};
          const buses = st.busList();
          row.forEach((on, busIdx) => {
            const busId = buses[busIdx]?.id;
            if (busId) bm[txId][busId] = on;
          });
        });
        st.setBusMatrix(bm);
        window.dispatchEvent(new CustomEvent('pb:buses-changed'));
      }
      break;

    case 'bus_feed_update':
      if (msg.matrix) {
        st.setBusFeedMatrix(msg.matrix);
        window.dispatchEvent(new CustomEvent('pb:buses-changed'));
      }
      break;

    case 'output_update':
      if (msg.output) {
        st.setOutput(msg.output);
        // Could trigger mixer strip refresh here
      }
      break;

    case 'scene_loaded':
      if (msg.scene_id !== undefined) {
        st.setActiveScene(msg.scene_id);
        window.dispatchEvent(new CustomEvent('pb:status-update'));
      }
      break;

    case 'dante_status':
      if (msg.ptp_locked !== undefined) {
        st.setPtp(msg.ptp_locked, msg.ptp_offset_ns ?? 0);
        window.dispatchEvent(new CustomEvent('pb:status-update'));
      }
      break;

    case 'pong':
      break;

    case 'solo_update':
      st.state.soloSet.clear();
      (msg.channels ?? []).forEach(rx => st.state.soloSet.add(`rx_${rx}`));
      st.state.system.monitor_device = msg.monitor_device ?? null;
      window.dispatchEvent(new CustomEvent('pb:solo-update'));
      break;

    case 'automixer_updated':
      st.setAutomixerGroups(msg.automixer_groups ?? []);
      window.dispatchEvent(new CustomEvent('pb:automixer-changed'));
      break;

    case 'monitor_config_update':
      st.state.system.monitor_device = msg.device ?? null;
      st.state.system.monitor_volume_db = msg.volume_db ?? 0;
      window.dispatchEvent(new CustomEvent('pb:monitor-update'));
      break;

    default:
      break;
  }
}

function _handleHello(msg) {
  const sys = st.state.system;
  if (msg.rx_count !== undefined) sys.rx_count = msg.rx_count;
  if (msg.tx_count !== undefined) sys.tx_count = msg.tx_count;
  if (msg.zone_count !== undefined) sys.zone_count = msg.zone_count;
  (msg.solo_channels ?? []).forEach(rx => st.state.soloSet.add(`rx_${rx}`));
  if (msg.monitor_device !== undefined) sys.monitor_device = msg.monitor_device ?? null;
  if (msg.monitor_volume_db !== undefined) sys.monitor_volume_db = msg.monitor_volume_db ?? 0;
  window.dispatchEvent(new CustomEvent('pb:status-update'));
}

function _refreshMatrixCell(rxId, txId) {
  const cell = document.querySelector(
    `.xp-cell[data-rx-id="${rxId}"][data-tx-id="${txId}"]`
  );
  if (!cell) return;
  const routeType = st.getRouteType(rxId, txId);
  cell.className = 'xp-cell' + (routeType ? ' ' + routeType : '');
}

export function sendPing() {
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify({ type: 'ping' }));
  }
}

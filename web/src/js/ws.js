// ws.js — WebSocket client with reconnect, typed message dispatch

import * as st     from './state.js';
import * as meter  from './metering.js';
import { updateStatusBar, updateWsStatus } from './main.js';
import { updateMetering as matrixUpdateMetering } from './matrix.js';

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
    updateWsStatus('connected');
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
    updateWsStatus('offline');
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
      st.setMetering(msg.rx, msg.tx, msg.gr);
      meter.updateAll(msg);
      // Also update matrix mini-VU
      if (msg.rx) matrixUpdateMetering(msg.rx);
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

    case 'output_update':
      if (msg.output) {
        st.setOutput(msg.output);
        // Could trigger mixer strip refresh here
      }
      break;

    case 'scene_loaded':
      if (msg.scene_id !== undefined) {
        st.setActiveScene(msg.scene_id);
        updateStatusBar();
      }
      break;

    case 'dante_status':
      if (msg.ptp_locked !== undefined) {
        st.setPtp(msg.ptp_locked, msg.ptp_offset_ns ?? 0);
        updateStatusBar();
      }
      break;

    case 'pong':
      break;

    default:
      break;
  }
}

function _handleHello(msg) {
  // Update system counts from hello frame
  const sys = st.state.system;
  if (msg.rx_count !== undefined) sys.rx_count = msg.rx_count;
  if (msg.tx_count !== undefined) sys.tx_count = msg.tx_count;
  if (msg.zone_count !== undefined) sys.zone_count = msg.zone_count;
  updateStatusBar();
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

// ws.js — WebSocket client with reconnect, typed message dispatch

import * as st     from './state.js';
import * as meter  from './metering.js';

let _ws       = null;
let _retryMs  = 1000;
let _retryTmr = null;
let _meterFilter = null;  // null = all, Set = filtered ids
let _ballistics = meter.BALLISTICS_PRESETS.Digital;
let _hasConnected = false;
let _lastCloseReason = '';

export function setMeteringBallistics(ballistics) {
  _ballistics = ballistics;
}

export function getMeteringBallistics() {
  return _ballistics;
}

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
    clearTimeout(_retryTmr);
    _retryTmr = null;
    const reconnected = _hasConnected;
    _hasConnected = true;
    if (reconnected) {
      st.noteWsReconnect(_lastCloseReason || 'connection interrupted');
      st.setStaleData(true);
      _emitWsState('resyncing', { reason: _lastCloseReason || 'connection interrupted' });
    } else {
      st.setStaleData(false);
      _emitWsState('connected', { reason: 'initial_connect' });
    }
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

  _ws.onclose = (event) => {
    _ws = null;
    _lastCloseReason = _formatCloseReason(event);
    st.setStaleData(true);
    _emitWsState('reconnecting', { reason: _lastCloseReason, retryMs: _retryMs });
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

    case 'resync_state': {
      const serverHash = msg.state_hash ?? null;
      const needsRefresh = !serverHash || !st.state.stateHash || serverHash !== st.state.stateHash;
      if (serverHash) st.setStateHash(serverHash);
      window.dispatchEvent(new CustomEvent('pb:ws-resync', {
        detail: {
          ...msg,
          reason: _lastCloseReason,
          needsRefresh,
        },
      }));
      break;
    }

    case 'metering':
      st.setMetering(msg.rx, msg.tx, msg.gr, msg.bus);
      meter.updateAll(msg, _ballistics);
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
          const prev = bus.dsp[msg.block] ?? {};
          const params = { ...(prev.params ?? {}), ...msg.params };
          if (msg.block === 'am') {
            bus.dsp[msg.block] = {
              ...prev,
              enabled: true,
              bypassed: Number(params.gain_db ?? 0) === 0 && !params.invert_polarity,
              params,
            };
          } else {
            bus.dsp[msg.block] = {
              ...prev,
              enabled: msg.params.enabled ?? prev.enabled,
              params,
            };
          }
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
        window.dispatchEvent(new CustomEvent('pb:buses-changed'));
      } else if (msg.id) {
        const existing = st.state.outputs.get(msg.id);
        if (existing) {
          const patch = {
            ...existing,
            ...(msg.volume_db !== undefined ? { volume_db: msg.volume_db } : {}),
            ...(msg.muted !== undefined ? { muted: msg.muted } : {}),
          };
          st.setOutput(patch);
          const txIdx = Number.parseInt(String(msg.id).replace(/^tx_/, ''), 10);
          const link = Number.isInteger(txIdx) ? st.getOutputStereoLink(txIdx) : null;
          if (link?.linked) {
            const linkedIdx = link.left_channel === txIdx ? link.right_channel : link.left_channel;
            const linkedId = Number.isInteger(linkedIdx) ? `tx_${linkedIdx}` : null;
            const linkedExisting = linkedId ? st.state.outputs.get(linkedId) : null;
            if (linkedExisting) {
              st.setOutput({
                ...linkedExisting,
                ...(msg.volume_db !== undefined ? { volume_db: msg.volume_db } : {}),
                ...(msg.muted !== undefined ? { muted: msg.muted } : {}),
              });
            }
          }
          window.dispatchEvent(new CustomEvent('pb:buses-changed'));
        }
      }
      break;

    case 'vca_updated':
      st.setVcaGroups(msg.vca_groups ?? []);
      break;

    case 'scene_loaded':
      if (msg.scene_id !== undefined) {
        st.setActiveScene(msg.scene_id);
        window.dispatchEvent(new CustomEvent('pb:status-update'));
      }
      break;

    case 'ab_update':
      st.setSceneAb(msg);
      window.dispatchEvent(new CustomEvent('pb:ab-update', { detail: st.state.sceneAb }));
      break;

    case 'morph_progress': {
      st.setSceneAb({
        ...st.state.sceneAb,
        morph: {
          ...(st.state.sceneAb?.morph ?? {}),
          direction: msg.direction ?? st.state.sceneAb?.morph?.direction ?? null,
          duration_ms: st.state.sceneAb?.morph?.duration_ms ?? 0,
          elapsed_ms: msg.elapsed_ms ?? 0,
          t: msg.t ?? 0,
        },
      });
      window.dispatchEvent(new CustomEvent('pb:ab-update', { detail: st.state.sceneAb }));
      break;
    }

    case 'morph_complete':
      st.setSceneAb({
        ...st.state.sceneAb,
        active: msg.active ?? st.state.sceneAb?.active ?? 'a',
        morph: null,
      });
      window.dispatchEvent(new CustomEvent('pb:ab-update', { detail: st.state.sceneAb }));
      break;

    case 'morph_cancelled':
      st.setSceneAb({
        ...st.state.sceneAb,
        morph: null,
      });
      window.dispatchEvent(new CustomEvent('pb:ab-update', { detail: st.state.sceneAb }));
      break;

    case 'dante_status':
      if (msg.ptp_locked !== undefined) {
        st.setPtp(msg.ptp_locked, msg.ptp_offset_ns ?? 0);
        window.dispatchEvent(new CustomEvent('pb:status-update'));
      }
      break;

    case 'task': {
      const task = st.upsertTask(msg);
      if (task) {
        window.dispatchEvent(new CustomEvent('pb:task-update', { detail: task }));
      }
      break;
    }

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
  const previousHash = st.state.stateHash;
  const sys = st.state.system;
  if (msg.rx_count !== undefined) sys.rx_count = msg.rx_count;
  if (msg.tx_count !== undefined) sys.tx_count = msg.tx_count;
  if (msg.zone_count !== undefined) sys.zone_count = msg.zone_count;
  if (msg.state_hash !== undefined) st.setStateHash(msg.state_hash);
  (msg.solo_channels ?? []).forEach(rx => st.state.soloSet.add(`rx_${rx}`));
  if (msg.monitor_device !== undefined) sys.monitor_device = msg.monitor_device ?? null;
  if (msg.monitor_volume_db !== undefined) sys.monitor_volume_db = msg.monitor_volume_db ?? 0;
  if (msg.active_scene_id !== undefined) st.setActiveScene(msg.active_scene_id);
  if (st.state.connState === 'resyncing') {
    window.dispatchEvent(new CustomEvent('pb:ws-resync', {
      detail: {
        ...msg,
        reason: _lastCloseReason,
        needsRefresh: !msg.state_hash || !previousHash || msg.state_hash !== previousHash,
      },
    }));
  }
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

function _emitWsState(state, extra = {}) {
  st.setConnState(state);
  window.dispatchEvent(new CustomEvent('pb:ws-state', { detail: { state, ...extra } }));
}

function _formatCloseReason(event) {
  if (event?.reason) return event.reason;
  switch (event?.code) {
    case 1000:
      return 'socket closed';
    case 1001:
      return 'server restarting';
    case 1006:
      return 'network interruption';
    case 1011:
      return 'server error';
    default:
      return event?.code ? `socket closed (${event.code})` : 'connection lost';
  }
}

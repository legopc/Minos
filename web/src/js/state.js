// state.js — in-memory store, all mutations via setters

const _state = {
  channels:      new Map(),  // id → Channel
  outputs:       new Map(),  // id → Output
  routes:        new Map(),  // "rx_N|tx_N" → Route
  zones:         new Map(),  // id → Zone
  scenes:        [],         // SceneMeta[]
  buses:         new Map(),  // id → Bus
  busMatrix:     {},         // busMatrix[tx_id][bus_id] = true
  matrixGain:    [],         // matrixGain[tx_idx][rx_idx] = dB (float, 0 = unity)
  metering:      new Map(),  // id → dBFS float
  gr:            new Map(),  // "id_block" → GR dB float
  peakHold:      new Map(),  // id → {level, timestamp}
  activeTab:     'matrix',
  selChannel:    null,
  openPanels:    new Map(),  // panel_id → {blockKey, channelId, el, triggerEl}
  soloSet:       new Set(),
  userRole:      'admin',
  connState:     'offline',
  ptp:           { locked: null, offset_ns: 0 },
  activeSceneId: null,
  system:        {
    monitor_device: null,
    monitor_volume_db: 0,
  },
  vcaGroups:     [],    // VcaGroupConfig[]
  stereoLinks:   [],    // StereoLinkConfig[]
};

export const state = _state;

export function setChannel(ch)             { _state.channels.set(ch.id, ch); }
export function setOutput(out)             { _state.outputs.set(out.id, out); }
export function setRoute(r)                { _state.routes.set(`${r.rx_id}|${r.tx_id}`, r); }
export function removeRoute(rxId, txId)    { _state.routes.delete(`${rxId}|${txId}`); }
export function setZone(z)                 { _state.zones.set(z.id, z); }
export function setBus(bus)                { _state.buses.set(bus.id, bus); }
export function removeBus(id)              { _state.buses.delete(id); }
export function setBusMatrix(matrix)       { _state.busMatrix = matrix ?? {}; }
export function setBusRoutingGainCell(busId, rxIdx, db) {
  const bus = _state.buses.get(busId);
  if (!bus) return;
  if (!bus.routing_gain) bus.routing_gain = [];
  bus.routing_gain[rxIdx] = db;
}
export function setMatrixGain(gain)        { _state.matrixGain = gain ?? []; }
export function getMatrixGain(txIdx, rxIdx) {
  return _state.matrixGain[txIdx]?.[rxIdx] ?? 0.0;
}
export function setMatrixGainCell(txIdx, rxIdx, db) {
  if (!_state.matrixGain[txIdx]) _state.matrixGain[txIdx] = [];
  _state.matrixGain[txIdx][rxIdx] = db;
}
export function setScene(s)                {
  const idx = _state.scenes.findIndex(x => x.id === s.id);
  if (idx >= 0) _state.scenes[idx] = s; else _state.scenes.push(s);
}
export function removeScene(id)            { _state.scenes = _state.scenes.filter(s => s.id !== id); }
export function setScenes(arr)             { _state.scenes = arr; }
export function setMetering(rx, tx, gr, bus) {
  if (rx)  Object.entries(rx).forEach(([k,v])  => _state.metering.set(k, v));
  if (tx)  Object.entries(tx).forEach(([k,v])  => _state.metering.set(k, v));
  if (bus) Object.entries(bus).forEach(([k,v]) => _state.metering.set(k, v));
  if (gr)  Object.entries(gr).forEach(([k,v])  => _state.gr.set(k, v));
}
export function setSystem(sys)             { _state.system = sys; }
export function setConnState(s)            { _state.connState = s; }
export function setPtp(locked, offset_ns)  { _state.ptp = { locked, offset_ns }; }
export function setActiveScene(id)         { _state.activeSceneId = id; }
export function setUserRole(role)          { _state.userRole = role; }
export function setActiveTab(tab)          { _state.activeTab = tab; }
export function setSoloed(id, on)          { on ? _state.soloSet.add(id) : _state.soloSet.delete(id); }
export function setVcaGroups(arr)          { _state.vcaGroups = arr ?? []; }
export function setVcaGroup(vca)           {
  const i = _state.vcaGroups.findIndex(v => v.id === vca.id);
  if (i >= 0) _state.vcaGroups[i] = vca; else _state.vcaGroups.push(vca);
}
export function removeVcaGroup(id)         { _state.vcaGroups = _state.vcaGroups.filter(v => v.id !== id); }
export function setStereoLinks(arr)        { _state.stereoLinks = arr ?? []; }
export function getStereoLink(rxIdx)       {
  return _state.stereoLinks.find(sl => sl.left_channel === rxIdx || sl.right_channel === rxIdx) ?? null;
}
export function isStereoLinked(rxIdx)      { return !!getStereoLink(rxIdx)?.linked; }

export function getZoneColour(colourIndex) {
  return `var(--zone-color-${(colourIndex ?? 0) % 10})`;
}

export function channelList()  { return [..._state.channels.values()]; }
export function outputList()   { return [..._state.outputs.values()]; }
export function zoneList()     { return [..._state.zones.values()]; }
export function routeList()    { return [..._state.routes.values()]; }
export function busList()      { return [..._state.buses.values()]; }

export function hasRoute(rxId, txId) {
  return _state.routes.has(`${rxId}|${txId}`);
}

export function getRouteType(rxId, txId) {
  return _state.routes.get(`${rxId}|${txId}`)?.route_type ?? null;
}

export function hasBusRoute(busId, txId) {
  return !!_state.busMatrix[txId]?.[busId];
}

export function getBusRouteType(busId, txId) {
  return _state.busMatrix[txId]?.[busId] ? 'bus' : null;
}

// Fader math (§12.5) — slider range 0–1000
// 4-segment pro taper: Mute→-30dB→-10dB→0dB→+12dB; unity at 87.5%
const _F_MUTE = 25;
const _F_S1 = 325, _F_S2 = 875, _F_S3 = 1000;
const _F_D1L = -30, _F_D1H = -10, _F_D2H = 0, _F_D3H = 12;

export function sliderToDb(v) {
  v = Math.round(Math.max(0, Math.min(_F_S3, v)));
  if (v <= _F_MUTE) return -Infinity;
  if (v <= _F_S1) {
    const t = (v - _F_MUTE) / (_F_S1 - _F_MUTE);
    return _F_D1L + t * (_F_D1H - _F_D1L);
  }
  if (v <= _F_S2) {
    const t = (v - _F_S1) / (_F_S2 - _F_S1);
    return _F_D1H + t * (_F_D2H - _F_D1H);
  }
  const t = (v - _F_S2) / (_F_S3 - _F_S2);
  return _F_D2H + t * (_F_D3H - _F_D2H);
}

export function dbToSlider(db) {
  if (!isFinite(db) && db < 0) return 0;
  if (db < _F_D1L) return 0;
  if (db <= _F_D1H) {
    const t = (db - _F_D1L) / (_F_D1H - _F_D1L);
    return Math.round(_F_MUTE + t * (_F_S1 - _F_MUTE));
  }
  if (db <= _F_D2H) {
    const t = (db - _F_D1H) / (_F_D2H - _F_D1H);
    return Math.round(_F_S1 + t * (_F_S2 - _F_S1));
  }
  if (db <= _F_D3H) {
    const t = (db - _F_D2H) / (_F_D3H - _F_D2H);
    return Math.round(_F_S2 + t * (_F_S3 - _F_S2));
  }
  return _F_S3;
}

export function formatDb(db) {
  if (!isFinite(db)) return '\u2212\u221e';
  return (db >= 0 ? '+' : '') + db.toFixed(1) + ' dB';
}

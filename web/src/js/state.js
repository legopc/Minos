// state.js — in-memory store, all mutations via setters

const _state = {
  channels:      new Map(),  // id → Channel
  outputs:       new Map(),  // id → Output
  routes:        new Map(),  // "rx_N|tx_N" → Route
  zones:         new Map(),  // id → Zone
  scenes:        [],         // SceneMeta[]
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
  system:        {},
};

export const state = _state;

export function setChannel(ch)             { _state.channels.set(ch.id, ch); }
export function setOutput(out)             { _state.outputs.set(out.id, out); }
export function setRoute(r)                { _state.routes.set(`${r.rx_id}|${r.tx_id}`, r); }
export function removeRoute(rxId, txId)    { _state.routes.delete(`${rxId}|${txId}`); }
export function setZone(z)                 { _state.zones.set(z.id, z); }
export function setScene(s)                {
  const idx = _state.scenes.findIndex(x => x.id === s.id);
  if (idx >= 0) _state.scenes[idx] = s; else _state.scenes.push(s);
}
export function removeScene(id)            { _state.scenes = _state.scenes.filter(s => s.id !== id); }
export function setScenes(arr)             { _state.scenes = arr; }
export function setMetering(rx, tx, gr) {
  if (rx) Object.entries(rx).forEach(([k,v]) => _state.metering.set(k, v));
  if (tx) Object.entries(tx).forEach(([k,v]) => _state.metering.set(k, v));
  if (gr) Object.entries(gr).forEach(([k,v]) => _state.gr.set(k, v));
}
export function setSystem(sys)             { _state.system = sys; }
export function setConnState(s)            { _state.connState = s; }
export function setPtp(locked, offset_ns)  { _state.ptp = { locked, offset_ns }; }
export function setActiveScene(id)         { _state.activeSceneId = id; }
export function setUserRole(role)          { _state.userRole = role; }
export function setActiveTab(tab)          { _state.activeTab = tab; }
export function setSoloed(id, on)          { on ? _state.soloSet.add(id) : _state.soloSet.delete(id); }

export function getZoneColour(colourIndex) {
  return `var(--zone-color-${(colourIndex ?? 0) % 10})`;
}

export function channelList()  { return [..._state.channels.values()]; }
export function outputList()   { return [..._state.outputs.values()]; }
export function zoneList()     { return [..._state.zones.values()]; }
export function routeList()    { return [..._state.routes.values()]; }

export function hasRoute(rxId, txId) {
  return _state.routes.has(`${rxId}|${txId}`);
}

export function getRouteType(rxId, txId) {
  return _state.routes.get(`${rxId}|${txId}`)?.route_type ?? null;
}

// Fader math (§12.5) — slider range 0–1000
export function sliderToDb(v) {
  if (v <= 0)   return -Infinity;
  if (v <= 833) return (v / 833) * 60 - 60;
  return ((v - 833) / 167) * 12;
}

export function dbToSlider(db) {
  if (!isFinite(db) || db <= -60) return 0;
  if (db <= 0) return Math.round((db + 60) / 60 * 833);
  return Math.round(833 + (db / 12) * 167);
}

export function formatDb(db) {
  if (!isFinite(db)) return '\u2212\u221e';
  return (db >= 0 ? '+' : '') + db.toFixed(1) + ' dB';
}

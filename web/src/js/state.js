// state.js — in-memory store, all mutations via setters

import * as taper from './fader-taper.js';

const _state = {
  channels:      new Map(),  // id → Channel
  outputs:       new Map(),  // id → Output
  routes:        new Map(),  // "rx_N|tx_N" → Route
  zones:         new Map(),  // id → Zone
  scenes:        [],         // SceneMeta[]
  buses:         new Map(),  // id → Bus
  busMatrix:     {},         // busMatrix[tx_id][bus_id] = true
  busFeedMatrix: [],         // busFeedMatrix[dst_bus_idx][src_bus_idx] = true
  matrixGain:    [],         // matrixGain[tx_idx][rx_idx] = dB (float, 0 = unity)
  metering:      new Map(),  // id → dBFS float
  gr:            new Map(),  // "id_block" → GR dB float
  peakHold:      new Map(),  // id → {level, timestamp}
  activeTab:     'matrix',
  selChannel:    null,
  openPanels:    new Map(),  // panel_id → {blockKey, channelId, el, triggerEl}
  soloSet:       new Set(),
  userName:      '',
  userRole:      'admin',
  userZone:      null,
  allowedTabs:   ['matrix', 'mixer', 'scenes', 'zones', 'dante', 'system'],
  shellMode:     'full',
  focusedZoneId: null,
  connState:     'offline',
  staleData:     false,
  stateHash:     null,
  reconnectCount: 0,
  lastWsReason:  '',
  ptp:           { locked: null, offset_ns: 0 },
  activeSceneId: null,
  sceneAb:       { slot_a: null, slot_b: null, active: 'a', morph: null },
  tasks:         [],    // TaskStatus[]
  system:        {
    monitor_device: null,
    monitor_volume_db: 0,
  },
  vcaGroups:     [],    // VcaGroupConfig[]
  automixerGroups: [],  // AutomixerGroupConfig[]
  stereoLinks:   [],    // input StereoLinkConfig[]
  outputStereoLinks: [], // output StereoLinkConfig[]
  generators:    [],    // SignalGeneratorConfig[]
  generatorBusMatrix: [], // generator_bus_matrix[gen_idx][tx_idx]
};

export const state = _state;

export function setChannel(ch)             { _state.channels.set(ch.id, ch); }
export function setOutput(out)             { _state.outputs.set(out.id, out); }
export function setRoute(r)                { _state.routes.set(`${r.rx_id}|${r.tx_id}`, r); }
export function removeRoute(rxId, txId)    { _state.routes.delete(`${rxId}|${txId}`); }
export function setZone(z)                 { _state.zones.set(z.id, z); }
export function removeZone(id)             { _state.zones.delete(id); }
export function setBus(bus)                { _state.buses.set(bus.id, bus); }
export function removeBus(id)              { _state.buses.delete(id); }
export function setBusMatrix(matrix)       { _state.busMatrix = matrix ?? {}; }
export function setBusFeedMatrix(matrix)   { _state.busFeedMatrix = matrix ?? []; }
export function hasBusFeed(srcId, dstId) {
  const src = parseInt(srcId.replace('bus_', ''), 10);
  const dst = parseInt(dstId.replace('bus_', ''), 10);
  return !!_state.busFeedMatrix[dst]?.[src];
}
export function setChannels(arr)           { _state.channels = new Map((arr ?? []).map((ch) => [ch.id, ch])); }
export function setOutputs(arr)            { _state.outputs = new Map((arr ?? []).map((out) => [out.id, out])); }
export function setRoutes(arr)             { _state.routes = new Map((arr ?? []).map((r) => [`${r.rx_id}|${r.tx_id}`, r])); }
export function setZones(arr)              { _state.zones = new Map((arr ?? []).map((zone) => [zone.id, zone])); }
export function setBuses(arr)              { _state.buses = new Map((arr ?? []).map((bus) => [bus.id, bus])); }
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
function _sceneKey(s) { return s?.id ?? s?.name; }

export function setScene(s)                {
  const k = _sceneKey(s);
  const idx = _state.scenes.findIndex(x => _sceneKey(x) === k);
  if (idx >= 0) _state.scenes[idx] = s; else _state.scenes.push(s);
}
export function removeScene(id)            { _state.scenes = _state.scenes.filter(s => _sceneKey(s) !== id); }
export function setScenes(arr)             { _state.scenes = arr; }
export function setMetering(rx, tx, gr, bus) {
  if (rx)  Object.entries(rx).forEach(([k,v])  => _state.metering.set(k, v));
  if (tx)  Object.entries(tx).forEach(([k,v])  => _state.metering.set(k, v));
  if (bus) Object.entries(bus).forEach(([k,v]) => _state.metering.set(k, v));
  if (gr)  Object.entries(gr).forEach(([k,v])  => _state.gr.set(k, v));
}
export function taskList()               { return _state.tasks; }
export function setSystem(sys)             { _state.system = sys; }
export function setConnState(s)            { _state.connState = s; }
export function setStaleData(stale)        { _state.staleData = !!stale; }
export function setStateHash(hash)         { _state.stateHash = hash ? String(hash) : null; }
export function noteWsReconnect(reason)    {
  _state.reconnectCount += 1;
  _state.lastWsReason = reason ? String(reason) : '';
}
export function setPtp(locked, offset_ns)  { _state.ptp = { locked, offset_ns }; }
export function setActiveScene(id)         { _state.activeSceneId = id; }
export function setSceneAb(ab)             {
  _state.sceneAb = {
    slot_a: ab?.slot_a ?? null,
    slot_b: ab?.slot_b ?? null,
    active: ab?.active ?? 'a',
    morph: ab?.morph ?? null,
  };
}
export function setUserName(name)          { _state.userName = name ? String(name) : ''; }
export function setUserRole(role)          { _state.userRole = role; }
export function setUserZone(zoneId)        { _state.userZone = zoneId ? String(zoneId) : null; }
export function setAllowedTabs(tabs)       { _state.allowedTabs = Array.isArray(tabs) ? [...tabs] : []; }
export function setShellMode(mode)         { _state.shellMode = mode ? String(mode) : 'full'; }
export function setFocusedZone(id)         { _state.focusedZoneId = id ? String(id) : null; }
export function setActiveTab(tab)          { _state.activeTab = tab; }
export function setSoloed(id, on)          { on ? _state.soloSet.add(id) : _state.soloSet.delete(id); }
export function setVcaGroups(arr)          { _state.vcaGroups = arr ?? []; }
export function setVcaGroup(vca)           {
  const i = _state.vcaGroups.findIndex(v => v.id === vca.id);
  if (i >= 0) _state.vcaGroups[i] = vca; else _state.vcaGroups.push(vca);
}
export function removeVcaGroup(id)         { _state.vcaGroups = _state.vcaGroups.filter(v => v.id !== id); }
export function setAutomixerGroups(arr)    { _state.automixerGroups = arr ?? []; }
export function setStereoLinks(arr)        { _state.stereoLinks = arr ?? []; }
export function setOutputStereoLinks(arr)  { _state.outputStereoLinks = arr ?? []; }
export function getStereoLink(rxIdx)       {
  return _state.stereoLinks.find(sl => sl.left_channel === rxIdx || sl.right_channel === rxIdx) ?? null;
}
export function isStereoLinked(rxIdx)      { return !!getStereoLink(rxIdx)?.linked; }
export function getOutputStereoLink(txIdx) {
  return _state.outputStereoLinks.find(sl => sl.left_channel === txIdx || sl.right_channel === txIdx) ?? null;
}
export function isOutputStereoLinked(txIdx) { return !!getOutputStereoLink(txIdx)?.linked; }

export function setGenerators(list)        { _state.generators = list ?? []; }
export function setGenerator(gen)          {
  const idx = _state.generators.findIndex(g => g.id === gen.id);
  if (idx >= 0) _state.generators[idx] = gen;
  else _state.generators.push(gen);
}
export function removeGenerator(id)        { _state.generators = _state.generators.filter(g => g.id !== id); }
export function generatorList()            { return _state.generators; }
export function getGeneratorMatrix()       { return _state.generatorBusMatrix ?? []; }
export function setGeneratorMatrix(m)      { _state.generatorBusMatrix = m; }

export function getZoneColour(colourIndex) {
  return `var(--zone-color-${(colourIndex ?? 0) % 10})`;
}

export function getChannelColour(colourIndex) {
  return colourIndex != null ? `var(--zone-color-${colourIndex % 10})` : null;
}

export function channelList()  { return [..._state.channels.values()]; }
export function outputList()   { return [..._state.outputs.values()]; }
export function zoneList()     { return [..._state.zones.values()]; }
export function routeList()    { return [..._state.routes.values()]; }
export function busList()      { return [..._state.buses.values()]; }

export function normaliseTaskState(state) {
  const value = String(state ?? '').trim().toLowerCase();
  if (['queued', 'pending'].includes(value)) return 'queued';
  if (['running', 'active', 'started', 'in_progress', 'in-progress'].includes(value)) return 'running';
  if (['succeeded', 'success', 'done', 'completed', 'ok'].includes(value)) return 'succeeded';
  if (['failed', 'error'].includes(value)) return 'failed';
  return value || 'queued';
}

export function isTerminalTaskState(state) {
  const value = normaliseTaskState(state);
  return value === 'succeeded' || value === 'failed';
}

export function upsertTask(task) {
  if (!task || typeof task !== 'object') return null;

  const now = Date.now();
  const updatedAt = Number.isFinite(Number(task.ts_ms)) ? Number(task.ts_ms) : now;
  const next = {
    ...task,
    id: task.id != null ? String(task.id) : null,
    kind: task.kind != null ? String(task.kind) : '',
    action: task.action != null ? String(task.action) : '',
    label: task.label != null ? String(task.label) : '',
    message: task.message != null ? String(task.message) : '',
    detail: task.detail != null ? String(task.detail) : '',
    source: task.source != null ? String(task.source) : '',
    scope: task.scope != null ? String(task.scope) : '',
    state: normaliseTaskState(task.state),
    local: task.local === true,
    ts_ms: updatedAt,
  };

  const idx = _state.tasks.findIndex((existing) => {
    if (next.id && existing.id === next.id) return true;
    if ((existing.local || next.local) && next.kind && existing.kind === next.kind) return true;
    if ((existing.local || next.local) && next.action && existing.action === next.action) return true;
    return false;
  });

  if (idx >= 0) {
    _state.tasks[idx] = { ..._state.tasks[idx], ...next };
  } else {
    _state.tasks.unshift(next);
  }

  _state.tasks.sort((a, b) => (b.ts_ms ?? 0) - (a.ts_ms ?? 0));
  _state.tasks = _state.tasks.slice(0, 12);
  return next;
}

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

// Re-export fader taper helpers (see fader-taper.js for implementation)
export const sliderToDb = taper.sliderToDb;
export const dbToSlider = taper.dbToSlider;
export const sliderToGain = taper.sliderToGain;
export const gainToSlider = taper.gainToSlider;

export function formatDb(db) {
  if (!isFinite(db)) return '\u2212\u221e';
  return (db >= 0 ? '+' : '') + db.toFixed(1) + ' dB';
}

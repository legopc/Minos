// api.js — fetch wrappers for all /api/v1/ endpoints
// Never call fetch() directly from other modules — always use these functions.

const BASE = '/api/v1';

let _token = localStorage.getItem('pb_token') ?? '';

export function setToken(t) {
  _token = t;
  localStorage.setItem('pb_token', t);
}

export function clearToken() {
  _token = '';
  localStorage.removeItem('pb_token');
}

export function hasToken() { return !!_token; }

async function req(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(BASE + path, opts);
  if (r.status === 401) {
    clearToken();
    window.dispatchEvent(new CustomEvent('pb:unauthorized'));
    throw new Error('401');
  }
  if (!r.ok) {
    const txt = await r.text().catch(() => r.statusText);
    throw new Error(`${r.status}: ${txt}`);
  }
  if (r.status === 204) return null;
  const _cl = r.headers.get('content-length');
  const _ct = r.headers.get('content-type') ?? '';
  if (_cl === '0') return null;
  if (!_ct.includes('json')) return null;
  return r.json();
}

const get  = (path)        => req('GET',    path);
const post = (path, body)  => req('POST',   path, body);
export const put  = (path, body)  => req('PUT',    path, body);
const del  = (path)        => req('DELETE', path);

async function raw(path, init = {}) {
  const headers = { ...(init.headers ?? {}) };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;
  const r = await fetch(BASE + path, { ...init, headers });
  if (r.status === 401) {
    clearToken();
    window.dispatchEvent(new CustomEvent('pb:unauthorized'));
    throw new Error('401');
  }
  return r;
}

async function compatReq(candidates, defaults = {}) {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  for (const candidate of list) {
    const spec = typeof candidate === 'string'
      ? { path: candidate }
      : candidate;
    const method = spec.method ?? defaults.method ?? 'GET';
    const body = spec.body !== undefined ? spec.body : defaults.body;
    const headers = { ...(defaults.headers ?? {}), ...(spec.headers ?? {}) };
    const init = { method, headers };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      if (!init.headers['Content-Type']) init.headers['Content-Type'] = 'application/json';
    }

    const r = await raw(spec.path, init);
    const continueStatuses = new Set([
      ...(defaults.continueStatuses ?? [404, 405]),
      ...(spec.continueStatuses ?? []),
    ]);
    if (continueStatuses.has(r.status)) continue;
    if (!r.ok) {
      const txt = await r.text().catch(() => r.statusText);
      throw new Error(`${r.status}: ${txt}`);
    }
    if (r.status === 204 || spec.parse === false) return null;
    const ct = r.headers.get('content-type') ?? '';
    if (!ct.includes('json')) return null;
    return r.json();
  }
  return undefined;
}

function uniqueStrings(values) {
  return [...new Set((values ?? []).filter(Boolean).map((value) => String(value)))];
}

function normaliseZoneTemplate(entry, index) {
  if (typeof entry === 'string') {
    return { id: entry, name: entry, description: '' };
  }
  if (!entry || typeof entry !== 'object') return null;
  const id = entry.id ?? entry.template_id ?? entry.slug ?? entry.name ?? `template_${index}`;
  const name = entry.name ?? entry.label ?? entry.title ?? entry.template_name ?? id;
  return {
    ...entry,
    id: String(id),
    name: String(name),
    description: entry.description != null ? String(entry.description) : '',
  };
}

function normaliseZoneTemplates(payload) {
  const list = Array.isArray(payload)
    ? payload
    : payload?.templates ?? payload?.zone_templates ?? payload?.items ?? payload?.data ?? [];
  return Array.isArray(list)
    ? list.map(normaliseZoneTemplate).filter(Boolean)
    : [];
}

function buildQueryString(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === '' || value === 'all') return;
    if (Array.isArray(value)) {
      if (!value.length) return;
      query.set(key, value.join(','));
      return;
    }
    query.set(key, String(value));
  });
  const str = query.toString();
  return str ? `?${str}` : '';
}

// deprecated: use api.put() instead — patch was a misnomer; the actual HTTP method is PUT
export const patch = (path, body) => {
  console.warn('[deprecated] api.patch → api.put');
  return put(path, body);
};

async function reqWithRetry(method, path, body, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await req(method, path, body);
    } catch (e) {
      lastError = e;
      if (method === 'POST' || attempt >= maxRetries) throw e;
      await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

// ── Auth ────────────────────────────────────────────────────────────────────
export function login(username, password) {
  return fetch(BASE + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }).then(r => {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  });
}

let _refreshTimer = null;

/** Schedule a token refresh 15 min before expiry. Call after login or page load. */
export function scheduleRefresh(token) {
  if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null; }
  try {
    const { exp } = JSON.parse(atob(token.split('.')[1]));
    const msUntilRefresh = (exp - 15 * 60) * 1000 - Date.now();
    if (msUntilRefresh <= 0) return; // already near/past expiry — don't schedule
    _refreshTimer = setTimeout(async () => {
      try {
        const r = await fetch(BASE + '/auth/refresh', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${_token}` },
        });
        if (r.ok) {
          const data = await r.json();
          setToken(data.token);
          scheduleRefresh(data.token);
        } else {
          // Refresh rejected — force re-login
          clearToken();
          window.dispatchEvent(new CustomEvent('pb:unauthorized'));
        }
      } catch { /* network error — will be caught on next API call */ }
    }, msUntilRefresh);
  } catch { /* malformed token — ignore */ }
}

// ── Channels (RX inputs) ───────────────────────────────────────────────────
/**
 * Fetch all input channels.
 * @returns {Promise<Array<ChannelResponse>>} Array of channel objects
 */
export const getChannels     = ()          => get('/channels');

/**
 * Fetch a single input channel by ID.
 * @param {string} id - Channel ID (e.g., "rx_0")
 * @returns {Promise<ChannelResponse>} Channel object
 */
export const getChannel      = (id)        => get(`/channels/${id}`);

/**
 * Update channel properties.
 * @param {string} id - Channel ID
 * @param {UpdateChannelRequest} body - Update payload
 * @returns {Promise<null>}
 */
export const putChannel      = (id, body)  => put(`/channels/${id}`, body);

// Input DSP
/**
 * Fetch complete DSP chain for an input.
 * @param {number} ch - Channel index
 * @returns {Promise<Object>} DSP chain object
 */
export const getInputDsp        = (ch)         => get(`/inputs/${ch}/dsp`);

/**
 * Set input gain.
 * @param {number} ch - Channel index
 * @param {number} db - Gain in dB ([-60, 24])
 * @returns {Promise<null>}
 */
export const putInputGain       = (ch, db)     => reqWithRetry('PUT', `/inputs/${ch}/gain`, { gain_db: db });

/**
 * Set input polarity invert.
 * @param {number} ch - Channel index
 * @param {boolean} invert - Invert polarity
 * @returns {Promise<null>}
 */
export const putInputPolarity   = (ch, invert) => reqWithRetry('PUT', `/inputs/${ch}/polarity`, { invert });

/**
 * Update input high-pass filter.
 * @param {number} ch - Channel index
 * @param {DspBlock<FilterConfig>} body - Filter DSP block envelope
 * @returns {Promise<null>}
 */
export const putInputHpf        = (ch, body)   => reqWithRetry('PUT', `/inputs/${ch}/hpf`, body);

/**
 * Update input low-pass filter.
 * @param {number} ch - Channel index
 * @param {DspBlock<FilterConfig>} body - Filter DSP block envelope
 * @returns {Promise<null>}
 */
export const putInputLpf        = (ch, body)   => reqWithRetry('PUT', `/inputs/${ch}/lpf`, body);

/**
 * Update input parametric EQ.
 * @param {number} ch - Channel index
 * @param {DspBlock<EqConfig>} body - EQ DSP block envelope
 * @returns {Promise<null>}
 */
export const putInputEq         = (ch, body)   => reqWithRetry('PUT', `/inputs/${ch}/eq`, body);

/**
 * Toggle input EQ enabled state.
 * @param {number} ch - Channel index
 * @param {boolean} enabled - EQ enabled
 * @returns {Promise<null>}
 */
export const putInputEqEnabled  = (ch, enabled)=> reqWithRetry('PUT', `/inputs/${ch}/eq/enabled`, { enabled });

/**
 * Update input gate.
 * @param {number} ch - Channel index
 * @param {DspBlock<GateConfig>} body - Gate DSP block envelope
 * @returns {Promise<null>}
 */
export const putInputGate       = (ch, body)   => reqWithRetry('PUT', `/inputs/${ch}/gate`, body);

/**
 * Update input compressor.
 * @param {number} ch - Channel index
 * @param {DspBlock<CompressorConfig>} body - Compressor DSP block envelope
 * @returns {Promise<null>}
 */
export const putInputCompressor = (ch, body)   => reqWithRetry('PUT', `/inputs/${ch}/compressor`, body);

/**
 * Toggle input enabled state.
 * @param {number} ch - Channel index
 * @param {boolean} enabled - Input enabled
 * @returns {Promise<null>}
 */
export const putInputEnabled    = (ch, enabled)=> reqWithRetry('PUT', `/inputs/${ch}/enabled`, { enabled });

// ── Outputs (TX channels) ──────────────────────────────────────────────────
/**
 * Fetch all output channels.
 * @returns {Promise<Array<OutputResponse>>} Array of output objects
 */
export const getOutputs     = ()          => get('/outputs');

/**
 * Fetch a single output channel by ID.
 * @param {string} id - Output ID (e.g., "tx_0")
 * @returns {Promise<OutputResponse>} Output object
 */
export const getOutput      = (id)        => get(`/outputs/${id}`);

/**
 * Update output properties.
 * @param {string} id - Output ID
 * @param {UpdateOutputRequest} body - Update payload
 * @returns {Promise<null>}
 */
export const putOutput      = (id, body)  => put(`/outputs/${id}`, body);

// Output DSP
/**
 * Fetch complete DSP chain for an output.
 * @param {number} ch - Channel index
 * @returns {Promise<Object>} DSP chain object
 */
export const getOutputDsp        = (ch)          => get(`/outputs/${ch}/dsp`);

/**
 * Set output volume/gain.
 * @param {number} ch - Channel index
 * @param {number} db - Gain in dB ([-60, 24])
 * @returns {Promise<null>}
 */
export const putOutputGain       = (ch, db)      => reqWithRetry('PUT', `/outputs/${ch}/gain`, { gain_db: db });

/**
 * Update output high-pass filter.
 * @param {number} ch - Channel index
 * @param {DspBlock<FilterConfig>} body - Filter DSP block envelope
 * @returns {Promise<null>}
 */
export const putOutputHpf        = (ch, body)    => reqWithRetry('PUT', `/outputs/${ch}/hpf`, body);

/**
 * Update output low-pass filter.
 * @param {number} ch - Channel index
 * @param {DspBlock<FilterConfig>} body - Filter DSP block envelope
 * @returns {Promise<null>}
 */
export const putOutputLpf        = (ch, body)    => reqWithRetry('PUT', `/outputs/${ch}/lpf`, body);

/**
 * Update output parametric EQ.
 * @param {number} ch - Channel index
 * @param {DspBlock<EqConfig>} body - EQ DSP block envelope
 * @returns {Promise<null>}
 */
export const putOutputEq         = (ch, body)    => reqWithRetry('PUT', `/outputs/${ch}/eq`, body);

/**
 * Toggle output EQ enabled state.
 * @param {number} ch - Channel index
 * @param {boolean} enabled - EQ enabled
 * @returns {Promise<null>}
 */
export const putOutputEqEnabled  = (ch, enabled) => reqWithRetry('PUT', `/outputs/${ch}/eq/enabled`, { enabled });

/**
 * Update output compressor.
 * @param {number} ch - Channel index
 * @param {DspBlock<CompressorConfig>} body - Compressor DSP block envelope
 * @returns {Promise<null>}
 */
export const putOutputCompressor = (ch, body)    => reqWithRetry('PUT', `/outputs/${ch}/compressor`, body);

/**
 * Update output limiter.
 * @param {number} ch - Channel index
 * @param {DspBlock<LimiterConfig>} body - Limiter DSP block envelope
 * @returns {Promise<null>}
 */
export const putOutputLimiter    = (ch, body)    => reqWithRetry('PUT', `/outputs/${ch}/limiter`, body);

/**
 * Update output delay.
 * @param {number} ch - Channel index
 * @param {DspBlock<DelayConfig>} body - Delay DSP block envelope
 * @returns {Promise<null>}
 */
export const putOutputDelay      = (ch, body)    => reqWithRetry('PUT', `/outputs/${ch}/delay`, body);

/**
 * Set output dither bits.
 * @param {number} ch - Channel index
 * @param {number} bits - Dither bits (0, 16, or 24)
 * @returns {Promise<null>}
 */
export const putOutputDither     = (ch, bits)    => reqWithRetry('PUT', `/outputs/${ch}/dither`, { bits });

/**
 * Toggle output enabled state.
 * @param {number} ch - Channel index
 * @param {boolean} enabled - Output enabled
 * @returns {Promise<null>}
 */
export const putOutputEnabled    = (ch, enabled) => reqWithRetry('PUT', `/outputs/${ch}/enabled`, { enabled });

/**
 * Mute/unmute output.
 * @param {number} ch - Channel index
 * @param {boolean} muted - Mute state
 * @returns {Promise<null>}
 */
export const putOutputMute       = (ch, muted)   => reqWithRetry('PUT', `/outputs/${ch}/mute`, { muted });

// ── Zones ──────────────────────────────────────────────────────────────────
/**
 * Fetch all zones.
 * @returns {Promise<Array<ZoneConfig>>} Array of zone objects
 */
export const getZones      = ()          => get('/zones');
export const getZoneMetering = ()        => get('/zones/metering');

/**
 * Create a new zone.
 * @param {CreateZoneRequest} body - Zone creation payload
 * @returns {Promise<ZoneConfig>} Created zone object
 */
export const postZone      = (body)      => post('/zones', body);

/**
 * Update zone properties.
 * @param {string} id - Zone ID
 * @param {UpdateZoneRequest} body - Update payload
 * @returns {Promise<null>}
 */
export const putZone       = (id, body)  => put(`/zones/${id}`, body);

/**
 * Delete a zone.
 * @param {string} id - Zone ID
 * @returns {Promise<null>}
 */
export const deleteZone    = (id)        => del(`/zones/${id}`);

/**
 * Mute a zone (by TX index).
 * @param {number} txIdx - TX channel index
 * @returns {Promise<null>}
 */
export const muteZone      = (txIdx)     => post(`/zones/${txIdx}/mute`);

/**
 * Unmute a zone (by TX index).
 * @param {number} txIdx - TX channel index
 * @returns {Promise<null>}
 */
export const unmuteZone    = (txIdx)     => post(`/zones/${txIdx}/unmute`);

export const postBulkMutation = (body)   => post('/bulk', body);

export async function setZonesMuted(zones, muted) {
  const list = Array.isArray(zones) ? zones : [zones];
  const zoneIds = uniqueStrings(list.map((zone) => zone?.id));
  const txIds = uniqueStrings(list.flatMap((zone) => zone?.tx_ids ?? []));
  const payload = await compatReq([
    { path: '/zones/bulk', method: 'POST', body: { operation: 'set_muted', zone_ids: zoneIds, muted }, continueStatuses: [400] },
    { path: '/zones/bulk-mute', method: 'POST', body: { zone_ids: zoneIds, muted }, continueStatuses: [400] },
    { path: '/bulk', method: 'POST', body: { operation: 'set_zone_outputs_muted', zone_ids: zoneIds, muted }, continueStatuses: [400] },
  ]);
  if (payload !== undefined) return payload;
  for (const txId of txIds) {
    await putOutput(txId, { muted });
  }
  return {
    ok: true,
    operation: muted ? 'mute_zones' : 'unmute_zones',
    affected: txIds.length,
    fallback: true,
  };
}

export async function clearZoneRoutesBulk(zoneId) {
  const payload = await compatReq({
    path: '/bulk',
    method: 'POST',
    body: { operation: 'clear_zone_routes', zone_id: zoneId },
  });
  if (payload !== undefined) return payload;
  await deleteRoutesByZone(zoneId);
  return {
    ok: true,
    operation: 'clear_zone_routes',
    affected: 0,
    fallback: true,
  };
}

export async function clearZonesRoutes(zoneIds) {
  const ids = uniqueStrings(zoneIds);
  const payload = await compatReq([
    { path: '/zones/bulk', method: 'POST', body: { operation: 'clear_routes', zone_ids: ids }, continueStatuses: [400] },
    { path: '/bulk', method: 'POST', body: { operation: 'clear_zone_routes', zone_ids: ids }, continueStatuses: [400] },
  ]);
  if (payload !== undefined) return payload;

  let affected = 0;
  for (const zoneId of ids) {
    const result = await clearZoneRoutesBulk(zoneId);
    affected += Number(result?.affected ?? 0);
  }
  return {
    ok: true,
    operation: 'clear_zone_routes',
    affected,
    fallback: true,
  };
}

export async function getZoneTemplates() {
  const payload = await compatReq([
    '/zones/templates',
    '/zone-templates',
    '/templates/zones',
  ]);
  if (payload === undefined) return [];
  return normaliseZoneTemplates(payload);
}

export async function applyZoneTemplate(zoneIds, templateId) {
  const ids = uniqueStrings(Array.isArray(zoneIds) ? zoneIds : [zoneIds]);
  if (!ids.length || !templateId) {
    return { ok: false, operation: 'apply_zone_template', affected: 0, unsupported: true };
  }

  const payload = await compatReq([
    { path: '/zones/templates/apply', method: 'POST', body: { template_id: templateId, zone_ids: ids }, continueStatuses: [400] },
    { path: '/zones/template/apply', method: 'POST', body: { template_id: templateId, zone_ids: ids }, continueStatuses: [400] },
    { path: '/zone-templates/apply', method: 'POST', body: { template_id: templateId, zone_ids: ids }, continueStatuses: [400] },
    { path: '/templates/zones/apply', method: 'POST', body: { template_id: templateId, zone_ids: ids }, continueStatuses: [400] },
    { path: '/zones/apply-template', method: 'POST', body: { template_id: templateId, zone_ids: ids }, continueStatuses: [400] },
    ...(ids.length === 1 ? [
      { path: `/zones/${ids[0]}/template`, method: 'POST', body: { template_id: templateId }, continueStatuses: [400] },
      { path: `/zones/${ids[0]}/template/apply`, method: 'POST', body: { template_id: templateId }, continueStatuses: [400] },
      { path: `/zones/${ids[0]}/templates/${encodeURIComponent(templateId)}/apply`, method: 'POST', parse: false, continueStatuses: [400] },
    ] : []),
  ]);

  if (payload !== undefined) {
    return {
      ok: true,
      operation: 'apply_zone_template',
      affected: ids.length,
      ...(payload ?? {}),
    };
  }

  return {
    ok: false,
    operation: 'apply_zone_template',
    affected: 0,
    unsupported: true,
  };
}

// ── Routes ─────────────────────────────────────────────────────────────────
/**
 * Fetch all routes (RX-to-TX connections).
 * @returns {Promise<Array<Route>>} Array of route objects
 */
export const getRoutes     = ()                    => get('/routes');
export const getRouteTrace = (tx_id)              => get(`/routes/trace?tx_id=${encodeURIComponent(tx_id)}`);

/**
 * Create a new route.
 * @param {string} rx_id - Source input ID (e.g., "rx_0")
 * @param {string} tx_id - Destination output ID (e.g., "tx_0")
 * @param {string} route_type - Route type ("local", "dante", etc.)
 * @returns {Promise<Route>} Created route object
 */
export const postRoute     = (rx_id, tx_id, route_type) =>
  post('/routes', { rx_id, tx_id, route_type: route_type ?? 'local' });

/**
 * Delete a route by ID.
 * @param {string} id - Route ID
 * @returns {Promise<null>}
 */
export const deleteRoute   = (id)                  => reqWithRetry('DELETE', `/routes/${encodeURIComponent(id)}`);

/**
 * Delete all routes from an RX channel.
 * @param {string} rx_id - RX channel ID
 * @returns {Promise<null>}
 */
export const deleteRoutesByRx = (rx_id)            => reqWithRetry('DELETE', `/routes?rx_id=${rx_id}`);

/**
 * Delete all routes to a TX channel.
 * @param {string} tx_id - TX channel ID
 * @returns {Promise<null>}
 */
export const deleteRoutesByTx = (tx_id)            => reqWithRetry('DELETE', `/routes?tx_id=${tx_id}`);

/**
 * Delete all routes to a zone.
 * @param {string} zone_id - Zone ID
 * @returns {Promise<null>}
 */
export const deleteRoutesByZone = (zone_id)        => reqWithRetry('DELETE', `/routes?zone_id=${zone_id}`);

/**
 * Fetch the routing matrix.
 * @returns {Promise<Array<Array<boolean>>>} 2D matrix [tx_idx][rx_idx]
 */
export const getMatrix     = ()                    => get('/matrix');

/**
 * Set a matrix cell gain.
 * @param {number} tx - TX channel index
 * @param {number} rx - RX channel index
 * @param {number} gain_db - Gain in dB (0 = unity)
 * @returns {Promise<null>}
 */
export const putMatrixGain = (tx, rx, gain_db)     => reqWithRetry('PUT', '/matrix', { tx, rx, enabled: true, gain_db });
// ── Buses ──────────────────────────────────────────────────────────────────
/**
 * Fetch all buses.
 * @returns {Promise<Array<BusResponse>>} Array of bus objects
 */
export const getBuses      = ()             => get('/buses');

/**
 * Create a new bus.
 * @param {string} name - Bus name
 * @returns {Promise<BusResponse>} Created bus object
 */
export const createBus     = (name)         => post('/buses', { name });

/**
 * Delete a bus.
 * @param {string} id - Bus ID (e.g., "bus_0")
 * @returns {Promise<null>}
 */
export const deleteBus     = (id)           => reqWithRetry('DELETE', `/buses/${id}`);

/**
 * Update bus properties.
 * @param {string} id - Bus ID
 * @param {UpdateBusRequest} body - Update payload
 * @returns {Promise<null>}
 */
export const updateBus     = (id, body)     => reqWithRetry('PUT', `/buses/${id}`, body);

/**
 * Set bus routing from inputs.
 * @param {string} id - Bus ID
 * @param {Array<boolean>} routing - Routing flags per RX input
 * @returns {Promise<null>}
 */
export const setBusRouting = (id, routing)  => reqWithRetry('PUT', `/buses/${id}/routing`, { routing });

/**
 * Set complete bus-to-output matrix.
 * @param {Array<Array<boolean>>} matrix - Matrix [tx_idx][bus_idx]
 * @returns {Promise<null>}
 */
export const setBusMatrix  = (matrix)       => reqWithRetry('PUT', '/bus-matrix', { matrix });

/**
 * Get bus-to-bus feed matrix.
 * @returns {Promise<Array<Array<boolean>>>} Feed matrix [dst_bus_idx][src_bus_idx]
 */
export const getBusFeedMatrix = ()           => req('GET', '/bus-feed-matrix');

/**
 * Set bus-to-bus feed.
 * @param {string} src_id - Source bus ID
 * @param {string} dst_id - Destination bus ID
 * @param {boolean} active - Feed active
 * @returns {Promise<null>}
 */
export const putBusFeed    = (src_id, dst_id, active) => reqWithRetry('PUT', '/bus-feed', { src_id, dst_id, active });

/**
 * Set per-input gain on a bus.
 * @param {string} busId - Bus ID
 * @param {number} rxIdx - RX channel index
 * @param {number} gain_db - Gain in dB ([-40, 12])
 * @returns {Promise<null>}
 */
export const setBusInputGain  = (busId, rxIdx, gain_db) => reqWithRetry('PUT', `/buses/${busId}/input-gain`, { rx: rxIdx, gain_db });

/**
 * Set bus gain.
 * @param {string} id - Bus ID
 * @param {number} gain_db - Gain in dB ([-60, 24])
 * @returns {Promise<null>}
 */
export const setBusGain    = (id, gain_db)  => reqWithRetry('PUT', `/buses/${id}/gain`, { gain_db });

/**
 * Set bus polarity invert.
 * @param {string} id - Bus ID
 * @param {boolean} invert - Invert polarity
 * @returns {Promise<null>}
 */
export const putBusPolarity = (id, invert) => reqWithRetry('PUT', `/buses/${id}/polarity`, { invert });

/**
 * Mute/unmute bus.
 * @param {string} id - Bus ID
 * @param {boolean} muted - Mute state
 * @returns {Promise<null>}
 */
export const setBusMute    = (id, muted)    => reqWithRetry('PUT', `/buses/${id}/mute`, { muted });

// ── Scenes ─────────────────────────────────────────────────────────────────
const DEFAULT_RECALL_SCOPE = Object.freeze({
  routing: true,
  inputs: true,
  outputs: true,
  buses: true,
  groups: true,
  generators: true,
});

function normaliseScopedChannelIds(values, prefix) {
  const list = Array.isArray(values) ? values : [];
  return uniqueStrings(list.map((value) => {
    if (typeof value === 'number' && Number.isInteger(value)) return `${prefix}${value}`;
    const str = String(value ?? '').trim();
    if (!str) return null;
    return str.startsWith(prefix) ? str : `${prefix}${str.replace(/^[^0-9-]*/, '')}`;
  }).filter(Boolean));
}

function normaliseRecallScope(scope) {
  if (!scope || typeof scope !== 'object') return { ...DEFAULT_RECALL_SCOPE };
  const inputs = typeof scope.inputs === 'object' && scope.inputs !== null
    ? scope.inputs.enabled !== false
    : scope.inputs !== false;
  const outputs = typeof scope.outputs === 'object' && scope.outputs !== null
    ? scope.outputs.enabled !== false
    : scope.outputs !== false;
  const normalised = {
    routing: scope.routing !== false,
    inputs,
    outputs,
    buses: scope.buses !== false,
    groups: scope.groups !== false,
    generators: scope.generators !== false,
  };
  const inputChannels = normaliseScopedChannelIds(scope.input_channels ?? scope.inputs?.channels, 'rx_');
  const outputChannels = normaliseScopedChannelIds(scope.output_channels ?? scope.outputs?.channels, 'tx_');
  if (inputChannels.length) normalised.input_channels = inputChannels;
  if (outputChannels.length) normalised.output_channels = outputChannels;
  return normalised;
}

/**
 * Fetch all scenes.
 * @returns {Promise<{scenes: Array<Scene>, active: string|null}>} Scenes and active scene ID
 */
export const getScenes     = ()          => get('/scenes');

/**
 * Get a scene by ID.
 * @param {string} id - Scene ID
 * @returns {Promise<Scene>} Scene object
 */
export const getScene      = (id)        => get(`/scenes/${id}`);

/**
 * Save current state as a new scene.
 * @param {string} name - Scene name
 * @returns {Promise<null>}
 */
export const postScene     = (name)      => post('/scenes', { name });

/**
 * Update scene metadata.
 * @param {string} id - Scene ID
 * @param {UpdateSceneRequest} body - Update payload
 * @returns {Promise<null>}
 */
export const putScene      = (id, body)  => put(`/scenes/${id}`, body);

/**
 * Delete a scene.
 * @param {string} id - Scene ID
 * @returns {Promise<null>}
 */
export const deleteScene   = (id)        => del(`/scenes/${id}`);

/**
 * Load a scene (apply its snapshot).
 * @param {string} id - Scene ID
 * @param {Object|undefined} scope - Optional recall scope
 * @returns {Promise<null>}
 */
export const loadScene     = (id, scope) => scope === undefined
  ? post(`/scenes/${id}/load`)
  : post(`/scenes/${id}/load`, { scope: normaliseRecallScope(scope) });

/**
 * Get differences between a scene and current state.
 * @param {string} id - Scene ID
 * @param {Object|undefined} scope - Optional recall scope
 * @returns {Promise<SceneDiff>} Diff object
 */
export const getSceneDiff  = (id, scope) => scope === undefined
  ? get(`/scenes/${id}/diff`)
  : get(`/scenes/${id}/diff${buildQueryString(normaliseRecallScope(scope))}`);
export const getAbState    = ()          => get('/scenes/ab');
export const captureAbSlot = (slot, body = { source: 'live' }) =>
  post(`/scenes/ab/capture?slot=${encodeURIComponent(slot)}`, body);
export const toggleAb      = ()          => post('/scenes/ab/toggle', {});
export const getAbDiff     = ()          => get('/scenes/ab/diff');
export const startAbMorph  = (body)      => post('/scenes/ab/morph', {
  ...body,
  scope: body?.scope ? normaliseRecallScope(body.scope) : undefined,
});
export const cancelAbMorph = ()          => post('/scenes/ab/morph/cancel', {});
export const saveAbSlot    = (slot, name) =>
  post(`/scenes/ab/save?slot=${encodeURIComponent(slot)}`, { name });

// ── Metering ───────────────────────────────────────────────────────────────
/**
 * Fetch current metering snapshot (polling fallback).
 * @returns {Promise<MeteringData>} Metering data with levels and gain reduction
 */
export const getMetering   = ()          => get('/metering');

// ── System ─────────────────────────────────────────────────────────────────
/**
 * Get system configuration.
 * @returns {Promise<SystemConfig>} System info
 */
export const getSystem          = ()     => get('/system');

/**
 * Get Dante diagnostics snapshot.
 * @returns {Promise<Object>} Diagnostics data
 */
export const getDanteDiagnostics = ()    => get('/system/dante/diagnostics');
export const postDanteRecoveryAction = (action) =>
  post(`/system/dante/recovery-actions/${encodeURIComponent(action)}`, {});

/**
 * Get system health status.
 * @returns {Promise<HealthResponse>} Health data
 */
export const getHealth          = ()     => get('/health');

/**
 * Update system settings.
 * @param {UpdateSystemRequest} body - Update payload
 * @returns {Promise<null>}
 */
export const putSystem          = (body) => put('/system', body);

/**
 * Update system configuration.
 * @param {Object} body - Config update
 * @returns {Promise<null>}
 */
export const putSystemConfig    = (body) => put('/system/config', body);

/**
 * Export configuration as TOML file.
 * @returns {Promise<Response>} Raw file response
 */
export const getConfigExport    = ()     => fetch(BASE + '/system/config/export', {
  headers: _token ? { 'Authorization': `Bearer ${_token}` } : {},
});

/**
 * Import configuration from TOML string.
 * @param {string} tomlStr - TOML configuration content
 * @returns {Promise<Response>} Raw response
 */
export const postConfigImport   = (tomlStr) => {
  return fetch(BASE + '/system/config/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/toml', ...(_token ? { 'Authorization': `Bearer ${_token}` } : {}) },
    body: tomlStr,
  });
};

/**
 * Validate configuration from TOML string when the device exposes the endpoint.
 * Unsupported endpoints resolve with supported=false so callers can fall back.
 * @param {string} tomlStr - TOML configuration content
 * @returns {Promise<{supported:boolean,status:number,payload:any}>}
 */
export const postConfigValidate = async (tomlStr) => {
  const r = await raw('/system/config/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/toml' },
    body: tomlStr,
  });

  const ct = r.headers.get('content-type') ?? '';
  const payload = r.status === 204
    ? null
    : ct.includes('json')
      ? await r.json().catch(() => null)
      : await r.text().catch(() => '');

  if ([404, 405, 501].includes(r.status)) {
    return { supported: false, status: r.status, payload };
  }

  if (!r.ok) {
    const message = typeof payload === 'string'
      ? payload
      : payload?.error ?? payload?.message ?? r.statusText;
    const err = new Error(message || `HTTP ${r.status}`);
    err.status = r.status;
    err.body = payload;
    throw err;
  }

  return { supported: true, status: r.status, payload };
};

/**
 * Fetch system audit log rows when the device exposes the endpoint.
 * @param {Object} params - Optional filter/query params
 * @returns {Promise<{supported:boolean,status:number,rows:Array,payload:any}>}
 */
export const getSystemAuditLog = async (params = {}) => {
  const r = await raw(`/system/audit${buildQueryString(params)}`);
  const ct = r.headers.get('content-type') ?? '';
  const payload = r.status === 204
    ? []
    : ct.includes('json')
      ? await r.json().catch(() => null)
      : await r.text().catch(() => '');

  if ([404, 405, 501].includes(r.status)) {
    return { supported: false, status: r.status, rows: [], payload };
  }

  if (!r.ok) {
    const message = typeof payload === 'string'
      ? payload
      : payload?.error ?? payload?.message ?? r.statusText;
    const err = new Error(message || `HTTP ${r.status}`);
    err.status = r.status;
    err.body = payload;
    throw err;
  }

  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.events)
        ? payload.events
        : Array.isArray(payload?.rows)
          ? payload.rows
          : Array.isArray(payload?.data)
            ? payload.data
            : [];

  return { supported: true, status: r.status, rows, payload };
};

/**
 * Download system audit log export when the device exposes the endpoint.
 * @param {Object} params - Optional export params
 * @returns {Promise<{supported:boolean,status:number,response:Response}>}
 */
export const downloadSystemAuditLog = async (params = {}) => {
  const r = await raw(`/system/audit/export${buildQueryString(params)}`);

  if ([404, 405, 501].includes(r.status)) {
    return { supported: false, status: r.status, response: r };
  }

  if (!r.ok) {
    const text = await r.text().catch(() => r.statusText);
    const err = new Error(text || `HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }

  return { supported: true, status: r.status, response: r };
};

/**
 * List configuration backups.
 * @returns {Promise<Array>} Backup metadata
 */
export const getConfigBackups   = ()     => get('/system/config/backups');

/**
 * Download a specific backup file.
 * @param {string} name - Backup filename
 * @returns {Promise<Response>} Raw file response
 */
export const getConfigBackup    = (name) => fetch(BASE + `/system/config/backups/${encodeURIComponent(name)}`, {
  headers: _token ? { 'Authorization': `Bearer ${_token}` } : {},
});

/**
 * Restore a configuration backup.
 * @param {string} name - Backup filename
 * @returns {Promise<null>}
 */
export const restoreConfigBackup = (name) => post(`/system/config/backups/${encodeURIComponent(name)}/restore`, {});

/**
 * Download the current live config as a dated TOML file.
 * @returns {Promise<Response>} Raw file response
 */
export const getConfigBackupDownload = () => fetch(BASE + '/system/config/backup', {
  headers: _token ? { 'Authorization': `Bearer ${_token}` } : {},
});

/**
 * Restore config from a raw TOML string (replaces live config atomically).
 * @param {string} tomlStr - TOML configuration content
 * @returns {Promise<{status:string, message:string}>}
 */
export const postConfigRestore = (tomlStr) => {
  return fetch(BASE + '/system/config/restore', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/toml',
      ...(_token ? { 'Authorization': `Bearer ${_token}` } : {}),
    },
    body: tomlStr,
  }).then(async r => {
    if (!r.ok) {
      const text = await r.text();
      throw new Error(text || `HTTP ${r.status}`);
    }
    return r.json();
  });
};

/**
 * Reconfigure channel counts (admin operation).
 * @param {number} rx - Desired RX channel count
 * @param {number} tx - Desired TX channel count
 * @param {number|undefined} bus_count - Optional bus count
 * @returns {Promise<null>}
 */
export const postAdminChannels  = (rx, tx, bus_count) => {
  const body = { rx, tx };
  if (bus_count !== undefined) body.bus_count = bus_count;
  return post('/admin/channels', body);
};

/**
 * Request system restart.
 * @returns {Promise<null>}
 */
export const postAdminRestart   = ()     => post('/admin/restart', {});

// ── Solo ────────────────────────────────────────────────────────────────────
/**
 * Get current solo state.
 * @returns {Promise<SoloResponse>} Solo channels and monitor device
 */
export const getSolo       = ()      => get('/solo');

/**
 * Set solo channels.
 * @param {Array<string>} chs - Channel IDs to solo (e.g., ["rx_0"])
 * @returns {Promise<null>}
 */
export const putSolo       = (chs)   => put('/solo', { channels: chs });

/**
 * Toggle solo on a channel.
 * @param {number} rx - RX channel index
 * @returns {Promise<null>}
 */
export const toggleSolo    = (rx)    => post(`/solo/toggle/${rx}`);

/**
 * Clear all solo selections.
 * @returns {Promise<null>}
 */
export const clearSolo     = ()      => del('/solo');

// ── Monitor ─────────────────────────────────────────────────────────────────
/**
 * Get monitor output state.
 * @returns {Promise<MonitorResponse>} Monitor device and solo state
 */
export const getMonitor       = ()      => get('/system/monitor');

/**
 * Update monitor output.
 * @param {Object} body - Monitor update (monitor_device, monitor_volume_db, etc.)
 * @returns {Promise<null>}
 */
export const putMonitor       = (body)  => put('/system/monitor', body);

/**
 * List available audio devices.
 * @returns {Promise<Array>} Audio device list
 */
export const getAudioDevices  = ()      => get('/system/audio-devices');

// ── VCA Groups ───────────────────────────────────────────────────────────────
/**
 * Fetch all VCA groups.
 * @returns {Promise<Array>} VCA group list
 */
export const getVcaGroups   = ()           => get('/vca-groups');

/**
 * Create a VCA group.
 * @param {Object} body - VCA group creation payload
 * @returns {Promise<null>}
 */
export const postVcaGroup   = (body)       => post('/vca-groups', body);

/**
 * Update a VCA group.
 * @param {string} id - VCA group ID
 * @param {Object} body - Update payload
 * @returns {Promise<null>}
 */
export const putVcaGroup    = (id, body)   => put(`/vca-groups/${id}`, body);

/**
 * Delete a VCA group.
 * @param {string} id - VCA group ID
 * @returns {Promise<null>}
 */
export const deleteVcaGroup = (id)         => del(`/vca-groups/${id}`);

// ── Automixer Groups ─────────────────────────────────────────────────────────
/**
 * Fetch all automixer groups.
 * @returns {Promise<Array>} Automixer group list
 */
export const getAutomixerGroups   = ()           => get('/automixer-groups');

/**
 * Create an automixer group.
 * @param {Object} body - Automixer group creation payload
 * @returns {Promise<null>}
 */
export const postAutomixerGroup   = (body)       => post('/automixer-groups', body);

/**
 * Update an automixer group.
 * @param {string} id - Automixer group ID
 * @param {Object} body - Update payload
 * @returns {Promise<null>}
 */
export const putAutomixerGroup    = (id, body)   => put(`/automixer-groups/${id}`, body);

/**
 * Delete an automixer group.
 * @param {string} id - Automixer group ID
 * @returns {Promise<null>}
 */
export const deleteAutomixerGroup = (id)         => del(`/automixer-groups/${id}`);

/**
 * Update automixer assignment for an input.
 * @param {number} ch - Channel index
 * @param {UpdateAutomixerChannelRequest} body - Automixer configuration
 * @returns {Promise<null>}
 */
export const putInputAutomixer    = (ch, body)   => put(`/inputs/${ch}/automixer`, body);

// ── Stereo Links ─────────────────────────────────────────────────────────────
/**
 * Fetch all stereo links.
 * @returns {Promise<Array>} Stereo link list
 */
export const getStereoLinks   = ()              => get('/stereo-links');

/**
 * Create a stereo link between two input channels.
 * @param {number} left - Left channel index
 * @param {number} right - Right channel index
 * @returns {Promise<null>}
 */
export const postStereoLink   = (left, right)   => post('/stereo-links', { left_channel: left, right_channel: right });

/**
 * Update a stereo link.
 * @param {number} left_ch - Left channel index
 * @param {Object} body - Update payload
 * @returns {Promise<null>}
 */
export const putStereoLink    = (left_ch, body) => put(`/stereo-links/${left_ch}`, body);

/**
 * Delete a stereo link.
 * @param {number} left_ch - Left channel index
 * @returns {Promise<null>}
 */
export const deleteStereoLink = (left_ch)       => del(`/stereo-links/${left_ch}`);

/**
 * Fetch all output stereo links.
 * @returns {Promise<Array>} Output stereo link list
 */
export const getOutputStereoLinks   = ()              => get('/output-stereo-links');

/**
 * Create a stereo link between two output channels.
 * @param {number} left - Left output index
 * @param {number} right - Right output index
 * @returns {Promise<null>}
 */
export const postOutputStereoLink   = (left, right)   => post('/output-stereo-links', { left_channel: left, right_channel: right });

/**
 * Update an output stereo link.
 * @param {number} left_ch - Left output index
 * @param {Object} body - Update payload
 * @returns {Promise<null>}
 */
export const putOutputStereoLink    = (left_ch, body) => put(`/output-stereo-links/${left_ch}`, body);

/**
 * Delete an output stereo link.
 * @param {number} left_ch - Left output index
 * @returns {Promise<null>}
 */
export const deleteOutputStereoLink = (left_ch)       => del(`/output-stereo-links/${left_ch}`);

// ── Signal Generators ─────────────────────────────────────────────────────────
export async function getGenerators() {
  return req('GET', '/signal-generators');
}

export async function postGenerator(body) {
  return req('POST', '/signal-generators', body);
}

export async function putGenerator(id, body) {
  return req('PUT', `/signal-generators/${id}`, body);
}

export async function deleteGenerator(id) {
  return req('DELETE', `/signal-generators/${id}`);
}

export async function getGeneratorRouting(id) {
  return req('GET', `/signal-generators/${id}/routing`);
}

export async function putGeneratorRouting(id, gains) {
  return req('PUT', `/signal-generators/${id}/routing`, { gains });
}

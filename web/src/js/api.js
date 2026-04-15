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
  const _ct = r.headers.get('content-type') ?? '';
  if (!_ct.includes('json')) return null;
  return r.json();
}

const get  = (path)        => req('GET',    path);
const post = (path, body)  => req('POST',   path, body);
const put  = (path, body)  => req('PUT',    path, body);
const del  = (path)        => req('DELETE', path);
export const patch = (path, body) => req('PUT', path, body);

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
export const getChannels     = ()          => get('/channels');
export const getChannel      = (id)        => get(`/channels/${id}`);
export const putChannel      = (id, body)  => put(`/channels/${id}`, body);

// Input DSP
export const getInputDsp        = (ch)         => get(`/inputs/${ch}/dsp`);
export const putInputGain       = (ch, db)     => reqWithRetry('PUT', `/inputs/${ch}/gain`, { gain_db: db });
export const putInputPolarity   = (ch, invert) => reqWithRetry('PUT', `/inputs/${ch}/polarity`, { invert });
export const putInputHpf        = (ch, body)   => reqWithRetry('PUT', `/inputs/${ch}/hpf`, body);
export const putInputLpf        = (ch, body)   => reqWithRetry('PUT', `/inputs/${ch}/lpf`, body);
export const putInputEq         = (ch, body)   => reqWithRetry('PUT', `/inputs/${ch}/eq`, body);
export const putInputEqEnabled  = (ch, enabled)=> reqWithRetry('PUT', `/inputs/${ch}/eq/enabled`, { enabled });
export const putInputGate       = (ch, body)   => reqWithRetry('PUT', `/inputs/${ch}/gate`, body);
export const putInputCompressor = (ch, body)   => reqWithRetry('PUT', `/inputs/${ch}/compressor`, body);
export const putInputEnabled    = (ch, enabled)=> reqWithRetry('PUT', `/inputs/${ch}/enabled`, { enabled });

// ── Outputs (TX channels) ──────────────────────────────────────────────────
export const getOutputs     = ()          => get('/outputs');
export const getOutput      = (id)        => get(`/outputs/${id}`);
export const putOutput      = (id, body)  => put(`/outputs/${id}`, body);

// Output DSP
export const getOutputDsp        = (ch)          => get(`/outputs/${ch}/dsp`);
export const putOutputGain       = (ch, db)      => reqWithRetry('PUT', `/outputs/${ch}/gain`, { gain_db: db });
export const putOutputHpf        = (ch, body)    => reqWithRetry('PUT', `/outputs/${ch}/hpf`, body);
export const putOutputLpf        = (ch, body)    => reqWithRetry('PUT', `/outputs/${ch}/lpf`, body);
export const putOutputEq         = (ch, body)    => reqWithRetry('PUT', `/outputs/${ch}/eq`, body);
export const putOutputEqEnabled  = (ch, enabled) => reqWithRetry('PUT', `/outputs/${ch}/eq/enabled`, { enabled });
export const putOutputCompressor = (ch, body)    => reqWithRetry('PUT', `/outputs/${ch}/compressor`, body);
export const putOutputLimiter    = (ch, body)    => reqWithRetry('PUT', `/outputs/${ch}/limiter`, body);
export const putOutputDelay      = (ch, body)    => reqWithRetry('PUT', `/outputs/${ch}/delay`, body);
export const putOutputEnabled    = (ch, enabled) => reqWithRetry('PUT', `/outputs/${ch}/enabled`, { enabled });
export const putOutputMute       = (ch, muted)   => reqWithRetry('PUT', `/outputs/${ch}/mute`, { muted });

// ── Zones ──────────────────────────────────────────────────────────────────
export const getZones      = ()          => get('/zones');
export const postZone      = (body)      => post('/zones', body);
export const putZone       = (id, body)  => put(`/zones/${id}`, body);
export const deleteZone    = (id)        => del(`/zones/${id}`);
export const muteZone      = (txIdx)     => post(`/zones/${txIdx}/mute`);
export const unmuteZone    = (txIdx)     => post(`/zones/${txIdx}/unmute`);

// ── Routes ─────────────────────────────────────────────────────────────────
export const getRoutes     = ()                    => get('/routes');
export const postRoute     = (rx_id, tx_id, route_type) =>
  post('/routes', { rx_id, tx_id, route_type: route_type ?? 'local' });
export const deleteRoute   = (id)                  => reqWithRetry('DELETE', `/routes/${encodeURIComponent(id)}`);
export const deleteRoutesByRx = (rx_id)            => reqWithRetry('DELETE', `/routes?rx_id=${rx_id}`);
export const deleteRoutesByTx = (tx_id)            => reqWithRetry('DELETE', `/routes?tx_id=${tx_id}`);
export const deleteRoutesByZone = (zone_id)        => reqWithRetry('DELETE', `/routes?zone_id=${zone_id}`);

// ── Buses ──────────────────────────────────────────────────────────────────
export const getBuses      = ()             => get('/buses');
export const createBus     = (name)         => post('/buses', { name });
export const deleteBus     = (id)           => reqWithRetry('DELETE', `/buses/${id}`);
export const updateBus     = (id, body)     => reqWithRetry('PUT', `/buses/${id}`, body);
export const setBusRouting = (id, routing)  => reqWithRetry('PUT', `/buses/${id}/routing`, { routing });
export const setBusMatrix  = (matrix)       => reqWithRetry('PUT', '/bus-matrix', { matrix });
export const setBusGain    = (id, gain_db)  => reqWithRetry('PUT', `/buses/${id}/gain`, { gain_db });
export const setBusMute    = (id, muted)    => reqWithRetry('PUT', `/buses/${id}/mute`, { muted });

// ── Scenes ─────────────────────────────────────────────────────────────────
export const getScenes     = ()          => get('/scenes');
export const getScene      = (id)        => get(`/scenes/${id}`);
export const postScene     = (name)      => post('/scenes', { name });
export const putScene      = (id, body)  => put(`/scenes/${id}`, body);
export const deleteScene   = (id)        => del(`/scenes/${id}`);
export const loadScene     = (id)        => post(`/scenes/${id}/load`);
export const getSceneDiff  = (id)        => get(`/scenes/${id}/diff`);

// ── Metering ───────────────────────────────────────────────────────────────
export const getMetering   = ()          => get('/metering');

// ── System ─────────────────────────────────────────────────────────────────
export const getSystem          = ()     => get('/system');
export const getHealth          = ()     => get('/health');
export const putSystem          = (body) => put('/system', body);
export const putSystemConfig    = (body) => put('/system/config', body);
export const getConfigExport    = ()     => fetch(BASE + '/system/config/export', {
  headers: _token ? { 'Authorization': `Bearer ${_token}` } : {},
});
export const postAdminChannels  = (rx, tx, bus_count) => {
  const body = { rx, tx };
  if (bus_count !== undefined) body.bus_count = bus_count;
  return post('/admin/channels', body);
};
export const postAdminRestart   = ()     => post('/admin/restart', {});

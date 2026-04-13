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
  return r.json();
}

const get  = (path)        => req('GET',    path);
const post = (path, body)  => req('POST',   path, body);
const put  = (path, body)  => req('PUT',    path, body);
const del  = (path)        => req('DELETE', path);
export const patch = (path, body) => req('PUT', path, body);

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

// ── Channels (RX inputs) ───────────────────────────────────────────────────
export const getChannels     = ()          => get('/channels');
export const getChannel      = (id)        => get(`/channels/${id}`);
export const putChannel      = (id, body)  => put(`/channels/${id}`, body);

// Input DSP
export const getInputDsp        = (ch)         => get(`/inputs/${ch}/dsp`);
export const putInputGain       = (ch, db)     => put(`/inputs/${ch}/gain`, { gain_db: db });
export const putInputPolarity   = (ch, invert) => put(`/inputs/${ch}/polarity`, { invert });
export const putInputHpf        = (ch, body)   => put(`/inputs/${ch}/hpf`, body);
export const putInputLpf        = (ch, body)   => put(`/inputs/${ch}/lpf`, body);
export const putInputEq         = (ch, body)   => put(`/inputs/${ch}/eq`, body);
export const putInputEqEnabled  = (ch, enabled)=> put(`/inputs/${ch}/eq/enabled`, { enabled });
export const putInputGate       = (ch, body)   => put(`/inputs/${ch}/gate`, body);
export const putInputCompressor = (ch, body)   => put(`/inputs/${ch}/compressor`, body);
export const putInputEnabled    = (ch, enabled)=> put(`/inputs/${ch}/enabled`, { enabled });

// ── Outputs (TX channels) ──────────────────────────────────────────────────
export const getOutputs     = ()          => get('/outputs');
export const getOutput      = (id)        => get(`/outputs/${id}`);
export const putOutput      = (id, body)  => put(`/outputs/${id}`, body);

// Output DSP
export const getOutputDsp        = (ch)          => get(`/outputs/${ch}/dsp`);
export const putOutputGain       = (ch, db)      => put(`/outputs/${ch}/gain`, { gain_db: db });
export const putOutputHpf        = (ch, body)    => put(`/outputs/${ch}/hpf`, body);
export const putOutputLpf        = (ch, body)    => put(`/outputs/${ch}/lpf`, body);
export const putOutputEq         = (ch, body)    => put(`/outputs/${ch}/eq`, body);
export const putOutputEqEnabled  = (ch, enabled) => put(`/outputs/${ch}/eq/enabled`, { enabled });
export const putOutputCompressor = (ch, body)    => put(`/outputs/${ch}/compressor`, body);
export const putOutputLimiter    = (ch, body)    => put(`/outputs/${ch}/limiter`, body);
export const putOutputDelay      = (ch, body)    => put(`/outputs/${ch}/delay`, body);
export const putOutputEnabled    = (ch, enabled) => put(`/outputs/${ch}/enabled`, { enabled });
export const putOutputMute       = (ch, muted)   => put(`/outputs/${ch}/mute`, { muted });

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
export const deleteRoute   = (id)                  => del(`/routes/${encodeURIComponent(id)}`);
export const deleteRoutesByRx = (rx_id)            => del(`/routes?rx_id=${rx_id}`);
export const deleteRoutesByTx = (tx_id)            => del(`/routes?tx_id=${tx_id}`);
export const deleteRoutesByZone = (zone_id)        => del(`/routes?zone_id=${zone_id}`);

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
export const putSystemConfig    = (body) => put('/system/config', body);
export const getConfigExport    = ()     => fetch(BASE + '/system/config/export', {
  headers: _token ? { 'Authorization': `Bearer ${_token}` } : {},
});

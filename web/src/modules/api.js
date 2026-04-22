// Patchbox REST API module
// All functions return the parsed JSON response or throw on error.

const TOKEN_KEY = 'pb_token';

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

function authHeaders() {
  const token = getToken();
  const h = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function apiFetch(method, path, body) {
  const opts = { method, headers: authHeaders() };
  if (body !== undefined) opts.body = JSON.stringify(body);
  
  const res = await fetch(path, opts);
  
  if (res.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
    window.location.reload();
    throw new Error('Unauthorized');
  }
  
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${method} ${path} → ${res.status}: ${text}`);
  }
  
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

const get   = (path)        => apiFetch('GET',    path);
const post  = (path, body)  => apiFetch('POST',   path, body);
const del   = (path)        => apiFetch('DELETE', path);
const put   = (path, body)  => apiFetch('PUT',    path, body);

// Auth
export const auth = {
  login:  (username, password) => post('/api/v1/login', { username, password }),
  whoami: ()                   => get('/api/v1/whoami'),
};

// System
export const system = {
  status:  () => get('/api/v1/health'),
  logs:    () => get('/api/v1/system/logs'),
  reload:  () => post('/api/v1/system/reload'),
};

// PTP history
export const ptp = {
  history: () => get('/api/v1/ptp/history'),
};

// Channels (sources — full list)
export const channels = {
  list:   ()          => get('/api/v1/channels'),
  get:    (id)        => get(`/api/v1/channels/${id}`),
  update: (id, body)  => put(`/api/v1/channels/${id}`, body),
};

// Outputs (full list with DSP state)
export const outputs = {
  list:   () => get('/api/v1/outputs'),
};

// Zones / Channels (zone-scoped operations)
export const zones = {
  list:    ()                => get('/api/v1/config'),
  create:  (body)            => post('/api/v1/zones', body),
  delete:  (id)              => del(`/api/v1/zones/${id}`),
  setGain: (id, gain_db)     => put(`/api/v1/zones/${id}/gain`, { gain_db }),
  setMute: (id, muted)       => put(`/api/v1/zones/${id}/mute`, { muted }),
  getEq:   (id)              => get(`/api/v1/zones/${id}/eq`),
  setEq:   (id, cfg)         => put(`/api/v1/zones/${id}/eq`, cfg),
};

// Matrix routing
export const matrix = {
  get:    ()                        => get('/api/v1/config'),
  route:  (tx, rx, enabled)         => put('/api/v1/matrix', { tx, rx, enabled }),
  trace:  ()                        => get('/api/v1/routes/trace'),
  remove: (id)                      => del(`/api/v1/routes/${id}`),
};

// Buses (submix)
export const buses = {
  list:    ()              => get('/api/v1/buses'),
  create:  (name)          => post('/api/v1/buses', { name }),
  get:     (id)            => get(`/api/v1/buses/${id}`),
  update:  (id, body)      => put(`/api/v1/buses/${id}`, body),
  delete:  (id)            => del(`/api/v1/buses/${id}`),
  getDsp:  (id)            => get(`/api/v1/buses/${id}/dsp`),
  setGain: (id, gain_db)   => put(`/api/v1/buses/${id}/gain`, { gain_db }),
  setMute: (id, muted)     => put(`/api/v1/buses/${id}/mute`, { muted }),
};

// Scenes
export const scenes = {
  list:          ()              => get('/api/v1/scenes'),
  create:        (name, desc)    => post('/api/v1/scenes', { name, description: desc }),
  recall:        (name)          => post(`/api/v1/scenes/${name}/load`),
  delete:        (name)          => del(`/api/v1/scenes/${name}`),
  rename:        (name, newName, desc) => put(`/api/v1/scenes/${encodeURIComponent(name)}`, { name: newName, description: desc }),
  diff:          (name)          => get(`/api/v1/scenes/${name}/diff`),
  // A/B compare
  ab:            ()              => get('/api/v1/scenes/ab'),
  abCapture:     (slot)          => post('/api/v1/scenes/ab/capture', { slot }),
  abToggle:      ()              => post('/api/v1/scenes/ab/toggle'),
  abDiff:        ()              => get('/api/v1/scenes/ab/diff'),
  abMorph:       (duration_ms)   => post('/api/v1/scenes/ab/morph', { duration_ms }),
  abMorphCancel: ()              => post('/api/v1/scenes/ab/morph/cancel'),

};

// Input DSP
export const inputDsp = {
  get:           (ch)      => get(`/api/v1/inputs/${ch}/dsp`),
  setGain:       (ch, gain_db) => put(`/api/v1/inputs/${ch}/gain`, { gain_db }),
  setPolarity:   (ch, invert)  => put(`/api/v1/inputs/${ch}/polarity`, { invert }),
  setHpf:        (ch, cfg)     => put(`/api/v1/inputs/${ch}/hpf`, cfg),
  setLpf:        (ch, cfg)     => put(`/api/v1/inputs/${ch}/lpf`, cfg),
  setEq:         (ch, cfg)     => put(`/api/v1/inputs/${ch}/eq`, cfg),
  setGate:       (ch, cfg)     => put(`/api/v1/inputs/${ch}/gate`, cfg),
  setCompressor: (ch, cfg)     => put(`/api/v1/inputs/${ch}/compressor`, cfg),
  setAec:        (ch, cfg)     => put(`/api/v1/inputs/${ch}/aec`, cfg),
  setAutomixer:  (ch, cfg)     => put(`/api/v1/inputs/${ch}/automixer`, cfg),
  setAfs:        (ch, cfg)     => put(`/api/v1/inputs/${ch}/afs`, cfg),
  setDeq:        (ch, cfg)     => put(`/api/v1/inputs/${ch}/deq`, cfg),
};

// Output DSP
export const outputDsp = {
  get:           (ch)      => get(`/api/v1/outputs/${ch}/dsp`),
  setGain:       (ch, gain_db) => put(`/api/v1/outputs/${ch}/gain`, { gain_db }),
  setHpf:        (ch, cfg)     => put(`/api/v1/outputs/${ch}/hpf`, cfg),
  setLpf:        (ch, cfg)     => put(`/api/v1/outputs/${ch}/lpf`, cfg),
  setEq:         (ch, cfg)     => put(`/api/v1/outputs/${ch}/eq`, cfg),
  setCompressor: (ch, cfg)     => put(`/api/v1/outputs/${ch}/compressor`, cfg),
  setLimiter:    (ch, cfg)     => put(`/api/v1/outputs/${ch}/limiter`, cfg),
  setDelay:      (ch, cfg)     => put(`/api/v1/outputs/${ch}/delay`, cfg),
  setDeq:        (ch, cfg)     => put(`/api/v1/outputs/${ch}/deq`, cfg),
  setDither:     (ch, cfg)     => put(`/api/v1/outputs/${ch}/dither`, cfg),
  getDucker:     (ch)          => get(`/api/v1/outputs/${ch}/dsp/ducker`),
  setDucker:     (ch, cfg)     => put(`/api/v1/outputs/${ch}/dsp/ducker`, cfg),
  getLufs:       (ch)          => get(`/api/v1/outputs/${ch}/dsp/lufs`),
};

// DSP Presets
export const presets = {
  list:   ()                    => get('/api/v1/presets'),
  save:   (name, block, params) => post(`/api/v1/presets/${encodeURIComponent(name)}`, { block, params }),
  recall: (name)                => post(`/api/v1/presets/${encodeURIComponent(name)}/recall`),
  delete: (name, block)         => del(`/api/v1/presets/${encodeURIComponent(name)}?block=${encodeURIComponent(block)}`),
};

// Convenience: toast-friendly error extraction
export function apiErrorMessage(err) {
  return err?.message ?? String(err);
}

// Default export for convenience
export default { auth, system, ptp, channels, outputs, zones, matrix, buses, scenes, inputDsp, outputDsp, presets, apiErrorMessage };

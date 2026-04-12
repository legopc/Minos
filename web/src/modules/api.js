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
const patch = (path, body)  => apiFetch('PATCH',  path, body);

// Auth
export const auth = {
  login: (username, password) => post('/api/v1/login', { username, password }),
};

// System
export const system = {
  status: () => get('/api/v1/health'),
};

// Zones / Channels
export const zones = {
  list:         ()              => get('/api/v1/config'),
  setGain:      (tx, db)        => put(`/api/v1/gain/output`, { channel: tx, db }),
  setMute:      (tx, muted)     => muted 
    ? post(`/api/v1/zones/${tx}/mute`)
    : post(`/api/v1/zones/${tx}/unmute`),
  getEq:        (tx)            => get(`/api/v1/zones/${tx}/eq`),
  setEq:        (tx, cfg)       => put(`/api/v1/zones/${tx}/eq`, { band: cfg.band, freq_hz: cfg.freq_hz, gain_db: cfg.gain_db, q: cfg.q }),
  setEqEnabled: (tx, enabled)   => put(`/api/v1/zones/${tx}/eq/enabled`, { enabled }),
  getLimiter:   (tx)            => get(`/api/v1/zones/${tx}/limiter`),
  setLimiter:   (tx, cfg)       => put(`/api/v1/zones/${tx}/limiter`, { threshold_db: cfg.threshold_db, attack_ms: cfg.attack_ms, release_ms: cfg.release_ms }),
  setLimiterEnabled: (tx, enabled) => put(`/api/v1/zones/${tx}/limiter/enabled`, { enabled }),
};

// Matrix
export const matrix = {
  get:    ()              => get('/api/v1/config'),
  route:  (tx, rx, enabled) => put('/api/v1/matrix', { tx, rx, enabled }),
};

// Scenes
export const scenes = {
  list:   ()     => get('/api/v1/scenes'),
  create: (name, description) => post('/api/v1/scenes', { name, description }),
  recall: (name) => post(`/api/v1/scenes/${name}/load`),
  delete: (name) => del(`/api/v1/scenes/${name}`),
};

// Input (channels/sources) — Sprint 2 stubs
export const inputDsp = {
  get:            (ch) => get(`/api/v1/inputs/${ch}/dsp`),
  setGain:        (ch, gain_db) => put(`/api/v1/inputs/${ch}/gain`, { gain_db }),
  setPolarity:    (ch, invert)  => put(`/api/v1/inputs/${ch}/polarity`, { invert }),
  setHpf:         (ch, cfg)     => put(`/api/v1/inputs/${ch}/hpf`, cfg),
  setLpf:         (ch, cfg)     => put(`/api/v1/inputs/${ch}/lpf`, cfg),
  setEq:          (ch, cfg)     => put(`/api/v1/inputs/${ch}/eq`, cfg),
  setGate:        (ch, cfg)     => put(`/api/v1/inputs/${ch}/gate`, cfg),
  setCompressor:  (ch, cfg)     => put(`/api/v1/inputs/${ch}/compressor`, cfg),
};

// Output DSP (extends existing zones) — Sprint 2 stubs
export const outputDsp = {
  get:            (ch) => get(`/api/v1/outputs/${ch}/dsp`),
  setGain:        (ch, gain_db) => put(`/api/v1/outputs/${ch}/gain`, { gain_db }),
  setHpf:         (ch, cfg)     => put(`/api/v1/outputs/${ch}/hpf`, cfg),
  setLpf:         (ch, cfg)     => put(`/api/v1/outputs/${ch}/lpf`, cfg),
  setEq:          (ch, cfg)     => put(`/api/v1/outputs/${ch}/eq`, cfg),
  setCompressor:  (ch, cfg)     => put(`/api/v1/outputs/${ch}/compressor`, cfg),
  setLimiter:     (ch, cfg)     => put(`/api/v1/outputs/${ch}/limiter`, cfg),
  setDelay:       (ch, cfg)     => put(`/api/v1/outputs/${ch}/delay`, cfg),
};

// Convenience: toast-friendly error extraction
export function apiErrorMessage(err) {
  return err?.message ?? String(err);
}

// Default export for convenience
export default { auth, system, zones, matrix, scenes, inputDsp, outputDsp, apiErrorMessage };

'use strict';

let cfg = null;
let zoneIdx = null;
let ws = null;
let wsTimer = null;

// ── URL parsing ──────────────────────────────────────────────────────────
function getZoneName() {
  const m = location.pathname.match(/\/zone\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// ── Utilities ────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

function toast(msg, type = 'ok') {
  const c = el('toast-container');
  const d = document.createElement('div');
  d.className = `toast ${type}`;
  d.textContent = msg;
  c.appendChild(d);
  setTimeout(() => d.remove(), 3000);
}

// ── Auth ─────────────────────────────────────────────────────────────────
function showLogin(onSuccess) {
  el('login-overlay').hidden = false;
  const doLogin = async () => {
    const user = el('z-login-username').value;
    const pass = el('z-login-password').value;
    el('z-login-error').textContent = '';
    try {
      const r = await fetch('/api/v1/login', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({username: user, password: pass})
      });
      if (!r.ok) throw new Error('Invalid credentials');
      const {token} = await r.json();
      sessionStorage.setItem('pb_token', token);
      el('login-overlay').hidden = true;
      onSuccess();
    } catch (err) {
      el('z-login-error').textContent = err.message;
    }
  };
  el('z-login-btn').onclick = doLogin;
  el('z-login-password').onkeydown = e => { if (e.key === 'Enter') doLogin(); };
}

async function apiCall(method, path, body = null) {
  const opts = {method, headers: {'Content-Type':'application/json'}};
  const token = sessionStorage.getItem('pb_token');
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  if (r.status === 401) {
    return new Promise(resolve => showLogin(() => apiCall(method, path, body).then(resolve)));
  }
  return r;
}

// ── Render ────────────────────────────────────────────────────────────────
function renderZone() {
  const zoneName = getZoneName();
  if (!zoneName) { document.body.textContent = 'Zone not found'; return; }

  zoneIdx = cfg.zones.indexOf(zoneName);
  if (zoneIdx < 0) { el('zone-title').textContent = 'Zone not found'; return; }

  el('zone-title').textContent = cfg.zones[zoneIdx];
  document.title = `${cfg.zones[zoneIdx]} — Patchbox`;

  // Source routing list
  const list = el('source-list');
  list.innerHTML = '';
  cfg.sources.forEach((srcName, rxIdx) => {
    const isActive = !!(cfg.matrix[zoneIdx] && cfg.matrix[zoneIdx][rxIdx]);
    const btn = document.createElement('button');
    btn.className = 'zone-source-btn' + (isActive ? ' active' : '');
    btn.dataset.rx = rxIdx;

    const led = document.createElement('span');
    led.className = 'zone-source-led';

    const name = document.createElement('span');
    name.className = 'zone-source-name';
    name.textContent = srcName;

    btn.append(led, name);
    btn.addEventListener('click', async () => {
      const wasActive = btn.classList.contains('active');
      btn.classList.toggle('active', !wasActive);
      const r = await apiCall('PUT', '/api/v1/matrix', {tx: zoneIdx, rx: rxIdx, enabled: !wasActive});
      if (r && r.ok) {
        cfg.matrix[zoneIdx][rxIdx] = !wasActive;
        toast(`${srcName} ${!wasActive ? 'connected' : 'disconnected'}`, !wasActive ? 'ok' : 'warn');
      } else {
        btn.classList.toggle('active', wasActive); // revert
        toast('Routing failed', 'err');
      }
    });

    list.appendChild(btn);
  });

  // Output fader
  const fader = el('output-fader');
  const dbEl = el('output-db');
  fader.value = cfg.output_gain_db[zoneIdx];
  dbEl.textContent = `${cfg.output_gain_db[zoneIdx].toFixed(1)} dB`;

  let gainTimer = null;
  fader.oninput = () => {
    const db = parseFloat(fader.value);
    dbEl.textContent = `${db.toFixed(1)} dB`;
    clearTimeout(gainTimer);
    gainTimer = setTimeout(async () => {
      await apiCall('PUT', '/api/v1/gain/output', {channel: zoneIdx, db});
    }, 300);
  };

  // Mute button
  updateMuteBtn();
  el('mute-btn').onclick = async () => {
    const isMuted = cfg.output_muted[zoneIdx];
    const path = isMuted ? 'unmute' : 'mute';
    const r = await apiCall('POST', `/api/v1/zones/${zoneIdx}/${path}`);
    if (r && r.ok) {
      cfg.output_muted[zoneIdx] = !isMuted;
      updateMuteBtn();
      toast(!isMuted ? 'Zone muted' : 'Zone live', !isMuted ? 'warn' : 'ok');
    }
  };
}

function updateMuteBtn() {
  const btn = el('mute-btn');
  const muted = cfg?.output_muted[zoneIdx];
  btn.classList.toggle('muted', !!muted);
  btn.textContent = muted ? 'UNMUTE' : 'MUTE';
}

// ── WebSocket ─────────────────────────────────────────────────────────────
function initWS() {
  if (ws) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);

  ws.onopen = () => {
    el('ws-dot')?.classList.add('connected');
    const lbl = el('ws-label'); if (lbl) lbl.textContent = 'live';
    if (wsTimer) { clearTimeout(wsTimer); wsTimer = null; }
  };
  ws.onclose = ws.onerror = () => {
    el('ws-dot')?.classList.remove('connected');
    const lbl = el('ws-label'); if (lbl) lbl.textContent = 'connecting…';
    ws = null;
    if (!wsTimer) wsTimer = setTimeout(initWS, 3000);
  };
  ws.onmessage = ({data}) => {
    try {
      const msg = JSON.parse(data);
      const {tx_rms = []} = msg;
      if (zoneIdx !== null && tx_rms[zoneIdx] !== undefined) {
        const fill = el('output-meter');
        if (fill) {
          const rms = tx_rms[zoneIdx];
          fill.style.width = `${Math.min(rms * 100, 100)}%`;
          fill.className = 'meter-fill' + (rms > 0.9 ? ' clip' : rms > 0.7 ? ' hot' : '');
        }
      }
      if (msg.gr_db && msg.gr_db[zoneIdx] !== undefined) {
        updateGrMeter(msg.gr_db[zoneIdx]);
      }
    } catch {}
  };
}

// ── EQ Controls ────────────────────────────────────────────────────────────
const BANDS = [
  { label: 'Low', defaultFreq: 200, defaultGain: 0, defaultQ: 1.0 },
  { label: 'Mid', defaultFreq: 1000, defaultGain: 0, defaultQ: 1.0 },
  { label: 'High', defaultFreq: 5000, defaultGain: 0, defaultQ: 1.0 },
];

function renderEqBands() {
  const container = el('eq-bands');
  container.innerHTML = '';
  BANDS.forEach((b, i) => {
    container.innerHTML += `
      <div class="band" id="band-${i}">
        <label>${b.label} Freq <span id="eq-freq-val-${i}">200 Hz</span>
          <input type="range" id="eq-freq-${i}" min="20" max="20000" step="10" value="${b.defaultFreq}">
        </label>
        <label>Gain <span id="eq-gain-val-${i}">0.0 dB</span>
          <input type="range" id="eq-gain-${i}" min="-24" max="24" step="0.5" value="${b.defaultGain}">
        </label>
        <label>Q <span id="eq-q-val-${i}">1.0</span>
          <input type="range" id="eq-q-${i}" min="0.1" max="10" step="0.1" value="${b.defaultQ}">
        </label>
      </div>`;
  });
  BANDS.forEach((_, i) => {
    ['freq', 'gain', 'q'].forEach(param => {
      el(`eq-${param}-${i}`).addEventListener('input', (e) => {
        el(`eq-${param}-val-${i}`).textContent =
          param === 'freq' ? `${e.target.value} Hz` :
          param === 'gain' ? `${parseFloat(e.target.value).toFixed(1)} dB` :
          parseFloat(e.target.value).toFixed(1);
      });
      el(`eq-${param}-${i}`).addEventListener('change', () => sendEqBand(i));
    });
  });
}

async function sendEqBand(i) {
  const freq = parseFloat(el(`eq-freq-${i}`).value);
  const gain = parseFloat(el(`eq-gain-${i}`).value);
  const q = parseFloat(el(`eq-q-${i}`).value);
  await apiCall('PUT', `/api/v1/zones/${zoneIdx}/eq`, { band: i, freq_hz: freq, gain_db: gain, q });
}

async function loadEq() {
  try {
    const data = await apiCall('GET', `/api/v1/zones/${zoneIdx}/eq`).then(r => r.json());
    data.bands.forEach((b, i) => {
      el(`eq-freq-${i}`).value = b.freq_hz;
      el(`eq-gain-${i}`).value = b.gain_db;
      el(`eq-q-${i}`).value = b.q;
      el(`eq-freq-val-${i}`).textContent = `${b.freq_hz} Hz`;
      el(`eq-gain-val-${i}`).textContent = `${b.gain_db.toFixed(1)} dB`;
      el(`eq-q-val-${i}`).textContent = b.q.toFixed(1);
    });
    el('eq-enabled').checked = data.enabled;
  } catch (err) {
    console.warn('Could not load EQ settings', err);
  }
}

// ── Limiter Controls ───────────────────────────────────────────────────────
function initLimiterControls() {
  const sliders = [
    { id: 'lim-threshold', valId: 'lim-threshold-val', suffix: ' dBFS', field: 'threshold_db' },
    { id: 'lim-attack', valId: 'lim-attack-val', suffix: ' ms', field: 'attack_ms' },
    { id: 'lim-release', valId: 'lim-release-val', suffix: ' ms', field: 'release_ms' },
  ];
  sliders.forEach(s => {
    el(s.id).addEventListener('input', (e) => {
      el(s.valId).textContent = `${parseFloat(e.target.value).toFixed(1)}${s.suffix}`;
    });
    el(s.id).addEventListener('change', sendLimiter);
  });
  el('lim-enabled').addEventListener('change', async (e) => {
    await apiCall('PUT', `/api/v1/zones/${zoneIdx}/limiter/enabled`, { enabled: e.target.checked });
  });
}

async function sendLimiter() {
  await apiCall('PUT', `/api/v1/zones/${zoneIdx}/limiter`, {
    threshold_db: parseFloat(el('lim-threshold').value),
    attack_ms: parseFloat(el('lim-attack').value),
    release_ms: parseFloat(el('lim-release').value),
  });
}

async function loadLimiter() {
  try {
    const data = await apiCall('GET', `/api/v1/zones/${zoneIdx}/limiter`).then(r => r.json());
    el('lim-threshold').value = data.threshold_db;
    el('lim-attack').value = data.attack_ms;
    el('lim-release').value = data.release_ms;
    el('lim-threshold-val').textContent = `${data.threshold_db.toFixed(1)} dBFS`;
    el('lim-attack-val').textContent = `${data.attack_ms.toFixed(1)} ms`;
    el('lim-release-val').textContent = `${data.release_ms.toFixed(1)} ms`;
    el('lim-enabled').checked = data.enabled;
  } catch (err) {
    console.warn('Could not load Limiter settings', err);
  }
}

// ── GR Meter ───────────────────────────────────────────────────────────────
function updateGrMeter(gr_db) {
  el('gr-db').textContent = `${gr_db.toFixed(1)} dB`;
  const pct = Math.min(100, Math.max(0, -gr_db * 5));
  el('gr-bar').style.width = `${pct}%`;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  try {
    cfg = await fetch('/api/v1/config').then(r => r.json());
    renderZone();
    renderEqBands();
    loadEq();
    initLimiterControls();
    loadLimiter();
    el('eq-enabled').addEventListener('change', async (e) => {
      await apiCall('PUT', `/api/v1/zones/${zoneIdx}/eq/enabled`, { enabled: e.target.checked });
    });
    initWS();
  } catch (err) {
    el('zone-title').textContent = 'Error loading config';
    console.error(err);
  }
});

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
      const {tx_rms = []} = JSON.parse(data);
      if (zoneIdx !== null && tx_rms[zoneIdx] !== undefined) {
        const fill = el('output-meter');
        if (fill) {
          const rms = tx_rms[zoneIdx];
          fill.style.width = `${Math.min(rms * 100, 100)}%`;
          fill.className = 'meter-fill' + (rms > 0.9 ? ' clip' : rms > 0.7 ? ' hot' : '');
        }
      }
    } catch {}
  };
}

// ── Bootstrap ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  try {
    cfg = await fetch('/api/v1/config').then(r => r.json());
    renderZone();
    initWS();
  } catch (err) {
    el('zone-title').textContent = 'Error loading config';
    console.error(err);
  }
});

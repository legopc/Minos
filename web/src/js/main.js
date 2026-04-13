// main.js — app init, tab routing, status bar, auth gate

import * as api   from './api.js';
import * as st    from './state.js';
import { initWs } from './ws.js';
import { toast as _toast } from './toast.js';

// ── Toast system ───────────────────────────────────────────────────────────
export function toast(msg, isError = false) {
  _toast(msg, isError);
}

// ── Tab switching ──────────────────────────────────────────────────────────
let _tabModules = {};

async function loadTabModule(tab) {
  if (_tabModules[tab]) return _tabModules[tab];
  try {
    let mod;
    if (tab === 'matrix')  mod = await import('./matrix.js');
    if (tab === 'mixer')   mod = await import('./mixer.js');
    if (tab === 'scenes')  mod = await import('./scenes.js');
    if (tab === 'zones')   mod = await import('./zones.js');
    if (tab === 'dante')   mod = await import('./dante.js');
    if (tab === 'system')  mod = await import('./system.js');
    _tabModules[tab] = mod;
    return mod;
  } catch (e) {
    return null;
  }
}

async function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-content').forEach(el => {
    el.classList.toggle('active', el.id === `tab-${tab}`);
  });
  st.setActiveTab(tab);
  const mod = await loadTabModule(tab);
  if (mod?.render) {
    const el = document.getElementById(`tab-${tab}`);
    if (el) mod.render(el);
  }
}

// ── Status bar ─────────────────────────────────────────────────────────────
export function updateStatusBar() {
  const sys = st.state.system;
  const ptp = st.state.ptp;

  const ptpEl = document.getElementById('sb-ptp');
  if (ptpEl) {
    ptpEl.className = 'status-item ' + (ptp.locked ? 'ptp-locked' : 'ptp-unlocked');
    ptpEl.innerHTML = `<span class="dot ${ptp.locked ? 'dot-live' : 'dot-error'}"></span>PTP ${ptp.locked ? 'LOCKED' : 'UNLOCKED'}`;
  }

  const rateEl = document.getElementById('sb-rate');
  if (rateEl && sys.sample_rate) {
    rateEl.textContent = (sys.sample_rate / 1000).toFixed(1) + ' kHz';
  }

  const rxEl = document.getElementById('sb-rx');
  if (rxEl) rxEl.textContent = (sys.rx_count ?? st.state.channels.size) + ' RX';

  const txEl = document.getElementById('sb-tx');
  if (txEl) txEl.textContent = (sys.tx_count ?? st.state.outputs.size) + ' TX';

  const zonesEl = document.getElementById('sb-zones');
  if (zonesEl) zonesEl.textContent = (sys.zone_count ?? st.state.zones.size) + ' zones';

  const devEl = document.getElementById('tb-device');
  if (devEl && sys.hostname) devEl.textContent = sys.hostname;
}

export function updateWsStatus(state) {
  const el = document.getElementById('sb-ws');
  if (!el) return;
  const on = state === 'connected';
  el.innerHTML = `<span class="dot ${on ? 'dot-live' : 'dot-offline'}"></span>WS`;
}

// ── Login flow ─────────────────────────────────────────────────────────────
function showLogin() {
  const lp = document.getElementById('login-page');
  if (lp) lp.style.display = 'flex';
  const shell = document.getElementById('app-shell');
  if (shell) shell.style.visibility = 'hidden';
}

function hideLogin() {
  const lp = document.getElementById('login-page');
  if (lp) lp.style.display = 'none';
  const shell = document.getElementById('app-shell');
  if (shell) shell.style.visibility = 'visible';
}

function setupLogin() {
  const btn   = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  const user  = document.getElementById('login-user');
  const pass  = document.getElementById('login-pass');

  async function doLogin() {
    errEl.textContent = '';
    try {
      const res = await api.login(user.value.trim(), pass.value);
      api.setToken(res.token);
      st.setUserRole(res.role ?? 'admin');
      hideLogin();
      await loadAll();
    } catch (e) {
      errEl.textContent = 'Login failed. Check credentials.';
    }
  }

  btn.addEventListener('click', doLogin);
  pass.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
}

// ── Bootstrap all data ─────────────────────────────────────────────────────
async function loadAll() {
  try {
    const [channels, outputs, zones, routes, scenes, system] = await Promise.all([
      api.getChannels(),
      api.getOutputs(),
      api.getZones(),
      api.getRoutes(),
      api.getScenes(),
      api.getSystem(),
    ]);

    channels.forEach(c => st.setChannel(c));
    outputs.forEach(o  => st.setOutput(o));
    zones.forEach(z    => st.setZone(z));
    routes.forEach(r   => st.setRoute(r));
    st.setScenes(Array.isArray(scenes) ? scenes : (scenes.scenes ?? []));
    if (scenes.active) st.setActiveScene(scenes.active);
    st.setSystem(system);
    if (system.ptp_locked !== undefined) {
      st.setPtp(system.ptp_locked, system.ptp_offset_ns ?? 0);
    }

    updateStatusBar();

    // Render active tab
    const tab = st.state.activeTab;
    const mod = await loadTabModule(tab);
    if (mod?.render) {
      const el = document.getElementById(`tab-${tab}`);
      if (el) mod.render(el);
    }

    // Start WebSocket
    initWs();

  } catch (e) {
    if (e.message !== '401') {
      toast('Failed to load configuration: ' + e.message, true);
    }
  }
}

// ── Entry point ────────────────────────────────────────────────────────────
window.addEventListener('pb:unauthorized', () => showLogin());
window.addEventListener('pb:status-update', () => updateStatusBar());
window.addEventListener('pb:ws-state', e => updateWsStatus(e.detail));
window.addEventListener('pb:metering', e => {
  // Forward to matrix if it's been rendered
  import('./matrix.js').then(m => m.updateMetering?.(e.detail.rx)).catch(() => {});
});

document.addEventListener('DOMContentLoaded', async () => {
  setupLogin();

  // Wire tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Auth check — try a lightweight call; if 401, go to login
  if (!api.hasToken()) {
    showLogin();
    return;
  }

  try {
    await api.getHealth();
    hideLogin();
    await loadAll();
  } catch (e) {
    if (e.message === '401') {
      showLogin();
    } else {
      // Server might not require auth — try loading anyway
      hideLogin();
      await loadAll();
    }
  }
});

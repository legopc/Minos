// main.js — app init, tab routing, status bar, auth gate

import * as api      from './api.js';
import * as st       from './state.js';
import * as shortcuts from './shortcuts.js';
import { initWs }    from './ws.js';
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
    let ptpClass, ptpDot, ptpText;
    if (ptp.locked === true) {
      ptpClass = 'ptp-locked'; ptpDot = 'dot-live'; ptpText = 'PTP LOCKED';
    } else if (ptp.locked === false) {
      ptpClass = 'ptp-warn'; ptpDot = 'dot-warn'; ptpText = 'PTP —';
    } else {
      ptpClass = ''; ptpDot = 'dot-offline'; ptpText = 'PTP —';
    }
    ptpEl.className = 'status-item ' + ptpClass;
    ptpEl.innerHTML = `<span class="dot ${ptpDot}"></span>${ptpText}`;
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

  const dropsEl = document.getElementById('sb-drops');
  if (dropsEl) {
    const drops = sys.audio_drops ?? 0;
    dropsEl.textContent = `Drops: ${drops}`;
    dropsEl.title = `Audio sample drops since last restart${sys.uptime_s ? ' · Uptime: ' + _fmtUptime(sys.uptime_s) : ''}`;
    dropsEl.className = 'status-item' + (drops > 0 ? ' drops-warn' : '');
  }
}

export function updateWsStatus(state) {
  const el = document.getElementById('sb-ws');
  if (!el) return;
  const on = state === 'connected';
  el.innerHTML = `<span class="dot ${on ? 'dot-live' : 'dot-offline'}"></span>WS`;
}

function _fmtUptime(s) {
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}

// Poll /api/v1/system every 30s to keep audio_drops + uptime fresh
let _sysPollTimer = null;
function _startSystemPoll() {
  if (_sysPollTimer) return;
  _sysPollTimer = setInterval(async () => {
    try {
      const system = await api.getSystem();
      st.setSystem(system);
      if (system.ptp_locked !== undefined) st.setPtp(system.ptp_locked, system.ptp_offset_ns ?? 0);
      updateStatusBar();
    } catch (_) {}
  }, 30000);
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
      api.scheduleRefresh(res.token);
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
    const [channels, outputs, zones, routes, scenes, system, buses, matrixState, vcaGroups, stereoLinks, gens, amGroups] = await Promise.all([
      api.getChannels(),
      api.getOutputs(),
      api.getZones(),
      api.getRoutes(),
      api.getScenes(),
      api.getSystem(),
      api.getBuses(),
      api.getMatrix().catch(() => null),
      api.getVcaGroups().catch(() => []),
      api.getStereoLinks().catch(() => []),
      api.getGenerators().catch(() => ({ signal_generators: [], generator_bus_matrix: [] })),
      api.getAutomixerGroups().catch(() => []),
    ]);

    channels.forEach(c => st.setChannel(c));
    outputs.forEach(o  => st.setOutput(o));
    zones.forEach(z    => st.setZone(z));
    routes.forEach(r   => st.setRoute(r));
    buses.forEach(b    => st.setBus(b));
    st.setScenes(Array.isArray(scenes) ? scenes : (scenes.scenes ?? []));
    if (scenes.active) st.setActiveScene(scenes.active);
    st.setSystem(system);
    if (system.ptp_locked !== undefined) {
      st.setPtp(system.ptp_locked, system.ptp_offset_ns ?? 0);
    }
    st.setVcaGroups(Array.isArray(vcaGroups) ? vcaGroups : (vcaGroups?.vca_groups ?? []));
    st.setStereoLinks(Array.isArray(stereoLinks) ? stereoLinks : (stereoLinks?.stereo_links ?? []));
    st.setGenerators(gens.signal_generators ?? []);
    st.setGeneratorMatrix(gens.generator_bus_matrix ?? []);
    st.setAutomixerGroups(Array.isArray(amGroups) ? amGroups : (amGroups?.automixer_groups ?? []));

    // Build busMatrix from routes with route_type === 'bus'
    const busMatrix = {};
    routes.forEach(r => {
      if (r.route_type === 'bus') {
        if (!busMatrix[r.tx_id]) busMatrix[r.tx_id] = {};
        busMatrix[r.tx_id][r.rx_id] = true;
      }
    });
    st.setBusMatrix(busMatrix);

    // Store matrix gain state for crosspoint scroll-wheel control
    if (matrixState?.gain_db) st.setMatrixGain(matrixState.gain_db);

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
    _startSystemPoll();

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

// Offline banner with grace period
let _offlineTimer = null;
window.addEventListener('pb:ws-state', (e) => {
  if (e.detail === 'connected') {
    clearTimeout(_offlineTimer);
    _offlineTimer = null;
    document.body.classList.remove('offline');
    const banner = document.getElementById('offline-banner');
    if (banner) { banner.hidden = true; banner.style.display = 'none'; }
  } else {
    if (!_offlineTimer) {
      _offlineTimer = setTimeout(() => {
        document.body.classList.add('offline');
        const banner = document.getElementById('offline-banner');
        if (banner) { banner.hidden = false; banner.style.display = 'block'; }
      }, 3000);
    }
  }
});

window.addEventListener('pb:metering', e => {
  // Forward to matrix if it's been rendered
  import('./matrix.js').then(m => m.updateMetering?.(e.detail.rx, e.detail.tx)).catch(() => {});
  // Forward to mixer if it's been rendered (include bus metering)
  import('./mixer.js').then(m => m.updateMetering?.(e.detail.rx, e.detail.tx, e.detail.bus)).catch(() => {});
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

  // Re-schedule refresh for any token already in localStorage
  api.scheduleRefresh(localStorage.getItem('pb_token') ?? '');

  try {
    await api.getHealth();
    hideLogin();
    await loadAll();
    shortcuts.setupShortcuts();

    window.addEventListener('shortcut:close-panels', () => {
      import('./panels.js').then(m => m.closeAllPanels?.());
    });

    window.addEventListener('shortcut:load-scene', (e) => {
      const favs = (st.state.scenes ?? []).filter(s => s.is_favourite);
      const scene = favs[e.detail.index];
      if (scene) api.loadScene(scene.id).catch(err => toast(err.message, true));
    });
  } catch (e) {
    if (e.message === '401') {
      showLogin();
    } else {
      // Server might not require auth — try loading anyway
      hideLogin();
      await loadAll();
      shortcuts.setupShortcuts();

      window.addEventListener('shortcut:close-panels', () => {
        import('./panels.js').then(m => m.closeAllPanels?.());
      });

      window.addEventListener('shortcut:load-scene', (e) => {
        const favs = (st.state.scenes ?? []).filter(s => s.is_favourite);
        const scene = favs[e.detail.index];
        if (scene) api.loadScene(scene.id).catch(err => toast(err.message, true));
      });
    }
  }
});

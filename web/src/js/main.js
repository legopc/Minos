// main.js — app init, tab routing, status bar, auth gate

import * as api      from './api.js';
import * as st       from './state.js';
import * as shortcuts from './shortcuts.js';
import { undo }      from './undo.js';
import { initWs }    from './ws.js';
import { toast as _toast } from './toast.js';

// ── Toast system ───────────────────────────────────────────────────────────
export function toast(msg, isError = false) {
  _toast(msg, isError);
}

// ── Tab switching ──────────────────────────────────────────────────────────
let _tabModules = {};
const ALL_TABS = ['matrix', 'mixer', 'scenes', 'zones', 'dante', 'system'];
const ROLE_TABS = {
  admin: ALL_TABS,
  operator: ['matrix', 'mixer', 'scenes', 'zones', 'dante'],
  viewer: ['matrix', 'mixer', 'zones'],
};

function _normaliseRole(role) {
  const value = String(role ?? '').trim().toLowerCase();
  if (value === 'admin') return 'admin';
  if (value === 'operator' || value === 'bar_staff') return 'operator';
  return 'viewer';
}

function _parseTokenClaims(token) {
  if (!token) return null;
  try {
    const [, payload] = String(token).split('.');
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch (_) {
    return null;
  }
}

function _applyAuthClaims(token, fallbackRole = 'viewer') {
  const claims = _parseTokenClaims(token) ?? {};
  st.setUserName(claims.sub ?? '');
  st.setUserRole(_normaliseRole(claims.role ?? fallbackRole));
  st.setUserZone(claims.zone ?? null);
  return claims;
}

function _parseRequestedZoneId() {
  const pathMatch = window.location.pathname.match(/^\/zone\/([^/]+)\/?$/);
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);

  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get('zone');
  if (fromQuery) return fromQuery;

  const hash = url.hash.replace(/^#/, '');
  const hashMatch = hash.match(/^zone\/(.+)$/);
  return hashMatch?.[1] ? decodeURIComponent(hashMatch[1]) : null;
}

function _setZoneQuery(zoneId) {
  const pathMatch = window.location.pathname.match(/^\/zone\/([^/]+)\/?$/);
  if (pathMatch) return;
  const url = new URL(window.location.href);
  if (zoneId) url.searchParams.set('zone', zoneId);
  else url.searchParams.delete('zone');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function _buildShellContext() {
  const role = _normaliseRole(st.state.userRole);
  const userZone = st.state.userZone || null;
  const requestedZoneId = _parseRequestedZoneId();
  const desiredZoneId = userZone || requestedZoneId || null;
  let focusedZoneId = desiredZoneId;

  if (focusedZoneId && !st.state.zones.has(focusedZoneId)) {
    focusedZoneId = null;
  }

  const allowedTabs = userZone ? ['zones'] : (ROLE_TABS[role] ?? ROLE_TABS.viewer);
  const shellMode = userZone ? 'zone_locked' : (focusedZoneId ? 'zone_focused' : 'full');
  return {
    role,
    userZone,
    requestedZoneId,
    focusedZoneId,
    missingZoneId: desiredZoneId && !focusedZoneId ? desiredZoneId : null,
    allowedTabs,
    shellMode,
  };
}

function _updateShellNote(ctx) {
  const noteEl = document.getElementById('shell-note');
  if (!noteEl) return;

  let message = '';
  if (ctx.userZone) {
    const mismatch = ctx.requestedZoneId && ctx.requestedZoneId !== ctx.userZone;
    message = ctx.missingZoneId
      ? `Zone shell requested ${ctx.missingZoneId}, but that zone is unavailable. UX-only until backend enforcement lands.`
      : mismatch
      ? `Zone shell pinned to ${ctx.userZone}. Requested deep link ${ctx.requestedZoneId} was ignored. UX-only until backend enforcement lands.`
      : `Zone-focused shell for ${ctx.userZone}. UX convenience only; backend zone enforcement remains required.`;
  } else if (ctx.missingZoneId) {
    message = `Requested zone ${ctx.missingZoneId} is unavailable. This shell flow is not a security boundary; backend enforcement is still required.`;
  } else if (ctx.requestedZoneId) {
    message = `Deep-linked zone focus for ${ctx.requestedZoneId}. This shell flow is not a security boundary; backend enforcement is still required.`;
  }

  noteEl.hidden = !message;
  noteEl.textContent = message;
}

function _updateUserBadge(ctx) {
  const userEl = document.getElementById('tb-user');
  if (!userEl) return;
  const parts = [];
  if (st.state.userName) parts.push(st.state.userName);
  parts.push(ctx.role);
  if (ctx.userZone) parts.push(ctx.userZone);
  userEl.textContent = parts.join(' · ');
}

function _applyTabVisibility(allowedTabs) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    const allowed = allowedTabs.includes(btn.dataset.tab);
    btn.hidden = !allowed;
    btn.disabled = !allowed;
    btn.setAttribute('aria-hidden', allowed ? 'false' : 'true');
    const panel = document.getElementById(`tab-${btn.dataset.tab}`);
    if (panel) panel.hidden = !allowed;
  });
}

function _selectorEscape(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function _applyZonePanelChrome(lockFocus) {
  const backBtn = document.querySelector('.zone-panel-back-btn');
  if (backBtn) backBtn.hidden = !!lockFocus;
}

function _openFocusedZone(zoneId, lockFocus) {
  if (!zoneId || st.state.activeTab !== 'zones') return;

  let attempts = 0;
  const openCard = () => {
    attempts += 1;
    const selector = `.zone-card[data-zone-id="${_selectorEscape(zoneId)}"] .zone-card-name-btn`;
    const trigger = document.querySelector(selector);
    if (!trigger) {
      if (attempts < 12) {
        window.setTimeout(openCard, 60);
      } else {
        toast(`Zone ${zoneId} not found.`, true);
      }
      return;
    }
    trigger.click();
    window.setTimeout(() => _applyZonePanelChrome(lockFocus), 0);
  };

  window.requestAnimationFrame(openCard);
}

function _syncShellChrome() {
  const ctx = _buildShellContext();
  st.setAllowedTabs(ctx.allowedTabs);
  st.setShellMode(ctx.shellMode);
  st.setFocusedZone(ctx.focusedZoneId);
  document.body.dataset.shellMode = ctx.shellMode;
  _applyTabVisibility(ctx.allowedTabs);
  _updateUserBadge(ctx);
  _updateShellNote(ctx);
  if (ctx.userZone || ctx.focusedZoneId) {
    _setZoneQuery(ctx.userZone || ctx.focusedZoneId);
  }
  return ctx;
}

async function _syncShellRoute() {
  const ctx = _syncShellChrome();
  if (ctx.focusedZoneId) {
    await switchTab('zones');
  }
}

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
  const allowedTabs = st.state.allowedTabs?.length ? st.state.allowedTabs : ALL_TABS;
  const nextTab = allowedTabs.includes(tab) ? tab : (allowedTabs[0] ?? 'zones');

  document.querySelectorAll('.tab-btn').forEach(b => {
    const isActive = b.dataset.tab === nextTab;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-selected', isActive ? 'true' : 'false');
    b.setAttribute('tabindex', isActive ? '0' : '-1');
  });
  document.querySelectorAll('.tab-content').forEach(el => {
    const isActive = el.id === `tab-${nextTab}`;
    el.classList.toggle('active', isActive);
    if (!el.hidden) el.toggleAttribute('aria-hidden', !isActive);
  });
  st.setActiveTab(nextTab);
  const mod = await loadTabModule(nextTab);
  if (mod?.render) {
    const el = document.getElementById(`tab-${nextTab}`);
    if (el) mod.render(el);
  }
  if (nextTab === 'zones' && st.state.focusedZoneId) {
    _openFocusedZone(st.state.focusedZoneId, st.state.shellMode === 'zone_locked');
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
      _applyAuthClaims(res.token, res.role ?? 'viewer');
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
    const [channels, outputs, zones, routes, scenes, system, buses, matrixState, vcaGroups, stereoLinks, outputStereoLinks, gens, amGroups, busFeedMatrix] = await Promise.all([
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
      api.getOutputStereoLinks().catch(() => []),
      api.getGenerators().catch(() => ({ signal_generators: [], generator_bus_matrix: [] })),
      api.getAutomixerGroups().catch(() => []),
      api.getBusFeedMatrix().catch(() => []),
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
    st.setOutputStereoLinks(Array.isArray(outputStereoLinks) ? outputStereoLinks : (outputStereoLinks?.stereo_links ?? []));
    st.setGenerators(gens.signal_generators ?? []);
    st.setGeneratorMatrix(gens.generator_bus_matrix ?? []);
    st.setAutomixerGroups(Array.isArray(amGroups) ? amGroups : (amGroups?.automixer_groups ?? []));
    st.setBusFeedMatrix(Array.isArray(busFeedMatrix) ? busFeedMatrix : []);

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

    const ctx = _syncShellChrome();
    const tab = ctx.focusedZoneId ? 'zones' : st.state.activeTab;
    await switchTab(tab);

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
window.addEventListener('hashchange', () => { _syncShellRoute().catch(() => {}); });
window.addEventListener('popstate', () => { _syncShellRoute().catch(() => {}); });

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

function _announce(msg) {
  const live = document.getElementById('sr-live-polite');
  if (live) live.textContent = msg;
}

async function _doUndoRedo(dir) {
  try {
    const ok = dir === 'undo' ? await undo.undo() : await undo.redo();
    if (!ok) return;
  } catch (e) {
    toast((dir === 'undo' ? 'Undo' : 'Redo') + ' failed: ' + (e && e.message ? e.message : String(e)), true);
  }
}

function _setupUndoUi() {
  const bUndo = document.getElementById('tb-undo');
  const bRedo = document.getElementById('tb-redo');
  if (!bUndo || !bRedo) return;

  const applyState = (st) => {
    bUndo.disabled = !st || !st.canUndo;
    bRedo.disabled = !st || !st.canRedo;
    bUndo.title = st && st.undoLabel ? ('Undo: ' + st.undoLabel) : 'Undo (Ctrl/Cmd+Z)';
    bRedo.title = st && st.redoLabel ? ('Redo: ' + st.redoLabel) : 'Redo (Ctrl/Cmd+Shift+Z)';
  };

  window.addEventListener('undo:change', e => applyState(e.detail));
  window.addEventListener('undo:applied', async (e) => {
    toast((e.detail.direction === 'undo' ? 'Undid' : 'Redid') + ': ' + e.detail.label);
    _announce(e.detail.direction + ': ' + e.detail.label);
    const tab = st.state.activeTab;
    const mod = _tabModules[tab] || await loadTabModule(tab);
    const el = document.getElementById('tab-' + tab);
    try { if (mod && mod.render) mod.render(el); } catch (_) {}
  });

  bUndo.addEventListener('click', () => _doUndoRedo('undo'));
  bRedo.addEventListener('click', () => _doUndoRedo('redo'));

  applyState({ canUndo: undo.canUndo(), canRedo: undo.canRedo(), undoLabel: undo.undoLabel(), redoLabel: undo.redoLabel() });
}

document.addEventListener('DOMContentLoaded', async () => {
  setupLogin();

  // Wire tab buttons with ARIA and roving tabindex
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach((btn) => {
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', btn.classList.contains('active') ? 'true' : 'false');
    btn.setAttribute('tabindex', btn.classList.contains('active') ? '0' : '-1');
    
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    
    // Arrow key navigation for tabs
    btn.addEventListener('keydown', (e) => {
      const visibleButtons = [...document.querySelectorAll('.tab-btn:not([hidden])')];
      const visibleIdx = visibleButtons.indexOf(btn);
      if (visibleIdx < 0 || visibleButtons.length === 0) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const nextBtn = visibleButtons[(visibleIdx + 1) % visibleButtons.length];
        nextBtn.focus();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const prevBtn = visibleButtons[(visibleIdx - 1 + visibleButtons.length) % visibleButtons.length];
        prevBtn.focus();
      }
    });
  });

  // Auth check — try a lightweight call; if 401, go to login
  if (!api.hasToken()) {
    showLogin();
    return;
  }

  // Re-schedule refresh for any token already in localStorage
  const token = localStorage.getItem('pb_token') ?? '';
  api.scheduleRefresh(token);
  _applyAuthClaims(token, st.state.userRole);
  _syncShellChrome();

  try {
    await api.getHealth();
    hideLogin();
    await loadAll();
    shortcuts.setupShortcuts();
    _setupUndoUi();

    window.addEventListener('shortcut:close-panels', () => {
      import('./panels.js').then(m => m.closeAllPanels?.());
    });

    window.addEventListener('shortcut:undo', () => _doUndoRedo('undo'));
    window.addEventListener('shortcut:redo', () => _doUndoRedo('redo'));

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
      _setupUndoUi();

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

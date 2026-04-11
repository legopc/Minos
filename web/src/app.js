'use strict';

// =============================================================================
// DANTE-PATCHBOX v2 — AUTH LAYER
// =============================================================================

const TOKEN_KEY = 'pb_token';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _el(id) {
  return document.getElementById(id);
}

/**
 * Retrieve the stored token from sessionStorage.
 * @returns {string|null}
 */
window.getToken = function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
};

/**
 * Internal: call /api/v1/whoami with an optional token.
 * Returns the user object on success, null on any failure.
 * @param {string|null} token
 * @returns {Promise<{username: string, role: string, zone: string}|null>}
 */
async function whoami(token) {
  if (!token) return null;
  try {
    const res = await fetch('/api/v1/whoami', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public globals
// ---------------------------------------------------------------------------

/**
 * Show the login overlay and clear any stored token.
 * Hides #app, empties password field and any previous error.
 */
window.showLogin = function showLogin() {
  sessionStorage.removeItem(TOKEN_KEY);
  window.currentUser = null;

  const overlay = _el('login-overlay');
  const app = _el('app');
  const err = _el('login-error');
  const pass = _el('login-pass');

  if (overlay) overlay.style.display = '';
  if (app) app.style.display = 'none';
  if (err) err.textContent = '';
  if (pass) pass.value = '';
};

/**
 * Hide the login overlay and reveal #app.
 */
window.hideLogin = function hideLogin() {
  const overlay = _el('login-overlay');
  const app = _el('app');

  if (overlay) overlay.style.display = 'none';
  if (app) app.style.display = '';
};

/**
 * Fetch wrapper that injects the Bearer token header automatically.
 * On 401, calls showLogin() and throws an Error.
 * @param {string} url
 * @param {RequestInit} [opts]
 * @returns {Promise<Response>}
 */
window.patchFetch = async function patchFetch(url, opts = {}) {
  const token = window.getToken();
  const headers = new Headers(opts.headers ?? {});
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(url, { ...opts, headers });

  if (res.status === 401) {
    window.showLogin();
    throw new Error('Unauthorised — login required');
  }

  return res;
};

/** @type {{username: string, role: string, zone: string}|null} */
window.currentUser = null;

// ---------------------------------------------------------------------------
// DOM wiring
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  // --- Logout ---
  const logoutBtn = _el('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      sessionStorage.removeItem(TOKEN_KEY);
      window.currentUser = null;
      window.showLogin();
    });
  }

  // --- Login form submit ---
  const loginBtn = _el('login-btn');
  const loginUser = _el('login-user');
  const loginPass = _el('login-pass');
  const loginErr = _el('login-error');

  async function submitLogin() {
    const username = loginUser?.value.trim() ?? '';
    const password = loginPass?.value ?? '';

    if (!username || !password) {
      if (loginErr) loginErr.textContent = 'Username and password are required.';
      return;
    }

    if (loginBtn) {
      loginBtn.disabled = true;
      loginBtn.textContent = '…';
    }
    if (loginErr) loginErr.textContent = '';

    try {
      const res = await fetch('/api/v1/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Login failed (${res.status})`);
      }

      const data = await res.json();
      const token = data.token;

      sessionStorage.setItem(TOKEN_KEY, token);
      window.currentUser = { username: data.username ?? username, role: data.role, zone: data.zone };

      const badge = _el('user-badge');
      if (badge) badge.textContent = `${window.currentUser.username} (${window.currentUser.role})`;

      window.hideLogin();

      if (typeof window.onAppReady === 'function') window.onAppReady();

    } catch (err) {
      if (loginErr) loginErr.textContent = err.message ?? 'Login failed.';
      console.error('[auth] login error:', err);
    } finally {
      if (loginBtn) {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
      }
    }
  }

  if (loginBtn) loginBtn.addEventListener('click', submitLogin);

  // Trigger submit on Enter in either field
  [loginUser, loginPass].forEach(input => {
    input?.addEventListener('keydown', e => {
      if (e.key === 'Enter') submitLogin();
    });
  });

  // --- Bootstrap: check existing token ---
  const storedToken = window.getToken();
  const user = await whoami(storedToken);

  if (user) {
    window.currentUser = user;
    const badge = _el('user-badge');
    if (badge) badge.textContent = `${user.username} (${user.role})`;
    window.hideLogin();
    if (typeof window.onAppReady === 'function') window.onAppReady();
  } else {
    window.showLogin();
  }
});

// --- END AUTH LAYER — other modules appended below ---

// =============================================================================
// WEBSOCKET + METER RENDERING MODULE
// =============================================================================

let _ws = null;
let _wsReconnectTimer = null;

/**
 * Initialize WebSocket connection to ws://<host>/ws
 * Handles onopen, onclose, onerror, onmessage
 */
window.initWS = function initWS() {
  if (_ws !== null) return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/ws`;

  _ws = new WebSocket(url);

  _ws.onopen = function() {
    const dot = _el('ws-dot');
    const label = _el('ws-label');
    if (dot) dot.classList.add('connected');
    if (label) label.textContent = 'connected';
    if (_wsReconnectTimer) {
      clearTimeout(_wsReconnectTimer);
      _wsReconnectTimer = null;
    }
  };

  _ws.onclose = function() {
    const dot = _el('ws-dot');
    const label = _el('ws-label');
    if (dot) dot.classList.remove('connected');
    if (label) label.textContent = 'connecting…';
    _ws = null;
    _wsReconnectTimer = setTimeout(() => {
      window.initWS();
    }, 3000);
  };

  _ws.onerror = function(err) {
    console.error('[ws] error:', err);
    const dot = _el('ws-dot');
    const label = _el('ws-label');
    if (dot) dot.classList.remove('connected');
    if (label) label.textContent = 'connecting…';
    _ws = null;
    if (!_wsReconnectTimer) {
      _wsReconnectTimer = setTimeout(() => {
        window.initWS();
      }, 3000);
    }
  };

  _ws.onmessage = function(event) {
    try {
      const frame = JSON.parse(event.data);
      window.updateMeters(frame);
    } catch (err) {
      console.error('[ws] parse error:', err);
    }
  };
};

/**
 * Update meter fills based on RMS frame {tx_rms, rx_rms}
 * @param {{tx_rms: number[], rx_rms: number[]}} frame
 */
window.updateMeters = function updateMeters(frame) {
  if (!frame) return;

  const { rx_rms = [], tx_rms = [] } = frame;

  // Update input source meters (rx_rms)
  rx_rms.forEach((rms, i) => {
    const row = _el('input-gains')?.querySelector(`.gain-row[data-ch="${i}"]`);
    if (row) {
      const fill = row.querySelector('.meter-fill');
      if (fill) {
        fill.style.width = `${rms * 100}%`;
        if (rms > 0.9) {
          fill.classList.add('clip');
        } else {
          fill.classList.remove('clip');
        }
      }
    }
  });

  // Update output zone meters (tx_rms)
  tx_rms.forEach((rms, i) => {
    const row = _el('output-gains')?.querySelector(`.gain-row[data-ch="${i}"]`);
    if (row) {
      const fill = row.querySelector('.meter-fill');
      if (fill) {
        fill.style.width = `${rms * 100}%`;
        if (rms > 0.9) {
          fill.classList.add('clip');
        } else {
          fill.classList.remove('clip');
        }
      }
    }
  });
};

// Chain initWS() to window.onAppReady
const _origOnAppReady = window.onAppReady;
window.onAppReady = function onAppReady() {
  if (_origOnAppReady && typeof _origOnAppReady === 'function') {
    _origOnAppReady.call(window);
  }
  window.initWS();
};

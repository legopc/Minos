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
// DANTE-PATCHBOX v2 — CONFIG LOADER + MATRIX TABLE BUILDER (js-03)
// =============================================================================

// ---------------------------------------------------------------------------
// Internal: inline name editor
// ---------------------------------------------------------------------------

function _attachEditable(span) {
  span.addEventListener('click', _startEdit);
  span.addEventListener('focus', _startEdit);
}

function _startEdit(e) {
  const span = e.currentTarget;
  if (span.querySelector('input')) return; // already editing

  const originalName = span.textContent.trim();
  const input = document.createElement('input');
  input.className = 'name-input';
  input.value = originalName;

  span.textContent = '';
  span.appendChild(input);
  input.focus();
  input.select();

  async function _commitEdit() {
    const newName = input.value.trim();
    if (!newName) {
      _cancelEdit();
      return;
    }

    const idx = parseInt(span.dataset.idx, 10);
    const isSrc = span.classList.contains('src-name');
    const url = isSrc
      ? `/api/v1/sources/${idx}/name`
      : `/api/v1/zones/${idx}/name`;

    try {
      const res = await window.patchFetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      span.textContent = newName;
      if (typeof window.toast === 'function') window.toast('Name saved', 'ok');
    } catch (err) {
      console.error('[matrix] rename error:', err);
      span.textContent = originalName;
      if (typeof window.toast === 'function') window.toast('Rename failed', 'err');
    }
  }

  function _cancelEdit() {
    span.textContent = originalName;
  }

  input.addEventListener('blur', _commitEdit);

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.removeEventListener('blur', _commitEdit);
      _commitEdit();
    } else if (e.key === 'Escape') {
      input.removeEventListener('blur', _commitEdit);
      _cancelEdit();
    }
  });
}

// ---------------------------------------------------------------------------
// Internal: crosspoint toggle
// ---------------------------------------------------------------------------

async function toggleCrosspoint(tx, rx, enabled) {
  try {
    const res = await window.patchFetch('/api/v1/matrix', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx, rx, enabled }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error('[matrix] crosspoint toggle error:', err);
    // Revert checkbox state
    const table = document.getElementById('matrix-table');
    if (table) {
      const cb = table.querySelector(
        `input[type="checkbox"][data-tx="${tx}"][data-rx="${rx}"]`
      );
      if (cb) cb.checked = !enabled;
    }
    if (typeof window.toast === 'function') window.toast('Routing error', 'err');
  }
}

// ---------------------------------------------------------------------------
// Internal: matrix table builder
// ---------------------------------------------------------------------------

function buildMatrix(cfg) {
  const table = document.getElementById('matrix-table');
  if (!table) return;

  // Clear any existing content
  table.innerHTML = '';

  const { sources, zones, matrix } = cfg;

  // --- Header row ---
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  // Corner cell
  const corner = document.createElement('th');
  corner.className = 'input-header';
  headerRow.appendChild(corner);

  zones.forEach((zoneName, zoneIdx) => {
    const th = document.createElement('th');
    const span = document.createElement('span');
    span.className = 'editable zone-name';
    span.dataset.idx = zoneIdx;
    span.textContent = zoneName;
    _attachEditable(span);
    th.appendChild(span);
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  // --- Body rows (one per source/rx channel) ---
  const tbody = document.createElement('tbody');

  sources.forEach((srcName, srcIdx) => {
    const tr = document.createElement('tr');

    // Source name cell
    const labelTd = document.createElement('td');
    labelTd.className = 'input-header';
    const srcSpan = document.createElement('span');
    srcSpan.className = 'editable src-name';
    srcSpan.dataset.idx = srcIdx;
    srcSpan.textContent = srcName;
    _attachEditable(srcSpan);
    labelTd.appendChild(srcSpan);
    tr.appendChild(labelTd);

    // Crosspoint checkboxes — one per zone (tx channel)
    zones.forEach((_zoneName, zoneIdx) => {
      const td = document.createElement('td');
      td.className = 'cb-cell';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.tx = zoneIdx;
      cb.dataset.rx = srcIdx;
      // matrix[tx][rx] = matrix[zoneIdx][srcIdx]
      cb.checked = !!(matrix[zoneIdx] && matrix[zoneIdx][srcIdx]);

      cb.addEventListener('change', () => {
        toggleCrosspoint(zoneIdx, srcIdx, cb.checked);
      });

      td.appendChild(cb);
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
}

// ---------------------------------------------------------------------------
// Public: loadConfig
// ---------------------------------------------------------------------------

window.loadConfig = async function loadConfig() {
  const res = await fetch('/api/v1/config');
  if (!res.ok) throw new Error(`Failed to load config: HTTP ${res.status}`);

  const data = await res.json();
  window.appConfig = data;

  buildMatrix(data);

  if (typeof window.buildGainRows === 'function') {
    window.buildGainRows(data);
  }

  return data;
};

// ---------------------------------------------------------------------------
// onAppReady chain extension
// ---------------------------------------------------------------------------

(function () {
  const _prevReady = window.onAppReady;
  window.onAppReady = async function () {
    if (typeof _prevReady === 'function') await _prevReady();
    await window.loadConfig();
  };
})();

// --- END CONFIG LOADER + MATRIX TABLE BUILDER (js-03) ---

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

// Chain initWS() to window.onAppReady — initWS fires after config loads
(function () {
  const _prevReady = window.onAppReady;
  window.onAppReady = async function () {
    if (typeof _prevReady === 'function') await _prevReady();
    window.initWS();
  };
})();

// --- END WEBSOCKET + METER RENDERING MODULE ---

// =============================================================================
// MUTE/PANIC BAR + TOAST NOTIFICATION MODULE (js-06)
// =============================================================================

// ---------------------------------------------------------------------------
// Toast notification system
// ---------------------------------------------------------------------------

window.toast = function toast(msg, type = 'ok') {
  const container = _el('toast-container');
  if (!container) return;

  const toastEl = document.createElement('div');
  toastEl.className = `toast ${type}`;
  toastEl.textContent = msg;

  container.appendChild(toastEl);

  // Track active toasts to enforce max 5
  const toasts = container.querySelectorAll('.toast');
  if (toasts.length > 5) {
    const oldest = toasts[0];
    oldest.remove();
  }

  setTimeout(() => {
    toastEl.classList.add('show');
  }, 50);

  setTimeout(() => {
    toastEl.classList.remove('show');
    setTimeout(() => {
      if (toastEl.parentElement) toastEl.remove();
    }, 300);
  }, 3000);
};

// ---------------------------------------------------------------------------
// Mute UI state management
// ---------------------------------------------------------------------------

window.updateMuteUI = function updateMuteUI(cfg) {
  const panicBar = _el('panic-bar');
  const muteStatus = _el('mute-status');

  if (!cfg || !cfg.output_muted) return;

  const allMuted = cfg.output_muted.every(m => m === true);

  if (allMuted) {
    if (panicBar) panicBar.classList.add('all-muted');
    if (muteStatus) muteStatus.textContent = '⚠ All zones muted';
  } else {
    if (panicBar) panicBar.classList.remove('all-muted');
    if (muteStatus) muteStatus.textContent = '';
  }
};

// ---------------------------------------------------------------------------
// Mute all / Unmute all button handlers
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  const btnMuteAll = _el('btn-mute-all');
  const btnUnmuteAll = _el('btn-unmute-all');

  if (btnMuteAll) {
    btnMuteAll.addEventListener('click', async () => {
      try {
        const res = await window.patchFetch('/api/v1/mute-all', {
          method: 'POST',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const panicBar = _el('panic-bar');
        const muteStatus = _el('mute-status');

        if (panicBar) panicBar.classList.add('all-muted');
        if (muteStatus) muteStatus.textContent = '⚠ All zones muted';

        if (window.appConfig) {
          window.updateMuteUI(window.appConfig);
        }

        window.toast('All zones muted', 'err');
      } catch (err) {
        console.error('[mute] mute-all error:', err);
        window.toast('Mute failed', 'err');
      }
    });
  }

  if (btnUnmuteAll) {
    btnUnmuteAll.addEventListener('click', async () => {
      try {
        const res = await window.patchFetch('/api/v1/unmute-all', {
          method: 'POST',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const panicBar = _el('panic-bar');
        const muteStatus = _el('mute-status');

        if (panicBar) panicBar.classList.remove('all-muted');
        if (muteStatus) muteStatus.textContent = '';

        // Refresh config to sync gain rows mute state
        await window.loadConfig();

        window.toast('All zones unmuted', 'ok');
      } catch (err) {
        console.error('[mute] unmute-all error:', err);
        window.toast('Unmute failed', 'err');
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Per-zone mute buttons in matrix
// ---------------------------------------------------------------------------

(function initPerZoneMute() {
  const table = _el('matrix-table');
  if (!table) return;

  // Use MutationObserver to detect when matrix is built
  const observer = new MutationObserver(() => {
    // Once fired, detach observer
    observer.disconnect();

    // Find all zone header <th> elements (skip corner cell)
    const headerRow = table.querySelector('thead tr');
    if (!headerRow) return;

    const ths = Array.from(headerRow.querySelectorAll('th')).slice(1); // Skip corner

    ths.forEach((th, zoneIdx) => {
      // Check if mute button already attached
      if (th.querySelector('.zone-mute-btn')) return;

      const btn = document.createElement('button');
      btn.className = 'zone-mute-btn';
      btn.dataset.tx = zoneIdx;
      btn.textContent = 'mute';

      // Set initial muted state
      if (window.appConfig && window.appConfig.output_muted[zoneIdx]) {
        btn.classList.add('muted');
      }

      btn.addEventListener('click', async (e) => {
        e.stopPropagation();

        const tx = zoneIdx;
        const isMuted = btn.classList.contains('muted');
        const endpoint = isMuted ? 'unmute' : 'mute';

        try {
          const res = await window.patchFetch(`/api/v1/zones/${tx}/${endpoint}`, {
            method: 'POST',
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          if (isMuted) {
            btn.classList.remove('muted');
          } else {
            btn.classList.add('muted');
          }

          // Update appConfig if available
          if (window.appConfig && window.appConfig.output_muted) {
            window.appConfig.output_muted[tx] = !isMuted;
          }

          window.toast(`Zone ${tx} ${isMuted ? 'unmuted' : 'muted'}`, 'ok');
        } catch (err) {
          console.error(`[mute] zone ${tx} ${endpoint} error:`, err);
          window.toast(`Zone ${tx} ${endpoint} failed`, 'err');
        }
      });

      th.appendChild(btn);
    });
  });

  observer.observe(table, {
    childList: true,
    subtree: true,
  });
})();

// ---------------------------------------------------------------------------
// onAppReady chain extension — call updateMuteUI after config loads
// ---------------------------------------------------------------------------

(function () {
  const _prevReady2 = window.onAppReady;
  window.onAppReady = async function () {
    if (typeof _prevReady2 === 'function') await _prevReady2();
    if (window.appConfig) {
      window.updateMuteUI(window.appConfig);
    }
  };
})();

// --- END MUTE/PANIC BAR + TOAST NOTIFICATION MODULE (js-06) ---

// =============================================================================
// GAIN SLIDERS MODULE (js-04)
// =============================================================================

/**
 * Debounce helper: delays function execution until ms have passed with no calls.
 * @param {Function} fn
 * @param {number} ms
 * @returns {Function}
 */
function debounce(fn, ms) {
  let timeoutId = null;
  return function debounced(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), ms);
  };
}

/**
 * Build input and output gain slider sections.
 * Called by window.loadConfig() after config is fetched.
 * @param {Object} cfg
 * @param {string[]} cfg.sources - input source names (rx channels)
 * @param {string[]} cfg.zones - output zone names (tx channels)
 * @param {number[]} cfg.input_gain_db - initial dB values for sources
 * @param {number[]} cfg.output_gain_db - initial dB values for zones
 */
window.buildGainRows = function buildGainRows(cfg) {
  const { sources = [], zones = [], input_gain_db = [], output_gain_db = [] } = cfg;

  // --- Build input gains section ---
  const inputContainer = document.getElementById('input-gains');
  if (inputContainer) {
    inputContainer.innerHTML = '';

    sources.forEach((srcName, i) => {
      const gainDb = input_gain_db[i] ?? 0;
      const row = document.createElement('div');
      row.className = 'gain-row';
      row.dataset.ch = i;

      const label = document.createElement('span');
      label.className = 'gain-label';
      label.textContent = srcName;

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'gain-slider';
      slider.min = '-60';
      slider.max = '12';
      slider.step = '0.5';
      slider.value = gainDb;

      const valDisplay = document.createElement('span');
      valDisplay.className = 'gain-val';
      valDisplay.textContent = `${gainDb.toFixed(1)} dB`;

      const meter = document.createElement('div');
      meter.className = 'meter-strip';
      const fill = document.createElement('div');
      fill.className = 'meter-fill';
      meter.appendChild(fill);

      row.appendChild(label);
      row.appendChild(slider);
      row.appendChild(valDisplay);
      row.appendChild(meter);

      // Live feedback on input event
      slider.addEventListener('input', function() {
        const val = parseFloat(this.value);
        valDisplay.textContent = `${val.toFixed(1)} dB`;
      });

      // Debounced API call on change event
      const debouncedSave = debounce(async function() {
        const val = parseFloat(slider.value);
        try {
          const res = await window.patchFetch('/api/v1/gain/input', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel: i, db: val }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (err) {
          console.error('[gain] input save error:', err);
          if (typeof window.toast === 'function') window.toast('Gain error', 'err');
          slider.value = gainDb;
          valDisplay.textContent = `${gainDb.toFixed(1)} dB`;
        }
      }, 300);

      slider.addEventListener('change', debouncedSave);

      inputContainer.appendChild(row);
    });
  }

  // --- Build output gains section ---
  const outputContainer = document.getElementById('output-gains');
  if (outputContainer) {
    outputContainer.innerHTML = '';

    zones.forEach((zoneName, i) => {
      const gainDb = output_gain_db[i] ?? 0;
      const row = document.createElement('div');
      row.className = 'gain-row';
      row.dataset.ch = i;

      const label = document.createElement('span');
      label.className = 'gain-label';
      label.textContent = zoneName;

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'gain-slider';
      slider.min = '-60';
      slider.max = '12';
      slider.step = '0.5';
      slider.value = gainDb;

      const valDisplay = document.createElement('span');
      valDisplay.className = 'gain-val';
      valDisplay.textContent = `${gainDb.toFixed(1)} dB`;

      const meter = document.createElement('div');
      meter.className = 'meter-strip';
      const fill = document.createElement('div');
      fill.className = 'meter-fill';
      meter.appendChild(fill);

      row.appendChild(label);
      row.appendChild(slider);
      row.appendChild(valDisplay);
      row.appendChild(meter);

      // Live feedback on input event
      slider.addEventListener('input', function() {
        const val = parseFloat(this.value);
        valDisplay.textContent = `${val.toFixed(1)} dB`;
      });

      // Debounced API call on change event
      const debouncedSave = debounce(async function() {
        const val = parseFloat(slider.value);
        try {
          const res = await window.patchFetch('/api/v1/gain/output', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel: i, db: val }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (err) {
          console.error('[gain] output save error:', err);
          if (typeof window.toast === 'function') window.toast('Gain error', 'err');
          slider.value = gainDb;
          valDisplay.textContent = `${gainDb.toFixed(1)} dB`;
        }
      }, 300);

      slider.addEventListener('change', debouncedSave);

      outputContainer.appendChild(row);
    });
  }
};

// --- END GAIN SLIDERS MODULE (js-04) ---

// --- END WEBSOCKET + METER RENDERING MODULE ---

// =============================================================================
// DANTE-PATCHBOX v2 — SCENES PANEL MODULE (js-05)
// =============================================================================

/**
 * Load scenes from /api/v1/scenes and render them in #scene-list.
 * Each scene is displayed as a row with load and delete buttons.
 * The active scene gets the 'active' class.
 * @returns {Promise<void>}
 */
window.loadScenes = async function loadScenes() {
  try {
    const res = await window.patchFetch('/api/v1/scenes');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const { scenes = [], active = null } = data;

    const container = document.getElementById('scene-list');
    if (!container) return;

    container.innerHTML = '';

    scenes.forEach(scene => {
      const { id, name, description = '' } = scene;

      const row = document.createElement('div');
      row.className = 'scene-row';
      row.dataset.name = name;
      if (name === active) {
        row.classList.add('active');
      }

      const sname = document.createElement('span');
      sname.className = 'sname';
      sname.textContent = name;

      const sdesc = document.createElement('span');
      sdesc.className = 'sdesc';
      sdesc.textContent = description || '';

      const btnLoad = document.createElement('button');
      btnLoad.className = 'btn btn-load';
      btnLoad.textContent = 'Load';

      const btnDel = document.createElement('button');
      btnDel.className = 'btn danger btn-del';
      btnDel.textContent = 'Delete';

      row.appendChild(sname);
      row.appendChild(sdesc);
      row.appendChild(btnLoad);
      row.appendChild(btnDel);

      container.appendChild(row);
    });
  } catch (err) {
    console.error('[scenes] load error:', err);
    if (typeof window.toast === 'function') window.toast('Failed to load scenes', 'err');
  }
};

// ---------------------------------------------------------------------------
// Save scene event handler
// ---------------------------------------------------------------------------

(function () {
  function handleSaveScene() {
    const input = document.getElementById('scene-name-input');
    if (!input) return;

    const name = input.value.trim();
    if (!name) {
      input.style.borderColor = 'red';
      setTimeout(() => {
        input.style.borderColor = '';
      }, 500);
      return;
    }

    (async () => {
      try {
        const res = await window.patchFetch('/api/v1/scenes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        await window.loadScenes();
        input.value = '';
        if (typeof window.toast === 'function') window.toast('Scene saved', 'ok');
      } catch (err) {
        console.error('[scenes] save error:', err);
        if (typeof window.toast === 'function') window.toast('Save failed', 'err');
      }
    })();
  }

  const btn = document.getElementById('btn-save-scene');
  if (btn) btn.addEventListener('click', handleSaveScene);
})();

// ---------------------------------------------------------------------------
// Load and Delete scene event delegation
// ---------------------------------------------------------------------------

(function () {
  const container = document.getElementById('scene-list');
  if (!container) return;

  container.addEventListener('click', async e => {
    const row = e.target.closest('.scene-row');
    if (!row) return;

    const sceneName = row.dataset.name;
    if (!sceneName) return;

    if (e.target.classList.contains('btn-load')) {
      try {
        const res = await window.patchFetch(`/api/v1/scenes/${sceneName}/load`, {
          method: 'POST',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        await window.loadConfig();
        await window.loadScenes();
        if (typeof window.toast === 'function') window.toast('Scene loaded', 'ok');
      } catch (err) {
        console.error('[scenes] load error:', err);
        if (typeof window.toast === 'function') window.toast('Load failed', 'err');
      }
    } else if (e.target.classList.contains('btn-del')) {
      try {
        const res = await window.patchFetch(`/api/v1/scenes/${sceneName}`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        await window.loadScenes();
        if (typeof window.toast === 'function') window.toast('Scene deleted', 'ok');
      } catch (err) {
        console.error('[scenes] delete error:', err);
        if (typeof window.toast === 'function') window.toast('Delete failed', 'err');
      }
    }
  });
})();

// ---------------------------------------------------------------------------
// Extend onAppReady chain to load scenes
// ---------------------------------------------------------------------------

(function () {
  const _prevReady = window.onAppReady;
  window.onAppReady = async function () {
    if (typeof _prevReady === 'function') await _prevReady();
    await window.loadScenes();
  };
})();

// --- END SCENES PANEL MODULE (js-05) ---

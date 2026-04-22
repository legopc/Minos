// Patchbox SPA router — ES module entry point
// Hash-based routing: #/dashboard, #/matrix, #/inputs, #/outputs, #/scenes, #/system

import { initSidebar } from './components/nav-sidebar.js';

// ============================================================================
// Toast Queue
// ============================================================================

const TOAST_MAX = 5;
const TOAST_TIMEOUT = 4000;
const _toastQueue = [];
let _toastTimer = null;

function processToastQueue() {
  const container = document.getElementById('toasts');
  if (!container) return;

  while (_toastQueue.length > TOAST_MAX) {
    _toastQueue.shift();
  }

  const active = container.querySelectorAll('.toast-item');
  active.forEach((el, i) => {
    if (i >= _toastQueue.length) {
      el.classList.remove('toast-item--visible');
      setTimeout(() => el.remove(), 300);
    }
  });

  _toastQueue.forEach((item, i) => {
    let el = container.querySelector(`[data-toast-id="${item.id}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = `toast-item toast-item--${item.type || 'info'}`;
      el.setAttribute('data-toast-id', item.id);
      el.setAttribute('role', 'alert');
      el.textContent = item.msg;
      el.addEventListener('click', () => dismissToast(item.id));
      container.appendChild(el);
      requestAnimationFrame(() => el.classList.add('toast-item--visible'));
    }
    if (item.timeout) {
      clearTimeout(item.timeout);
      item.timeout = setTimeout(() => dismissToast(item.id), TOAST_TIMEOUT);
    }
  });
}

function dismissToast(id) {
  const idx = _toastQueue.findIndex(t => t.id === id);
  if (idx !== -1) {
    clearTimeout(_toastQueue[idx].timeout);
    _toastQueue.splice(idx, 1);
  }
  const el = document.querySelector(`[data-toast-id="${id}"]`);
  if (el) {
    el.classList.remove('toast-item--visible');
    setTimeout(() => el.remove(), 300);
  }
}

function handleToastEvent(e) {
  const { msg, type = 'info' } = e.detail || {};
  if (!msg) return;
  const id = Date.now() + Math.random();
  _toastQueue.push({ id, msg, type, timeout: setTimeout(() => dismissToast(id), TOAST_TIMEOUT) });
  processToastQueue();
}

document.addEventListener('pb:toast', handleToastEvent);

// ============================================================================
// Token Management
// ============================================================================

const TOKEN_KEY = 'pb_token';

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

function setToken(t) {
  sessionStorage.setItem(TOKEN_KEY, t);
}

function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

function isAuthenticated() {
  return !!getToken();
}

// ============================================================================
// Login Overlay
// ============================================================================

function showLogin() {
  document.getElementById('login-overlay').hidden = false;
}

function hideLogin() {
  document.getElementById('login-overlay').hidden = true;
}

// ============================================================================
// Page Cache & Loading
// ============================================================================

const PAGE_CACHE = {};

async function loadPage(route) {
  if (!PAGE_CACHE[route]) {
    try {
      const mod = await import(`/modules/pages/${route}.js`);
      PAGE_CACHE[route] = mod;
    } catch (e) {
      console.warn(`Failed to load page module: ${route}`, e);
      renderPlaceholder(route);
      return null;
    }
  }
  return PAGE_CACHE[route];
}

function renderPlaceholder(route) {
  document.getElementById('page-container').innerHTML = `
    <div class="page-placeholder">
      <h2>${route.toUpperCase()}</h2>
      <p class="text-dim">Page module not yet loaded.</p>
    </div>
  `;
}

// ============================================================================
// Navigation
// ============================================================================

function currentRoute() {
  const hash = window.location.hash.replace('#/', '') || 'dashboard';
  const valid = ['dashboard', 'matrix', 'inputs', 'outputs', 'buses', 'mixer', 'zones', 'scenes', 'dante', 'system', 'style-guide'];
  return valid.includes(hash) ? hash : 'dashboard';
}

// Cleanup function from the current page (returned by init())
let currentPageCleanup = null;

async function navigate(route) {
  if (!isAuthenticated()) {
    showLogin();
    return;
  }

  // Run previous page cleanup before switching
  if (typeof currentPageCleanup === 'function') {
    try { currentPageCleanup(); } catch (e) { console.warn('Page cleanup error:', e); }
    currentPageCleanup = null;
  }

  // Update active nav item
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.route === route);
  });

  // Show loading state
  document.getElementById('page-container').innerHTML = '<div class="page-loading">Loading…</div>';

  // Load + render page — supports both init() (new spec) and render() (legacy)
  const mod = await loadPage(route);
  const pageEntry = mod?.init ?? mod?.render;
  if (pageEntry) {
    try {
      const result = await pageEntry(document.getElementById('page-container'));
      if (typeof result === 'function') currentPageCleanup = result;
    } catch (e) {
      console.error(`Failed to render page: ${route}`, e);
      renderPlaceholder(route);
    }
  }
}

// ============================================================================
// Login Handler
// ============================================================================

async function handleLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const errorEl = document.getElementById('login-error');

  if (!username || !password) {
    errorEl.textContent = 'Username and password required.';
    return;
  }

  try {
    const response = await fetch('/api/v1/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      errorEl.textContent = data.message || 'Authentication failed.';
      return;
    }

    const data = await response.json();
    if (!data.token) {
      errorEl.textContent = 'No token received from server.';
      return;
    }

    // Success: store token, hide login, navigate
    setToken(data.token);
    errorEl.textContent = '';
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    hideLogin();

    // Start WebSocket connection
    import('./ws.js').then(m => m.connect()).catch(console.error);

    navigate(currentRoute());
  } catch (e) {
    console.error('Login error:', e);
    errorEl.textContent = 'Network error. Please try again.';
  }
}

// ============================================================================
// Event Handlers
// ============================================================================

function setupEventHandlers() {
  // Hash change listener
  window.addEventListener('hashchange', () => navigate(currentRoute()));

  // Sidebar toggle
  const sidebarToggle = document.getElementById('btn-sidebar-toggle');
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      document.body.classList.toggle('sidebar-collapsed');
    });
  }

  // Nav item clicks
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => {
      const route = el.dataset.route;
      if (route) {
        window.location.hash = `#/${route}`;
      }
    });
  });

  // Logout
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      clearToken();
      Object.keys(PAGE_CACHE).forEach(k => delete PAGE_CACHE[k]);
      
      // Disconnect WebSocket
      import('./ws.js').then(m => m.disconnect()).catch(console.error);
      
      // Dispatch logout event for other modules
      document.dispatchEvent(new CustomEvent('pb:logout'));
      
      showLogin();
    });
  }

  // Login form handlers
  const loginBtn = document.getElementById('login-btn');
  const loginPassword = document.getElementById('login-password');
  if (loginBtn) {
    loginBtn.addEventListener('click', handleLogin);
  }
  if (loginPassword) {
    loginPassword.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        handleLogin();
      }
    });
  }

  // Keyboard shortcuts
  const shortcutsDialog = document.getElementById('shortcuts-dialog');
  const shortcutsClose = document.getElementById('shortcuts-close');

  if (shortcutsClose && shortcutsDialog) {
    shortcutsClose.addEventListener('click', () => shortcutsDialog.close());
    shortcutsDialog.addEventListener('click', (e) => {
      if (e.target === shortcutsDialog) shortcutsDialog.close();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    const dialog = document.getElementById('shortcuts-dialog');
    if (e.key === '?' && !dialog?.open) {
      e.preventDefault();
      dialog?.showModal();
    } else if (e.key === 'Escape' && dialog?.open) {
      dialog.close();
    } else if (e.key === 'Escape') {
      const openModal = document.querySelector('.dsp-modal[open], dialog[open]');
      if (openModal) {
        openModal.close();
      }
    } else if (e.key === 'M' || e.key === 'm') {
      document.dispatchEvent(new CustomEvent('pb:shortcut', { detail: { action: 'mute' } }));
    } else if (e.key === 'S' || e.key === 's') {
      document.dispatchEvent(new CustomEvent('pb:shortcut', { detail: { action: 'solo' } }));
    } else if (e.key >= '1' && e.key <= '7') {
      const routes = ['dashboard', 'matrix', 'inputs', 'outputs', 'buses', 'mixer', 'zones'];
      const idx = parseInt(e.key) - 1;
      if (routes[idx]) {
        window.location.hash = `#/${routes[idx]}`;
      }
    }
  });
}

// ============================================================================
// WS Status Indicator
// ============================================================================

export function updateWsStatus(state) {
  const wsDot = document.getElementById('ws-dot');
  const wsLabel = document.getElementById('ws-label');
  if (!wsDot || !wsLabel) return;
  wsDot.className = `ws-dot ws-${state}`;
  wsLabel.textContent = state;
}

// ============================================================================
// Boot Sequence
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  // Initialize WS status
  const wsDot = document.getElementById('ws-dot');
  const wsLabel = document.getElementById('ws-label');
  if (wsDot) wsDot.className = 'ws-dot ws-connecting';
  if (wsLabel) wsLabel.textContent = 'connecting…';

  // Setup event handlers
  setupEventHandlers();

  // Initialize sidebar
  initSidebar();

  // Check auth and navigate
  if (!isAuthenticated()) {
    showLogin();
  } else {
    hideLogin();
    
    // Start WebSocket connection
    import('./ws.js').then(m => m.connect()).catch(console.error);
    
    navigate(currentRoute());
  }
});

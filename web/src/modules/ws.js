// Patchbox WebSocket module
// Manages real-time meter data stream from the backend.
// Dispatches 'pb:meters' CustomEvent on document with meter data.
// Dispatches 'pb:ws-status' CustomEvent on document with connection status.

// ============================================================================
// Token Management
// ============================================================================

const TOKEN_KEY = 'pb_token';

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

// ============================================================================
// Connection Management
// ============================================================================

const WS_PATH = '/ws';
let socket = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30_000;

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = getToken();
  // Include token as query param
  return `${proto}//${location.host}${WS_PATH}?token=${encodeURIComponent(token || '')}`;
}

// ============================================================================
// Status Management
// ============================================================================

function setStatus(state) {
  // Try to call router's updateWsStatus if available
  try {
    import('./router.js').then(m => {
      if (m.updateWsStatus) {
        m.updateWsStatus(state);
      }
    }).catch(() => {});
  } catch {}

  // Also dispatch as event
  document.dispatchEvent(new CustomEvent('pb:ws-status', { detail: { state } }));
}

// ============================================================================
// Connection Handler
// ============================================================================

export function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const url = wsUrl();
  socket = new WebSocket(url);

  setStatus('connecting');

  socket.addEventListener('open', () => {
    reconnectDelay = 1000;
    setStatus('connected');
  });

  socket.addEventListener('message', (evt) => {
    try {
      const frame = JSON.parse(evt.data);
      document.dispatchEvent(new CustomEvent('pb:meters', { detail: frame }));
    } catch (e) {
      console.warn('WS parse error:', e);
    }
  });

  socket.addEventListener('close', (evt) => {
    setStatus('disconnected');
    socket = null;
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    setStatus('disconnected');
  });
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  // Don't reconnect if not authenticated
  if (!getToken()) return;

  reconnectTimer = setTimeout(() => {
    connect();
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }, reconnectDelay);
}

// ============================================================================
// Disconnect Handler
// ============================================================================

export function disconnect() {
  clearTimeout(reconnectTimer);
  if (socket) {
    socket.close();
    socket = null;
  }
}

// ============================================================================
// Event Subscription Helpers
// ============================================================================

/**
 * Subscribe to meter frames.
 * @param {function} handler - called with meter frame detail
 * @returns {function} unsubscribe function
 */
export function onMeters(handler) {
  const fn = (e) => handler(e.detail);
  document.addEventListener('pb:meters', fn);
  return () => document.removeEventListener('pb:meters', fn);
}

/**
 * Subscribe to WebSocket status changes.
 * @param {function} handler - called with status state string
 * @returns {function} unsubscribe function
 */
export function onWsStatus(handler) {
  const fn = (e) => handler(e.detail.state);
  document.addEventListener('pb:ws-status', fn);
  return () => document.removeEventListener('pb:ws-status', fn);
}

// ============================================================================
// Auto-Connect
// ============================================================================

// Auto-connect when module is imported (if authenticated)
if (getToken()) {
  connect();
}

// Reconnect when page becomes visible again
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && getToken() && (!socket || socket.readyState === WebSocket.CLOSED)) {
    connect();
  }
});

// Disconnect when logging out
document.addEventListener('pb:logout', () => {
  disconnect();
});

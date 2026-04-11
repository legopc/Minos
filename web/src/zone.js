'use strict';

let cfg = null;
let zoneIdx = null;
let wsReconnectTimer = null;
let volumeChangeTimer = null;
let ws = null;

function extractZoneName() {
  const match = window.location.pathname.match(/\/zone\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function toast(msg, type = 'ok') {
  const container = document.getElementById('toast-container');
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.textContent = msg;
  container.appendChild(div);
  setTimeout(() => div.classList.add('show'), 50);
  setTimeout(() => div.remove(), 3000);
}

function setWSStatus(status) {
  const dot = document.getElementById('ws-dot');
  dot.className = '';
  if (status === 'connected') {
    dot.classList.add('connected');
  } else if (status === 'reconnecting') {
    dot.classList.add('reconnecting');
  }
}

async function apiCall(method, path, body = null, requiresAuth = false) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };

  if (requiresAuth) {
    const token = sessionStorage.getItem('pb_token');
    if (token) {
      options.headers.Authorization = `Bearer ${token}`;
    }
  }

  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(path, options);

  if (res.status === 401 && requiresAuth) {
    showLoginOverlay(() => apiCall(method, path, body, requiresAuth));
    return null;
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${res.status}: ${errText}`);
  }

  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return await res.json();
  }
  return null;
}

function showLoginOverlay(retryFn) {
  if (document.getElementById('zone-login-overlay')) {
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'zone-login-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    background: #222;
    color: #fff;
    border-radius: 8px;
    padding: 24px;
    width: 300px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  `;

  card.innerHTML = `
    <h2 style="margin-top: 0;">Login</h2>
    <input type="text" id="zone-login-user" placeholder="Username" style="
      width: 100%;
      padding: 8px;
      margin-bottom: 12px;
      background: #333;
      border: 1px solid #555;
      color: #fff;
      border-radius: 4px;
      box-sizing: border-box;
    ">
    <input type="password" id="zone-login-pass" placeholder="Password" style="
      width: 100%;
      padding: 8px;
      margin-bottom: 16px;
      background: #333;
      border: 1px solid #555;
      color: #fff;
      border-radius: 4px;
      box-sizing: border-box;
    ">
    <div id="zone-login-error" style="color: #f88; margin-bottom: 12px; display: none;"></div>
    <button id="zone-login-btn" style="
      width: 100%;
      padding: 10px;
      background: #0066cc;
      color: #fff;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    ">Login</button>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const userInput = document.getElementById('zone-login-user');
  const passInput = document.getElementById('zone-login-pass');
  const errorDiv = document.getElementById('zone-login-error');
  const loginBtn = document.getElementById('zone-login-btn');

  userInput.focus();

  async function handleLogin() {
    const username = userInput.value.trim();
    const password = passInput.value.trim();

    if (!username || !password) {
      errorDiv.textContent = 'Username and password required';
      errorDiv.style.display = 'block';
      return;
    }

    loginBtn.disabled = true;
    errorDiv.style.display = 'none';

    try {
      const result = await apiCall('POST', '/api/v1/login', { username, password }, false);
      if (result && result.token) {
        sessionStorage.setItem('pb_token', result.token);
        overlay.remove();
        if (retryFn) {
          await retryFn();
        }
      }
    } catch (err) {
      errorDiv.textContent = 'Login failed: ' + err.message;
      errorDiv.style.display = 'block';
      loginBtn.disabled = false;
    }
  }

  loginBtn.addEventListener('click', handleLogin);
  userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleLogin();
  });
  passInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleLogin();
  });
}

async function loadConfig() {
  try {
    cfg = await apiCall('GET', '/api/v1/config', null, false);
    if (!cfg) {
      toast('Failed to load config', 'error');
      return;
    }

    const zoneName = extractZoneName();
    zoneIdx = cfg.zones.indexOf(zoneName);

    if (zoneIdx < 0) {
      toast(`Zone not found: ${zoneName}`, 'error');
      return;
    }

    document.getElementById('zone-title').textContent = zoneName;

    const sourceList = document.getElementById('source-list');
    sourceList.innerHTML = '';
    cfg.sources.forEach((source, srcIdx) => {
      const btn = document.createElement('button');
      btn.className = 'source-btn';
      btn.textContent = source;

      if (cfg.matrix[zoneIdx] && cfg.matrix[zoneIdx][srcIdx]) {
        btn.classList.add('active');
      }

      btn.addEventListener('click', () => handleSourceClick(srcIdx, btn));
      sourceList.appendChild(btn);
    });

    const slider = document.getElementById('vol-slider');
    slider.value = cfg.output_gain_db[zoneIdx];
    document.getElementById('vol-val').textContent = `${cfg.output_gain_db[zoneIdx]} dB`;

    const muteBtn = document.getElementById('mute-btn');
    if (cfg.output_muted[zoneIdx]) {
      muteBtn.textContent = 'UNMUTE ZONE';
      muteBtn.classList.add('muted');
    } else {
      muteBtn.textContent = 'MUTE ZONE';
      muteBtn.classList.remove('muted');
    }
  } catch (err) {
    console.error('loadConfig error:', err);
    toast('Error loading config: ' + err.message, 'error');
  }
}

async function handleSourceClick(srcIdx, btn) {
  if (!cfg || zoneIdx == null) return;

  const allBtns = document.querySelectorAll('.source-btn');
  const wasActive = btn.classList.contains('active');

  allBtns.forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');

  const requests = [];
  cfg.sources.forEach((_, i) => {
    const body = {
      tx: zoneIdx,
      rx: i,
      enabled: i === srcIdx
    };
    requests.push(
      apiCall('PUT', '/api/v1/matrix', body, true).catch((err) => {
        console.error('Matrix update error:', err);
        throw err;
      })
    );
  });

  try {
    await Promise.all(requests);
    toast(`Routed ${cfg.sources[srcIdx]} to zone`, 'ok');
  } catch (err) {
    console.error('handleSourceClick error:', err);
    toast('Error routing source: ' + err.message, 'error');
    allBtns.forEach((b) => b.classList.remove('active'));
    if (cfg.matrix[zoneIdx][srcIdx]) {
      allBtns[srcIdx].classList.add('active');
    }
  }
}

function setupVolumeSlider() {
  const slider = document.getElementById('vol-slider');
  const valDisplay = document.getElementById('vol-val');

  slider.addEventListener('input', (e) => {
    valDisplay.textContent = `${e.target.value} dB`;
  });

  slider.addEventListener('change', (e) => {
    clearTimeout(volumeChangeTimer);
    volumeChangeTimer = setTimeout(() => {
      handleVolumeChange(parseFloat(e.target.value));
    }, 300);
  });
}

async function handleVolumeChange(db) {
  if (zoneIdx == null) return;

  try {
    await apiCall('PUT', '/api/v1/gain/output', {
      channel: zoneIdx,
      db
    }, true);
  } catch (err) {
    console.error('Volume change error:', err);
    toast('Error setting volume: ' + err.message, 'error');
    if (cfg) {
      document.getElementById('vol-slider').value = cfg.output_gain_db[zoneIdx];
      document.getElementById('vol-val').textContent = `${cfg.output_gain_db[zoneIdx]} dB`;
    }
  }
}

function setupMuteButton() {
  const muteBtn = document.getElementById('mute-btn');

  muteBtn.addEventListener('click', async () => {
    if (zoneIdx == null) return;

    const isMuted = muteBtn.classList.contains('muted');
    const endpoint = isMuted ? 'unmute' : 'mute';

    muteBtn.textContent = isMuted ? 'MUTE ZONE' : 'UNMUTE ZONE';
    muteBtn.classList.toggle('muted');

    try {
      await apiCall('POST', `/api/v1/zones/${zoneIdx}/${endpoint}`, {}, true);
      toast(isMuted ? 'Zone unmuted' : 'Zone muted', 'ok');
    } catch (err) {
      console.error('Mute error:', err);
      toast('Error toggling mute: ' + err.message, 'error');
      muteBtn.textContent = !isMuted ? 'MUTE ZONE' : 'UNMUTE ZONE';
      muteBtn.classList.toggle('muted');
    }
  });
}

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  try {
    ws = new WebSocket(wsUrl);
    setWSStatus('connecting');

    ws.addEventListener('open', () => {
      setWSStatus('connected');
      clearTimeout(wsReconnectTimer);
    });

    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.tx_rms && Array.isArray(data.tx_rms) && zoneIdx != null) {
          const rmsValue = data.tx_rms[zoneIdx] || 0;
          const percentage = Math.min(100, rmsValue * 100);
          const fill = document.getElementById('zone-meter-fill');
          fill.style.width = `${percentage}%`;
          if (rmsValue > 0.9) {
            fill.classList.add('clip');
          } else {
            fill.classList.remove('clip');
          }
        }
      } catch (err) {
        console.error('WS message parse error:', err);
      }
    });

    ws.addEventListener('close', () => {
      setWSStatus('reconnecting');
      wsReconnectTimer = setTimeout(() => {
        connectWebSocket();
      }, 3000);
    });

    ws.addEventListener('error', (err) => {
      console.error('WS error:', err);
      setWSStatus('error');
    });
  } catch (err) {
    console.error('WS connection error:', err);
    setWSStatus('error');
    wsReconnectTimer = setTimeout(() => {
      connectWebSocket();
    }, 3000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  setupVolumeSlider();
  setupMuteButton();
  connectWebSocket();
});

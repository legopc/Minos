'use strict';

// ── Utilities ──────────────────────────────────────────────────────────────

function _el(id) { return document.getElementById(id); }

function toast(msg, type = 'ok') {
  const container = _el('toast-container');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'toast ' + type;
  div.textContent = msg;
  container.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// ── patchFetch ─────────────────────────────────────────────────────────────
// All authenticated API calls go through this.
// Adds Bearer token from sessionStorage('pb_token').
// On 401: shows login overlay, returns null.
// Otherwise: returns the raw Response object.

async function patchFetch(url, options = {}) {
  const token = sessionStorage.getItem('pb_token');
  const headers = Object.assign({}, options.headers || {});
  if (token) headers['Authorization'] = 'Bearer ' + token;

  let res;
  try {
    res = await fetch(url, Object.assign({}, options, { headers }));
  } catch (err) {
    throw err;
  }

  if (res.status === 401) {
    showLogin(() => patchFetch(url, options));
    return null;
  }

  return res;
}

// ── Login overlay ──────────────────────────────────────────────────────────

let _loginOnSuccess = null;

function showLogin(onSuccess) {
  _loginOnSuccess = onSuccess || null;
  const overlay = _el('login-overlay');
  if (overlay) overlay.hidden = false;
  const errEl = _el('login-error');
  if (errEl) errEl.textContent = '';
  const passEl = _el('login-password');
  if (passEl) passEl.value = '';
  setTimeout(() => { const u = _el('login-username'); if (u) u.focus(); }, 50);
}

function hideLogin() {
  const overlay = _el('login-overlay');
  if (overlay) overlay.hidden = true;
}

async function doLogin() {
  const usernameEl = _el('login-username');
  const passwordEl = _el('login-password');
  const errEl = _el('login-error');
  const btn = _el('login-btn');
  const username = usernameEl ? usernameEl.value.trim() : '';
  const password = passwordEl ? passwordEl.value : '';

  if (!username || !password) {
    if (errEl) errEl.textContent = 'Enter username and password.';
    return;
  }

  if (btn) btn.disabled = true;
  if (errEl) errEl.textContent = '';

  try {
    const res = await fetch('/api/v1/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (errEl) errEl.textContent = body.error || ('Error ' + res.status);
      return;
    }

    const data = await res.json();
    sessionStorage.setItem('pb_token', data.token);

    const chipEl = _el('user-chip');
    if (chipEl) chipEl.textContent = username;

    hideLogin();

    if (typeof _loginOnSuccess === 'function') {
      const cb = _loginOnSuccess;
      _loginOnSuccess = null;
      cb();
    }
  } catch (err) {
    if (errEl) errEl.textContent = 'Network error.';
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Bootstrap ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const loginBtn = _el('login-btn');
  if (loginBtn) loginBtn.addEventListener('click', doLogin);
  const passEl = _el('login-password');
  if (passEl) passEl.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  const userEl = _el('login-username');
  if (userEl) userEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const p = _el('login-password'); if (p) p.focus(); }
  });

  const token = sessionStorage.getItem('pb_token');
  let user = null;

  if (token) {
    try {
      const res = await fetch('/api/v1/whoami', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (res.ok) user = await res.json();
    } catch {}
  }

  if (user) {
    const chipEl = _el('user-chip');
    if (chipEl) chipEl.textContent = user.username;
    await appStart();
  } else {
    showLogin(async () => {
      const t = sessionStorage.getItem('pb_token');
      if (t) {
        try {
          const r = await fetch('/api/v1/whoami', { headers: { Authorization: 'Bearer ' + t } });
          if (r.ok) {
            const u = await r.json();
            const chipEl = _el('user-chip');
            if (chipEl) chipEl.textContent = u.username;
          }
        } catch {}
      }
      await appStart();
    });
  }
});

async function appStart() {
  const cfg = await fetch('/api/v1/config').then(r => r.json());
  buildConsole(cfg);
  initWS();
  initScenes();
  initPanic();

  const logoutBtn = _el('btn-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', () => {
    sessionStorage.removeItem('pb_token');
    showLogin(async () => {
      const t = sessionStorage.getItem('pb_token');
      if (t) {
        try {
          const r = await fetch('/api/v1/whoami', { headers: { Authorization: 'Bearer ' + t } });
          if (r.ok) {
            const u = await r.json();
            const chipEl = _el('user-chip');
            if (chipEl) chipEl.textContent = u.username;
          }
        } catch {}
      }
      const freshCfg = await fetch('/api/v1/config').then(r => r.json());
      buildConsole(freshCfg);
    });
  });
}

// ── buildConsole ───────────────────────────────────────────────────────────

let appCfg = null;

function buildConsole(cfg) {
  appCfg = cfg;
  const table = _el('matrix-table');
  table.innerHTML = '';
  table.className = 'console-table';

  // ── THEAD: corner + zone column headers ──────────────────────────────────
  const thead = table.createTHead();
  const headerRow = thead.insertRow();

  const corner = document.createElement('th');
  corner.className = 'corner';
  corner.textContent = 'SOURCES / ZONES';
  headerRow.appendChild(corner);

  cfg.zones.forEach((zoneName, zoneIdx) => {
    const th = document.createElement('th');
    th.className = 'zone-th';
    th.dataset.zoneIdx = zoneIdx;

    const inner = document.createElement('div');
    inner.className = 'zone-th-inner';

    // Zone name (editable span)
    const nameEl = document.createElement('span');
    nameEl.className = 'zone-name editable';
    nameEl.textContent = zoneName;
    nameEl.dataset.idx = zoneIdx;
    makeEditable(nameEl, async (newName) => {
      await patchFetch('/api/v1/zones/' + zoneIdx + '/name', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      appCfg.zones[zoneIdx] = newName;
    });

    // Output meter
    const meterWrap = document.createElement('div');
    meterWrap.className = 'zone-meter-wrap';
    const meterFill = document.createElement('div');
    meterFill.className = 'zone-meter-fill';
    meterFill.id = 'zm-' + zoneIdx;
    meterWrap.appendChild(meterFill);

    // Output gain fader
    const fader = document.createElement('input');
    fader.type = 'range';
    fader.className = 'zone-fader';
    fader.min = '-30';
    fader.max = '6';
    fader.step = '0.5';
    fader.value = cfg.output_gain_db[zoneIdx];

    const dbEl = document.createElement('div');
    dbEl.className = 'zone-db';
    dbEl.id = 'zdb-' + zoneIdx;
    dbEl.textContent = Number(cfg.output_gain_db[zoneIdx]).toFixed(1) + ' dB';

    let gainTimer = null;
    fader.addEventListener('input', () => {
      const db = parseFloat(fader.value);
      dbEl.textContent = db.toFixed(1) + ' dB';
      clearTimeout(gainTimer);
      gainTimer = setTimeout(async () => {
        await patchFetch('/api/v1/gain/output', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel: zoneIdx, db }),
        });
      }, 300);
    });

    // Mute button
    const muteBtn = document.createElement('button');
    muteBtn.className = 'zone-mute-btn';
    muteBtn.id = 'zmute-' + zoneIdx;
    muteBtn.dataset.zoneIdx = zoneIdx;
    muteBtn.textContent = cfg.output_muted[zoneIdx] ? 'MUTED' : 'LIVE';
    if (cfg.output_muted[zoneIdx]) muteBtn.classList.add('muted');
    muteBtn.addEventListener('click', () => toggleZoneMute(zoneIdx));

    inner.append(nameEl, meterWrap, fader, dbEl, muteBtn);
    th.appendChild(inner);
    headerRow.appendChild(th);
  });

  // ── TBODY: one row per source ─────────────────────────────────────────────
  const tbody = table.createTBody();

  cfg.sources.forEach((srcName, rxIdx) => {
    const tr = tbody.insertRow();

    const rowHead = document.createElement('td');
    rowHead.className = 'row-head';
    rowHead.dataset.rxIdx = rxIdx;

    const inner = document.createElement('div');
    inner.className = 'row-head-inner';

    // Source name (editable)
    const nameEl = document.createElement('span');
    nameEl.className = 'src-name editable';
    nameEl.textContent = srcName;
    makeEditable(nameEl, async (newName) => {
      await patchFetch('/api/v1/sources/' + rxIdx + '/name', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      appCfg.sources[rxIdx] = newName;
    });

    // Input meter
    const meterWrap = document.createElement('div');
    meterWrap.className = 'src-meter-wrap';
    const meterFill = document.createElement('div');
    meterFill.className = 'src-meter-fill';
    meterFill.id = 'rm-' + rxIdx;
    meterWrap.appendChild(meterFill);

    // Fader row: slider + dB
    const faderRow = document.createElement('div');
    faderRow.className = 'src-fader-row';

    const fader = document.createElement('input');
    fader.type = 'range';
    fader.className = 'src-fader';
    fader.min = '-60';
    fader.max = '12';
    fader.step = '0.5';
    fader.value = cfg.input_gain_db[rxIdx];

    const dbEl = document.createElement('span');
    dbEl.className = 'src-db';
    dbEl.id = 'rdb-' + rxIdx;
    dbEl.textContent = Number(cfg.input_gain_db[rxIdx]).toFixed(1);

    let gainTimer = null;
    fader.addEventListener('input', () => {
      const db = parseFloat(fader.value);
      dbEl.textContent = db.toFixed(1);
      clearTimeout(gainTimer);
      gainTimer = setTimeout(async () => {
        await patchFetch('/api/v1/gain/input', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel: rxIdx, db }),
        });
      }, 300);
    });

    faderRow.append(fader, dbEl);
    inner.append(nameEl, meterWrap, faderRow);
    rowHead.appendChild(inner);
    tr.appendChild(rowHead);

    // Crosspoint cells: one per zone
    cfg.zones.forEach((_, txIdx) => {
      const td = document.createElement('td');
      td.className = 'cross-cell';
      td.dataset.txIdx = txIdx;
      td.dataset.rxIdx = rxIdx;

      const btn = document.createElement('button');
      btn.className = 'cross-btn';
      btn.dataset.tx = txIdx;
      btn.dataset.rx = rxIdx;
      btn.title = srcName + ' → ' + cfg.zones[txIdx];

      const isActive = !!(appCfg.matrix[txIdx] && appCfg.matrix[txIdx][rxIdx]);
      if (isActive) btn.classList.add('active');

      btn.addEventListener('click', () => {
        const wasActive = btn.classList.contains('active');
        btn.classList.toggle('active', !wasActive);
        btn.classList.remove('flash');
        void btn.offsetWidth;
        if (!wasActive) btn.classList.add('flash');
        toggleCrosspoint(txIdx, rxIdx, !wasActive);
      });

      // Crosshair hover: highlight entire column
      btn.addEventListener('mouseenter', () => {
        table.querySelectorAll('.cross-cell[data-tx-idx="' + txIdx + '"]')
          .forEach(c => c.classList.add('col-hover'));
      });
      btn.addEventListener('mouseleave', () => {
        table.querySelectorAll('.cross-cell.col-hover')
          .forEach(c => c.classList.remove('col-hover'));
      });

      td.appendChild(btn);
      tr.appendChild(td);
    });
  });

  if (cfg.dante_name) {
    const dn = _el('device-name');
    if (dn) dn.textContent = cfg.dante_name;
  }

  updateMuteStatusBar();
}

// ── Crosspoint toggle ──────────────────────────────────────────────────────

async function toggleCrosspoint(tx, rx, enabled) {
  try {
    const res = await patchFetch('/api/v1/matrix', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx, rx, enabled }),
    });
    if (res && !res.ok) throw new Error('HTTP ' + res.status);
    if (appCfg) appCfg.matrix[tx][rx] = enabled;
  } catch (err) {
    console.error('[matrix]', err);
    toast('Route error: ' + err.message, 'err');
    const table = _el('matrix-table');
    const btn = table && table.querySelector(
      '.cross-btn[data-tx="' + tx + '"][data-rx="' + rx + '"]'
    );
    if (btn) btn.classList.toggle('active', !enabled);
  }
}

// ── Zone mute handlers ─────────────────────────────────────────────────────

async function toggleZoneMute(txIdx) {
  const isMuted = appCfg && appCfg.output_muted[txIdx];
  const path = isMuted ? 'unmute' : 'mute';
  try {
    const res = await patchFetch('/api/v1/zones/' + txIdx + '/' + path, { method: 'POST' });
    if (res && !res.ok) throw new Error('HTTP ' + res.status);
    if (appCfg) appCfg.output_muted[txIdx] = !isMuted;
    updateZoneMuteBtn(txIdx, !isMuted);
    updateMuteStatusBar();
    toast(
      appCfg.zones[txIdx] + ' ' + (!isMuted ? 'muted' : 'unmuted'),
      !isMuted ? 'warn' : 'ok'
    );
  } catch (err) {
    toast('Mute error: ' + err.message, 'err');
  }
}

function updateZoneMuteBtn(txIdx, muted) {
  const btn = _el('zmute-' + txIdx);
  if (!btn) return;
  btn.classList.toggle('muted', muted);
  btn.textContent = muted ? 'MUTED' : 'LIVE';
}

function updateMuteStatusBar() {
  if (!appCfg) return;
  const mutedZones = appCfg.zones.filter((_, i) => appCfg.output_muted[i]);
  const el = _el('mute-status');
  if (el) el.textContent = mutedZones.length
    ? mutedZones.length + ' zone(s) muted'
    : 'All zones live';
}

function initPanic() {
  const panicBtn = _el('panic-btn');
  if (panicBtn) panicBtn.addEventListener('click', async () => {
    if (!confirm('Mute ALL zones? This will silence everything.')) return;
    const res = await patchFetch('/api/v1/mute-all', { method: 'POST' });
    if (res && res.ok) {
      if (appCfg) appCfg.output_muted = appCfg.output_muted.map(() => true);
      appCfg.zones.forEach((_, i) => updateZoneMuteBtn(i, true));
      updateMuteStatusBar();
      toast('All zones muted', 'warn');
    }
  });

  const unmuteBtn = _el('unmute-all-btn');
  if (unmuteBtn) unmuteBtn.addEventListener('click', async () => {
    const res = await patchFetch('/api/v1/unmute-all', { method: 'POST' });
    if (res && res.ok) {
      if (appCfg) appCfg.output_muted = appCfg.output_muted.map(() => false);
      appCfg.zones.forEach((_, i) => updateZoneMuteBtn(i, false));
      updateMuteStatusBar();
      toast('All zones live', 'ok');
    }
  });
}

// ── WebSocket + meters ─────────────────────────────────────────────────────

let _ws = null;
let _wsTimer = null;

function initWS() {
  if (_ws) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  _ws = new WebSocket(proto + '//' + location.host + '/ws');

  _ws.onopen = () => {
    const dot = _el('ws-dot');
    const lbl = _el('ws-label');
    if (dot) dot.classList.add('connected');
    if (lbl) lbl.textContent = 'live';
    if (_wsTimer) { clearTimeout(_wsTimer); _wsTimer = null; }
  };

  const onDisconnect = () => {
    const dot = _el('ws-dot');
    const lbl = _el('ws-label');
    if (dot) dot.classList.remove('connected');
    if (lbl) lbl.textContent = 'connecting…';
    _ws = null;
    if (!_wsTimer) _wsTimer = setTimeout(initWS, 3000);
  };
  _ws.onclose = onDisconnect;
  _ws.onerror = onDisconnect;

  _ws.onmessage = (event) => {
    try { updateMeters(JSON.parse(event.data)); } catch {}
  };
}

function updateMeters(frame) {
  const rxRms = frame.rx_rms || [];
  const txRms = frame.tx_rms || [];

  rxRms.forEach((rms, i) => {
    const fill = _el('rm-' + i);
    if (!fill) return;
    fill.style.width = Math.min(rms * 100, 100) + '%';
    fill.className = 'src-meter-fill' + (rms > 0.9 ? ' clip' : rms > 0.7 ? ' hot' : '');
  });

  txRms.forEach((rms, i) => {
    const fill = _el('zm-' + i);
    if (!fill) return;
    fill.style.width = Math.min(rms * 100, 100) + '%';
    fill.className = 'zone-meter-fill' + (rms > 0.9 ? ' clip' : rms > 0.7 ? ' hot' : '');
  });
}

// ── Scenes ─────────────────────────────────────────────────────────────────

function initScenes() {
  const toggleBtn = _el('btn-scenes-toggle');
  if (toggleBtn) toggleBtn.addEventListener('click', () => {
    const panel = _el('scenes-panel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) loadScenes();
  });

  const closeBtn = _el('btn-close-scenes');
  if (closeBtn) closeBtn.addEventListener('click', () => {
    _el('scenes-panel').hidden = true;
  });

  const saveBtn = _el('btn-save-scene');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const nameInput = _el('scene-name-input');
    const name = nameInput ? nameInput.value.trim() : '';
    if (!name) { toast('Enter a scene name', 'warn'); return; }
    const res = await patchFetch('/api/v1/scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (res && res.ok) {
      toast('Scene "' + name + '" saved', 'ok');
      if (nameInput) nameInput.value = '';
      loadScenes();
    }
  });

  const nameInput = _el('scene-name-input');
  if (nameInput) nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const b = _el('btn-save-scene'); if (b) b.click(); }
  });
}

async function loadScenes() {
  const res = await patchFetch('/api/v1/scenes');
  if (!res || !res.ok) return;
  const data = await res.json();
  const scenes = data.scenes || [];
  const active = data.active || null;

  const activeNameEl = _el('active-scene-name');
  if (activeNameEl) activeNameEl.textContent = active || '—';

  const list = _el('scene-list');
  list.innerHTML = '';

  if (!scenes.length) {
    list.innerHTML = '<div style="font-size:11px;color:var(--text-dim);padding:8px 0">No scenes saved yet.</div>';
    return;
  }

  scenes.forEach(scene => {
    const row = document.createElement('div');
    row.className = 'scene-row' + (scene.name === active ? ' active' : '');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'scene-row-name';
    nameSpan.textContent = scene.name;

    const loadBtn = document.createElement('button');
    loadBtn.className = 'scene-btn load';
    loadBtn.textContent = 'LOAD';
    loadBtn.addEventListener('click', async () => {
      const r = await patchFetch(
        '/api/v1/scenes/' + encodeURIComponent(scene.name) + '/load',
        { method: 'POST' }
      );
      if (r && r.ok) {
        toast('Scene "' + scene.name + '" loaded', 'ok');
        const freshCfg = await fetch('/api/v1/config').then(r2 => r2.json());
        buildConsole(freshCfg);
        loadScenes();
      }
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'scene-btn del';
    delBtn.textContent = 'DEL';
    delBtn.addEventListener('click', async () => {
      if (!confirm('Delete scene "' + scene.name + '"?')) return;
      const r = await patchFetch(
        '/api/v1/scenes/' + encodeURIComponent(scene.name),
        { method: 'DELETE' }
      );
      if (r && r.ok) { toast('Deleted "' + scene.name + '"', 'ok'); loadScenes(); }
    });

    row.append(nameSpan, loadBtn, delBtn);
    list.appendChild(row);
  });
}

// ── Inline name editing ────────────────────────────────────────────────────

function makeEditable(el, onSave) {
  el.addEventListener('click', () => {
    if (el.querySelector('input')) return;
    const val = el.textContent;
    const input = document.createElement('input');
    input.value = val;
    el.textContent = '';
    el.appendChild(input);
    input.focus();
    input.select();

    const finish = async (save) => {
      const newVal = input.value.trim() || val;
      el.textContent = newVal;
      if (save && newVal !== val) {
        try {
          await onSave(newVal);
          toast('Renamed', 'ok');
        } catch {
          el.textContent = val;
          toast('Rename failed', 'err');
        }
      }
    };

    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { finish(false); }
    });
  });
}

/* ─────────────────────────────────────────────────────────────────────────
   DANTE PATCHBOX — app.js
   Plain vanilla JS — no framework, no build step.
   Design: debounced REST calls, optimistic UI, Canvas VU meters, WebSocket.
   ───────────────────────────────────────────────────────────────────────── */

'use strict';

const API  = '/api/v1';
const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

// ── Application State ─────────────────────────────────────────────────────

const state = {
  nInputs:  0,
  nOutputs: 0,
  matrix:   [],    // [nInputs][nOutputs] = gain (0..1), 0 = not routed
  inputs:   [],    // [{ label, mute, solo, gain_trim }]
  outputs:  [],    // [{ label, mute, master_gain }]
  meters: {
    inputs:  [],   // f32 dBFS
    outputs: [],
  },
};

// ── DOM refs ─────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const elApiStatus   = $('api-status');
const elWsStatus    = $('ws-status');
const elDeviceName  = $('device-name');
const elOutputLabels = $('output-labels');
const elMatrixRows   = $('matrix-rows');
const elMetersIn     = $('meters-inputs');
const elMetersOut    = $('meters-outputs');
const elSceneSelect  = $('scene-select');
const elSceneNameInput = $('scene-name-input');
const elToast        = $('toast');

// Gain fader tooltip
let gainTooltip = null;

// ── Toast ─────────────────────────────────────────────────────────────────

let toastTimer = null;
function toast(msg, type = 'ok') {
  elToast.textContent = msg;
  elToast.className   = `toast ${type} show`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { elToast.classList.remove('show'); }, 2500);
}

// ── API helpers ───────────────────────────────────────────────────────────

async function apiFetch(path, method = 'GET', body = undefined) {
  const opts = {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`${method} ${path} → ${res.status} ${txt}`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

// ── Debounce (same 80ms as inferno-iradio) ────────────────────────────────

function debounce(fn, ms = 80) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Initialise UI from state snapshot ────────────────────────────────────

function buildUI() {
  const { nInputs, nOutputs, inputs, outputs } = state;

  // Output label row
  elOutputLabels.innerHTML = '';
  const corner = document.createElement('div');
  corner.className = 'corner-cell';
  corner.textContent = 'IN\\OUT';
  elOutputLabels.appendChild(corner);

  for (let o = 0; o < nOutputs; o++) {
    const el = document.createElement('div');
    el.className = 'output-label';
    el.id = `out-label-${o}`;
    if (outputs[o]?.mute) el.classList.add('muted');

    const nameSpan = document.createElement('span');
    nameSpan.textContent = outputs[o]?.label || `O${o + 1}`;
    nameSpan.title = 'Left-click mute · Right-click master gain · Dbl-click rename';
    el.addEventListener('click', () => toggleOutputMute(o));
    el.addEventListener('dblclick', e => { e.stopPropagation(); renameChannel('output', o); });
    el.addEventListener('contextmenu', e => { e.preventDefault(); showMasterGainTooltip(o, el); });

    const fader = document.createElement('input');
    fader.type = 'range';
    fader.className = 'out-master-fader';
    fader.id = `out-gain-${o}`;
    fader.min = '0'; fader.max = '1'; fader.step = '0.01';
    fader.value = outputs[o]?.master_gain ?? 1.0;
    fader.title = `Master: ${gainLabel(outputs[o]?.master_gain ?? 1.0)} dB`;
    fader.addEventListener('click', e => e.stopPropagation());
    fader.addEventListener('input', e => {
      const g = parseFloat(fader.value);
      fader.title = `Master: ${gainLabel(g)} dB`;
      state.outputs[o] = state.outputs[o] || {};
      state.outputs[o].master_gain = g;
      sendOutputMasterGain(o, g);
    });

    el.appendChild(nameSpan);
    el.appendChild(fader);
    elOutputLabels.appendChild(el);
  }

  // Matrix rows
  elMatrixRows.innerHTML = '';
  for (let i = 0; i < nInputs; i++) {
    elMatrixRows.appendChild(buildInputRow(i));
  }

  // Meters
  buildMeters();
}

function buildInputRow(i) {
  const inp = state.inputs[i] || {};
  const row = document.createElement('div');
  row.className = 'matrix-row';
  row.id = `row-${i}`;

  // Strip
  const strip = document.createElement('div');
  strip.className = 'input-strip';

  const nameEl = document.createElement('span');
  nameEl.className = 'strip-name';
  nameEl.id = `in-name-${i}`;
  nameEl.textContent = inp.label || `IN ${i + 1}`;
  nameEl.title = 'Click to rename';
  nameEl.addEventListener('click', () => renameChannel('input', i));

  const btnM = document.createElement('button');
  btnM.className = 'btn-mute' + (inp.mute ? ' active' : '');
  btnM.textContent = 'M';
  btnM.title = 'Mute';
  btnM.id = `in-mute-${i}`;
  btnM.addEventListener('click', () => toggleInputMute(i));

  const btnS = document.createElement('button');
  btnS.className = 'btn-solo' + (inp.solo ? ' active' : '');
  btnS.textContent = 'S';
  btnS.title = 'Solo';
  btnS.id = `in-solo-${i}`;
  btnS.addEventListener('click', () => toggleInputSolo(i));

  // Gain trim fader (linear 0–1, displayed as dB)
  const fader = document.createElement('input');
  fader.type = 'range';
  fader.className = 'strip-fader';
  fader.id = `in-trim-${i}`;
  fader.min = '0'; fader.max = '1'; fader.step = '0.01';
  fader.value = inp.gain_trim ?? 1.0;
  fader.title = `Trim: ${gainLabel(inp.gain_trim ?? 1.0)} dB`;
  fader.addEventListener('input', () => {
    const g = parseFloat(fader.value);
    fader.title = `Trim: ${gainLabel(g)} dB`;
    sendInputGainTrim(i, g);
  });

  strip.appendChild(nameEl);
  strip.appendChild(btnM);
  strip.appendChild(btnS);
  strip.appendChild(fader);
  row.appendChild(strip);

  // Matrix cells
  for (let o = 0; o < state.nOutputs; o++) {
    row.appendChild(buildCell(i, o));
  }

  return row;
}

function buildCell(i, o) {
  const gain = (state.matrix[i] || [])[o] ?? 0;
  const active = gain > 0;

  const cell = document.createElement('div');
  cell.className = 'matrix-cell' + (active ? ' active' : '');
  cell.id = `cell-${i}-${o}`;
  // U-03: hover tooltip shows current gain in dB; updated by applyGain().
  cell.title = active ? `${gainLabel(gain)} dB (right-click to adjust)` : 'Click to route (right-click to set gain)';
  if (active) cell.setAttribute('data-gain', gainLabel(gain));

  cell.addEventListener('click', () => toggleCell(i, o));
  cell.addEventListener('contextmenu', e => { e.preventDefault(); showGainTooltip(i, o, cell); });

  return cell;
}

function gainLabel(g) {
  if (g <= 0) return '-∞';
  const db = 20 * Math.log10(g);
  return db.toFixed(1);
}

// ── Matrix cell toggle ────────────────────────────────────────────────────

async function toggleCell(i, o) {
  const current = (state.matrix[i] || [])[o] ?? 0;
  const newGain = current > 0 ? 0.0 : 1.0;

  // Optimistic update
  applyGain(i, o, newGain);

  try {
    await apiFetch(`/matrix/${i}/${o}`, 'PATCH', { gain: newGain });
  } catch (err) {
    // Revert
    applyGain(i, o, current);
    toast(`Error: ${err.message}`, 'err');
  }
}

function applyGain(i, o, gain) {
  if (!state.matrix[i]) state.matrix[i] = [];
  state.matrix[i][o] = gain;

  const cell = $(`cell-${i}-${o}`);
  if (!cell) return;

  const active = gain > 0;
  cell.classList.toggle('active', active);
  if (active) {
    cell.setAttribute('data-gain', gainLabel(gain));
    // U-03: keep hover title in sync with current gain
    cell.title = `${gainLabel(gain)} dB (right-click to adjust)`;
  } else {
    cell.removeAttribute('data-gain');
    cell.title = 'Click to route (right-click to set gain)';
  }
}

// ── Gain fader tooltip (right-click) ─────────────────────────────────────

const sendGain = debounce(async (i, o, gain) => {
  try {
    await apiFetch(`/matrix/${i}/${o}`, 'PATCH', { gain });
  } catch (err) {
    toast(`Gain error: ${err.message}`, 'err');
  }
});

function showMasterGainTooltip(o, el) {
  const fader = $(`out-gain-${o}`);
  if (fader) fader.focus();
}

function showGainTooltip(i, o, cellEl) {
  if (!gainTooltip) {
    gainTooltip = document.createElement('div');
    gainTooltip.className = 'gain-tooltip';
    gainTooltip.innerHTML =
      `<label id="gt-label"></label>` +
      `<input type="range" id="gt-range" min="0" max="1" step="0.01">` +
      `<span class="gain-value" id="gt-value"></span>`;
    document.body.appendChild(gainTooltip);

    document.addEventListener('click', e => {
      if (!gainTooltip.contains(e.target)) gainTooltip.classList.remove('visible');
    });

    const range = $('gt-range');
    range.addEventListener('input', e => {
      const g = parseFloat(e.target.value);
      $('gt-value').textContent = gainLabel(g) + ' dB';
      applyGain(gainTooltip._i, gainTooltip._o, g);
      sendGain(gainTooltip._i, gainTooltip._o, g);
    });
  }

  const rect = cellEl.getBoundingClientRect();
  gainTooltip.style.left = `${rect.left}px`;
  gainTooltip.style.top  = `${rect.bottom + 4}px`;

  const gain = (state.matrix[i] || [])[o] ?? 0;
  gainTooltip._i = i;
  gainTooltip._o = o;

  const inLabel  = state.inputs[i]?.label  || `IN ${i + 1}`;
  const outLabel = state.outputs[o]?.label || `OUT ${o + 1}`;
  $('gt-label').textContent = `${inLabel} → ${outLabel}`;
  $('gt-range').value       = gain;
  $('gt-value').textContent = gainLabel(gain) + ' dB';

  gainTooltip.classList.add('visible');
}

// ── Channel controls ─────────────────────────────────────────────────────

async function toggleInputMute(i) {
  const was = state.inputs[i]?.mute ?? false;
  state.inputs[i] = state.inputs[i] || {};
  state.inputs[i].mute = !was;
  updateStripButtons(i);

  try {
    await apiFetch(`/channels/input/${i}/mute`, 'POST');
  } catch (err) {
    state.inputs[i].mute = was;
    updateStripButtons(i);
    toast(`Error: ${err.message}`, 'err');
  }
}

async function toggleInputSolo(i) {
  const was = state.inputs[i]?.solo ?? false;
  state.inputs[i] = state.inputs[i] || {};
  state.inputs[i].solo = !was;
  updateStripButtons(i);

  try {
    await apiFetch(`/channels/input/${i}/solo`, 'POST');
  } catch (err) {
    state.inputs[i].solo = was;
    updateStripButtons(i);
    toast(`Error: ${err.message}`, 'err');
  }
}

function updateStripButtons(i) {
  const inp = state.inputs[i] || {};
  const btnM = $(`in-mute-${i}`);
  const btnS = $(`in-solo-${i}`);
  if (btnM) btnM.classList.toggle('active', !!inp.mute);
  if (btnS) btnS.classList.toggle('active', !!inp.solo);
}

async function toggleOutputMute(o) {
  const was = state.outputs[o]?.mute ?? false;
  state.outputs[o] = state.outputs[o] || {};
  state.outputs[o].mute = !was;
  const lbl = $(`out-label-${o}`);
  if (lbl) lbl.classList.toggle('muted', !was);

  try {
    await apiFetch(`/channels/output/${o}/mute`, 'POST');
  } catch (err) {
    state.outputs[o].mute = was;
    if (lbl) lbl.classList.toggle('muted', was);
    toast(`Error: ${err.message}`, 'err');
  }
}

const sendInputGainTrim = debounce(async (i, gain) => {
  try {
    await apiFetch(`/channels/input/${i}/gain_trim`, 'POST', { gain });
  } catch (err) {
    toast(`Trim error: ${err.message}`, 'err');
  }
});

const sendOutputMasterGain = debounce(async (o, gain) => {
  try {
    await apiFetch(`/channels/output/${o}/master_gain`, 'POST', { gain });
  } catch (err) {
    toast(`Master gain error: ${err.message}`, 'err');
  }
});

// ── Channel rename ────────────────────────────────────────────────────────

function renameChannel(type, id) {
  const current = type === 'input'
    ? (state.inputs[id]?.label || `IN ${id + 1}`)
    : (state.outputs[id]?.label || `OUT ${id + 1}`);

  const name = prompt(`Rename ${type} ${id + 1}:`, current);
  if (!name || name === current) return;

  const path = `/channels/${type}/${id}/name`;
  apiFetch(path, 'POST', { name })
    .then(() => {
      if (type === 'input') {
        state.inputs[id] = state.inputs[id] || {};
        state.inputs[id].label = name;
        const el = $(`in-name-${id}`);
        if (el) el.textContent = name;
        const meter = $(`meter-in-label-${id}`);
        if (meter) meter.textContent = name.slice(0, 5).toUpperCase();
      } else {
        state.outputs[id] = state.outputs[id] || {};
        state.outputs[id].label = name;
        const el = $(`out-label-${id}`);
        if (el) el.textContent = name;
        const meter = $(`meter-out-label-${id}`);
        if (meter) meter.textContent = name.slice(0, 5).toUpperCase();
      }
      toast(`Renamed to "${name}"`, 'ok');
    })
    .catch(err => toast(`Rename failed: ${err.message}`, 'err'));
}

// ── Meter DOM ─────────────────────────────────────────────────────────────

function buildMeters() {
  // Clear previous group content (keep label)
  while (elMetersIn.children.length > 1) elMetersIn.removeChild(elMetersIn.lastChild);
  while (elMetersOut.children.length > 1) elMetersOut.removeChild(elMetersOut.lastChild);

  for (let i = 0; i < state.nInputs; i++) {
    elMetersIn.appendChild(buildMeterRow('in', i, state.inputs[i]?.label));
  }
  for (let o = 0; o < state.nOutputs; o++) {
    elMetersOut.appendChild(buildMeterRow('out', o, state.outputs[o]?.label));
  }
}

// U-08: Peak-hold state — decays 0.5 dB/frame (~30 dB/sec at 60fps)
const peakHold = { inputs: [], outputs: [] };
const PEAK_DECAY = 0.5;

function buildMeterRow(dir, idx, label) {
  const row  = document.createElement('div');
  row.className = 'meter-row';

  const lbl  = document.createElement('div');
  lbl.className = 'meter-label';
  lbl.id = `meter-${dir}-label-${idx}`;
  lbl.textContent = (label || `${dir.toUpperCase()}${idx + 1}`).slice(0, 5).toUpperCase();

  // U-08: canvas replaces CSS bar
  const canvas = document.createElement('canvas');
  canvas.className = 'meter-canvas';
  canvas.id = `meter-${dir}-canvas-${idx}`;
  canvas.height = 10;

  row.appendChild(lbl);
  row.appendChild(canvas);
  return row;
}

// ── Meter paint (rAF loop) ────────────────────────────────────────────────

function dbToPercent(db) {
  // Map -60..0 dBFS to 0..100%
  return Math.max(0, Math.min(100, (db + 60) / 60 * 100));
}

function drawMeterCanvas(canvas, db, peak) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  const pct = Math.max(0, Math.min(1, (db + 60) / 60));
  const peakPct = Math.max(0, Math.min(1, (peak + 60) / 60));

  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = '#12121a';
  ctx.fillRect(0, 0, w, h);

  // Bar gradient: green → orange → red
  const barW = Math.round(pct * w);
  if (barW > 0) {
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0,    '#3aff6a');
    grad.addColorStop(0.75, '#ff9a3a');
    grad.addColorStop(1,    '#ff3a3a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, barW, h);
  }

  // Peak-hold line (white dot)
  const peakX = Math.round(peakPct * w);
  if (peakX > 1) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(peakX - 1, 0, 2, h);
  }
}

function paintMeters() {
  const { inputs, outputs } = state.meters;

  // Ensure peak arrays are sized
  if (peakHold.inputs.length  !== inputs.length)  peakHold.inputs  = new Array(inputs.length).fill(-60);
  if (peakHold.outputs.length !== outputs.length) peakHold.outputs = new Array(outputs.length).fill(-60);

  for (let i = 0; i < inputs.length; i++) {
    const db = inputs[i] ?? -60;
    if (db > peakHold.inputs[i]) peakHold.inputs[i] = db;
    else peakHold.inputs[i] = Math.max(-60, peakHold.inputs[i] - PEAK_DECAY);
    const canvas = $(`meter-in-canvas-${i}`);
    if (canvas) {
      canvas.width = canvas.parentElement?.offsetWidth - 48 || 100;
      drawMeterCanvas(canvas, db, peakHold.inputs[i]);
    }
  }
  for (let o = 0; o < outputs.length; o++) {
    const db = outputs[o] ?? -60;
    if (db > peakHold.outputs[o]) peakHold.outputs[o] = db;
    else peakHold.outputs[o] = Math.max(-60, peakHold.outputs[o] - PEAK_DECAY);
    const canvas = $(`meter-out-canvas-${o}`);
    if (canvas) {
      canvas.width = canvas.parentElement?.offsetWidth - 48 || 100;
      drawMeterCanvas(canvas, db, peakHold.outputs[o]);
    }
  }

  requestAnimationFrame(paintMeters);
}

// ── WebSocket ─────────────────────────────────────────────────────────────

let ws = null;
let wsRetryMs = 1000;
let wsReconnectTimer = null;

function connectWS() {
  ws = new WebSocket(WS_URL);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    wsRetryMs = 1000;
    setWsStatus('online');
    showToast('Connected', 1500);
  };

  ws.onclose = () => {
    setWsStatus('reconnecting');
    // Exponential backoff with ±20% jitter to avoid thundering herd from many tablets.
    const jitter = wsRetryMs * 0.2 * (Math.random() * 2 - 1);
    wsReconnectTimer = setTimeout(connectWS, wsRetryMs + jitter);
    wsRetryMs = Math.min(wsRetryMs * 2, 30000);
  };

  ws.onerror = () => ws.close();

  ws.onmessage = e => {
    if (e.data instanceof ArrayBuffer) {
      // Binary metering frame: [nInputs f32s, nOutputs f32s]
      const view = new Float32Array(e.data);
      const ni = state.nInputs;
      const no = state.nOutputs;
      state.meters.inputs  = Array.from(view.slice(0, ni));
      state.meters.outputs = Array.from(view.slice(ni, ni + no));
    } else {
      // JSON control message
      try {
        const msg = JSON.parse(e.data);
        if (msg.op === 'snapshot') applySnapshot(msg.state);
      } catch (err) {
        console.warn('WS JSON parse error', err);
      }
    }
  };
}

function setWsStatus(mode) {
  const labels = { online: 'WS ONLINE', offline: 'WS OFFLINE', reconnecting: 'WS RECONNECTING…' };
  const cls    = { online: 'badge--online', offline: 'badge--offline', reconnecting: 'badge--warn' };
  elWsStatus.textContent = labels[mode] ?? 'WS OFFLINE';
  elWsStatus.className   = 'badge ' + (cls[mode] ?? 'badge--offline');
}

// ── Snapshot application ──────────────────────────────────────────────────

function applySnapshot(snap) {
  if (!snap) return;

  state.nInputs  = snap.matrix?.inputs  ?? state.nInputs;
  state.nOutputs = snap.matrix?.outputs ?? state.nOutputs;

  // API sends gains as Vec<Vec<f32>> (2D nested array, row-major)
  state.matrix = [];
  const gains = snap.matrix?.gains ?? [];
  for (let i = 0; i < state.nInputs; i++) {
    state.matrix[i] = [];
    for (let o = 0; o < state.nOutputs; o++) {
      state.matrix[i][o] = (gains[i] ?? [])[o] ?? 0;
    }
  }

  state.inputs  = snap.inputs  ?? [];
  state.outputs = snap.outputs ?? [];
  state.meters.inputs  = new Array(state.nInputs).fill(-60);
  state.meters.outputs = new Array(state.nOutputs).fill(-60);

  buildUI();
}

// ── Scene management ──────────────────────────────────────────────────────

async function loadSceneList(selectName = null) {
  try {
    const names = await apiFetch('/scenes');
    if (!Array.isArray(names)) return;
    const prev = selectName ?? elSceneSelect.value;
    elSceneSelect.innerHTML = '<option value="">— select —</option>' +
      names.map(n => `<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('');
    if (prev && names.includes(prev)) elSceneSelect.value = prev;
  } catch (_) {}
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

$('btn-load-scene').addEventListener('click', async () => {
  const name = elSceneSelect.value;
  if (!name) { toast('Select a scene first', 'err'); return; }
  try {
    await apiFetch(`/scenes/${encodeURIComponent(name)}`);
    const full = await apiFetch('/state');
    if (full) applySnapshot(full);
    toast(`Loaded scene "${name}"`, 'ok');
  } catch (err) {
    toast(`Load failed: ${err.message}`, 'err');
  }
});

$('btn-delete-scene').addEventListener('click', async () => {
  const name = elSceneSelect.value;
  if (!name) { toast('Select a scene to delete', 'err'); return; }
  if (!confirm(`Delete scene "${name}"?`)) return;
  try {
    await apiFetch(`/scenes/${encodeURIComponent(name)}`, 'DELETE');
    toast(`Deleted scene "${name}"`, 'ok');
    loadSceneList();
  } catch (err) {
    // Server may not yet support DELETE — show a graceful message
    toast(`Delete not supported yet`, 'err');
  }
});

async function saveScene() {
  const name = elSceneNameInput.value.trim();
  if (!name) { toast('Enter a scene name', 'err'); return; }
  try {
    await apiFetch('/scenes', 'POST', { name });
    toast(`Saved "${name}"`, 'ok');
    elSceneNameInput.value = '';
    loadSceneList(name);
  } catch (err) {
    toast(`Save failed: ${err.message}`, 'err');
  }
}

$('btn-save-scene').addEventListener('click', saveScene);

elSceneNameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') saveScene();
});

// ── Boot ──────────────────────────────────────────────────────────────────

async function boot() {
  // Check API health
  try {
    const health = await apiFetch('/health');
    elApiStatus.textContent = '[ONLINE]';
    elApiStatus.className   = 'badge badge--online';
    elDeviceName.textContent = health.device_name || 'patchbox';
    state.nInputs  = health.inputs;
    state.nOutputs = health.outputs;
  } catch (err) {
    elApiStatus.textContent = '[OFFLINE]';
    elApiStatus.className   = 'badge badge--offline';
    console.error('API health failed', err);
    setTimeout(boot, 3000);
    return;
  }

  // Fetch full state
  try {
    const full = await apiFetch('/state');
    if (full) applySnapshot(full);
    else buildUI();
  } catch (err) {
    console.warn('state fetch failed', err);
    buildUI();
  }

  // Load scene list
  loadSceneList();

  // Connect WebSocket
  connectWS();

  // Start meter paint loop
  requestAnimationFrame(paintMeters);
}

boot();

// ── U-02: Keyboard navigation ─────────────────────────────────────────────

const focus = { row: 0, col: 0 };

function focusCell(r, c) {
  // Remove old focus ring
  document.querySelectorAll('.matrix-cell.kb-focus').forEach(el => el.classList.remove('kb-focus'));
  focus.row = Math.max(0, Math.min(state.nInputs  - 1, r));
  focus.col = Math.max(0, Math.min(state.nOutputs - 1, c));
  const cell = $(`cell-${focus.row}-${focus.col}`);
  if (cell) { cell.classList.add('kb-focus'); cell.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
}

document.addEventListener('keydown', async e => {
  // Ignore when typing in input fields
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

  switch (e.key) {
    case 'ArrowUp':    e.preventDefault(); focusCell(focus.row - 1, focus.col); break;
    case 'ArrowDown':  e.preventDefault(); focusCell(focus.row + 1, focus.col); break;
    case 'ArrowLeft':  e.preventDefault(); focusCell(focus.row, focus.col - 1); break;
    case 'ArrowRight': e.preventDefault(); focusCell(focus.row, focus.col + 1); break;
    case 'Enter':
    case ' ':
      e.preventDefault();
      await toggleCell(focus.row, focus.col);
      break;
    case 'm':
    case 'M':
      e.preventDefault();
      await toggleInputMute(focus.row);
      break;
    case 's':
    case 'S':
      e.preventDefault();
      await toggleInputSolo(focus.row);
      break;
  }
});

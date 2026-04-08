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
  inputs:   [],    // [{ label, mute, solo, gain_trim, eq }]
  outputs:  [],    // [{ label, mute, master_gain, compressor }]
  inputOrder:  [], // U-09: display permutation for inputs
  outputOrder: [], // U-09: display permutation for outputs
  danteRxActive: [], // D-04: per-input Dante flow activity (bool[])
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

// ── Undo / Redo Stack (U-05) ──────────────────────────────────────────────
//
// Records matrix cell changes as {type, i, o, prev, next} snapshots.
// Max 50 entries. Ctrl+Z undoes, Ctrl+Shift+Z or Ctrl+Y redoes.

const undoStack = [];
const redoStack = [];
const UNDO_MAX  = 50;

function recordUndo(entry) {
  undoStack.push(entry);
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  redoStack.length = 0; // new action clears redo history
  updateUndoIndicator();
}

function updateUndoIndicator() {
  const el = $('undo-indicator');
  if (el) el.textContent = undoStack.length ? `↩ ${undoStack.length}` : '';
}

async function performUndo() {
  const entry = undoStack.pop();
  if (!entry) { toast('Nothing to undo', 'err'); return; }
  redoStack.push(entry);
  applyGain(entry.i, entry.o, entry.prev);
  try {
    await apiFetch(`/matrix/${entry.i}/${entry.o}`, 'PATCH', { gain: entry.prev });
    toast(`Undo: ${gainLabel(entry.prev)} dB`, 'ok');
  } catch (err) {
    applyGain(entry.i, entry.o, entry.next);
    undoStack.push(entry);
    redoStack.pop();
    toast(`Undo failed: ${err.message}`, 'err');
  }
  updateUndoIndicator();
}

async function performRedo() {
  const entry = redoStack.pop();
  if (!entry) { toast('Nothing to redo', 'err'); return; }
  undoStack.push(entry);
  applyGain(entry.i, entry.o, entry.next);
  try {
    await apiFetch(`/matrix/${entry.i}/${entry.o}`, 'PATCH', { gain: entry.next });
    toast(`Redo: ${gainLabel(entry.next)} dB`, 'ok');
  } catch (err) {
    applyGain(entry.i, entry.o, entry.prev);
    redoStack.push(entry);
    undoStack.pop();
    toast(`Redo failed: ${err.message}`, 'err');
  }
  updateUndoIndicator();
}



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
  // Ensure order arrays are populated
  if (!state.inputOrder  || state.inputOrder.length  !== nInputs)  state.inputOrder  = Array.from({length: nInputs},  (_, i) => i);
  if (!state.outputOrder || state.outputOrder.length !== nOutputs) state.outputOrder = Array.from({length: nOutputs}, (_, o) => o);

  // Output label row (rendered in outputOrder)
  elOutputLabels.innerHTML = '';
  const corner = document.createElement('div');
  corner.className = 'corner-cell';
  corner.textContent = 'IN\\OUT';
  elOutputLabels.appendChild(corner);

  for (let rank = 0; rank < nOutputs; rank++) {
    const o = state.outputOrder[rank];
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

    // D-06: Compressor button per output
    const btnComp = document.createElement('button');
    btnComp.className = 'btn-icon' + (outputs[o]?.compressor?.enabled ? ' active' : '');
    btnComp.textContent = 'C';
    btnComp.title = 'Compressor/limiter';
    btnComp.addEventListener('click', e => { e.stopPropagation(); openCompModal(o); });

    el.appendChild(nameSpan);
    el.appendChild(fader);
    el.appendChild(btnComp);
    elOutputLabels.appendChild(el);
  }

  // Matrix rows (rendered in inputOrder)
  elMatrixRows.innerHTML = '';
  for (let rank = 0; rank < nInputs; rank++) {
    const i = state.inputOrder[rank];
    elMatrixRows.appendChild(buildInputRow(i, rank));
  }

  // Meters
  buildMeters();
}

function buildInputRow(i, rank) {
  const inp = state.inputs[i] || {};
  const row = document.createElement('div');
  row.className = 'matrix-row';
  row.id = `row-${i}`;
  // U-09: drag-and-drop reorder
  row.draggable = true;
  row.dataset.index = i;
  row.addEventListener('dragstart', e => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(i));
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', () => row.classList.remove('dragging'));
  row.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; row.classList.add('drag-over'); });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  row.addEventListener('drop', async e => {
    e.preventDefault();
    row.classList.remove('drag-over');
    const draggedIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (isNaN(draggedIdx) || draggedIdx === i) return;
    // Swap positions in inputOrder
    const order = [...state.inputOrder];
    const fromRank = order.indexOf(draggedIdx);
    const toRank   = order.indexOf(i);
    if (fromRank === -1 || toRank === -1) return;
    order.splice(fromRank, 1);
    order.splice(toRank, 0, draggedIdx);
    state.inputOrder = order;
    buildUI();
    try {
      await apiFetch('/channels/input/reorder', 'POST', { order });
    } catch (err) {
      toast('Reorder failed: ' + err.message, 'err');
    }
  });

  // Strip
  const strip = document.createElement('div');
  strip.className = 'input-strip';

  const nameEl = document.createElement('span');
  nameEl.className = 'strip-name';
  nameEl.id = `in-name-${i}`;
  nameEl.textContent = inp.label || `IN ${i + 1}`;
  nameEl.title = 'Click to rename';
  nameEl.addEventListener('click', () => renameChannel('input', i));

  // D-04: Dante RX activity indicator dot
  const dotEl = document.createElement('span');
  dotEl.className = 'dante-dot' + (state.danteRxActive[i] ? ' active' : '');
  dotEl.id = `in-dot-${i}`;
  dotEl.title = state.danteRxActive[i] ? 'Dante flow active' : 'No Dante flow';

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

  // D-05: EQ button per input
  const btnEq = document.createElement('button');
  btnEq.className = 'btn-icon' + (inp.eq?.enabled ? ' active' : '');
  btnEq.textContent = 'EQ';
  btnEq.title = 'Parametric EQ';
  btnEq.id = `in-eq-${i}`;
  btnEq.addEventListener('click', () => openEqModal(i));

  strip.appendChild(nameEl);
  strip.appendChild(dotEl);
  strip.appendChild(btnM);
  strip.appendChild(btnS);
  strip.appendChild(fader);
  strip.appendChild(btnEq);
  row.appendChild(strip);

  // Matrix cells — rendered in outputOrder
  for (let rank = 0; rank < state.nOutputs; rank++) {
    const o = state.outputOrder[rank];
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
  recordUndo({ i, o, prev: current, next: newGain });

  try {
    await apiFetch(`/matrix/${i}/${o}`, 'PATCH', { gain: newGain });
  } catch (err) {
    // Revert
    applyGain(i, o, current);
    undoStack.pop();
    updateUndoIndicator();
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
      if (!gainTooltip.contains(e.target)) {
        // U-05: record undo entry if gain changed while tooltip was open
        const i = gainTooltip._i;
        const o = gainTooltip._o;
        const after = (state.matrix[i] || [])[o] ?? 0;
        if (gainTooltip._gainBefore !== undefined && gainTooltip._gainBefore !== after) {
          recordUndo({ i, o, prev: gainTooltip._gainBefore, next: after });
          gainTooltip._gainBefore = after;
        }
        gainTooltip.classList.remove('visible');
      }
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
  gainTooltip._gainBefore = gain; // U-05: capture for undo on close

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
  // U-09: Preserve server-provided channel order (or default identity order).
  state.inputOrder  = snap.input_order  ?? Array.from({length: state.nInputs},  (_, i) => i);
  state.outputOrder = snap.output_order ?? Array.from({length: state.nOutputs}, (_, o) => o);
  // D-04: Dante RX activity per input channel (array of bool)
  state.danteRxActive = snap.dante_rx_active ?? new Array(state.nInputs).fill(false);
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
    await apiFetch(`/scenes/${encodeURIComponent(name)}/load`, 'POST');
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

// ── U-06: Scene diff ─────────────────────────────────────────────────────

$('btn-diff-scene').addEventListener('click', async () => {
  const name = elSceneSelect.value;
  if (!name) { toast('Select a scene to diff against', 'err'); return; }

  let saved;
  try {
    saved = await apiFetch(`/scenes/${encodeURIComponent(name)}`);
  } catch (err) {
    toast(`Cannot load scene for diff: ${err.message}`, 'err');
    return;
  }

  const cur = state;
  const diffs = [];

  // Compare matrix gains
  for (let i = 0; i < cur.nInputs; i++) {
    for (let o = 0; o < cur.nOutputs; o++) {
      const curGain  = (cur.matrix[i] || [])[o] ?? 0;
      const savedGain = ((saved.params?.matrix?.gains || [])[i] || [])[o] ?? 0;
      if (Math.abs(curGain - savedGain) > 0.001) {
        const inLabel  = cur.inputs[i]?.label  || `IN ${i + 1}`;
        const outLabel = cur.outputs[o]?.label || `OUT ${o + 1}`;
        diffs.push({
          label: `${inLabel} → ${outLabel}`,
          prev: `${gainLabel(savedGain)} dB`,
          next: `${gainLabel(curGain)} dB`,
          type: 'matrix',
        });
      }
    }
  }

  // Compare input mutes/solos
  for (let i = 0; i < cur.nInputs; i++) {
    const ci = cur.inputs[i] || {};
    const si = (saved.params?.inputs || [])[i] || {};
    const inLabel = ci.label || `IN ${i + 1}`;
    if (ci.mute !== si.mute) diffs.push({ label: inLabel, prev: si.mute ? 'muted' : 'live', next: ci.mute ? 'muted' : 'live', type: 'mute' });
    if (ci.solo !== si.solo) diffs.push({ label: inLabel, prev: si.solo ? 'solo' : '—', next: ci.solo ? 'solo' : '—', type: 'solo' });
  }

  // Compare output mutes
  for (let o = 0; o < cur.nOutputs; o++) {
    const co = cur.outputs[o] || {};
    const so = (saved.params?.outputs || [])[o] || {};
    const outLabel = co.label || `OUT ${o + 1}`;
    if (co.mute !== so.mute) diffs.push({ label: outLabel, prev: so.mute ? 'muted' : 'live', next: co.mute ? 'muted' : 'live', type: 'mute' });
  }

  $('diff-title').textContent = `Diff: current vs "${name}"`;
  const body = $('diff-body');
  if (diffs.length === 0) {
    body.innerHTML = '<p class="diff-none">No differences — current state matches the saved scene.</p>';
  } else {
    body.innerHTML = diffs.map(d =>
      `<div class="diff-row diff-${d.type}">` +
      `<span class="diff-label">${d.label}</span>` +
      `<span class="diff-prev">${d.prev}</span>` +
      `<span class="diff-arrow">→</span>` +
      `<span class="diff-next">${d.next}</span>` +
      `</div>`
    ).join('');
  }
  $('diff-modal').classList.remove('hidden');
});

$('btn-diff-close').addEventListener('click', () => {
  $('diff-modal').classList.add('hidden');
});

$('diff-modal').addEventListener('click', e => {
  if (e.target === $('diff-modal')) $('diff-modal').classList.add('hidden');
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

  // U-05: Undo / Redo
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      if (e.shiftKey) { await performRedo(); } else { await performUndo(); }
      return;
    }
    if (e.key === 'y' || e.key === 'Y') {
      e.preventDefault();
      await performRedo();
      return;
    }
  }

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

// ── D-05: Parametric EQ modal ─────────────────────────────────────────────

const EQ_BAND_TYPES = ['low_shelf', 'peak', 'high_shelf'];
const EQ_BAND_LABELS = ['Low Shelf', 'Peak', 'High Shelf'];

function openEqModal(channelIdx) {
  const inp   = state.inputs[channelIdx] || {};
  const eq    = inp.eq || { enabled: false, bands: [] };
  const modal = document.getElementById('eq-modal');
  modal.dataset.channel = channelIdx;

  document.getElementById('eq-modal-title').textContent = `EQ — ${inp.label || 'IN ' + (channelIdx + 1)}`;
  document.getElementById('eq-enabled').checked = eq.enabled || false;

  const defaults = [
    { band_type: 'low_shelf',  freq_hz:   100, gain_db: 0, q: 0.707 },
    { band_type: 'peak',       freq_hz:   500, gain_db: 0, q: 1.0   },
    { band_type: 'peak',       freq_hz:  3000, gain_db: 0, q: 1.0   },
    { band_type: 'high_shelf', freq_hz: 10000, gain_db: 0, q: 0.707 },
  ];

  for (let b = 0; b < 4; b++) {
    const band = (eq.bands || [])[b] || defaults[b];
    document.getElementById(`eq-b${b}-enabled`).checked = band.enabled || false;
    document.getElementById(`eq-b${b}-type`).value    = band.band_type || defaults[b].band_type;
    document.getElementById(`eq-b${b}-freq`).value    = band.freq_hz   || defaults[b].freq_hz;
    document.getElementById(`eq-b${b}-gain`).value    = band.gain_db   || 0;
    document.getElementById(`eq-b${b}-q`).value       = band.q         || defaults[b].q;
    document.getElementById(`eq-b${b}-freq-val`).textContent = Math.round(band.freq_hz || defaults[b].freq_hz) + ' Hz';
    document.getElementById(`eq-b${b}-gain-val`).textContent = (band.gain_db || 0).toFixed(1) + ' dB';
    document.getElementById(`eq-b${b}-q-val`).textContent    = (band.q || defaults[b].q).toFixed(2);
  }

  modal.style.display = 'flex';
}

document.getElementById('eq-modal-close').addEventListener('click', () => {
  document.getElementById('eq-modal').style.display = 'none';
});

document.getElementById('eq-modal-apply').addEventListener('click', async () => {
  const modal = document.getElementById('eq-modal');
  const ch    = parseInt(modal.dataset.channel, 10);

  const defaults = [
    { band_type: 'low_shelf',  freq_hz:   100, q: 0.707 },
    { band_type: 'peak',       freq_hz:   500, q: 1.0   },
    { band_type: 'peak',       freq_hz:  3000, q: 1.0   },
    { band_type: 'high_shelf', freq_hz: 10000, q: 0.707 },
  ];

  const bands = Array.from({length: 4}, (_, b) => ({
    enabled:   document.getElementById(`eq-b${b}-enabled`).checked,
    band_type: document.getElementById(`eq-b${b}-type`).value,
    freq_hz:   parseFloat(document.getElementById(`eq-b${b}-freq`).value) || defaults[b].freq_hz,
    gain_db:   parseFloat(document.getElementById(`eq-b${b}-gain`).value) || 0,
    q:         parseFloat(document.getElementById(`eq-b${b}-q`).value)    || defaults[b].q,
  }));

  const eqParams = {
    enabled: document.getElementById('eq-enabled').checked,
    bands,
  };

  try {
    await apiFetch(`/channels/input/${ch}/eq`, 'POST', eqParams);
    state.inputs[ch] = state.inputs[ch] || {};
    state.inputs[ch].eq = eqParams;
    const btnEq = document.getElementById(`in-eq-${ch}`);
    if (btnEq) btnEq.classList.toggle('active', eqParams.enabled);
    toast('EQ updated', 'ok');
    modal.style.display = 'none';
  } catch (err) {
    toast('EQ update failed: ' + err.message, 'err');
  }
});

// Live label updates for EQ sliders
for (let b = 0; b < 4; b++) {
  const freqEl = document.getElementById(`eq-b${b}-freq`);
  const gainEl = document.getElementById(`eq-b${b}-gain`);
  const qEl    = document.getElementById(`eq-b${b}-q`);
  if (freqEl) freqEl.addEventListener('input', () => {
    document.getElementById(`eq-b${b}-freq-val`).textContent = Math.round(parseFloat(freqEl.value)) + ' Hz';
  });
  if (gainEl) gainEl.addEventListener('input', () => {
    document.getElementById(`eq-b${b}-gain-val`).textContent = parseFloat(gainEl.value).toFixed(1) + ' dB';
  });
  if (qEl) qEl.addEventListener('input', () => {
    document.getElementById(`eq-b${b}-q-val`).textContent = parseFloat(qEl.value).toFixed(2);
  });
}

// ── D-06: Compressor modal ────────────────────────────────────────────────

function openCompModal(outputIdx) {
  const out   = state.outputs[outputIdx] || {};
  const comp  = out.compressor || {};
  const modal = document.getElementById('comp-modal');
  modal.dataset.channel = outputIdx;

  document.getElementById('comp-modal-title').textContent = `Compressor — ${out.label || 'OUT ' + (outputIdx + 1)}`;
  document.getElementById('comp-enabled').checked         = comp.enabled        || false;
  document.getElementById('comp-threshold').value         = comp.threshold_db   ?? -12;
  document.getElementById('comp-ratio').value             = comp.ratio          ?? 4;
  document.getElementById('comp-attack').value            = comp.attack_ms      ?? 10;
  document.getElementById('comp-release').value           = comp.release_ms     ?? 100;
  document.getElementById('comp-makeup').value            = comp.makeup_gain_db ?? 0;

  document.getElementById('comp-threshold-val').textContent = (comp.threshold_db   ?? -12).toFixed(1) + ' dB';
  document.getElementById('comp-ratio-val').textContent     = (comp.ratio          ?? 4  ).toFixed(1) + ':1';
  document.getElementById('comp-attack-val').textContent    = (comp.attack_ms      ?? 10 ).toFixed(1) + ' ms';
  document.getElementById('comp-release-val').textContent   = (comp.release_ms     ?? 100).toFixed(0) + ' ms';
  document.getElementById('comp-makeup-val').textContent    = (comp.makeup_gain_db ?? 0  ).toFixed(1) + ' dB';

  modal.style.display = 'flex';
}

document.getElementById('comp-modal-close').addEventListener('click', () => {
  document.getElementById('comp-modal').style.display = 'none';
});

document.getElementById('comp-modal-apply').addEventListener('click', async () => {
  const modal = document.getElementById('comp-modal');
  const ch    = parseInt(modal.dataset.channel, 10);

  const compParams = {
    enabled:        document.getElementById('comp-enabled').checked,
    threshold_db:   parseFloat(document.getElementById('comp-threshold').value),
    ratio:          parseFloat(document.getElementById('comp-ratio').value),
    attack_ms:      parseFloat(document.getElementById('comp-attack').value),
    release_ms:     parseFloat(document.getElementById('comp-release').value),
    makeup_gain_db: parseFloat(document.getElementById('comp-makeup').value),
  };

  try {
    await apiFetch(`/channels/output/${ch}/compressor`, 'POST', compParams);
    state.outputs[ch] = state.outputs[ch] || {};
    state.outputs[ch].compressor = compParams;
    toast('Compressor updated', 'ok');
    modal.style.display = 'none';
  } catch (err) {
    toast('Compressor update failed: ' + err.message, 'err');
  }
});

// Live label updates for compressor sliders
['threshold', 'ratio', 'attack', 'release', 'makeup'].forEach(name => {
  const el = document.getElementById(`comp-${name}`);
  if (!el) return;
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    const valEl = document.getElementById(`comp-${name}-val`);
    if (!valEl) return;
    if (name === 'ratio')   valEl.textContent = v.toFixed(1) + ':1';
    else if (name === 'attack')   valEl.textContent = v.toFixed(1) + ' ms';
    else if (name === 'release')  valEl.textContent = v.toFixed(0) + ' ms';
    else                          valEl.textContent = v.toFixed(1) + ' dB';
  });
});

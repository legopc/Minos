/* ─────────────────────────────────────────────────────────────────────────
   DANTE PATCHBOX — app.js
   Plain vanilla JS — no framework, no build step.
   Design: debounced REST calls, optimistic UI, Canvas VU meters, WebSocket.
   ───────────────────────────────────────────────────────────────────────── */

'use strict';

// W-50: Register service worker for PWA/offline support
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

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

// Gain fader tooltip
let gainTooltip = null;

// ── Toast (W-59: stacking toasts) ─────────────────────────────────────────

function toast(msg, type = 'ok') {
  const container = document.getElementById('toast-container');
  // Fallback to legacy #toast if container not available
  if (!container) {
    const el = document.getElementById('toast');
    if (el) {
      el.textContent = msg;
      el.className = `toast ${type} show`;
      setTimeout(() => el.classList.remove('show'), 2500);
    }
    return;
  }
  const el = document.createElement('span');
  el.className = `toast ${type} show`;
  el.textContent = msg;
  container.appendChild(el);
  // Auto-remove after 2.5s
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, 2500);
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

// ── Row AbortController registry (BUG-W03: event listener cleanup) ───────
// Each row registers an AbortController. On buildUI() rebuild, all controllers
// are aborted before clearing innerHTML, preventing listener accumulation.

const rowControllers = new Map(); // inputIdx → AbortController
const outControllers = new Map(); // outputIdx → AbortController

function abortRowControllers() {
  rowControllers.forEach(ac => ac.abort());
  rowControllers.clear();
  outControllers.forEach(ac => ac.abort());
  outControllers.clear();
}

// ── Meter width cache (W-47: avoid offsetWidth reflow inside rAF) ─────────
// Cached per canvas id; cleared on resize so stale widths aren't used.

const meterWidthCache = new Map();
window.addEventListener('resize', () => meterWidthCache.clear());

function getMeterWidth(canvas) {
  if (!meterWidthCache.has(canvas.id)) {
    meterWidthCache.set(canvas.id, (canvas.parentElement?.offsetWidth ?? 148) - 48);
  }
  return meterWidthCache.get(canvas.id);
}

// ── W-21: Haptic feedback ──────────────────────────────────────────────────
function haptic(ms = 30) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

// ── W-05: Solo count tracking ──────────────────────────────────────────────
function updateSoloUI() {
  const count = state.inputs.filter(inp => inp?.solo).length;
  const badge = $('solo-count');
  const btn   = $('btn-clear-solos');
  if (badge) {
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
  }
  if (btn) btn.classList.toggle('hidden', count === 0);
}

// ── W-17: Fader lock ──────────────────────────────────────────────────────
let faderLocked = false;

function setFaderLock(locked) {
  faderLocked = locked;
  const btn = $('btn-fader-lock');
  if (btn) btn.classList.toggle('fader-locked', locked);
  // Update all strip faders
  document.querySelectorAll('.strip-fader, .out-master-fader').forEach(el => {
    el.disabled = locked;
  });
  toast(locked ? 'Faders locked' : 'Faders unlocked', locked ? 'err' : 'ok');
}

// Fader lock toggle button — 200ms press-and-hold to prevent accidents
{
  let lockTimer = null;
  document.addEventListener('DOMContentLoaded', () => {
    const btn = $('btn-fader-lock');
    if (!btn) return;
    const startHold = () => { lockTimer = setTimeout(() => { setFaderLock(!faderLocked); lockTimer = null; }, 200); };
    const cancelHold = () => { if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; } };
    btn.addEventListener('pointerdown', startHold);
    btn.addEventListener('pointerup',   cancelHold);
    btn.addEventListener('pointerleave', cancelHold);
    // Regular click as fallback for desktop
    btn.addEventListener('click', () => setFaderLock(!faderLocked));
  });
}

// ── W-18: Kiosk / screen lock ─────────────────────────────────────────────
function setKioskLock(locked) {
  const overlay = $('kiosk-overlay');
  if (overlay) overlay.classList.toggle('hidden', !locked);
  haptic(locked ? 50 : 20);
}

document.addEventListener('DOMContentLoaded', () => {
  const btnLock   = $('btn-kiosk-lock');
  const btnUnlock = $('btn-kiosk-unlock');
  if (btnLock)   btnLock.addEventListener('click',   () => setKioskLock(true));
  if (btnUnlock) btnUnlock.addEventListener('click', () => setKioskLock(false));

  // W-05: Clear all solos button
  const btnClearSolos = $('btn-clear-solos');
  if (btnClearSolos) btnClearSolos.addEventListener('click', async () => {
    haptic();
    for (let i = 0; i < state.nInputs; i++) {
      if (state.inputs[i]?.solo) {
        state.inputs[i].solo = false;
        try { await apiFetch(`/channels/input/${i}/solo`, 'POST', { solo: false }); } catch (_) {}
      }
    }
    buildUI();
    updateSoloUI();
  });
});

// ── Initialise UI from state snapshot ────────────────────────────────────

function buildUI() {
  const { nInputs, nOutputs, inputs, outputs } = state;
  // Ensure order arrays are populated
  if (!state.inputOrder  || state.inputOrder.length  !== nInputs)  state.inputOrder  = Array.from({length: nInputs},  (_, i) => i);
  if (!state.outputOrder || state.outputOrder.length !== nOutputs) state.outputOrder = Array.from({length: nOutputs}, (_, o) => o);

  // Abort all previous row/output controllers to clean up event listeners (BUG-W03)
  abortRowControllers();

  // Output label row (rendered in outputOrder)
  elOutputLabels.innerHTML = '';
  const corner = document.createElement('div');
  corner.className = 'corner-cell';
  corner.textContent = 'IN\\OUT';
  elOutputLabels.appendChild(corner);

  for (let rank = 0; rank < nOutputs; rank++) {
    const o = state.outputOrder[rank];
    const ac = new AbortController();
    outControllers.set(o, ac);
    const sig = ac.signal;

    const el = document.createElement('div');
    el.className = 'output-label';
    el.id = `out-label-${o}`;
    if (outputs[o]?.mute) el.classList.add('muted');

    const nameSpan = document.createElement('span');
    nameSpan.textContent = outputs[o]?.label || `O${o + 1}`;
    nameSpan.title = 'Left-click mute · Right-click master gain · Dbl-click rename';
    el.addEventListener('click', () => toggleOutputMute(o), { signal: sig });
    el.addEventListener('dblclick', e => { e.stopPropagation(); renameChannel('output', o); }, { signal: sig });
    el.addEventListener('contextmenu', e => { e.preventDefault(); showMasterGainTooltip(o, el); }, { signal: sig });
    // W-11: column highlight on hover
    el.addEventListener('mouseenter', () => addColHighlight(o), { signal: sig });
    el.addEventListener('mouseleave', () => removeColHighlight(o), { signal: sig });

    const fader = document.createElement('input');
    fader.type = 'range';
    fader.className = 'out-master-fader';
    fader.id = `out-gain-${o}`;
    fader.min = '0'; fader.max = '1'; fader.step = '0.01';
    fader.value = outputs[o]?.master_gain ?? 1.0;
    fader.title = `Master: ${gainLabel(outputs[o]?.master_gain ?? 1.0)} dB`;
    fader.addEventListener('click', e => e.stopPropagation(), { signal: sig });
    fader.addEventListener('input', e => {
      const g = parseFloat(fader.value);
      fader.title = `Master: ${gainLabel(g)} dB`;
      state.outputs[o] = state.outputs[o] || {};
      state.outputs[o].master_gain = g;
      sendOutputMasterGain(o, g);
    }, { signal: sig });
    wireFaderDoubleClick(fader, o, 'output'); // W-03

    // D-06: Compressor button per output
    const btnComp = document.createElement('button');
    btnComp.className = 'btn-icon' + (outputs[o]?.compressor?.enabled ? ' active' : '');
    btnComp.textContent = 'C';
    btnComp.title = 'Compressor/limiter';
    btnComp.addEventListener('click', e => { e.stopPropagation(); openCompModal(o); }, { signal: sig });

    // W-08: Stereo link button (appears on even outputs to link with next odd)
    if (o % 2 === 0 && o + 1 < state.nOutputs) {
      const btnLink = document.createElement('button');
      btnLink.className = 'btn-icon' + (getStereoPartner(o) !== null ? ' active' : '');
      btnLink.textContent = '⊸';
      btnLink.title = `Stereo link OUT ${o + 1} ↔ OUT ${o + 2}`;
      btnLink.addEventListener('click', e => { e.stopPropagation(); toggleStereoLink(o, o + 1); btnLink.classList.toggle('active'); }, { signal: sig });
      el.appendChild(btnLink);
    }

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

  // W-17: re-apply fader lock if active
  if (faderLocked) {
    document.querySelectorAll('.strip-fader, .out-master-fader').forEach(el => { el.disabled = true; });
  }
  // W-15/W-24: re-apply filters after rebuild
  applyActiveFilter();
  applyZoneFilter();
  if (searchQuery) applySearchFilter();
}

function buildInputRow(i, rank) {
  const inp = state.inputs[i] || {};
  const row = document.createElement('div');
  row.className = 'matrix-row';
  row.id = `row-${i}`;

  // AbortController for this row's listeners (BUG-W03)
  const ac = new AbortController();
  rowControllers.set(i, ac);
  const sig = ac.signal;

  // U-09: drag-and-drop reorder
  row.draggable = true;
  row.dataset.index = i;
  row.addEventListener('dragstart', e => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(i));
    row.classList.add('dragging');
  }, { signal: sig });
  row.addEventListener('dragend', () => row.classList.remove('dragging'), { signal: sig });
  row.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; row.classList.add('drag-over'); }, { signal: sig });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'), { signal: sig });
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
  }, { signal: sig });

  // Strip
  const strip = document.createElement('div');
  strip.className = 'input-strip';

  const nameEl = document.createElement('span');
  nameEl.className = 'strip-name';
  nameEl.id = `in-name-${i}`;
  nameEl.textContent = inp.label || `IN ${i + 1}`;
  nameEl.title = 'Click to rename';
  nameEl.addEventListener('click', () => renameChannel('input', i), { signal: sig });

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
  btnM.addEventListener('click', () => toggleInputMute(i), { signal: sig });

  const btnS = document.createElement('button');
  btnS.className = 'btn-solo' + (inp.solo ? ' active' : '');
  btnS.textContent = 'S';
  btnS.title = 'Solo';
  btnS.id = `in-solo-${i}`;
  btnS.addEventListener('click', () => toggleInputSolo(i), { signal: sig });

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
  }, { signal: sig });
  wireFaderDoubleClick(fader, i, 'input'); // W-03

  // D-05: EQ button per input
  const btnEq = document.createElement('button');
  btnEq.className = 'btn-icon' + (inp.eq?.enabled ? ' active' : '');
  btnEq.textContent = 'EQ';
  btnEq.title = 'Parametric EQ';
  btnEq.id = `in-eq-${i}`;
  btnEq.addEventListener('click', () => openEqModal(i), { signal: sig });

  // W-07: Phase invert button
  const btnPhase = document.createElement('button');
  const phaseKey = `in-phase-${i}`;
  const phaseOn  = !!phaseState[phaseKey];
  btnPhase.className = 'btn-icon' + (phaseOn ? ' active' : '');
  btnPhase.textContent = 'φ';
  btnPhase.title = 'Phase invert (polarity flip)';
  btnPhase.id = `in-phase-${i}`;
  btnPhase.addEventListener('click', () => togglePhase(phaseKey, btnPhase), { signal: sig });

  // W-12: Fan-out button (route to all zone outputs)
  const btnFan = document.createElement('button');
  btnFan.className = 'btn-icon';
  btnFan.textContent = '⇶';
  btnFan.title = 'Fan-out: route to all outputs in current zone';
  btnFan.addEventListener('click', () => fanOutInput(i), { signal: sig });

  // M-10: HPF quick toggle
  const btnHpf = document.createElement('button');
  btnHpf.className = 'btn-icon' + (inp.hpf_enabled ? ' active' : '');
  btnHpf.textContent = 'HPF';
  btnHpf.id = `in-hpf-${i}`;
  btnHpf.title = `High-pass filter (${inp.hpf_hz ?? 80} Hz)`;
  btnHpf.addEventListener('click', () => toggleHpf(i, btnHpf), { signal: sig });

  // M-02: Pan/balance knob (range -1..+1)
  const panWrap = document.createElement('div');
  panWrap.className = 'pan-wrap';
  panWrap.title = 'Pan / Balance';
  const panSlider = document.createElement('input');
  panSlider.type = 'range';
  panSlider.className = 'pan-slider';
  panSlider.id = `in-pan-${i}`;
  panSlider.min = '-1'; panSlider.max = '1'; panSlider.step = '0.05';
  panSlider.value = String(inp.pan ?? 0);
  panSlider.title = `Pan: ${panLabel(inp.pan ?? 0)}`;
  panSlider.addEventListener('input', () => {
    const p = parseFloat(panSlider.value);
    panSlider.title = `Pan: ${panLabel(p)}`;
    sendInputPan(i, p);
  }, { signal: sig });
  panSlider.addEventListener('dblclick', e => {
    e.preventDefault();
    panSlider.value = '0';
    sendInputPan(i, 0);
    panSlider.title = 'Pan: C';
    toast('Pan centred', 'ok');
  }, { signal: sig });
  panWrap.appendChild(panSlider);

  // W-09: colour tag dot
  const colorTag = buildColorTag(`in-${i}`);

  strip.appendChild(colorTag);
  strip.appendChild(nameEl);
  strip.appendChild(dotEl);
  strip.appendChild(btnM);
  strip.appendChild(btnS);
  strip.appendChild(fader);
  strip.appendChild(panWrap);
  strip.appendChild(btnPhase);
  strip.appendChild(btnHpf);
  strip.appendChild(btnEq);
  strip.appendChild(btnFan);
  row.appendChild(strip);

  // Matrix cells — rendered in outputOrder
  for (let rank = 0; rank < state.nOutputs; rank++) {
    const o = state.outputOrder[rank];
    row.appendChild(buildCell(i, o, sig));
  }

  return row;
}

function buildCell(i, o, sig) {
  const gain = (state.matrix[i] || [])[o] ?? 0;
  const active = gain > 0;

  const cell = document.createElement('div');
  cell.className = 'matrix-cell' + (active ? ' active' : '');
  cell.id = `cell-${i}-${o}`;
  // U-03: hover tooltip shows current gain in dB; updated by applyGain().
  cell.title = active ? `${gainLabel(gain)} dB (right-click to adjust)` : 'Click to route (right-click to set gain)';
  if (active) cell.setAttribute('data-gain', gainLabel(gain));

  cell.addEventListener('click', () => toggleCell(i, o), { signal: sig });
  cell.addEventListener('contextmenu', e => { e.preventDefault(); showGainTooltip(i, o, cell); }, { signal: sig });
  // W-11: data-col for column highlight
  cell.dataset.col = o;

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
  haptic(); // W-21
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
  haptic(); // W-21
  const was = state.inputs[i]?.solo ?? false;
  state.inputs[i] = state.inputs[i] || {};
  state.inputs[i].solo = !was;
  updateStripButtons(i);
  updateSoloUI(); // W-05

  try {
    await apiFetch(`/channels/input/${i}/solo`, 'POST');
  } catch (err) {
    state.inputs[i].solo = was;
    updateStripButtons(i);
    updateSoloUI();
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
  haptic(); // W-21
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

let sendOutputMasterGain = debounce(async (o, gain) => {
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
let PEAK_DECAY = parseFloat(localStorage.getItem('patchbox-peak-decay') ?? '0.5'); // W-32

// W-30: Clip latch — per-channel, cleared on click
const clipLatch = { inputs: [], outputs: [] };

// W-33: RMS tracking — exponential moving average of linear power
const RMS_ALPHA = 0.15; // smoothing factor (higher = faster)
const rmsState = { inputs: [], outputs: [] };

// W-31: Gradient cache (keyed by canvas width)
const gradCache = new Map();
function getCachedGrad(ctx, w) {
  if (!gradCache.has(w)) {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0,    '#3aff6a');
    g.addColorStop(0.75, '#ff9a3a');
    g.addColorStop(1,    '#ff3a3a');
    gradCache.set(w, g);
  }
  return gradCache.get(w);
}
window.addEventListener('resize', () => gradCache.clear());

function buildMeterRow(dir, idx, label) {
  const row  = document.createElement('div');
  row.className = 'meter-row';

  const lbl  = document.createElement('div');
  lbl.className = 'meter-label';
  lbl.id = `meter-${dir}-label-${idx}`;
  lbl.textContent = (label || `${dir.toUpperCase()}${idx + 1}`).slice(0, 5).toUpperCase();

  const canvas = document.createElement('canvas');
  canvas.className = 'meter-canvas';
  canvas.id = `meter-${dir}-canvas-${idx}`;
  canvas.height = 10;

  // W-30: Clip latch indicator
  const clip = document.createElement('div');
  clip.className = 'meter-clip';
  clip.id = `meter-${dir}-clip-${idx}`;
  clip.title = 'Clip! Click to reset';
  clip.addEventListener('click', () => {
    if (dir === 'in') clipLatch.inputs[idx] = false;
    else clipLatch.outputs[idx] = false;
    clip.classList.remove('active');
  });

  row.appendChild(lbl);
  row.appendChild(canvas);
  row.appendChild(clip);
  return row;
}

// ── Meter paint (rAF loop) ────────────────────────────────────────────────

function dbToPercent(db) {
  // Map -60..0 dBFS to 0..100%
  return Math.max(0, Math.min(100, (db + 60) / 60 * 100));
}

function drawMeterCanvas(canvas, db, peak, rms) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  const pct = Math.max(0, Math.min(1, (db + 60) / 60));
  const peakPct = Math.max(0, Math.min(1, (peak + 60) / 60));
  const rmsPct  = Math.max(0, Math.min(1, ((rms ?? db) + 60) / 60));

  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = '#12121a';
  ctx.fillRect(0, 0, w, h);

  // W-31: Use cached gradient
  const barW = Math.round(pct * w);
  if (barW > 0) {
    ctx.fillStyle = getCachedGrad(ctx, w);
    ctx.fillRect(0, 0, barW, h);
  }

  // W-33: RMS bar (darker, thinner, overlaid at bottom half)
  const rmsW = Math.round(rmsPct * w);
  if (rmsW > 0) {
    ctx.fillStyle = 'rgba(0,180,255,0.35)';
    ctx.fillRect(0, Math.floor(h * 0.6), rmsW, Math.ceil(h * 0.4));
  }

  // Peak-hold line (white)
  const peakX = Math.round(peakPct * w);
  if (peakX > 1) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(peakX - 1, 0, 2, h);
  }
}

function paintMeters() {
  const { inputs, outputs } = state.meters;

  // Ensure arrays are sized
  if (peakHold.inputs.length  !== inputs.length)  peakHold.inputs  = new Array(inputs.length).fill(-60);
  if (peakHold.outputs.length !== outputs.length) peakHold.outputs = new Array(outputs.length).fill(-60);
  if (clipLatch.inputs.length  !== inputs.length)  clipLatch.inputs  = new Array(inputs.length).fill(false);
  if (clipLatch.outputs.length !== outputs.length) clipLatch.outputs = new Array(outputs.length).fill(false);
  if (rmsState.inputs.length  !== inputs.length)  rmsState.inputs  = new Array(inputs.length).fill(-60);
  if (rmsState.outputs.length !== outputs.length) rmsState.outputs = new Array(outputs.length).fill(-60);

  for (let i = 0; i < inputs.length; i++) {
    const db = inputs[i] ?? -60;
    // Peak hold
    if (db > peakHold.inputs[i]) peakHold.inputs[i] = db;
    else peakHold.inputs[i] = Math.max(-60, peakHold.inputs[i] - PEAK_DECAY);
    // W-33: RMS (exponential moving average on linear power)
    const linPow = Math.pow(10, db / 10);
    const rmsLin = rmsState.inputs[i] === -60 ? linPow : rmsState.inputs[i] * (1 - RMS_ALPHA) + linPow * RMS_ALPHA;
    rmsState.inputs[i] = rmsLin;
    const rmsDb = 10 * Math.log10(Math.max(1e-10, rmsLin));
    // W-30: Clip latch
    if (db >= -0.1) {
      clipLatch.inputs[i] = true;
      const clipEl = $(`meter-in-clip-${i}`);
      if (clipEl) clipEl.classList.add('active');
    }
    // W-35: Signal presence pulse on active cells
    if (db > -40) signalPulse('in', i, db);
    const canvas = $(`meter-in-canvas-${i}`);
    if (canvas) {
      canvas.width = getMeterWidth(canvas);
      drawMeterCanvas(canvas, db, peakHold.inputs[i], rmsDb);
    }
  }

  for (let o = 0; o < outputs.length; o++) {
    const db = outputs[o] ?? -60;
    if (db > peakHold.outputs[o]) peakHold.outputs[o] = db;
    else peakHold.outputs[o] = Math.max(-60, peakHold.outputs[o] - PEAK_DECAY);
    const linPow = Math.pow(10, db / 10);
    const rmsLin = rmsState.outputs[o] === -60 ? linPow : rmsState.outputs[o] * (1 - RMS_ALPHA) + linPow * RMS_ALPHA;
    rmsState.outputs[o] = rmsLin;
    const rmsDb = 10 * Math.log10(Math.max(1e-10, rmsLin));
    if (db >= -0.1) {
      clipLatch.outputs[o] = true;
      const clipEl = $(`meter-out-clip-${o}`);
      if (clipEl) clipEl.classList.add('active');
    }
    const canvas = $(`meter-out-canvas-${o}`);
    if (canvas) {
      canvas.width = getMeterWidth(canvas);
      drawMeterCanvas(canvas, db, peakHold.outputs[o], rmsDb);
    }
  }

  // M-12: Update strip view VU meters if strips view is active
  if (viewMode === 'strips') {
    for (let i = 0; i < inputs.length; i++) {
      const sc = $(`strip-vu-${i}`);
      if (sc) {
        sc.width  = 14;
        sc.height = 200;
        drawStripMeterV(sc, inputs[i] ?? -60, peakHold.inputs[i], rmsState.inputs[i] > 0 ? 10 * Math.log10(Math.max(1e-10, rmsState.inputs[i])) : -60);
      }
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
    toast('Connected', 'ok');
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
      // BUG-W04: bounds check before indexing to avoid OOB reads on stale channel counts
      if (view.length < ni + no) {
        console.warn(`WS meter frame too short: got ${view.length}, want ${ni + no}`);
        return;
      }
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

// W-45: State fingerprint — skip full buildUI() if only meter data changed
let _stateFingerprint = '';
function stateFingerprint(snap) {
  return JSON.stringify({
    ni: snap.matrix?.inputs, no: snap.matrix?.outputs,
    gains: snap.matrix?.gains,
    inputs: snap.inputs?.map(c => ({ label: c.label, mute: c.mute, solo: c.solo })),
    outputs: snap.outputs?.map(c => ({ label: c.label, mute: c.mute })),
    order: snap.input_order,
  });
}

function applySnapshot(snap) {
  if (!snap) return;

  const fp = stateFingerprint(snap);
  const needsRebuild = fp !== _stateFingerprint;
  _stateFingerprint = fp;

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

  if (needsRebuild) {
    buildUI();
    updateSoloUI(); // W-05
  } else {
    // Lightweight incremental update: just refresh mute/solo/dante indicators
    for (let i = 0; i < state.nInputs; i++) {
      const ch = state.inputs[i];
      if (!ch) continue;
      const btnM = document.getElementById(`in-mute-${i}`);
      const btnS = document.getElementById(`in-solo-${i}`);
      const dot  = document.getElementById(`dante-dot-${i}`);
      if (btnM) btnM.classList.toggle('active', !!ch.mute);
      if (btnS) btnS.classList.toggle('active', !!ch.solo);
      if (dot)  dot.classList.toggle('active', !!(state.danteRxActive?.[i]));
    }
  }
  // P-01/P-04: check Dante connection state changes after every snapshot
  if (typeof runPatchbayChecks === 'function') runPatchbayChecks();
}

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
      `<span class="diff-label">${escHtml(d.label)}</span>` +
      `<span class="diff-prev">${escHtml(d.prev)}</span>` +
      `<span class="diff-arrow">→</span>` +
      `<span class="diff-next">${escHtml(d.next)}</span>` +
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
  setTimeout(refreshEqCurve, 50); // M-08: draw curve after layout
}
.addEventListener('click', () => {
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
  setTimeout(refreshCompGraph, 50); // M-09: draw transfer graph after layout
}
.addEventListener('click', () => {
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

// ── W-10: View mode tabs (MATRIX / STRIPS) ────────────────────────────────

let viewMode = 'matrix'; // 'matrix' | 'strips'

function setViewMode(mode) {
  viewMode = mode;
  // Update tab active states
  document.querySelectorAll('.view-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === mode);
  });
  // Toggle visibility
  const isMatrix = mode === 'matrix';
  document.getElementById('output-labels').style.display = isMatrix ? '' : 'none';
  document.getElementById('matrix-rows').style.display   = isMatrix ? '' : 'none';
  document.getElementById('strips-view').style.display   = isMatrix ? 'none' : 'flex';
  if (mode === 'strips') buildStripsView();
}

function buildStripsView() {
  const el = document.getElementById('strips-view');
  el.innerHTML = '';
  const { nInputs, inputs } = state;
  for (let rank = 0; rank < nInputs; rank++) {
    const i = state.inputOrder[rank];
    const inp = inputs[i] || {};
    const gain = inp.gain_trim ?? 1.0;
    const label = inp.label || `IN ${i + 1}`;

    // ── Card container ──────────────────────────────────────────────
    const card = document.createElement('div');
    card.className = 'channel-strip-card' + (inp.mute ? ' strip-muted' : '');
    card.id = `strip-${i}`;

    // ── Header: color dot + name + dante activity dot ────────────
    const hdr = document.createElement('div');
    hdr.className = 'strip-header';
    const colorDot = buildColorDot(`in-${i}`, 'strip');
    const nameEl = document.createElement('span');
    nameEl.className = 'strip-name';
    nameEl.id = `sv-name-${i}`;
    nameEl.textContent = label;
    nameEl.title = label;
    nameEl.addEventListener('click', () => openChannelRenameModal('input', i));
    const danteDot = document.createElement('span');
    danteDot.className = 'dante-dot';
    danteDot.id = `sv-dante-${i}`;
    danteDot.style.cssText = 'width:6px;height:6px;border-radius:50%;background:var(--fg-dim);flex-shrink:0';
    hdr.appendChild(colorDot);
    hdr.appendChild(nameEl);
    hdr.appendChild(danteDot);

    // ── M-07: Gain staging display ───────────────────────────────
    const gainStaging = document.createElement('div');
    gainStaging.className = 'strip-gain-staging';
    gainStaging.innerHTML = `
      <div class="gain-stage-row gain-stage-trim">
        <span class="gain-stage-label">TRIM</span>
        <div class="gain-stage-bar"><div class="gain-stage-fill" id="gs-trim-${i}" style="width:${gainToPercent(gain)}%"></div></div>
        <span class="gain-stage-val" id="gs-trim-val-${i}">${gainToDbStr(gain)}</span>
      </div>
      <div class="gain-stage-row gain-stage-fader">
        <span class="gain-stage-label">FADE</span>
        <div class="gain-stage-bar"><div class="gain-stage-fill" id="gs-fader-${i}" style="width:${stripFaderPct(i)}%"></div></div>
        <span class="gain-stage-val" id="gs-fader-val-${i}">${stripFaderDbStr(i)}</span>
      </div>`;

    // ── M-12 + M-01: VU meter canvas + fader side by side ────────
    const meterFader = document.createElement('div');
    meterFader.className = 'strip-meter-fader';

    const vuCanvas = document.createElement('canvas');
    vuCanvas.className = 'strip-vu-canvas';
    vuCanvas.id = `strip-vu-${i}`;
    vuCanvas.width = 14;
    vuCanvas.height = 200;

    // Fader wrap (for unity tick overlay)
    const faderWrap = document.createElement('div');
    faderWrap.className = 'strip-fader-wrap';
    const fader = document.createElement('input');
    fader.type = 'range';
    fader.className = 'strip-fader-vert';
    fader.id = `sv-fader-${i}`;
    fader.min = '0'; fader.max = '2'; fader.step = '0.01';
    fader.value = String(gain);
    fader.setAttribute('aria-label', `${label} gain`);
    if (faderLocked) fader.disabled = true;

    // Unity tick: gain=1.0 → 50% of 0–2 range → 50% from bottom = 100px down from top
    const unityTick = document.createElement('div');
    unityTick.className = 'strip-unity-tick';
    // In vertical writing mode with direction:rtl, the thumb position is:
    // value=0 → bottom, value=2 → top. unity is at value=1 → middle → top: 50%
    unityTick.style.top = '50%';
    unityTick.style.right = '-6px';
    unityTick.style.marginTop = '-1px';

    // Dual-gesture fader: touch with 2+ fingers → fine mode (1/10 sensitivity)
    let faderFingers = 0;
    fader.addEventListener('touchstart', e => { faderFingers = e.touches.length; }, { passive: true });
    fader.addEventListener('touchend',   () => { faderFingers = 0; }, { passive: true });
    fader.addEventListener('input', () => {
      if (faderLocked) return;
      const raw = parseFloat(fader.value);
      if (faderFingers >= 2) {
        // Fine: scale adjustment toward current by 0.1
        const prev = inp.gain_trim ?? 1.0;
        const delta = (raw - prev) * 0.1;
        fader.value = String(Math.max(0, Math.min(2, prev + delta)));
      }
      const finalGain = parseFloat(fader.value);
      inp.gain_trim = finalGain; // optimistic local update
      updateStripGainStaging(i);
      sendInputGainTrim(i, finalGain);
    });
    // Double-tap to reset
    wireFaderDoubleClick(fader, i, 'input');

    faderWrap.appendChild(fader);
    faderWrap.appendChild(unityTick);
    meterFader.appendChild(vuCanvas);
    meterFader.appendChild(faderWrap);

    // Fader dB label
    const dbLabel = document.createElement('div');
    dbLabel.className = 'strip-fader-db';
    dbLabel.id = `sv-fader-db-${i}`;
    dbLabel.textContent = gainToDbStr(gain);
    fader.addEventListener('input', () => {
      const g = parseFloat(fader.value);
      dbLabel.textContent = gainToDbStr(g);
    });

    // ── DSP buttons ───────────────────────────────────────────────
    const dspBtns = document.createElement('div');
    dspBtns.className = 'strip-dsp-btns';
    const btnEq = document.createElement('button');
    btnEq.className = 'btn-icon'; btnEq.textContent = 'EQ';
    btnEq.title = 'Open EQ';
    btnEq.addEventListener('click', () => openEqModal && openEqModal(i));
    const btnPhase = document.createElement('button');
    btnPhase.className = 'btn-icon' + (phaseState[`in-${i}`] ? ' active' : '');
    btnPhase.id = `sv-phase-${i}`;
    btnPhase.textContent = 'φ';
    btnPhase.title = 'Phase invert';
    btnPhase.addEventListener('click', () => togglePhase(`in-${i}`, btnPhase));
    const btnStereo = document.createElement('button');
    btnStereo.className = 'btn-icon' + (stereoLink[`in-${i}`] ? ' active' : '');
    btnStereo.id = `sv-stereo-${i}`;
    btnStereo.textContent = '⊸';
    btnStereo.title = 'Stereo link';
    btnStereo.addEventListener('click', () => toggleStereoLink && toggleStereoLink(`in-${i}`, btnStereo));
    const btnHpf = document.createElement('button');
    btnHpf.className = 'btn-icon' + (inp.hpf_enabled ? ' active' : '');
    btnHpf.id = `sv-hpf-${i}`;
    btnHpf.textContent = 'HPF';
    btnHpf.title = `High-pass filter (${inp.hpf_hz ?? 80} Hz)`;
    btnHpf.addEventListener('click', () => toggleHpf(i, btnHpf));
    dspBtns.appendChild(btnEq);
    dspBtns.appendChild(btnPhase);
    dspBtns.appendChild(btnStereo);
    dspBtns.appendChild(btnHpf);

    // M-02: Pan knob in strip view
    const svPanWrap = document.createElement('div');
    svPanWrap.className = 'pan-wrap pan-wrap-strip';
    svPanWrap.title = 'Pan / Balance';
    const svPan = document.createElement('input');
    svPan.type = 'range'; svPan.className = 'pan-slider';
    svPan.id = `sv-pan-${i}`;
    svPan.min = '-1'; svPan.max = '1'; svPan.step = '0.05';
    svPan.value = String(inp.pan ?? 0);
    svPan.title = `Pan: ${panLabel(inp.pan ?? 0)}`;
    svPan.addEventListener('input', () => {
      const p = parseFloat(svPan.value);
      svPan.title = `Pan: ${panLabel(p)}`;
      sendInputPan(i, p);
    });
    svPan.addEventListener('dblclick', e => {
      e.preventDefault(); svPan.value = '0';
      sendInputPan(i, 0); toast('Pan centred', 'ok');
    });
    svPanWrap.appendChild(svPan);

    // ── Mute / Solo row ───────────────────────────────────────────
    const msRow = document.createElement('div');
    msRow.className = 'strip-ms-row';
    const btnM = document.createElement('button');
    btnM.className = 'btn-mute' + (inp.mute ? ' active' : '');
    btnM.textContent = 'M'; btnM.id = `sv-mute-${i}`;
    btnM.title = 'Mute';
    btnM.addEventListener('click', () => toggleInputMute(i));
    const btnS = document.createElement('button');
    btnS.className = 'btn-solo' + (inp.solo ? ' active' : '');
    btnS.textContent = 'S'; btnS.id = `sv-solo-${i}`;
    btnS.title = aflPflMode === 'afl' ? 'AFL Solo' : 'PFL Solo';
    btnS.addEventListener('click', () => toggleInputSolo(i));
    msRow.appendChild(btnM);
    msRow.appendChild(btnS);

    // ── Assemble ─────────────────────────────────────────────────
    card.appendChild(hdr);
    card.appendChild(gainStaging);
    card.appendChild(meterFader);
    card.appendChild(dbLabel);
    card.appendChild(dspBtns);
    card.appendChild(svPanWrap);
    card.appendChild(msRow);
    el.appendChild(card);
  }
}

// ── M-01 helpers: gain ↔ dB ──────────────────────────────────────────────

function gainToDb(gain) {
  return 20 * Math.log10(Math.max(gain, 0.001));
}
function gainToDbStr(gain) {
  const db = gainToDb(gain);
  if (db <= -55) return '-∞';
  return (db >= 0 ? '+' : '') + db.toFixed(1) + 'dB';
}
function gainToPercent(gain) {
  // 0–2 gain → 0–100%
  return Math.min(100, (gain / 2) * 100);
}

// ── M-07: Gain staging helpers ───────────────────────────────────────────

function stripFaderPct(i) {
  // Average active matrix cell gain for this input
  const row = state.matrix[i];
  if (!row) return 0;
  const active = row.filter(v => v > 0);
  if (!active.length) return 0;
  const avg = active.reduce((a, b) => a + b, 0) / active.length;
  return gainToPercent(avg);
}
function stripFaderDbStr(i) {
  const row = state.matrix[i];
  if (!row) return '--';
  const active = row.filter(v => v > 0);
  if (!active.length) return '--';
  const avg = active.reduce((a, b) => a + b, 0) / active.length;
  return gainToDbStr(avg);
}
function updateStripGainStaging(i) {
  const inp = state.inputs[i] || {};
  const gain = inp.gain_trim ?? 1.0;
  const trimFill = $(`gs-trim-${i}`);
  const trimVal  = $(`gs-trim-val-${i}`);
  const fadFill  = $(`gs-fader-${i}`);
  const fadVal   = $(`gs-fader-val-${i}`);
  if (trimFill) trimFill.style.width = gainToPercent(gain) + '%';
  if (trimVal)  trimVal.textContent  = gainToDbStr(gain);
  if (fadFill)  fadFill.style.width  = stripFaderPct(i) + '%';
  if (fadVal)   fadVal.textContent   = stripFaderDbStr(i);
}

// ── M-12: Vertical VU meter canvas drawing ───────────────────────────────

function drawStripMeterV(canvas, db, peak, rms) {
  const W = canvas.width;   // 14
  const H = canvas.height;  // 200
  const ctx = canvas.getContext('2d');
  const pct    = Math.max(0, Math.min(1, (db   + 60) / 60));
  const peakPct = Math.max(0, Math.min(1, (peak + 60) / 60));
  const rmsPct  = Math.max(0, Math.min(1, ((rms ?? db) + 60) / 60));

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#12121a';
  ctx.fillRect(0, 0, W, H);

  // Main bar bottom-to-top with gradient (green → amber → red)
  const barH = Math.round(pct * H);
  if (barH > 0) {
    const grad = ctx.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0.0,  '#22c55e');
    grad.addColorStop(0.70, '#f59e0b');
    grad.addColorStop(0.90, '#ef4444');
    ctx.fillStyle = grad;
    ctx.fillRect(0, H - barH, W, barH);
  }

  // RMS overlay (inner strip, blue tint)
  const rmsH = Math.round(rmsPct * H);
  if (rmsH > 0) {
    ctx.fillStyle = 'rgba(0,180,255,0.3)';
    ctx.fillRect(Math.floor(W * 0.3), H - rmsH, Math.ceil(W * 0.4), rmsH);
  }

  // Peak hold: horizontal white line
  const peakY = Math.round((1 - peakPct) * H);
  if (peakY < H - 1) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, peakY, W, 2);
  }

  // -12 dB tick mark (1/5 down from top of full range at 60dB span → 40% from bottom)
  const tickY = Math.round(H * (1 - 48 / 60)); // -12dB relative to 0dBFS
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(0, tickY, W, 1);
}

// ── M-06: AFL/PFL solo mode ───────────────────────────────────────────────

let aflPflMode = localStorage.getItem('patchbox-solo-mode') || 'pfl';

function initAflPfl() {
  const btn = $('btn-afl-pfl');
  if (!btn) return;
  updateAflPflBtn(btn);
  btn.addEventListener('click', () => {
    aflPflMode = aflPflMode === 'pfl' ? 'afl' : 'pfl';
    localStorage.setItem('patchbox-solo-mode', aflPflMode);
    updateAflPflBtn(btn);
    haptic(20);
    toast(`Solo mode: ${aflPflMode.toUpperCase()}`, 'ok');
    // Update strip solo button titles
    document.querySelectorAll('[id^="sv-solo-"]').forEach(b => {
      b.title = aflPflMode === 'afl' ? 'AFL Solo' : 'PFL Solo';
    });
  });
}

function updateAflPflBtn(btn) {
  btn.textContent = aflPflMode.toUpperCase();
  btn.classList.toggle('afl-mode', aflPflMode === 'afl');
  btn.title = `Solo mode: ${aflPflMode === 'pfl' ? 'PFL (Pre Fader Listen)' : 'AFL (After Fader Listen)'} — click to toggle`;
}

initAflPfl();

document.querySelectorAll('.view-tab').forEach(btn => {
  btn.addEventListener('click', () => setViewMode(btn.dataset.view));
});

// ── W-11: Column highlight on output label hover ──────────────────────────

// Cells get data-col set in buildCell(); output label hover adds/removes .col-hi

function addColHighlight(o) {
  document.querySelectorAll(`.matrix-cell[data-col="${o}"]`).forEach(c => c.classList.add('col-hi'));
}
function removeColHighlight(o) {
  document.querySelectorAll(`.matrix-cell[data-col="${o}"]`).forEach(c => c.classList.remove('col-hi'));
}

// ── W-15: Active-only filter ──────────────────────────────────────────────

let activeFilter = false;

function applyActiveFilter() {
  const rows  = document.querySelectorAll('.matrix-row');
  const labels = document.querySelectorAll('.output-label');

  if (!activeFilter) {
    rows.forEach(r => r.style.display = '');
    labels.forEach(l => l.style.display = '');
    return;
  }

  // Determine which inputs/outputs have any active route
  const activeInputs  = new Set();
  const activeOutputs = new Set();
  for (let i = 0; i < state.nInputs; i++) {
    for (let o = 0; o < state.nOutputs; o++) {
      if (((state.matrix[i] || [])[o] ?? 0) > 0) {
        activeInputs.add(i);
        activeOutputs.add(o);
      }
    }
  }

  rows.forEach(r => {
    const idx = parseInt(r.id.replace('row-', ''), 10);
    r.style.display = activeInputs.has(idx) ? '' : 'none';
  });

  labels.forEach(l => {
    if (!l.id) return; // corner cell
    const idx = parseInt(l.id.replace('out-label-', ''), 10);
    if (!isNaN(idx)) l.style.display = activeOutputs.has(idx) ? '' : 'none';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const btnFilter = document.getElementById('btn-active-filter');
  if (btnFilter) {
    btnFilter.addEventListener('click', () => {
      activeFilter = !activeFilter;
      btnFilter.classList.toggle('active', activeFilter);
      applyActiveFilter();
      haptic();
    });
  }
});

// ── W-24: Zone selector (localStorage-based) ──────────────────────────────
// Zone definition: { name: 'Bar 1', outputs: [0,1] }
// Stored in localStorage as JSON array.

let zones = [];

function loadZones() {
  try {
    const raw = localStorage.getItem('patchbox-zones');
    zones = raw ? JSON.parse(raw) : [];
  } catch (_) { zones = []; }
  renderZoneSelect();
}

function saveZones() {
  localStorage.setItem('patchbox-zones', JSON.stringify(zones));
  renderZoneSelect();
}

function renderZoneSelect() {
  const sel = document.getElementById('zone-select');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">ALL</option>';
  zones.forEach((z, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = z.name;
    sel.appendChild(opt);
  });
  sel.value = prev && zones[parseInt(prev, 10)] ? prev : '';
}

function applyZoneFilter() {
  const sel = document.getElementById('zone-select');
  if (!sel) return;
  const zoneIdx = sel.value === '' ? -1 : parseInt(sel.value, 10);

  if (zoneIdx < 0 || !zones[zoneIdx]) {
    // Show all outputs
    document.querySelectorAll('.output-label').forEach(l => l.style.display = '');
    document.querySelectorAll('.matrix-cell').forEach(c => c.style.display = '');
    return;
  }

  const zoneOutputs = new Set(zones[zoneIdx].outputs);

  // Show only output labels for this zone
  document.querySelectorAll('.output-label').forEach(l => {
    if (!l.id) return;
    const o = parseInt(l.id.replace('out-label-', ''), 10);
    l.style.display = isNaN(o) || zoneOutputs.has(o) ? '' : 'none';
  });

  // Show only cells for zone outputs
  document.querySelectorAll('.matrix-cell').forEach(c => {
    const colAttr = c.dataset.col;
    if (colAttr === undefined) return;
    c.style.display = zoneOutputs.has(parseInt(colAttr, 10)) ? '' : 'none';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadZones();

  document.getElementById('zone-select')?.addEventListener('change', () => {
    applyZoneFilter();
  });

  // Zone edit modal
  const btnEdit  = document.getElementById('btn-edit-zones');
  const modal    = document.getElementById('zone-modal');
  const btnClose = document.getElementById('zone-modal-close');
  const btnAdd   = document.getElementById('btn-zone-add');
  const btnSave  = document.getElementById('btn-zone-save');

  if (btnEdit) btnEdit.addEventListener('click', () => {
    renderZoneEditor();
    modal.style.display = 'flex';
  });
  if (btnClose) btnClose.addEventListener('click', () => modal.style.display = 'none');

  if (btnAdd) btnAdd.addEventListener('click', () => {
    zones.push({ name: `Zone ${zones.length + 1}`, outputs: [] });
    renderZoneEditor();
  });

  if (btnSave) btnSave.addEventListener('click', () => {
    // Read back values from editor
    const rows = document.querySelectorAll('#zone-modal-body .zone-row');
    zones = [];
    rows.forEach(row => {
      const nameEl = row.querySelector('input[type=text]');
      const selEl  = row.querySelector('select');
      if (!nameEl || !selEl) return;
      const outputs = Array.from(selEl.selectedOptions).map(o => parseInt(o.value, 10));
      zones.push({ name: nameEl.value.trim() || 'Zone', outputs });
    });
    saveZones();
    applyZoneFilter();
    modal.style.display = 'none';
    toast('Zones saved', 'ok');
  });
});

function renderZoneEditor() {
  const body = document.getElementById('zone-modal-body');
  if (!body) return;
  body.innerHTML = '';
  zones.forEach((z, zIdx) => {
    const row = document.createElement('div');
    row.className = 'zone-row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = z.name;
    nameInput.placeholder = 'Zone name';

    const sel = document.createElement('select');
    sel.className = 'zone-outputs-select';
    sel.multiple = true;
    for (let o = 0; o < state.nOutputs; o++) {
      const opt = document.createElement('option');
      opt.value = String(o);
      opt.textContent = (state.outputs[o]?.label || `OUT ${o + 1}`);
      if (z.outputs.includes(o)) opt.selected = true;
      sel.appendChild(opt);
    }

    const del = document.createElement('button');
    del.className = 'btn-zone-del';
    del.textContent = '✕';
    del.title = 'Delete zone';
    del.addEventListener('click', () => {
      zones.splice(zIdx, 1);
      renderZoneEditor();
    });

    row.appendChild(nameInput);
    row.appendChild(sel);
    row.appendChild(del);
    body.appendChild(row);
  });
  if (zones.length === 0) {
    body.innerHTML = '<p style="color:var(--text-dim);padding:12px;font-size:11px">No zones defined. Click + ZONE to add one.</p>';
  }
}

// ── Sprint 23 — Patchbay Intelligence ────────────────────────────────────

// P-03: Channel search/filter ─────────────────────────────────────────────

let searchQuery = '';

function applySearchFilter() {
  const q = searchQuery.toLowerCase().trim();
  // Filter input rows
  for (let i = 0; i < state.nInputs; i++) {
    const label = (state.inputs[i]?.label || `IN ${i + 1}`).toLowerCase();
    const row = $(`row-${i}`);
    if (row && q) row.style.display = label.includes(q) ? '' : 'none';
    else if (row) row.style.display = '';
  }
  // Filter output columns by hiding labels + cells
  for (let o = 0; o < state.nOutputs; o++) {
    const label = (state.outputs[o]?.label || `OUT ${o + 1}`).toLowerCase();
    const lbl = $(`out-label-${o}`);
    const visible = !q || label.includes(q);
    if (lbl) lbl.style.display = visible ? '' : 'none';
    document.querySelectorAll(`.matrix-cell[data-col="${o}"]`).forEach(c => {
      c.style.display = visible ? '' : 'none';
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const searchEl = document.getElementById('matrix-search');
  if (searchEl) {
    searchEl.addEventListener('input', e => {
      searchQuery = e.target.value;
      applySearchFilter();
    });
  }
});

// P-01: Enhanced Dante subscription status overlay ─────────────────────────

function updateDanteStatusDots() {
  for (let i = 0; i < state.nInputs; i++) {
    const dot = $(`in-dot-${i}`) || $(`sv-dante-${i}`);
    if (!dot) continue;
    const active = !!(state.danteRxActive?.[i]);
    // Check if this input has active routes
    const hasRoutes = (state.matrix[i] || []).some(v => v > 0);

    dot.classList.remove('active', 'dante-pending', 'dante-lost');
    if (active) {
      dot.classList.add('active');
      dot.title = 'Dante RX active';
    } else if (hasRoutes) {
      dot.classList.add('dante-lost');
      dot.title = 'Dante RX lost — connection may be broken';
    } else {
      dot.title = 'No Dante flow (unpatched)';
    }
  }
}

// P-04: Broken connection indicator ──────────────────────────────────────

let prevDanteRxActive = [];

function checkDanteConnectionLoss() {
  const now = state.danteRxActive || [];
  for (let i = 0; i < now.length; i++) {
    const wasActive = prevDanteRxActive[i];
    const isActive  = now[i];
    if (wasActive && !isActive) {
      const hasRoutes = (state.matrix[i] || []).some(v => v > 0);
      if (hasRoutes) {
        const label = state.inputs[i]?.label || `IN ${i + 1}`;
        toast(`⚠ Dante RX lost: ${label}`, 'err');
        // Flash the row
        const row = $(`row-${i}`);
        if (row) {
          row.classList.remove('dante-lost-row');
          void row.offsetWidth; // reflow to restart animation
          row.classList.add('dante-lost-row');
          setTimeout(() => row.classList.remove('dante-lost-row'), 4000);
        }
        // Flash active cells for this input
        for (let o = 0; o < state.nOutputs; o++) {
          if ((state.matrix[i][o] ?? 0) > 0) {
            const cell = $(`cell-${i}-${o}`);
            if (cell) {
              cell.style.outline = '2px solid var(--red)';
              setTimeout(() => { if (cell) cell.style.outline = ''; }, 3000);
            }
          }
        }
      }
    }
  }
  prevDanteRxActive = [...now];
}

// P-08: Live signal level in cell hover tooltip ───────────────────────────

function updateCellSignalTooltips() {
  if (viewMode !== 'matrix') return;
  for (let i = 0; i < state.nInputs; i++) {
    const db = state.meters.inputs[i] ?? -60;
    for (let o = 0; o < state.nOutputs; o++) {
      const gain = (state.matrix[i] || [])[o] ?? 0;
      if (gain <= 0) continue;
      const cell = $(`cell-${i}-${o}`);
      if (!cell) continue;
      const dbStr = db <= -55 ? '–∞' : db.toFixed(1);
      cell.title = `${gainLabel(gain)} dB gain · Signal: ${dbStr} dBFS (right-click to adjust)`;
    }
  }
}

// Run signal tooltip update periodically (cheaper than per-frame)
setInterval(updateCellSignalTooltips, 2000);

function runPatchbayChecks() {
  checkDanteConnectionLoss();
  updateDanteStatusDots();
}

// ── Sprint 24 — Pan, HPF, EQ Curve, Compressor Graph ─────────────────────

// M-02: Pan helpers ───────────────────────────────────────────────────────

function panLabel(p) {
  if (Math.abs(p) < 0.04) return 'C';
  const pct = Math.round(Math.abs(p) * 100);
  return p < 0 ? `L${pct}` : `R${pct}`;
}

const sendInputPan = debounce(async (i, pan) => {
  try {
    await apiFetch(`/channels/input/${i}/pan`, 'POST', { pan });
    state.inputs[i] = state.inputs[i] || {};
    state.inputs[i].pan = pan;
    updateStripGainStaging(i);
  } catch (err) {
    toast('Pan error: ' + err.message, 'err');
  }
}, 80);

// M-10: HPF toggle ────────────────────────────────────────────────────────

async function toggleHpf(i, btn) {
  const inp = state.inputs[i] || {};
  const enabled = !inp.hpf_enabled;
  const hz = inp.hpf_hz || 80;
  try {
    await apiFetch(`/channels/input/${i}/hpf`, 'POST', { enabled, hz });
    state.inputs[i] = state.inputs[i] || {};
    state.inputs[i].hpf_enabled = enabled;
    btn.classList.toggle('active', enabled);
    // Sync the other HPF button (matrix row ↔ strip view)
    const other = enabled ? [$(`in-hpf-${i}`), $(`sv-hpf-${i}`)] : [$(`in-hpf-${i}`), $(`sv-hpf-${i}`)];
    other.forEach(b => { if (b && b !== btn) b.classList.toggle('active', enabled); });
    haptic(20);
    toast(`HPF ${enabled ? 'ON' : 'OFF'} — ${hz} Hz`, enabled ? 'ok' : 'warn');
  } catch (err) {
    toast('HPF error: ' + err.message, 'err');
  }
}

// M-08: EQ frequency response curve ──────────────────────────────────────

function computeBiquadCoeffs(type, freqHz, gainDb, q, sampleRate = 48000) {
  const f0 = freqHz;
  const w0 = 2 * Math.PI * f0 / sampleRate;
  const cosW = Math.cos(w0);
  const sinW = Math.sin(w0);
  const A  = Math.pow(10, gainDb / 40);  // sqrt(10^(dB/20))
  const alpha = sinW / (2 * q);
  let b0, b1, b2, a0, a1, a2;

  switch (type) {
    case 'peak': {
      b0 =  1 + alpha * A;
      b1 = -2 * cosW;
      b2 =  1 - alpha * A;
      a0 =  1 + alpha / A;
      a1 = -2 * cosW;
      a2 =  1 - alpha / A;
      break;
    }
    case 'low_shelf': {
      const alphaS = sinW / 2 * Math.sqrt((A + 1/A) * (1/q - 1) + 2);
      b0 =  A * ((A + 1) - (A - 1) * cosW + 2 * Math.sqrt(A) * alphaS);
      b1 =  2 * A * ((A - 1) - (A + 1) * cosW);
      b2 =  A * ((A + 1) - (A - 1) * cosW - 2 * Math.sqrt(A) * alphaS);
      a0 =       (A + 1) + (A - 1) * cosW + 2 * Math.sqrt(A) * alphaS;
      a1 = -2 * ((A - 1) + (A + 1) * cosW);
      a2 =       (A + 1) + (A - 1) * cosW - 2 * Math.sqrt(A) * alphaS;
      break;
    }
    case 'high_shelf': {
      const alphaS = sinW / 2 * Math.sqrt((A + 1/A) * (1/q - 1) + 2);
      b0 =  A * ((A + 1) + (A - 1) * cosW + 2 * Math.sqrt(A) * alphaS);
      b1 = -2 * A * ((A - 1) + (A + 1) * cosW);
      b2 =  A * ((A + 1) + (A - 1) * cosW - 2 * Math.sqrt(A) * alphaS);
      a0 =        (A + 1) - (A - 1) * cosW + 2 * Math.sqrt(A) * alphaS;
      a1 =  2 * ((A - 1) - (A + 1) * cosW);
      a2 =        (A + 1) - (A - 1) * cosW - 2 * Math.sqrt(A) * alphaS;
      break;
    }
    case 'high_pass': {
      b0 =  (1 + cosW) / 2;
      b1 = -(1 + cosW);
      b2 =  (1 + cosW) / 2;
      a0 =  1 + alpha;
      a1 = -2 * cosW;
      a2 =  1 - alpha;
      break;
    }
    case 'low_pass': default: {
      b0 = (1 - cosW) / 2;
      b1 =  1 - cosW;
      b2 = (1 - cosW) / 2;
      a0 =  1 + alpha;
      a1 = -2 * cosW;
      a2 =  1 - alpha;
      break;
    }
  }
  return { b0: b0/a0, b1: b1/a0, b2: b2/a0, a1: a1/a0, a2: a2/a0 };
}

function evalBiquadMagDb(c, freqHz, sampleRate = 48000) {
  const w = 2 * Math.PI * freqHz / sampleRate;
  const cosW = Math.cos(w), sinW = Math.sin(w);
  const cos2W = Math.cos(2*w), sin2W = Math.sin(2*w);
  // H(e^jw) numerator: b0 + b1*e^-jw + b2*e^-2jw
  const numRe = c.b0 + c.b1 * cosW + c.b2 * cos2W;
  const numIm = -(c.b1 * sinW + c.b2 * sin2W);
  // H(e^jw) denominator: 1 + a1*e^-jw + a2*e^-2jw
  const denRe = 1 + c.a1 * cosW + c.a2 * cos2W;
  const denIm = -(c.a1 * sinW + c.a2 * sin2W);
  const mag2 = (numRe*numRe + numIm*numIm) / (denRe*denRe + denIm*denIm);
  return 10 * Math.log10(Math.max(mag2, 1e-20));
}

function drawEqCurve(canvas, bands) {
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0d0d18';
  ctx.fillRect(0, 0, W, H);

  // Grid lines
  const freqGrid = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  const dbRange = 18;  // ±18 dB
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  freqGrid.forEach(f => {
    const x = freqToX(f, W);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  });
  [-12, -6, 0, 6, 12].forEach(db => {
    const y = dbToY(db, H, dbRange);
    ctx.strokeStyle = db === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.07)';
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  });

  // Freq axis labels
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = '8px monospace';
  ['100', '1k', '10k'].forEach((lbl, idx) => {
    const f = [100, 1000, 10000][idx];
    ctx.fillText(lbl, freqToX(f, W) + 2, H - 2);
  });

  // Total response curve (sum of all enabled bands)
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  const N = 300;
  for (let x = 0; x < N; x++) {
    const f = Math.pow(10, Math.log10(20) + x / N * Math.log10(20000/20));
    let totalDb = 0;
    bands.forEach(band => {
      if (!band.enabled || !band.freq_hz) return;
      const c = computeBiquadCoeffs(band.band_type, band.freq_hz, band.gain_db || 0, band.q || 0.707);
      totalDb += evalBiquadMagDb(c, f);
    });
    const px = freqToX(f, W);
    const py = dbToY(totalDb, H, dbRange);
    x === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Per-band colour dots at centre freq
  const bandColors = ['#22c55e', '#38bdf8', '#f97316', '#a78bfa'];
  bands.forEach((band, b) => {
    if (!band.enabled || !band.freq_hz) return;
    const x = freqToX(band.freq_hz, W);
    const c = computeBiquadCoeffs(band.band_type, band.freq_hz, band.gain_db || 0, band.q || 0.707);
    const db = evalBiquadMagDb(c, band.freq_hz);
    const y = dbToY(db, H, dbRange);
    ctx.fillStyle = bandColors[b % bandColors.length];
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI*2); ctx.fill();
  });
}

function freqToX(f, W) {
  return (Math.log10(f / 20) / Math.log10(20000 / 20)) * W;
}
function dbToY(db, H, range) {
  return H/2 - (db / range) * (H/2 - 8);
}

// Hook into EQ modal: draw curve when modal opens and when sliders move
function refreshEqCurve() {
  const modal = document.getElementById('eq-modal');
  if (!modal || modal.style.display === 'none') return;
  const canvas = document.getElementById('eq-curve-canvas');
  if (!canvas) return;
  const defaults = [
    { band_type: 'low_shelf',  freq_hz: 100,   gain_db: 0, q: 0.707 },
    { band_type: 'peak',       freq_hz: 500,   gain_db: 0, q: 1.0   },
    { band_type: 'peak',       freq_hz: 3000,  gain_db: 0, q: 1.0   },
    { band_type: 'high_shelf', freq_hz: 10000, gain_db: 0, q: 0.707 },
  ];
  const bands = Array.from({length: 4}, (_, b) => ({
    enabled:   document.getElementById(`eq-b${b}-enabled`)?.checked ?? false,
    band_type: document.getElementById(`eq-b${b}-type`)?.value    || defaults[b].band_type,
    freq_hz:   parseFloat(document.getElementById(`eq-b${b}-freq`)?.value) || defaults[b].freq_hz,
    gain_db:   parseFloat(document.getElementById(`eq-b${b}-gain`)?.value) || 0,
    q:         parseFloat(document.getElementById(`eq-b${b}-q`)?.value)    || defaults[b].q,
  }));
  canvas.width  = canvas.offsetWidth  || 400;
  canvas.height = canvas.offsetHeight || 100;
  drawEqCurve(canvas, bands);
}

// Wire up EQ slider inputs to refresh curve
document.addEventListener('DOMContentLoaded', () => {
  for (let b = 0; b < 4; b++) {
    ['freq', 'gain', 'q', 'type'].forEach(field => {
      document.getElementById(`eq-b${b}-${field}`)?.addEventListener('input', refreshEqCurve);
      document.getElementById(`eq-b${b}-${field}`)?.addEventListener('change', refreshEqCurve);
    });
    document.getElementById(`eq-b${b}-enabled`)?.addEventListener('change', refreshEqCurve);
  }
  document.getElementById('eq-enabled')?.addEventListener('change', refreshEqCurve);
});

// M-09: Compressor transfer function graph ────────────────────────────────

function drawCompTransferGraph(canvas, threshold, ratio, knee = 3) {
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0d0d18';
  ctx.fillRect(0, 0, W, H);

  const dbIn  = d => (d / W) * 80 - 80;   // 0..W → -80..0 dBFS input
  const dbOut = d => H - ((d + 80) / 80) * H; // dBFS → canvas Y
  const xOf   = db => ((db + 80) / 80) * W;

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  [-60, -40, -20, 0].forEach(db => {
    const x = xOf(db), y = dbOut(db);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  });

  // Unity line (1:1 — no compression)
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, 0); ctx.stroke();
  ctx.setLineDash([]);

  // Transfer curve
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let px = 0; px < W; px++) {
    const inDb = dbIn(px);
    let outDb;
    const halfKnee = knee / 2;
    if (inDb < threshold - halfKnee) {
      outDb = inDb;
    } else if (inDb > threshold + halfKnee) {
      outDb = threshold + (inDb - threshold) / ratio;
    } else {
      // Soft knee
      const t = (inDb - threshold + halfKnee) / knee;
      outDb = inDb + (1/ratio - 1) * Math.pow(inDb - threshold + halfKnee, 2) / (2 * knee);
    }
    const py = dbOut(outDb);
    px === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Threshold marker
  const tx = xOf(threshold);
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(tx, 0); ctx.lineTo(tx, H); ctx.stroke();
  ctx.setLineDash([]);

  // Labels
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '8px monospace';
  ctx.fillText('IN', W - 16, H - 2);
  ctx.fillText('OUT', 2, 10);
  ctx.fillStyle = '#ef4444';
  ctx.fillText(threshold.toFixed(0) + 'dB', Math.max(2, tx - 18), 20);
}

function refreshCompGraph() {
  const modal = document.getElementById('comp-modal');
  if (!modal || modal.style.display === 'none') return;
  const canvas = document.getElementById('comp-graph-canvas');
  if (!canvas) return;
  canvas.width  = canvas.offsetWidth  || 200;
  canvas.height = canvas.offsetHeight || 100;
  const threshold = parseFloat(document.getElementById('comp-threshold')?.value ?? -12);
  const ratio     = parseFloat(document.getElementById('comp-ratio')?.value ?? 4);
  drawCompTransferGraph(canvas, threshold, ratio);
}

document.addEventListener('DOMContentLoaded', () => {
  ['threshold', 'ratio'].forEach(name => {
    document.getElementById(`comp-${name}`)?.addEventListener('input', refreshCompGraph);
  });
  document.getElementById('comp-enabled')?.addEventListener('change', refreshCompGraph);
});

// ── W-56: Dark/light theme toggle ─────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('patchbox-theme', theme);
  const btn = document.getElementById('btn-theme');
  if (btn) btn.title = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
}

document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('patchbox-theme') || 'dark';
  applyTheme(saved);
  document.getElementById('btn-theme')?.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });
});

// ── W-09: Per-channel colour tags ─────────────────────────────────────────

const CHANNEL_COLORS = [
  '', // none (default --border)
  '#f59e0b', // amber
  '#22c55e', // green
  '#3b82f6', // blue
  '#ef4444', // red
  '#a855f7', // purple
  '#06b6d4', // cyan
  '#f97316', // orange
];

let channelColors = {};

function loadChannelColors() {
  try {
    const raw = localStorage.getItem('patchbox-channel-colors');
    channelColors = raw ? JSON.parse(raw) : {};
  } catch (_) { channelColors = {}; }
}

function saveChannelColor(key, color) {
  channelColors[key] = color;
  localStorage.setItem('patchbox-channel-colors', JSON.stringify(channelColors));
}

function cycleChannelColor(key, dotEl) {
  const current = channelColors[key] || '';
  const idx = CHANNEL_COLORS.indexOf(current);
  const next = CHANNEL_COLORS[(idx + 1) % CHANNEL_COLORS.length];
  saveChannelColor(key, next);
  dotEl.style.background = next || '';
  dotEl.style.borderColor = next || '';
  haptic(15);
}

function buildColorTag(key) {
  const dot = document.createElement('span');
  dot.className = 'channel-color-tag';
  dot.title = 'Click to set channel colour';
  const color = channelColors[key] || '';
  if (color) { dot.style.background = color; dot.style.borderColor = color; }
  dot.addEventListener('click', e => { e.stopPropagation(); cycleChannelColor(key, dot); });
  return dot;
}

loadChannelColors();

// ── W-03: Double-tap fader to reset to unity (0 dB / gain 1.0) ───────────

function wireFaderDoubleClick(fader, idx, type) {
  fader.addEventListener('dblclick', e => {
    e.preventDefault();
    if (faderLocked) return;
    fader.value = '1';
    haptic(40);
    if (type === 'input') {
      sendInputGainTrim(idx, 1.0);
      toast('Trim reset to 0 dB', 'ok');
    } else {
      sendOutputMasterGain(idx, 1.0);
      toast('Master reset to 0 dB', 'ok');
    }
  });
}

// ── W-02: Channel sort by name ────────────────────────────────────────────

function sortChannelsByName() {
  const { nInputs, inputs } = state;
  const order = Array.from({length: nInputs}, (_, i) => i);
  order.sort((a, b) => {
    const la = (inputs[a]?.label || `IN ${a + 1}`).toLowerCase();
    const lb = (inputs[b]?.label || `IN ${b + 1}`).toLowerCase();
    return la.localeCompare(lb);
  });
  state.inputOrder = order;
  buildUI();
  apiFetch('/channels/input/reorder', 'POST', { order }).catch(err => toast('Reorder failed', 'err'));
  toast('Sorted by name', 'ok');
}

// ── W-07: Phase invert (polarity) ─────────────────────────────────────────

let phaseState = {};

function loadPhaseState() {
  try {
    const raw = localStorage.getItem('patchbox-phase');
    phaseState = raw ? JSON.parse(raw) : {};
  } catch (_) { phaseState = {}; }
}

function togglePhase(key, btn) {
  phaseState[key] = !phaseState[key];
  localStorage.setItem('patchbox-phase', JSON.stringify(phaseState));
  btn.classList.toggle('active', phaseState[key]);
  haptic(20);
  toast(phaseState[key] ? 'Phase inverted' : 'Phase normal', 'ok');
  // TODO: send to backend when /channels/input/{i}/phase endpoint is added
}

loadPhaseState();

// ── W-08: Stereo link for output pairs ───────────────────────────────────
// Linked output pairs move faders together.
// Stored as array of [o1, o2] pairs in localStorage.

let stereoLinks = [];

function loadStereoLinks() {
  try {
    const raw = localStorage.getItem('patchbox-stereo-links');
    stereoLinks = raw ? JSON.parse(raw) : [];
  } catch (_) { stereoLinks = []; }
}

function saveStereoLinks() {
  localStorage.setItem('patchbox-stereo-links', JSON.stringify(stereoLinks));
}

function getStereoPartner(o) {
  for (const pair of stereoLinks) {
    if (pair[0] === o) return pair[1];
    if (pair[1] === o) return pair[0];
  }
  return null;
}

function toggleStereoLink(o1, o2) {
  const existing = stereoLinks.findIndex(p => (p[0] === o1 && p[1] === o2) || (p[0] === o2 && p[1] === o1));
  if (existing >= 0) {
    stereoLinks.splice(existing, 1);
    toast(`Unlinked OUT ${o1 + 1} / OUT ${o2 + 1}`, 'ok');
  } else {
    stereoLinks.push([o1, o2]);
    toast(`Linked OUT ${o1 + 1} / OUT ${o2 + 1}`, 'ok');
  }
  saveStereoLinks();
  haptic(30);
}

loadStereoLinks();

// Patch sendOutputMasterGain to propagate to stereo-linked partner
sendOutputMasterGain = debounce(async (o, gain) => {
  const partner = getStereoPartner(o);
  if (partner !== null) {
    const partnerEl = document.getElementById(`out-gain-${partner}`);
    if (partnerEl) { partnerEl.value = String(gain); }
    try { await apiFetch(`/channels/output/${partner}/master_gain`, 'POST', { gain }); } catch (_) {}
  }
  try {
    await apiFetch(`/channels/output/${o}/master_gain`, 'POST', { gain });
  } catch (err) {
    toast(`Master gain error: ${err.message}`, 'err');
  }
}, 80);

// ── W-12: Fan-out input to all outputs in current zone ────────────────────

async function fanOutInput(i) {
  haptic(40);
  const zoneSelEl = document.getElementById('zone-select');
  const zoneIdx = zoneSelEl ? parseInt(zoneSelEl.value, 10) : NaN;

  // Determine target outputs
  let targetOutputs;
  if (!isNaN(zoneIdx) && zones[zoneIdx]) {
    targetOutputs = zones[zoneIdx].outputs;
  } else {
    targetOutputs = Array.from({length: state.nOutputs}, (_, o) => o);
  }

  let count = 0;
  for (const o of targetOutputs) {
    if (((state.matrix[i] || [])[o] ?? 0) <= 0) {
      applyGain(i, o, 1.0);
      try { await apiFetch(`/matrix/${i}/${o}`, 'PATCH', { gain: 1.0 }); count++; } catch (_) {}
    }
  }
  toast(`Fan-out: routed to ${count} output${count !== 1 ? 's' : ''}`, 'ok');
}

// ── W-14: Shift-drag bulk cell multi-select ───────────────────────────────

let dragSelectStart = null;  // { i, o }
let dragSelectMode  = null;  // 'on' | 'off'
let isDragSelecting = false;

// Patch buildCell to add shift-drag support
const _buildCell = buildCell;
// We re-declare using a decorator-like approach on the matrix click handler:

// Add pointer events for drag-select on the matrix-rows container
document.addEventListener('DOMContentLoaded', () => {
  const rows = document.getElementById('matrix-rows');
  if (!rows) return;

  rows.addEventListener('pointerdown', e => {
    if (!e.shiftKey) return;
    const cell = e.target.closest('.matrix-cell');
    if (!cell) return;
    const [, ci, co] = cell.id.split('-').map(Number);
    if (isNaN(ci) || isNaN(co)) return;
    isDragSelecting = true;
    dragSelectStart = { i: ci, o: co };
    dragSelectMode = ((state.matrix[ci] || [])[co] ?? 0) > 0 ? 'off' : 'on';
    rows.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  rows.addEventListener('pointermove', e => {
    if (!isDragSelecting) return;
    const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('.matrix-cell');
    if (!cell) return;
    const [, ci, co] = cell.id.split('-').map(Number);
    if (isNaN(ci) || isNaN(co)) return;

    // Select range from dragSelectStart to current
    const r0 = Math.min(dragSelectStart.i, ci), r1 = Math.max(dragSelectStart.i, ci);
    const c0 = Math.min(dragSelectStart.o, co), c1 = Math.max(dragSelectStart.o, co);

    // Highlight selection
    document.querySelectorAll('.matrix-cell.drag-selected').forEach(c => c.classList.remove('drag-selected'));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const el = document.getElementById(`cell-${r}-${c}`);
        if (el) el.classList.add('drag-selected');
      }
    }
  });

  rows.addEventListener('pointerup', async e => {
    if (!isDragSelecting) return;
    isDragSelecting = false;

    const selected = document.querySelectorAll('.matrix-cell.drag-selected');
    const newGain = dragSelectMode === 'on' ? 1.0 : 0.0;
    const promises = [];
    selected.forEach(cell => {
      const [, ci, co] = cell.id.split('-').map(Number);
      if (isNaN(ci) || isNaN(co)) return;
      applyGain(ci, co, newGain);
      promises.push(apiFetch(`/matrix/${ci}/${co}`, 'PATCH', { gain: newGain }).catch(() => {}));
    });
    await Promise.all(promises);
    document.querySelectorAll('.matrix-cell.drag-selected').forEach(c => c.classList.remove('drag-selected'));
    toast(`${dragSelectMode === 'on' ? 'Routed' : 'Cleared'} ${selected.length} cell${selected.length !== 1 ? 's' : ''}`, 'ok');
    haptic(30);
    dragSelectStart = null;
    dragSelectMode  = null;
  });
});

// ── W-32: Peak-hold decay rate configurable ──────────────────────────────

(function addPeakDecayControl() {
  // Add a tiny peak-decay selector to the toolbar
  const toolbar = document.getElementById('matrix-toolbar');
  if (!toolbar) return;

  const wrap = document.createElement('label');
  wrap.className = 'toolbar-label';
  wrap.title = 'Peak hold decay speed';

  const span = document.createElement('span');
  span.textContent = 'PEAK';
  span.style.cssText = 'font-size:9px;opacity:.6;margin-right:3px;';

  const sel = document.createElement('select');
  sel.className = 'btn-icon';
  sel.style.cssText = 'font-size:9px;padding:2px 4px;';
  sel.innerHTML = `
    <option value="0.1">Slow</option>
    <option value="0.5">Med</option>
    <option value="1.5">Fast</option>
    <option value="0">Hold</option>
  `;
  sel.value = String(PEAK_DECAY);
  // Fallback: pick closest
  if (!sel.value) sel.value = '0.5';
  sel.addEventListener('change', () => {
    PEAK_DECAY = parseFloat(sel.value);
    localStorage.setItem('patchbox-peak-decay', String(PEAK_DECAY));
  });

  wrap.appendChild(span);
  wrap.appendChild(sel);
  toolbar.appendChild(wrap);
})();

// ── W-34: Master bus meter (first two outputs as L/R) ────────────────────

(function addMasterMeter() {
  const meters = document.getElementById('meters-out');
  if (!meters) return;

  const title = document.createElement('div');
  title.style.cssText = 'font-size:9px;opacity:.5;letter-spacing:.1em;margin-top:6px;';
  title.textContent = 'MASTER L/R';

  const masterRow = document.createElement('div');
  masterRow.id = 'master-lr-row';
  masterRow.style.cssText = 'display:flex;gap:2px;margin-top:2px;height:14px;';

  ['L', 'R'].forEach((ch, idx) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'flex:1;position:relative;';

    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:8px;opacity:.5;position:absolute;left:2px;top:1px;z-index:1;';
    lbl.textContent = ch;

    const canvas = document.createElement('canvas');
    canvas.id = `master-lr-canvas-${idx}`;
    canvas.height = 14;
    canvas.style.cssText = 'width:100%;height:14px;border-radius:2px;display:block;';

    wrap.appendChild(lbl);
    wrap.appendChild(canvas);
    masterRow.appendChild(wrap);
  });

  meters.appendChild(title);
  meters.appendChild(masterRow);

  // Paint master L/R in the meter loop — tapped by paintMasterLR()
})();

function paintMasterLR() {
  const outs = state.meters.outputs;
  [0, 1].forEach(idx => {
    const canvas = document.getElementById(`master-lr-canvas-${idx}`);
    if (!canvas) return;
    const db = outs[idx] ?? -60;
    canvas.width = canvas.offsetWidth || 60;
    drawMeterCanvas(canvas, db, Math.max(peakHold.outputs[idx] ?? db, db), null);
  });
}

// Hook paintMasterLR into rAF (patch requestAnimationFrame chain)
const _origPaintMeters_rAF = paintMeters;
// Extend via a wrapper that also calls paintMasterLR each frame
(function wrapPaintMetersForMaster() {
  // The rAF is self-scheduling inside paintMeters. We'll call paintMasterLR
  // after the meters DOM exists. Actually simpler: call it from a separate rAF loop.
  function masterLoop() {
    paintMasterLR();
    requestAnimationFrame(masterLoop);
  }
  requestAnimationFrame(masterLoop);
})();

// ── W-35: Signal presence pulse on active cells ───────────────────────────
// When input i has signal AND cell[i][o] is active, add a CSS pulse class

const SIGNAL_THRESHOLD_DB = -40;
const _cellPulseActive = new Set();

function signalPulse(dir, idx, db) {
  if (dir !== 'in') return;
  const row = state.matrix[idx] || [];
  const hasSignal = db > SIGNAL_THRESHOLD_DB;
  for (let o = 0; o < state.nOutputs; o++) {
    const cellId = `cell-${idx}-${o}`;
    const el = document.getElementById(cellId);
    if (!el) continue;
    if (hasSignal && row[o] > 0) {
      if (!_cellPulseActive.has(cellId)) {
        el.classList.add('signal-pulse');
        _cellPulseActive.add(cellId);
      }
    } else {
      if (_cellPulseActive.has(cellId)) {
        el.classList.remove('signal-pulse');
        _cellPulseActive.delete(cellId);
      }
    }
  }
}

// ── W-23: Zone overview dashboard ────────────────────────────────────────
// Shows a compact card for each zone with live meter summary + active routing count

(function buildZoneOverview() {
  // Inject the overview panel into the page after DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    // Create a toggle button in the toolbar
    const toolbar = document.getElementById('matrix-toolbar');
    if (!toolbar) return;

    const btnOverview = document.createElement('button');
    btnOverview.id = 'btn-zone-overview';
    btnOverview.className = 'btn-icon';
    btnOverview.textContent = '▦';
    btnOverview.title = 'Zone overview dashboard';
    toolbar.appendChild(btnOverview);

    // Panel
    const panel = document.createElement('div');
    panel.id = 'zone-overview-panel';
    panel.style.cssText = 'display:none;position:fixed;top:60px;right:12px;width:220px;background:var(--bg-mid);border:1px solid var(--border);border-radius:6px;z-index:100;padding:10px 12px;box-shadow:0 4px 16px #000a;';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:10px;letter-spacing:.15em;opacity:.5;margin-bottom:8px;';
    title.textContent = 'ZONE OVERVIEW';
    panel.appendChild(title);

    const body = document.createElement('div');
    body.id = 'zone-overview-body';
    panel.appendChild(body);

    document.body.appendChild(panel);

    btnOverview.addEventListener('click', () => {
      const show = panel.style.display === 'none';
      panel.style.display = show ? 'block' : 'none';
      if (show) renderZoneOverview();
    });

    // Refresh every 500ms while open
    setInterval(() => {
      if (panel.style.display !== 'none') renderZoneOverview();
    }, 500);
  });
})();

function renderZoneOverview() {
  const body = document.getElementById('zone-overview-body');
  if (!body) return;
  body.innerHTML = '';

  if (zones.length === 0) {
    body.innerHTML = '<p style="font-size:10px;opacity:.5;">No zones. Create one to see overview.</p>';
    return;
  }

  zones.forEach((z, zIdx) => {
    const card = document.createElement('div');
    card.style.cssText = 'margin-bottom:8px;padding:6px 8px;background:var(--bg-low);border-radius:4px;cursor:pointer;';
    card.title = `Switch to zone: ${z.name}`;
    card.addEventListener('click', () => {
      const sel = document.getElementById('zone-select');
      if (sel) { sel.value = String(zIdx); applyZoneFilter(); }
      document.getElementById('zone-overview-panel').style.display = 'none';
      toast(`Zone: ${z.name}`, 'ok');
    });

    // Zone name + route count
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;';

    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = 'font-size:11px;font-weight:600;';
    nameSpan.textContent = z.name;

    // Count active routes for this zone
    let routeCount = 0;
    for (let i = 0; i < state.nInputs; i++) {
      for (const o of z.outputs) {
        if ((state.matrix[i]?.[o] ?? 0) > 0) routeCount++;
      }
    }
    const routeSpan = document.createElement('span');
    routeSpan.style.cssText = 'font-size:9px;opacity:.5;';
    routeSpan.textContent = `${routeCount} route${routeCount !== 1 ? 's' : ''}`;

    header.appendChild(nameSpan);
    header.appendChild(routeSpan);
    card.appendChild(header);

    // Mini meter bar (average of zone outputs)
    const outDbValues = z.outputs.map(o => state.meters.outputs[o] ?? -60);
    const avgDb = outDbValues.length > 0
      ? outDbValues.reduce((a, b) => a + b, 0) / outDbValues.length
      : -60;
    const pct = Math.max(0, Math.min(100, (avgDb + 60) / 60 * 100));

    const meterBar = document.createElement('div');
    meterBar.style.cssText = 'height:4px;background:#222;border-radius:2px;overflow:hidden;';
    const fill = document.createElement('div');
    fill.style.cssText = `height:100%;width:${pct.toFixed(1)}%;background:${avgDb > -6 ? '#ff3a3a' : avgDb > -18 ? '#ff9a3a' : '#3aff6a'};border-radius:2px;transition:width 0.1s;`;
    meterBar.appendChild(fill);
    card.appendChild(meterBar);

    // W-25: Zone group indicator
    const groupId = zoneGroups.find(g => g.includes(zIdx));
    if (groupId) {
      const gSpan = document.createElement('div');
      gSpan.style.cssText = 'font-size:9px;opacity:.4;margin-top:3px;';
      gSpan.textContent = `Grouped with: ${groupId.filter(gi => gi !== zIdx).map(gi => zones[gi]?.name || `Zone ${gi + 1}`).join(', ')}`;
      card.appendChild(gSpan);
    }

    body.appendChild(card);
  });

  // Group management
  const groupBtn = document.createElement('button');
  groupBtn.className = 'btn-icon';
  groupBtn.style.cssText = 'width:100%;margin-top:6px;font-size:9px;';
  groupBtn.textContent = '⊕ Manage zone groups';
  groupBtn.addEventListener('click', openZoneGroupModal);
  body.appendChild(groupBtn);
}

// ── W-25: Zone grouping with linked faders ────────────────────────────────
// When two zones are grouped, adjusting a zone-wide output level affects both.
// Stored as array of arrays: [[zoneIdx, zoneIdx], ...]

let zoneGroups = [];

function loadZoneGroups() {
  try {
    const raw = localStorage.getItem('patchbox-zone-groups');
    zoneGroups = raw ? JSON.parse(raw) : [];
  } catch (_) { zoneGroups = []; }
}

function saveZoneGroups() {
  localStorage.setItem('patchbox-zone-groups', JSON.stringify(zoneGroups));
}

loadZoneGroups();

function openZoneGroupModal() {
  // Reuse zone modal or create inline
  const modal = document.getElementById('zone-group-modal');
  if (modal) {
    renderZoneGroupEditor();
    modal.style.display = 'flex';
    return;
  }

  const m = document.createElement('div');
  m.id = 'zone-group-modal';
  m.style.cssText = 'position:fixed;inset:0;background:#000a;display:flex;align-items:center;justify-content:center;z-index:200;';

  const box = document.createElement('div');
  box.style.cssText = 'background:var(--bg-mid);border:1px solid var(--border);border-radius:8px;padding:20px;min-width:280px;max-width:90vw;';

  const title = document.createElement('h3');
  title.style.cssText = 'margin:0 0 12px;font-size:12px;letter-spacing:.15em;opacity:.7;';
  title.textContent = 'ZONE GROUPS';

  const body = document.createElement('div');
  body.id = 'zone-group-body';

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:8px;margin-top:12px;justify-content:flex-end;';

  const btnAdd = document.createElement('button');
  btnAdd.className = 'btn-icon';
  btnAdd.textContent = '+ Group';
  btnAdd.addEventListener('click', () => {
    zoneGroups.push([]);
    renderZoneGroupEditor();
  });

  const btnClose = document.createElement('button');
  btnClose.className = 'btn-primary';
  btnClose.textContent = 'Done';
  btnClose.addEventListener('click', () => {
    saveZoneGroups();
    m.style.display = 'none';
    toast('Zone groups saved', 'ok');
  });

  footer.appendChild(btnAdd);
  footer.appendChild(btnClose);
  box.appendChild(title);
  box.appendChild(body);
  box.appendChild(footer);
  m.appendChild(box);
  document.body.appendChild(m);
  renderZoneGroupEditor();
}

function renderZoneGroupEditor() {
  const body = document.getElementById('zone-group-body');
  if (!body) return;
  body.innerHTML = '';

  if (zoneGroups.length === 0) {
    body.innerHTML = '<p style="font-size:10px;opacity:.5;">No groups. Click + Group to create one.</p>';
    return;
  }

  zoneGroups.forEach((group, gIdx) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';

    const label = document.createElement('span');
    label.style.cssText = 'font-size:10px;opacity:.6;min-width:50px;';
    label.textContent = `Group ${gIdx + 1}:`;

    const sel = document.createElement('select');
    sel.multiple = true;
    sel.style.cssText = 'flex:1;font-size:10px;';
    zones.forEach((z, zIdx) => {
      const opt = document.createElement('option');
      opt.value = String(zIdx);
      opt.textContent = z.name;
      if (group.includes(zIdx)) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => {
      zoneGroups[gIdx] = Array.from(sel.selectedOptions).map(o => parseInt(o.value, 10));
    });

    const del = document.createElement('button');
    del.className = 'btn-icon';
    del.textContent = '✕';
    del.addEventListener('click', () => {
      zoneGroups.splice(gIdx, 1);
      saveZoneGroups();
      renderZoneGroupEditor();
    });

    row.appendChild(label);
    row.appendChild(sel);
    row.appendChild(del);
    body.appendChild(row);
  });
}

// ── W-26: Time-based zone preset scheduler ────────────────────────────────
// Stores schedule entries: [{time: "HH:MM", scene: "sceneName", days: [0-6], zone: zoneIdx|null}]
// Runs a periodic check every minute to load the right scene at the right time.

let scheduleEntries = [];

function loadSchedule() {
  try {
    const raw = localStorage.getItem('patchbox-schedule');
    scheduleEntries = raw ? JSON.parse(raw) : [];
  } catch (_) { scheduleEntries = []; }
}

function saveSchedule() {
  localStorage.setItem('patchbox-schedule', JSON.stringify(scheduleEntries));
}

loadSchedule();

// Schedule check runs every 30 seconds
let lastScheduleMinute = -1;

setInterval(async () => {
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const dayOfWeek = now.getDay(); // 0=Sun

  if (now.getMinutes() === lastScheduleMinute) return;
  lastScheduleMinute = now.getMinutes();

  for (const entry of scheduleEntries) {
    if (entry.time !== hhmm) continue;
    if (entry.days && entry.days.length > 0 && !entry.days.includes(dayOfWeek)) continue;

    // Load the scene
    try {
      await apiFetch(`/scenes/${encodeURIComponent(entry.scene)}/load`, 'POST');
      toast(`Scheduled: loaded scene "${entry.scene}"`, 'ok');
    } catch (err) {
      toast(`Schedule error: ${err.message}`, 'err');
    }
  }
}, 30000);

// Schedule management UI
function openScheduleModal() {
  let modal = document.getElementById('schedule-modal');
  if (modal) {
    renderScheduleEditor();
    modal.style.display = 'flex';
    return;
  }

  modal = document.createElement('div');
  modal.id = 'schedule-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:#000a;display:flex;align-items:center;justify-content:center;z-index:200;';

  const box = document.createElement('div');
  box.style.cssText = 'background:var(--bg-mid);border:1px solid var(--border);border-radius:8px;padding:20px;min-width:320px;max-width:95vw;';

  const title = document.createElement('h3');
  title.style.cssText = 'margin:0 0 8px;font-size:12px;letter-spacing:.15em;';
  title.textContent = 'ZONE SCHEDULER';

  const sub = document.createElement('p');
  sub.style.cssText = 'font-size:9px;opacity:.5;margin:0 0 12px;';
  sub.textContent = 'Automatically load scenes at scheduled times';

  const body = document.createElement('div');
  body.id = 'schedule-body';
  body.style.cssText = 'max-height:60vh;overflow-y:auto;';

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:8px;margin-top:12px;justify-content:space-between;';

  const btnAdd = document.createElement('button');
  btnAdd.className = 'btn-icon';
  btnAdd.textContent = '+ Entry';
  btnAdd.addEventListener('click', () => {
    scheduleEntries.push({ time: '08:00', scene: '', days: [1,2,3,4,5], zone: null });
    renderScheduleEditor();
  });

  const btnDone = document.createElement('button');
  btnDone.className = 'btn-primary';
  btnDone.textContent = 'Save & Close';
  btnDone.addEventListener('click', () => {
    saveSchedule();
    modal.style.display = 'none';
    toast('Schedule saved', 'ok');
  });

  footer.appendChild(btnAdd);
  footer.appendChild(btnDone);
  box.appendChild(title);
  box.appendChild(sub);
  box.appendChild(body);
  box.appendChild(footer);
  modal.appendChild(box);
  document.body.appendChild(modal);
  renderScheduleEditor();
}

const DAY_NAMES = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function renderScheduleEditor() {
  const body = document.getElementById('schedule-body');
  if (!body) return;
  body.innerHTML = '';

  if (scheduleEntries.length === 0) {
    body.innerHTML = '<p style="font-size:10px;opacity:.5;">No schedule entries. Click + Entry to add one.</p>';
    return;
  }

  // Get available scene names from state
  const sceneNames = state.scenes ? Object.keys(state.scenes) : [];

  scheduleEntries.forEach((entry, idx) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:70px 1fr auto;gap:6px;align-items:start;margin-bottom:8px;padding:8px;background:var(--bg-low);border-radius:4px;';

    // Time input
    const timeInput = document.createElement('input');
    timeInput.type = 'time';
    timeInput.value = entry.time;
    timeInput.style.cssText = 'font-size:11px;background:var(--bg-low);color:var(--text);border:1px solid var(--border);border-radius:3px;padding:2px 4px;';
    timeInput.addEventListener('change', () => { scheduleEntries[idx].time = timeInput.value; });

    // Scene select
    const sceneCol = document.createElement('div');
    sceneCol.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

    const sceneSel = document.createElement('select');
    sceneSel.style.cssText = 'font-size:10px;background:var(--bg-low);color:var(--text);border:1px solid var(--border);border-radius:3px;';
    sceneSel.innerHTML = '<option value="">-- Select scene --</option>';
    sceneNames.forEach(sn => {
      const opt = document.createElement('option');
      opt.value = sn;
      opt.textContent = sn;
      if (entry.scene === sn) opt.selected = true;
      sceneSel.appendChild(opt);
    });
    sceneSel.addEventListener('change', () => { scheduleEntries[idx].scene = sceneSel.value; });

    // Day checkboxes
    const daysRow = document.createElement('div');
    daysRow.style.cssText = 'display:flex;gap:3px;flex-wrap:wrap;';
    DAY_NAMES.forEach((d, di) => {
      const lbl = document.createElement('label');
      lbl.style.cssText = 'font-size:9px;display:flex;flex-direction:column;align-items:center;gap:1px;cursor:pointer;';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = (entry.days || []).includes(di);
      cb.style.cssText = 'width:12px;height:12px;';
      cb.addEventListener('change', () => {
        if (!scheduleEntries[idx].days) scheduleEntries[idx].days = [];
        if (cb.checked) {
          if (!scheduleEntries[idx].days.includes(di)) scheduleEntries[idx].days.push(di);
        } else {
          scheduleEntries[idx].days = scheduleEntries[idx].days.filter(v => v !== di);
        }
      });
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(d));
      daysRow.appendChild(lbl);
    });

    sceneCol.appendChild(sceneSel);
    sceneCol.appendChild(daysRow);

    // Delete button
    const del = document.createElement('button');
    del.className = 'btn-icon';
    del.textContent = '✕';
    del.addEventListener('click', () => {
      scheduleEntries.splice(idx, 1);
      saveSchedule();
      renderScheduleEditor();
    });

    row.appendChild(timeInput);
    row.appendChild(sceneCol);
    row.appendChild(del);
    body.appendChild(row);
  });
}

// Add scheduler button to toolbar
document.addEventListener('DOMContentLoaded', () => {
  const toolbar = document.getElementById('matrix-toolbar');
  if (!toolbar) return;
  const btnSched = document.createElement('button');
  btnSched.className = 'btn-icon';
  btnSched.textContent = '⏰';
  btnSched.title = 'Zone scheduler';
  btnSched.addEventListener('click', openScheduleModal);
  toolbar.appendChild(btnSched);
});

// ── Sprint 21: Accessibility + Polish ─────────────────────────────────────

// W-36: ARIA attributes on custom sliders/buttons
document.addEventListener('DOMContentLoaded', () => {
  function applyAria() {
    // Faders: aria-label, aria-valuemin/max
    document.querySelectorAll('.strip-fader').forEach(el => {
      if (!el.getAttribute('aria-label')) {
        const row = el.closest('[id^="input-row-"]');
        const idx = row ? row.id.replace('input-row-', '') : '?';
        el.setAttribute('aria-label', `Input ${parseInt(idx, 10) + 1} gain`);
        el.setAttribute('aria-valuemin', el.min || '0');
        el.setAttribute('aria-valuemax', el.max || '100');
      }
    });
    document.querySelectorAll('.out-master-fader').forEach(el => {
      if (!el.getAttribute('aria-label')) {
        el.setAttribute('aria-label', 'Output master gain');
        el.setAttribute('aria-valuemin', el.min || '0');
        el.setAttribute('aria-valuemax', el.max || '100');
      }
    });
    // Mute/solo buttons: aria-pressed
    document.querySelectorAll('[id^="in-mute-"], [id^="in-solo-"]').forEach(btn => {
      btn.setAttribute('role', 'button');
      btn.setAttribute('aria-pressed', btn.classList.contains('active') ? 'true' : 'false');
    });
    // Matrix cells: aria-label + aria-pressed
    document.querySelectorAll('.matrix-cell').forEach(cell => {
      const [, i, o] = cell.id.split('-').map(Number);
      if (!isNaN(i) && !isNaN(o)) {
        const inName  = state.inputs[i]?.label  || `IN ${i + 1}`;
        const outName = state.outputs[o]?.label || `OUT ${o + 1}`;
        cell.setAttribute('role', 'button');
        cell.setAttribute('aria-label', `Route ${inName} to ${outName}`);
        cell.setAttribute('aria-pressed', cell.classList.contains('active') ? 'true' : 'false');
      }
    });
  }

  // Apply after each buildUI and periodically
  const origBuildUI = window.buildUI; // NOTE: buildUI is a module-level function
  applyAria();
  document.addEventListener('patchbox:ui-built', applyAria);
});

// Dispatch event after buildUI — patch it
// We use a MutationObserver on matrix-rows to detect rebuilds
(function observeBuildUI() {
  const container = document.getElementById('matrix-rows');
  if (!container) {
    document.addEventListener('DOMContentLoaded', () => observeBuildUI());
    return;
  }
  const obs = new MutationObserver(() => {
    document.dispatchEvent(new CustomEvent('patchbox:ui-built'));
  });
  obs.observe(container, { childList: true });
})();

// W-38: Focus trap + ESC to close for ALL modals
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const modals = [
    document.getElementById('eq-modal'),
    document.getElementById('comp-modal'),
    document.getElementById('zone-modal'),
    document.getElementById('zone-group-modal'),
    document.getElementById('schedule-modal'),
    document.getElementById('zone-overview-panel'),
  ];
  modals.forEach(m => {
    if (!m) return;
    const isVisible = m.style.display !== 'none' && !m.classList.contains('hidden');
    if (isVisible) {
      m.style.display = 'none';
      m.classList.add('hidden');
    }
  });
});

// Focus trap helper
function trapFocus(modal) {
  const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  const first = focusable[0];
  const last  = focusable[focusable.length - 1];
  if (!first) return;
  first.focus();
  modal.addEventListener('keydown', function trap(e) {
    if (e.key !== 'Tab') return;
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}

// Apply focus trap when modals open (patch existing open calls)
['eq-modal', 'comp-modal', 'zone-modal'].forEach(id => {
  const observer = new MutationObserver(mutations => {
    mutations.forEach(m => {
      if (m.type === 'attributes' && m.attributeName === 'style') {
        const el = document.getElementById(id);
        if (el && el.style.display !== 'none') trapFocus(el);
      }
    });
  });
  document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById(id);
    if (el) observer.observe(el, { attributes: true });
  });
});

// W-39: High-contrast theme variant
document.addEventListener('DOMContentLoaded', () => {
  const toolbar = document.getElementById('matrix-toolbar');
  if (!toolbar) return;

  const btnHC = document.createElement('button');
  btnHC.id = 'btn-hc';
  btnHC.className = 'btn-icon';
  btnHC.textContent = '◈';
  btnHC.title = 'Toggle high-contrast mode';
  const hcOn = localStorage.getItem('patchbox-hc') === '1';
  if (hcOn) document.documentElement.setAttribute('data-theme', 'hc');
  btnHC.addEventListener('click', () => {
    const isHC = document.documentElement.getAttribute('data-theme') === 'hc';
    if (isHC) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.removeItem('patchbox-hc');
    } else {
      document.documentElement.setAttribute('data-theme', 'hc');
      localStorage.setItem('patchbox-hc', '1');
    }
  });
  toolbar.appendChild(btnHC);
});

// W-40: prefers-color-scheme support — auto-apply light theme if user prefers light
(function applyColorScheme() {
  const saved = localStorage.getItem('patchbox-theme');
  if (saved) return; // user has explicit preference, don't override
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
    if (localStorage.getItem('patchbox-theme')) return;
    if (e.matches) document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
  });
})();

// W-57: Scene thumbnail / state preview on hover
(function addScenePreviews() {
  document.addEventListener('DOMContentLoaded', () => {
    const sel = document.getElementById('scene-select');
    if (!sel) return;

    const preview = document.createElement('div');
    preview.id = 'scene-preview';
    preview.style.cssText = 'position:fixed;display:none;background:var(--bg-mid);border:1px solid var(--border);border-radius:6px;padding:10px 12px;z-index:150;min-width:160px;font-size:9px;pointer-events:none;box-shadow:0 4px 16px #000a;';
    document.body.appendChild(preview);

    sel.addEventListener('mouseover', async e => {
      const opt = e.target.closest('option');
      if (!opt || !opt.value) return;
      try {
        const scene = await apiFetch(`/scenes/${encodeURIComponent(opt.value)}`);
        if (!scene || !scene.state) { preview.style.display = 'none'; return; }
        const sstate = scene.state;
        const ni = sstate.matrix?.inputs ?? 0;
        const no = sstate.matrix?.outputs ?? 0;
        const gains = sstate.matrix?.gains ?? [];
        let routeCount = 0;
        for (let i = 0; i < ni; i++) {
          for (let o = 0; o < no; o++) {
            if ((gains[i]?.[o] ?? 0) > 0) routeCount++;
          }
        }
        preview.innerHTML = `
          <div style="font-weight:600;margin-bottom:6px;letter-spacing:.1em;">${escHtml(opt.value)}</div>
          <div style="opacity:.6;">Matrix: ${ni}×${no}</div>
          <div style="opacity:.6;">Active routes: ${routeCount}</div>
        `;
        const rect = sel.getBoundingClientRect();
        preview.style.left = `${rect.right + 8}px`;
        preview.style.top  = `${rect.top}px`;
        preview.style.display = 'block';
      } catch (_) {}
    });

    sel.addEventListener('mouseleave', () => {
      preview.style.display = 'none';
    });
  });
})();

// W-58: First-run onboarding overlay
(function showOnboarding() {
  if (localStorage.getItem('patchbox-onboarded')) return;

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:#000c;display:flex;align-items:center;justify-content:center;z-index:500;';

      const box = document.createElement('div');
      box.style.cssText = 'background:var(--bg-mid);border:1px solid var(--accent);border-radius:12px;padding:28px 32px;max-width:420px;text-align:center;';

      box.innerHTML = `
        <div style="font-size:22px;margin-bottom:4px;">🎛</div>
        <h2 style="font-size:14px;letter-spacing:.2em;margin:0 0 12px;">DANTE PATCHBOX</h2>
        <p style="font-size:11px;opacity:.7;line-height:1.6;margin:0 0 16px;">
          Welcome! This is your AoIP matrix mixer.<br>
          <strong>Click</strong> a matrix cell to route input → output.<br>
          <strong>Drag</strong> input labels to reorder channels.<br>
          <strong>Shift+drag</strong> cells to bulk select.<br>
          <strong>⇶</strong> fans an input to all zone outputs.<br>
          <strong>⏰</strong> opens the zone scheduler.<br>
          <strong>▦</strong> shows the zone overview.
        </p>
        <button id="onboard-ok" style="background:var(--accent);color:#000;border:none;border-radius:4px;padding:8px 24px;font-size:11px;font-weight:700;cursor:pointer;letter-spacing:.1em;">GOT IT</button>
      `;

      overlay.appendChild(box);
      document.body.appendChild(overlay);

      document.getElementById('onboard-ok').addEventListener('click', () => {
        overlay.remove();
        localStorage.setItem('patchbox-onboarded', '1');
      });
    }, 800);
  });
})();

// ── Sprint 25 — Zones Multi-bar (Z-01, Z-02, Z-03, Z-04) ────────────────

/* ── Z-01: URL-based zone routing ─────────────────────────────────────────
 * Hash format: #/zone/<zone-id>   e.g. #/zone/bar-1
 * When a zone hash is present, the entire UI is scoped to that zone's
 * outputs — other columns are hidden and a zone nav bar appears.
 */

let activeZoneId      = null;   // zone id string or null
let activeZoneOutputs = [];     // set of output indices
let serverZones       = {};     // { zone_id: [output_indices] }

async function fetchServerZones() {
  try {
    const r = await fetch('/api/v1/zones');
    if (!r.ok) return;
    const list = await r.json();
    serverZones = {};
    list.forEach(z => { serverZones[z.id] = z.outputs; });
  } catch (_) {}
}

function parseZoneHash() {
  const m = window.location.hash.match(/^#\/zone\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

function applyZoneMode(zoneId) {
  const zoneBar = document.getElementById('zone-nav-bar');
  if (!zoneId || !serverZones[zoneId]) {
    // All-zones mode
    activeZoneId      = null;
    activeZoneOutputs = [];
    if (zoneBar) zoneBar.style.display = 'none';
    applyZoneFilter();
    return;
  }
  activeZoneId      = zoneId;
  activeZoneOutputs = serverZones[zoneId];

  // Update / create zone nav bar
  if (!zoneBar) buildZoneNavBar();
  const bar = document.getElementById('zone-nav-bar');
  if (bar) {
    bar.style.display = '';
    bar.querySelector('.zone-nav-name').textContent = zoneId;
  }
  applyZoneFilter();
  renderZoneMasterFader(zoneId);
  renderZoneSourceSelector(zoneId);
  renderZonePresetPanel(zoneId);
}

function applyZoneFilter() {
  if (!activeZoneId || activeZoneOutputs.length === 0) {
    // Restore all outputs
    document.querySelectorAll('[data-col]').forEach(el => el.style.display = '');
    document.querySelectorAll('.output-label-cell, .output-label-strip')
      .forEach(el => el.style.display = '');
    return;
  }
  const set = new Set(activeZoneOutputs);
  // Matrix column headers + cells
  document.querySelectorAll('[data-col]').forEach(el => {
    const c = parseInt(el.dataset.col, 10);
    el.style.display = set.has(c) ? '' : 'none';
  });
  // Output labels in strips view
  document.querySelectorAll('.output-label-strip').forEach(el => {
    const c = parseInt(el.dataset.output, 10);
    el.style.display = set.has(c) ? '' : 'none';
  });
}

function buildZoneNavBar() {
  const bar = document.createElement('div');
  bar.id = 'zone-nav-bar';
  bar.className = 'zone-nav-bar';
  bar.innerHTML = `
    <a href="#" class="zone-nav-back" title="Back to all zones">← All</a>
    <span class="zone-nav-name"></span>
    <div id="zone-master-wrap" class="zone-master-wrap"></div>
    <div id="zone-source-wrap" class="zone-source-wrap"></div>
    <div id="zone-preset-wrap" class="zone-preset-wrap"></div>
  `;
  bar.querySelector('.zone-nav-back').addEventListener('click', e => {
    e.preventDefault();
    window.location.hash = '';
  });
  // Insert after toolbar
  const toolbar = document.querySelector('.toolbar');
  if (toolbar && toolbar.parentNode) {
    toolbar.parentNode.insertBefore(bar, toolbar.nextSibling);
  } else {
    document.body.insertBefore(bar, document.body.firstChild);
  }
}

// ── Z-02: Per-zone master volume fader ───────────────────────────────────

function renderZoneMasterFader(zoneId) {
  const wrap = document.getElementById('zone-master-wrap');
  if (!wrap) return;

  // Derive current average master_gain for zone outputs
  let gain = 1.0;
  if (state.outputs && activeZoneOutputs.length > 0) {
    const vals = activeZoneOutputs
      .filter(o => state.outputs[o])
      .map(o => state.outputs[o].master_gain ?? 1.0);
    if (vals.length) gain = vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  const db   = Math.round(gainToDb(gain) * 10) / 10;
  const pct  = Math.round(Math.sqrt(gain / 4) * 100); // sqrt scale for display

  wrap.innerHTML = `
    <label class="zone-master-label">MASTER</label>
    <input type="range" class="zone-master-fader" min="0" max="100" step="1"
           value="${pct}" title="Zone master gain: ${db} dB">
    <span class="zone-master-db">${db > 0 ? '+' : ''}${db} dB</span>
  `;

  let zmDebounce = null;
  const slider = wrap.querySelector('.zone-master-fader');
  const dbLabel = wrap.querySelector('.zone-master-db');

  slider.addEventListener('input', () => {
    const v   = parseInt(slider.value, 10) / 100;
    const g   = Math.pow(v, 2) * 4; // inverse of sqrt scale
    const d   = Math.round(gainToDb(g) * 10) / 10;
    dbLabel.textContent = (d > 0 ? '+' : '') + d + ' dB';
    clearTimeout(zmDebounce);
    zmDebounce = setTimeout(async () => {
      try {
        await fetch(`/api/v1/zones/${encodeURIComponent(zoneId)}/master-gain`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gain: g }),
        });
      } catch (e) { showToast('Zone master error: ' + e.message, 'error'); }
    }, 80);
  });

  slider.addEventListener('dblclick', () => {
    slider.value = Math.round(Math.sqrt(1.0 / 4) * 100);
    slider.dispatchEvent(new Event('input'));
  });
}

// ── Z-03: Zone source selector ────────────────────────────────────────────

function renderZoneSourceSelector(zoneId) {
  const wrap = document.getElementById('zone-source-wrap');
  if (!wrap || !state.inputs) return;

  // Determine which inputs are currently routed to any zone output (>0 gain)
  const routedInputs = new Set();
  (state.inputs || []).forEach((inp, i) => {
    const routed = activeZoneOutputs.some(o => (state.matrix[i] ?? [])[o] > 0);
    if (routed) routedInputs.add(i);
  });

  const chips = (state.inputs || []).map((inp, i) => {
    const active = routedInputs.has(i);
    return `<button class="zone-source-chip ${active ? 'active' : ''}"
                    data-idx="${i}" title="${active ? 'Routed' : 'Click to route'} → ${zoneId}">
              ${escHtml(inp.label || `In ${i + 1}`)}
            </button>`;
  }).join('');

  wrap.innerHTML = `<span class="zone-source-label">SOURCE</span>${chips}`;

  wrap.querySelectorAll('.zone-source-chip').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = parseInt(btn.dataset.idx, 10);
      const isActive = btn.classList.contains('active');
      const unity = 1.0;
      const off   = 0.0;

      try {
        // Route or un-route this input to/from all zone outputs
        for (const o of activeZoneOutputs) {
          await fetch(`/api/v1/matrix/${i}/${o}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gain: isActive ? off : unity }),
          });
        }
        showToast(isActive ? `Unrouted ${state.inputs[i]?.label ?? 'In'} from ${zoneId}` :
                             `Routed ${state.inputs[i]?.label ?? 'In'} → ${zoneId}`, 'info');
      } catch (e) { showToast(e.message, 'error'); }
    });
  });
}

// ── Z-04: Zone presets ────────────────────────────────────────────────────

let zonePresets = []; // names for current zone

async function loadZonePresets(zoneId) {
  try {
    const r = await fetch(`/api/v1/zones/${encodeURIComponent(zoneId)}/presets`);
    zonePresets = r.ok ? await r.json() : [];
  } catch (_) { zonePresets = []; }
}

async function renderZonePresetPanel(zoneId) {
  const wrap = document.getElementById('zone-preset-wrap');
  if (!wrap) return;
  await loadZonePresets(zoneId);

  const opts = zonePresets.map(n => `<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('');
  wrap.innerHTML = `
    <span class="zone-preset-label">PRESET</span>
    <select class="zone-preset-sel" title="Zone preset">
      <option value="">— select —</option>
      ${opts}
    </select>
    <button class="zone-preset-btn" id="btn-zone-preset-load" title="Load selected preset">Load</button>
    <button class="zone-preset-btn" id="btn-zone-preset-save" title="Save current zone state as new preset">Save</button>
    <button class="zone-preset-btn danger" id="btn-zone-preset-del" title="Delete selected preset">✕</button>
  `;

  document.getElementById('btn-zone-preset-load')?.addEventListener('click', async () => {
    const sel = wrap.querySelector('.zone-preset-sel');
    if (!sel.value) { showToast('Select a preset first', 'warn'); return; }
    try {
      const r = await fetch(
        `/api/v1/zones/${encodeURIComponent(zoneId)}/presets/${encodeURIComponent(sel.value)}/load`,
        { method: 'POST' });
      if (!r.ok) { showToast('Load failed: ' + r.status, 'error'); return; }
      showToast(`Loaded preset "${sel.value}"`, 'info');
    } catch (e) { showToast(e.message, 'error'); }
  });

  document.getElementById('btn-zone-preset-save')?.addEventListener('click', async () => {
    const name = prompt('Save zone preset as:');
    if (!name) return;
    try {
      const r = await fetch(`/api/v1/zones/${encodeURIComponent(zoneId)}/presets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) { showToast('Save failed: ' + r.status, 'error'); return; }
      showToast(`Saved preset "${name}"`, 'info');
      await renderZonePresetPanel(zoneId);
    } catch (e) { showToast(e.message, 'error'); }
  });

  document.getElementById('btn-zone-preset-del')?.addEventListener('click', async () => {
    const sel = wrap.querySelector('.zone-preset-sel');
    if (!sel.value) { showToast('Select a preset first', 'warn'); return; }
    if (!confirm(`Delete preset "${sel.value}"?`)) return;
    try {
      const r = await fetch(
        `/api/v1/zones/${encodeURIComponent(zoneId)}/presets/${encodeURIComponent(sel.value)}`,
        { method: 'DELETE' });
      if (!r.ok) { showToast('Delete failed: ' + r.status, 'error'); return; }
      showToast(`Deleted preset "${sel.value}"`, 'info');
      await renderZonePresetPanel(zoneId);
    } catch (e) { showToast(e.message, 'error'); }
  });
}

// ── Init: zone routing from URL hash ─────────────────────────────────────

(async function initZoneRouting() {
  await fetchServerZones();
  const initialZone = parseZoneHash();
  if (initialZone) applyZoneMode(initialZone);

  window.addEventListener('hashchange', () => {
    const zoneId = parseZoneHash();
    applyZoneMode(zoneId);
  });

  // Also hook state updates to refresh zone UI panels
  const origApply = typeof applySnapshot === 'function' ? applySnapshot : null;
  // Refresh zone panels after state updates
  const zonePanelRefresh = () => {
    if (!activeZoneId) return;
    renderZoneMasterFader(activeZoneId);
    renderZoneSourceSelector(activeZoneId);
    applyZoneFilter();
  };
  // Wire into existing post-snapshot hooks
  if (window._zonePanelRefreshRegistered !== true) {
    window._zonePanelRefreshRegistered = true;
    // Poll-based fallback: refresh zone panels every 3s if zone is active
    setInterval(zonePanelRefresh, 3000);
  }
})();

// ── Sprint 26 — Auth (A-01, A-02, A-05) ──────────────────────────────────

const AUTH_KEY  = 'patchbox-jwt';
const AUTH_USER = 'patchbox-user';
const AUTH_ROLE = 'patchbox-role';
const AUTH_ZONE = 'patchbox-zone';

function authToken()    { return localStorage.getItem(AUTH_KEY); }
function authRole()     { return localStorage.getItem(AUTH_ROLE) || 'readonly'; }
function authZone()     { return localStorage.getItem(AUTH_ZONE) || null; }
function authUsername() { return localStorage.getItem(AUTH_USER) || ''; }

function storeAuth(data) {
  localStorage.setItem(AUTH_KEY,  data.token);
  localStorage.setItem(AUTH_USER, data.username);
  localStorage.setItem(AUTH_ROLE, data.role);
  if (data.zone) localStorage.setItem(AUTH_ZONE, data.zone);
  else localStorage.removeItem(AUTH_ZONE);
}

function clearAuth() {
  [AUTH_KEY, AUTH_USER, AUTH_ROLE, AUTH_ZONE].forEach(k => localStorage.removeItem(k));
}

/// Inject Authorization header into all fetch calls when token is present.
/// We monkey-patch the global fetch to add the Bearer token automatically.
(function patchFetch() {
  const orig = window.fetch.bind(window);
  window.fetch = function(url, opts = {}) {
    const token = authToken();
    if (token && typeof url === 'string' && (url.startsWith('/api/') || url.startsWith('/ws'))) {
      opts.headers = opts.headers || {};
      if (!opts.headers['Authorization'] && !opts.headers['authorization']) {
        opts.headers['Authorization'] = `Bearer ${token}`;
      }
    }
    return orig(url, opts);
  };
})();

/// Patch WebSocket URL to include token as query param (A-05).
(function patchWebSocket() {
  const OrigWS = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    const token = authToken();
    if (token && (url.startsWith('ws://') || url.startsWith('wss://'))) {
      const sep = url.includes('?') ? '&' : '?';
      url = url + sep + 'token=' + encodeURIComponent(token);
    }
    return new OrigWS(url, protocols);
  };
  window.WebSocket.prototype = OrigWS.prototype;
  window.WebSocket.CONNECTING = OrigWS.CONNECTING;
  window.WebSocket.OPEN       = OrigWS.OPEN;
  window.WebSocket.CLOSING    = OrigWS.CLOSING;
  window.WebSocket.CLOSED     = OrigWS.CLOSED;
})();

/// Check if the server requires auth (api_keys non-empty) by looking for 401.
async function checkAuthRequired() {
  try {
    const r = await fetch('/api/v1/state');
    return r.status === 401;
  } catch (_) { return false; }
}

/// Check current token is still valid.
async function validateToken() {
  const token = authToken();
  if (!token) return false;
  try {
    const r = await fetch('/api/v1/auth/whoami');
    return r.ok;
  } catch (_) { return false; }
}

/// Show the login overlay.
function showLoginOverlay() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.style.display = 'flex';
}

/// Hide the login overlay.
function hideLoginOverlay() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.style.display = 'none';
}

/// A-02: After login, redirect bar_staff users to their zone.
function applyRoleRedirect() {
  const role = authRole();
  const zone = authZone();
  if (role === 'bar_staff' && zone && !window.location.hash.includes(zone)) {
    window.location.hash = `/zone/${zone}`;
  }
}

/// Add a logout button to the header.
function addLogoutButton() {
  if (document.getElementById('btn-logout')) return;
  const btn = document.createElement('button');
  btn.id = 'btn-logout';
  btn.className = 'btn-header';
  btn.textContent = `${authUsername()} ⏏`;
  btn.title = 'Sign out';
  btn.style.cssText = 'font-size:9px;opacity:0.7;border-color:transparent';
  btn.addEventListener('click', () => {
    clearAuth();
    window.location.reload();
  });
  const header = document.getElementById('header');
  if (header) header.appendChild(btn);
}

/// Init auth flow.
(async function initAuth() {
  const authRequired = await checkAuthRequired();
  if (!authRequired) return; // dev mode, no auth needed

  const tokenValid = await validateToken();
  if (tokenValid) {
    hideLoginOverlay();
    addLogoutButton();
    applyRoleRedirect();
    return;
  }

  // Show login form
  showLoginOverlay();
  document.getElementById('login-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl    = document.getElementById('login-error');
    const btn      = document.getElementById('login-submit');

    btn.disabled = true;
    btn.textContent = 'SIGNING IN…';
    if (errEl) errEl.style.display = 'none';

    try {
      const r = await fetch('/api/v1/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username, password }),
      });
      if (r.ok) {
        const data = await r.json();
        storeAuth(data);
        hideLoginOverlay();
        addLogoutButton();
        applyRoleRedirect();
        // Trigger state refresh
        if (typeof applySnapshot === 'function') setTimeout(applySnapshot, 100);
      } else {
        const body = await r.json().catch(() => ({}));
        if (errEl) {
          errEl.textContent = body.error || 'Sign in failed';
          errEl.style.display = '';
        }
      }
    } catch (e) {
      if (errEl) { errEl.textContent = 'Network error'; errEl.style.display = ''; }
    } finally {
      btn.disabled = false;
      btn.textContent = 'SIGN IN';
    }
  });
})();

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 27 — P-02, P-05, P-06, P-09
// ═══════════════════════════════════════════════════════════════════════════

// ── Shared helpers ──────────────────────────────────────────────────────────

/// Extract device prefix from a channel name.
/// "Bar1_L" → "Bar1", "Stage_01_L" → "Stage_01", "FOH" → "FOH"
function deviceOf(name) {
  if (!name) return '—';
  // split on last '_' if the suffix is a short code (≤3 chars) — e.g. _L, _R, _01
  const m = name.match(/^(.+?)_([A-Za-z0-9]{1,3})$/);
  if (m) return m[1];
  // fall back to stripping trailing digits
  return name.replace(/\d+$/, '') || name;
}

/// Group an array of {id, name} channel objects by device prefix.
/// Returns Map<string, [{id,name}]> sorted by device name.
function groupByDevice(channels) {
  const map = new Map();
  for (const ch of channels) {
    const dev = deviceOf(ch.name);
    if (!map.has(dev)) map.set(dev, []);
    map.get(dev).push(ch);
  }
  return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

// ── P-02: Device tree browser ───────────────────────────────────────────────

const deviceTreeCollapsed = {};
let treeActive = false;

function initTreeBrowser() {
  const btnTree = document.getElementById('btn-tree');
  const panel   = document.getElementById('tree-panel');
  const close   = document.getElementById('tree-panel-close');
  if (!btnTree || !panel) return;

  btnTree.addEventListener('click', () => {
    treeActive = !treeActive;
    btnTree.classList.toggle('active', treeActive);
    panel.classList.toggle('hidden', !treeActive);
    if (treeActive) renderTreePanel();
  });
  close.addEventListener('click', () => {
    treeActive = false;
    btnTree.classList.remove('active');
    panel.classList.add('hidden');
  });
}

function renderTreePanel() {
  const body = document.getElementById('tree-panel-body');
  if (!body || !window.state) return;

  const inputs  = (window.state.inputs  || []);
  const outputs = (window.state.outputs || []);
  const inGroups  = groupByDevice(inputs);
  const outGroups = groupByDevice(outputs);

  let html = '<div class="tree-section-title">INPUTS</div>';
  for (const [dev, chs] of inGroups) {
    const collapsed = deviceTreeCollapsed['in:' + dev];
    html += `<div class="tree-device" data-dev="${escHtml(dev)}" data-type="in">
      <div class="tree-device-header" data-dev="${escHtml(dev)}" data-type="in">
        <span class="tree-caret">${collapsed ? '▶' : '▼'}</span>
        <span class="tree-dev-name">${escHtml(dev)}</span>
        <span class="tree-dev-count">${chs.length}</span>
      </div>
      <div class="tree-device-rows${collapsed ? ' hidden' : ''}">`;
    for (const ch of chs) {
      html += `<div class="tree-ch-row" data-id="${ch.id}" data-type="in">${escHtml(ch.name)}</div>`;
    }
    html += '</div></div>';
  }

  html += '<div class="tree-section-title" style="margin-top:12px">OUTPUTS</div>';
  for (const [dev, chs] of outGroups) {
    const collapsed = deviceTreeCollapsed['out:' + dev];
    html += `<div class="tree-device" data-dev="${escHtml(dev)}" data-type="out">
      <div class="tree-device-header" data-dev="${escHtml(dev)}" data-type="out">
        <span class="tree-caret">${collapsed ? '▶' : '▼'}</span>
        <span class="tree-dev-name">${escHtml(dev)}</span>
        <span class="tree-dev-count">${chs.length}</span>
      </div>
      <div class="tree-device-rows${collapsed ? ' hidden' : ''}">`;
    for (const ch of chs) {
      html += `<div class="tree-ch-row" data-id="${ch.id}" data-type="out">${escHtml(ch.name)}</div>`;
    }
    html += '</div></div>';
  }

  body.innerHTML = html;

  // Toggle collapse on device header click
  body.querySelectorAll('.tree-device-header').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const dev   = hdr.dataset.dev;
      const type  = hdr.dataset.type;
      const key   = type + ':' + dev;
      deviceTreeCollapsed[key] = !deviceTreeCollapsed[key];
      renderTreePanel();
    });
  });

  // Highlight rows on channel click
  body.querySelectorAll('.tree-ch-row').forEach(row => {
    row.addEventListener('click', () => {
      const id   = Number(row.dataset.id);
      const type = row.dataset.type;
      highlightChannel(id, type);
    });
  });
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/// Flash-highlight the matrix row or column for a channel.
function highlightChannel(id, type) {
  if (type === 'in') {
    const tr = document.querySelector(`#matrix-rows tr[data-row="${id}"]`);
    if (tr) { tr.classList.add('tree-highlight'); setTimeout(() => tr.classList.remove('tree-highlight'), 1200); }
  } else {
    document.querySelectorAll(`#output-labels .output-label[data-col="${id}"]`).forEach(el => {
      el.classList.add('tree-highlight');
      setTimeout(() => el.classList.remove('tree-highlight'), 1200);
    });
  }
}

// ── P-05: Batch connect ─────────────────────────────────────────────────────

let batchActive = false;
const batchSelectedRows = new Set();

function initBatchConnect() {
  const btnBatch  = document.getElementById('btn-batch');
  const bar       = document.getElementById('batch-action-bar');
  const applyBtn  = document.getElementById('batch-apply-btn');
  const clearBtn  = document.getElementById('batch-clear-btn');
  const outSel    = document.getElementById('batch-output-select');
  if (!btnBatch || !bar) return;

  btnBatch.addEventListener('click', () => {
    batchActive = !batchActive;
    btnBatch.classList.toggle('active', batchActive);
    if (!batchActive) {
      clearBatchSelection();
      bar.classList.add('hidden');
    }
    // Re-render row headers as clickable
    document.querySelectorAll('#matrix-rows tr').forEach(tr => {
      const th = tr.querySelector('th');
      if (th) th.style.cursor = batchActive ? 'pointer' : '';
    });
  });

  // Row header click handler (delegated)
  document.getElementById('matrix-rows')?.addEventListener('click', e => {
    if (!batchActive) return;
    const th = e.target.closest('th');
    if (!th) return;
    const tr = th.closest('tr');
    if (!tr) return;
    const rowId = Number(tr.dataset.row);
    if (batchSelectedRows.has(rowId)) {
      batchSelectedRows.delete(rowId);
      tr.classList.remove('batch-selected');
    } else {
      batchSelectedRows.add(rowId);
      tr.classList.add('batch-selected');
    }
    updateBatchBar();
  });

  applyBtn.addEventListener('click', async () => {
    const col = Number(outSel.value);
    if (isNaN(col) || batchSelectedRows.size === 0) return;
    applyBtn.disabled = true;
    applyBtn.textContent = '…';
    const promises = [];
    for (const row of batchSelectedRows) {
      promises.push(
        fetch(`/api/v1/matrix/${row}/${col}`, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({gain:1}) })
      );
    }
    await Promise.all(promises);
    applyBtn.disabled = false;
    applyBtn.textContent = 'APPLY';
    clearBatchSelection();
    bar.classList.add('hidden');
  });

  clearBtn.addEventListener('click', () => {
    clearBatchSelection();
    bar.classList.add('hidden');
  });
}

function clearBatchSelection() {
  batchSelectedRows.clear();
  document.querySelectorAll('#matrix-rows tr.batch-selected').forEach(tr => tr.classList.remove('batch-selected'));
  const countEl = document.getElementById('batch-selected-count');
  if (countEl) countEl.textContent = '0 rows';
}

function updateBatchBar() {
  const bar      = document.getElementById('batch-action-bar');
  const countEl  = document.getElementById('batch-selected-count');
  const outSel   = document.getElementById('batch-output-select');
  if (!bar) return;

  if (batchSelectedRows.size > 0) {
    bar.classList.remove('hidden');
    if (countEl) countEl.textContent = `${batchSelectedRows.size} row${batchSelectedRows.size > 1 ? 's' : ''}`;
    // Populate output dropdown from current state
    if (outSel && window.state?.outputs) {
      const prev = outSel.value;
      outSel.innerHTML = window.state.outputs.map((o, i) =>
        `<option value="${i}"${String(i) === String(prev) ? ' selected' : ''}>${escHtml(o.name || `OUT ${i+1}`)}</option>`
      ).join('');
    }
  } else {
    bar.classList.add('hidden');
  }
}

// ── P-06: Routing templates ─────────────────────────────────────────────────

function initTemplatePanel() {
  const btnTpl   = document.getElementById('btn-templates');
  const panel    = document.getElementById('template-panel');
  const closeBtn = document.getElementById('template-panel-close');
  const saveBtn  = document.getElementById('template-save-btn');
  if (!btnTpl || !panel) return;

  btnTpl.addEventListener('click', () => {
    const open = !panel.classList.contains('hidden');
    panel.classList.toggle('hidden', open);
    if (!open) loadTemplateList();
  });
  closeBtn.addEventListener('click', () => panel.classList.add('hidden'));

  saveBtn.addEventListener('click', async () => {
    const nameEl = document.getElementById('template-name-input');
    const name   = nameEl?.value.trim();
    if (!name) { nameEl?.focus(); return; }
    if (!window.state?.matrix) return;
    const matrix = window.state.matrix.map(row => row.map(g => g > 0));
    saveBtn.disabled = true;
    saveBtn.textContent = '…';
    try {
      const r = await fetch('/api/v1/templates', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ name, matrix }),
      });
      if (r.ok || r.status === 204) {
        nameEl.value = '';
        await loadTemplateList();
      } else {
        alert('Save failed: ' + r.status);
      }
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'SAVE';
    }
  });
}

async function loadTemplateList() {
  const listEl = document.getElementById('template-list');
  if (!listEl) return;
  listEl.innerHTML = '<span class="template-loading">Loading…</span>';
  try {
    const r = await fetch('/api/v1/templates');
    const names = await r.json();
    if (!names.length) { listEl.innerHTML = '<span class="template-empty">No templates saved</span>'; return; }
    listEl.innerHTML = names.map(n => `
      <div class="template-item">
        <span class="template-item-name">${escHtml(n)}</span>
        <button class="btn-header template-load-btn" data-name="${escHtml(n)}" style="font-size:9px">LOAD</button>
        <button class="btn-icon template-del-btn" data-name="${escHtml(n)}" title="Delete">✕</button>
      </div>`).join('');

    listEl.querySelectorAll('.template-load-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.name;
        btn.disabled = true;
        btn.textContent = '…';
        await fetch(`/api/v1/templates/${encodeURIComponent(name)}/load`, { method: 'POST' });
        btn.disabled = false;
        btn.textContent = 'LOAD';
      });
    });
    listEl.querySelectorAll('.template-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.name;
        if (!confirm(`Delete template "${name}"?`)) return;
        await fetch(`/api/v1/templates/${encodeURIComponent(name)}`, { method: 'DELETE' });
        await loadTemplateList();
      });
    });
  } catch {
    listEl.innerHTML = '<span class="template-empty">Error loading templates</span>';
  }
}

// ── P-09: Spider / cable view ───────────────────────────────────────────────

let spiderActive = false;
let spiderSvg    = null;

function initSpiderView() {
  const btn = document.getElementById('btn-spider');
  if (!btn) return;
  btn.addEventListener('click', () => {
    spiderActive = !spiderActive;
    btn.classList.toggle('active', spiderActive);
    if (spiderActive) {
      ensureSpiderSvg();
      drawSpider();
    } else {
      removeSpiderSvg();
    }
  });
}

function ensureSpiderSvg() {
  if (spiderSvg) return;
  const matrixArea = document.getElementById('matrix-area');
  if (!matrixArea) return;
  spiderSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  spiderSvg.id = 'spider-svg';
  spiderSvg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:50;overflow:visible';
  matrixArea.style.position = 'relative';
  matrixArea.appendChild(spiderSvg);
}

function removeSpiderSvg() {
  if (spiderSvg) { spiderSvg.remove(); spiderSvg = null; }
}

function drawSpider() {
  if (!spiderActive || !spiderSvg || !window.state) return;
  spiderSvg.innerHTML = '';

  const matrixArea = document.getElementById('matrix-area');
  if (!matrixArea) return;
  const areaRect = matrixArea.getBoundingClientRect();

  const matrix  = window.state.matrix  || [];
  const outputs = window.state.outputs || [];

  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r];
    const tr  = document.querySelector(`#matrix-rows tr[data-row="${r}"]`);
    if (!tr) continue;
    const th = tr.querySelector('th');
    if (!th) continue;
    const thRect = th.getBoundingClientRect();
    const x1 = thRect.right  - areaRect.left;
    const y1 = thRect.top    + thRect.height / 2 - areaRect.top;

    for (let c = 0; c < row.length; c++) {
      if (!(row[c] > 0)) continue;
      const outLabel = document.querySelector(`#output-labels .output-label[data-col="${c}"]`);
      if (!outLabel) continue;
      const olRect = outLabel.getBoundingClientRect();
      const x2 = olRect.left + olRect.width / 2 - areaRect.left;
      const y2 = olRect.bottom - areaRect.top;

      const cx1 = x1 + Math.abs(x2 - x1) * 0.5;
      const cy1 = y1;
      const cx2 = x2;
      const cy2 = y2 - Math.abs(y1 - y2) * 0.5;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`);
      path.setAttribute('stroke', 'rgba(245,166,35,0.4)');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');
      spiderSvg.appendChild(path);
    }
  }
}

// ── Wire up toolbar buttons after DOM is ready ──────────────────────────────

(function initSprint27() {
  function onReady(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }
  onReady(() => {
    initTreeBrowser();
    initBatchConnect();
    initTemplatePanel();
    initSpiderView();

    // Re-draw spider + tree whenever state is refreshed
    const origApply = window.applySnapshot;
    if (typeof origApply === 'function') {
      window.applySnapshot = async function(...args) {
        const result = await origApply.apply(this, args);
        if (treeActive) renderTreePanel();
        if (spiderActive) { ensureSpiderSvg(); drawSpider(); }
        return result;
      };
    }

    // Also redraw spider on window resize
    window.addEventListener('resize', () => { if (spiderActive) drawSpider(); });
  });
})();

// metering.js — VU metering with continuous rAF animation loop
//
// Architecture:
//   WS frames (10 Hz) → store targets per meter
//   rAF loop (60 Hz)  → chase targets with frame-rate-independent ballistics
//   DOM writes         → direct style sets, no CSS transitions

import { state } from './state.js';

// ─── Ballistics Presets ───────────────────────────────────────────────────
export const BALLISTICS_PRESETS = {
  Digital: { attackMs: 0,   releaseMs: 300,  peakHoldMs: 1500, peakDecayDbPerSec: 20 },
  PPM:     { attackMs: 10,  releaseMs: 1700, peakHoldMs: 0,    peakDecayDbPerSec: 0  },
  VU:      { attackMs: 300, releaseMs: 300,  peakHoldMs: 0,    peakDecayDbPerSec: 0  },
};

// ─── Conversion helpers ───────────────────────────────────────────────────
export function dbToPercent(db) {
  if (!isFinite(db) || db <= -60) return 0;
  if (db >= 0) return 100;
  return ((db + 60) / 60) * 100;
}

export function dbToColour(db) {
  if (db > -3)  return 'var(--vu-red)';
  if (db > -12) return 'var(--vu-amber)';
  return 'var(--vu-green)';
}

// ─── Per-meter animation state ────────────────────────────────────────────
const _anim = new Map();  // id → { displayDb, targetDb, peakLevel, peakTime }

function _getAnim(id) {
  let a = _anim.get(id);
  if (!a) {
    a = { displayDb: -60, targetDb: -60, peakLevel: -60, peakTime: 0 };
    _anim.set(id, a);
  }
  return a;
}

// ─── Animation loop ──────────────────────────────────────────────────────
let _loopRunning = false;
let _lastTick = 0;
let _idleCount = 0;
let _ballistics = BALLISTICS_PRESETS.Digital;
const IDLE_LIMIT = 300;  // ~5s at 60fps before auto-stop

function _ensureLoop() {
  _idleCount = 0;
  if (!_loopRunning) {
    _loopRunning = true;
    _lastTick = performance.now();
    requestAnimationFrame(_tick);
  }
}

function _tick(now) {
  if (!_loopRunning) return;

  const dt = Math.min(now - _lastTick, 50);  // cap to avoid jumps after tab restore
  _lastTick = now;
  const b = _ballistics;
  let anyMoving = false;

  for (const [id, a] of _anim) {
    const prev = a.displayDb;
    const target = a.targetDb;
    const diff = target - prev;

    // Ballistic chase with real delta time
    if (Math.abs(diff) > 0.05) {
      const tauMs = diff > 0 ? b.attackMs : b.releaseMs;
      const alpha = tauMs <= 0 ? 1 : 1 - Math.exp(-2 * dt / tauMs);
      a.displayDb = prev + alpha * diff;
      anyMoving = true;
    } else {
      a.displayDb = target;
    }

    // Peak hold & decay
    if (a.displayDb > a.peakLevel) {
      a.peakLevel = a.displayDb;
      a.peakTime = now;
    }
    let peakDb = a.peakLevel;
    const holdMs = b.peakHoldMs || 1500;
    const elapsed = now - a.peakTime;
    if (elapsed > holdMs) {
      if (b.peakDecayDbPerSec > 0) {
        peakDb = a.peakLevel - b.peakDecayDbPerSec * ((elapsed - holdMs) / 1000);
      }
      if (peakDb <= -60) {
        a.peakLevel = -60;
        peakDb = -60;
      }
      anyMoving = true;
    }

    // Update shared peak hold state for external consumers
    state.peakHold.set(id, { level: peakDb, timestamp: now });

    // DOM writes
    const pct  = dbToPercent(a.displayDb);
    const col  = dbToColour(a.displayDb);
    const ppct = dbToPercent(peakDb);
    const pcol = dbToColour(peakDb);

    _setBar(`vu-bar-${id}`,   pct,  col);
    _setBar(`vu-fill-${id}`,  pct,  col);
    _setPeak(`vu-peak-${id}`, ppct, pcol);
    _setPeak(`vu-hold-${id}`, ppct, pcol);
  }

  if (anyMoving) {
    _idleCount = 0;
  } else if (++_idleCount > IDLE_LIMIT) {
    _loopRunning = false;
    return;
  }

  requestAnimationFrame(_tick);
}

function _setBar(elId, pct, col) {
  const el = document.getElementById(elId);
  if (el) { el.style.height = pct + '%'; el.style.background = col; }
}

function _setPeak(elId, pct, col) {
  const el = document.getElementById(elId);
  if (el) { el.style.bottom = pct + '%'; el.style.background = col; }
}

// ─── Clip badge tracking ──────────────────────────────────────────────────
const _lastClipCount = new Map();

function _updateClip(clipData) {
  for (const [id, count] of Object.entries(clipData)) {
    const prev = _lastClipCount.get(id);
    if (prev !== undefined && count > prev) {
      const badge = document.getElementById(`clip-badge-${id}`);
      if (badge) {
        badge.classList.add('active');
        clearTimeout(badge._clipTimer);
        badge._clipTimer = setTimeout(() => badge.classList.remove('active'), 2000);
      }
    }
    _lastClipCount.set(id, count);
  }
}

// ─── GR meters (no interpolation needed — slow-moving) ───────────────────
function _updateGR(grData) {
  for (const [key, db] of Object.entries(grData)) {
    const bar   = document.getElementById(`gr-bar-${key}`);
    const label = document.getElementById(`gr-label-${key}`);
    if (bar) {
      const pct = Math.max(0, Math.min(100, (-db / 30) * 100));
      bar.style.width = pct + '%';
    }
    if (label) {
      label.textContent = db >= 0 ? '0.0 dB' : db.toFixed(1) + ' dB';
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────

export function setGlobalBallistics(ballistics = BALLISTICS_PRESETS.Digital) {
  _ballistics = ballistics;
}

/** Legacy compat: peak hold access. Now driven by the animation loop. */
export function updatePeakHold(id, db) {
  const a = _getAnim(id);
  if (db > a.peakLevel) {
    a.peakLevel = db;
    a.peakTime = performance.now();
  }
}

/**
 * Main entry: called from ws.js on every metering frame.
 * Cheap — just stores target values, no DOM work.
 */
export function updateAll(msg, ballistics = BALLISTICS_PRESETS.Digital) {
  _ballistics = ballistics;

  const { rx, tx, gr, bus, peak, clip } = msg;

  if (rx)   for (const [id, db] of Object.entries(rx))   _getAnim(id).targetDb = db;
  if (tx)   for (const [id, db] of Object.entries(tx))   _getAnim(id).targetDb = db;
  if (bus)  for (const [id, db] of Object.entries(bus))  _getAnim(id).targetDb = db;
  if (peak) for (const [id, db] of Object.entries(peak)) {
    const a = _getAnim(id);
    if (db > a.peakLevel) { a.peakLevel = db; a.peakTime = performance.now(); }
  }
  if (gr)   _updateGR(gr);
  if (clip) _updateClip(clip);

  _ensureLoop();
}

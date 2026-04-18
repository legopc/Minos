// metering.js — VU metering with continuous rAF animation loop
//
// Architecture:
//   Server (50ms EMA) → WS frames (10 Hz) → store targets per meter
//   rAF loop (60 Hz)  → chase targets with frame-rate-independent ballistics
//   DOM writes         → scaleY transform (GPU-composited, no layout reflow)

import { state } from './state.js';

// ─── Ballistics Presets ───────────────────────────────────────────────────
export const BALLISTICS_PRESETS = {
  // Fast: smooth interpolation between 10Hz WS frames, slow visual release.
  // Server already provides 50ms EMA so we don't need long client attack.
  Fast:    { attackMs: 80,  releaseMs: 500,  peakHoldMs: 2000, peakDecayDbPerSec: 8  },
  Digital: { attackMs: 0,   releaseMs: 300,  peakHoldMs: 1500, peakDecayDbPerSec: 20 },
  PPM:     { attackMs: 10,  releaseMs: 1700, peakHoldMs: 0,    peakDecayDbPerSec: 0  },
  VU:      { attackMs: 300, releaseMs: 300,  peakHoldMs: 0,    peakDecayDbPerSec: 0  },
};

// ─── Conversion helpers ───────────────────────────────────────────────────
// Floor at -48 dBFS: keeps the full bar within the normal working range.
// -48 → 0%, -24 → 50%, -12 → 75%, -6 → 87.5%, 0 → 100%
export function dbToPercent(db) {
  if (!isFinite(db) || db <= -48) return 0;
  if (db >= 0) return 100;
  return ((db + 48) / 48) * 100;
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
    a = { displayDb: -48, targetDb: -48, peakLevel: -48, peakTime: 0 };
    _anim.set(id, a);
  }
  return a;
}

// ─── Animation loop ──────────────────────────────────────────────────────
let _loopRunning = false;
let _lastTick = 0;
let _idleCount = 0;
let _ballistics = BALLISTICS_PRESETS.Fast;
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

    // Peak hold tracks targetDb (actual server level), not animated displayDb,
    // so the hold catches the real peak even when attack ballistic is slow.
    if (a.targetDb > a.peakLevel) {
      a.peakLevel = a.targetDb;
      a.peakTime = now;
    }
    let peakDb = a.peakLevel;
    const holdMs = b.peakHoldMs || 1500;
    const elapsed = now - a.peakTime;
    if (elapsed > holdMs) {
      if (b.peakDecayDbPerSec > 0) {
        peakDb = a.peakLevel - b.peakDecayDbPerSec * ((elapsed - holdMs) / 1000);
      }
      if (peakDb <= -48) {
        a.peakLevel = -48;
        peakDb = -48;
      }
      anyMoving = true;
    }

    // Update shared peak hold state for external consumers
    state.peakHold.set(id, { level: peakDb, timestamp: now });

    // DOM writes — scaleY for GPU-composited animation, solid color by level
    const scale  = dbToPercent(a.displayDb) / 100;
    const pscale = dbToPercent(peakDb) / 100;
    const col    = dbToColour(a.displayDb);
    const pcol   = dbToColour(peakDb);

    _setScale(`vu-bar-${id}`,  scale, col);
    _setScale(`vu-fill-${id}`, scale, col);
    _setPeak(`vu-peak-${id}`, pscale * 100, pcol);
    _setPeak(`vu-hold-${id}`, pscale * 100, pcol);
  }

  if (anyMoving) {
    _idleCount = 0;
  } else if (++_idleCount > IDLE_LIMIT) {
    _loopRunning = false;
    return;
  }

  requestAnimationFrame(_tick);
}

function _setScale(elId, scale, col) {
  const el = document.getElementById(elId);
  if (el) {
    el.style.transform = `scaleY(${scale})`;
    if (col) el.style.background = col;
  }
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

export function setGlobalBallistics(ballistics = BALLISTICS_PRESETS.Fast) {
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
export function updateAll(msg, ballistics = BALLISTICS_PRESETS.Fast) {
  _ballistics = ballistics;

  const { rx, tx, gr, bus, peak, clip } = msg;

  if (rx)   for (const [id, db] of Object.entries(rx))   _getAnim(id).targetDb = db;
  if (tx)   for (const [id, db] of Object.entries(tx))   _getAnim(id).targetDb = db;
  if (bus)  for (const [id, db] of Object.entries(bus))  _getAnim(id).targetDb = db;
  // Note: server 'peak' (true block peak) is intentionally NOT used for peak hold —
  // true peaks can be 20-30dB above EMA RMS, making the hold appear far above the bar.
  // Peak hold is tracked in _tick() against targetDb (EMA RMS) instead.
  if (gr)   _updateGR(gr);
  if (clip) _updateClip(clip);

  _ensureLoop();
}

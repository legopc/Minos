// metering.js — VU update utilities, dBFS→%, peak hold, rAF batching
//
// Meter ballistics:
//   - Exponential moving average (attack/release) per meter, per frame (~200ms)
//   - Peak hold with time-based decay latch
//   - Presets: Digital (fast, 1.5s hold), PPM (IEC standard), VU (slow)

import { state } from './state.js';

// ─── Ballistics Presets ─────────────────────────────────────────────────────
/**
 * Ballistics preset: instantaneous attack, 300ms release, 1.5s peak hold.
 * @typedef {Object} BallisticsPreset
 * @property {number} attackMs - Attack time in milliseconds
 * @property {number} releaseMs - Release time in milliseconds
 * @property {number} peakHoldMs - Peak hold latch duration in milliseconds (0 = disabled)
 * @property {number} peakDecayDbPerSec - Decay rate when hold expires (dB/s)
 */

export const BALLISTICS_PRESETS = {
  Digital: { attackMs: 0, releaseMs: 300, peakHoldMs: 1500, peakDecayDbPerSec: 20 },
  PPM:     { attackMs: 10, releaseMs: 1700, peakHoldMs: 0, peakDecayDbPerSec: 0 },
  VU:      { attackMs: 300, releaseMs: 300, peakHoldMs: 0, peakDecayDbPerSec: 0 },
};

const FRAME_INTERVAL_MS = 200;  // WS metering frame cadence

const PEAK_HOLD_MS  = 2000;  // Legacy peak hold fallback
const PEAK_DECAY_MS = 200;

let _pending = false;
const _queue = new Map();  // el id → { db, isPeak }

// Per-meter ballistics state
const _meterState = new Map();  // id → { smoothed, ballistics, peakTime, peakLevel }

/**
 * Initialize or get ballistics state for a meter.
 * @param {string} id - Meter ID
 * @param {BallisticsPreset} ballistics - Ballistics preset
 * @returns {Object} meter state
 */
function _getMeterState(id, ballistics) {
  if (!_meterState.has(id)) {
    _meterState.set(id, {
      smoothed: -60,
      ballistics,
      peakTime: 0,
      peakLevel: -60,
    });
  }
  const st = _meterState.get(id);
  if (st.ballistics !== ballistics) {
    st.ballistics = ballistics;
  }
  return st;
}

/**
 * Compute exponential smoothing coefficient from attack/release time and frame interval.
 * α = 1 - exp(-2 * τ_frame / τ_time)
 * @param {number} timeMs - Attack or release time in ms
 * @returns {number} smoothing coefficient (0–1)
 */
function _calcSmoothCoeff(timeMs) {
  if (timeMs <= 0) return 1;
  const tau = timeMs / 1000;
  const dt = FRAME_INTERVAL_MS / 1000;
  return 1 - Math.exp(-2 * dt / tau);
}

export function dbToPercent(db) {
  if (!isFinite(db) || db <= -60) return 0;
  if (db >= 0) return 100;
  return Math.round(((db + 60) / 60) * 100);
}

export function dbToColour(db) {
  if (db > -3)  return 'var(--vu-red)';
  if (db > -12) return 'var(--vu-amber)';
  return 'var(--vu-green)';
}

/**
 * Update peak hold with optional decay after hold expires.
 * @param {string} id - Meter ID
 * @param {number} db - Current signal level in dBFS
 * @param {BallisticsPreset} [ballistics] - If provided, use ballistics decay; else legacy mode
 */
export function updatePeakHold(id, db, ballistics = null) {
  const now = Date.now();
  const ph  = state.peakHold.get(id);
  let peakDb = db;

  if (ph) {
    const holdExpired = now - ph.timestamp > (ballistics?.peakHoldMs ?? PEAK_HOLD_MS);
    if (db >= ph.level) {
      // New peak
      peakDb = db;
    } else if (!holdExpired) {
      // Still holding
      peakDb = ph.level;
    } else if (ballistics?.peakDecayDbPerSec > 0) {
      // Decay phase
      const decayDb = ballistics.peakDecayDbPerSec * ((now - ph.timestamp - (ballistics.peakHoldMs ?? PEAK_HOLD_MS)) / 1000);
      peakDb = Math.max(db, ph.level - decayDb);
    } else {
      // Legacy decay
      const decayDb = 60 * ((now - ph.timestamp - PEAK_HOLD_MS) / PEAK_DECAY_MS);
      peakDb = Math.max(db, ph.level - decayDb);
    }
  }

  if (!ph || peakDb >= ph.level || holdExpired) {
    state.peakHold.set(id, { level: peakDb, timestamp: now });
  }
}

/**
 * Apply exponential smoothing (attack/release) to a signal.
 * When new value > previous, use attack coefficient; else use release.
 * @param {string} id - Meter ID
 * @param {number} db - Incoming signal level in dBFS
 * @param {BallisticsPreset} ballistics - Ballistics preset
 * @returns {number} smoothed dB level
 */
function _smooth(id, db, ballistics) {
  const meterState = _getMeterState(id, ballistics);
  const prev = meterState.smoothed;
  
  let alpha;
  if (db > prev) {
    alpha = _calcSmoothCoeff(ballistics.attackMs);
  } else {
    alpha = _calcSmoothCoeff(ballistics.releaseMs);
  }
  
  const next = prev + alpha * (db - prev);
  meterState.smoothed = next;
  return next;
}

// Clip badge tracking
const _lastClipCount = new Map();

function _updateClip(clipData) {
  Object.entries(clipData).forEach(([id, count]) => {
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
  });
}

// GR meter update (called from _flush or directly)
function _updateGR(grData) {
  Object.entries(grData).forEach(([key, db]) => {
    const bar   = document.getElementById(`gr-bar-${key}`);
    const label = document.getElementById(`gr-label-${key}`);
    if (bar) {
      const pct = Math.max(0, Math.min(100, (-db / 30) * 100));
      bar.style.width = pct + '%';
    }
    if (label) {
      label.textContent = db >= 0 ? '0.0 dB' : db.toFixed(1) + ' dB';
    }
  });
}

/**
 * Set ballistics preset for all meters (affects active filtering).
 * @param {BallisticsPreset} ballistics - Preset (default: Digital)
 */
export function setGlobalBallistics(ballistics = BALLISTICS_PRESETS.Digital) {
  _meterState.forEach((st) => {
    st.ballistics = ballistics;
  });
}

// ── Main update (called from ws.js on every metering frame) ───────────────
/**
 * Update all meters on WS metering frame.
 * @param {Object} msg - Metering frame { rx, tx, gr, bus, peak, clip }
 * @param {BallisticsPreset} [ballistics] - Optional ballistics preset (default: Digital)
 */
export function updateAll(msg, ballistics = BALLISTICS_PRESETS.Digital) {
  const { rx, tx, gr, bus, peak, clip } = msg;

  if (rx) _updateGroup(rx, 'rx', ballistics);
  if (tx) _updateGroup(tx, 'tx', ballistics);
  if (bus) _updateGroup(bus, 'bus', ballistics);
  // Server-side true peak overrides JS-computed peak hold
  if (peak) Object.entries(peak).forEach(([id, db]) => updatePeakHold(id, db, ballistics));
  if (gr) _updateGR(gr);
  if (clip) _updateClip(clip);

  if (!_pending) {
    _pending = true;
    requestAnimationFrame(_flush);
  }
}

function _updateGroup(data, prefix, ballistics) {
  Object.entries(data).forEach(([id, rawDb]) => {
    const db = _smooth(id, rawDb, ballistics);
    updatePeakHold(id, db, ballistics);
    _queue.set(`vu-bar-${id}`, { db, isPeak: false });
    // Also update matrix mini-vu (rx channels only)
    _queue.set(`vu-fill-${id}`, { db, isPeak: false, isMini: true });
    const ph = state.peakHold.get(id);
    if (ph) {
      _queue.set(`vu-peak-${id}`, { db: ph.level, isPeak: true });
      _queue.set(`vu-hold-${id}`, { db: ph.level, isPeak: true });
    }
  });
}

function _flush() {
  _pending = false;
  _queue.forEach(({ db, isPeak, isMini, isZone }, elId) => {
    const el = document.getElementById(elId);
    if (!el) return;
    const pct = dbToPercent(db);
    if (isMini) {
      // Matrix mini-VU: vertical fill (height %)
      el.style.height = pct + '%';
      el.style.background = dbToColour(db);
    } else if (isPeak) {
      el.style.bottom = pct + '%';
      el.style.background = dbToColour(db);
    } else {
      el.style.height = pct + '%';
      el.style.background = dbToColour(db);
    }
  });
  _queue.clear();
}

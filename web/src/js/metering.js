// metering.js — VU update utilities, dBFS→%, peak hold, rAF batching

import { state } from './state.js';

const PEAK_HOLD_MS  = 2000;
const PEAK_DECAY_MS = 200;

let _pending = false;
const _queue = new Map();  // el id → { db, isPeak }

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

export function updatePeakHold(id, db) {
  const now = Date.now();
  const ph  = state.peakHold.get(id);
  if (!ph || db >= ph.level || now - ph.timestamp > PEAK_HOLD_MS) {
    state.peakHold.set(id, { level: db, timestamp: now });
  }
}

// Exponential smoothing coeff — applied per 200ms WS frame
const SMOOTH = 0.35;
const _smoothed = new Map();

function _smooth(id, db) {
  const prev = _smoothed.get(id) ?? db;
  const next = prev + SMOOTH * (db - prev);
  _smoothed.set(id, next);
  return next;
}

// ── Main update (called from ws.js on every metering frame) ───────────────
export function updateAll(msg) {
  const { rx, tx, gr } = msg;

  if (rx) _updateGroup(rx, 'rx');
  if (tx) _updateGroup(tx, 'tx');

  if (!_pending) {
    _pending = true;
    requestAnimationFrame(_flush);
  }
}

function _updateGroup(data, prefix) {
  Object.entries(data).forEach(([id, rawDb]) => {
    const db = _smooth(id, rawDb);
    updatePeakHold(id, db);
    _queue.set(`vu-bar-${id}`, { db, isPeak: false });
    // Also update matrix mini-vu (rx channels only)
    _queue.set(`vu-fill-${id}`, { db, isPeak: false, isMini: true });
    const ph = state.peakHold.get(id);
    if (ph) _queue.set(`vu-peak-${id}`, { db: ph.level, isPeak: true });
  });
}

function _flush() {
  _pending = false;
  _queue.forEach(({ db, isPeak, isMini }, elId) => {
    const el = document.getElementById(elId);
    if (!el) return;
    const pct = dbToPercent(db);
    if (isMini) {
      // Matrix mini-VU: horizontal fill (width %)
      el.style.width = pct + '%';
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

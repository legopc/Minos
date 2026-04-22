/**
 * dsp-canvas.js — Shared SVG drawing utilities for DSP panels.
 *
 * See docs/DSP_PANELS.md §2 for full API contract and usage examples.
 *
 * Exports:
 *   SAMPLE_RATE, FREQ_POINTS, BAND_COLORS
 *   coeffsPeaking, coeffsLowShelf, coeffsHighShelf, coeffsNotch, coeffsLowPass, coeffsHighPass
 *   bandCoeffs, magSquared, computeCurveDb
 *   class FreqCanvas   — EQ / DEQ frequency response SVG with draggable handles
 *   class FilterCanvas — HPF/LPF Butterworth SVG with draggable cutoff handles
 *   class DynamicsCanvas — Transfer function SVG with draggable threshold handle
 */

// ── Constants ──────────────────────────────────────────────────────────────

export const SAMPLE_RATE = 48000;

/** 300 log-spaced frequency points 20 Hz–20 kHz */
export const FREQ_POINTS = (() => {
  const arr = new Float32Array(300);
  for (let i = 0; i < 300; i++) {
    arr[i] = 20 * Math.pow(1000, i / 299);
  }
  return arr;
})();

/** Per-band colours (bands 0–4) */
export const BAND_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#8957e5'];

// ── Internal helpers ───────────────────────────────────────────────────────

function _valid(...vals) {
  for (const v of vals) {
    if (v == null || !isFinite(v) || isNaN(v)) return false;
  }
  return true;
}

function _norm(b0, b1, b2, a0, a1, a2) {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function _svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// ── Biquad math ────────────────────────────────────────────────────────────
// All coeffs functions return { b0, b1, b2, a1, a2 } (normalised by a0).
// Formulas from Audio EQ Cookbook (Robert Bristow-Johnson).

/** @returns {{ b0, b1, b2, a1, a2 }} */
export function coeffsPeaking(freq_hz, gain_db, q, Fs = SAMPLE_RATE) {
  if (!_valid(freq_hz, gain_db, q, Fs) || freq_hz <= 0 || freq_hz >= Fs / 2 || q <= 0) return null;
  const w0 = 2 * Math.PI * freq_hz / Fs;
  const A = Math.pow(10, gain_db / 40);
  const alpha = Math.sin(w0) / (2 * q);
  const c = Math.cos(w0);
  return _norm(
    1 + alpha * A,  -2 * c,  1 - alpha * A,
    1 + alpha / A,  -2 * c,  1 - alpha / A,
  );
}

export function coeffsLowShelf(freq_hz, gain_db, q, Fs = SAMPLE_RATE) {
  if (!_valid(freq_hz, gain_db, q, Fs) || freq_hz <= 0 || freq_hz >= Fs / 2 || q <= 0) return null;
  const w0 = 2 * Math.PI * freq_hz / Fs;
  const A = Math.pow(10, gain_db / 40);
  const c = Math.cos(w0);
  const s = Math.sin(w0);
  const alpha = s / (2 * q);
  const sqA = Math.sqrt(A);
  return _norm(
         A * ((A + 1) - (A - 1) * c + 2 * sqA * alpha),
    2 * A * ((A - 1) - (A + 1) * c),
         A * ((A + 1) - (A - 1) * c - 2 * sqA * alpha),
             (A + 1) + (A - 1) * c + 2 * sqA * alpha,
       -2 * ((A - 1) + (A + 1) * c),
             (A + 1) + (A - 1) * c - 2 * sqA * alpha,
  );
}

export function coeffsHighShelf(freq_hz, gain_db, q, Fs = SAMPLE_RATE) {
  if (!_valid(freq_hz, gain_db, q, Fs) || freq_hz <= 0 || freq_hz >= Fs / 2 || q <= 0) return null;
  const w0 = 2 * Math.PI * freq_hz / Fs;
  const A = Math.pow(10, gain_db / 40);
  const c = Math.cos(w0);
  const s = Math.sin(w0);
  const alpha = s / (2 * q);
  const sqA = Math.sqrt(A);
  return _norm(
         A * ((A + 1) + (A - 1) * c + 2 * sqA * alpha),
   -2 * A * ((A - 1) + (A + 1) * c),
         A * ((A + 1) + (A - 1) * c - 2 * sqA * alpha),
             (A + 1) - (A - 1) * c + 2 * sqA * alpha,
        2 * ((A - 1) - (A + 1) * c),
             (A + 1) - (A - 1) * c - 2 * sqA * alpha,
  );
}

export function coeffsNotch(freq_hz, q, Fs = SAMPLE_RATE) {
  if (!_valid(freq_hz, q, Fs) || freq_hz <= 0 || freq_hz >= Fs / 2 || q <= 0) return null;
  const w0 = 2 * Math.PI * freq_hz / Fs;
  const alpha = Math.sin(w0) / (2 * q);
  const c = Math.cos(w0);
  return _norm(1, -2 * c, 1, 1 + alpha, -2 * c, 1 - alpha);
}

export function coeffsLowPass(freq_hz, q, Fs = SAMPLE_RATE) {
  if (!_valid(freq_hz, q, Fs) || freq_hz <= 0 || freq_hz >= Fs / 2 || q <= 0) return null;
  const w0 = 2 * Math.PI * freq_hz / Fs;
  const alpha = Math.sin(w0) / (2 * q);
  const c = Math.cos(w0);
  return _norm((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + alpha, -2 * c, 1 - alpha);
}

export function coeffsHighPass(freq_hz, q, Fs = SAMPLE_RATE) {
  if (!_valid(freq_hz, q, Fs) || freq_hz <= 0 || freq_hz >= Fs / 2 || q <= 0) return null;
  const w0 = 2 * Math.PI * freq_hz / Fs;
  const alpha = Math.sin(w0) / (2 * q);
  const c = Math.cos(w0);
  return _norm((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + alpha, -2 * c, 1 - alpha);
}

/**
 * Dispatch to the correct coeffs function based on band.band_type.
 * Returns null for bypassed bands.
 * @param {{ band_type: string, freq_hz: number, gain_db: number, q: number, bypassed: boolean }} band
 */
export function bandCoeffs(band) {
  if (!band || band.bypassed) return null;
  const { band_type, freq_hz, gain_db, q } = band;
  switch (band_type) {
    case 'Peaking':   return coeffsPeaking(freq_hz, gain_db, q);
    case 'LowShelf':  return coeffsLowShelf(freq_hz, gain_db, q);
    case 'HighShelf': return coeffsHighShelf(freq_hz, gain_db, q);
    case 'Notch':     return coeffsNotch(freq_hz, q);
    case 'LowPass':   return coeffsLowPass(freq_hz, q);
    case 'HighPass':  return coeffsHighPass(freq_hz, q);
    default:          return null;
  }
}

/**
 * Compute |H(e^jω)|² for a single biquad at the given frequency.
 * @param {{ b0, b1, b2, a1, a2 }} c
 * @param {number} freq_hz
 * @returns {number}
 */
export function magSquared(c, freq_hz, Fs = SAMPLE_RATE) {
  if (!c || !_valid(freq_hz)) return 1;
  const w = 2 * Math.PI * freq_hz / Fs;
  const cw = Math.cos(w), sw = Math.sin(w);
  const c2w = Math.cos(2 * w), s2w = Math.sin(2 * w);
  const nRe = c.b0 + c.b1 * cw + c.b2 * c2w;
  const nIm = -c.b1 * sw - c.b2 * s2w;
  const dRe = 1   + c.a1 * cw + c.a2 * c2w;
  const dIm = -c.a1 * sw - c.a2 * s2w;
  const den = dRe * dRe + dIm * dIm;
  if (den === 0) return 1;
  return (nRe * nRe + nIm * nIm) / den;
}

/**
 * Compute combined dB response across all bands.
 * Bypassed bands contribute 0 dB.
 * @param {object[]} bands
 * @returns {Float32Array} length 300, dB values for each FREQ_POINTS entry
 */
export function computeCurveDb(bands, Fs = SAMPLE_RATE) {
  const out = new Float32Array(300);
  if (!bands || !bands.length) return out;
  const active = bands.map(b => bandCoeffs(b)).filter(Boolean);
  if (!active.length) return out;
  for (let i = 0; i < 300; i++) {
    const f = FREQ_POINTS[i];
    let mag2 = 1;
    for (const c of active) mag2 *= magSquared(c, f, Fs);
    out[i] = 10 * Math.log10(Math.max(mag2, 1e-30));
  }
  return out;
}

// ── FreqCanvas ─────────────────────────────────────────────────────────────

/**
 * SVG frequency response canvas for EQ and DynamicEQ panels.
 * See docs/DSP_PANELS.md §2 "FreqCanvas usage" for full example.
 */
export class FreqCanvas {
  /**
   * @param {SVGElement} svgEl  — the <svg class="dsp-freq-svg"> element
   * @param {{ W: number, H: number, minDb: number, maxDb: number }} opts
   */
  constructor(svgEl, opts = {}) {
    this.svg = svgEl;
    const { W = 600, H = 200, minDb = -24, maxDb = 24, minHz = 20, maxHz = 20000 } = opts;
    this.W = W; this.H = H;
    this.minDb = minDb; this.maxDb = maxDb;
    this.minHz = minHz; this.maxHz = maxHz;
    this._handles = new Map();
    this._curveEl = null;
    svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svgEl.setAttribute('preserveAspectRatio', 'none');
  }

  _xOfFreq(hz) {
    return (Math.log(hz / this.minHz) / Math.log(this.maxHz / this.minHz)) * this.W;
  }
  _yOfDb(db) {
    return (1 - (db - this.minDb) / (this.maxDb - this.minDb)) * this.H;
  }
  _freqOfX(x) {
    return this.minHz * Math.pow(this.maxHz / this.minHz, x / this.W);
  }
  _dbOfY(y) {
    return this.minDb + (1 - y / this.H) * (this.maxDb - this.minDb);
  }

  /** Draw grid lines, axis labels, zero-dB reference. Call once after construction. */
  buildGrid() {
    const { W, H } = this;
    const g = _svgEl('g', { class: 'fc-grid' });

    for (const f of [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]) {
      const x = this._xOfFreq(f);
      g.appendChild(_svgEl('line', { x1: x, y1: 0, x2: x, y2: H, stroke: '#333', 'stroke-width': 1, 'stroke-dasharray': '3,3' }));
      const lbl = _svgEl('text', { x, y: H - 3, class: 'fc-label fc-label-hz', 'text-anchor': 'middle', 'font-size': 9, fill: '#555' });
      lbl.textContent = f >= 1000 ? `${f / 1000}k` : String(f);
      g.appendChild(lbl);
    }

    for (const db of [-12, -6, 0, 6, 12]) {
      if (db < this.minDb || db > this.maxDb) continue;
      const y = this._yOfDb(db);
      const isZero = db === 0;
      const line = _svgEl('line', {
        x1: 0, y1: y, x2: W, y2: y,
        stroke: isZero ? '#555' : '#333',
        'stroke-width': isZero ? 1.5 : 1,
        'stroke-dasharray': isZero ? '' : '3,3',
      });
      if (isZero) line.setAttribute('class', 'fc-zero');
      g.appendChild(line);
      const lbl = _svgEl('text', { x: 3, y: y - 2, class: 'fc-label fc-label-db', 'font-size': 9, fill: '#555' });
      lbl.textContent = `${db > 0 ? '+' : ''}${db}`;
      g.appendChild(lbl);
    }

    this.svg.appendChild(g);

    this._curveEl = _svgEl('polyline', { class: 'fc-curve', fill: 'none', stroke: '#00d4ff', 'stroke-width': 2, points: '' });
    this.svg.appendChild(this._curveEl);
  }

  /** Redraw the combined response polyline. @param {Float32Array} dbValues */
  updateCurve(dbValues) {
    if (!this._curveEl || !dbValues) return;
    const pts = [];
    for (let i = 0; i < FREQ_POINTS.length; i++) {
      const x = this._xOfFreq(FREQ_POINTS[i]);
      const db = Math.max(this.minDb, Math.min(this.maxDb, dbValues[i]));
      pts.push(`${x.toFixed(1)},${this._yOfDb(db).toFixed(1)}`);
    }
    this._curveEl.setAttribute('points', pts.join(' '));
    // keep curve above grid but below handles
    this.svg.insertBefore(this._curveEl, this.svg.querySelector('.fc-handle') || null);
  }

  /**
   * Add a draggable band handle.
   * @returns {SVGGElement} handle group — pass to startHandleDrag
   */
  addHandle(bandIdx, freq_hz, gain_db, color, label) {
    const x = this._xOfFreq(freq_hz);
    const y = this._yOfDb(gain_db);
    const g = _svgEl('g', { class: 'fc-handle', 'data-band': bandIdx, style: 'cursor:grab', 'pointer-events': 'all' });
    const circle = _svgEl('circle', { class: 'fc-handle-circle', cx: x, cy: y, r: 10, fill: 'rgba(0,0,0,0.6)', stroke: color, 'stroke-width': 2, 'pointer-events': 'none' });
    const text = _svgEl('text', { class: 'fc-handle-label', x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 10, fill: color, 'pointer-events': 'none' });
    text.textContent = label;
    g.appendChild(circle);
    g.appendChild(text);
    this.svg.appendChild(g);
    this._handles.set(bandIdx, { g, circle, text });
    return g;
  }

  /**
   * Move an existing handle to new position (after param change).
   * @param {boolean} bypassed — if true, applies .fc-handle--bypassed
   */
  moveHandle(bandIdx, freq_hz, gain_db, bypassed) {
    const h = this._handles.get(bandIdx);
    if (!h) return;
    const x = this._xOfFreq(freq_hz);
    const y = this._yOfDb(gain_db);
    h.circle.setAttribute('cx', x);
    h.circle.setAttribute('cy', y);
    h.text.setAttribute('x', x);
    h.text.setAttribute('y', y);
    h.g.classList.toggle('fc-handle--bypassed', !!bypassed);
  }

  /**
   * Wire pointer drag on a handle group element.
   * Converts SVG coordinates to freq/dB on pointermove, commits on pointerup.
   * Uses setPointerCapture for reliable drag tracking.
   *
   * @param {SVGGElement} handleEl
   * @param {(freq: number, db: number) => void} onMove   — called every pointermove
   * @param {(freq: number, db: number) => void} onCommit — called on pointerup
   * @returns {() => void} cleanup function — call in section's destroy()
   */
  startHandleDrag(handleEl, onMove, onCommit) {
    const toFreqDb = (e) => {
      const rect = this.svg.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (this.W / rect.width);
      const y = (e.clientY - rect.top)  * (this.H / rect.height);
      return [
        Math.max(this.minHz, Math.min(this.maxHz, this._freqOfX(x))),
        Math.max(this.minDb, Math.min(this.maxDb, this._dbOfY(y))),
      ];
    };
    const onDown = (e) => { e.preventDefault(); handleEl.setPointerCapture(e.pointerId); handleEl.style.cursor = 'grabbing'; };
    const onMove_ = (e) => { if (!handleEl.hasPointerCapture(e.pointerId)) return; onMove(...toFreqDb(e)); };
    const onUp    = (e) => { if (!handleEl.hasPointerCapture(e.pointerId)) return; handleEl.releasePointerCapture(e.pointerId); handleEl.style.cursor = 'grab'; onCommit(...toFreqDb(e)); };
    handleEl.addEventListener('pointerdown', onDown);
    handleEl.addEventListener('pointermove', onMove_);
    handleEl.addEventListener('pointerup',   onUp);
    return () => {
      handleEl.removeEventListener('pointerdown', onDown);
      handleEl.removeEventListener('pointermove', onMove_);
      handleEl.removeEventListener('pointerup',   onUp);
    };
  }
}

// ── FilterCanvas ────────────────────────────────────────────────────────────

/**
 * SVG canvas showing HPF + LPF Butterworth curves with draggable cutoff handles.
 * See docs/DSP_PANELS.md §5.
 */
export class FilterCanvas {
  /**
   * @param {SVGElement} svgEl
   * @param {{ W: number, H: number }} opts
   */
  constructor(svgEl, opts = {}) {
    this.svg = svgEl;
    const { W = 600, H = 140, minHz = 20, maxHz = 20000 } = opts;
    this.W = W; this.H = H;
    this.minHz = minHz; this.maxHz = maxHz;
    this._minDb = -48; this._maxDb = 6;
    this._hpfCurve = null; this._lpfCurve = null;
    this._hpfHandle = null; this._lpfHandle = null;
    svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svgEl.setAttribute('preserveAspectRatio', 'none');
  }

  _xOfFreq(hz) { return (Math.log(hz / this.minHz) / Math.log(this.maxHz / this.minHz)) * this.W; }
  _yOfDb(db)   { return (1 - (db - this._minDb) / (this._maxDb - this._minDb)) * this.H; }
  _freqOfX(x)  { return this.minHz * Math.pow(this.maxHz / this.minHz, x / this.W); }

  /** Draw grid lines and axis labels. Call once after construction. */
  buildGrid() {
    const { W, H } = this;
    const g = _svgEl('g', { class: 'fc-grid' });
    for (const f of [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]) {
      const x = this._xOfFreq(f);
      g.appendChild(_svgEl('line', { x1: x, y1: 0, x2: x, y2: H, stroke: '#333', 'stroke-width': 1, 'stroke-dasharray': '3,3' }));
      const lbl = _svgEl('text', { x, y: H - 3, class: 'fc-label fc-label-hz', 'text-anchor': 'middle', 'font-size': 9, fill: '#555' });
      lbl.textContent = f >= 1000 ? `${f / 1000}k` : String(f);
      g.appendChild(lbl);
    }
    // 0 dB and −3 dB reference lines
    const y0 = this._yOfDb(0);
    g.appendChild(_svgEl('line', { x1: 0, y1: y0, x2: W, y2: y0, stroke: '#555', 'stroke-width': 1.5 }));
    const y3 = this._yOfDb(-3);
    g.appendChild(_svgEl('line', { x1: 0, y1: y3, x2: W, y2: y3, stroke: '#444', 'stroke-width': 1, 'stroke-dasharray': '3,3' }));
    this.svg.appendChild(g);

    this._hpfCurve = _svgEl('polyline', { class: 'flt-hpf-curve', fill: 'none', stroke: '#d29922', 'stroke-width': 2, points: '' });
    this._lpfCurve = _svgEl('polyline', { class: 'flt-lpf-curve', fill: 'none', stroke: '#58a6ff', 'stroke-width': 2, points: '' });
    this.svg.appendChild(this._hpfCurve);
    this.svg.appendChild(this._lpfCurve);

    this._hpfHandle = _svgEl('circle', { class: 'flt-handle flt-hpf-handle', r: 6, fill: '#d29922', stroke: '#111', 'stroke-width': 1, cx: -100, cy: -100, style: 'cursor:ew-resize', 'pointer-events': 'all' });
    this._lpfHandle = _svgEl('circle', { class: 'flt-handle flt-lpf-handle', r: 6, fill: '#58a6ff', stroke: '#111', 'stroke-width': 1, cx: -100, cy: -100, style: 'cursor:ew-resize', 'pointer-events': 'all' });
    this.svg.appendChild(this._hpfHandle);
    this.svg.appendChild(this._lpfHandle);
  }

  _butterPoints(fc, order, isHPF) {
    const pts = [];
    for (let i = 0; i < FREQ_POINTS.length; i++) {
      const f = FREQ_POINTS[i];
      const ratio = isHPF ? fc / f : f / fc;
      const mag2 = 1 / (1 + Math.pow(ratio, 2 * order));
      const db = Math.max(this._minDb, 10 * Math.log10(Math.max(mag2, 1e-20)));
      pts.push(`${this._xOfFreq(f).toFixed(1)},${this._yOfDb(db).toFixed(1)}`);
    }
    return pts.join(' ');
  }

  _orderOf(state) {
    if (state.order) return Math.max(1, Math.round(state.order));
    if (state.slope_db_oct) return Math.max(1, Math.round(state.slope_db_oct / 6));
    return 2;
  }

  /**
   * Redraw HPF curve.
   * @param {{ enabled: boolean, freq_hz: number, slope_db_oct: number }} state
   */
  updateHpf(state) {
    if (!this._hpfCurve) return;
    if (!state || !state.enabled) {
      this._hpfCurve.setAttribute('points', '');
      this._hpfCurve.classList.add('flt-curve--disabled');
      this._hpfHandle?.setAttribute('cx', -100);
      return;
    }
    this._hpfCurve.classList.remove('flt-curve--disabled');
    this._hpfCurve.setAttribute('points', this._butterPoints(state.freq_hz, this._orderOf(state), true));
    this._hpfHandle?.setAttribute('cx', this._xOfFreq(state.freq_hz));
    this._hpfHandle?.setAttribute('cy', this._yOfDb(-3));
  }

  /**
   * Redraw LPF curve.
   * @param {{ enabled: boolean, freq_hz: number, slope_db_oct: number }} state
   */
  updateLpf(state) {
    if (!this._lpfCurve) return;
    if (!state || !state.enabled) {
      this._lpfCurve.setAttribute('points', '');
      this._lpfCurve.classList.add('flt-curve--disabled');
      this._lpfHandle?.setAttribute('cx', -100);
      return;
    }
    this._lpfCurve.classList.remove('flt-curve--disabled');
    this._lpfCurve.setAttribute('points', this._butterPoints(state.freq_hz, this._orderOf(state), false));
    this._lpfHandle?.setAttribute('cx', this._xOfFreq(state.freq_hz));
    this._lpfHandle?.setAttribute('cy', this._yOfDb(-3));
  }

  _wireDrag(handleEl, onMove, onCommit) {
    const toFreq = (e) => {
      const rect = this.svg.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (this.W / rect.width);
      return Math.max(this.minHz, Math.min(this.maxHz, this._freqOfX(x)));
    };
    const onDown = (e) => { e.preventDefault(); handleEl.setPointerCapture(e.pointerId); };
    const onMove_ = (e) => { if (!handleEl.hasPointerCapture(e.pointerId)) return; onMove(toFreq(e)); };
    const onUp    = (e) => { if (!handleEl.hasPointerCapture(e.pointerId)) return; handleEl.releasePointerCapture(e.pointerId); onCommit(toFreq(e)); };
    handleEl.addEventListener('pointerdown', onDown);
    handleEl.addEventListener('pointermove', onMove_);
    handleEl.addEventListener('pointerup',   onUp);
    return () => {
      handleEl.removeEventListener('pointerdown', onDown);
      handleEl.removeEventListener('pointermove', onMove_);
      handleEl.removeEventListener('pointerup',   onUp);
    };
  }

  /**
   * Wire horizontal drag on HPF cutoff handle.
   * @param {(freq: number) => void} onMove
   * @param {(freq: number) => void} onCommit
   * @returns {() => void} cleanup
   */
  startHpfDrag(onMove, onCommit) {
    if (!this._hpfHandle) return () => {};
    return this._wireDrag(this._hpfHandle, onMove, onCommit);
  }

  /**
   * Wire horizontal drag on LPF cutoff handle.
   * @returns {() => void} cleanup
   */
  startLpfDrag(onMove, onCommit) {
    if (!this._lpfHandle) return () => {};
    return this._wireDrag(this._lpfHandle, onMove, onCommit);
  }
}

// ── DynamicsCanvas ──────────────────────────────────────────────────────────

/**
 * SVG transfer function canvas for Compressor, Gate, and Limiter panels.
 * X-axis = input dBFS, Y-axis = output dBFS (both minDb–0).
 * See docs/DSP_PANELS.md §6–8.
 */
export class DynamicsCanvas {
  /**
   * @param {SVGElement} svgEl
   * @param {{ W: number, H: number, minDb: number, maxDb: number }} opts
   */
  constructor(svgEl, opts = {}) {
    this.svg = svgEl;
    const { W = 200, H = 200, minDb = -80, maxDb = 0 } = opts;
    this.W = W; this.H = H;
    this.minDb = minDb; this.maxDb = maxDb;
    this._curveEl = null;
    this._thrLineEl = null;
    this._thrHandleEl = null;
    this._grLineEl = null;
    this._thr = -20;
    svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svgEl.setAttribute('preserveAspectRatio', 'none');
  }

  _x(db)    { return (db - this.minDb) / (this.maxDb - this.minDb) * this.W; }
  _y(db)    { return (1 - (db - this.minDb) / (this.maxDb - this.minDb)) * this.H; }
  _dbOfX(x) { return this.minDb + (x / this.W) * (this.maxDb - this.minDb); }

  /** Draw grid and unity line. Call once after construction. */
  buildGrid() {
    const { W, H } = this;
    const g = _svgEl('g', { class: 'dc-grid' });
    for (const db of [-60, -48, -36, -24, -12, 0]) {
      if (db < this.minDb || db > this.maxDb) continue;
      g.appendChild(_svgEl('line', { x1: this._x(db), y1: 0,          x2: this._x(db), y2: H,          stroke: '#333', 'stroke-width': 1, 'stroke-dasharray': '3,3' }));
      g.appendChild(_svgEl('line', { x1: 0,           y1: this._y(db), x2: W,           y2: this._y(db), stroke: '#333', 'stroke-width': 1, 'stroke-dasharray': '3,3' }));
      const lbl = _svgEl('text', { x: this._x(db), y: H - 2, 'text-anchor': 'middle', 'font-size': 8, fill: '#555', class: 'dc-label' });
      lbl.textContent = String(db);
      g.appendChild(lbl);
    }
    this.svg.appendChild(g);

    // Unity (1:1) reference line
    this.svg.appendChild(_svgEl('line', {
      class: 'dc-unity',
      x1: this._x(this.minDb), y1: this._y(this.minDb),
      x2: this._x(this.maxDb), y2: this._y(this.maxDb),
      stroke: '#444', 'stroke-width': 1, 'stroke-dasharray': '4,4',
    }));

    this._curveEl = _svgEl('polyline', { class: 'dc-curve', fill: 'none', stroke: '#00d4ff', 'stroke-width': 2, points: '' });
    this.svg.appendChild(this._curveEl);

    this._thrLineEl = _svgEl('line', {
      class: 'dc-thr-line',
      x1: this._x(this._thr), y1: 0, x2: this._x(this._thr), y2: H,
      stroke: '#d29922', 'stroke-width': 1, 'stroke-dasharray': '4,4',
    });
    this.svg.appendChild(this._thrLineEl);

    // Diamond handle: rotated rect centred on the unity-line intercept at threshold
    this._thrHandleEl = _svgEl('rect', {
      class: 'dc-thr-handle',
      width: 10, height: 10,
      fill: '#d29922', stroke: '#111', 'stroke-width': 1,
      style: 'cursor:ew-resize',
      'pointer-events': 'all',
    });
    this._placeThrHandle(this._thr);
    this.svg.appendChild(this._thrHandleEl);

    this._grLineEl = _svgEl('line', {
      class: 'dc-gr-line',
      x1: 0, y1: 0, x2: 0, y2: H,
      stroke: '#f85149', 'stroke-width': 2, opacity: 0,
    });
    this.svg.appendChild(this._grLineEl);
  }

  _placeThrHandle(thr) {
    if (!this._thrHandleEl) return;
    const x = this._x(thr), y = this._y(thr);
    this._thrHandleEl.setAttribute('transform', `translate(${x},${y}) rotate(45) translate(-5,-5)`);
  }

  _setThr(thr) {
    this._thr = thr;
    if (this._thrLineEl) {
      this._thrLineEl.setAttribute('x1', this._x(thr));
      this._thrLineEl.setAttribute('x2', this._x(thr));
    }
    this._placeThrHandle(thr);
  }

  _setPoints(pairs) {
    if (!this._curveEl) return;
    this._curveEl.setAttribute('points', pairs.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
  }

  /** Redraw compressor soft-knee transfer curve. */
  drawCompressorCurve(threshold_db, ratio, knee_db) {
    if (!_valid(threshold_db, ratio, knee_db)) return;
    const half = knee_db / 2;
    const pts = [];
    for (let i = 0; i <= 200; i++) {
      const inDb  = this.minDb + (i / 200) * (this.maxDb - this.minDb);
      const excess = inDb - threshold_db;
      let outDb;
      if (knee_db > 0 && excess > -half && excess < half) {
        outDb = inDb + (1 / ratio - 1) * Math.pow(excess + half, 2) / (2 * knee_db);
      } else if (inDb <= threshold_db - half) {
        outDb = inDb;
      } else {
        outDb = threshold_db + (inDb - threshold_db) / ratio;
      }
      pts.push([this._x(inDb), this._y(outDb)]);
    }
    this._setPoints(pts);
    this._setThr(threshold_db);
  }

  /** Redraw gate/expander transfer curve. */
  drawGateCurve(threshold_db, ratio, range_db) {
    if (!_valid(threshold_db)) return;
    const r     = (_valid(ratio)    && ratio    > 0) ? ratio    : 4;
    const floor = (_valid(range_db) && range_db > 0) ? threshold_db - range_db : this.minDb;
    const pts = [];
    for (let i = 0; i <= 200; i++) {
      const inDb  = this.minDb + (i / 200) * (this.maxDb - this.minDb);
      const outDb = inDb >= threshold_db ? inDb : Math.max(floor, threshold_db + (inDb - threshold_db) * r);
      pts.push([this._x(inDb), this._y(outDb)]);
    }
    this._setPoints(pts);
    this._setThr(threshold_db);
  }

  /** Redraw limiter (brick-wall) transfer curve. */
  drawLimiterCurve(threshold_db) {
    if (!_valid(threshold_db)) return;
    const pts = [];
    for (let i = 0; i <= 200; i++) {
      const inDb  = this.minDb + (i / 200) * (this.maxDb - this.minDb);
      pts.push([this._x(inDb), this._y(Math.min(threshold_db, inDb))]);
    }
    this._setPoints(pts);
    this._setThr(threshold_db);
  }

  /**
   * Wire horizontal drag on the threshold handle (the diamond on the unity line).
   * @param {(db: number) => void} onMove
   * @param {(db: number) => void} onCommit
   * @returns {() => void} cleanup
   */
  startThresholdDrag(onMove, onCommit) {
    const handle = this._thrHandleEl;
    if (!handle) return () => {};
    const toDb = (e) => {
      const rect = this.svg.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (this.W / rect.width);
      return Math.max(this.minDb, Math.min(this.maxDb, this._dbOfX(x)));
    };
    const onDown = (e) => { e.preventDefault(); handle.setPointerCapture(e.pointerId); };
    const onMove_ = (e) => { if (!handle.hasPointerCapture(e.pointerId)) return; onMove(toDb(e)); };
    const onUp    = (e) => { if (!handle.hasPointerCapture(e.pointerId)) return; handle.releasePointerCapture(e.pointerId); onCommit(toDb(e)); };
    handle.addEventListener('pointerdown', onDown);
    handle.addEventListener('pointermove', onMove_);
    handle.addEventListener('pointerup',   onUp);
    return () => {
      handle.removeEventListener('pointerdown', onDown);
      handle.removeEventListener('pointermove', onMove_);
      handle.removeEventListener('pointerup',   onUp);
    };
  }

  /**
   * Update the gain-reduction indicator line (driven by WS meter events).
   * @param {number} gr_db — 0 hides the indicator
   */
  setGrIndicator(gr_db) {
    if (!this._grLineEl) return;
    if (!gr_db || gr_db >= 0) {
      this._grLineEl.setAttribute('opacity', 0);
      return;
    }
    // Vertical line at the output level (threshold + gr_db shows current operating point)
    const x = this._x(this._thr + gr_db);
    this._grLineEl.setAttribute('x1', x);
    this._grLineEl.setAttribute('x2', x);
    this._grLineEl.setAttribute('opacity', 1);
  }
}

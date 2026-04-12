/**
 * EqSection — 5-band parametric EQ with SVG frequency response curve
 *
 * Usage:
 *   import { EqSection } from '/modules/components/eq-section.js';
 *   const eq = new EqSection(containerEl, channelIndex, 'input');  // type: 'input'|'output'
 *   eq.setState({ enabled: true, bands: [...] });
 *   eq.destroy();
 */

import { inputDsp, outputDsp } from '/modules/api.js';

const SAMPLE_RATE = 48000;
const SVG_W = 600;
const SVG_H = 160;
const SVG_MID = 80;   // y at 0 dB
const DB_RANGE = 18;  // ±18 dB maps to ±80 px

const BAND_LABELS = ['LS', 'PK', 'PK', 'PK', 'HS'];

const DEFAULT_BANDS = [
  { band_type: 'LowShelf',  freq_hz: 100,   gain_db: 0.0, q: 0.707 },
  { band_type: 'Peaking',   freq_hz: 250,   gain_db: 0.0, q: 1.0   },
  { band_type: 'Peaking',   freq_hz: 1000,  gain_db: 0.0, q: 1.0   },
  { band_type: 'Peaking',   freq_hz: 4000,  gain_db: 0.0, q: 1.0   },
  { band_type: 'HighShelf', freq_hz: 10000, gain_db: 0.0, q: 0.707 },
];

// ── Biquad coefficient calculators ──────────────────────────────────────────

function coeffsPeaking(freq, gain_db, q) {
  const A  = Math.pow(10, gain_db / 40);
  const w0 = 2 * Math.PI * freq / SAMPLE_RATE;
  const alpha = Math.sin(w0) / (2 * q);
  const cosw0 = Math.cos(w0);
  const a0 = 1 + alpha / A;
  return {
    b0: (1 + alpha * A) / a0,
    b1: (-2 * cosw0)    / a0,
    b2: (1 - alpha * A) / a0,
    a1: (-2 * cosw0)    / a0,
    a2: (1 - alpha / A) / a0,
  };
}

function coeffsLowShelf(freq, gain_db, q) {
  const A  = Math.pow(10, gain_db / 40);
  const w0 = 2 * Math.PI * freq / SAMPLE_RATE;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  // S=1 slope → α = sin(w0)/2 * sqrt((A+1/A)*(1/S-1)+2)
  // With S=1: (1/S-1)=0, so α = sin(w0)/2 * sqrt(2) = sin(w0)/sqrt(2)
  const alpha = sinw0 / 2 * Math.sqrt((A + 1 / A) * (1 / 1 - 1) + 2);
  const sqA = Math.sqrt(A);
  const a0 = (A + 1) + (A - 1) * cosw0 + 2 * sqA * alpha;
  return {
    b0:  (A * ((A + 1) - (A - 1) * cosw0 + 2 * sqA * alpha)) / a0,
    b1:  (2 * A * ((A - 1) - (A + 1) * cosw0))               / a0,
    b2:  (A * ((A + 1) - (A - 1) * cosw0 - 2 * sqA * alpha)) / a0,
    a1: (-2 * ((A - 1) + (A + 1) * cosw0))                   / a0,
    a2: ((A + 1) + (A - 1) * cosw0 - 2 * sqA * alpha)        / a0,
  };
}

function coeffsHighShelf(freq, gain_db, q) {
  const A  = Math.pow(10, gain_db / 40);
  const w0 = 2 * Math.PI * freq / SAMPLE_RATE;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / 2 * Math.sqrt((A + 1 / A) * (1 / 1 - 1) + 2);
  const sqA = Math.sqrt(A);
  const a0 = (A + 1) - (A - 1) * cosw0 + 2 * sqA * alpha;
  return {
    b0:  (A * ((A + 1) + (A - 1) * cosw0 + 2 * sqA * alpha)) / a0,
    b1: (-2 * A * ((A - 1) + (A + 1) * cosw0))               / a0,
    b2:  (A * ((A + 1) + (A - 1) * cosw0 - 2 * sqA * alpha)) / a0,
    a1: (2 * ((A - 1) - (A + 1) * cosw0))                    / a0,
    a2: ((A + 1) - (A - 1) * cosw0 - 2 * sqA * alpha)        / a0,
  };
}

function bandCoeffs(band) {
  switch (band.band_type) {
    case 'LowShelf':  return coeffsLowShelf(band.freq_hz,  band.gain_db, band.q);
    case 'HighShelf': return coeffsHighShelf(band.freq_hz, band.gain_db, band.q);
    default:          return coeffsPeaking(band.freq_hz,   band.gain_db, band.q);
  }
}

/** Compute |H(e^jω)|² analytically from biquad coefficients */
function magSquared(c, freq) {
  const w   = 2 * Math.PI * freq / SAMPLE_RATE;
  const cos1 = Math.cos(w);
  const cos2 = Math.cos(2 * w);
  const sin1 = Math.sin(w);
  const sin2 = Math.sin(2 * w);
  const nRe = c.b0 + c.b1 * cos1 + c.b2 * cos2;
  const nIm = -(c.b1 * sin1 + c.b2 * sin2);
  const dRe = 1  + c.a1 * cos1 + c.a2 * cos2;
  const dIm = -(c.a1 * sin1 + c.a2 * sin2);
  return (nRe * nRe + nIm * nIm) / (dRe * dRe + dIm * dIm);
}

// ── SVG helpers ──────────────────────────────────────────────────────────────

function xFromHz(f) {
  return Math.log10(f / 20) / Math.log10(1000) * SVG_W;
}

function yFromDb(db) {
  return SVG_MID - (db / DB_RANGE) * SVG_MID;
}

/** Generate 300 log-spaced frequencies from 20 to 20000 Hz */
function logFreqs(n = 300) {
  const freqs = [];
  const lo = Math.log10(20);
  const hi = Math.log10(20000);
  for (let i = 0; i < n; i++) {
    freqs.push(Math.pow(10, lo + (hi - lo) * (i / (n - 1))));
  }
  return freqs;
}

const FREQ_POINTS = logFreqs(300);

// ── Component ────────────────────────────────────────────────────────────────

export class EqSection {
  constructor(containerEl, channelIndex, type) {
    this.containerEl  = containerEl;
    this.channelIndex = channelIndex;
    this.type         = type;
    this.api          = type === 'input' ? inputDsp : outputDsp;

    this.state = {
      enabled: true,
      bands: DEFAULT_BANDS.map(b => ({ ...b })),
    };

    this._bandHandlers = [];
    this.render();
    this.setupEventListeners();
  }

  // ── Render ──────────────────────────────────────────────────────────────

  render() {
    this.containerEl.innerHTML = `
      <div class="section-panel collapsed" data-section="eq">
        <div class="section-header" role="button" tabindex="0">
          <span class="section-title">EQ</span>
          <label class="eq-enable-label" onclick="event.stopPropagation()">
            <input type="checkbox" class="toggle-cb eq-enable-cb"> Enable
          </label>
          <span class="section-arrow">▼</span>
        </div>
        <div class="section-body eq-body">
          <svg class="eq-curve" viewBox="0 0 ${SVG_W} ${SVG_H}" preserveAspectRatio="none"></svg>
          <div class="eq-bands">
            ${this.state.bands.map((b, i) => this._bandHTML(b, i)).join('')}
          </div>
        </div>
      </div>
    `;

    this._panel   = this.containerEl.querySelector('.section-panel');
    this._header  = this._panel.querySelector('.section-header');
    this._svg     = this._panel.querySelector('.eq-curve');
    this._enableCb = this._panel.querySelector('.eq-enable-cb');

    this._buildSvgBase();
    this.redrawCurve();
  }

  _bandHTML(band, i) {
    return `
      <div class="eq-band" data-band="${i}">
        <div class="eq-band-label">${BAND_LABELS[i]}</div>
        <input type="number" class="eq-gain" min="-24" max="24"    step="0.5"  value="${band.gain_db}">
        <span class="eq-gain-unit">dB</span>
        <input type="number" class="eq-freq" min="20"  max="20000" step="1"    value="${band.freq_hz}">
        <span class="eq-freq-unit">Hz</span>
        <input type="number" class="eq-q"    min="0.1" max="10"    step="0.1"  value="${band.q}">
        <span class="eq-q-unit">Q</span>
      </div>`;
  }

  // ── SVG ─────────────────────────────────────────────────────────────────

  _svgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  _buildSvgBase() {
    const svg = this._svg;
    svg.innerHTML = '';

    // dB grid lines
    for (const db of [-18, -12, -6, 6, 12, 18]) {
      const y = yFromDb(db);
      svg.appendChild(this._svgEl('line', {
        class: 'eq-curve-grid', x1: 0, y1: y, x2: SVG_W, y2: y,
      }));
    }

    // Frequency grid lines
    for (const f of [100, 1000, 10000]) {
      const x = xFromHz(f);
      svg.appendChild(this._svgEl('line', {
        class: 'eq-curve-grid', x1: x, y1: 0, x2: x, y2: SVG_H,
      }));
    }

    // 0 dB reference
    svg.appendChild(this._svgEl('polyline', {
      class: 'eq-curve-zero',
      points: `0,${SVG_MID} ${SVG_W},${SVG_MID}`,
    }));

    // Response curve placeholder (appended last so it renders on top)
    this._curveLine = this._svgEl('polyline', { class: 'eq-curve-line', points: '' });
    svg.appendChild(this._curveLine);
  }

  redrawCurve() {
    const bands = this.state.bands;
    const coeffs = bands.map(b => bandCoeffs(b));

    const pts = FREQ_POINTS.map(f => {
      let magSq = 1;
      for (const c of coeffs) magSq *= magSquared(c, f);
      const db  = 10 * Math.log10(Math.max(magSq, 1e-20));
      const x   = xFromHz(f);
      const y   = Math.max(0, Math.min(SVG_H, yFromDb(db)));
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });

    this._curveLine.setAttribute('points', pts.join(' '));

    // Grey out when disabled
    this._panel.classList.toggle('eq-section-disabled', !this.state.enabled);
  }

  // ── Events ───────────────────────────────────────────────────────────────

  setupEventListeners() {
    this._clickHandler = () => this._panel.classList.toggle('collapsed');
    this._header.addEventListener('click', this._clickHandler);

    this._enableHandler = () => this._onEnableChange();
    this._enableCb.addEventListener('change', this._enableHandler);

    // Per-band listeners
    for (let i = 0; i < 5; i++) {
      const bandEl   = this._panel.querySelector(`.eq-band[data-band="${i}"]`);
      const gainEl   = bandEl.querySelector('.eq-gain');
      const freqEl   = bandEl.querySelector('.eq-freq');
      const qEl      = bandEl.querySelector('.eq-q');

      const handler = () => this._onBandChange(i, gainEl, freqEl, qEl);
      gainEl.addEventListener('change', handler);
      freqEl.addEventListener('change', handler);
      qEl.addEventListener('change', handler);

      this._bandHandlers.push({ gainEl, freqEl, qEl, handler });
    }
  }

  async _onBandChange(i, gainEl, freqEl, qEl) {
    const prev    = { ...this.state.bands[i] };
    const gain_db = parseFloat(gainEl.value);
    const freq_hz = parseFloat(freqEl.value);
    const q       = parseFloat(qEl.value);

    try {
      this.state.bands[i] = { band_type: this.state.bands[i].band_type, freq_hz, gain_db, q };
      await this.api.setEq(this.channelIndex, { enabled: this.state.enabled, bands: this.state.bands });
      this.redrawCurve();
    } catch (err) {
      this._toast(`EQ band ${i + 1} update failed: ${err.message}`);
      this.state.bands[i] = prev;
      gainEl.value = prev.gain_db;
      freqEl.value = prev.freq_hz;
      qEl.value    = prev.q;
    }
  }

  async _onEnableChange() {
    const enabled = this._enableCb.checked;
    const prev    = this.state.enabled;
    try {
      await this.api.setEq(this.channelIndex, { enabled, bands: this.state.bands });
      this.state.enabled = enabled;
      this.redrawCurve();
    } catch (err) {
      this._toast(`EQ enable failed: ${err.message}`);
      this._enableCb.checked = prev;
    }
  }

  _toast(msg) {
    window.dispatchEvent(new CustomEvent('pb:toast', { detail: { msg, type: 'error' } }));
  }

  // ── Public API ────────────────────────────────────────────────────────────

  setState(data) {
    if (typeof data.enabled === 'boolean') {
      this.state.enabled     = data.enabled;
      this._enableCb.checked = data.enabled;
    }

    if (Array.isArray(data.bands)) {
      data.bands.forEach((b, i) => {
        if (!this.state.bands[i]) return;
        this.state.bands[i] = { ...this.state.bands[i], ...b };
        const bandEl = this._panel.querySelector(`.eq-band[data-band="${i}"]`);
        if (!bandEl) return;
        bandEl.querySelector('.eq-gain').value = this.state.bands[i].gain_db;
        bandEl.querySelector('.eq-freq').value = this.state.bands[i].freq_hz;
        bandEl.querySelector('.eq-q').value    = this.state.bands[i].q;
      });
    }

    this.redrawCurve();
  }

  destroy() {
    this._header.removeEventListener('click', this._clickHandler);
    this._enableCb.removeEventListener('change', this._enableHandler);
    for (const { gainEl, freqEl, qEl, handler } of this._bandHandlers) {
      gainEl.removeEventListener('change', handler);
      freqEl.removeEventListener('change', handler);
      qEl.removeEventListener('change', handler);
    }
    this._bandHandlers = [];
    this.containerEl.innerHTML = '';
  }
}

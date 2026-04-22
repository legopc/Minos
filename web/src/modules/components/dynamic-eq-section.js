/**
 * DynamicEqSection — per-band dynamic EQ block.
 *
 * Mirrors EqSection but each band adds sidechain dynamics:
 *   threshold_db, ratio, attack_ms, release_ms, bypassed
 *
 * Input + output channels.
 * See docs/DSP_PANELS.md §10 for layout spec and state shape.
 */

import { inputDsp, outputDsp, apiErrorMessage } from '/modules/api.js';
import {
  FREQ_POINTS, BAND_COLORS,
  bandCoeffs, magSquared,
} from '/modules/components/dsp-canvas.js';
import { getDspDefaultsSync } from '/modules/dsp-defaults.js';

const SVG_W   = 600;
const SVG_H   = 160;
const SVG_MID = 80;
const DB_RANGE = 18;

const DEFAULT_BANDS = [
  { band_type: 'Peaking', freq_hz: 250,  gain_db: -3.0, q: 1.0, threshold_db: -20.0, ratio: 4.0, attack_ms: 10.0, release_ms: 100.0, bypassed: false },
  { band_type: 'Peaking', freq_hz: 1000, gain_db: -6.0, q: 1.0, threshold_db: -20.0, ratio: 4.0, attack_ms: 10.0, release_ms: 100.0, bypassed: false },
  { band_type: 'Peaking', freq_hz: 4000, gain_db: -3.0, q: 1.0, threshold_db: -20.0, ratio: 4.0, attack_ms: 10.0, release_ms: 100.0, bypassed: false },
  { band_type: 'Peaking', freq_hz: 8000, gain_db: -3.0, q: 1.0, threshold_db: -20.0, ratio: 4.0, attack_ms: 10.0, release_ms: 100.0, bypassed: false },
];

const BAND_TYPE_OPTIONS = ['Peaking', 'LowShelf', 'HighShelf', 'Notch'];

function xFromHz(f) {
  return Math.log10(f / 20) / Math.log10(1000) * SVG_W;
}

function yFromDb(db) {
  return SVG_MID - (db / DB_RANGE) * SVG_MID;
}

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

export class DynamicEqSection {
  constructor(el, ch, type) {
    this.el    = el;
    this.ch    = ch;
    this.type  = type;
    this._api  = type === 'input' ? inputDsp : outputDsp;
    this.state = {
      enabled: false,
      bands: DEFAULT_BANDS.map(b => ({ ...b })),
    };
    this._onSectionClick = this._handleSectionClick.bind(this);
    this._render();
    this._attachListeners();
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  _render() {
    this.el.innerHTML = `
      <div class="dsp-section" data-section="deq">
        <div class="dsp-section-hd">
          <label class="dsp-enable-label">
            <input type="checkbox" class="dsp-enable-cb toggle-cb" ${this.state.enabled ? 'checked' : ''}>
            DYN EQ
          </label>
        </div>
        <div class="dsp-section-bd">
          <svg class="dsp-freq-svg deq-curve"
               viewBox="0 0 ${SVG_W} ${SVG_H}"
               preserveAspectRatio="none"></svg>
          <div class="deq-bands">
            ${this.state.bands.map((b, i) => this._bandHTML(b, i)).join('')}
          </div>
          <div class="dsp-section-footer">
            <button class="dsp-btn deq-reset-btn">RESET</button>
          </div>
        </div>
      </div>`;

    this._enableCb = this.el.querySelector('.dsp-enable-cb');
    this._svg      = this.el.querySelector('.deq-curve');
    this._buildSvgBase();
    this._redrawCurve();
  }

  _bandHTML(b, i) {
    const color  = BAND_COLORS[i % BAND_COLORS.length];
    const typeOpts = BAND_TYPE_OPTIONS.map(t =>
      `<option value="${t}"${b.band_type === t ? ' selected' : ''}>${t}</option>`
    ).join('');
    return `
      <div class="deq-band" data-band="${i}">
        <div class="deq-band-main">
          <span class="deq-band-num" style="color:${color}">①②③④`[i]??`${i+1}</span>
          <select class="deq-band-type" data-field="band_type">${typeOpts}</select>
          <label class="deq-stepper-label">Hz
            <button class="deq-step" data-field="freq_hz" data-dir="-1">−</button>
            <input class="deq-num" type="number" data-field="freq_hz" value="${b.freq_hz}" min="20" max="20000" step="10">
            <button class="deq-step" data-field="freq_hz" data-dir="1">+</button>
          </label>
          <label class="deq-stepper-label">dB
            <button class="deq-step" data-field="gain_db" data-dir="-1">−</button>
            <input class="deq-num" type="number" data-field="gain_db" value="${b.gain_db}" min="-24" max="24" step="0.5">
            <button class="deq-step" data-field="gain_db" data-dir="1">+</button>
          </label>
          <label class="deq-stepper-label">Q
            <button class="deq-step" data-field="q" data-dir="-1">−</button>
            <input class="deq-num" type="number" data-field="q" value="${b.q}" min="0.1" max="10" step="0.1">
            <button class="deq-step" data-field="q" data-dir="1">+</button>
          </label>
          <button class="deq-byp-btn dsp-btn${b.bypassed ? ' active' : ''}" data-field="bypassed">BYP</button>
        </div>
        <div class="deq-band-dyn">
          <label class="deq-stepper-label">Thr
            <button class="deq-step" data-field="threshold_db" data-dir="-1">−</button>
            <input class="deq-num" type="number" data-field="threshold_db" value="${b.threshold_db}" min="-60" max="0" step="1">
            <button class="deq-step" data-field="threshold_db" data-dir="1">+</button>dB
          </label>
          <label class="deq-stepper-label">Ratio
            <button class="deq-step" data-field="ratio" data-dir="-1">−</button>
            <input class="deq-num" type="number" data-field="ratio" value="${b.ratio}" min="1" max="20" step="0.5">
            <button class="deq-step" data-field="ratio" data-dir="1">+</button>:1
          </label>
          <label class="deq-stepper-label">Atk
            <button class="deq-step" data-field="attack_ms" data-dir="-1">−</button>
            <input class="deq-num" type="number" data-field="attack_ms" value="${b.attack_ms}" min="0.1" max="500" step="1">
            <button class="deq-step" data-field="attack_ms" data-dir="1">+</button>ms
          </label>
          <label class="deq-stepper-label">Rel
            <button class="deq-step" data-field="release_ms" data-dir="-1">−</button>
            <input class="deq-num" type="number" data-field="release_ms" value="${b.release_ms}" min="1" max="5000" step="10">
            <button class="deq-step" data-field="release_ms" data-dir="1">+</button>ms
          </label>
        </div>
      </div>`;
  }

  // ── SVG ─────────────────────────────────────────────────────────────────────

  _buildSvgBase() {
    const svg = this._svg;
    svg.innerHTML = '';
    for (const db of [-18, -12, -6, 6, 12, 18]) {
      svg.appendChild(svgEl('line', {
        class: 'eq-curve-grid', x1: 0, y1: yFromDb(db), x2: SVG_W, y2: yFromDb(db),
      }));
    }
    for (const f of [100, 1000, 10000]) {
      const x = xFromHz(f);
      svg.appendChild(svgEl('line', {
        class: 'eq-curve-grid', x1: x, y1: 0, x2: x, y2: SVG_H,
      }));
    }
    svg.appendChild(svgEl('line', {
      class: 'eq-curve-zero', x1: 0, y1: SVG_MID, x2: SVG_W, y2: SVG_MID,
    }));
    // Placeholder for the composite curve path
    this._curvePath = svgEl('path', { class: 'eq-curve-line deq-curve-line', d: '' });
    svg.appendChild(this._curvePath);
  }

  _redrawCurve() {
    if (!this._curvePath) return;
    const activeBands = this.state.bands.filter(b => !b.bypassed);
    if (activeBands.length === 0 || !this.state.enabled) {
      this._curvePath.setAttribute('d', '');
      return;
    }
    const pts = FREQ_POINTS;
    let d = '';
    for (let i = 0; i < pts.length; i++) {
      const f   = pts[i];
      let dbSum = 0;
      for (const band of activeBands) {
        const c  = bandCoeffs(band);
        const ms = magSquared(c, f);
        dbSum   += 10 * Math.log10(Math.max(ms, 1e-30));
      }
      const x = xFromHz(f);
      const y = Math.max(0, Math.min(SVG_H, yFromDb(dbSum)));
      d += i === 0 ? `M${x.toFixed(1)} ${y.toFixed(1)}` : ` L${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    this._curvePath.setAttribute('d', d);
  }

  // ── Listeners ────────────────────────────────────────────────────────────────

  _attachListeners() {
    const bd = this.el.querySelector('.dsp-section-bd');
    bd.addEventListener('click',  this._onSectionClick);
    bd.addEventListener('change', this._onSectionClick);
    bd.addEventListener('input',  this._onSectionClick);

    this._enableCb.addEventListener('change', () => {
      this.state.enabled = this._enableCb.checked;
      this._commit();
      this._redrawCurve();
    });
  }

  _handleSectionClick(evt) {
    const target  = evt.target;
    const bandEl  = target.closest('.deq-band');
    if (!bandEl) {
      if (target.classList.contains('deq-reset-btn')) this._resetBands();
      return;
    }
    const bandIdx = parseInt(bandEl.dataset.band, 10);
    const field   = target.dataset.field;
    if (!field) return;

    const band = this.state.bands[bandIdx];

    if (field === 'bypassed' && evt.type === 'click') {
      band.bypassed = !band.bypassed;
      target.classList.toggle('active', band.bypassed);
      this._commit();
      this._redrawCurve();
      return;
    }

    if (field === 'band_type' && evt.type === 'change') {
      band.band_type = target.value;
      this._commit();
      this._redrawCurve();
      return;
    }

    if (target.classList.contains('deq-step') && evt.type === 'click') {
      const dir   = parseFloat(target.dataset.dir);
      const input = bandEl.querySelector(`input[data-field="${field}"]`);
      if (!input) return;
      const step  = parseFloat(input.step) || 1;
      const min   = parseFloat(input.min);
      const max   = parseFloat(input.max);
      const next  = Math.max(min, Math.min(max, parseFloat(input.value) + dir * step));
      input.value = next;
      band[field] = next;
      this._commit();
      this._redrawCurve();
      return;
    }

    if (target.classList.contains('deq-num') && evt.type === 'change') {
      const val  = parseFloat(target.value);
      if (!isNaN(val)) {
        band[field] = val;
        this._commit();
        this._redrawCurve();
      }
    }
  }

  _resetBands() {
    this.state.bands = DEFAULT_BANDS.map(b => ({ ...b }));
    // Re-render band rows
    const bandsEl = this.el.querySelector('.deq-bands');
    bandsEl.innerHTML = this.state.bands.map((b, i) => this._bandHTML(b, i)).join('');
    this._commit();
    this._redrawCurve();
  }

  // ── API commit ───────────────────────────────────────────────────────────────

  _commit() {
    this._api.setDeq(this.ch, this.state).catch(err => {
      window.dispatchEvent(new CustomEvent('pb:toast', {
        detail: { msg: apiErrorMessage(err), type: 'error' },
      }));
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  setState(data) {
    if (!data) return;
    const defs = getDspDefaultsSync();
    const merged = { ...(defs?.deq ?? {}), ...data };

    if (merged.enabled !== undefined) {
      this.state.enabled = merged.enabled;
      if (this._enableCb) this._enableCb.checked = merged.enabled;
    }
    if (Array.isArray(merged.bands)) {
      this.state.bands = merged.bands.map(b => ({ ...b }));
      const bandsEl = this.el.querySelector('.deq-bands');
      if (bandsEl) {
        bandsEl.innerHTML = this.state.bands.map((b, i) => this._bandHTML(b, i)).join('');
      }
    }
    this._redrawCurve();
  }

  getEnabled() { return this.state.enabled; }

  destroy() {
    const bd = this.el.querySelector('.dsp-section-bd');
    if (bd) {
      bd.removeEventListener('click',  this._onSectionClick);
      bd.removeEventListener('change', this._onSectionClick);
      bd.removeEventListener('input',  this._onSectionClick);
    }
    this.el.innerHTML = '';
  }
}

/**
 * CompressorSection — RMS compressor with SVG transfer curve
 *
 * Usage:
 *   import { CompressorSection } from '/modules/components/compressor-section.js';
 *   const cs = new CompressorSection(containerEl, channelIndex, 'input');
 *   cs.setState({ enabled: false, threshold_db: -20, ratio: 4, knee_db: 6,
 *                 attack_ms: 10, release_ms: 100, makeup_db: 0 });
 *   cs.destroy();
 *
 * TODO (sprint — see docs/DSP_PANELS.md §6):
 *   1. Import DynamicsCanvas from dsp-canvas.js
 *   2. Add dsp-dynamics-layout with 200×200 dsp-dynamics-svg on left
 *   3. Call DynamicsCanvas.buildGrid() + drawCompressorCurve() on init and param change
 *   4. Wire threshold drag via startThresholdDrag
 *   5. Fix stepper pattern — use delegated click listener
 */

import { inputDsp, outputDsp, apiErrorMessage } from '/modules/api.js';
import { getDspDefaults } from '/modules/dsp-defaults.js';
// TODO: import { DynamicsCanvas } from '/modules/components/dsp-canvas.js';

export class CompressorSection {
  constructor(containerEl, ch, type = 'input') {
    this.containerEl = containerEl;
    this.ch = ch;
    this.type = type; // 'input' or 'output'
    this.dspAPI = type === 'input' ? inputDsp : outputDsp;
    this.state = {
      enabled: false,
      threshold_db: -20.0,
      ratio: 4.0,
      knee_db: 6.0,
      attack_ms: 10.0,
      release_ms: 100.0,
      makeup_db: 0.0
    };
    
    this.render();
    this.attachListeners();
  }

  render() {
    this.containerEl.innerHTML = `
      <div class="section-panel collapsed" data-section="compressor">
        <div class="section-header" role="button" tabindex="0">
          <span class="section-title">COMP</span>
          <span class="section-summary">OFF</span>
          <span class="section-arrow">▼</span>
        </div>
        <div class="section-body">
          <div class="filter-row">
            <label class="filter-label">Enable</label>
            <input type="checkbox" class="toggle-cb">
          </div>
          <div class="filter-row">
            <label class="filter-label">Thr</label>
            <input type="number" class="freq-input" data-param="threshold_db" min="-80" max="0" step="1" value="-20">
            <span class="freq-unit">dB</span>
          </div>
          <div class="filter-row">
            <label class="filter-label">Ratio</label>
            <input type="number" class="freq-input" data-param="ratio" min="1" max="20" step="0.5" value="4">
            <span class="freq-unit">:1</span>
          </div>
          <div class="filter-row">
            <label class="filter-label">Knee</label>
            <input type="number" class="freq-input" data-param="knee_db" min="0" max="24" step="0.5" value="6">
            <span class="freq-unit">dB</span>
          </div>
          <div class="filter-row">
            <label class="filter-label">Atk</label>
            <input type="number" class="freq-input" data-param="attack_ms" min="0.1" max="500" step="0.1" value="10">
            <span class="freq-unit">ms</span>
          </div>
          <div class="filter-row">
            <label class="filter-label">Rel</label>
            <input type="number" class="freq-input" data-param="release_ms" min="10" max="4000" step="10" value="100">
            <span class="freq-unit">ms</span>
          </div>
          <div class="filter-row">
            <label class="filter-label">MkUp</label>
            <input type="number" class="freq-input" data-param="makeup_db" min="0" max="24" step="0.5" value="0">
            <span class="freq-unit">dB</span>
          </div>
        </div>
      </div>
    `;
  }

  attachListeners() {
    const panel = this.containerEl.querySelector('[data-section="compressor"]');
    const header = panel.querySelector('.section-header');
    const enableCb = panel.querySelector('input[type="checkbox"]');
    const paramInputs = Array.from(panel.querySelectorAll('input[data-param]'));

    // Store element refs + bound handlers for destroy()
    this._header = header;
    this._enableCb = enableCb;
    this._paramInputs = paramInputs;
    this._clickHandler = () => panel.classList.toggle('collapsed');
    this._keydownHandler = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        panel.classList.toggle('collapsed');
      }
    };
    this._changeHandler = () => this.handleChange();

    header.addEventListener('click', this._clickHandler);
    header.addEventListener('keydown', this._keydownHandler);
    enableCb.addEventListener('change', this._changeHandler);
    paramInputs.forEach(input => input.addEventListener('change', this._changeHandler));
  }

  async handleChange() {
    const panel = this.containerEl.querySelector('[data-section="compressor"]');
    const enableCb = panel.querySelector('input[type="checkbox"]');

    const enabled = enableCb.checked;
    const cfg = {
      enabled,
      threshold_db: parseFloat(panel.querySelector('input[data-param="threshold_db"]').value) || -20,
      ratio: parseFloat(panel.querySelector('input[data-param="ratio"]').value) || 4,
      knee_db: parseFloat(panel.querySelector('input[data-param="knee_db"]').value) || 6,
      attack_ms: parseFloat(panel.querySelector('input[data-param="attack_ms"]').value) || 10,
      release_ms: parseFloat(panel.querySelector('input[data-param="release_ms"]').value) || 100,
      makeup_db: parseFloat(panel.querySelector('input[data-param="makeup_db"]').value) || 0
    };

    const prev = { ...this.state };
    this.state = cfg;

    try {
      await this.dspAPI.setCompressor(this.ch, cfg);
      this.updateSummary();
    } catch (err) {
      this.state = prev;
      const msg = apiErrorMessage(err);
      window.dispatchEvent(new CustomEvent('pb:toast', {
        detail: { msg, type: 'error' }
      }));
      this.setState(prev);
    }
  }

  setState(data) {
    const defs = getDspDefaultsSync();
    this.state = { ...(defs?.cmp ?? {}), ...data };

    const panel = this.containerEl.querySelector('[data-section="compressor"]');
    const enableCb = panel.querySelector('input[type="checkbox"]');

    enableCb.checked = this.state.enabled;
    panel.querySelector('input[data-param="threshold_db"]').value = this.state.threshold_db;
    panel.querySelector('input[data-param="ratio"]').value = this.state.ratio;
    panel.querySelector('input[data-param="knee_db"]').value = this.state.knee_db;
    panel.querySelector('input[data-param="attack_ms"]').value = this.state.attack_ms;
    panel.querySelector('input[data-param="release_ms"]').value = this.state.release_ms;
    panel.querySelector('input[data-param="makeup_db"]').value = this.state.makeup_db;

    this.updateSummary();
  }

  updateSummary() {
    const summary = this.containerEl.querySelector('.section-summary');
    if (this.state.enabled) {
      summary.textContent = `${this.state.threshold_db}dB / ${this.state.ratio}:1`;
    } else {
      summary.textContent = 'OFF';
    }
  }

  destroy() {
    if (this._header) {
      this._header.removeEventListener('click', this._clickHandler);
      this._header.removeEventListener('keydown', this._keydownHandler);
    }
    if (this._enableCb) {
      this._enableCb.removeEventListener('change', this._changeHandler);
    }
    if (this._paramInputs) {
      this._paramInputs.forEach(input => input.removeEventListener('change', this._changeHandler));
    }
    this.containerEl.innerHTML = '';
  }
}

/**
 * LimiterSection — brick-wall output limiter with SVG transfer curve
 *
 * Usage:
 *   import { LimiterSection } from '/modules/components/limiter-section.js';
 *   const ls = new LimiterSection(containerEl, channelIndex, 'output');
 *   ls.setState({ enabled: false, threshold_db: -3, lookahead_ms: 1, release_ms: 50 });
 *   ls.destroy();
 *
 * TODO (sprint — see docs/DSP_PANELS.md §8):
 *   1. Import DynamicsCanvas from dsp-canvas.js
 *   2. Add dsp-dynamics-layout: 200×160 SVG left, params right
 *   3. Call DynamicsCanvas.buildGrid() + drawLimiterCurve() on init and param change
 *   4. Wire threshold drag via startThresholdDrag
 *   5. Add missing lookahead_ms param (not in current scaffold)
 *   6. Fix stepper pattern — use delegated click listener
 */

import { outputDsp, apiErrorMessage } from '/modules/api.js';
// TODO: import { DynamicsCanvas } from '/modules/components/dsp-canvas.js';

export class LimiterSection {
  constructor(containerEl, ch) {
    this.containerEl = containerEl;
    this.ch = ch;
    this.state = {
      enabled: false,
      threshold_db: -3.0,
      release_ms: 50.0
    };
    
    this.render();
    this.attachListeners();
  }

  render() {
    this.containerEl.innerHTML = `
      <div class="section-panel collapsed" data-section="limiter">
        <div class="section-header" role="button" tabindex="0">
          <span class="section-title">LIMITER</span>
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
            <input type="number" class="freq-input" data-param="threshold_db" min="-20" max="0" step="0.5" value="-3">
            <span class="freq-unit">dB</span>
          </div>
          <div class="filter-row">
            <label class="filter-label">Rel</label>
            <input type="number" class="freq-input" data-param="release_ms" min="10" max="500" step="1" value="50">
            <span class="freq-unit">ms</span>
          </div>
        </div>
      </div>
    `;
  }

  attachListeners() {
    const panel = this.containerEl.querySelector('[data-section="limiter"]');
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
    const panel = this.containerEl.querySelector('[data-section="limiter"]');
    const enableCb = panel.querySelector('input[type="checkbox"]');

    const enabled = enableCb.checked;
    const cfg = {
      enabled,
      threshold_db: parseFloat(panel.querySelector('input[data-param="threshold_db"]').value) || -3,
      release_ms: parseFloat(panel.querySelector('input[data-param="release_ms"]').value) || 50
    };

    const prev = { ...this.state };
    this.state = cfg;

    try {
      await outputDsp.setLimiter(this.ch, cfg);
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
    this.state = { ...data };
    
    const panel = this.containerEl.querySelector('[data-section="limiter"]');
    const enableCb = panel.querySelector('input[type="checkbox"]');

    enableCb.checked = this.state.enabled;
    panel.querySelector('input[data-param="threshold_db"]').value = this.state.threshold_db;
    panel.querySelector('input[data-param="release_ms"]').value = this.state.release_ms;

    this.updateSummary();
  }

  updateSummary() {
    const summary = this.containerEl.querySelector('.section-summary');
    if (this.state.enabled) {
      summary.textContent = `${this.state.threshold_db}dB`;
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

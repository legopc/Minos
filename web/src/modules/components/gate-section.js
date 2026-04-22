/**
 * GateSection — noise gate / expander with SVG transfer curve
 *
 * Usage:
 *   import { GateSection } from '/modules/components/gate-section.js';
 *   const gs = new GateSection(containerEl, channelIndex, 'input');
 *   gs.setState({ enabled: false, threshold_db: -40, ratio: 4,
 *                 attack_ms: 5, hold_ms: 50, release_ms: 100, range_db: 80 });
 *   gs.destroy();
 *
 * TODO (sprint — see docs/DSP_PANELS.md §7):
 *   1. Import DynamicsCanvas from dsp-canvas.js
 *   2. Add dsp-dynamics-layout: 200×200 SVG left, params right
 *   3. Call DynamicsCanvas.buildGrid() + drawGateCurve() on init and param change
 *   4. Wire threshold drag via startThresholdDrag
 *   5. Fix stepper pattern — use delegated click listener
 */

import { inputDsp, apiErrorMessage } from '/modules/api.js';
// TODO: import { DynamicsCanvas } from '/modules/components/dsp-canvas.js';

export class GateSection {
  constructor(containerEl, ch) {
    this.containerEl = containerEl;
    this.ch = ch;
    this.state = {
      enabled: false,
      threshold_db: -40.0,
      ratio: 4.0,
      attack_ms: 5.0,
      hold_ms: 50.0,
      release_ms: 100.0,
      range_db: 80.0
    };
    
    this.render();
    this.attachListeners();
  }

  render() {
    this.containerEl.innerHTML = `
      <div class="section-panel collapsed" data-section="gate">
        <div class="section-header" role="button" tabindex="0">
          <span class="section-title">GATE</span>
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
            <input type="number" class="freq-input" data-param="threshold_db" min="-80" max="0" step="1" value="-40">
            <span class="freq-unit">dB</span>
          </div>
          <div class="filter-row">
            <label class="filter-label">Ratio</label>
            <input type="number" class="freq-input" data-param="ratio" min="1" max="100" step="0.5" value="4">
            <span class="freq-unit">:1</span>
          </div>
          <div class="filter-row">
            <label class="filter-label">Atk</label>
            <input type="number" class="freq-input" data-param="attack_ms" min="0.1" max="500" step="0.1" value="5">
            <span class="freq-unit">ms</span>
          </div>
          <div class="filter-row">
            <label class="filter-label">Hold</label>
            <input type="number" class="freq-input" data-param="hold_ms" min="0" max="2000" step="1" value="50">
            <span class="freq-unit">ms</span>
          </div>
          <div class="filter-row">
            <label class="filter-label">Rel</label>
            <input type="number" class="freq-input" data-param="release_ms" min="10" max="4000" step="10" value="100">
            <span class="freq-unit">ms</span>
          </div>
          <div class="filter-row">
            <label class="filter-label">Range</label>
            <input type="number" class="freq-input" data-param="range_db" min="0" max="80" step="1" value="80">
            <span class="freq-unit">dB</span>
          </div>
        </div>
      </div>
    `;
  }

  attachListeners() {
    const panel = this.containerEl.querySelector('[data-section="gate"]');
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
    const panel = this.containerEl.querySelector('[data-section="gate"]');
    const enableCb = panel.querySelector('input[type="checkbox"]');
    const paramInputs = panel.querySelectorAll('input[data-param]');

    const enabled = enableCb.checked;
    const cfg = {
      enabled,
      threshold_db: parseFloat(panel.querySelector('input[data-param="threshold_db"]').value) || -40,
      ratio: parseFloat(panel.querySelector('input[data-param="ratio"]').value) || 4,
      attack_ms: parseFloat(panel.querySelector('input[data-param="attack_ms"]').value) || 5,
      hold_ms: parseFloat(panel.querySelector('input[data-param="hold_ms"]').value) || 50,
      release_ms: parseFloat(panel.querySelector('input[data-param="release_ms"]').value) || 100,
      range_db: parseFloat(panel.querySelector('input[data-param="range_db"]').value) || 80
    };

    const prev = { ...this.state };
    this.state = cfg;

    try {
      await inputDsp.setGate(this.ch, cfg);
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
    
    const panel = this.containerEl.querySelector('[data-section="gate"]');
    const enableCb = panel.querySelector('input[type="checkbox"]');

    enableCb.checked = this.state.enabled;
    panel.querySelector('input[data-param="threshold_db"]').value = this.state.threshold_db;
    panel.querySelector('input[data-param="ratio"]').value = this.state.ratio;
    panel.querySelector('input[data-param="attack_ms"]').value = this.state.attack_ms;
    panel.querySelector('input[data-param="hold_ms"]').value = this.state.hold_ms;
    panel.querySelector('input[data-param="release_ms"]').value = this.state.release_ms;
    panel.querySelector('input[data-param="range_db"]').value = this.state.range_db;

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

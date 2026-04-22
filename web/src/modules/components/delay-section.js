/**
 * DelaySection — output delay with range slider and distance display
 *
 * Usage:
 *   import { DelaySection } from '/modules/components/delay-section.js';
 *   const ds = new DelaySection(containerEl, channelIndex, 'output');
 *   ds.setState({ enabled: false, delay_ms: 0 });
 *   ds.destroy();
 *
 * TODO (sprint — see docs/DSP_PANELS.md §9):
 *   1. Replace current plain number input with large range slider + stepper combo
 *   2. Sync slider ↔ stepper bidirectionally on input events
 *   3. Add distance display: meters = delay_ms / 1000 * 344
 *   4. Add samples display: Math.round(delay_ms / 1000 * 48000)
 *   5. Fix stepper pattern — use delegated click listener
 */

import { outputDsp, apiErrorMessage } from '/modules/api.js';
import { getDspDefaultsSync } from '/modules/dsp-defaults.js';

export class DelaySection {
  constructor(containerEl, ch) {
    this.containerEl = containerEl;
    this.ch = ch;
    this.state = { enabled: false, delay_ms: 0 };
    
    this.render();
    this.attachListeners();
  }

  render() {
    this.containerEl.innerHTML = `
      <div class="section-panel collapsed" data-section="delay">
        <div class="section-header" role="button" tabindex="0">
          <span class="section-title">DELAY</span>
          <span class="section-summary">OFF</span>
          <span class="section-arrow">▼</span>
        </div>
        <div class="section-body">
          <div class="filter-row">
            <label class="filter-label">Enable</label>
            <input type="checkbox" class="toggle-cb">
          </div>
          <div class="filter-row">
            <label class="filter-label">Delay</label>
            <input type="number" class="delay-ms-input" id="delay-ms-${this.ch}" min="0" max="500" step="0.1" value="0">
            <span class="freq-unit">ms</span>
          </div>
        </div>
      </div>
    `;
  }

  attachListeners() {
    const panel      = this.containerEl.querySelector('[data-section="delay"]');
    const header     = panel.querySelector('.section-header');
    const enableCb   = panel.querySelector('input[type="checkbox"]');
    const delayInput = panel.querySelector('input[type="number"]');

    // Store element refs + bound handlers for destroy()
    this._header     = header;
    this._enableCb   = enableCb;
    this._delayInput = delayInput;
    this._clickHandler   = () => panel.classList.toggle('collapsed');
    this._keydownHandler = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); panel.classList.toggle('collapsed'); }
    };
    this._changeHandler = () => this.handleChange();

    header.addEventListener('click',   this._clickHandler);
    header.addEventListener('keydown', this._keydownHandler);
    enableCb.addEventListener('change',   this._changeHandler);
    delayInput.addEventListener('change', this._changeHandler);
  }

  async handleChange() {
    const panel = this.containerEl.querySelector('[data-section="delay"]');
    const enableCb = panel.querySelector('input[type="checkbox"]');
    const delayInput = panel.querySelector('input[type="number"]');

    const enabled = enableCb.checked;
    const delay_ms = parseFloat(delayInput.value) || 0;

    this.state = { enabled, delay_ms };

    try {
      await outputDsp.setDelay(this.ch, { enabled, delay_ms });
      this.updateSummary();
    } catch (err) {
      const msg = apiErrorMessage(err);
      window.dispatchEvent(new CustomEvent('pb:toast', {
        detail: { msg, type: 'error' }
      }));
      // Revert to previous state on error
      enableCb.checked = this.state.enabled;
      delayInput.value = this.state.delay_ms;
    }
  }

  setState(data) {
    const defs = getDspDefaultsSync();
    this.state = { ...(defs?.dly ?? {}), ...data };

    const panel = this.containerEl.querySelector('[data-section="delay"]');
    const enableCb = panel.querySelector('input[type="checkbox"]');
    const delayInput = panel.querySelector('input[type="number"]');

    enableCb.checked = this.state.enabled;
    delayInput.value = this.state.delay_ms;

    this.updateSummary();
  }

  updateSummary() {
    const summary = this.containerEl.querySelector('.section-summary');
    if (this.state.enabled && this.state.delay_ms > 0) {
      summary.textContent = `${this.state.delay_ms}ms`;
    } else {
      summary.textContent = 'OFF';
    }
  }

  destroy() {
    if (this._header) {
      this._header.removeEventListener('click',   this._clickHandler);
      this._header.removeEventListener('keydown', this._keydownHandler);
    }
    if (this._enableCb)   this._enableCb.removeEventListener('change',   this._changeHandler);
    if (this._delayInput) this._delayInput.removeEventListener('change', this._changeHandler);
    this.containerEl.innerHTML = '';
  }
}

/**
 * AutomixerSection — Dugan-style automatic microphone mixer.
 *
 * Input channels only.
 * State shape: { enabled, group, priority, last_mic_hold_ms }
 */

import { inputDsp, apiErrorMessage } from '/modules/api.js';
import { getDspDefaultsSync } from '/modules/dsp-defaults.js';

export class AutomixerSection {
  constructor(el, ch, _type) {
    this.el    = el;
    this.ch    = ch;
    this.state = null;
    this._onChange = this._handleChange.bind(this);
    this._render();
  }

  _render() {
    this.el.innerHTML = `
      <div class="axm-section">
        <div class="axm-row">
          <label class="axm-label">Enabled</label>
          <input type="checkbox" class="axm-enabled-cb">
        </div>
        <div class="axm-row">
          <label class="axm-label">Group</label>
          <input type="number" class="axm-group-inp" min="0" max="7" step="1" value="0">
        </div>
        <div class="axm-row">
          <label class="axm-label">Priority</label>
          <input type="number" class="axm-priority-inp" min="0" max="7" step="1" value="0">
        </div>
        <div class="axm-row">
          <label class="axm-label">Last-mic hold (ms)</label>
          <input type="number" class="axm-hold-inp" min="0" max="5000" step="50" value="0">
        </div>
      </div>
    `;
    this._cb       = this.el.querySelector('.axm-enabled-cb');
    this._groupInp = this.el.querySelector('.axm-group-inp');
    this._priInp   = this.el.querySelector('.axm-priority-inp');
    this._holdInp  = this.el.querySelector('.axm-hold-inp');

    for (const inp of [this._cb, this._groupInp, this._priInp, this._holdInp]) {
      inp.addEventListener('change', this._onChange);
    }
  }

  _handleChange() {
    const cfg = {
      enabled:          this._cb.checked,
      group:            parseInt(this._groupInp.value, 10) || 0,
      priority:         parseInt(this._priInp.value, 10) || 0,
      last_mic_hold_ms: parseInt(this._holdInp.value, 10) || 0,
    };
    const prev = { ...(this.state || {}) };
    Object.assign(this.state || {}, cfg);
    inputDsp.setAutomixer(this.ch, cfg).catch(err => {
      if (this.state) Object.assign(this.state, prev);
      this.setState(prev);
      this._toast(apiErrorMessage(err));
    });
  }

  setState(data) {
    const defs = getDspDefaultsSync();
    this.state = { ...(defs?.axm ?? {}), ...data };
    if (!this.state) return;
    if (this._cb)       this._cb.checked       = !!this.state.enabled;
    if (this._groupInp) this._groupInp.value    = this.state.group ?? 0;
    if (this._priInp)   this._priInp.value      = this.state.priority ?? 0;
    if (this._holdInp)  this._holdInp.value     = this.state.last_mic_hold_ms ?? 0;
  }

  destroy() {
    for (const inp of [this._cb, this._groupInp, this._priInp, this._holdInp]) {
      if (inp) inp.removeEventListener('change', this._onChange);
    }
    this.el.innerHTML = '';
  }

  _toast(msg) {
    window.dispatchEvent(new CustomEvent('pb:toast', { detail: { msg, type: 'error' } }));
  }
}

/**
 * AfsSection — Adaptive Feedback Suppression.
 *
 * Input channels only.
 * State shape: { enabled, fixed_filters, dynamic_filters, sensitivity_db }
 */

import { inputDsp, apiErrorMessage } from '/modules/api.js';
import { getDspDefaultsSync } from '/modules/dsp-defaults.js';

export class AfsSection {
  constructor(el, ch, _type) {
    this.el    = el;
    this.ch    = ch;
    this.state = null;
    this._onChange = this._handleChange.bind(this);
    this._render();
  }

  _render() {
    this.el.innerHTML = `
      <div class="afs-section">
        <div class="afs-row">
          <label class="afs-label">Enabled</label>
          <input type="checkbox" class="afs-enabled-cb">
        </div>
        <div class="afs-row">
          <label class="afs-label">Fixed filters</label>
          <input type="number" class="afs-fixed-inp" min="0" max="12" step="1" value="4">
        </div>
        <div class="afs-row">
          <label class="afs-label">Dynamic filters</label>
          <input type="number" class="afs-dynamic-inp" min="0" max="12" step="1" value="8">
        </div>
        <div class="afs-row">
          <label class="afs-label">Sensitivity (dB)</label>
          <input type="number" class="afs-sens-inp" min="-20" max="0" step="1" value="-6">
        </div>
        <div class="afs-actions">
          <button class="afs-clear-btn btn-secondary">Clear Filters</button>
        </div>
      </div>
    `;
    this._cb         = this.el.querySelector('.afs-enabled-cb');
    this._fixedInp   = this.el.querySelector('.afs-fixed-inp');
    this._dynamicInp = this.el.querySelector('.afs-dynamic-inp');
    this._sensInp    = this.el.querySelector('.afs-sens-inp');

    for (const inp of [this._cb, this._fixedInp, this._dynamicInp, this._sensInp]) {
      inp.addEventListener('change', this._onChange);
    }

    this.el.querySelector('.afs-clear-btn').addEventListener('click', () => {
      this._handleChange(true);
    });
  }

  _handleChange(clear = false) {
    const cfg = {
      enabled:         this._cb.checked,
      fixed_filters:   parseInt(this._fixedInp.value, 10) || 0,
      dynamic_filters: parseInt(this._dynamicInp.value, 10) || 0,
      sensitivity_db:  parseFloat(this._sensInp.value) || -6,
      ...(clear ? { clear_filters: true } : {}),
    };
    inputDsp.setAfs(this.ch, cfg).catch(err => {
      if (this.state) this.setState(this.state);
      this._toast(apiErrorMessage(err));
    });
    if (this.state) Object.assign(this.state, cfg);
  }

  setState(data) {
    const defs = getDspDefaultsSync();
    this.state = { ...(defs?.afs ?? {}), ...data };
    if (!this.state) return;
    if (this._cb)         this._cb.checked          = !!this.state.enabled;
    if (this._fixedInp)   this._fixedInp.value       = this.state.fixed_filters ?? 4;
    if (this._dynamicInp) this._dynamicInp.value     = this.state.dynamic_filters ?? 8;
    if (this._sensInp)    this._sensInp.value        = this.state.sensitivity_db ?? -6;
  }

  destroy() {
    for (const inp of [this._cb, this._fixedInp, this._dynamicInp, this._sensInp]) {
      if (inp) inp.removeEventListener('change', this._onChange);
    }
    this.el.innerHTML = '';
  }

  _toast(msg) {
    window.dispatchEvent(new CustomEvent('pb:toast', { detail: { msg, type: 'error' } }));
  }
}

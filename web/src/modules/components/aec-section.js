/**
 * AecSection — Acoustic Echo Cancellation configuration.
 *
 * Input channels only.
 * State shape: { enabled, tail_ms, comfort_noise, nlp_level }
 */

import { inputDsp, apiErrorMessage } from '/modules/api.js';

const NLP_LEVELS = ['off', 'mild', 'moderate', 'aggressive'];

export class AecSection {
  constructor(el, ch, _type) {
    this.el    = el;
    this.ch    = ch;
    this.state = null;
    this._onChange = this._handleChange.bind(this);
    this._render();
  }

  _render() {
    this.el.innerHTML = `
      <div class="aec-section">
        <div class="aec-row">
          <label class="aec-label">Enabled</label>
          <input type="checkbox" class="aec-enabled-cb">
        </div>
        <div class="aec-row">
          <label class="aec-label">Tail length (ms)</label>
          <input type="number" class="aec-tail-inp" min="32" max="512" step="32" value="128">
        </div>
        <div class="aec-row">
          <label class="aec-label">NLP level</label>
          <select class="aec-nlp-sel">
            ${NLP_LEVELS.map(l => `<option value="${l}">${l}</option>`).join('')}
          </select>
        </div>
        <div class="aec-row">
          <label class="aec-label">Comfort noise</label>
          <input type="checkbox" class="aec-cn-cb">
        </div>
      </div>
    `;
    this._cb     = this.el.querySelector('.aec-enabled-cb');
    this._tailInp = this.el.querySelector('.aec-tail-inp');
    this._nlpSel  = this.el.querySelector('.aec-nlp-sel');
    this._cnCb    = this.el.querySelector('.aec-cn-cb');

    for (const inp of [this._cb, this._tailInp, this._nlpSel, this._cnCb]) {
      inp.addEventListener('change', this._onChange);
    }
  }

  _handleChange() {
    const cfg = {
      enabled:       this._cb.checked,
      tail_ms:       parseInt(this._tailInp.value, 10) || 128,
      nlp_level:     this._nlpSel.value,
      comfort_noise: this._cnCb.checked,
    };
    inputDsp.setAec(this.ch, cfg).catch(err => {
      if (this.state) this.setState(this.state);
      this._toast(apiErrorMessage(err));
    });
    if (this.state) Object.assign(this.state, cfg);
  }

  setState(data) {
    this.state = data;
    if (!data) return;
    if (this._cb)      this._cb.checked    = !!data.enabled;
    if (this._tailInp) this._tailInp.value = data.tail_ms ?? 128;
    if (this._nlpSel)  this._nlpSel.value  = data.nlp_level ?? 'off';
    if (this._cnCb)    this._cnCb.checked  = !!data.comfort_noise;
  }

  destroy() {
    for (const inp of [this._cb, this._tailInp, this._nlpSel, this._cnCb]) {
      if (inp) inp.removeEventListener('change', this._onChange);
    }
    this.el.innerHTML = '';
  }

  _toast(msg) {
    window.dispatchEvent(new CustomEvent('pb:toast', { detail: { msg, type: 'error' } }));
  }
}

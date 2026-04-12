/**
 * ChannelStrip — composite DSP channel strip component.
 *
 * Usage:
 *   import { ChannelStrip } from '/modules/components/channel-strip.js';
 *   const strip = new ChannelStrip(containerEl, 0, 'input', 'IN 1');
 *   await strip.load();
 *   strip.setName('Mic 1');
 *   strip.destroy();
 */

import { inputDsp, outputDsp, apiErrorMessage } from '/modules/api.js';
import { FilterSection }    from '/modules/components/filter-section.js';
import { EqSection }        from '/modules/components/eq-section.js';
import { GateSection }      from '/modules/components/gate-section.js';
import { CompressorSection } from '/modules/components/compressor-section.js';
import { LimiterSection }   from '/modules/components/limiter-section.js';
import { DelaySection }     from '/modules/components/delay-section.js';
import { VuMeter }          from '/modules/components/vu-meter.js';

export class ChannelStrip {
  constructor(containerEl, channelIndex, type, channelName) {
    this.containerEl  = containerEl;
    this.ch           = channelIndex;
    this.type         = type;          // 'input' | 'output'
    this.channelName  = channelName || `CH ${channelIndex + 1}`;
    this._dsp         = type === 'input' ? inputDsp : outputDsp;

    // Sub-component refs
    this._vuMeter     = null;
    this._filter      = null;
    this._eq          = null;
    this._gate        = null;
    this._compressor  = null;
    this._limiter     = null;
    this._delay       = null;

    // Bound event handlers for clean removal
    this._onNameDblClick  = this._handleNameDblClick.bind(this);
    this._onNameBlur      = this._handleNameBlur.bind(this);
    this._onNameKeydown   = this._handleNameKeydown.bind(this);
    this._onPolarityClick = this._handlePolarityClick.bind(this);
    this._onGainInput     = this._handleGainInput.bind(this);
    this._onGainChange    = this._handleGainChange.bind(this);

    this._polarity   = false;
    this._gain_db    = 0;

    this._render();
    this._attachListeners();
    this._mountSubComponents();
    this._renderDspButtons();
    this._setupModal();
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  _render() {
    const polarityHTML = this.type === 'input'
      ? `<button class="strip-polarity-btn" title="Invert polarity">⊖</button>`
      : '';

    this.containerEl.innerHTML = `
      <div class="channel-strip">
        <div class="strip-header">
          <span class="strip-ch-name" tabindex="0" title="Double-click to rename">${this._escHtml(this.channelName)}</span>
        </div>
        <div class="strip-vu-wrap">
          <canvas class="strip-vu-canvas"></canvas>
        </div>
        <div class="strip-controls">
          ${polarityHTML}
          <div class="strip-gain-wrap">
            <input type="range" class="strip-gain-slider"
              min="-60" max="12" step="0.5" value="0"
              title="Gain">
            <span class="strip-gain-value">0.0 dB</span>
          </div>
        </div>
        <div class="strip-sections-staging" style="display:none"></div>
        <div class="dsp-blocks-row"></div>
        <dialog class="dsp-modal">
          <div class="dsp-modal-header">
            <button class="dsp-modal-enable-btn" title="Toggle enable">○</button>
            <span class="dsp-modal-title"></span>
            <button class="dsp-modal-close">×</button>
          </div>
          <div class="dsp-modal-body"></div>
        </dialog>
      </div>
    `;

    this._strip       = this.containerEl.querySelector('.channel-strip');
    this._nameEl      = this._strip.querySelector('.strip-ch-name');
    this._canvasEl    = this._strip.querySelector('.strip-vu-canvas');
    this._polarityBtn = this._strip.querySelector('.strip-polarity-btn');
    this._gainSlider  = this._strip.querySelector('.strip-gain-slider');
    this._gainValue   = this._strip.querySelector('.strip-gain-value');
  }

  _mountSubComponents() {
    const staging = this._strip.querySelector('.strip-sections-staging');

    const makeWrap = () => {
      const d = document.createElement('div');
      staging.appendChild(d);
      return d;
    };

    this._filterWrap  = makeWrap();
    this._eqWrap      = makeWrap();
    this._compWrap    = makeWrap();
    this._gateWrap    = null;
    this._limiterWrap = null;
    this._delayWrap   = null;

    this._filter     = new FilterSection(this._filterWrap, this.ch, this.type);
    this._eq         = new EqSection(this._eqWrap, this.ch, this.type);
    this._compressor = new CompressorSection(this._compWrap, this.ch, this.type);

    if (this.type === 'input') {
      this._gateWrap = makeWrap();
      this._gate = new GateSection(this._gateWrap, this.ch);
    } else {
      this._limiterWrap = makeWrap();
      this._delayWrap   = makeWrap();
      this._limiter = new LimiterSection(this._limiterWrap, this.ch);
      this._delay   = new DelaySection(this._delayWrap, this.ch);
    }

    this._vuMeter = new VuMeter(this._canvasEl, this.ch, this.type);
  }

  // ── DSP block buttons & modal ────────────────────────────────────────────────

  _renderDspButtons() {
    const row = this._strip.querySelector('.dsp-blocks-row');
    row.innerHTML = '';

    const blocks = this.type === 'input'
      ? [
          { key: 'filter',     label: 'FILT', section: () => this._filterWrap,  getEnabled: () => !!(this._filter?.state?.hpf?.enabled || this._filter?.state?.lpf?.enabled) },
          { key: 'eq',         label: 'EQ',   section: () => this._eqWrap,      getEnabled: () => !!(this._eq?.state?.enabled) },
          { key: 'gate',       label: 'GATE', section: () => this._gateWrap,    getEnabled: () => !!(this._gate?.state?.enabled) },
          { key: 'compressor', label: 'COMP', section: () => this._compWrap,    getEnabled: () => !!(this._compressor?.state?.enabled) },
        ]
      : [
          { key: 'filter',     label: 'FILT', section: () => this._filterWrap,  getEnabled: () => !!(this._filter?.state?.hpf?.enabled || this._filter?.state?.lpf?.enabled) },
          { key: 'eq',         label: 'EQ',   section: () => this._eqWrap,      getEnabled: () => !!(this._eq?.state?.enabled) },
          { key: 'compressor', label: 'COMP', section: () => this._compWrap,    getEnabled: () => !!(this._compressor?.state?.enabled) },
          { key: 'limiter',    label: 'LIM',  section: () => this._limiterWrap, getEnabled: () => !!(this._limiter?.state?.enabled) },
          { key: 'delay',      label: 'DLY',  section: () => this._delayWrap,   getEnabled: () => !!(this._delay?.state?.enabled) },
        ];

    this._dspBlocks = blocks;
    this._blockBtns = {};

    for (const block of blocks) {
      const btn = document.createElement('button');
      btn.className = 'dsp-block-btn';
      btn.dataset.key = block.key;
      btn.innerHTML = `<span class="dsp-block-label">${block.label}</span><span class="dsp-block-dot">●</span>`;
      btn.addEventListener('click', () => this._openDspModal(block));
      row.appendChild(btn);
      this._blockBtns[block.key] = btn;
    }
  }

  _openDspModal(block) {
    const dialog    = this._strip.querySelector('.dsp-modal');
    const titleEl   = dialog.querySelector('.dsp-modal-title');
    const bodyEl    = dialog.querySelector('.dsp-modal-body');
    const enableBtn = dialog.querySelector('.dsp-modal-enable-btn');

    // Move section's wrap DOM into modal body
    const sectionWrap = block.section();
    bodyEl.innerHTML = '';
    if (sectionWrap) bodyEl.appendChild(sectionWrap);

    titleEl.textContent = `${block.label} — ${this.channelName}`;

    // Sync enable button state
    const updateEnableBtn = () => {
      const active = block.getEnabled();
      enableBtn.textContent = active ? '◉' : '○';
      enableBtn.classList.toggle('active', !!active);
    };
    updateEnableBtn();

    // Remove any stale enable-btn listener, then re-attach
    if (dialog._enableBtnHandler) {
      enableBtn.removeEventListener('click', dialog._enableBtnHandler);
    }
    dialog._enableBtnHandler = updateEnableBtn;

    // Store for close handler
    dialog._currentBlock    = block;
    dialog._currentWrap     = sectionWrap;
    dialog._updateEnableBtn = updateEnableBtn;

    dialog.showModal();
  }

  _setupModal() {
    const dialog   = this._strip.querySelector('.dsp-modal');
    const closeBtn = dialog.querySelector('.dsp-modal-close');

    closeBtn.addEventListener('click', () => dialog.close());

    // Backdrop click (click on the <dialog> element itself, not its content)
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });

    // On close: restore section wrap back to staging
    dialog.addEventListener('close', () => {
      const staging = this._strip.querySelector('.strip-sections-staging');
      const wrap    = dialog._currentWrap;
      if (wrap) staging.appendChild(wrap);
      dialog.querySelector('.dsp-modal-body').innerHTML = '';
      this._updateAllBlockBtns();
    });
  }

  _updateAllBlockBtns() {
    for (const block of (this._dspBlocks || [])) {
      const btn = this._blockBtns?.[block.key];
      if (!btn) continue;
      const active = block.getEnabled();
      btn.classList.toggle('active', !!active);
    }
  }

  // ── Event listeners ─────────────────────────────────────────────────────────

  _attachListeners() {
    // Name editing (post-render, called again after _render sets up els)
    // Handlers are attached after _render() sets this._nameEl etc.
    // _attachListeners is called before _mountSubComponents but _render() must
    // have already run; guard with null checks in handlers.
    this.containerEl.addEventListener('dblclick', this._onNameDblClick);
  }

  _handleNameDblClick(e) {
    if (!e.target.classList.contains('strip-ch-name')) return;
    const el = e.target;
    el.contentEditable = 'true';
    el.focus();
    // Select all text
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    el.addEventListener('blur',    this._onNameBlur);
    el.addEventListener('keydown', this._onNameKeydown);
  }

  _commitNameEdit(el) {
    el.contentEditable = 'false';
    el.removeEventListener('blur',    this._onNameBlur);
    el.removeEventListener('keydown', this._onNameKeydown);
    const name = el.textContent.trim() || this.channelName;
    el.textContent = name;
    this.channelName = name;
    this._saveName(name);
  }

  _handleNameBlur(e) {
    this._commitNameEdit(e.target);
  }

  _handleNameKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      this._commitNameEdit(e.target);
    } else if (e.key === 'Escape') {
      e.target.textContent = this.channelName;
      e.target.contentEditable = 'false';
      e.target.removeEventListener('blur',    this._onNameBlur);
      e.target.removeEventListener('keydown', this._onNameKeydown);
    }
  }

  async _saveName(name) {
    const endpoint = this.type === 'input'
      ? `/api/v1/sources/${this.ch}/name`
      : `/api/v1/zones/${this.ch}/name`;
    try {
      await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
    } catch (err) {
      this._toast(apiErrorMessage(err), 'error');
    }
  }

  _handlePolarityClick() {
    this._polarity = !this._polarity;
    this._updatePolarityUI();
    inputDsp.setPolarity(this.ch, this._polarity).catch(err => {
      this._polarity = !this._polarity;
      this._updatePolarityUI();
      this._toast(apiErrorMessage(err), 'error');
    });
  }

  _updatePolarityUI() {
    if (!this._polarityBtn) return;
    if (this._polarity) {
      this._polarityBtn.classList.add('active');
      this._polarityBtn.title = 'Polarity inverted';
      this._polarityBtn.textContent = 'INV';
    } else {
      this._polarityBtn.classList.remove('active');
      this._polarityBtn.title = 'Invert polarity';
      this._polarityBtn.textContent = '⊖';
    }
  }

  _handleGainInput() {
    const db = parseFloat(this._gainSlider.value);
    this._gainValue.textContent = `${db.toFixed(1)} dB`;
  }

  _handleGainChange() {
    const db = parseFloat(this._gainSlider.value);
    this._gain_db = db;
    this._gainValue.textContent = `${db.toFixed(1)} dB`;
    this._dsp.setGain(this.ch, db).catch(err => {
      this._gainSlider.value = String(this._gain_db);
      this._gainValue.textContent = `${this._gain_db.toFixed(1)} dB`;
      this._toast(apiErrorMessage(err), 'error');
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  setName(name) {
    this.channelName = name;
    if (this._nameEl) this._nameEl.textContent = name;
  }

  async load() {
    let data;
    try {
      data = await this._dsp.get(this.ch);
    } catch (err) {
      console.warn(`ChannelStrip[${this.type}:${this.ch}] load failed:`, err);
      this._toast(apiErrorMessage(err), 'warn');
      data = null;
    }

    if (!data) return;

    // Gain
    if (data.gain_db !== undefined) {
      this._gain_db = data.gain_db;
      this._gainSlider.value = String(data.gain_db);
      this._gainValue.textContent = `${data.gain_db.toFixed(1)} dB`;
    }

    // Polarity (input only)
    if (this.type === 'input' && data.polarity !== undefined) {
      this._polarity = data.polarity === true;
      this._updatePolarityUI();
    }

    // Sub-sections
    if (data.hpf !== undefined || data.lpf !== undefined) {
      this._filter.setState({ hpf: data.hpf, lpf: data.lpf });
    }

    if (data.eq) {
      this._eq.setState(data.eq);
    }

    if (this.type === 'input') {
      if (data.gate && this._gate) {
        this._gate.setState(data.gate);
      }
    } else {
      if (data.limiter && this._limiter) {
        this._limiter.setState(data.limiter);
      }
      if (data.delay && this._delay) {
        this._delay.setState(data.delay);
      }
    }

    if (data.compressor && this._compressor) {
      this._compressor.setState(data.compressor);
    }

    // Attach gain listeners after data is loaded (idempotent — remove first)
    this._gainSlider.removeEventListener('input',  this._onGainInput);
    this._gainSlider.removeEventListener('change', this._onGainChange);
    this._gainSlider.addEventListener('input',  this._onGainInput);
    this._gainSlider.addEventListener('change', this._onGainChange);

    if (this._polarityBtn) {
      this._polarityBtn.removeEventListener('click', this._onPolarityClick);
      this._polarityBtn.addEventListener('click', this._onPolarityClick);
    }

    this._updateAllBlockBtns();
  }

  destroy() {
    const dialog = this._strip?.querySelector('.dsp-modal');
    if (dialog?.open) dialog.close();

    this.containerEl.removeEventListener('dblclick', this._onNameDblClick);

    if (this._gainSlider) {
      this._gainSlider.removeEventListener('input',  this._onGainInput);
      this._gainSlider.removeEventListener('change', this._onGainChange);
    }
    if (this._polarityBtn) {
      this._polarityBtn.removeEventListener('click', this._onPolarityClick);
    }
    if (this._nameEl) {
      this._nameEl.removeEventListener('blur',    this._onNameBlur);
      this._nameEl.removeEventListener('keydown', this._onNameKeydown);
    }

    this._vuMeter?.destroy();
    this._filter?.destroy();
    this._eq?.destroy();
    this._gate?.destroy();
    this._compressor?.destroy();
    this._limiter?.destroy();
    this._delay?.destroy();

    this.containerEl.innerHTML = '';
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  _toast(msg, type = 'error') {
    window.dispatchEvent(new CustomEvent('pb:toast', { detail: { msg, type } }));
  }

  _escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

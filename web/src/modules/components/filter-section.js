/**
 * FilterSection — HPF / LPF controls with SVG Butterworth response curve
 *
 * Usage:
 *   import { FilterSection } from '/modules/components/filter-section.js';
 *   const fs = new FilterSection(containerEl, channelIndex, 'input');
 *   fs.setState({ hpf: { enabled: false, freq_hz: 80, slope_db_oct: 12 },
 *                 lpf: { enabled: false, freq_hz: 18000, slope_db_oct: 12 } });
 *   fs.destroy();
 *
 * TODO (sprint — see docs/DSP_PANELS.md §5):
 *   1. Import FilterCanvas from dsp-canvas.js
 *   2. Add dsp-filter-svg, call FilterCanvas.buildGrid() + updateHpf/Lpf
 *   3. Wire horizontal drag via startHpfDrag / startLpfDrag
 *   4. Add slope_db_oct <select> per filter (6/12/18/24 dB/oct)
 *   5. Fix stepper pattern — use delegated click listener
 */

import { inputDsp, outputDsp } from '/modules/api.js';
// TODO: import { FilterCanvas } from '/modules/components/dsp-canvas.js';

export class FilterSection {
  constructor(containerEl, channelIndex, type) {
    this.containerEl = containerEl;
    this.channelIndex = channelIndex;
    this.type = type; // 'input' or 'output'
    this.api = type === 'input' ? inputDsp : outputDsp;
    
    this.state = {
      hpf: { enabled: false, freq_hz: 80 },
      lpf: { enabled: false, freq_hz: 18000 }
    };
    
    this.render();
    this.setupEventListeners();
  }

  render() {
    this.containerEl.innerHTML = `
      <div class="section-panel collapsed" data-section="filters">
        <div class="section-header" role="button" tabindex="0">
          <span class="section-title">FILTERS</span>
          <span class="section-summary">HPF: OFF | LPF: OFF</span>
          <span class="section-arrow">▼</span>
        </div>
        <div class="section-body">
          <div class="filter-row">
            <label class="filter-label">HPF</label>
            <input type="checkbox" class="toggle-cb" data-filter="hpf">
            <input type="number" class="freq-input" data-filter="hpf" min="20" max="20000" step="1" value="80">
            <span class="freq-unit">Hz</span>
          </div>
          <div class="filter-row">
            <label class="filter-label">LPF</label>
            <input type="checkbox" class="toggle-cb" data-filter="lpf">
            <input type="number" class="freq-input" data-filter="lpf" min="20" max="20000" step="1" value="18000">
            <span class="freq-unit">Hz</span>
          </div>
        </div>
      </div>
    `;
    
    this.sectionPanel = this.containerEl.querySelector('.section-panel');
    this.sectionHeader = this.sectionPanel.querySelector('.section-header');
    this.sectionSummary = this.sectionPanel.querySelector('.section-summary');
  }

  setupEventListeners() {
    // Store bound handlers so destroy() can remove them
    this._clickHandler  = () => this.sectionPanel.classList.toggle('collapsed');
    this._hpfCbHandler  = () => this.onFilterChange('hpf');
    this._lpfCbHandler  = () => this.onFilterChange('lpf');
    this._hpfFrqHandler = () => this.onFilterChange('hpf');
    this._lpfFrqHandler = () => this.onFilterChange('lpf');

    // Collapse/expand toggle
    this.sectionHeader.addEventListener('click', this._clickHandler);

    // Checkbox change handlers
    const hpfCheckbox = this.sectionPanel.querySelector('[data-filter="hpf"].toggle-cb');
    const lpfCheckbox = this.sectionPanel.querySelector('[data-filter="lpf"].toggle-cb');
    
    hpfCheckbox.addEventListener('change', this._hpfCbHandler);
    lpfCheckbox.addEventListener('change', this._lpfCbHandler);

    // Frequency input change handlers (change, not input, to avoid API spam)
    const hpfFreqInput = this.sectionPanel.querySelector('[data-filter="hpf"].freq-input');
    const lpfFreqInput = this.sectionPanel.querySelector('[data-filter="lpf"].freq-input');
    
    hpfFreqInput.addEventListener('change', this._hpfFrqHandler);
    lpfFreqInput.addEventListener('change', this._lpfFrqHandler);

    // Store refs for destroy
    this._hpfCb  = hpfCheckbox;
    this._lpfCb  = lpfCheckbox;
    this._hpfFrq = hpfFreqInput;
    this._lpfFrq = lpfFreqInput;
  }

  async onFilterChange(filterType) {
    const checkbox = this.sectionPanel.querySelector(`[data-filter="${filterType}"].toggle-cb`);
    const freqInput = this.sectionPanel.querySelector(`[data-filter="${filterType}"].freq-input`);
    
    const enabled = checkbox.checked;
    const freq_hz = parseFloat(freqInput.value) || 20;

    const config = { enabled, freq_hz };

    try {
      if (filterType === 'hpf') {
        await this.api.setHpf(this.channelIndex, config);
        this.state.hpf = config;
      } else {
        await this.api.setLpf(this.channelIndex, config);
        this.state.lpf = config;
      }
      this.updateSummary();
    } catch (err) {
      this.showToast(`Failed to set ${filterType.toUpperCase()}: ${err.message}`, 'error');
      // Revert UI to previous state
      checkbox.checked = this.state[filterType].enabled;
      freqInput.value = this.state[filterType].freq_hz;
    }
  }

  updateSummary() {
    const hpfText = this.state.hpf.enabled ? `HPF: ${this.state.hpf.freq_hz}Hz` : 'HPF: OFF';
    const lpfText = this.state.lpf.enabled ? `LPF: ${this.state.lpf.freq_hz}Hz` : 'LPF: OFF';
    this.sectionSummary.textContent = `${hpfText} | ${lpfText}`;
  }

  showToast(msg, type = 'error') {
    window.dispatchEvent(new CustomEvent('pb:toast', { detail: { msg, type } }));
  }

  setState(data) {
    if (data.hpf) {
      this.state.hpf = { ...this.state.hpf, ...data.hpf };
      const hpfCheckbox = this.sectionPanel.querySelector('[data-filter="hpf"].toggle-cb');
      const hpfFreqInput = this.sectionPanel.querySelector('[data-filter="hpf"].freq-input');
      hpfCheckbox.checked = this.state.hpf.enabled;
      hpfFreqInput.value = this.state.hpf.freq_hz;
    }
    
    if (data.lpf) {
      this.state.lpf = { ...this.state.lpf, ...data.lpf };
      const lpfCheckbox = this.sectionPanel.querySelector('[data-filter="lpf"].toggle-cb');
      const lpfFreqInput = this.sectionPanel.querySelector('[data-filter="lpf"].freq-input');
      lpfCheckbox.checked = this.state.lpf.enabled;
      lpfFreqInput.value = this.state.lpf.freq_hz;
    }
    
    this.updateSummary();
  }

  destroy() {
    if (this.sectionHeader) {
      this.sectionHeader.removeEventListener('click', this._clickHandler);
    }
    if (this._hpfCb)  this._hpfCb.removeEventListener('change',  this._hpfCbHandler);
    if (this._lpfCb)  this._lpfCb.removeEventListener('change',  this._lpfCbHandler);
    if (this._hpfFrq) this._hpfFrq.removeEventListener('change', this._hpfFrqHandler);
    if (this._lpfFrq) this._lpfFrq.removeEventListener('change', this._lpfFrqHandler);
    this.containerEl.innerHTML = '';
  }
}

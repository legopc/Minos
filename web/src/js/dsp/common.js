// dsp/common.js — shared widget builders for all DSP panels

/**
 * Slider row: label + range input + live value display.
 * @param {string} label
 * @param {number} min
 * @param {number} max
 * @param {number} step
 * @param {number} value  initial value
 * @param {(v:number)=>string} fmt  format function for display
 * @param {(v:number)=>void} cb  called on every input event
 * @returns {HTMLElement} .dsp-row
 */
export function sliderRow(label, min, max, step, value, fmt, cb) {
  const row = _row();
  row.appendChild(_label(label));
  const sld = document.createElement('input');
  sld.type = 'range';
  sld.className = 'dsp-slider';
  sld.min = String(min);
  sld.max = String(max);
  sld.step = String(step);
  sld.value = String(value);
  const val = _val(fmt(value));
  sld.oninput = () => {
    const v = parseFloat(sld.value);
    val.textContent = fmt(v);
    cb(v);
  };
  row.appendChild(sld);
  row.appendChild(val);
  return row;
}

/**
 * Toggle row: label + ON/OFF pill button.
 * @param {string} label
 * @param {boolean} on  initial state
 * @param {(v:boolean)=>void} cb
 * @returns {HTMLElement} .dsp-row
 */
export function toggleRow(label, on, cb) {
  const row = _row();
  row.appendChild(_label(label));
  row.appendChild(toggleBtn(on, cb));
  return row;
}

/**
 * Standalone ON/OFF toggle button (no row wrapper).
 */
export function toggleBtn(on, cb) {
  const btn = document.createElement('button');
  btn.className = 'dsp-toggle-btn' + (on ? ' active' : '');
  btn.textContent = on ? 'ON' : 'OFF';
  btn.onclick = () => {
    const v = !btn.classList.contains('active');
    btn.classList.toggle('active', v);
    btn.textContent = v ? 'ON' : 'OFF';
    cb(v);
  };
  return btn;
}

/**
 * Select row: label + <select> dropdown.
 * @param {string} label
 * @param {Array<{value:string,label:string}|string>} opts
 * @param {string|number|null} value  initial selected value (compared by String())
 * @param {(v:string)=>void} cb
 * @returns {{ el: HTMLElement, sel: HTMLSelectElement }}
 */
export function selectRow(label, opts, value, cb) {
  const row = _row();
  row.appendChild(_label(label));
  const sel = document.createElement('select');
  sel.className = 'dsp-select';
  opts.forEach(opt => {
    const o = document.createElement('option');
    if (typeof opt === 'object' && opt !== null) {
      o.value = String(opt.value);
      o.textContent = opt.label;
    } else {
      o.value = String(opt);
      o.textContent = String(opt);
    }
    if (String(value) === o.value) o.selected = true;
    sel.appendChild(o);
  });
  sel.onchange = () => cb(sel.value);
  row.appendChild(sel);
  return { el: row, sel };
}

/**
 * Section divider with uppercase label.
 */
export function sectionHeader(label) {
  const d = document.createElement('div');
  d.className = 'dsp-section-header';
  d.textContent = label;
  return d;
}

/**
 * GR meter (gain-reduction bar). Static display — set bar width % to animate.
 * @param {string} uid  unique suffix for element IDs
 * @returns {HTMLElement} .dsp-gr-meter
 */
export function grMeter(uid) {
  const d = document.createElement('div');
  d.className = 'dsp-gr-meter';
  const track = document.createElement('div');
  track.className = 'dsp-gr-track';
  const bar = document.createElement('div');
  bar.className = 'dsp-gr-bar';
  bar.id = `gr-bar-${uid}`;
  track.appendChild(bar);
  const lbl = document.createElement('span');
  lbl.className = 'dsp-gr-label';
  lbl.textContent = '0.0 dB';
  lbl.id = `gr-lbl-${uid}`;
  d.appendChild(track);
  d.appendChild(lbl);
  return d;
}

/**
 * Full-width action button.
 */
export function actionBtn(label, cb) {
  const btn = document.createElement('button');
  btn.className = 'dsp-action-btn';
  btn.textContent = label;
  btn.onclick = cb;
  return btn;
}

/**
 * BYP (bypass) pill button — uses standardised .dsp-byp-btn class.
 * @param {boolean} on  initial bypassed state
 * @param {(v:boolean)=>void} cb
 */
export function bypBtn(on, cb) {
  const btn = document.createElement('button');
  btn.className = 'dsp-byp-btn' + (on ? ' active' : '');
  btn.textContent = 'BYP';
  btn.onclick = () => {
    const v = !btn.classList.contains('active');
    btn.classList.toggle('active', v);
    cb(v);
  };
  return btn;
}

/**
 * BYP button in a row (label can be empty string).
 */
export function bypRow(on, cb) {
  const row = _row();
  row.appendChild(_label(''));
  row.appendChild(bypBtn(on, cb));
  return row;
}

// ─── internal helpers ────────────────────────────────────────────────────────

function _row() {
  const d = document.createElement('div');
  d.className = 'dsp-row';
  return d;
}

function _label(text) {
  const s = document.createElement('span');
  s.className = 'dsp-label';
  s.textContent = text;
  return s;
}

function _val(text) {
  const s = document.createElement('span');
  s.className = 'dsp-value';
  s.textContent = text;
  return s;
}

// ─── format helpers (export so panels can use them) ─────────────────────────

export const fmtDb = v => (v >= 0 ? '+' : '') + Number(v).toFixed(1) + ' dB';
export const fmtMs = v => Number(v).toFixed(1) + ' ms';
export const fmtHz = v => v >= 1000 ? (v / 1000).toFixed(2) + ' kHz' : Math.round(v) + ' Hz';
export const fmtRatio = v => Number(v).toFixed(1) + ':1';
export const fmtPlain = v => String(Number(v).toFixed(2));

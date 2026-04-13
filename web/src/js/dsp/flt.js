/**
 * High-Pass / Low-Pass Filter Panel
 * blockKey: 'flt'
 */

function row(label, control, valueEl) {
  const d = document.createElement('div');
  d.className = 'dsp-row';
  const lbl = document.createElement('span');
  lbl.className = 'dsp-label';
  lbl.textContent = label;
  d.appendChild(lbl);
  d.appendChild(control);
  if (valueEl) d.appendChild(valueEl);
  return d;
}

function slider(min, max, step, value, oninput) {
  const s = document.createElement('input');
  s.type = 'range';
  s.min = min;
  s.max = max;
  s.step = step;
  s.value = value;
  s.className = 'dsp-slider';
  s.oninput = oninput;
  return s;
}

function valEl(text) {
  const s = document.createElement('span');
  s.className = 'dsp-value';
  s.textContent = text;
  return s;
}

function fmtHz(v) {
  return v >= 1000 ? (v / 1000).toFixed(2) + 'kHz' : v + 'Hz';
}

export function buildContent(channelId, params, accentColor, { onChange, onBypass }) {
  const el = document.createElement('div');
  el.className = 'dsp-panel flt';

  // HPF Enabled toggle
  const hpfCheckbox = document.createElement('input');
  hpfCheckbox.type = 'checkbox';
  hpfCheckbox.className = 'dsp-toggle';
  hpfCheckbox.checked = params.hpf_enabled || false;
  hpfCheckbox.onchange = () => {
    const updated = { ...params, hpf_enabled: hpfCheckbox.checked };
    onChange('flt', updated);
  };
  el.appendChild(row('HPF Enabled', hpfCheckbox));

  // HPF Frequency
  const hpfFreqVal = valEl(fmtHz(params.hpf_freq || 80));
  const hpfFreqSlider = slider(20, 2000, 1, params.hpf_freq || 80, (e) => {
    const v = parseFloat(e.target.value);
    hpfFreqVal.textContent = fmtHz(v);
    onChange('flt', { ...params, hpf_freq: v });
  });
  el.appendChild(row('HPF Freq', hpfFreqSlider, hpfFreqVal));

  // LPF Enabled toggle
  const lpfCheckbox = document.createElement('input');
  lpfCheckbox.type = 'checkbox';
  lpfCheckbox.className = 'dsp-toggle';
  lpfCheckbox.checked = params.lpf_enabled || false;
  lpfCheckbox.onchange = () => {
    const updated = { ...params, lpf_enabled: lpfCheckbox.checked };
    onChange('flt', updated);
  };
  el.appendChild(row('LPF Enabled', lpfCheckbox));

  // LPF Frequency
  const lpfFreqVal = valEl(fmtHz(params.lpf_freq || 20000));
  const lpfFreqSlider = slider(200, 20000, 10, params.lpf_freq || 20000, (e) => {
    const v = parseFloat(e.target.value);
    lpfFreqVal.textContent = fmtHz(v);
    onChange('flt', { ...params, lpf_freq: v });
  });
  el.appendChild(row('LPF Freq', lpfFreqSlider, lpfFreqVal));

  return el;
}

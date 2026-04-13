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
  hpfCheckbox.checked = params.hpf?.enabled ?? false;
  const hpfFreqSlider = { value: params.hpf?.freq_hz ?? 80 };

  const hpfFreqVal = valEl(fmtHz(params.hpf?.freq_hz ?? 80));
  const hpfFreqInput = slider(20, 2000, 1, params.hpf?.freq_hz ?? 80, (e) => {
    const v = parseFloat(e.target.value);
    hpfFreqSlider.value = v;
    hpfFreqVal.textContent = fmtHz(v);
    onChange('flt', { hpf: { enabled: hpfCheckbox.checked, freq_hz: v } });
  });

  hpfCheckbox.onchange = () => {
    onChange('flt', { hpf: { enabled: hpfCheckbox.checked, freq_hz: parseFloat(hpfFreqInput.value) } });
  };
  el.appendChild(row('HPF Enabled', hpfCheckbox));
  el.appendChild(row('HPF Freq', hpfFreqInput, hpfFreqVal));

  // LPF Enabled toggle
  const lpfCheckbox = document.createElement('input');
  lpfCheckbox.type = 'checkbox';
  lpfCheckbox.className = 'dsp-toggle';
  lpfCheckbox.checked = params.lpf?.enabled ?? false;
  const lpfFreqSlider = { value: params.lpf?.freq_hz ?? 18000 };

  const lpfFreqVal = valEl(fmtHz(params.lpf?.freq_hz ?? 18000));
  const lpfFreqInput = slider(200, 20000, 10, params.lpf?.freq_hz ?? 18000, (e) => {
    const v = parseFloat(e.target.value);
    lpfFreqSlider.value = v;
    lpfFreqVal.textContent = fmtHz(v);
    onChange('flt', { lpf: { enabled: lpfCheckbox.checked, freq_hz: v } });
  });

  lpfCheckbox.onchange = () => {
    onChange('flt', { lpf: { enabled: lpfCheckbox.checked, freq_hz: parseFloat(lpfFreqInput.value) } });
  };
  el.appendChild(row('LPF Enabled', lpfCheckbox));
  el.appendChild(row('LPF Freq', lpfFreqInput, lpfFreqVal));

  return el;
}

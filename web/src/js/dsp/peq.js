/**
 * Parametric EQ Panel
 * blockKey: 'peq'
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

function fmtDb(v) {
  return (v >= 0 ? '+' : '') + Number(v).toFixed(1) + ' dB';
}

export function buildContent(channelId, params, accentColor, { onChange, onBypass }) {
  const el = document.createElement('div');
  el.className = 'dsp-content peq';

  const bands = params.bands || [
    { freq: 100, gain: 0, q: 0.7 },
    { freq: 1000, gain: 0, q: 0.7 },
    { freq: 8000, gain: 0, q: 0.7 },
    { freq: 16000, gain: 0, q: 0.7 }
  ];

  // Enable toggle
  const enableCheckbox = document.createElement('input');
  enableCheckbox.type = 'checkbox';
  enableCheckbox.className = 'dsp-toggle';
  enableCheckbox.checked = params.enabled || false;
  enableCheckbox.onchange = () => {
    const updated = { ...params, enabled: enableCheckbox.checked };
    onChange('peq', updated);
  };
  el.appendChild(row('Enable', enableCheckbox));

  // Build band controls
  bands.forEach((band, idx) => {
    const bandContainer = document.createElement('div');
    bandContainer.className = 'dsp-band';

    // Band header
    const header = document.createElement('div');
    header.className = 'dsp-band-header';
    header.textContent = `Band ${idx + 1}`;
    bandContainer.appendChild(header);

    // Frequency
    const freqVal = valEl(fmtHz(band.freq));
    const freqSlider = slider(20, 20000, 10, band.freq, (e) => {
      const v = parseFloat(e.target.value);
      freqVal.textContent = fmtHz(v);
      const newBands = [...bands];
      newBands[idx] = { ...band, freq: v };
      onChange('peq', { ...params, bands: newBands });
    });
    bandContainer.appendChild(row('Freq', freqSlider, freqVal));

    // Gain
    const gainVal = valEl(fmtDb(band.gain));
    const gainSlider = slider(-18, 18, 0.5, band.gain, (e) => {
      const v = parseFloat(e.target.value);
      gainVal.textContent = fmtDb(v);
      const newBands = [...bands];
      newBands[idx] = { ...band, gain: v };
      onChange('peq', { ...params, bands: newBands });
    });
    bandContainer.appendChild(row('Gain', gainSlider, gainVal));

    // Q
    const qVal = valEl('Q:' + band.q.toFixed(1));
    const qSlider = slider(0.1, 10, 0.1, band.q, (e) => {
      const v = parseFloat(e.target.value);
      qVal.textContent = 'Q:' + v.toFixed(1);
      const newBands = [...bands];
      newBands[idx] = { ...band, q: v };
      onChange('peq', { ...params, bands: newBands });
    });
    bandContainer.appendChild(row('Q', qSlider, qVal));

    el.appendChild(bandContainer);
  });

  return el;
}

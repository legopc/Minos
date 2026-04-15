/**
 * Limiter Panel
 * blockKey: 'lim'
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

function fmtDb(v) {
  return (v >= 0 ? '+' : '') + Number(v).toFixed(1) + ' dB';
}

function fmtMs(v) {
  return Number(v).toFixed(1) + ' ms';
}

function bypButton(label, blockKey, currentBypassed, onBypass) {
  const btn = document.createElement('button');
  btn.className = 'dsp-bypass-btn';
  if (currentBypassed) btn.classList.add('active');
  btn.textContent = label;
  btn.onclick = () => {
    onBypass(blockKey, !currentBypassed);
    if (currentBypassed) {
      btn.classList.remove('active');
    } else {
      btn.classList.add('active');
    }
  };
  return btn;
}

export function buildContent(channelId, params, accentColor, { onChange, onBypass }) {
  const el = document.createElement('div');
  el.className = 'dsp-content lim';
  if (params.bypassed) el.style.opacity = '0.22';

  // GR meter
  const grMeter = document.createElement('div');
  grMeter.className = 'dsp-gr-meter';
  grMeter.innerHTML =
    `<div class="dsp-gr-track"><div class="dsp-gr-bar" id="gr-bar-${channelId}_lim"></div></div>` +
    `<span class="dsp-gr-label" id="gr-label-${channelId}_lim">0.0 dB</span>`;
  el.appendChild(grMeter);
  const threshVal = valEl(fmtDb(params.threshold_db || -3.0));
  const threshSlider = slider(-40, 0, 0.5, params.threshold_db || -3.0, (e) => {
    const v = parseFloat(e.target.value);
    threshVal.textContent = fmtDb(v);
    onChange('lim', { ...params, threshold_db: v });
  });
  el.appendChild(row('Threshold', threshSlider, threshVal));

  // Release
  const releaseVal = valEl(fmtMs(params.release_ms || 50.0));
  const releaseSlider = slider(5, 1000, 5, params.release_ms || 50.0, (e) => {
    const v = parseFloat(e.target.value);
    releaseVal.textContent = fmtMs(v);
    onChange('lim', { ...params, release_ms: v });
  });
  el.appendChild(row('Release', releaseSlider, releaseVal));

  // Bypass button
  el.appendChild(row('', bypButton('BYP', 'lim', params.bypassed || false, onBypass)));

  return el;
}

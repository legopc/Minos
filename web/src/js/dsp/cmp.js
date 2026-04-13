/**
 * Compressor Panel
 * blockKey: 'cmp'
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
  el.className = 'dsp-content cmp';
  if (params.bypassed) el.style.opacity = '0.22';

  // Threshold
  const threshVal = valEl(fmtDb(params.threshold_db || -20.0));
  const threshSlider = slider(-60, 0, 0.5, params.threshold_db || -20.0, (e) => {
    const v = parseFloat(e.target.value);
    threshVal.textContent = fmtDb(v);
    onChange('cmp', { ...params, threshold_db: v });
  });
  el.appendChild(row('Threshold', threshSlider, threshVal));

  // Ratio
  const ratioVal = valEl((params.ratio || 4.0).toFixed(1) + ':1');
  const ratioSlider = slider(1.0, 20.0, 0.5, params.ratio || 4.0, (e) => {
    const v = parseFloat(e.target.value);
    ratioVal.textContent = v.toFixed(1) + ':1';
    onChange('cmp', { ...params, ratio: v });
  });
  el.appendChild(row('Ratio', ratioSlider, ratioVal));

  // Attack
  const attackVal = valEl(fmtMs(params.attack_ms || 10.0));
  const attackSlider = slider(0.1, 200, 0.1, params.attack_ms || 10.0, (e) => {
    const v = parseFloat(e.target.value);
    attackVal.textContent = fmtMs(v);
    onChange('cmp', { ...params, attack_ms: v });
  });
  el.appendChild(row('Attack', attackSlider, attackVal));

  // Release
  const releaseVal = valEl(fmtMs(params.release_ms || 100.0));
  const releaseSlider = slider(10, 2000, 10, params.release_ms || 100.0, (e) => {
    const v = parseFloat(e.target.value);
    releaseVal.textContent = fmtMs(v);
    onChange('cmp', { ...params, release_ms: v });
  });
  el.appendChild(row('Release', releaseSlider, releaseVal));

  // Makeup Gain
  const makeupVal = valEl(fmtDb(params.makeup_db || 0.0));
  const makeupSlider = slider(-12, 24, 0.5, params.makeup_db || 0.0, (e) => {
    const v = parseFloat(e.target.value);
    makeupVal.textContent = fmtDb(v);
    onChange('cmp', { ...params, makeup_db: v });
  });
  el.appendChild(row('Makeup Gain', makeupSlider, makeupVal));

  // Bypass button
  el.appendChild(row('', bypButton('BYP', 'cmp', params.bypassed || false, onBypass)));

  return el;
}

/**
 * Gate/Expander Panel
 * blockKey: 'gte'
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
  el.className = 'dsp-panel gte';
  if (params.bypassed) el.style.opacity = '0.22';

  // Threshold
  const threshVal = valEl(fmtDb(params.threshold_db || -40.0));
  const threshSlider = slider(-80, 0, 0.5, params.threshold_db || -40.0, (e) => {
    const v = parseFloat(e.target.value);
    threshVal.textContent = fmtDb(v);
    onChange('gte', { ...params, threshold_db: v });
  });
  el.appendChild(row('Threshold', threshSlider, threshVal));

  // Attack
  const attackVal = valEl(fmtMs(params.attack_ms || 5.0));
  const attackSlider = slider(0.1, 100, 0.1, params.attack_ms || 5.0, (e) => {
    const v = parseFloat(e.target.value);
    attackVal.textContent = fmtMs(v);
    onChange('gte', { ...params, attack_ms: v });
  });
  el.appendChild(row('Attack', attackSlider, attackVal));

  // Hold
  const holdVal = valEl(fmtMs(params.hold_ms || 50.0));
  const holdSlider = slider(0, 500, 1, params.hold_ms || 50.0, (e) => {
    const v = parseFloat(e.target.value);
    holdVal.textContent = fmtMs(v);
    onChange('gte', { ...params, hold_ms: v });
  });
  el.appendChild(row('Hold', holdSlider, holdVal));

  // Release
  const releaseVal = valEl(fmtMs(params.release_ms || 200.0));
  const releaseSlider = slider(10, 2000, 10, params.release_ms || 200.0, (e) => {
    const v = parseFloat(e.target.value);
    releaseVal.textContent = fmtMs(v);
    onChange('gte', { ...params, release_ms: v });
  });
  el.appendChild(row('Release', releaseSlider, releaseVal));

  // Range
  const rangeVal = valEl(fmtDb(params.range_db || -60.0));
  const rangeSlider = slider(-80, 0, 1, params.range_db || -60.0, (e) => {
    const v = parseFloat(e.target.value);
    rangeVal.textContent = fmtDb(v);
    onChange('gte', { ...params, range_db: v });
  });
  el.appendChild(row('Range', rangeSlider, rangeVal));

  // Bypass button
  el.appendChild(row('', bypButton('BYP', 'gte', params.bypassed || false, onBypass)));

  return el;
}

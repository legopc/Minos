// dsp/afs.js — Automatic Feedback Suppressor panel
const BK = 'afs';

export function buildContent(channelId, params, accentColor, { onChange }) {
  const p = Object.assign({
    enabled: false,
    threshold_db: -20,
    hysteresis_db: 6,
    bandwidth_hz: 10,
    max_notches: 6,
    auto_reset: false,
  }, params);

  const el = document.createElement('div');
  el.className = 'dsp-content afs';

  function emit(extra) { onChange(BK, Object.assign({}, p, extra)); }

  // Enable toggle
  el.appendChild(_row('Enable', _toggle(p.enabled, v => { p.enabled = v; emit(); })));

  // Threshold
  const thrVal = document.createElement('span'); thrVal.className = 'dsp-value'; thrVal.textContent = `${p.threshold_db} dB`;
  const thr = document.createElement('input'); thr.type='range'; thr.className='dsp-slider'; thr.min='-60'; thr.max='0'; thr.step='1'; thr.value=String(p.threshold_db);
  thr.oninput = () => { p.threshold_db = parseInt(thr.value,10); thrVal.textContent=`${p.threshold_db} dB`; emit(); };
  el.appendChild(_row('Threshold', thr, thrVal));

  // Hysteresis
  const hygVal = document.createElement('span'); hygVal.className = 'dsp-value'; hygVal.textContent = `${p.hysteresis_db} dB`;
  const hyg = document.createElement('input'); hyg.type='range'; hyg.className='dsp-slider'; hyg.min='0'; hyg.max='30'; hyg.step='1'; hyg.value=String(p.hysteresis_db);
  hyg.oninput = () => { p.hysteresis_db = parseInt(hyg.value,10); hygVal.textContent=`${p.hysteresis_db} dB`; emit(); };
  el.appendChild(_row('Hysteresis', hyg, hygVal));

  // Bandwidth
  const bwVal = document.createElement('span'); bwVal.className = 'dsp-value'; bwVal.textContent = `${p.bandwidth_hz} Hz`;
  const bw = document.createElement('input'); bw.type='range'; bw.className='dsp-slider'; bw.min='1'; bw.max='100'; bw.step='1'; bw.value=String(p.bandwidth_hz);
  bw.oninput = () => { p.bandwidth_hz = parseInt(bw.value,10); bwVal.textContent=`${p.bandwidth_hz} Hz`; emit(); };
  el.appendChild(_row('Notch BW', bw, bwVal));

  // Max notches
  const maxSel = document.createElement('select'); maxSel.className='dsp-select';
  [1,2,3,4,5,6,7,8].forEach(n => {
    const o = document.createElement('option'); o.value=String(n); o.textContent=String(n);
    if (n === p.max_notches) o.selected = true;
    maxSel.appendChild(o);
  });
  maxSel.onchange = () => { p.max_notches = parseInt(maxSel.value,10); emit(); };
  el.appendChild(_row('Max Notches', maxSel));

  // Auto reset toggle
  el.appendChild(_row('Auto Reset', _toggle(p.auto_reset, v => { p.auto_reset = v; emit(); })));

  // Manual reset button
  const resetBtn = document.createElement('button');
  resetBtn.className = 'dsp-action-btn';
  resetBtn.textContent = 'Clear Notches';
  resetBtn.style.margin = '6px 0';
  resetBtn.onclick = () => emit({ reset_notches: true });
  el.appendChild(resetBtn);

  return el;
}

function _row(label, ctrl, val) {
  const d = document.createElement('div'); d.className = 'dsp-row';
  const l = document.createElement('span'); l.className = 'dsp-label'; l.textContent = label;
  d.appendChild(l); d.appendChild(ctrl); if (val) d.appendChild(val); return d;
}

function _toggle(on, cb) {
  const b = document.createElement('button');
  b.className = 'dsp-toggle-btn' + (on ? ' active' : '');
  b.textContent = on ? 'ON' : 'OFF';
  b.onclick = () => {
    const v = !b.classList.contains('active');
    b.classList.toggle('active', v);
    b.textContent = v ? 'ON' : 'OFF';
    cb(v);
  };
  return b;
}

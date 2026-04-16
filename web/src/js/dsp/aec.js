// dsp/aec.js — Acoustic Echo Cancellation panel
import { outputList } from '../state.js';
const BK = 'aec';

export function buildContent(channelId, params, accentColor, { onChange }) {
  const p = Object.assign({ enabled: false, reference_tx_idx: null }, params);
  const el = document.createElement('div');
  el.className = 'dsp-content aec';

  function emit() { onChange(BK, { enabled: p.enabled, reference_tx_idx: p.reference_tx_idx }); }

  // Enable toggle
  el.appendChild(_row('Enable', _toggle(p.enabled, v => { p.enabled = v; emit(); })));

  // Reference TX selector
  const sel = document.createElement('select');
  sel.className = 'dsp-select';
  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = '— none —';
  sel.appendChild(noneOpt);
  outputList().forEach(out => {
    const idx = parseInt(out.id.replace('tx_', ''), 10);
    const opt = document.createElement('option');
    opt.value = String(idx);
    opt.textContent = out.name ?? out.id;
    if (p.reference_tx_idx === idx) opt.selected = true;
    sel.appendChild(opt);
  });
  if (p.reference_tx_idx === null) noneOpt.selected = true;
  sel.onchange = () => {
    p.reference_tx_idx = sel.value === '' ? null : parseInt(sel.value, 10);
    emit();
  };
  el.appendChild(_row('Reference TX', sel));

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

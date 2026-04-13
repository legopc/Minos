// dsp/aec.js — Acoustic Echo Cancellation panel
import { DSP_COLOURS } from './colours.js';
const BK = 'aec';

export function buildContent(channelId, params, accentColor, { onChange, onBypass }) {
  const p = Object.assign({ enabled: false, tail_ms: 128, suppression_db: -40, bypassed: false }, params);
  const el = document.createElement('div');

  function emit() { onChange(BK, { ...p }); }

  // Enable toggle
  el.appendChild(_row('Enable', _toggle(p.enabled, v => { p.enabled = v; emit(); })));

  // Tail length
  const tailVal = _val(p.tail_ms + ' ms');
  const tailS   = _slider(32, 512, 32, p.tail_ms, v => { p.tail_ms = +v; tailVal.textContent = v + ' ms'; emit(); });
  el.appendChild(_row('Tail', tailS, tailVal));

  // Suppression
  const supVal = _val(_db(p.suppression_db));
  const supS   = _slider(-80, 0, 1, p.suppression_db, v => { p.suppression_db = +v; supVal.textContent = _db(v); emit(); });
  el.appendChild(_row('Suppress', supS, supVal));

  // Bypass
  const bypBtn = _bypBtn(p.bypassed, v => { p.bypassed = v; onBypass(BK, v); _syncByp(bypBtn, el, v); });
  el.appendChild(_row('', bypBtn));

  return el;
}

function _row(label, ctrl, val) {
  const d = document.createElement('div'); d.className = 'dsp-row';
  const l = document.createElement('span'); l.className = 'dsp-label'; l.textContent = label;
  d.appendChild(l); d.appendChild(ctrl); if (val) d.appendChild(val); return d;
}
function _slider(min, max, step, val, cb) {
  const s = document.createElement('input'); s.type='range'; s.min=min; s.max=max; s.step=step; s.value=val;
  s.className='dsp-slider'; s.oninput = () => cb(s.value); return s;
}
function _val(t)  { const s=document.createElement('span'); s.className='dsp-value'; s.textContent=t; return s; }
function _toggle(on, cb) {
  const b=document.createElement('button'); b.className='dsp-toggle-btn'+(on?' active':'');
  b.textContent=on?'ON':'OFF'; b.onclick=()=>{ const v=!b.classList.contains('active'); b.classList.toggle('active',v); b.textContent=v?'ON':'OFF'; cb(v); }; return b;
}
function _bypBtn(on, cb) {
  const b=document.createElement('button'); b.className='dsp-byp-btn'+(on?' active':'');
  b.textContent='BYP'; b.onclick=()=>{ const v=!b.classList.contains('active'); b.classList.toggle('active',v); cb(v); }; return b;
}
function _syncByp(btn, el, v) { btn.classList.toggle('active',v); el.style.opacity=v?'0.22':'1'; }
function _db(v)  { return (v>=0?'+':'')+Number(v).toFixed(1)+' dB'; }

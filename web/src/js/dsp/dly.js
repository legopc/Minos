// dsp/dly.js — Delay panel
import { DSP_COLOURS } from './colours.js';
const BK = 'dly';

export function buildContent(channelId, params, accentColor, { onChange, onBypass }) {
  const p = Object.assign({ delay_ms: 0.0, bypassed: false }, params);
  const el = document.createElement('div');
  function emit() { onChange(BK, { ...p }); }

  const dlyVal = _val(p.delay_ms.toFixed(1) + ' ms');
  const dlyS   = _slider(0, 1000, 0.1, p.delay_ms, v => { p.delay_ms = +v; dlyVal.textContent = Number(v).toFixed(1) + ' ms'; emit(); });
  el.appendChild(_row('Delay', dlyS, dlyVal));

  const bypBtn = _bypBtn(p.bypassed, v => { p.bypassed = v; onBypass(BK, v); bypBtn.classList.toggle('active', v); el.style.opacity = v ? '0.22' : '1'; });
  el.appendChild(_row('', bypBtn));

  return el;
}

function _row(label, ctrl, val) {
  const d=document.createElement('div'); d.className='dsp-row';
  const l=document.createElement('span'); l.className='dsp-label'; l.textContent=label;
  d.appendChild(l); d.appendChild(ctrl); if(val) d.appendChild(val); return d;
}
function _slider(min,max,step,val,cb) {
  const s=document.createElement('input'); s.type='range'; s.min=min; s.max=max; s.step=step; s.value=val;
  s.className='dsp-slider'; s.oninput=()=>cb(s.value); return s;
}
function _val(t)  { const s=document.createElement('span'); s.className='dsp-value'; s.textContent=t; return s; }
function _bypBtn(on, cb) {
  const b=document.createElement('button'); b.className='dsp-byp-btn'+(on?' active':'');
  b.textContent='BYP'; b.onclick=()=>{ const v=!b.classList.contains('active'); b.classList.toggle('active',v); cb(v); }; return b;
}

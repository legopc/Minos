// dsp/duc.js — Ducker panel
import { DSP_COLOURS } from './colours.js';
const BK = 'duc';

export function buildContent(channelId, params, accentColor, { onChange, onBypass }) {
  const p = Object.assign({
    threshold_db: -20, depth_db: -20, attack_ms: 10, hold_ms: 200, release_ms: 300, bypassed: false
  }, params);
  const el = document.createElement('div');
  function emit() { onChange(BK, { ...p }); }

  const thrVal = _val(_db(p.threshold_db));
  el.appendChild(_row('Threshold', _slider(-60, 0, 0.5, p.threshold_db, v => { p.threshold_db=+v; thrVal.textContent=_db(v); emit(); }), thrVal));

  const dptVal = _val(_db(p.depth_db));
  el.appendChild(_row('Depth', _slider(-60, 0, 0.5, p.depth_db, v => { p.depth_db=+v; dptVal.textContent=_db(v); emit(); }), dptVal));

  const atkVal = _val(_ms(p.attack_ms));
  el.appendChild(_row('Attack', _slider(1, 500, 1, p.attack_ms, v => { p.attack_ms=+v; atkVal.textContent=_ms(v); emit(); }), atkVal));

  const hldVal = _val(_ms(p.hold_ms));
  el.appendChild(_row('Hold', _slider(0, 2000, 10, p.hold_ms, v => { p.hold_ms=+v; hldVal.textContent=_ms(v); emit(); }), hldVal));

  const relVal = _val(_ms(p.release_ms));
  el.appendChild(_row('Release', _slider(10, 3000, 10, p.release_ms, v => { p.release_ms=+v; relVal.textContent=_ms(v); emit(); }), relVal));

  const bypBtn = _bypBtn(p.bypassed, v => { p.bypassed=v; onBypass(BK, v); bypBtn.classList.toggle('active', v); el.style.opacity=v?'0.22':'1'; });
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
function _db(v)  { return (v>=0?'+':'')+Number(v).toFixed(1)+' dB'; }
function _ms(v)  { return Number(v).toFixed(v<10?1:0)+' ms'; }

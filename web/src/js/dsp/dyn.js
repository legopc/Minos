// dsp/dyn.js — Dynamics (combined compressor+gate) panel
import { DSP_COLOURS } from './colours.js';
const BK = 'dyn';

export function buildContent(channelId, params, accentColor, { onChange, onBypass }) {
  const p = Object.assign({
    cmp_threshold_db: -20, cmp_ratio: 4, cmp_attack_ms: 10, cmp_release_ms: 100, cmp_makeup_db: 0,
    gte_threshold_db: -60, gte_range_db: -40, gte_attack_ms: 5, gte_release_ms: 200,
    bypassed: false
  }, params);
  const el = document.createElement('div');
  function emit() { onChange(BK, { ...p }); }

  // GR meter
  const grMeter = document.createElement('div');
  grMeter.className = 'dsp-gr-meter';
  grMeter.innerHTML =
    `<div class="dsp-gr-track"><div class="dsp-gr-bar" id="gr-bar-${channelId}_cmp"></div></div>` +
    `<span class="dsp-gr-label" id="gr-label-${channelId}_cmp">0.0 dB</span>`;
  el.appendChild(grMeter);

  const sec = (t) => { const d=document.createElement('div'); d.className='dsp-band-header'; d.textContent=t; return d; };

  el.appendChild(sec('Compressor'));
  const cThrVal = _val(_db(p.cmp_threshold_db));
  el.appendChild(_row('Threshold', _slider(-60,0,0.5,p.cmp_threshold_db,v=>{p.cmp_threshold_db=+v;cThrVal.textContent=_db(v);emit();}), cThrVal));
  const cRatVal = _val(p.cmp_ratio+':1');
  el.appendChild(_row('Ratio', _slider(1,20,0.5,p.cmp_ratio,v=>{p.cmp_ratio=+v;cRatVal.textContent=v+':1';emit();}), cRatVal));
  const cAtkVal = _val(_ms(p.cmp_attack_ms));
  el.appendChild(_row('Attack', _slider(0.1,200,0.1,p.cmp_attack_ms,v=>{p.cmp_attack_ms=+v;cAtkVal.textContent=_ms(v);emit();}), cAtkVal));
  const cRelVal = _val(_ms(p.cmp_release_ms));
  el.appendChild(_row('Release', _slider(10,2000,10,p.cmp_release_ms,v=>{p.cmp_release_ms=+v;cRelVal.textContent=_ms(v);emit();}), cRelVal));
  const cMkpVal = _val(_db(p.cmp_makeup_db));
  el.appendChild(_row('Makeup', _slider(-12,24,0.5,p.cmp_makeup_db,v=>{p.cmp_makeup_db=+v;cMkpVal.textContent=_db(v);emit();}), cMkpVal));

  el.appendChild(sec('Gate'));
  const gThrVal = _val(_db(p.gte_threshold_db));
  el.appendChild(_row('Threshold', _slider(-80,0,0.5,p.gte_threshold_db,v=>{p.gte_threshold_db=+v;gThrVal.textContent=_db(v);emit();}), gThrVal));
  const gRngVal = _val(_db(p.gte_range_db));
  el.appendChild(_row('Range', _slider(-80,0,1,p.gte_range_db,v=>{p.gte_range_db=+v;gRngVal.textContent=_db(v);emit();}), gRngVal));
  const gAtkVal = _val(_ms(p.gte_attack_ms));
  el.appendChild(_row('Attack', _slider(0.1,100,0.1,p.gte_attack_ms,v=>{p.gte_attack_ms=+v;gAtkVal.textContent=_ms(v);emit();}), gAtkVal));
  const gRelVal = _val(_ms(p.gte_release_ms));
  el.appendChild(_row('Release', _slider(10,2000,10,p.gte_release_ms,v=>{p.gte_release_ms=+v;gRelVal.textContent=_ms(v);emit();}), gRelVal));

  const bypBtn = _bypBtn(p.bypassed, v=>{p.bypassed=v;onBypass(BK,v);bypBtn.classList.toggle('active',v);el.style.opacity=v?'0.22':'1';});
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

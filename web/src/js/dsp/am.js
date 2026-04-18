// dsp/am.js — Polarity / Gain trim panel
const BK = 'am';

export function buildContent(channelId, params, accentColor, { onChange, onBypass }) {
  const p = Object.assign({ invert_polarity: false, gain_db: 0.0, bypassed: false }, params);
  const el = document.createElement('div');
  let bypBtn;
  let polarityBtn;

  function sync() {
    p.bypassed = _isBypassed(p);
    gainVal.textContent = _db(p.gain_db);
    _syncByp(bypBtn, el, p.bypassed);
  }

  function emit() {
    sync();
    onChange(BK, { ...p });
  }

  // Polarity invert
  polarityBtn = _toggle(p.invert_polarity, v => { p.invert_polarity = v; emit(); });
  el.appendChild(_row('Polarity', polarityBtn));

  // Gain trim
  const gainVal = _val(_db(p.gain_db));
  const gainS   = _slider(-20, 20, 0.5, p.gain_db, v => { p.gain_db = +v; gainVal.textContent = _db(v); emit(); });
  el.appendChild(_row('Gain', gainS, gainVal));

  // Neutral trim/polarity is effectively bypassed for AM.
  bypBtn = _bypBtn(p.bypassed, () => {
    p.invert_polarity = false;
    p.gain_db = 0;
    polarityBtn.setState(false);
    gainS.value = '0';
    emit();
  });
  el.appendChild(_row('', bypBtn));

  sync();

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
  b.setState = (v) => {
    b.classList.toggle('active', !!v);
    b.textContent = v ? 'INV' : 'NORM';
  };
  b.setState(on);
  b.onclick=()=>{ const v=!b.classList.contains('active'); b.setState(v); cb(v); }; return b;
}
function _bypBtn(on, cb) {
  const b=document.createElement('button'); b.className='dsp-byp-btn'+(on?' active':'');
  b.textContent='BYP'; b.onclick=()=>cb(); return b;
}
function _syncByp(btn, el, v) { btn.classList.toggle('active',v); el.style.opacity=v?'0.22':'1'; }
function _isBypassed(p) { return Number(p.gain_db ?? 0) === 0 && !p.invert_polarity; }
function _db(v)  { return (v>=0?'+':'')+Number(v).toFixed(1)+' dB'; }

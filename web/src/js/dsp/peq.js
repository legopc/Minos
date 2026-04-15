/**
 * Parametric EQ Panel
 * blockKey: 'peq'
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

function fmtHz(v) {
  return v >= 1000 ? (v / 1000).toFixed(2) + 'kHz' : v + 'Hz';
}

function fmtDb(v) {
  return (v >= 0 ? '+' : '') + Number(v).toFixed(1) + ' dB';
}

export function buildContent(channelId, params, accentColor, { onChange, onBypass }) {
  const el = document.createElement('div');
  el.className = 'dsp-content peq';

  const bands = params.bands || [
    { freq: 100, gain: 0, q: 0.7 },
    { freq: 1000, gain: 0, q: 0.7 },
    { freq: 8000, gain: 0, q: 0.7 },
    { freq: 16000, gain: 0, q: 0.7 }
  ];

  // EQ frequency response canvas
  const canvas = document.createElement('canvas');
  canvas.className = 'peq-curve-canvas';
  canvas.height = 80;
  el.appendChild(canvas);

  function _drawCurve() {
    const W = canvas.offsetWidth || 260;
    canvas.width = W;
    const H = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    // Grid: 0 dB line and ±6/±12 dB lines
    const DB_RANGE = 18; // ±18 dB shown
    const dbToY = db => H / 2 - (db / DB_RANGE) * (H / 2 - 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    [-12, -6, 0, 6, 12].forEach(db => {
      const y = Math.round(dbToY(db)) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    });
    // 0 dB slightly brighter
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.moveTo(0, dbToY(0)); ctx.lineTo(W, dbToY(0)); ctx.stroke();

    // Frequency response
    const SR = 48000;
    const freqToX = f => (Math.log10(f / 20) / Math.log10(20000 / 20)) * W;

    // Compute combined magnitude across N points
    const N = W;
    const curve = new Float32Array(N);
    for (let xi = 0; xi < N; xi++) {
      const f = 20 * Math.pow(10000, xi / (N - 1));
      const w = 2 * Math.PI * f / SR;
      let totalDb = 0;
      for (const band of bands) {
        if (!band.gain || band.gain === 0) continue;
        const A = Math.pow(10, band.gain / 40);
        const w0 = 2 * Math.PI * band.freq / SR;
        const alpha = Math.sin(w0) / (2 * (band.q || 0.7));
        const b0 = 1 + alpha * A,  b1 = -2 * Math.cos(w0),  b2 = 1 - alpha * A;
        const a0 = 1 + alpha / A,  a1 = -2 * Math.cos(w0),  a2 = 1 - alpha / A;
        const cw = Math.cos(w), c2w = Math.cos(2 * w);
        const sw = Math.sin(w), s2w = Math.sin(2 * w);
        const nr = b0 + b1 * cw + b2 * c2w, ni = -(b1 * sw + b2 * s2w);
        const dr = a0 + a1 * cw + a2 * c2w, di = -(a1 * sw + a2 * s2w);
        const mag2 = (nr * nr + ni * ni) / (dr * dr + di * di);
        totalDb += 10 * Math.log10(Math.max(mag2, 1e-20));
      }
      curve[xi] = totalDb;
    }

    // Draw curve
    ctx.beginPath();
    ctx.strokeStyle = accentColor || '#7ec8e3';
    ctx.lineWidth = 1.5;
    for (let xi = 0; xi < N; xi++) {
      const y = dbToY(Math.max(-DB_RANGE, Math.min(DB_RANGE, curve[xi])));
      if (xi === 0) ctx.moveTo(xi, y); else ctx.lineTo(xi, y);
    }
    ctx.stroke();
  }

  // Redraw when panel is visible (ResizeObserver for width changes)
  const ro = new ResizeObserver(() => _drawCurve());
  ro.observe(canvas);
  setTimeout(_drawCurve, 0);

  // Enable toggle
  const enableCheckbox = document.createElement('input');
  enableCheckbox.type = 'checkbox';
  enableCheckbox.className = 'dsp-toggle';
  enableCheckbox.checked = params.enabled || false;
  enableCheckbox.onchange = () => {
    const updated = { ...params, enabled: enableCheckbox.checked };
    onChange('peq', updated);
  };
  el.appendChild(row('Enable', enableCheckbox));

  // Build band controls
  bands.forEach((band, idx) => {
    const bandContainer = document.createElement('div');
    bandContainer.className = 'dsp-band';

    // Band header
    const header = document.createElement('div');
    header.className = 'dsp-band-header';
    header.textContent = `Band ${idx + 1}`;
    bandContainer.appendChild(header);

    // Frequency
    const freqVal = valEl(fmtHz(band.freq));
    const freqSlider = slider(20, 20000, 10, band.freq, (e) => {
      const v = parseFloat(e.target.value);
      freqVal.textContent = fmtHz(v);
      bands[idx] = { ...bands[idx], freq: v };
      onChange('peq', { ...params, bands: [...bands] });
      _drawCurve();
    });
    bandContainer.appendChild(row('Freq', freqSlider, freqVal));

    // Gain
    const gainVal = valEl(fmtDb(band.gain));
    const gainSlider = slider(-18, 18, 0.5, band.gain, (e) => {
      const v = parseFloat(e.target.value);
      gainVal.textContent = fmtDb(v);
      bands[idx] = { ...bands[idx], gain: v };
      onChange('peq', { ...params, bands: [...bands] });
      _drawCurve();
    });
    bandContainer.appendChild(row('Gain', gainSlider, gainVal));

    // Q
    const qVal = valEl('Q:' + band.q.toFixed(1));
    const qSlider = slider(0.1, 10, 0.1, band.q, (e) => {
      const v = parseFloat(e.target.value);
      qVal.textContent = 'Q:' + v.toFixed(1);
      bands[idx] = { ...bands[idx], q: v };
      onChange('peq', { ...params, bands: [...bands] });
      _drawCurve();
    });
    bandContainer.appendChild(row('Q', qSlider, qVal));

    el.appendChild(bandContainer);
  });

  return el;
}

/**
 * Parametric EQ Panel
 * blockKey: 'peq'
 */

import { sliderRow, selectRow, toggleRow, sectionHeader, fmtDb, fmtHz } from './common.js';

export function buildContent(channelId, params, accentColor, { onChange, onBypass }) {
  const el = document.createElement('div');
  el.className = 'dsp-content peq';

  const bands = params.bands || [
    { freq: 100,   gain: 0, q: 0.7, band_type: 'Peaking' },
    { freq: 1000,  gain: 0, q: 0.7, band_type: 'Peaking' },
    { freq: 8000,  gain: 0, q: 0.7, band_type: 'Peaking' },
    { freq: 16000, gain: 0, q: 0.7, band_type: 'Peaking' }
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
  el.appendChild(toggleRow('Enable', params.enabled || false, v => {
    onChange('peq', { ...params, enabled: v });
  }));

  // Build band controls
  bands.forEach((band, idx) => {
    const bandContainer = document.createElement('div');
    bandContainer.className = 'dsp-band';

    bandContainer.appendChild(sectionHeader(`Band ${idx + 1}`));

    // Type
    bandContainer.appendChild(selectRow('Type', [
      { value: 'LowShelf',  label: 'Low Shelf' },
      { value: 'Peaking',   label: 'Bell' },
      { value: 'HighShelf', label: 'Hi Shelf' }
    ], band.band_type || 'Peaking', v => {
      bands[idx] = { ...bands[idx], band_type: v };
      onChange('peq', { ...params, bands: [...bands] });
      _drawCurve();
    }).el);

    // Frequency
    bandContainer.appendChild(sliderRow('Freq', 20, 20000, 10, band.freq, fmtHz, v => {
      bands[idx] = { ...bands[idx], freq: v };
      onChange('peq', { ...params, bands: [...bands] });
      _drawCurve();
    }));

    // Gain
    bandContainer.appendChild(sliderRow('Gain', -18, 18, 0.5, band.gain, fmtDb, v => {
      bands[idx] = { ...bands[idx], gain: v };
      onChange('peq', { ...params, bands: [...bands] });
      _drawCurve();
    }));

    // Q
    bandContainer.appendChild(sliderRow('Q', 0.1, 10, 0.1, band.q, v => 'Q:' + v.toFixed(1), v => {
      bands[idx] = { ...bands[idx], q: v };
      onChange('peq', { ...params, bands: [...bands] });
      _drawCurve();
    }));

    el.appendChild(bandContainer);
  });

  return el;
}

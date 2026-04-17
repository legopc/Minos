// dsp/dly.js — Delay panel (+ TPDF dither for output channels)
import * as api from '../api.js';
import { sliderRow, toggleRow, selectRow, fmtMs } from './common.js';

const BK = 'dly';

export function buildContent(channelId, params, accentColor, { onChange, onBypass }) {
  const p = Object.assign({ delay_ms: 0.0, enabled: false, bypassed: false }, params);
  const el = document.createElement('div');
  function emit() { onChange(BK, { ...p }); }

  el.appendChild(toggleRow('Enable', p.enabled, v => {
    p.enabled = v;
    onBypass(BK, !v);
  }));

  el.appendChild(sliderRow('Delay', 0, 1000, 0.1, p.delay_ms, fmtMs, v => {
    p.delay_ms = v;
    emit();
  }));

  if (channelId.startsWith('tx_')) {
    const idx = parseInt(channelId.split('_')[1], 10);
    const ditherOpts = [
      { value: '0', label: 'Off' },
      { value: '16', label: '16-bit' },
      { value: '24', label: '24-bit' }
    ];
    const { el: ditherRow, sel: ditherSel } = selectRow('Dither', ditherOpts, String(p.dither_bits ?? 0), () => {
      api.putOutputDither(idx, parseInt(ditherSel.value, 10))
        .catch(e => console.error('Dither error:', e));
    });
    el.appendChild(ditherRow);
  }

  return el;
}

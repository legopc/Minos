/**
 * Compressor Panel
 * blockKey: 'cmp'
 */

import { sliderRow, toggleRow, bypRow, grMeter, fmtDb, fmtMs, fmtRatio } from './common.js';

export function buildContent(channelId, params, accentColor, { onChange, onBypass }) {
  const el = document.createElement('div');
  el.className = 'dsp-content cmp';

  // GR meter
  el.appendChild(grMeter(`${channelId}_cmp`));

  // Enable
  el.appendChild(toggleRow('Enable', params.enabled ?? false, v => onBypass('cmp', !v)));
  // Threshold
  el.appendChild(sliderRow(
    'Threshold',
    -60, 0, 0.5,
    params.threshold_db || -20.0,
    fmtDb,
    v => onChange('cmp', { ...params, threshold_db: v })
  ));

  // Ratio
  el.appendChild(sliderRow(
    'Ratio',
    1.0, 20.0, 0.5,
    params.ratio || 4.0,
    fmtRatio,
    v => onChange('cmp', { ...params, ratio: v })
  ));

  // Attack
  el.appendChild(sliderRow(
    'Attack',
    0.1, 200, 0.1,
    params.attack_ms || 10.0,
    fmtMs,
    v => onChange('cmp', { ...params, attack_ms: v })
  ));

  // Release
  el.appendChild(sliderRow(
    'Release',
    10, 2000, 10,
    params.release_ms || 100.0,
    fmtMs,
    v => onChange('cmp', { ...params, release_ms: v })
  ));

  // Makeup Gain
  el.appendChild(sliderRow(
    'Makeup Gain',
    -12, 24, 0.5,
    params.makeup_db || 0.0,
    fmtDb,
    v => onChange('cmp', { ...params, makeup_db: v })
  ));

  // Bypass
  el.appendChild(bypRow(
    params.bypassed || false,
    v => onBypass('cmp', v)
  ));

  return el;
}

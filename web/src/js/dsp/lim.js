/**
 * Limiter Panel
 * blockKey: 'lim'
 */

import { sliderRow, toggleRow, bypRow, grMeter, fmtDb, fmtMs } from './common.js';

export function buildContent(channelId, params, accentColor, { onChange, onBypass }) {
  const el = document.createElement('div');
  el.className = 'dsp-content lim';

  // GR meter
  el.appendChild(grMeter(`${channelId}_lim`));

  // Enable
  el.appendChild(toggleRow('Enable', params.enabled ?? false, v => onBypass('lim', !v)));

  // Threshold
  el.appendChild(sliderRow(
    'Threshold',
    -40, 0, 0.5,
    params.threshold_db || -3.0,
    fmtDb,
    v => onChange('lim', { ...params, threshold_db: v })
  ));

  // Release
  el.appendChild(sliderRow(
    'Release',
    5, 1000, 5,
    params.release_ms || 50.0,
    fmtMs,
    v => onChange('lim', { ...params, release_ms: v })
  ));

  // Bypass
  el.appendChild(bypRow(
    params.bypassed || false,
    v => onBypass('lim', v)
  ));

  return el;
}

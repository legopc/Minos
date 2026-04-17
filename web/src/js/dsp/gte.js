/**
 * Gate/Expander Panel
 * blockKey: 'gte'
 */

import { sliderRow, toggleRow, bypRow, fmtDb, fmtMs } from './common.js';

export function buildContent(channelId, params, accentColor, { onChange, onBypass }) {
  const el = document.createElement('div');
  el.className = 'dsp-content gte';

  // Enable
  el.appendChild(toggleRow('Enable', params.enabled ?? false, v => onBypass('gte', !v)));

  // Threshold
  el.appendChild(sliderRow(
    'Threshold',
    -80, 0, 0.5,
    params.threshold_db || -40.0,
    fmtDb,
    v => onChange('gte', { ...params, threshold_db: v })
  ));

  // Attack
  el.appendChild(sliderRow(
    'Attack',
    0.1, 100, 0.1,
    params.attack_ms || 5.0,
    fmtMs,
    v => onChange('gte', { ...params, attack_ms: v })
  ));

  // Hold
  el.appendChild(sliderRow(
    'Hold',
    0, 500, 1,
    params.hold_ms || 50.0,
    fmtMs,
    v => onChange('gte', { ...params, hold_ms: v })
  ));

  // Release
  el.appendChild(sliderRow(
    'Release',
    10, 2000, 10,
    params.release_ms || 200.0,
    fmtMs,
    v => onChange('gte', { ...params, release_ms: v })
  ));

  // Range
  el.appendChild(sliderRow(
    'Range',
    -80, 0, 1,
    params.range_db || -60.0,
    fmtDb,
    v => onChange('gte', { ...params, range_db: v })
  ));

  // Bypass
  el.appendChild(bypRow(
    params.bypassed || false,
    v => onBypass('gte', v)
  ));

  return el;
}

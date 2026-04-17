// dsp/colours.js — DSP block badge colours
// Core entries derived from registry. Legacy/non-registry entries kept below.
// Hardcoded hex — never use CSS variables for these.
// Bypassed badge: opacity 0.22. Active (panel open): filter brightness(1.5) + border.

import { DSP_BLOCKS } from './registry.js';

export const DSP_COLOURS = {
  // Legacy / non-registry blocks
  flt: { bg: '#2d5a27', fg: '#4ec942', label: 'FLT' },
  dyn: { bg: '#203050', fg: '#79c0ff', label: 'DYN' },
  duc: { bg: '#3a2a1a', fg: '#d29922', label: 'DUC' },
  am:  { bg: '#4a1a1a', fg: '#f85149', label: 'AM'  },
  // Registry-derived entries (single source of truth)
  ...Object.fromEntries(
    Object.entries(DSP_BLOCKS).map(([k, v]) => [k, { bg: v.bg, fg: v.fg, label: v.label }])
  ),
};

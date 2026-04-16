// dsp/colours.js — single source of truth for DSP block badge colours
// Hardcoded hex — never use CSS variables for these.
// Bypassed badge: opacity 0.22. Active (panel open): filter brightness(1.5) + border.

export const DSP_COLOURS = {
  flt: { bg: '#2d5a27', fg: '#4ec942', label: 'FLT' },
  aec: { bg: '#1a3a5c', fg: '#58a6ff', label: 'AEC' },
  cmp: { bg: '#4a2060', fg: '#c678dd', label: 'CMP' },
  dyn: { bg: '#203050', fg: '#79c0ff', label: 'DYN' },
  dly: { bg: '#2a3d1a', fg: '#85c46a', label: 'DLY' },
  duc: { bg: '#3a2a1a', fg: '#d29922', label: 'DUC' },
  am:  { bg: '#4a1a1a', fg: '#f85149', label: 'AM'  },
  lim: { bg: '#3a1010', fg: '#ff7b72', label: 'LIM' },
  peq: { bg: '#2a1a4a', fg: '#d2a8ff', label: 'PEQ' },
  gte: { bg: '#3a2d10', fg: '#e3b341', label: 'GTE' },
  axm: { bg: '#1a3a2a', fg: '#3fb950', label: 'AXM' },
  afs: { bg: '#3a1a2a', fg: '#f0883e', label: 'AFS' },
  deq: { bg: '#1a3a3a', fg: '#39d0d8', label: 'DEQ' },
};

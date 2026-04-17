// S7 s7-arch-dsp-registry — single source of truth for DSP blocks.
//
// Replaces scattered block IDs in colours.js, panels.js blockMap and
// per-block dsp/*.js files. Every block is declared once here.

export const DSP_BLOCKS = {
  peq: { label: 'PEQ', bg: '#2a1a4a', fg: '#d2a8ff', panel: 'eq',         apiKey: 'eq'  },
  cmp: { label: 'CMP', bg: '#4a2060', fg: '#c678dd', panel: 'compressor', apiKey: 'cmp' },
  gte: { label: 'GTE', bg: '#3a2d10', fg: '#e3b341', panel: 'gate',       apiKey: 'gte' },
  lim: { label: 'LIM', bg: '#3a1010', fg: '#ff7b72', panel: 'limiter',    apiKey: 'lim' },
  dly: { label: 'DLY', bg: '#2a3d1a', fg: '#85c46a', panel: 'delay',      apiKey: 'dly' },
  aec: { label: 'AEC', bg: '#1a3a5c', fg: '#58a6ff', panel: 'aec',        apiKey: 'aec' },
  axm: { label: 'AXM', bg: '#1a3a2a', fg: '#3fb950', panel: 'automixer',  apiKey: 'axm' },
  afs: { label: 'AFS', bg: '#3a1a2a', fg: '#f0883e', panel: 'feedback',   apiKey: 'afs' },
  deq: { label: 'DEQ', bg: '#1a3a3a', fg: '#39d0d8', panel: 'deq',        apiKey: 'deq' },
  // s7-feat-sidechain-duck
  // duc: { label: 'DUC', bg: '#3a2a1a', fg: '#d29922', panel: 'ducker',  apiKey: 'duc' },
};

export const blockMap = Object.fromEntries(
  Object.entries(DSP_BLOCKS).map(([k, v]) => [k, v.panel]),
);

export const colours = Object.fromEntries(
  Object.entries(DSP_BLOCKS).map(([k, v]) => [k, { bg: v.bg, fg: v.fg, label: v.label }]),
);

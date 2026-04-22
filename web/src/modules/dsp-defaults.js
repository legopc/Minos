// Shared DSP defaults loader — fetches and caches /generated/dsp-defaults.json

let _defaults = null;
let _fetching = null;

const FALLBACK = {
  lim:  { attack_ms: 1.0, enabled: false, release_ms: 100.0, threshold_db: -1.0 },
  cmp:  { attack_ms: 10.0, enabled: false, knee_db: 6.0, makeup_db: 0.0, ratio: 4.0, release_ms: 100.0, threshold_db: -18.0 },
  hpf:  { enabled: false, freq_hz: 80 },
  lpf:  { enabled: false, freq_hz: 22000 },
  gate: { enabled: false, threshold_db: -40, ratio: 4, attack_ms: 1, hold_ms: 100, release_ms: 100, range_db: 60 },
  eq:   { enabled: false, bands: [] },
  deq:  { enabled: false, bands: [] },
};

export async function getDspDefaults() {
  if (_defaults !== null) return _defaults;
  if (_fetching) return _fetching;
  _fetching = fetch('/generated/dsp-defaults.json')
    .then(res => res.ok ? res.json() : {})
    .catch(() => {})
    .then(d => { _defaults = d; _fetching = null; });
  return _fetching;
}

export function getDspDefaultsSync() {
  return _defaults ?? FALLBACK;
}

getDspDefaults();
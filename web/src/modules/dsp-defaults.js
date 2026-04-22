// Shared DSP defaults loader — fetches and caches /generated/dsp-defaults.json

let _defaults = null;
let _fetching = null;

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
  return _defaults ?? null;
}

getDspDefaults();
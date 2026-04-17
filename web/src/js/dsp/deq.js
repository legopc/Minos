// dsp/deq.js — Dynamic EQ panel (4 bands)
import { sliderRow, toggleRow, selectRow, sectionHeader, bypRow, fmtDb, fmtMs, fmtHz } from './common.js';

const BK = 'deq';

const BAND_TYPES = [
  { value: 'Peaking',   label: 'Bell' },
  { value: 'LowShelf',  label: 'Low Shelf' },
  { value: 'HighShelf', label: 'Hi Shelf' },
];

const BAND_DEFAULTS = {
  enabled: false,
  freq_hz: 5000,
  q: 1.4,
  band_type: 'Peaking',
  threshold_db: -18,
  ratio: 4.0,
  attack_ms: 5,
  release_ms: 80,
  range_db: -9,
};

export function buildContent(channelId, params, accentColor, { onChange, onBypass }) {
  const p = Object.assign({ enabled: false, bypassed: false, bands: [] }, params);
  while (p.bands.length < 4) p.bands.push(Object.assign({}, BAND_DEFAULTS));
  p.bands = p.bands.map(b => Object.assign({}, BAND_DEFAULTS, b));

  const el = document.createElement('div');
  el.className = 'dsp-content deq';

  function emit() { onChange(BK, { enabled: p.enabled, bypassed: p.bypassed, bands: p.bands }); }

  // Global enable + bypass
  el.appendChild(toggleRow('Enable', p.enabled, v => { p.enabled = v; emit(); }));
  el.appendChild(bypRow(p.bypassed, v => { p.bypassed = v; onBypass(BK, v); }));

  // Band strips
  p.bands.forEach((band, i) => {
    const section = document.createElement('div');
    section.className = 'deq-band';
    section.style.cssText = 'border:1px solid #333;border-radius:4px;padding:6px;margin:4px 0;';

    section.appendChild(sectionHeader(`Band ${i + 1}`));
    section.appendChild(toggleRow('Enable', band.enabled, v => { band.enabled = v; emit(); }));
    section.appendChild(selectRow('Type', BAND_TYPES, band.band_type, v => { band.band_type = v; emit(); }).el);
    section.appendChild(sliderRow('Freq',      20,   20000, 1,   band.freq_hz,      fmtHz,                              v => { band.freq_hz      = v; emit(); }));
    section.appendChild(sliderRow('Q',          0.1,  10,   0.1, band.q,            v => v.toFixed(2),                  v => { band.q           = v; emit(); }));
    section.appendChild(sliderRow('Threshold', -60,   0,    1,   band.threshold_db, fmtDb,                              v => { band.threshold_db = v; emit(); }));
    section.appendChild(sliderRow('Ratio',      1.0,  20,   0.1, band.ratio,        v => v.toFixed(1) + ':1',           v => { band.ratio        = v; emit(); }));
    section.appendChild(sliderRow('Range',     -24,   24,   1,   band.range_db,     v => (v > 0 ? '+' : '') + v + ' dB', v => { band.range_db   = v; emit(); }));
    section.appendChild(sliderRow('Attack',     0.1,  200,  0.1, band.attack_ms,    fmtMs,                              v => { band.attack_ms    = v; emit(); }));
    section.appendChild(sliderRow('Release',    1,    1000, 1,   band.release_ms,   fmtMs,                              v => { band.release_ms   = v; emit(); }));

    el.appendChild(section);
  });

  return el;
}

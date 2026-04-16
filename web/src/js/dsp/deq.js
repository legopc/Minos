// dsp/deq.js — Dynamic EQ panel (4 bands)
const BK = 'deq';

const BAND_TYPES = ['Peaking', 'LowShelf', 'HighShelf'];

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

export function buildContent(channelId, params, accentColor, { onChange }) {
  const p = Object.assign({ enabled: false, bypassed: false, bands: [] }, params);
  // Ensure 4 bands with defaults
  while (p.bands.length < 4) p.bands.push(Object.assign({}, BAND_DEFAULTS));
  p.bands = p.bands.map(b => Object.assign({}, BAND_DEFAULTS, b));

  const el = document.createElement('div');
  el.className = 'dsp-content deq';

  function emit() { onChange(BK, { enabled: p.enabled, bypassed: p.bypassed, bands: p.bands }); }

  // Global enable + bypass
  const headerRow = document.createElement('div');
  headerRow.className = 'dsp-row';
  const enLabel = document.createElement('span'); enLabel.className = 'dsp-label'; enLabel.textContent = 'Enable';
  headerRow.appendChild(enLabel);
  headerRow.appendChild(_toggle(p.enabled, v => { p.enabled = v; emit(); }));
  const byLabel = document.createElement('span'); byLabel.className = 'dsp-label'; byLabel.style.marginLeft = '10px'; byLabel.textContent = 'Bypass';
  headerRow.appendChild(byLabel);
  headerRow.appendChild(_toggle(p.bypassed, v => { p.bypassed = v; emit(); }));
  el.appendChild(headerRow);

  // Band strips
  p.bands.forEach((band, i) => {
    const section = document.createElement('div');
    section.className = 'deq-band';
    section.style.cssText = 'border:1px solid #333;border-radius:4px;padding:6px;margin:4px 0;';

    const title = document.createElement('div');
    title.className = 'dsp-row';
    title.style.marginBottom = '4px';
    const titleLabel = document.createElement('span');
    titleLabel.className = 'dsp-label';
    titleLabel.style.fontWeight = 'bold';
    titleLabel.textContent = `Band ${i + 1}`;
    title.appendChild(titleLabel);
    title.appendChild(_toggle(band.enabled, v => { band.enabled = v; emit(); }));

    // Band type select
    const typeSel = document.createElement('select'); typeSel.className = 'dsp-select'; typeSel.style.marginLeft = '8px';
    BAND_TYPES.forEach(t => {
      const o = document.createElement('option'); o.value = t; o.textContent = t;
      if (t === band.band_type) o.selected = true;
      typeSel.appendChild(o);
    });
    typeSel.onchange = () => { band.band_type = typeSel.value; emit(); };
    title.appendChild(typeSel);
    section.appendChild(title);

    section.appendChild(_sliderRow('Freq', band.freq_hz, 20, 20000, 1, v => { band.freq_hz = v; emit(); }, hz => `${hz < 1000 ? hz : (hz/1000).toFixed(1)+'k'} Hz`));
    section.appendChild(_sliderRow('Q', band.q, 0.1, 10, 0.1, v => { band.q = v; emit(); }, v => v.toFixed(2)));
    section.appendChild(_sliderRow('Threshold', band.threshold_db, -60, 0, 1, v => { band.threshold_db = v; emit(); }, v => `${v} dB`));
    section.appendChild(_sliderRow('Ratio', band.ratio, 1.0, 20, 0.1, v => { band.ratio = v; emit(); }, v => `${v.toFixed(1)}:1`));
    section.appendChild(_sliderRow('Range', band.range_db, -24, 24, 1, v => { band.range_db = v; emit(); }, v => `${v > 0 ? '+' : ''}${v} dB`));
    section.appendChild(_sliderRow('Attack', band.attack_ms, 0.1, 200, 0.1, v => { band.attack_ms = v; emit(); }, v => `${v.toFixed(1)} ms`));
    section.appendChild(_sliderRow('Release', band.release_ms, 1, 1000, 1, v => { band.release_ms = v; emit(); }, v => `${v} ms`));

    el.appendChild(section);
  });

  return el;
}

function _sliderRow(label, initVal, min, max, step, onChange, fmt) {
  const d = document.createElement('div'); d.className = 'dsp-row';
  const l = document.createElement('span'); l.className = 'dsp-label'; l.textContent = label;
  const val = document.createElement('span'); val.className = 'dsp-value'; val.textContent = fmt(initVal);
  const sl = document.createElement('input'); sl.type = 'range'; sl.className = 'dsp-slider';
  sl.min = String(min); sl.max = String(max); sl.step = String(step); sl.value = String(initVal);
  sl.oninput = () => { const v = parseFloat(sl.value); val.textContent = fmt(v); onChange(v); };
  d.appendChild(l); d.appendChild(sl); d.appendChild(val);
  return d;
}

function _toggle(on, cb) {
  const b = document.createElement('button');
  b.className = 'dsp-toggle-btn' + (on ? ' active' : '');
  b.textContent = on ? 'ON' : 'OFF';
  b.onclick = () => {
    const v = !b.classList.contains('active');
    b.classList.toggle('active', v);
    b.textContent = v ? 'ON' : 'OFF';
    cb(v);
  };
  return b;
}

// s7-arch-shared-strip -- shared mixer strip component.
//
// Inputs, buses, outputs and zones all share this single code path for:
//   fader + VU meter + dB label (with inline edit) + mute + solo + DSP badge row.
//
// Public API:
//   createStrip(opts)           -> HTMLElement
//   updateStripMeter(el, db)
//   updateStripFader(el, db)
//
// opts:
//   kind        'input' | 'bus' | 'output'   -- drives root class & name element class
//   id          entity id                     -- used as suffix for all DOM ids
//   name        display label
//   nameTitle   title attr for name el (defaults to id)
//   initDb      initial fader dB (default 0)
//   initMuted   initial mute state (default false)
//   initSolo    initial solo state (undefined -> no solo button)
//   hasSolo     show solo button (default false)
//   hasClip     show clip badge in meter (default false)
//   dsp         { blockId: { bypassed, enabled, ... } } -- null/undefined -> no DSP row
//   onFader     async (db) -> void   -- called after 80 ms debounce
//   onMute      async (currentMuted) -> void
//   onSolo      async (event) -> void
//   onDspOpen   (blockId, buttonEl) -> void

import * as st from '../state.js';
import { dbToPercent } from '../metering.js';
import { DSP_COLOURS } from '../dsp/colours.js';

// --- private helpers --------------------------------------------------------

const METER_SCALE_DBS = [0, -6, -12, -18, -24, -30, -36, -42, -48];
const FADER_SCALE_DBS = [12, 6, 0, -6, -12, -24, -40, -60];

function _buildMeterEl(id, hasClip) {
  const meter = document.createElement('div');
  meter.className = 'strip-meter';

  const scale = document.createElement('div');
  scale.className = 'strip-meter-scale';
  METER_SCALE_DBS.forEach((db) => {
    const tick = document.createElement('span');
    tick.style.bottom = dbToPercent(db) + '%';
    scale.appendChild(tick);
  });

  const bar = document.createElement('div');
  bar.className = 'strip-meter-bar';
  bar.id = `vu-bar-${id}`;

  const peak = document.createElement('div');
  peak.className = 'strip-meter-peak';
  peak.id = `vu-peak-${id}`;

  const hold = document.createElement('div');
  hold.className = 'strip-meter-peak-hold';
  hold.id = `vu-hold-${id}`;

  meter.appendChild(scale);
  meter.appendChild(bar);
  meter.appendChild(peak);
  meter.appendChild(hold);

  if (hasClip) {
    const clip = document.createElement('div');
    clip.className = 'strip-clip-badge';
    clip.id = `clip-badge-${id}`;
    clip.textContent = 'CLIP';
    meter.appendChild(clip);
  }

  return meter;
}

function _buildScaleColumn(className, values, toPercent, formatter) {
  const col = document.createElement('div');
  col.className = className;
  values.forEach((db) => {
    const lbl = document.createElement('span');
    lbl.style.bottom = toPercent(db) + '%';
    lbl.textContent = formatter(db);
    col.appendChild(lbl);
  });
  return col;
}

function _buildFaderMeterWrap(meterEl, faderEl) {
  const wrap = document.createElement('div');
  wrap.className = 'mixer-fader-meter-wrap';

  const scaleCol = _buildScaleColumn(
    'strip-vu-scale',
    METER_SCALE_DBS,
    (db) => dbToPercent(db),
    (db) => (db === 0 ? '0' : String(db)),
  );
  const faderScaleCol = _buildScaleColumn(
    'strip-fader-scale',
    FADER_SCALE_DBS,
    (db) => (st.dbToSlider(db) / 1000) * 100,
    (db) => (db > 0 ? `+${db}` : String(db)),
  );

  wrap.appendChild(scaleCol);
  wrap.appendChild(meterEl);
  wrap.appendChild(faderEl);
  wrap.appendChild(faderScaleCol);
  return wrap;
}

function _buildDspRow(dsp, entityId, onDspOpen) {
  const row = document.createElement('div');
  row.className = 'strip-dsp-row';

  Object.keys(dsp).forEach(blk => {
    const block = dsp[blk];
    const colour = DSP_COLOURS[blk] ?? { bg: '#333', fg: '#fff', label: blk.toUpperCase() };
    const btn = document.createElement('button');
    btn.className = 'strip-dsp-btn';
    if (!block.enabled || block.bypassed) {
      btn.classList.add('byp');
    } else if (block.enabled && !block.bypassed) {
      btn.classList.add('dsp-active');
    }
    btn.textContent = colour.label ?? blk.toUpperCase();
    btn.title = blk.toUpperCase();
    btn.dataset.block = blk;
    btn.dataset.ch = entityId;
    btn.style.background = colour.bg;
    btn.style.color = colour.fg;
    btn.setAttribute('aria-label', `Open DSP panel for ${colour.label ?? blk.toUpperCase()} ${block.bypassed ? '(bypassed)' : block.enabled ? '' : '(disabled)'}`);
    btn.onclick = () => onDspOpen(blk, btn);
    row.appendChild(btn);
  });

  return row;
}

// Attaches dblclick + long-press (500 ms) inline-edit to a fader dB label.
// onCommit(newDb, oldDb)
function _attachFaderLabelEdit(dbLabel, faderEl, onCommit) {
  let pressTimer = null;
  let pressStartX = 0, pressStartY = 0;

  const startEdit = () => {
    const oldDb = st.sliderToDb(+faderEl.value);
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.value = isFinite(oldDb) ? oldDb.toFixed(1) : '-30';
    inp.min = -30; inp.max = 12; inp.step = 0.1;
    inp.className = 'strip-fader-entry';
    dbLabel.replaceWith(inp);
    inp.focus(); inp.select();

    const commit = () => {
      const db = Math.max(-30, Math.min(12, parseFloat(inp.value) || 0));
      faderEl.value = st.dbToSlider(db);
      dbLabel.textContent = _fmt(db);
      inp.replaceWith(dbLabel);
      onCommit(db, oldDb);
    };
    inp.onblur = commit;
    inp.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') inp.replaceWith(dbLabel);
    };
  };

  dbLabel.ondblclick = startEdit;
  dbLabel.addEventListener('pointerdown', e => {
    pressStartX = e.clientX; pressStartY = e.clientY;
    pressTimer = setTimeout(startEdit, 500);
  });
  dbLabel.addEventListener('pointerup', () => clearTimeout(pressTimer));
  dbLabel.addEventListener('pointercancel', () => clearTimeout(pressTimer));
  dbLabel.addEventListener('contextmenu', e => e.preventDefault());
  dbLabel.addEventListener('pointermove', e => {
    if (Math.hypot(e.clientX - pressStartX, e.clientY - pressStartY) > 8)
      clearTimeout(pressTimer);
  });
}

function _fmt(v) {
  if (!isFinite(v)) return '-\u221e';
  return (v >= 0 ? '+' : '') + Number(v).toFixed(1);
}

// --- public API -------------------------------------------------------------

/**
 * createStrip -- build the common mixer strip element.
 * Returns an HTMLElement; caller may append kind-specific extra children.
 *
 * @param {object} opts  see module header for full param list
 * @returns {HTMLElement}
 */
export function createStrip({
  kind,
  id,
  name,
  nameTitle,
  initDb     = 0,
  initMuted  = false,
  initSolo,
  hasSolo    = false,
  hasClip    = false,
  dsp,
  onFader,
  onFaderCommit,
  onMute,
  onMuteCommit,
  onSolo,
  onDspOpen,
}) {
  // -- root element ----------------------------------------------------------
  const strip = document.createElement('div');
  if (kind === 'output') {
    strip.className = 'mixer-output-strip';
  } else if (kind === 'bus') {
    strip.className = 'mixer-strip bus-strip';
    strip.dataset.busId = id;
  } else {
    strip.className = 'mixer-strip';
  }
  strip.id = `strip-${id}`;

  // -- name element ----------------------------------------------------------
  const titleAttr = nameTitle ?? id;
  if (kind === 'input') {
    const nameRow = document.createElement('div');
    nameRow.className = 'strip-name-row';
    const nm = document.createElement('div');
    nm.className = 'strip-name';
    nm.textContent = name ?? id;
    nm.title = titleAttr;
    nameRow.appendChild(nm);
    strip.appendChild(nameRow);
  } else if (kind === 'output') {
    const nm = document.createElement('div');
    nm.className = 'zone-master-name';
    nm.textContent = name ?? id;
    nm.title = titleAttr;
    strip.appendChild(nm);
  } else {
    const nm = document.createElement('div');
    nm.className = 'strip-name';
    nm.textContent = name ?? id;
    nm.title = titleAttr;
    strip.appendChild(nm);
  }

  // -- mute button -----------------------------------------------------------
  if (onMute) {
    const muteBtn = document.createElement('button');
    muteBtn.className = 'strip-mute-btn' + (initMuted ? ' active' : '');
    muteBtn.id = `mute-${id}`;
    // Outputs use mixed-case to visually signal state; inputs/buses always 'MUTE'
    muteBtn.textContent = kind === 'output' ? (initMuted ? 'MUTE' : 'mute') : 'MUTE';
    muteBtn.setAttribute('aria-label', `Mute ${name ?? id}`);
    muteBtn.setAttribute('aria-pressed', initMuted ? 'true' : 'false');
    muteBtn.onclick = async () => {
      const nowMuted = muteBtn.classList.contains('active');
      try {
        await onMute(nowMuted);
        const newMuted = !nowMuted;
        muteBtn.classList.toggle('active', newMuted);
        muteBtn.setAttribute('aria-pressed', newMuted ? 'true' : 'false');
        if (kind === 'output') muteBtn.textContent = newMuted ? 'MUTE' : 'mute';
        // Announce state change to screen readers
        const liveRegion = document.getElementById('sr-live-polite');
        if (liveRegion) liveRegion.textContent = `${name ?? id} mute ${newMuted ? 'on' : 'off'}`;
        onMuteCommit?.(nowMuted, newMuted);
      } catch (_) { /* caller uses toast */ }
    };
    strip.appendChild(muteBtn);
  }

  // -- solo button -----------------------------------------------------------
  if (hasSolo && onSolo) {
    const soloBtn = document.createElement('button');
    soloBtn.className = 'mixer-solo-btn';
    soloBtn.id = `solo-${id}`;
    soloBtn.textContent = 'S';
    soloBtn.title = 'Solo (PFL)';
    soloBtn.setAttribute('aria-label', `Solo ${name ?? id}`);
    soloBtn.setAttribute('aria-pressed', initSolo ? 'true' : 'false');
    if (initSolo) soloBtn.classList.add('active');
    soloBtn.onclick = async (e) => {
      try {
        await onSolo(e);
        const newSolo = soloBtn.classList.contains('active');
        soloBtn.setAttribute('aria-pressed', newSolo ? 'true' : 'false');
        // Announce state change to screen readers
        const liveRegion = document.getElementById('sr-live-polite');
        if (liveRegion) liveRegion.textContent = `${name ?? id} solo ${newSolo ? 'on' : 'off'}`;
      } catch (_) {}
    };
    strip.appendChild(soloBtn);
  }

  // -- fader + dB label (fader created first so label can reference it) -----
  const faderEl = document.createElement('input');
  faderEl.type = 'range';
  faderEl.className = 'strip-fader';
  faderEl.min = 0; faderEl.max = 1000; faderEl.step = 1;
  faderEl.value = st.dbToSlider(initDb);
  faderEl.id = `fader-${id}`;
  faderEl.setAttribute('aria-label', `${name ?? id} fader, -infinity to +12 dB`);
  faderEl.setAttribute('aria-valuemin', '-60');
  faderEl.setAttribute('aria-valuemax', '12');
  faderEl.setAttribute('aria-valuenow', _fmt(initDb));
  faderEl.addEventListener('input', () => {
    const db = st.sliderToDb(+faderEl.value);
    faderEl.setAttribute('aria-valuenow', _fmt(db));
  });

  const dbLabel = document.createElement('div');
  dbLabel.className = 'strip-fader-label strip-fader-label-editable';
  dbLabel.id = `mix-lbl-${id}`;
  dbLabel.textContent = _fmt(initDb);
  dbLabel.setAttribute('aria-hidden', 'true');
  strip.appendChild(dbLabel);

  let _ft;
  let _dragStartDb = null;

  faderEl.addEventListener('pointerdown', () => {
    _dragStartDb = st.sliderToDb(+faderEl.value);
  });

  const commitDrag = () => {
    if (_dragStartDb == null) return;
    const endDb = st.sliderToDb(+faderEl.value);
    const startDb = _dragStartDb;
    _dragStartDb = null;
    if (onFaderCommit && startDb !== endDb && !Number.isNaN(startDb) && !Number.isNaN(endDb)) {
      onFaderCommit(startDb, endDb);
    }
  };
  faderEl.addEventListener('pointerup', commitDrag);
  faderEl.addEventListener('pointercancel', commitDrag);

  faderEl.oninput = () => {
    const db = st.sliderToDb(+faderEl.value);
    dbLabel.textContent = _fmt(db);
    clearTimeout(_ft);
    _ft = setTimeout(() => onFader?.(db), 80);
  };
  _attachFaderLabelEdit(dbLabel, faderEl, (db, oldDb) => {
    onFader?.(db);
    if (onFaderCommit && oldDb !== undefined && oldDb !== db && !Number.isNaN(oldDb) && !Number.isNaN(db)) {
      onFaderCommit(oldDb, db);
    }
  });

  // -- meter + fmWrap --------------------------------------------------------
  const meterEl = _buildMeterEl(id, hasClip);
  strip.appendChild(_buildFaderMeterWrap(meterEl, faderEl));

  // -- DSP badge row ---------------------------------------------------------
  if (dsp && Object.keys(dsp).length > 0 && onDspOpen) {
    strip.appendChild(_buildDspRow(dsp, id, onDspOpen));
  }

  return strip;
}

/**
 * updateStripMeter -- animate the VU bar for a strip element.
 * @param {HTMLElement} stripEl
 * @param {number} db  signal level in dBFS
 */
export function updateStripMeter(stripEl, db) {
  const id   = stripEl.id.replace('strip-', '');
  const bar  = document.getElementById(`vu-bar-${id}`);
  const peak = document.getElementById(`vu-peak-${id}`);
  if (!bar) return;
  const pct = Math.max(0, Math.min(100, (db + 60) / 60 * 100));
  bar.style.height = pct + '%';
  if (peak) peak.style.bottom = pct + '%';
}

/**
 * updateStripFader -- programmatically move the fader and update the label.
 * @param {HTMLElement} stripEl
 * @param {number} db
 */
export function updateStripFader(stripEl, db) {
  const id    = stripEl.id.replace('strip-', '');
  const fader = stripEl.querySelector('.strip-fader');
  const label = document.getElementById(`mix-lbl-${id}`);
  if (fader) {
    fader.value = st.dbToSlider(db);
    fader.setAttribute('aria-valuenow', _fmt(db));
  }
  if (label) label.textContent = _fmt(db);
}

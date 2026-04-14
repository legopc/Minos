// mixer.js — Mixer tab
import * as st  from './state.js';
import * as api from './api.js';
import { openPanel } from './panels.js';
import { toast } from './toast.js';
import { DSP_COLOURS } from './dsp/colours.js';

let _animFrame = null;
let _soloSet = new Set();

export function render(container) {
  container.innerHTML = '';
  container.id = 'tab-mixer';

  // Scene bar
  const sceneBar = document.createElement('div');
  sceneBar.className = 'mixer-scene-bar';
  sceneBar.id = 'mixer-scene-bar';
  container.appendChild(sceneBar);
  _renderSceneBar(sceneBar);

  // Row wrapper: input strips + zone masters side by side
  const body = document.createElement('div');
  body.className = 'mixer-body';
  container.appendChild(body);

  // Strip area (input channels)
  const strips = document.createElement('div');
  strips.className = 'mixer-strips';
  strips.id = 'mixer-strips';
  body.appendChild(strips);

  // Zone masters
  const masters = document.createElement('div');
  masters.className = 'mixer-zone-masters';
  masters.id = 'mixer-masters';
  body.appendChild(masters);

  _renderStrips(strips, masters);
}

function _renderSceneBar(bar) {
  const scenes = Array.isArray(st.state.scenes)
    ? st.state.scenes.filter(s => s.is_favourite)
    : [];
  bar.innerHTML = '';
  const label = document.createElement('span');
  label.className = 'mixer-scene-label';
  label.textContent = 'Favourite Scenes:';
  bar.appendChild(label);
  if (!scenes.length) {
    const e = document.createElement('span');
    e.style.cssText = 'color:var(--text-muted);font-size:10px;';
    e.textContent = 'None starred';
    bar.appendChild(e);
  } else {
    scenes.slice(0, 8).forEach(s => {
      const btn = document.createElement('button');
      btn.className = 'mixer-scene-btn' + (s.id === st.state.activeSceneId ? ' active' : '');
      btn.textContent = s.name ?? s.id;
      btn.onclick = async () => {
        try {
          await api.loadScene(s.id);
          st.setActiveScene(s.id);
          document.querySelectorAll('.mixer-scene-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          toast(`Loaded: ${s.name}`);
        } catch(e) { toast('Load failed', true); }
      };
      bar.appendChild(btn);
    });
  }
}

function _renderStrips(strips, masters) {
  strips.innerHTML = '';
  masters.innerHTML = '';

  const channels = st.channelList();
  const outputs  = st.outputList();

  // Input strips
  channels.forEach(ch => {
    const s = _buildInputStrip(ch);
    strips.appendChild(s);
  });

  // Output master strips (one per output, replaces zone-based iteration)
  outputs.forEach(out => {
    const m = _buildOutputMaster(out);
    masters.appendChild(m);
  });
}

function _buildInputStrip(ch) {
  const strip = document.createElement('div');
  strip.className = 'mixer-strip';
  strip.id = `strip-${ch.id}`;

  // Name (double-click to rename)
  const nm = document.createElement('div');
  nm.className = 'strip-name';
  nm.textContent = ch.name ?? ch.id;
  nm.title = 'Double-click to rename';
  nm.style.cursor = 'text';
  nm.addEventListener('dblclick', () => _startRename(nm, ch));
  strip.appendChild(nm);

  // Mute button
  const muteBtn = document.createElement('button');
  muteBtn.className = 'strip-mute-btn' + (ch.enabled === false ? ' active' : '');
  muteBtn.textContent = 'MUTE';
  muteBtn.title = ch.enabled === false ? 'Unmute channel' : 'Mute channel';
  const chIdx = parseInt(ch.id.replace('rx_', ''), 10);
  muteBtn.onclick = async () => {
    const nowMuted = muteBtn.classList.contains('active');
    try {
      await api.putInputEnabled(chIdx, nowMuted); // nowMuted=true means currently muted → enable
      muteBtn.classList.toggle('active', !nowMuted);
      muteBtn.title = !nowMuted ? 'Unmute channel' : 'Mute channel';
    } catch(e) { toast(e.message, true); }
  };
  strip.appendChild(muteBtn);

  // Solo button (client-side visual dim only)
  const soloBtn = document.createElement('button');
  soloBtn.className = 'mixer-solo-btn';
  soloBtn.id = `solo-${ch.id}`;
  soloBtn.textContent = 'S';
  soloBtn.title = 'Solo';
  soloBtn.onclick = () => {
    if (_soloSet.has(ch.id)) { _soloSet.delete(ch.id); soloBtn.classList.remove('active'); }
    else { _soloSet.add(ch.id); soloBtn.classList.add('active'); }
    _applySoloVisual();
  };
  strip.appendChild(soloBtn);

  // Polarity invert (Ø) button
  const initInvert = !!(ch.dsp?.polarity?.invert);
  const polBtn = document.createElement('button');
  polBtn.className = 'mixer-polarity-btn' + (initInvert ? ' active' : '');
  polBtn.textContent = 'Ø';
  polBtn.title = 'Invert polarity';
  polBtn.dataset.invert = initInvert ? '1' : '0';
  polBtn.onclick = async () => {
    const newInvert = polBtn.dataset.invert !== '1';
    try {
      await api.putInputPolarity(chIdx, newInvert);
      polBtn.dataset.invert = newInvert ? '1' : '0';
      polBtn.classList.toggle('active', newInvert);
    } catch(e) { toast(e.message, true); }
  };
  strip.appendChild(polBtn);

  // VU meter
  const meter = document.createElement('div');
  meter.className = 'strip-meter';
  const bar = document.createElement('div');
  bar.className = 'strip-meter-bar';
  bar.id = `vu-bar-${ch.id}`;
  const peak = document.createElement('div');
  peak.className = 'strip-meter-peak';
  peak.id = `vu-peak-${ch.id}`;
  meter.appendChild(bar);
  meter.appendChild(peak);

  // Gain fader label
  const vol = st.state.channels.get(ch.id)?.input_gain_db ?? 0;
  const dbLabel = document.createElement('div');
  dbLabel.className = 'strip-fader-label';
  dbLabel.id = `mix-lbl-${ch.id}`;
  dbLabel.textContent = _db(vol);
  strip.appendChild(dbLabel);

  // Fader
  const fader = document.createElement('input');
  fader.type = 'range';
  fader.className = 'strip-fader';
  fader.min = 0; fader.max = 1000; fader.step = 1;
  fader.value = st.dbToSlider(vol);
  let fTimer;
  fader.oninput = () => {
    const db = st.sliderToDb(+fader.value);
    dbLabel.textContent = _db(db);
    clearTimeout(fTimer);
    fTimer = setTimeout(() => {
      api.putInputGain(chIdx, db).catch(e => toast(e.message, true));
    }, 80);
  };

  // Double-click dB label to type exact value
  dbLabel.ondblclick = () => {
    const curDb = st.sliderToDb(+fader.value);
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.value = isFinite(curDb) ? curDb.toFixed(1) : '-30';
    inp.min = -30; inp.max = 12; inp.step = 0.1;
    inp.className = 'strip-fader-entry';
    dbLabel.replaceWith(inp);
    inp.focus(); inp.select();
    const commit = () => {
      const db = Math.max(-30, Math.min(12, parseFloat(inp.value) || 0));
      fader.value = st.dbToSlider(db);
      dbLabel.textContent = _db(db);
      inp.replaceWith(dbLabel);
      api.putInputGain(chIdx, db).catch(e => toast(e.message, true));
    };
    inp.onblur = commit;
    inp.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') inp.replaceWith(dbLabel);
    };
  };

  // Fader + meter side by side
  const fmWrap = document.createElement('div');
  fmWrap.className = 'mixer-fader-meter-wrap';
  // Scale labels column (left of meter)
  const scaleCol = document.createElement('div');
  scaleCol.className = 'strip-vu-scale';
  [0, -6, -12, -18, -30].forEach(db => {
    const lbl = document.createElement('span');
    lbl.style.bottom = (db >= 0 ? 100 : Math.round(((db + 60) / 60) * 100)) + '%';
    lbl.textContent = db === 0 ? '0' : String(db);
    scaleCol.appendChild(lbl);
  });
  fmWrap.appendChild(scaleCol);
  fmWrap.appendChild(meter);
  fmWrap.appendChild(fader);
  strip.appendChild(fmWrap);

  // DSP badge row — spec §6.4: show only enabled+non-bypassed blocks
  const dspRow = document.createElement('div');
  dspRow.className = 'strip-dsp-row';
  const dsp = ch.dsp ?? {};
  Object.keys(dsp).forEach(blk => {
    const block = dsp[blk];
    const colour = DSP_COLOURS[blk] ?? { bg: '#333', fg: '#fff', label: blk.toUpperCase() };
    const btn = document.createElement('button');
    btn.className = 'strip-dsp-btn';
    if (!block.enabled || block.bypassed) btn.classList.add('byp');
    btn.textContent = colour.label ?? blk.toUpperCase();
    btn.title = blk.toUpperCase();
    btn.dataset.block = blk;
    btn.dataset.ch = ch.id;
    btn.style.background = colour.bg;
    btn.style.color = colour.fg;
    btn.onclick = () => openPanel(blk, ch.id, btn);
    dspRow.appendChild(btn);
  });
  strip.appendChild(dspRow);

  // Zone route buttons
  const zoneRow = document.createElement('div');
  zoneRow.className = 'strip-zone-row';
  st.zoneList().forEach((zone, zi) => {
    const color = st.getZoneColour(zone.colour_index ?? zi);
    const btn = document.createElement('button');
    btn.className = 'strip-zone-btn';
    btn.style.setProperty('--zone-card-color', color);
    btn.textContent = zone.name ?? zone.id;
    btn.dataset.active = _hasZoneRoute(ch.id, zone) ? '1' : '0';
    if (btn.dataset.active === '1') btn.classList.add('active');
    btn.onclick = async () => {
      const active = btn.dataset.active === '1';
      try {
        if (active) {
          for (const txId of (zone.tx_ids ?? [])) {
            await api.deleteRoute(`${ch.id}|${txId}`);
            st.removeRoute(ch.id, txId);
          }
        } else {
          for (const txId of (zone.tx_ids ?? [])) {
            const r = await api.postRoute(ch.id, txId, 'local');
            st.setRoute({ route_type: 'dante', ...r });
          }
        }
        btn.dataset.active = active ? '0' : '1';
        btn.classList.toggle('active', btn.dataset.active === '1');
      } catch(e) { toast(e.message, true); }
    };
    zoneRow.appendChild(btn);
  });
  strip.appendChild(zoneRow);

  return strip;
}

function _buildOutputMaster(out) {
  const txIdx = parseInt(out.id.replace('tx_', ''), 10);
  const color = st.getZoneColour(out.zone_colour_index ?? 0);

  const strip = document.createElement('div');
  strip.className = 'mixer-output-strip';
  strip.id = `strip-${out.id}`;
  strip.style.setProperty('--zone-card-color', color);

  // Name
  const nm = document.createElement('div');
  nm.className = 'zone-master-name';
  nm.textContent = out.name ?? out.id;
  nm.title = out.id + (out.zone_id ? ` (${out.zone_id})` : '');
  strip.appendChild(nm);

  // Mute button — reads live state from st.state.outputs
  const muteBtn = document.createElement('button');
  const curOut = st.state.outputs.get(out.id);
  const initMuted = curOut?.muted ?? false;
  muteBtn.className = 'strip-mute-btn' + (initMuted ? ' active' : '');
  muteBtn.textContent = initMuted ? 'MUTE' : 'mute';
  muteBtn.onclick = async () => {
    const liveOut = st.state.outputs.get(out.id);
    const nowMuted = liveOut?.muted ?? false;
    const newMuted = !nowMuted;
    try {
      await api.putOutputMute(txIdx, newMuted);
      st.setOutput({ ...liveOut, muted: newMuted });
      muteBtn.classList.toggle('active', newMuted);
      muteBtn.textContent = newMuted ? 'MUTE' : 'mute';
    } catch(e) { toast(e.message, true); }
  };
  strip.appendChild(muteBtn);

  // Volume label
  const vol = curOut?.volume_db ?? out.volume_db ?? 0;
  const volLabel = document.createElement('div');
  volLabel.className = 'strip-fader-label';
  volLabel.id = `mix-lbl-${out.id}`;
  volLabel.textContent = _db(vol);
  strip.appendChild(volLabel);

  // VU meter
  const meter = document.createElement('div');
  meter.className = 'strip-meter';
  const bar = document.createElement('div');
  bar.className = 'strip-meter-bar';
  bar.id = `vu-bar-${out.id}`;
  const peak = document.createElement('div');
  peak.className = 'strip-meter-peak';
  peak.id = `vu-peak-${out.id}`;
  meter.appendChild(bar);
  meter.appendChild(peak);

  // Fader
  const fader = document.createElement('input');
  fader.type = 'range';
  fader.className = 'strip-fader';
  fader.min = 0; fader.max = 1000; fader.step = 1;
  fader.value = st.dbToSlider(vol);
  let ft;
  fader.oninput = () => {
    const db = st.sliderToDb(+fader.value);
    volLabel.textContent = _db(db);
    clearTimeout(ft);
    ft = setTimeout(async () => {
      try {
        await api.putOutputGain(txIdx, db);
        const liveOut = st.state.outputs.get(out.id);
        if (liveOut) st.setOutput({ ...liveOut, volume_db: db });
      } catch(e) { toast(e.message, true); }
    }, 80);
  };

  // Fader + meter side by side
  const fmWrap = document.createElement('div');
  fmWrap.className = 'mixer-fader-meter-wrap';
  const scaleColOut = document.createElement('div');
  scaleColOut.className = 'strip-vu-scale';
  [0, -6, -12, -18, -30].forEach(db => {
    const lbl = document.createElement('span');
    lbl.style.bottom = (db >= 0 ? 100 : Math.round(((db + 60) / 60) * 100)) + '%';
    lbl.textContent = db === 0 ? '0' : String(db);
    scaleColOut.appendChild(lbl);
  });
  fmWrap.appendChild(scaleColOut);
  fmWrap.appendChild(meter);
  fmWrap.appendChild(fader);
  strip.appendChild(fmWrap);

  // DSP badge row
  const dspRow = document.createElement('div');
  dspRow.className = 'strip-dsp-row';
  const outDsp = out.dsp ?? curOut?.dsp ?? {};
  Object.keys(outDsp).forEach(blk => {
    const block = outDsp[blk];
    const colour = DSP_COLOURS[blk] ?? { bg: '#333', fg: '#fff', label: blk.toUpperCase() };
    const btn = document.createElement('button');
    btn.className = 'strip-dsp-btn';
    if (!block.enabled || block.bypassed) btn.classList.add('byp');
    btn.textContent = colour.label ?? blk.toUpperCase();
    btn.title = blk.toUpperCase();
    btn.dataset.block = blk;
    btn.dataset.ch = out.id;
    btn.style.background = colour.bg;
    btn.style.color = colour.fg;
    btn.onclick = () => openPanel(blk, out.id, btn);
    dspRow.appendChild(btn);
  });
  strip.appendChild(dspRow);

  return strip;
}

export function updateMetering(rx, tx) {
  if (!rx && !tx) return;
  const update = (map) => {
    if (!map) return;
    Object.entries(map).forEach(([id, db]) => {
      const bar  = document.getElementById(`vu-bar-${id}`);
      const peak = document.getElementById(`vu-peak-${id}`);
      if (!bar) return;
      const pct = Math.max(0, Math.min(100, (db + 60) / 60 * 100));
      bar.style.height = pct + '%';
      if (peak) {
        peak.style.bottom = pct + '%';
      }
    });
  };
  update(rx);
  update(tx);
}

function _hasZoneRoute(rxId, zone) {
  return (zone.tx_ids ?? []).some(txId => st.hasRoute(rxId, txId));
}

function _db(v) { if (!isFinite(v)) return '-∞'; return (v>=0?'+':'')+Number(v).toFixed(1); }

function _applySoloVisual() {
  const strips = document.querySelectorAll('.mixer-strip');
  if (_soloSet.size === 0) {
    strips.forEach(s => s.classList.remove('solo-dimmed'));
  } else {
    strips.forEach(s => {
      const id = s.id.replace('strip-', '');
      s.classList.toggle('solo-dimmed', !_soloSet.has(id));
    });
  }
}

// ── Inline channel rename ──────────────────────────────────────────────────
function _startRename(nameEl, ch) {
  const prev = nameEl.textContent;
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = prev;
  inp.className = 'strip-rename-input';
  nameEl.textContent = '';
  nameEl.appendChild(inp);
  inp.focus();
  inp.select();

  const commit = async () => {
    const next = inp.value.trim() || prev;
    nameEl.textContent = next;
    if (next === prev) return;
    try {
      await api.putChannel(ch.id, { name: next });
      // Update state
      const cur = st.state.channels.get(ch.id);
      if (cur) st.setChannel({ ...cur, name: next });
      // Update matrix DOM if rendered
      document.querySelectorAll(`.ch-label[data-ch-id="${ch.id}"] .ch-name`).forEach(el => {
        el.textContent = next;
        el.title = next;
      });
      toast(`Renamed to "${next}"`);
    } catch (e) {
      nameEl.textContent = prev;
      toast('Rename failed: ' + e.message, true);
    }
  };

  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
    if (e.key === 'Escape') { inp.removeEventListener('blur', commit); nameEl.textContent = prev; }
  });
}

// mixer.js — Mixer tab
import * as st  from './state.js';
import * as api from './api.js';
import { openPanel } from './panels.js';
import { toast } from './main.js';

let _animFrame = null;

export function render(container) {
  container.innerHTML = '';
  container.id = 'tab-mixer';

  // Scene bar
  const sceneBar = document.createElement('div');
  sceneBar.className = 'mixer-scene-bar';
  sceneBar.id = 'mixer-scene-bar';
  container.appendChild(sceneBar);
  _renderSceneBar(sceneBar);

  // Meter bridge (TX peak readout row)
  const bridge = document.createElement('div');
  bridge.className = 'mixer-meter-bridge';
  bridge.id = 'mixer-bridge';
  container.appendChild(bridge);

  // Strip area
  const strips = document.createElement('div');
  strips.className = 'mixer-strips';
  strips.id = 'mixer-strips';
  container.appendChild(strips);

  // Zone masters
  const masters = document.createElement('div');
  masters.className = 'mixer-zone-masters';
  masters.id = 'mixer-masters';
  container.appendChild(masters);

  _renderStrips(strips, bridge, masters);
}

function _renderSceneBar(bar) {
  const scenes = st.state.scenes.filter(s => s.is_favourite);
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

function _renderStrips(strips, bridge, masters) {
  strips.innerHTML = '';
  bridge.innerHTML = '';
  masters.innerHTML = '';

  const channels = st.channelList();
  const outputs  = st.outputList();
  const zones    = st.zoneList();

  // Input strips
  channels.forEach(ch => {
    const s = _buildInputStrip(ch);
    strips.appendChild(s);
    // Bridge meter cell
    const bc = document.createElement('div');
    bc.className = 'bridge-cell';
    bc.dataset.meterId = ch.id;
    bridge.appendChild(bc);
  });

  // Spacer in bridge
  const spacer = document.createElement('div');
  spacer.className = 'bridge-spacer';
  bridge.appendChild(spacer);

  // Zone master strips
  zones.forEach((zone, zi) => {
    const m = _buildZoneMaster(zone, zi);
    masters.appendChild(m);
    // Zone bridge
    const bc = document.createElement('div');
    bc.className = 'bridge-cell bridge-zone';
    bc.style.setProperty('--zone-card-color', st.getZoneColour(zone.colour_index ?? zi));
    bridge.appendChild(bc);
  });
}

function _buildInputStrip(ch) {
  const strip = document.createElement('div');
  strip.className = 'mixer-strip';
  strip.id = `strip-${ch.id}`;

  // Name
  const nm = document.createElement('div');
  nm.className = 'strip-name';
  nm.textContent = ch.name ?? ch.id;
  nm.title = ch.id;
  strip.appendChild(nm);

  // VU meter
  const meter = document.createElement('div');
  meter.className = 'strip-meter';
  const bar = document.createElement('div');
  bar.className = 'strip-meter-bar';
  bar.id = `mix-m-${ch.id}`;
  const peak = document.createElement('div');
  peak.className = 'strip-meter-peak';
  peak.id = `mix-p-${ch.id}`;
  meter.appendChild(bar);
  meter.appendChild(peak);
  strip.appendChild(meter);

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
      api.putChannel(ch.id, { input_gain_db: db }).catch(e => toast(e.message, true));
    }, 80);
  };
  strip.appendChild(fader);

  // DSP badge row
  const dspRow = document.createElement('div');
  dspRow.className = 'strip-dsp-row';
  ['am', 'hpf', 'lpf', 'peq', 'gte', 'cmp'].forEach(blk => {
    const btn = document.createElement('button');
    btn.className = 'strip-dsp-btn';
    btn.textContent = _blkLabel(blk);
    btn.title = blk.toUpperCase();
    btn.dataset.block = blk;
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
            st.setRoute(r);
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

function _buildZoneMaster(zone, zi) {
  const color = st.getZoneColour(zone.colour_index ?? zi);
  const strip = document.createElement('div');
  strip.className = 'mixer-zone-master';
  strip.style.setProperty('--zone-card-color', color);

  const nm = document.createElement('div');
  nm.className = 'zone-master-name';
  nm.textContent = zone.name ?? zone.id;
  strip.appendChild(nm);

  // Meter
  const meter = document.createElement('div');
  meter.className = 'strip-meter';
  const bar = document.createElement('div');
  bar.className = 'strip-meter-bar';
  // Use first tx_id meter
  const firstTx = zone.tx_ids?.[0];
  if (firstTx) bar.id = `mix-m-${firstTx}`;
  const peak = document.createElement('div');
  peak.className = 'strip-meter-peak';
  if (firstTx) peak.id = `mix-p-${firstTx}`;
  meter.appendChild(bar);
  meter.appendChild(peak);
  strip.appendChild(meter);

  // Volume
  const txOutputs = (zone.tx_ids ?? []).map(id => st.state.outputs.get(id)).filter(Boolean);
  const avgVol = txOutputs.length ? txOutputs.reduce((a,o) => a + (o.volume_db ?? 0), 0) / txOutputs.length : 0;
  const volLabel = document.createElement('div');
  volLabel.className = 'strip-fader-label';
  volLabel.textContent = _db(avgVol);
  strip.appendChild(volLabel);

  const fader = document.createElement('input');
  fader.type = 'range';
  fader.className = 'strip-fader';
  fader.min = 0; fader.max = 1000; fader.step = 1;
  fader.value = st.dbToSlider(avgVol);
  let ft;
  fader.oninput = () => {
    const db = st.sliderToDb(+fader.value);
    volLabel.textContent = _db(db);
    clearTimeout(ft);
    ft = setTimeout(async () => {
      for (const txId of (zone.tx_ids ?? [])) {
        try { await api.putOutput(txId, { volume_db: db }); } catch(_){}
      }
    }, 80);
  };
  strip.appendChild(fader);

  // Mute
  const muteBtn = document.createElement('button');
  muteBtn.className = 'strip-mute-btn' + (zone.muted ? ' muted' : '');
  muteBtn.textContent = zone.muted ? 'MUTE' : 'mute';
  muteBtn.onclick = async () => {
    const nm = !zone.muted;
    try {
      for (const txId of (zone.tx_ids ?? [])) {
        await api.putOutputMute(txId, nm);
      }
      zone.muted = nm;
      muteBtn.className = 'strip-mute-btn' + (nm ? ' muted' : '');
      muteBtn.textContent = nm ? 'MUTE' : 'mute';
    } catch(e) { toast(e.message, true); }
  };
  strip.appendChild(muteBtn);

  // DSP badge row (output DSP)
  const dspRow = document.createElement('div');
  dspRow.className = 'strip-dsp-row';
  ['am', 'hpf', 'lpf', 'peq', 'cmp', 'lim', 'dly'].forEach(blk => {
    const btn = document.createElement('button');
    btn.className = 'strip-dsp-btn';
    btn.textContent = _blkLabel(blk);
    btn.title = blk.toUpperCase();
    // Use first tx_id for DSP
    if (firstTx) btn.onclick = () => openPanel(blk, firstTx, btn);
    dspRow.appendChild(btn);
  });
  strip.appendChild(dspRow);

  return strip;
}

export function updateMetering(rx, tx) {
  if (!rx && !tx) return;
  const update = (map, prefix) => {
    if (!map) return;
    Object.entries(map).forEach(([id, db]) => {
      const bar  = document.getElementById(`${prefix}-m-${id}`);
      const peak = document.getElementById(`${prefix}-p-${id}`);
      if (!bar) return;
      const pct = Math.max(0, Math.min(100, (db + 60) / 60 * 100));
      bar.style.height = pct + '%';
      if (peak) {
        peak.style.bottom = pct + '%';
      }
    });
  };
  update(rx, 'mix');
  update(tx, 'mix');
}

function _hasZoneRoute(rxId, zone) {
  return (zone.tx_ids ?? []).some(txId => st.hasRoute(rxId, txId));
}

function _blkLabel(blk) {
  const m = { am:'POL', hpf:'HPF', lpf:'LPF', peq:'EQ', gte:'GATE', cmp:'COMP', lim:'LIM', dly:'DLY', duc:'DUC', aec:'AEC', flt:'FLT' };
  return m[blk] ?? blk.toUpperCase();
}

function _db(v) { if (!isFinite(v)) return '-∞'; return (v>=0?'+':'')+Number(v).toFixed(1); }

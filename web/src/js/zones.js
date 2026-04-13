// zones.js — Zones tab
import * as st  from './state.js';
import * as api from './api.js';
import { toast } from './toast.js';

export function render(container) {
  container.innerHTML = '';
  container.id = 'tab-zones';

  const toolbar = document.createElement('div');
  toolbar.className = 'zones-toolbar';
  toolbar.innerHTML = `<span style="flex:1;font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em">Zones</span>`;
  container.appendChild(toolbar);

  const grid = document.createElement('div');
  grid.className = 'zones-grid';
  grid.id = 'zones-grid';
  container.appendChild(grid);

  _renderCards(grid);
}

function _renderCards(grid) {
  grid.innerHTML = '';
  const zones = st.zoneList();
  if (!zones.length) {
    grid.innerHTML = '<div style="padding:24px;color:var(--text-muted);font-size:10px;">No zones configured.</div>';
    return;
  }
  zones.forEach(zone => grid.appendChild(_buildCard(zone)));
}

function _buildCard(zone) {
  const colour = st.getZoneColour(zone.colour_index ?? 0);
  const card = document.createElement('div');
  card.className = 'zone-card';
  card.style.setProperty('--zone-card-color', colour);

  const hdr = document.createElement('div');
  hdr.className = 'zone-card-header';
  hdr.innerHTML = `<span class="zone-card-name">${_e(zone.name ?? zone.id)}</span>`;
  card.appendChild(hdr);

  // Determine initial mute state: muted if ALL tx outputs are muted
  const txOutputs = (zone.tx_ids ?? []).map(id => st.state.outputs.get(id)).filter(Boolean);
  const isMuted = txOutputs.length > 0 && txOutputs.every(o => o.muted === true);

  const muteBtn = document.createElement('button');
  muteBtn.className = 'zone-mute-btn' + (isMuted ? ' active' : '');
  muteBtn.textContent = isMuted ? 'UNMUTE' : 'MUTE';
  hdr.appendChild(muteBtn);

  muteBtn.onclick = async () => {
    const nowMuted = muteBtn.classList.contains('active');
    const txIndices = (zone.tx_ids ?? []).map(id => parseInt(id.replace('tx_', ''), 10));
    try {
      for (const idx of txIndices) {
        if (nowMuted) {
          await api.unmuteZone(idx);
        } else {
          await api.muteZone(idx);
        }
      }
      muteBtn.classList.toggle('active', !nowMuted);
      muteBtn.textContent = !nowMuted ? 'UNMUTE' : 'MUTE';
    } catch(e) { toast('Mute error: ' + e.message, true); }
  };

  // Source selector
  const srcLabel = document.createElement('div');
  srcLabel.className = 'zone-card-label';
  srcLabel.textContent = 'Source';
  card.appendChild(srcLabel);

  const srcSel = document.createElement('select');
  srcSel.className = 'zone-source-sel';
  const noneOpt = document.createElement('option');
  noneOpt.value = ''; noneOpt.textContent = '— none —';
  srcSel.appendChild(noneOpt);
  st.channelList().forEach(ch => {
    const o = document.createElement('option');
    o.value = ch.id;
    o.textContent = ch.name ?? ch.id;
    srcSel.appendChild(o);
  });
  // Determine current source by checking routes
  const zoneRoutes = st.routeList().filter(r => (zone.tx_ids ?? []).includes(r.tx_id));
  if (zoneRoutes.length) srcSel.value = zoneRoutes[0].rx_id;
  srcSel.onchange = async () => {
    const rxId = srcSel.value;
    try {
      // Clear existing zone routes then add new
      await api.deleteRoutesByZone(zone.id);
      st.routeList().filter(r => (zone.tx_ids??[]).includes(r.tx_id)).forEach(r => st.removeRoute(r.rx_id, r.tx_id));
      if (rxId) {
        for (const txId of (zone.tx_ids ?? [])) {
          const route = await api.postRoute(rxId, txId, 'local');
          st.setRoute(route);
        }
      }
    } catch(e) { toast('Zone route error: ' + e.message, true); }
  };
  card.appendChild(srcSel);

  // Volume slider
  const volLabel = document.createElement('div');
  volLabel.className = 'zone-card-label';
  volLabel.textContent = 'Volume';
  card.appendChild(volLabel);

  // Get average volume from zone tx outputs
  const txOutputs = (zone.tx_ids ?? []).map(id => st.state.outputs.get(id)).filter(Boolean);
  const avgVol = txOutputs.length ? txOutputs.reduce((a,o) => a + (o.volume_db ?? 0), 0) / txOutputs.length : 0;
  const volDbEl = document.createElement('span');
  volDbEl.className = 'zone-vol-db';
  volDbEl.textContent = _db(avgVol);

  const volRow = document.createElement('div');
  volRow.className = 'zone-vol-row';
  const volS = document.createElement('input');
  volS.type = 'range'; volS.className = 'zone-vol-slider';
  volS.min = 0; volS.max = 1000; volS.step = 1;
  volS.value = st.dbToSlider(avgVol);
  let volTimer;
  volS.oninput = () => {
    const db = st.sliderToDb(+volS.value);
    volDbEl.textContent = _db(db);
    clearTimeout(volTimer);
    volTimer = setTimeout(async () => {
      for (const txId of (zone.tx_ids ?? [])) {
        try { await api.putOutput(txId, { volume_db: db }); } catch(_) {}
      }
    }, 100);
  };
  volRow.appendChild(volS);
  volRow.appendChild(volDbEl);
  card.appendChild(volRow);

  // TX chips
  if (zone.tx_ids?.length) {
    const chips = document.createElement('div');
    chips.className = 'zone-tx-list';
    zone.tx_ids.forEach(id => {
      const out = st.state.outputs.get(id);
      const chip = document.createElement('span');
      chip.className = 'zone-tx-chip';
      chip.textContent = out?.name ?? id;
      chips.appendChild(chip);
    });
    card.appendChild(chips);
  }

  return card;
}

function _e(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function _db(v) { if (!isFinite(v)) return '-\u221e'; return (v>=0?'+':'')+Number(v).toFixed(1)+' dB'; }

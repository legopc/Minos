// zones.js — Zones tab
import * as st  from './state.js';
import * as api from './api.js';
import { toast } from './toast.js';
import { buildOutputMaster } from './mixer.js';
import { makeReorderable, applyOrder, saveOrder } from './reorder.js';
import { undo } from './undo.js';

let _container = null;

export function render(container) {
  _container = container;
  _showGrid();
}

function _showGrid() {
  _container.innerHTML = '';
  _container.id = 'tab-zones';

  const toolbar = document.createElement('div');
  toolbar.className = 'zones-toolbar';
  toolbar.innerHTML = `<span style="flex:1;font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em">Zones</span>`;
  _container.appendChild(toolbar);

  const grid = document.createElement('div');
  grid.className = 'zones-grid';
  grid.id = 'zones-grid';
  _container.appendChild(grid);

  _renderCards(grid);
}

function _showZonePanel(zone) {
  _container.innerHTML = '';
  _container.id = 'tab-zones';

  const colour = st.getZoneColour(zone.colour_index ?? 0);

  // Header bar
  const header = document.createElement('div');
  header.className = 'zones-toolbar zone-panel-header';
  header.style.setProperty('--zone-card-color', colour);

  const backBtn = document.createElement('button');
  backBtn.className = 'zone-panel-back-btn';
  backBtn.textContent = '← Zones';
  backBtn.onclick = () => _showGrid();
  header.appendChild(backBtn);

  const title = document.createElement('span');
  title.className = 'zone-panel-title';
  title.textContent = zone.name ?? zone.id;
  header.appendChild(title);

  // Zone-level mute
  const txOutputs = (zone.tx_ids ?? []).map(id => st.state.outputs.get(id)).filter(Boolean);
  const allMuted = txOutputs.length > 0 && txOutputs.every(o => o.muted === true);
  const muteAll = document.createElement('button');
  muteAll.className = 'zone-mute-btn' + (allMuted ? ' active' : '');
  muteAll.textContent = allMuted ? 'UNMUTE ALL' : 'MUTE ALL';
  muteAll.onclick = async () => {
    const wasMuted = muteAll.classList.contains('active');
    const willMute = !wasMuted;
    const txIds = zone.tx_ids ?? [];
    const txIndices = txIds.map(id => parseInt(id.replace('tx_', ''), 10));
    try {
      for (const idx of txIndices) {
        willMute ? await api.muteZone(idx) : await api.unmuteZone(idx);
      }
      txIds.forEach(id => {
        const o = st.state.outputs.get(id);
        if (o) st.setOutput({ ...o, muted: willMute });
      });

      muteAll.classList.toggle('active', willMute);
      muteAll.textContent = willMute ? 'UNMUTE ALL' : 'MUTE ALL';

      undo.push({
        label: `${willMute ? 'Mute' : 'Unmute'} zone "${zone.name ?? zone.id}"`,
        apply: async () => {
          for (const idx of txIndices) {
            willMute ? await api.muteZone(idx) : await api.unmuteZone(idx);
          }
          txIds.forEach(id => {
            const o = st.state.outputs.get(id);
            if (o) st.setOutput({ ...o, muted: willMute });
          });
        },
        revert: async () => {
          for (const idx of txIndices) {
            wasMuted ? await api.muteZone(idx) : await api.unmuteZone(idx);
          }
          txIds.forEach(id => {
            const o = st.state.outputs.get(id);
            if (o) st.setOutput({ ...o, muted: wasMuted });
          });
        },
      });
    } catch(e) { toast('Mute error: ' + e.message, true); }
  };
  header.appendChild(muteAll);

  _container.appendChild(header);

  // Strips area — output mixer strips for each tx in this zone
  const stripsWrap = document.createElement('div');
  stripsWrap.className = 'zone-panel-strips';
  _container.appendChild(stripsWrap);

  const txIds = zone.tx_ids ?? [];
  if (!txIds.length) {
    stripsWrap.innerHTML = '<div style="padding:24px;color:var(--text-muted);font-size:10px;">No outputs in this zone.</div>';
  } else {
    txIds.forEach(txId => {
      const out = st.state.outputs.get(txId);
      if (!out) return;
      stripsWrap.appendChild(buildOutputMaster(out));
    });
  }
}

function _renderCards(grid) {
  grid.innerHTML = '';
  const zonesRaw = st.zoneList();
  if (!zonesRaw.length) {
    grid.innerHTML = '<div style="padding:24px;color:var(--text-muted);font-size:10px;">No zones configured.</div>';
    return;
  }
  applyOrder('zones', zonesRaw, z => z.id).forEach(zone => grid.appendChild(_buildCard(zone)));
  makeReorderable(grid, {
    itemSelector: '.zone-card',
    orientation:  'vertical',
    getId:        el => el.dataset.zoneId,
    onReorder:    ids => saveOrder('zones', ids),
  });
}

function _buildCard(zone) {
  const colour = st.getZoneColour(zone.colour_index ?? 0);
  const card = document.createElement('div');
  card.className = 'zone-card';
  card.dataset.zoneId = zone.id;
  card.style.setProperty('--zone-card-color', colour);

  const hdr = document.createElement('div');
  hdr.className = 'zone-card-header';

  const nameBtn = document.createElement('button');
  nameBtn.className = 'zone-card-name zone-card-name-btn';
  nameBtn.textContent = zone.name ?? zone.id;
  nameBtn.title = 'Open zone panel';
  nameBtn.onclick = () => _showZonePanel(zone);
  hdr.appendChild(nameBtn);

  card.appendChild(hdr);

  // Determine initial mute state: muted if ALL tx outputs are muted
  const muteTxOutputs = (zone.tx_ids ?? []).map(id => st.state.outputs.get(id)).filter(Boolean);
  const isMuted = muteTxOutputs.length > 0 && muteTxOutputs.every(o => o.muted === true);

  const muteBtn = document.createElement('button');
  muteBtn.className = 'zone-mute-btn' + (isMuted ? ' active' : '');
  muteBtn.textContent = isMuted ? 'UNMUTE' : 'MUTE';
  hdr.appendChild(muteBtn);

  muteBtn.onclick = async (e) => {
    e.stopPropagation();
    const wasMuted = muteBtn.classList.contains('active');
    const willMute = !wasMuted;
    const txIds = zone.tx_ids ?? [];
    const txIndices = txIds.map(id => parseInt(id.replace('tx_', ''), 10));
    try {
      for (const idx of txIndices) {
        willMute ? await api.muteZone(idx) : await api.unmuteZone(idx);
      }
      txIds.forEach(id => {
        const o = st.state.outputs.get(id);
        if (o) st.setOutput({ ...o, muted: willMute });
      });

      muteBtn.classList.toggle('active', willMute);
      muteBtn.textContent = willMute ? 'UNMUTE' : 'MUTE';

      undo.push({
        label: `${willMute ? 'Mute' : 'Unmute'} zone "${zone.name ?? zone.id}"`,
        apply: async () => {
          for (const idx of txIndices) {
            willMute ? await api.muteZone(idx) : await api.unmuteZone(idx);
          }
          txIds.forEach(id => {
            const o = st.state.outputs.get(id);
            if (o) st.setOutput({ ...o, muted: willMute });
          });
        },
        revert: async () => {
          for (const idx of txIndices) {
            wasMuted ? await api.muteZone(idx) : await api.unmuteZone(idx);
          }
          txIds.forEach(id => {
            const o = st.state.outputs.get(id);
            if (o) st.setOutput({ ...o, muted: wasMuted });
          });
        },
      });
    } catch(e) { toast('Mute error: ' + e.message, true); }
  };

  // Input selector
  const srcLabel = document.createElement('div');
  srcLabel.className = 'zone-card-label';
  srcLabel.textContent = 'Input';
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
  const zoneRoutes = st.routeList().filter(r => (zone.tx_ids ?? []).includes(r.tx_id));
  if (zoneRoutes.length) srcSel.value = zoneRoutes[0].rx_id;
  srcSel.onchange = async () => {
    const rxId = srcSel.value;
    const prevRoutes = st.routeList().filter(r => (zone.tx_ids ?? []).includes(r.tx_id))
      .map(r => ({ rx_id: r.rx_id, tx_id: r.tx_id, route_type: r.route_type }));

    try {
      await api.deleteRoutesByZone(zone.id);
      st.routeList().filter(r => (zone.tx_ids ?? []).includes(r.tx_id)).forEach(r => st.removeRoute(r.rx_id, r.tx_id));
      if (rxId) {
        for (const txId of (zone.tx_ids ?? [])) {
          const route = await api.postRoute(rxId, txId, 'local');
          st.setRoute(route);
        }
      }

      undo.push({
        label: `Zone input: ${zone.name ?? zone.id}`,
        apply: async () => {
          await api.deleteRoutesByZone(zone.id);
          st.routeList().filter(r => (zone.tx_ids ?? []).includes(r.tx_id)).forEach(r => st.removeRoute(r.rx_id, r.tx_id));
          if (rxId) {
            for (const txId of (zone.tx_ids ?? [])) {
              const route = await api.postRoute(rxId, txId, 'local');
              st.setRoute(route);
            }
          }
        },
        revert: async () => {
          await api.deleteRoutesByZone(zone.id);
          st.routeList().filter(r => (zone.tx_ids ?? []).includes(r.tx_id)).forEach(r => st.removeRoute(r.rx_id, r.tx_id));
          for (const r of prevRoutes) {
            const route = await api.postRoute(r.rx_id, r.tx_id, r.route_type === 'bus' ? 'bus' : 'local');
            st.setRoute(route);
          }
        },
      });
    } catch(e) { toast('Zone route error: ' + e.message, true); }
  };
  card.appendChild(srcSel);

  // Volume slider
  const volLabel = document.createElement('div');
  volLabel.className = 'zone-card-label';
  volLabel.textContent = 'Volume';
  card.appendChild(volLabel);

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
  let volStart = null; // [{id, volume_db}]

  volS.addEventListener('pointerdown', () => {
    volStart = (zone.tx_ids ?? []).map(id => ({ id, volume_db: st.state.outputs.get(id)?.volume_db ?? 0 }));
  });

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

  volS.addEventListener('pointerup', async () => {
    if (!volStart) return;
    const endDb = st.sliderToDb(+volS.value);
    clearTimeout(volTimer);

    try {
      for (const txId of (zone.tx_ids ?? [])) {
        await api.putOutput(txId, { volume_db: endDb });
        const o = st.state.outputs.get(txId);
        if (o) st.setOutput({ ...o, volume_db: endDb });
      }

      const prev = volStart;
      volStart = null;

      undo.push({
        label: `Zone volume: ${zone.name ?? zone.id}`,
        apply: async () => {
          for (const txId of (zone.tx_ids ?? [])) {
            await api.putOutput(txId, { volume_db: endDb });
            const o = st.state.outputs.get(txId);
            if (o) st.setOutput({ ...o, volume_db: endDb });
          }
        },
        revert: async () => {
          for (const p of prev) {
            await api.putOutput(p.id, { volume_db: p.volume_db });
            const o = st.state.outputs.get(p.id);
            if (o) st.setOutput({ ...o, volume_db: p.volume_db });
          }
        },
      });
    } catch (e) {
      volStart = null;
      toast('Zone volume error: ' + e.message, true);
    }
  });
  volRow.appendChild(volS);
  volRow.appendChild(volDbEl);
  card.appendChild(volRow);

  // TX output chips
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

// scenes.js — Scenes tab
import * as st  from './state.js';
import * as api from './api.js';
import { toast } from './toast.js';
import { confirmModal, inputModal } from './modal.js';
import { undo } from './undo.js';

export async function render(container) {
  container.innerHTML = '';
  container.id = 'tab-scenes';

  const layout = document.createElement('div');
  layout.className = 'scenes-layout';
  container.appendChild(layout);

  // Left: scene list
  const listPanel = document.createElement('div');
  listPanel.className = 'scenes-list-panel';
  layout.appendChild(listPanel);

  // Right: diff panel
  const diffPanel = document.createElement('div');
  diffPanel.className = 'scenes-diff-panel';
  diffPanel.id = 'scenes-diff';
  diffPanel.innerHTML = '<div class="scenes-diff-empty">Select a scene to view diff</div>';
  layout.appendChild(diffPanel);

  _renderList(listPanel, diffPanel);

  // Save current button
  const toolbar = document.createElement('div');
  toolbar.className = 'scenes-toolbar';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn-accent';
  saveBtn.textContent = 'Save Current State';
  saveBtn.onclick = () => {
    inputModal({
      title: 'Save Scene',
      placeholder: 'Scene name',
      confirmLabel: 'Save',
      onConfirm: async (name) => {
        const sceneId = String(name ?? '').trim();
        if (!sceneId) return;
        try {
          await api.postScene(sceneId);
          await _refreshScenes();
          _renderList(listPanel, diffPanel);
          toast('Scene saved');

          undo.push({
            label: `Save scene "${sceneId}"`,
            apply: async () => {
              await api.postScene(sceneId);
              await _refreshScenes();
            },
            revert: async () => {
              await api.deleteScene(sceneId);
              await _refreshScenes();
            },
          });

        } catch(e) { toast('Save failed: ' + e.message, true); }
      },
    });
  };
  toolbar.appendChild(saveBtn);

  // Crossfade time control
  const xfLabel = document.createElement('label');
  xfLabel.className = 'scenes-xf-label';
  xfLabel.textContent = 'Crossfade:';
  toolbar.appendChild(xfLabel);

  const xfSelect = document.createElement('select');
  xfSelect.className = 'scenes-xf-select';
  [
    { label: 'Instant', value: 0 },
    { label: '100ms',   value: 100 },
    { label: '250ms',   value: 250 },
    { label: '500ms',   value: 500 },
    { label: '1s',      value: 1000 },
    { label: '2s',      value: 2000 },
  ].forEach(({ label, value }) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    xfSelect.appendChild(opt);
  });
  // Read current system crossfade if available
  xfSelect.value = st.state.system?.scene_crossfade_ms ?? 0;
  xfSelect.onchange = async () => {
    try {
      await api.putSystemConfig({ scene_crossfade_ms: Number(xfSelect.value) });
      if (st.state.system) st.state.system.scene_crossfade_ms = Number(xfSelect.value);
    } catch(e) { toast('Crossfade update failed: ' + e.message, true); }
  };
  toolbar.appendChild(xfSelect);

  container.insertBefore(toolbar, layout);
}

function _renderList(listPanel, diffPanel) {
  listPanel.innerHTML = '';
  const scenes = st.state.scenes;
  if (!scenes.length) {
    listPanel.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:10px;">No scenes saved.</div>';
    return;
  }

  scenes.forEach(scene => {
    const id = _sceneId(scene);
    const isActive = id === st.state.activeSceneId;

    const card = document.createElement('div');
    card.className = 'scene-card' + (isActive ? ' scene-card-active' : '');

    const hdr = document.createElement('div');
    hdr.className = 'scene-card-header';

    const nameEl = document.createElement('span');
    nameEl.className = 'scene-name';
    nameEl.textContent = scene.name ?? id;
    nameEl.title = 'Double-click to rename';
    nameEl.addEventListener('dblclick', () => {
      inputModal({
        title: 'Rename Scene',
        defaultValue: scene.name ?? '',
        placeholder: 'New name',
        confirmLabel: 'Rename',
        onConfirm: async (newName) => {
          const next = String(newName ?? '').trim();
          if (!next || next === id) return;
          try {
            await api.putScene(id, { name: next });
            await _refreshScenes();
            _renderList(listPanel, diffPanel);
            toast('Renamed');

            undo.push({
              label: `Rename scene "${id}" → "${next}"`,
              apply: async () => {
                await api.putScene(id, { name: next });
                await _refreshScenes();
              },
              revert: async () => {
                await api.putScene(next, { name: id });
                await _refreshScenes();
              },
            });

          } catch(e) { toast('Rename failed: ' + e.message, true); }
        },
      });
    });

    const favBtn = document.createElement('button');
    favBtn.className = 'scene-fav-btn' + (scene.is_favourite ? ' fav-on' : '');
    favBtn.title = scene.is_favourite ? 'Unfavourite' : 'Favourite';
    favBtn.textContent = scene.is_favourite ? '★' : '☆';
    favBtn.onclick = async e => {
      e.stopPropagation();
      const prev = !!scene.is_favourite;
      const next = !prev;
      try {
        await api.putScene(id, { is_favourite: next });
        await _refreshScenes();
        _renderList(listPanel, diffPanel);

        undo.push({
          label: `${next ? 'Favourite' : 'Unfavourite'} scene "${id}"`,
          apply: async () => {
            await api.putScene(id, { is_favourite: next });
            await _refreshScenes();
          },
          revert: async () => {
            await api.putScene(id, { is_favourite: prev });
            await _refreshScenes();
          },
        });

      } catch(e) { toast('Fav error: ' + e.message, true); }
    };

    hdr.appendChild(nameEl);
    hdr.appendChild(favBtn);
    card.appendChild(hdr);

    if (scene.description) {
      const desc = document.createElement('div');
      desc.className = 'scene-ts';
      desc.textContent = scene.description;
      card.appendChild(desc);
    }

    const actions = document.createElement('div');
    actions.className = 'scene-actions';

    const loadBtn = document.createElement('button');
    loadBtn.className = 'btn-accent';
    loadBtn.textContent = 'Load';
    loadBtn.onclick = async e => {
      e.stopPropagation();
      try {
        const diff = await api.getSceneDiff(id);
        const hasDiff = !!diff?.has_changes || (diff?.changes?.length > 0);
        if (hasDiff) {
          _renderDiff(diffPanel, scene, diff);
          const lines = _diffLines(diff);
          const bodyHtml = `<ul style="margin:0;padding-left:16px;font-size:11px;color:var(--text-secondary);">${lines.map(l => `<li>${_esc(l)}</li>`).join('')}</ul>`;
          confirmModal({
            title: `Load "${scene.name ?? id}"?`,
            body: `This will overwrite current state:<br><br>${bodyHtml}`,
            confirmLabel: 'Load Scene',
            onConfirm: async () => {
              try {
                await _loadSceneWithUndo(id);
                _renderList(listPanel, diffPanel);
                toast(`Scene "${scene.name ?? id}" loaded`);
              } catch(e) { toast('Load failed: ' + e.message, true); }
            },
          });
        } else {
          await _loadSceneWithUndo(id);
          _renderList(listPanel, diffPanel);
          toast(`Scene "${scene.name ?? id}" loaded`);
        }
      } catch(e) { toast('Load failed: ' + e.message, true); }
    };

    const diffBtn = document.createElement('button');
    diffBtn.className = 'btn-secondary';
    diffBtn.textContent = 'Diff';
    diffBtn.onclick = async e => {
      e.stopPropagation();
      _renderDiff(diffPanel, scene);
    };

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-danger';
    delBtn.textContent = 'Del';
    delBtn.onclick = async e => {
      e.stopPropagation();
      confirmModal({
        title: `Delete "${scene.name ?? id}"?`,
        body: 'This scene will be permanently deleted. Undo will restore it without changing current live state.',
        confirmLabel: 'Delete scene',
        danger: true,
        onConfirm: async () => {
          try {
            const sceneData = await api.getScene(id);
            await api.deleteScene(id);
            await _refreshScenes();
            _renderList(listPanel, diffPanel);
            toast('Scene deleted');

            undo.push({
              label: `Delete scene "${id}"`,
              apply: async () => {
                await api.deleteScene(id);
                await _refreshScenes();
              },
              revert: async () => {
                const live = _captureSnapshot();
                const snap = _snapshotFromScene(sceneData);
                await _restoreSnapshot(snap);
                await api.postScene(id);
                await _restoreSnapshot(live);
                await _refreshScenes();
              },
            });

          } catch(e) { toast('Delete failed: ' + e.message, true); }
        },
      });
    };

    actions.appendChild(loadBtn);
    actions.appendChild(diffBtn);
    actions.appendChild(delBtn);
    card.appendChild(actions);

    listPanel.appendChild(card);
  });
}

async function _renderDiff(diffPanel, scene, prefetchedDiff) {
  diffPanel.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:10px;">Loading diff…</div>';
  try {
    const id = _sceneId(scene);
    const diff = prefetchedDiff ?? await api.getSceneDiff(id);
    diffPanel.innerHTML = '';
    const hdr = document.createElement('div');
    hdr.className = 'scenes-diff-hdr';
    hdr.textContent = `Diff: ${scene.name ?? id}`;
    diffPanel.appendChild(hdr);

    const lines = _diffLines(diff);
    if (!lines.length) {
      diffPanel.innerHTML += '<div style="padding:12px;color:var(--text-muted);font-size:10px;">No differences from current state.</div>';
      return;
    }

    const sec = _diffSection('Changes', lines);
    diffPanel.appendChild(sec);

  } catch(e) {
    diffPanel.innerHTML = `<div style="padding:16px;color:var(--color-danger);font-size:10px;">Diff error: ${e.message}</div>`;
  }
}

function _diffLines(diff) {
  if (!diff) return [];
  const changes = diff.changes ?? [];
  if (!Array.isArray(changes)) return [];
  return changes.map(c => `${c.field}: ${_fmt(c.current)} → ${_fmt(c.scene)}`);
}

function _fmt(v) {
  if (typeof v === 'number') return Number(v).toFixed(2);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v == null) return 'null';
  return String(v);
}

function _diffSection(title, lines) {
  const sec = document.createElement('div');
  sec.className = 'diff-section';
  const h = document.createElement('div');
  h.className = 'diff-section-title';
  h.textContent = title;
  sec.appendChild(h);
  lines.forEach(l => {
    const row = document.createElement('div');
    row.className = 'diff-row';
    row.textContent = l;
    sec.appendChild(row);
  });
  return sec;
}

function _sceneId(scene) { return scene?.id ?? scene?.name; }
function _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

async function _refreshScenes() {
  const scenes = await api.getScenes();
  st.setScenes(Array.isArray(scenes) ? scenes : (scenes.scenes ?? []));
  if (scenes && Object.prototype.hasOwnProperty.call(scenes, 'active')) {
    st.setActiveScene(scenes.active);
  }
  return scenes;
}

function _captureSnapshot() {
  return {
    activeSceneId: st.state.activeSceneId,
    routes: st.routeList().map(r => ({ rx_id: r.rx_id, tx_id: r.tx_id, route_type: r.route_type ?? 'local' })),
    channels: st.channelList().map(c => ({ id: c.id, gain_db: c.gain_db, enabled: c.enabled })),
    outputs: st.outputList().map(o => ({ id: o.id, volume_db: o.volume_db, muted: o.muted })),
    matrixGain: JSON.parse(JSON.stringify(st.state.matrixGain ?? [])),
  };
}

function _snapshotFromScene(scene) {
  const routes = [];
  const matrix = scene?.matrix ?? [];
  for (let tx = 0; tx < (matrix?.length ?? 0); tx++) {
    const row = matrix[tx] ?? [];
    for (let rx = 0; rx < row.length; rx++) {
      if (row[rx]) routes.push({ rx_id: `rx_${rx}`, tx_id: `tx_${tx}`, route_type: 'local' });
    }
  }

  const inGain = (scene?.input_dsp_gain_db?.length ? scene.input_dsp_gain_db : scene?.input_gain_db) ?? [];
  const outGain = (scene?.output_dsp_gain_db?.length ? scene.output_dsp_gain_db : scene?.output_gain_db) ?? [];

  return {
    activeSceneId: null,
    routes,
    channels: inGain.map((gain_db, i) => ({ id: `rx_${i}`, gain_db })),
    outputs: outGain.map((volume_db, i) => ({ id: `tx_${i}`, volume_db, muted: scene?.output_muted?.[i] })),
    matrixGain: scene?.matrix_gain_db ?? [],
  };
}

async function _loadSceneWithUndo(sceneId) {
  const before = _captureSnapshot();

  await api.loadScene(sceneId);
  await _syncCoreState();
  st.setActiveScene(sceneId);

  undo.push({
    label: `Load scene "${sceneId}"`,
    apply: async () => {
      await api.loadScene(sceneId);
      await _syncCoreState();
      st.setActiveScene(sceneId);
    },
    revert: async () => {
      await _restoreSnapshot(before);
      st.setActiveScene(before.activeSceneId);
    },
  });
}

async function _syncCoreState() {
  const [channels, outputs, routes, matrixState] = await Promise.all([
    api.getChannels(),
    api.getOutputs(),
    api.getRoutes(),
    api.getMatrix().catch(() => null),
  ]);

  channels.forEach(c => st.setChannel(c));
  outputs.forEach(o => st.setOutput(o));

  // routes: reset from scratch to avoid stale entries
  st.routeList().forEach(r => st.removeRoute(r.rx_id, r.tx_id));
  routes.forEach(r => st.setRoute(r));

  if (matrixState?.gain_db) st.setMatrixGain(matrixState.gain_db);
}

async function _restoreSnapshot(snap) {
  const currentRoutes = await api.getRoutes();
  await Promise.allSettled((currentRoutes ?? []).map(r => api.deleteRoute(r.id)));

  // Gains/mutes first
  await Promise.allSettled((snap.channels ?? []).map(ch => {
    const body = {};
    if (ch.gain_db !== undefined) body.gain_db = ch.gain_db;
    if (ch.enabled !== undefined) body.enabled = ch.enabled;
    if (!Object.keys(body).length) return Promise.resolve(null);
    return api.putChannel(ch.id, body);
  }));

  await Promise.allSettled((snap.outputs ?? []).map(o => {
    const body = {};
    if (o.volume_db !== undefined) body.volume_db = o.volume_db;
    if (o.muted !== undefined) body.muted = o.muted;
    if (!Object.keys(body).length) return Promise.resolve(null);
    return api.putOutput(o.id, body);
  }));

  await Promise.allSettled((snap.routes ?? []).map(r => api.postRoute(r.rx_id, r.tx_id, r.route_type)));

  // Restore matrix gains for enabled routes only
  const gain = snap.matrixGain ?? [];
  const gainOps = [];
  (snap.routes ?? []).forEach(r => {
    const tx = _idxFromId(r.tx_id);
    const rx = _idxFromId(r.rx_id);
    const db = gain?.[tx]?.[rx];
    if (tx != null && rx != null && db != null) {
      gainOps.push(api.putMatrixGain(tx, rx, db));
    }
  });
  await Promise.allSettled(gainOps);

  await _syncCoreState();
}

function _idxFromId(id) {
  const m = String(id ?? '').match(/_(\d+)$/);
  if (!m) return null;
  return Number(m[1]);
}

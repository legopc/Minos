// scenes.js — Scenes tab
import * as st  from './state.js';
import * as api from './api.js';
import { toast } from './toast.js';
import { confirmModal, inputModal } from './modal.js';
import { undo } from './undo.js';

const RECALL_SCOPE_SECTIONS = [
  { key: 'routing', label: 'Routing', description: 'Matrix routes and crosspoint gains' },
  { key: 'inputs', label: 'Inputs', description: 'Input DSP chains and channel gain' },
  { key: 'outputs', label: 'Outputs', description: 'Output DSP chains, gain and mute' },
  { key: 'buses', label: 'Buses', description: 'Internal buses, bus routing and bus feeds' },
  { key: 'groups', label: 'Groups', description: 'VCA, stereo links and automixer groups' },
  { key: 'generators', label: 'Generators', description: 'Signal generators and output routing' },
];

const DIFF_SECTION_PATHS = {
  routing: ['matrix', 'matrix_gain_db'],
  inputs: ['input_dsp', 'input_gain_db', 'input_dsp_gain_db'],
  outputs: ['output_dsp', 'output_gain_db', 'output_dsp_gain_db', 'output_muted'],
  buses: ['internal_buses', 'bus_matrix', 'bus_feed_matrix'],
  groups: ['vca_groups', 'stereo_links', 'output_stereo_links', 'automixer_groups'],
  generators: ['signal_generators', 'generator_bus_matrix'],
};

const ENTITY_FILTER_SECTIONS = new Set(['inputs', 'outputs']);
const AB_MORPH_DURATIONS = [100, 250, 500, 1000, 2000, 5000];

let _abBarMount = null;
let _scenesDiffPanel = null;
let _scenesListPanel = null;
let _abEventsBound = false;

export async function render(container) {
  container.innerHTML = '';
  container.id = 'tab-scenes';
  await _refreshAbState();

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
  _scenesListPanel = listPanel;
  _scenesDiffPanel = diffPanel;

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
  const abBar = document.createElement('div');
  abBar.className = 'scenes-ab-bar';
  container.insertBefore(abBar, layout);
  _abBarMount = abBar;
  _renderAbBar();
  _bindAbEvents();
}

async function _refreshAbState() {
  try {
    st.setSceneAb(await api.getAbState());
  } catch {
    st.setSceneAb({ slot_a: null, slot_b: null, active: 'a', morph: null });
  }
}

function _bindAbEvents() {
  if (_abEventsBound) return;
  _abEventsBound = true;
  window.addEventListener('pb:ab-update', async () => {
    _renderAbBar();
    if (!st.state.sceneAb?.morph && _scenesListPanel && _scenesDiffPanel) {
      await _syncCoreState().catch(() => {});
      _renderList(_scenesListPanel, _scenesDiffPanel);
    }
  });
}

function _renderAbBar() {
  if (!_abBarMount) return;
  const ab = st.state.sceneAb ?? { slot_a: null, slot_b: null, active: 'a', morph: null };
  _abBarMount.innerHTML = '';

  const durationWrap = document.createElement('label');
  durationWrap.className = 'scenes-ab-duration';
  durationWrap.textContent = 'Morph';
  const durationSel = document.createElement('select');
  durationSel.className = 'scenes-ab-select';
  const selectedDuration = String(ab.morph?.duration_ms ?? 1000);
  AB_MORPH_DURATIONS.forEach((durationMs) => {
    const opt = document.createElement('option');
    opt.value = String(durationMs);
    opt.textContent = durationMs >= 1000 ? `${durationMs / 1000}s` : `${durationMs}ms`;
    if (opt.value === selectedDuration) opt.selected = true;
    durationSel.appendChild(opt);
  });
  durationWrap.appendChild(durationSel);

  _abBarMount.appendChild(_abSlotCard('a', ab.slot_a, ab.active === 'a'));

  const actions = document.createElement('div');
  actions.className = 'scenes-ab-actions';
  actions.appendChild(_abActionButton('SHOW A↔B DIFF', !ab.slot_a || !ab.slot_b, async () => {
    const diff = await api.getAbDiff();
    _renderNamedDiff(_scenesDiffPanel, 'A ↔ B', diff, 'No differences between slot A and slot B.');
  }));
  actions.appendChild(_abActionButton(`TOGGLE → ${String(ab.active ?? 'a').toUpperCase() === 'A' ? 'B' : 'A'}`, !ab.slot_a || !ab.slot_b || !!ab.morph, async () => {
    const result = await api.toggleAb();
    st.setSceneAb({ ...st.state.sceneAb, active: result.active ?? (ab.active === 'a' ? 'b' : 'a'), morph: null });
    await _syncCoreState();
    _renderList(_scenesListPanel, _scenesDiffPanel);
    _renderAbBar();
    toast(`Active A/B slot: ${(result.active ?? 'a').toUpperCase()}`);
  }));
  actions.appendChild(_abActionButton('A → B', !ab.slot_a || !ab.slot_b || !!ab.morph, async () => {
    await api.startAbMorph({
      direction: 'a_to_b',
      duration_ms: Number(durationSel.value),
      scope: _defaultRecallScope(),
    });
    await _refreshAbState();
    _renderAbBar();
  }));
  actions.appendChild(_abActionButton('B → A', !ab.slot_a || !ab.slot_b || !!ab.morph, async () => {
    await api.startAbMorph({
      direction: 'b_to_a',
      duration_ms: Number(durationSel.value),
      scope: _defaultRecallScope(),
    });
    await _refreshAbState();
    _renderAbBar();
  }));
  if (ab.morph) {
    actions.appendChild(_abActionButton('CANCEL', false, async () => {
      await api.cancelAbMorph();
      await _syncCoreState();
      await _refreshAbState();
      _renderList(_scenesListPanel, _scenesDiffPanel);
      _renderAbBar();
    }));
  }
  _abBarMount.appendChild(actions);
  _abBarMount.appendChild(durationWrap);

  const progress = document.createElement('div');
  progress.className = 'scenes-ab-progress';
  const progressPct = ab.morph
    ? Math.round(((ab.morph.t ?? (ab.morph.duration_ms ? ab.morph.elapsed_ms / ab.morph.duration_ms : 0)) || 0) * 100)
    : (String(ab.active ?? 'a').toUpperCase() === 'A' ? 0 : 100);
  progress.innerHTML = `<div class="scenes-ab-progress-bar"><span style="width:${progressPct}%"></span></div><span class="scenes-ab-progress-label">${ab.morph ? `Morph ${progressPct}%` : `Active ${String(ab.active ?? 'a').toUpperCase()}`}</span>`;
  _abBarMount.appendChild(progress);
}

function _abSlotCard(slot, slotData, isActive) {
  const wrap = document.createElement('div');
  wrap.className = `scenes-ab-slot${isActive ? ' is-active' : ''}`;
  const head = document.createElement('div');
  head.className = 'scenes-ab-slot-head';
  head.innerHTML = `<strong>${slot.toUpperCase()}</strong><span>${slotData?.scene_name ?? '(empty)'}</span>`;
  wrap.appendChild(head);

  const meta = document.createElement('div');
  meta.className = 'scenes-ab-slot-meta';
  meta.textContent = slotData ? `${slotData.source} • ${new Date(slotData.captured_at_ms).toLocaleTimeString()}` : 'Working snapshot';
  wrap.appendChild(meta);

  const controls = document.createElement('div');
  controls.className = 'scenes-ab-slot-controls';
  const sceneSel = document.createElement('select');
  sceneSel.className = 'scenes-ab-select';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'From scene…';
  sceneSel.appendChild(placeholder);
  (st.state.scenes ?? []).forEach((scene) => {
    const sceneId = _sceneId(scene);
    const opt = document.createElement('option');
    opt.value = sceneId;
    opt.textContent = scene.name ?? sceneId;
    sceneSel.appendChild(opt);
  });
  controls.appendChild(sceneSel);
  controls.appendChild(_abActionButton('LIVE', false, async () => {
    await api.captureAbSlot(slot, { source: 'live' });
    await _refreshAbState();
    _renderAbBar();
  }));
  controls.appendChild(_abActionButton('SCENE', !st.state.scenes?.length, async () => {
    if (!sceneSel.value) {
      toast('Choose a scene first.', true);
      return;
    }
    await api.captureAbSlot(slot, { source: 'scene', name: sceneSel.value });
    await _refreshAbState();
    _renderAbBar();
  }));
  controls.appendChild(_abActionButton('SAVE', !slotData, async () => {
    inputModal({
      title: `Save slot ${slot.toUpperCase()}`,
      placeholder: 'Scene name',
      defaultValue: slotData?.scene_name ?? '',
      confirmLabel: 'Save',
      onConfirm: async (name) => {
        const sceneName = String(name ?? '').trim();
        if (!sceneName) return;
        await api.saveAbSlot(slot, sceneName);
        await _refreshScenes();
        _renderList(_scenesListPanel, _scenesDiffPanel);
        toast(`Saved slot ${slot.toUpperCase()} as "${sceneName}"`);
      },
    });
  }));
  wrap.appendChild(controls);
  return wrap;
}

function _abActionButton(label, disabled, onClick) {
  const btn = document.createElement('button');
  btn.className = 'scenes-ab-btn';
  btn.textContent = label;
  btn.disabled = !!disabled;
  btn.onclick = async () => {
    try {
      await onClick();
    } catch (e) {
      toast(e.message, true);
    }
  };
  return btn;
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
        const hasDiff = _hasDiff(diff);
        if (hasDiff) {
          _renderDiff(diffPanel, scene, diff);
          _openRecallModal({ scene, sceneId: id, diff, listPanel, diffPanel });
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
    _renderNamedDiff(diffPanel, scene.name ?? id, diff, 'No differences from current state.');

  } catch(e) {
    diffPanel.innerHTML = `<div style="padding:16px;color:var(--color-danger);font-size:10px;">Diff error: ${e.message}</div>`;
  }
}

function _renderNamedDiff(diffPanel, label, diff, emptyText) {
  const diffModel = _normaliseDiff(diff);
  diffPanel.innerHTML = '';
  const hdr = document.createElement('div');
  hdr.className = 'scenes-diff-hdr';
  hdr.textContent = `Diff: ${label}`;
  diffPanel.appendChild(hdr);

  if (!diffModel.hasChanges) {
    diffPanel.innerHTML += `<div style="padding:12px;color:var(--text-muted);font-size:10px;">${emptyText}</div>`;
    return;
  }

  diffPanel.appendChild(_diffSummary(diffModel));
  _orderedDiffSections(diffModel).forEach(section => {
    diffPanel.appendChild(_diffSection(section.label, section.changes, { showAll: true, count: section.count }));
  });
}

function _fmt(v) {
  if (typeof v === 'number') return Number(v).toFixed(2);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v == null) return 'null';
  if (Array.isArray(v) || typeof v === 'object') {
    const json = JSON.stringify(v);
    return json.length > 72 ? `${json.slice(0, 69)}…` : json;
  }
  return String(v);
}

function _diffSection(title, changes, { showAll = false, count = null } = {}) {
  const sec = document.createElement('div');
  sec.className = 'diff-section';
  const h = document.createElement('div');
  h.className = 'diff-section-title';
  h.textContent = count == null ? title : `${title} (${count})`;
  sec.appendChild(h);
  const visibleChanges = showAll ? changes : changes.slice(0, 6);
  visibleChanges.forEach(change => {
    const row = document.createElement('div');
    row.className = `diff-row diff-row-${change.kind ?? 'changed'}`;
    row.textContent = `${change.field}: ${_fmt(change.current)} → ${_fmt(change.scene)}`;
    sec.appendChild(row);
  });
  if (!showAll && changes.length > visibleChanges.length) {
    const more = document.createElement('div');
    more.className = 'diff-row diff-row-more';
    more.textContent = `+${changes.length - visibleChanges.length} more change${changes.length - visibleChanges.length === 1 ? '' : 's'}`;
    sec.appendChild(more);
  }
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

async function _loadSceneWithUndo(sceneId, scope) {
  const before = _captureSnapshot();

  await api.loadScene(sceneId, scope);
  await _syncCoreState();
  st.setActiveScene(sceneId);
  const label = _scopeIsFull(scope)
    ? `Load scene "${sceneId}"`
    : `Partial recall "${sceneId}"`;

  undo.push({
    label,
    apply: async () => {
      await api.loadScene(sceneId, scope);
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
  const [
    channels,
    outputs,
    routes,
    matrixState,
    buses,
    vcaGroups,
    stereoLinks,
    outputStereoLinks,
    generators,
    automixerGroups,
    busFeedMatrix,
  ] = await Promise.all([
    api.getChannels(),
    api.getOutputs(),
    api.getRoutes(),
    api.getMatrix().catch(() => null),
    api.getBuses().catch(() => []),
    api.getVcaGroups().catch(() => []),
    api.getStereoLinks().catch(() => []),
    api.getOutputStereoLinks().catch(() => []),
    api.getGenerators().catch(() => ({ signal_generators: [], generator_bus_matrix: [] })),
    api.getAutomixerGroups().catch(() => []),
    api.getBusFeedMatrix().catch(() => []),
  ]);

  channels.forEach(c => st.setChannel(c));
  outputs.forEach(o => st.setOutput(o));
  st.state.buses = new Map();
  buses.forEach(b => st.setBus(b));
  st.setVcaGroups(Array.isArray(vcaGroups) ? vcaGroups : (vcaGroups?.vca_groups ?? []));
  st.setStereoLinks(Array.isArray(stereoLinks) ? stereoLinks : (stereoLinks?.stereo_links ?? []));
  st.setOutputStereoLinks(Array.isArray(outputStereoLinks) ? outputStereoLinks : (outputStereoLinks?.stereo_links ?? []));
  st.setGenerators(generators.signal_generators ?? []);
  st.setGeneratorMatrix(generators.generator_bus_matrix ?? []);
  st.setAutomixerGroups(Array.isArray(automixerGroups) ? automixerGroups : (automixerGroups?.automixer_groups ?? []));
  st.setBusFeedMatrix(Array.isArray(busFeedMatrix) ? busFeedMatrix : []);

  // routes: reset from scratch to avoid stale entries
  st.routeList().forEach(r => st.removeRoute(r.rx_id, r.tx_id));
  routes.forEach(r => st.setRoute(r));

  const busMatrix = {};
  routes.forEach(r => {
    if (r.route_type === 'bus') {
      if (!busMatrix[r.tx_id]) busMatrix[r.tx_id] = {};
      busMatrix[r.tx_id][r.rx_id] = true;
    }
  });
  st.setBusMatrix(busMatrix);

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

function _defaultRecallScope() {
  return RECALL_SCOPE_SECTIONS.reduce((scope, section) => {
    scope[section.key] = true;
    return scope;
  }, {});
}

function _normaliseRecallScope(scope) {
  const base = _defaultRecallScope();
  if (!scope || typeof scope !== 'object') return base;
  RECALL_SCOPE_SECTIONS.forEach(section => {
    base[section.key] = scope[section.key] !== false;
  });
  return base;
}

function _scopeIsFull(scope) {
  const normalised = _normaliseRecallScope(scope);
  const hasScopedChannels = (Array.isArray(scope?.input_channels) && scope.input_channels.length > 0)
    || (Array.isArray(scope?.output_channels) && scope.output_channels.length > 0);
  return !hasScopedChannels && RECALL_SCOPE_SECTIONS.every(section => normalised[section.key]);
}

function _hasDiff(diff) {
  return _normaliseDiff(diff).hasChanges;
}

function _sectionLabel(sectionKey) {
  return RECALL_SCOPE_SECTIONS.find(section => section.key === sectionKey)?.label
    ?? (sectionKey ? sectionKey.charAt(0).toUpperCase() + sectionKey.slice(1) : 'Other');
}

function _topLevelDiffPath(field) {
  return String(field ?? '').split(/[.[\]]/).find(Boolean) ?? '';
}

function _sectionKeyForField(field) {
  const topLevel = _topLevelDiffPath(field);
  return Object.entries(DIFF_SECTION_PATHS).find(([, prefixes]) => prefixes.includes(topLevel))?.[0] ?? 'other';
}

function _diffKind(change) {
  if (change?.kind) return String(change.kind);
  if (change?.current == null && change?.scene != null) return 'added';
  if (change?.current != null && change?.scene == null) return 'removed';
  return 'changed';
}

function _normaliseDiffChange(change, fallbackSectionKey = null) {
  const field = String(change?.field ?? '<root>');
  return {
    field,
    current: change?.current ?? null,
    scene: change?.scene ?? null,
    kind: _diffKind(change),
    sectionKey: fallbackSectionKey ?? _sectionKeyForField(field),
  };
}

function _fieldIndex(field, prefixes) {
  const source = String(field ?? '');
  for (const prefix of prefixes) {
    const marker = `${prefix}[`;
    const start = source.indexOf(marker);
    if (start === -1) continue;
    const value = Number(source.slice(start + marker.length, source.indexOf(']', start + marker.length)));
    if (Number.isInteger(value)) return value;
  }
  return null;
}

function _channelLabel(sectionKey, channelId) {
  const idx = _idxFromId(channelId);
  if (sectionKey === 'inputs') {
    return st.state.channels.get(channelId)?.name || `Input ${idx + 1}`;
  }
  if (sectionKey === 'outputs') {
    return st.state.outputs.get(channelId)?.name || `Output ${idx + 1}`;
  }
  return channelId;
}

function _changeEntityId(sectionKey, field) {
  if (sectionKey === 'inputs') {
    const idx = _fieldIndex(field, DIFF_SECTION_PATHS.inputs);
    return idx == null ? null : `rx_${idx}`;
  }
  if (sectionKey === 'outputs') {
    const idx = _fieldIndex(field, DIFF_SECTION_PATHS.outputs);
    return idx == null ? null : `tx_${idx}`;
  }
  return null;
}

function _buildSectionEntities(section) {
  if (!ENTITY_FILTER_SECTIONS.has(section.key)) return [];
  const entities = new Map();
  (section.changes ?? []).forEach(change => {
    const id = _changeEntityId(section.key, change.field);
    if (!id) return;
    const existing = entities.get(id) ?? {
      id,
      label: _channelLabel(section.key, id),
      count: 0,
    };
    existing.count += 1;
    entities.set(id, existing);
  });
  return [...entities.values()].sort((a, b) => {
    const aIdx = _idxFromId(a.id);
    const bIdx = _idxFromId(b.id);
    return aIdx - bIdx;
  });
}

function _normaliseDiff(diff) {
  const rawSections = diff?.sections && typeof diff.sections === 'object' ? diff.sections : {};
  const groupedFallback = new Map();
  (diff?.changes ?? []).forEach(change => {
    const normalised = _normaliseDiffChange(change);
    const key = normalised.sectionKey;
    if (!groupedFallback.has(key)) groupedFallback.set(key, []);
    groupedFallback.get(key).push(normalised);
  });

  const sections = [];
  const seen = new Set();
  RECALL_SCOPE_SECTIONS.forEach(section => {
    const raw = rawSections?.[section.key];
    const fallbackChanges = groupedFallback.get(section.key) ?? [];
    const rawChanges = Array.isArray(raw?.changes)
      ? raw.changes.map(change => _normaliseDiffChange(change, section.key))
      : fallbackChanges;
    const summaryEntry = diff?.summary?.sections?.find(entry => entry?.key === section.key);
    const count = Number(raw?.count ?? summaryEntry?.count ?? rawChanges.length ?? 0);
    sections.push({
      key: section.key,
      label: raw?.label ?? summaryEntry?.label ?? section.label,
      count,
      changes: rawChanges,
      entities: [],
    });
    seen.add(section.key);
  });

  Object.entries(rawSections).forEach(([key, raw]) => {
    if (seen.has(key)) return;
    const changes = Array.isArray(raw?.changes)
      ? raw.changes.map(change => _normaliseDiffChange(change, key))
      : (groupedFallback.get(key) ?? []);
    sections.push({
      key,
      label: raw?.label ?? _sectionLabel(key),
      count: Number(raw?.count ?? changes.length ?? 0),
      changes,
      entities: [],
    });
    seen.add(key);
  });

  groupedFallback.forEach((changes, key) => {
    if (seen.has(key)) return;
    sections.push({
      key,
      label: _sectionLabel(key),
      count: changes.length,
      changes,
      entities: [],
    });
  });

  sections.forEach(section => {
    section.entities = _buildSectionEntities(section);
  });

  const totalChanges = Number(diff?.summary?.total_changes ?? sections.reduce((sum, section) => sum + section.count, 0));
  return {
    raw: diff,
    sections,
    totalChanges,
    hasChanges: Boolean(diff?.has_changes) || totalChanges > 0,
  };
}

function _orderedDiffSections(diffModel, { includeEmpty = false } = {}) {
  const model = Array.isArray(diffModel?.sections) ? diffModel : _normaliseDiff(diffModel);
  return includeEmpty ? model.sections : model.sections.filter(section => section.count > 0 || section.changes.length > 0);
}

function _selectedEntityIds(modalState, sectionKey) {
  return modalState.entitySelection[sectionKey] ?? new Set();
}

function _filteredSection(section, modalState) {
  const enabled = modalState.scope[section.key] !== false;
  const entities = section.entities ?? [];
  const selectedEntities = _selectedEntityIds(modalState, section.key);
  const totalCount = Number(section.count ?? section.changes?.length ?? 0);
  const changes = enabled
    ? (section.changes ?? []).filter(change => {
        if (!entities.length) return true;
        const entityId = _changeEntityId(section.key, change.field);
        return entityId == null || selectedEntities.has(entityId);
      })
    : [];
  const selectedCount = enabled
    ? (changes.length || !totalCount ? changes.length : totalCount)
    : 0;
  const skippedCount = Math.max(totalCount - selectedCount, 0);
  return {
    ...section,
    enabled,
    selectedCount,
    skippedCount,
    selectedChanges: changes,
  };
}

function _buildRecallScopeState(diffModel) {
  return diffModel.sections.reduce((state, section) => {
    if (section.entities?.length) {
      state[section.key] = new Set(section.entities.map(entity => entity.id));
    }
    return state;
  }, {});
}

function _buildRecallRequestScope(modalState) {
  const scope = _normaliseRecallScope(modalState.scope);
  const inputSection = modalState.diffModel.sections.find(section => section.key === 'inputs');
  const outputSection = modalState.diffModel.sections.find(section => section.key === 'outputs');
  const inputIds = [..._selectedEntityIds(modalState, 'inputs')];
  const outputIds = [..._selectedEntityIds(modalState, 'outputs')];

  if (scope.inputs && inputSection?.entities?.length && inputIds.length === 0) {
    scope.inputs = false;
  } else if (scope.inputs && inputSection?.entities?.length && inputIds.length < inputSection.entities.length) {
    scope.input_channels = inputIds;
  }
  if (scope.outputs && outputSection?.entities?.length && outputIds.length === 0) {
    scope.outputs = false;
  } else if (scope.outputs && outputSection?.entities?.length && outputIds.length < outputSection.entities.length) {
    scope.output_channels = outputIds;
  }

  return _scopeIsFull(scope) ? undefined : scope;
}

function _selectedRecallSummary(modalState) {
  const sections = _orderedDiffSections(modalState.diffModel, { includeEmpty: true }).map(section => _filteredSection(section, modalState));
  const selectedSections = sections.filter(section => section.selectedCount > 0);
  const selectedCount = selectedSections.reduce((sum, section) => sum + section.selectedCount, 0);
  const keptLines = sections.flatMap(section => {
    if ((section.count ?? 0) === 0) return [`${section.label} already matches current state.`];
    if (!section.enabled) return [`${section.label}: ${section.count} change${section.count === 1 ? '' : 's'} kept live.`];
    if (!section.skippedCount) return [];
    const skippedEntities = (section.entities ?? [])
      .filter(entity => !_selectedEntityIds(modalState, section.key).has(entity.id))
      .map(entity => entity.label);
    const scopeText = skippedEntities.length ? ` (${skippedEntities.join(', ')})` : '';
    return [`${section.label}: ${section.skippedCount} change${section.skippedCount === 1 ? '' : 's'} kept live${scopeText}.`];
  });
  return {
    sections,
    selectedSections,
    selectedCount,
    keptCount: Math.max(modalState.diffModel.totalChanges - selectedCount, 0),
    keptLines,
  };
}

function _diffSummary(diffModel) {
  const model = Array.isArray(diffModel?.sections) ? diffModel : _normaliseDiff(diffModel);
  const wrap = document.createElement('div');
  wrap.className = 'scenes-diff-summary';
  const activeSections = _orderedDiffSections(model);
  const breakdown = activeSections.map(section => `${section.label} ${section.count}`).join(' • ');
  wrap.innerHTML = `
    <strong>${model.totalChanges} change${model.totalChanges === 1 ? '' : 's'}</strong>
    <span>${breakdown || 'No section changes reported.'}</span>
  `;
  return wrap;
}

function _recallScopeHtml(section, modalState) {
  const view = _filteredSection(section, modalState);
  const checked = view.enabled ? 'checked' : '';
  const selectedCount = view.selectedCount;
  const totalCount = section.count ?? section.changes?.length ?? 0;
  const status = totalCount === 0
    ? { label: 'Unchanged', tone: 'muted' }
    : !view.enabled
      ? { label: 'Keep Live', tone: 'muted' }
      : selectedCount < totalCount
        ? { label: 'Partial', tone: 'accent' }
        : { label: 'Will Recall', tone: 'accent' };
  const entityHtml = (section.entities ?? []).length
    ? `
        <div class="scenes-recall-entity-list">
          ${(section.entities ?? []).map(entity => `
            <label class="scenes-recall-entity-chip${_selectedEntityIds(modalState, section.key).has(entity.id) ? ' is-selected' : ''}${view.enabled ? '' : ' is-disabled'}">
              <input
                type="checkbox"
                data-recall-entity-section="${section.key}"
                data-recall-entity-id="${entity.id}"
                ${_selectedEntityIds(modalState, section.key).has(entity.id) ? 'checked' : ''}
                ${view.enabled ? '' : 'disabled'}
              >
              <span>${_esc(entity.label)}</span>
              <strong>${entity.count}</strong>
            </label>
          `).join('')}
        </div>
      `
    : '';
  return `
    <div class="scenes-recall-scope-option${view.enabled ? '' : ' is-muted'}">
      <label class="scenes-recall-scope-toggle">
        <input type="checkbox" data-recall-scope="${section.key}" ${checked}>
        <span class="scenes-recall-scope-copy">
          <span class="scenes-recall-scope-label">${_esc(section.label)}</span>
          <span class="scenes-recall-scope-desc">${_esc(RECALL_SCOPE_SECTIONS.find(item => item.key === section.key)?.description ?? '')}</span>
        </span>
      </label>
      <div class="scenes-recall-scope-meta">
        <span class="scenes-recall-scope-count">${selectedCount}/${totalCount}</span>
        <span class="scenes-recall-scope-status is-${status.tone}">${status.label}</span>
      </div>
      ${entityHtml}
    </div>
  `;
}

function _recallModalBody(scene, modalState) {
  const summary = _selectedRecallSummary(modalState);
  const selectedSections = summary.selectedSections;
  const summaryText = summary.selectedCount > 0
    ? `${summary.selectedCount} change${summary.selectedCount === 1 ? '' : 's'} will recall. ${summary.keptCount} stay live.`
    : 'Select at least one changed section or channel to recall.';

  const scopesHtml = _orderedDiffSections(modalState.diffModel, { includeEmpty: true })
    .map(section => _recallScopeHtml(section, modalState))
    .join('');

  const selectedHtml = selectedSections.length
    ? selectedSections.map(section => `
        <div class="scenes-recall-preview-group">
          <div class="scenes-recall-preview-title">${_esc(section.label)} <span>${section.selectedCount}</span></div>
          ${(section.selectedChanges ?? []).slice(0, 6).map(change => `
            <div class="scenes-recall-preview-row is-${_esc(change.kind)}">${_esc(change.field)}: ${_esc(_fmt(change.current))} → ${_esc(_fmt(change.scene))}</div>
          `).join('')}
          ${(section.selectedChanges?.length ?? 0) === 0 ? `<div class="scenes-recall-preview-empty">Backend reported ${section.selectedCount} change${section.selectedCount === 1 ? '' : 's'}; detailed fields unavailable.</div>` : ''}
          ${(section.selectedChanges?.length ?? 0) > 6 ? `<div class="scenes-recall-preview-more">+${section.selectedChanges.length - 6} more</div>` : ''}
        </div>
      `).join('')
    : '<div class="scenes-recall-preview-empty">No selected changes.</div>';

  const keptHtml = summary.keptLines.length
    ? summary.keptLines.map(line => `<div class="scenes-recall-preview-empty">${_esc(line)}</div>`).join('')
    : '<div class="scenes-recall-preview-empty">Nothing will be left behind.</div>';

  return `
    <div class="scenes-recall-modal">
      <div class="scenes-recall-summary">
        <strong>${_esc(scene.name ?? _sceneId(scene))}</strong>
        <span>${_esc(summaryText)}</span>
      </div>
      <div class="scenes-recall-scope-list">${scopesHtml}</div>
      <div class="scenes-recall-preview-columns">
        <div class="scenes-recall-preview">
          <div class="scenes-recall-preview-heading">Will Change <span>${summary.selectedCount}</span></div>
          ${selectedHtml}
        </div>
        <div class="scenes-recall-preview">
          <div class="scenes-recall-preview-heading is-muted">Stay Unchanged <span>${summary.keptCount}</span></div>
          ${keptHtml}
        </div>
      </div>
    </div>
  `;
}

function _updateRecallModal(overlay, scene, modalState) {
  const body = overlay?.querySelector('.modal-body');
  const confirmBtn = overlay?.querySelector('.modal-confirm');
  if (!body || !confirmBtn) return;
  const summary = _selectedRecallSummary(modalState);
  body.innerHTML = _recallModalBody(scene, modalState);
  confirmBtn.textContent = summary.selectedCount > 0 ? `Recall Selected (${summary.selectedCount})` : 'Recall Selected';
  confirmBtn.disabled = summary.selectedCount === 0;
}

function _openRecallModal({ scene, sceneId, diff, listPanel, diffPanel }) {
  const diffModel = _normaliseDiff(diff);
  const modalState = {
    diffModel,
    scope: _defaultRecallScope(),
    entitySelection: _buildRecallScopeState(diffModel),
  };

  confirmModal({
    title: `Recall "${scene.name ?? sceneId}"`,
    body: _recallModalBody(scene, modalState),
    confirmLabel: `Recall Selected (${modalState.diffModel.totalChanges})`,
    onConfirm: async () => {
      try {
        const scope = _buildRecallRequestScope(modalState);
        await _loadSceneWithUndo(sceneId, scope);
        _renderList(listPanel, diffPanel);
        await _renderDiff(diffPanel, scene);
        toast(`Scene "${scene.name ?? sceneId}" recalled`);
      } catch(e) {
        toast('Load failed: ' + e.message, true);
      }
    },
  });

  const overlay = document.getElementById('pb-modal-overlay');
  if (!overlay) return;
  overlay.querySelector('.modal-body')?.addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const sectionKey = target.getAttribute('data-recall-scope');
    if (sectionKey) {
      modalState.scope[sectionKey] = target.checked;
      _updateRecallModal(overlay, scene, modalState);
      return;
    }

    const entitySection = target.getAttribute('data-recall-entity-section');
    const entityId = target.getAttribute('data-recall-entity-id');
    if (!entitySection || !entityId) return;
    if (!modalState.entitySelection[entitySection]) {
      modalState.entitySelection[entitySection] = new Set();
    }
    if (target.checked) modalState.entitySelection[entitySection].add(entityId);
    else modalState.entitySelection[entitySection].delete(entityId);
    _updateRecallModal(overlay, scene, modalState);
  });

  _updateRecallModal(overlay, scene, modalState);
}

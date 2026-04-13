// scenes.js — Scenes tab
import * as st  from './state.js';
import * as api from './api.js';
import { toast } from './main.js';

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
  saveBtn.onclick = async () => {
    const name = prompt('Scene name:');
    if (!name) return;
    try {
      const scene = await api.postScene(name);
      st.setScene(scene);
      _renderList(listPanel, diffPanel);
      toast('Scene saved');
    } catch(e) { toast('Save failed: ' + e.message, true); }
  };
  toolbar.appendChild(saveBtn);
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
    const card = document.createElement('div');
    card.className = 'scene-card' + (scene.id === st.state.activeSceneId ? ' scene-card-active' : '');

    const hdr = document.createElement('div');
    hdr.className = 'scene-card-header';
    const nameEl = document.createElement('span');
    nameEl.className = 'scene-name';
    nameEl.textContent = scene.name ?? scene.id;
    const favBtn = document.createElement('button');
    favBtn.className = 'scene-fav-btn' + (scene.is_favourite ? ' fav-on' : '');
    favBtn.title = scene.is_favourite ? 'Unfavourite' : 'Favourite';
    favBtn.textContent = scene.is_favourite ? '★' : '☆';
    favBtn.onclick = async e => {
      e.stopPropagation();
      try {
        await api.putScene(scene.id, { is_favourite: !scene.is_favourite });
        scene.is_favourite = !scene.is_favourite;
        favBtn.className = 'scene-fav-btn' + (scene.is_favourite ? ' fav-on' : '');
        favBtn.title = scene.is_favourite ? 'Unfavourite' : 'Favourite';
        favBtn.textContent = scene.is_favourite ? '★' : '☆';
      } catch(e) { toast('Fav error: ' + e.message, true); }
    };
    hdr.appendChild(nameEl);
    hdr.appendChild(favBtn);
    card.appendChild(hdr);

    if (scene.created_at) {
      const ts = document.createElement('div');
      ts.className = 'scene-ts';
      ts.textContent = new Date(scene.created_at).toLocaleString();
      card.appendChild(ts);
    }

    const actions = document.createElement('div');
    actions.className = 'scene-actions';

    const loadBtn = document.createElement('button');
    loadBtn.className = 'btn-accent';
    loadBtn.textContent = 'Load';
    loadBtn.onclick = async e => {
      e.stopPropagation();
      try {
        await api.loadScene(scene.id);
        st.setActiveScene(scene.id);
        _renderList(listPanel, diffPanel);
        toast(`Scene "${scene.name}" loaded`);
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
      if (!confirm(`Delete scene "${scene.name}"?`)) return;
      try {
        await api.deleteScene(scene.id);
        st.removeScene(scene.id);
        _renderList(listPanel, diffPanel);
        toast('Scene deleted');
      } catch(e) { toast('Delete failed: ' + e.message, true); }
    };

    actions.appendChild(loadBtn);
    actions.appendChild(diffBtn);
    actions.appendChild(delBtn);
    card.appendChild(actions);

    listPanel.appendChild(card);
  });
}

async function _renderDiff(diffPanel, scene) {
  diffPanel.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:10px;">Loading diff…</div>';
  try {
    const diff = await api.getSceneDiff(scene.id);
    diffPanel.innerHTML = '';
    const hdr = document.createElement('div');
    hdr.className = 'scenes-diff-hdr';
    hdr.textContent = `Diff: ${scene.name ?? scene.id}`;
    diffPanel.appendChild(hdr);
    if (!diff || (!diff.routes?.length && !diff.outputs?.length)) {
      diffPanel.innerHTML += '<div style="padding:12px;color:var(--text-muted);font-size:10px;">No differences from current state.</div>';
      return;
    }
    if (diff.routes?.length) {
      const sec = _diffSection('Route Changes', diff.routes.map(r =>
        `${_dir(r.action)} ${r.rx_id} → ${r.tx_id}`
      ));
      diffPanel.appendChild(sec);
    }
    if (diff.outputs?.length) {
      const sec = _diffSection('Output Changes', diff.outputs.map(o =>
        `${o.id}: ${JSON.stringify(o.changes)}`
      ));
      diffPanel.appendChild(sec);
    }
  } catch(e) {
    diffPanel.innerHTML = `<div style="padding:16px;color:var(--color-danger);font-size:10px;">Diff error: ${e.message}</div>`;
  }
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

function _dir(a) { return a === 'add' ? '+' : a === 'remove' ? '−' : '~'; }

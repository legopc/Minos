import { scenes, apiErrorMessage } from '/modules/api.js';

export async function init(container) {
  let sceneList = [];
  let isLoading = false;

  function toast(msg, type = 'success') {
    window.dispatchEvent(new CustomEvent('pb:toast', { detail: { msg, type } }));
  }

  function formatDate(ts) {
    try { return new Date(ts).toLocaleDateString(); } catch { return '—'; }
  }

  function esc(str) {
    return String(str).replace(/[&<>"']/g, c => (
      {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
    ));
  }

  // ── data ──────────────────────────────────────────────────────────────────

  async function loadScenes() {
    try {
      const data = await scenes.list();
      sceneList = (data?.scenes ?? data ?? []).map(s => ({
        ...s,
        safeDesc: esc(s.description || ''),
        safeName: esc(s.name || ''),
      }));
    } catch (err) {
      toast(apiErrorMessage(err), 'error');
      sceneList = [];
    }
    render();
  }

  // ── render ─────────────────────────────────────────────────────────────────

  function render() {
    const activeScene = sceneList.find(s => s.active);
    container.innerHTML = `
      <div class="scenes-page">
        <div class="scenes-toolbar">
          <div class="scenes-toolbar-title">SCENES</div>
          <button class="scenes-new-btn" id="scenes-new-btn">+ NEW SCENE</button>
        </div>
        <div class="scenes-content">
          <div class="scenes-grid" id="scenes-grid">
            ${sceneList.length === 0
              ? '<div class="scenes-empty">No scenes saved yet.</div>'
              : sceneList.map(s => renderCard(s, activeScene)).join('')}
          </div>
        </div>
      </div>

      <!-- Save-As Dialog -->
      <dialog id="dlg-save" class="scenes-dialog">
        <form method="dialog" class="scenes-dialog-form">
          <h2 class="scenes-dialog-title">Save Scene</h2>
          <label>Name<input id="dlg-save-name" type="text" maxlength="64" required /></label>
          <label>Description<textarea id="dlg-save-desc" rows="2" maxlength="255"></textarea></label>
          <div class="scenes-dialog-actions">
            <button type="submit" class="scenes-form-save" id="dlg-save-ok">SAVE</button>
            <button type="button" class="scenes-form-cancel" id="dlg-save-cancel">CANCEL</button>
          </div>
        </form>
      </dialog>

      <!-- Recall Confirm Dialog -->
      <dialog id="dlg-recall" class="scenes-dialog">
        <div class="scenes-dialog-form">
          <h2 class="scenes-dialog-title">Load Scene</h2>
          <p id="dlg-recall-name" class="scenes-dialog-subtitle"></p>
          <pre id="dlg-recall-diff" class="scenes-diff-preview"></pre>
          <div class="scenes-dialog-actions">
            <button class="scenes-form-save" id="dlg-recall-ok">LOAD</button>
            <button class="scenes-form-cancel" id="dlg-recall-cancel">CANCEL</button>
          </div>
        </div>
      </dialog>

      <!-- Rename Dialog -->
      <dialog id="dlg-rename" class="scenes-dialog">
        <form method="dialog" class="scenes-dialog-form">
          <h2 class="scenes-dialog-title">Rename Scene</h2>
          <label>New name<input id="dlg-rename-input" type="text" maxlength="64" required /></label>
          <div class="scenes-dialog-actions">
            <button type="submit" class="scenes-form-save" id="dlg-rename-ok">RENAME</button>
            <button type="button" class="scenes-form-cancel" id="dlg-rename-cancel">CANCEL</button>
          </div>
        </form>
      </dialog>
    `;

    attachListeners();
  }

  function renderCard(scene, activeScene) {
    const isActive = activeScene?.name === scene.name;
    return `
      <div class="scene-card ${isActive ? 'active' : ''}" data-scene="${scene.safeName}">
        ${isActive ? '<div class="scene-card-active-badge">[ACTIVE]</div>' : ''}
        <div class="scene-card-name" title="Double-click to rename" data-name="${scene.safeName}">${scene.safeName}</div>
        <div class="scene-card-desc">${scene.safeDesc}</div>
        <div class="scene-card-date">${formatDate(scene.timestamp)}</div>
        <div class="scene-card-actions">
          <button class="scene-btn-load" data-load="${scene.safeName}">LOAD</button>
          <button class="scene-btn-del"  data-del="${scene.safeName}">DELETE</button>
        </div>
      </div>
    `;
  }

  // ── event listeners ────────────────────────────────────────────────────────

  function attachListeners() {
    // New scene button → open save dialog
    container.querySelector('#scenes-new-btn')?.addEventListener('click', () => {
      openSaveDialog();
    });

    // Load buttons → open recall dialog with diff preview
    container.querySelectorAll('.scene-btn-load').forEach(btn => {
      btn.addEventListener('click', e => openRecallDialog(e.target.getAttribute('data-load')));
    });

    // Delete buttons
    container.querySelectorAll('.scene-btn-del').forEach(btn => {
      btn.addEventListener('click', async e => {
        const name = e.target.getAttribute('data-del');
        if (!confirm(`Delete scene "${name}"?`)) return;
        try {
          isLoading = true;
          await scenes.delete(name);
          toast(`Scene deleted`);
          await loadScenes();
        } catch (err) {
          toast(apiErrorMessage(err), 'error');
        } finally { isLoading = false; }
      });
    });

    // Double-click on name → rename dialog
    container.querySelectorAll('.scene-card-name[data-name]').forEach(el => {
      el.addEventListener('dblclick', () => openRenameDialog(el.getAttribute('data-name')));
    });

    // Save dialog
    const dlgSave = container.querySelector('#dlg-save');
    container.querySelector('#dlg-save-ok')?.addEventListener('click', async e => {
      e.preventDefault();
      const name = (container.querySelector('#dlg-save-name')?.value ?? '').trim();
      const desc = (container.querySelector('#dlg-save-desc')?.value ?? '').trim();
      if (!name) { toast('Scene name required', 'error'); return; }
      if (sceneList.some(s => s.name.toLowerCase() === name.toLowerCase())) {
        toast('Scene name already exists', 'error'); return;
      }
      try {
        isLoading = true;
        await scenes.create(name, desc);
        toast(`Scene "${name}" saved`);
        dlgSave?.close();
        await loadScenes();
      } catch (err) {
        toast(apiErrorMessage(err), 'error');
      } finally { isLoading = false; }
    });
    container.querySelector('#dlg-save-cancel')?.addEventListener('click', () => dlgSave?.close());

    // Recall dialog
    const dlgRecall = container.querySelector('#dlg-recall');
    container.querySelector('#dlg-recall-cancel')?.addEventListener('click', () => dlgRecall?.close());
    container.querySelector('#dlg-recall-ok')?.addEventListener('click', async () => {
      const name = dlgRecall?.dataset.sceneName;
      if (!name) return;
      try {
        isLoading = true;
        await scenes.recall(name);
        toast(`Scene loaded: ${name}`);
        dlgRecall?.close();
        await loadScenes();
      } catch (err) {
        toast(apiErrorMessage(err), 'error');
      } finally { isLoading = false; }
    });

    // Rename dialog
    const dlgRename = container.querySelector('#dlg-rename');
    container.querySelector('#dlg-rename-ok')?.addEventListener('click', async e => {
      e.preventDefault();
      const oldName = dlgRename?.dataset.sceneName;
      const newName = (container.querySelector('#dlg-rename-input')?.value ?? '').trim();
      if (!newName || !oldName) return;
      if (sceneList.some(s => s.name.toLowerCase() === newName.toLowerCase() && s.name !== oldName)) {
        toast('Scene name already exists', 'error'); return;
      }
      try {
        isLoading = true;
        await scenes.rename(oldName, newName);
        toast(`Renamed to "${newName}"`);
        dlgRename?.close();
        await loadScenes();
      } catch (err) {
        toast(apiErrorMessage(err), 'error');
      } finally { isLoading = false; }
    });
    container.querySelector('#dlg-rename-cancel')?.addEventListener('click', () => dlgRename?.close());
  }

  // ── dialog openers ─────────────────────────────────────────────────────────

  function openSaveDialog() {
    const dlg = container.querySelector('#dlg-save');
    if (!dlg) return;
    const nameInput = container.querySelector('#dlg-save-name');
    const descInput = container.querySelector('#dlg-save-desc');
    if (nameInput) nameInput.value = '';
    if (descInput) descInput.value = '';
    dlg.showModal();
    nameInput?.focus();
  }

  async function openRecallDialog(name) {
    const dlg = container.querySelector('#dlg-recall');
    if (!dlg) return;
    dlg.dataset.sceneName = name;
    const nameEl = container.querySelector('#dlg-recall-name');
    const diffEl = container.querySelector('#dlg-recall-diff');
    if (nameEl) nameEl.textContent = `Load: ${name}`;
    if (diffEl) diffEl.textContent = 'Loading diff…';
    dlg.showModal();

    try {
      const diff = await scenes.diff(name);
      if (diffEl) {
        const changes = diff?.changes ?? diff ?? [];
        if (!changes.length) {
          diffEl.textContent = '(No changes — already matches active config)';
        } else {
          diffEl.textContent = changes.map(c => `${c.path ?? c.key ?? ''}: ${JSON.stringify(c.from ?? c.old)} → ${JSON.stringify(c.to ?? c.new)}`).join('\n');
        }
      }
    } catch {
      if (diffEl) diffEl.textContent = '(diff unavailable)';
    }
  }

  function openRenameDialog(name) {
    const dlg = container.querySelector('#dlg-rename');
    if (!dlg) return;
    dlg.dataset.sceneName = name;
    const input = container.querySelector('#dlg-rename-input');
    if (input) input.value = name;
    dlg.showModal();
    input?.select();
  }

  // ── init ──────────────────────────────────────────────────────────────────

  await loadScenes();
  return () => {};
}


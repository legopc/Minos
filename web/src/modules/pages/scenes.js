import { scenes, apiErrorMessage } from '/modules/api.js';

export async function init(container) {
  let sceneList = [];
  let showNewForm = false;
  let isLoading = false;

  function toast(msg, type = 'success') {
    window.dispatchEvent(new CustomEvent('pb:toast', { detail: { msg, type } }));
  }

  function formatDate(timestamp) {
    try {
      return new Date(timestamp).toLocaleDateString();
    } catch {
      return 'N/A';
    }
  }

  function sanitizeHtml(str) {
    return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function loadScenes() {
    try {
      const data = await scenes.list();
      sceneList = (data?.scenes || data || []).map(s => ({
        ...s,
        safeDesc: sanitizeHtml(s.description || ''),
        safeName: sanitizeHtml(s.name || ''),
      }));
    } catch (err) {
      toast(apiErrorMessage(err), 'error');
      sceneList = [];
    }
    render();
  }

  function getActiveScene() {
    return sceneList.find(s => s.active);
  }

  function render() {
    container.innerHTML = `
      <div class="scenes-page">
        <div class="scenes-toolbar">
          <div class="scenes-toolbar-title">SCENES</div>
          <button class="scenes-new-btn" id="new-scene-btn">+ NEW SCENE</button>
        </div>
        <div class="scenes-content">
          <div class="scenes-grid" id="scenes-grid">
            ${showNewForm ? renderNewForm() : ''}
            ${sceneList.length === 0 && !showNewForm ? '<div class="scenes-empty">No scenes saved yet. Click + to save.</div>' : sceneList.map(renderSceneCard).join('')}
          </div>
        </div>
      </div>
    `;

    attachEventListeners();
  }

  function renderNewForm() {
    return `
      <div class="scenes-new-form">
        <input type="text" id="form-name" placeholder="Scene name" required />
        <textarea id="form-desc" placeholder="Description (optional)"></textarea>
        <div class="scenes-new-form-actions">
          <button class="scenes-form-save" id="form-save">SAVE</button>
          <button class="scenes-form-cancel" id="form-cancel">CANCEL</button>
        </div>
      </div>
    `;
  }

  function renderSceneCard(scene) {
    const activeScene = getActiveScene();
    const isActive = activeScene?.name === scene.name;
    return `
      <div class="scene-card ${isActive ? 'active' : ''}">
        ${isActive ? '<div class="scene-card-active-badge">[ACTIVE]</div>' : ''}
        <div class="scene-card-name">${scene.safeName}</div>
        <div class="scene-card-desc">${scene.safeDesc}</div>
        <div class="scene-card-date">${formatDate(scene.timestamp)}</div>
        <div class="scene-card-actions">
          <button class="scene-btn-load" data-load="${scene.safeName}">LOAD</button>
          <button class="scene-btn-del" data-del="${scene.safeName}">DELETE</button>
        </div>
      </div>
    `;
  }

  function attachEventListeners() {
    document.getElementById('new-scene-btn')?.addEventListener('click', () => {
      showNewForm = true;
      render();
      document.getElementById('form-name')?.focus();
    });

    document.getElementById('form-save')?.addEventListener('click', async () => {
      const name = (document.getElementById('form-name')?.value || '').trim();
      const desc = (document.getElementById('form-desc')?.value || '').trim();

      if (!name) {
        toast('Scene name is required', 'error');
        return;
      }

      if (sceneList.some(s => s.name.toLowerCase() === name.toLowerCase())) {
        toast('A scene with that name already exists', 'error');
        return;
      }

      try {
        isLoading = true;
        await scenes.create(name, desc);
        toast(`Scene "${name}" created`, 'success');
        showNewForm = false;
        await loadScenes();
      } catch (err) {
        toast(apiErrorMessage(err), 'error');
      } finally {
        isLoading = false;
      }
    });

    document.getElementById('form-cancel')?.addEventListener('click', () => {
      showNewForm = false;
      render();
    });

    document.querySelectorAll('.scene-btn-load').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const name = e.target.getAttribute('data-load');
        try {
          isLoading = true;
          await scenes.recall(name);
          toast(`Scene loaded: ${name}`, 'success');
          await loadScenes();
        } catch (err) {
          toast(apiErrorMessage(err), 'error');
        } finally {
          isLoading = false;
        }
      });
    });

    document.querySelectorAll('.scene-btn-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const name = e.target.getAttribute('data-del');
        if (confirm(`Delete scene "${name}"?`)) {
          try {
            isLoading = true;
            await scenes.delete(name);
            toast(`Scene deleted`, 'success');
            await loadScenes();
          } catch (err) {
            toast(apiErrorMessage(err), 'error');
          } finally {
            isLoading = false;
          }
        }
      });
    });
  }

  await loadScenes();

  return () => {};
}

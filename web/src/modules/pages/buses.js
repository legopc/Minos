// buses.js — V3 submix buses page

async function busApiFetch(method, path, body) {
  const token = sessionStorage.getItem('pb_token');
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

function dbDisplay(db) {
  return db != null ? `${Number(db).toFixed(1)} dB` : '0.0 dB';
}

function sanitize(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

export async function init(container) {
  let buses = [];
  let showNewForm = false;

  function toast(msg, type = 'info') {
    window.dispatchEvent(new CustomEvent('pb:toast', { detail: { msg, type } }));
  }

  async function loadBuses() {
    try {
      const data = await busApiFetch('GET', '/api/v1/buses');
      buses = data?.buses ?? data ?? [];
    } catch (err) {
      buses = [];
      console.error('Failed to load buses:', err);
    }
  }

  function renderNewForm() {
    return `
      <div class="buses-new-form">
        <input id="bus-name-input" type="text" placeholder="Bus name" autocomplete="off" />
        <div class="buses-new-actions">
          <button class="scene-card-load" id="bus-create-btn">Create</button>
          <button class="scene-card-load" id="bus-cancel-btn">Cancel</button>
        </div>
      </div>`;
  }

  function renderBusCard(bus) {
    const gain = bus.gain_db ?? 0;
    const mutedClass = bus.muted ? ' active' : '';
    return `
      <div class="bus-card" data-bus-id="${sanitize(bus.id)}">
        <div class="bus-card-header">
          <span class="bus-card-name">${sanitize(bus.name)}</span>
        </div>
        <div class="bus-fader-wrap">
          <div class="bus-fader-label">
            <span>Gain</span>
            <span class="bus-gain-display">${dbDisplay(gain)}</span>
          </div>
          <input class="bus-fader" type="range" min="-60" max="0" step="0.5"
            value="${gain}" data-bus-id="${sanitize(bus.id)}" />
        </div>
        <div class="bus-actions">
          <button class="bus-mute-btn${mutedClass}" data-bus-id="${sanitize(bus.id)}">
            ${bus.muted ? 'Unmute' : 'Mute'}
          </button>
          <button class="bus-delete-btn" data-bus-id="${sanitize(bus.id)}">Delete</button>
        </div>
      </div>`;
  }

  function render() {
    const gridContent = buses.length === 0
      ? '<div class="buses-empty">No buses configured.</div>'
      : buses.map(renderBusCard).join('');

    container.innerHTML = `
      <div class="buses-page">
        <div class="buses-toolbar">
          <span class="buses-toolbar-title">BUSES</span>
          <button class="buses-new-btn" id="buses-new-btn">+ NEW BUS</button>
        </div>
        <div class="buses-content">
          ${showNewForm ? renderNewForm() : ''}
          <div class="buses-grid">${gridContent}</div>
        </div>
      </div>`;

    bindEvents();
  }

  function bindEvents() {
    container.querySelector('#buses-new-btn')?.addEventListener('click', () => {
      showNewForm = true;
      render();
      container.querySelector('#bus-name-input')?.focus();
    });

    container.querySelector('#bus-cancel-btn')?.addEventListener('click', () => {
      showNewForm = false;
      render();
    });

    container.querySelector('#bus-create-btn')?.addEventListener('click', async () => {
      const nameEl = container.querySelector('#bus-name-input');
      const name = nameEl?.value?.trim();
      if (!name) return;
      try {
        await busApiFetch('POST', '/api/v1/buses', { name });
        showNewForm = false;
        await loadBuses();
        render();
        toast(`Bus "${name}" created`, 'success');
      } catch (err) {
        toast(`Failed to create bus: ${err.message}`, 'error');
      }
    });

    container.querySelector('#bus-name-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') container.querySelector('#bus-create-btn')?.click();
      if (e.key === 'Escape') container.querySelector('#bus-cancel-btn')?.click();
    });

    container.querySelectorAll('.bus-fader').forEach(slider => {
      let debounceTimer = null;
      slider.addEventListener('input', e => {
        const id = e.target.dataset.busId;
        const db = parseFloat(e.target.value);
        const card = container.querySelector(`.bus-card[data-bus-id="${id}"]`);
        const disp = card?.querySelector('.bus-gain-display');
        if (disp) disp.textContent = dbDisplay(db);
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          try {
            await busApiFetch('PUT', `/api/v1/buses/${id}/gain`, { gain_db: db });
            const bus = buses.find(b => b.id === id);
            if (bus) bus.gain_db = db;
          } catch (err) {
            toast(`Gain update failed: ${err.message}`, 'error');
          }
        }, 200);
      });
    });

    container.querySelectorAll('.bus-mute-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        const id = e.target.dataset.busId;
        const bus = buses.find(b => b.id === id);
        if (!bus) return;
        const muted = !bus.muted;
        try {
          await busApiFetch('PUT', `/api/v1/buses/${id}/mute`, { muted });
          bus.muted = muted;
          render();
        } catch (err) {
          toast(`Mute failed: ${err.message}`, 'error');
        }
      });
    });

    container.querySelectorAll('.bus-delete-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        const id = e.target.dataset.busId;
        const bus = buses.find(b => b.id === id);
        if (!bus) return;
        if (!confirm(`Delete bus "${bus.name}"?`)) return;
        try {
          await busApiFetch('DELETE', `/api/v1/buses/${id}`);
          await loadBuses();
          render();
          toast(`Bus deleted`, 'success');
        } catch (err) {
          toast(`Delete failed: ${err.message}`, 'error');
        }
      });
    });
  }

  container.innerHTML = '<div class="page-loading">Loading…</div>';

  await loadBuses();
  render();

  return function cleanup() {};
}

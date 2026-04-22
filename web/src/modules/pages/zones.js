// zones.js — V3 bar-staff zone view

async function zoneApiFetch(method, path, body) {
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
  return String(str ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

export async function init(container) {
  let zones = [];
  let inputs = [];
  let pollId = null;

  function toast(msg, type = 'info') {
    window.dispatchEvent(new CustomEvent('pb:toast', { detail: { msg, type } }));
  }

  async function loadData() {
    try {
      const config = await zoneApiFetch('GET', '/api/v1/config');
      zones = config?.zones ?? config?.outputs ?? [];
      inputs = config?.inputs ?? config?.sources ?? [];
    } catch (err) {
      console.error('Failed to load zone config:', err);
      zones = [];
      inputs = [];
    }
  }

  function renderSourceOptions(zone) {
    const currentSource = zone.source ?? '';
    const opts = inputs.map(inp => {
      const id = typeof inp === 'string' ? inp : inp.id ?? inp.name ?? '';
      const label = typeof inp === 'string' ? inp : inp.name ?? id;
      const sel = id === currentSource ? ' selected' : '';
      return `<option value="${sanitize(id)}"${sel}>${sanitize(label)}</option>`;
    }).join('');
    return `<option value="">— None —</option>${opts}`;
  }

  function renderZoneCard(zone) {
    const id = zone.id ?? zone.name;
    const gain = zone.gain_db ?? 0;
    const mutedClass = zone.muted ? ' active' : '';
    return `
      <div class="zone-card" data-zone-id="${sanitize(id)}">
        <div class="zone-card-header">
          <span class="zone-card-name">${sanitize(zone.name ?? id)}</span>
          ${zone.muted ? '<span class="zone-card-badge">MUTED</span>' : ''}
        </div>
        ${inputs.length > 0 ? `
        <select class="zone-source-select" data-zone-id="${sanitize(id)}">
          ${renderSourceOptions(zone)}
        </select>` : ''}
        <div class="zone-fader-wrap">
          <div class="zone-fader-label">
            <span>Volume</span>
            <span class="zone-gain-display">${dbDisplay(gain)}</span>
          </div>
          <input class="zone-fader" type="range" min="-60" max="0" step="0.5"
            value="${gain}" data-zone-id="${sanitize(id)}" />
        </div>
        <button class="zone-mute-btn${mutedClass}" data-zone-id="${sanitize(id)}">
          ${zone.muted ? 'Unmute' : 'Mute'}
        </button>
      </div>`;
  }

  function render() {
    const gridContent = zones.length === 0
      ? '<div class="zones-empty">No zones configured.</div>'
      : zones.map(renderZoneCard).join('');

    container.innerHTML = `
      <div class="zones-page">
        <div class="zones-toolbar">
          <span class="zones-toolbar-title">ZONES</span>
        </div>
        <div class="zones-content">
          <div class="zones-grid">${gridContent}</div>
        </div>
      </div>`;

    bindEvents();
  }

  function bindEvents() {
    container.querySelectorAll('.zone-source-select').forEach(sel => {
      sel.addEventListener('change', async e => {
        const id = e.target.dataset.zoneId;
        const source = e.target.value;
        try {
          await zoneApiFetch('PUT', '/api/v1/matrix', { tx: source, rx: id, enabled: !!source });
          const zone = zones.find(z => (z.id ?? z.name) === id);
          if (zone) zone.source = source;
        } catch (err) {
          toast(`Routing update failed: ${err.message}`, 'error');
        }
      });
    });

    container.querySelectorAll('.zone-fader').forEach(slider => {
      let debounceTimer = null;
      slider.addEventListener('input', e => {
        const id = e.target.dataset.zoneId;
        const db = parseFloat(e.target.value);
        const card = container.querySelector(`.zone-card[data-zone-id="${id}"]`);
        const disp = card?.querySelector('.zone-gain-display');
        if (disp) disp.textContent = dbDisplay(db);
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          try {
            await zoneApiFetch('PUT', `/api/v1/zones/${id}/gain`, { gain_db: db });
            const zone = zones.find(z => (z.id ?? z.name) === id);
            if (zone) zone.gain_db = db;
          } catch (err) {
            toast(`Gain update failed: ${err.message}`, 'error');
          }
        }, 200);
      });
    });

    container.querySelectorAll('.zone-mute-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        const id = e.target.dataset.zoneId;
        const zone = zones.find(z => (z.id ?? z.name) === id);
        if (!zone) return;
        const muted = !zone.muted;
        try {
          await zoneApiFetch('PUT', `/api/v1/zones/${id}/mute`, { muted });
          zone.muted = muted;
          render();
        } catch (err) {
          toast(`Mute failed: ${err.message}`, 'error');
        }
      });
    });
  }

  container.innerHTML = '<div class="page-loading">Loading…</div>';

  await loadData();
  render();

  return function cleanup() {
    if (pollId !== null) { clearInterval(pollId); pollId = null; }
  };
}

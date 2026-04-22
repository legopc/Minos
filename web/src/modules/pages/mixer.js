// mixer.js — VCA groups, stereo links, signal generators, buses, and DSP presets

import { presets as presetsApi, outputDsp, apiErrorMessage } from '/modules/api.js';

async function mixerApiFetch(method, path, body) {
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

function sanitize(str) {
  return String(str ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function dbDisplay(db) {
  return db != null ? `${Number(db).toFixed(1)} dB` : '0.0 dB';
}

// ── VCA Groups ────────────────────────────────────────────────────────────────

function renderVcaCard(vca) {
  const gain = vca.gain_db ?? 0;
  return `
    <div class="mixer-card vca-card" data-vca-id="${sanitize(vca.id)}">
      <div class="mixer-card-header">
        <span class="mixer-card-label">${sanitize(vca.name ?? vca.id)}</span>
        <span class="mixer-card-tag">VCA</span>
      </div>
      <div class="mixer-card-body">
        <div class="mixer-fader-row">
          <input type="range" class="mixer-fader" data-role="vca-gain"
            min="-80" max="12" step="0.1" value="${gain}"
            aria-label="VCA gain for ${sanitize(vca.name ?? vca.id)}" />
          <span class="mixer-fader-val">${dbDisplay(gain)}</span>
        </div>
        <div class="mixer-card-members">
          ${(vca.members ?? []).map(m => `<span class="mixer-chip">${sanitize(m)}</span>`).join('')}
        </div>
      </div>
      <div class="mixer-card-actions">
        <button class="mixer-btn btn-del-vca" data-vca-id="${sanitize(vca.id)}">Remove</button>
      </div>
    </div>`;
}

// ── Stereo Links ──────────────────────────────────────────────────────────────

function renderStereoLinkCard(link) {
  return `
    <div class="mixer-card stereo-link-card" data-left="${link.left_ch}">
      <div class="mixer-card-header">
        <span class="mixer-card-label">CH ${link.left_ch} / ${link.right_ch}</span>
        <span class="mixer-card-tag">STEREO</span>
      </div>
      <div class="mixer-card-body">
        <span class="mixer-detail">Width: ${sanitize(link.width_pct != null ? link.width_pct + '%' : '100%')}</span>
      </div>
      <div class="mixer-card-actions">
        <button class="mixer-btn btn-del-stereo" data-left="${link.left_ch}">Remove</button>
      </div>
    </div>`;
}

// ── Signal Generators ─────────────────────────────────────────────────────────

function renderGeneratorCard(gen) {
  const typeLabels = { sine: 'Sine', pink: 'Pink Noise', white: 'White Noise' };
  return `
    <div class="mixer-card gen-card" data-gen-id="${sanitize(gen.id)}">
      <div class="mixer-card-header">
        <span class="mixer-card-label">${sanitize(gen.name ?? gen.id)}</span>
        <span class="mixer-card-tag">GEN</span>
      </div>
      <div class="mixer-card-body">
        <span class="mixer-detail">${typeLabels[gen.type] ?? gen.type}</span>
        ${gen.type === 'sine' ? `<span class="mixer-detail">${gen.frequency_hz ?? 1000} Hz</span>` : ''}
        <div class="mixer-fader-row">
          <input type="range" class="mixer-fader" data-role="gen-level"
            min="-80" max="0" step="0.1" value="${gen.level_db ?? -18}"
            aria-label="Level for ${sanitize(gen.name ?? gen.id)}" />
          <span class="mixer-fader-val">${dbDisplay(gen.level_db ?? -18)}</span>
        </div>
      </div>
      <div class="mixer-card-actions">
        <button class="mixer-btn ${gen.enabled ? 'btn-active' : ''}" data-role="gen-toggle" data-gen-id="${sanitize(gen.id)}" data-enabled="${gen.enabled}">
          ${gen.enabled ? 'ON' : 'OFF'}
        </button>
        <button class="mixer-btn btn-del-gen" data-gen-id="${sanitize(gen.id)}">Remove</button>
      </div>
    </div>`;
}

// ── New VCA Form ──────────────────────────────────────────────────────────────

function renderNewVcaForm() {
  return `
    <div class="mixer-new-form" id="mixer-new-vca-form" hidden>
      <input class="mixer-input" id="vca-name-input" placeholder="VCA name" maxlength="32" />
      <button class="mixer-btn btn-primary" id="vca-create-btn">Create VCA</button>
      <button class="mixer-btn" id="vca-cancel-btn">Cancel</button>
    </div>`;
}

// ── New Generator Form ────────────────────────────────────────────────────────

function renderNewGenForm() {
  return `
    <div class="mixer-new-form" id="mixer-new-gen-form" hidden>
      <input class="mixer-input" id="gen-name-input" placeholder="Generator name" maxlength="32" />
      <select class="mixer-select" id="gen-type-select">
        <option value="sine">Sine</option>
        <option value="pink">Pink Noise</option>
        <option value="white">White Noise</option>
      </select>
      <input class="mixer-input" id="gen-freq-input" placeholder="Freq Hz (sine)" type="number" min="20" max="20000" value="1000" />
      <button class="mixer-btn btn-primary" id="gen-create-btn">Create Generator</button>
      <button class="mixer-btn" id="gen-cancel-btn">Cancel</button>
    </div>`;
}

// ── Page Render ───────────────────────────────────────────────────────────────

function buildHtml(vcas, stereoLinks, generators) {
  const vcaCards = vcas.length
    ? vcas.map(renderVcaCard).join('')
    : '<p class="mixer-empty">No VCA groups configured.</p>';

  const stereoCards = stereoLinks.length
    ? stereoLinks.map(renderStereoLinkCard).join('')
    : '<p class="mixer-empty">No stereo links configured.</p>';

  const genCards = generators.length
    ? generators.map(renderGeneratorCard).join('')
    : '<p class="mixer-empty">No signal generators configured.</p>';

  return `
    <div class="mixer-page">
      <div class="mixer-toolbar">
        <span class="mixer-toolbar-title">MIXER</span>
      </div>
      <div class="mixer-content">

        <section class="mixer-section" aria-label="VCA groups">
          <div class="mixer-section-header">
            <h2 class="mixer-section-title">VCA GROUPS</h2>
            <button class="mixer-btn btn-primary" id="btn-new-vca">+ NEW</button>
          </div>
          ${renderNewVcaForm()}
          <div class="mixer-cards" id="vca-cards">${vcaCards}</div>
        </section>

        <section class="mixer-section" aria-label="Stereo links">
          <div class="mixer-section-header">
            <h2 class="mixer-section-title">STEREO LINKS</h2>
          </div>
          <div class="mixer-cards" id="stereo-cards">${stereoCards}</div>
        </section>

        <section class="mixer-section" aria-label="Signal generators">
          <div class="mixer-section-header">
            <h2 class="mixer-section-title">GENERATORS</h2>
            <button class="mixer-btn btn-primary" id="btn-new-gen">+ NEW</button>
          </div>
          ${renderNewGenForm()}
          <div class="mixer-cards" id="gen-cards">${genCards}</div>
        </section>

      </div>
    </div>`;
}

// ── Event Wiring ──────────────────────────────────────────────────────────────

function wireVcaFaders(container, vcas) {
  container.querySelectorAll('.vca-card').forEach(card => {
    const id = card.dataset.vcaId;
    const fader = card.querySelector('[data-role="vca-gain"]');
    const val = card.querySelector('.mixer-fader-val');
    if (!fader) return;
    fader.addEventListener('input', () => {
      val.textContent = dbDisplay(parseFloat(fader.value));
    });
    fader.addEventListener('change', async () => {
      const db = parseFloat(fader.value);
      try {
        await mixerApiFetch('PUT', `/api/v1/vca-groups/${encodeURIComponent(id)}`, { gain_db: db });
      } catch (e) {
        window.dispatchEvent(new CustomEvent('pb:toast', { detail: { msg: `VCA gain error: ${e.message}`, type: 'error' } }));
      }
    });
  });
}

function wireGenFaders(container) {
  container.querySelectorAll('.gen-card').forEach(card => {
    const id = card.dataset.genId;
    const fader = card.querySelector('[data-role="gen-level"]');
    const val = card.querySelector('.mixer-fader-val');
    if (!fader) return;
    fader.addEventListener('input', () => {
      val.textContent = dbDisplay(parseFloat(fader.value));
    });
    fader.addEventListener('change', async () => {
      const db = parseFloat(fader.value);
      try {
        await mixerApiFetch('PUT', `/api/v1/signal-generators/${encodeURIComponent(id)}`, { level_db: db });
      } catch (e) {
        window.dispatchEvent(new CustomEvent('pb:toast', { detail: { msg: `Generator level error: ${e.message}`, type: 'error' } }));
      }
    });

    // Toggle enable/disable
    const toggleBtn = card.querySelector('[data-role="gen-toggle"]');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', async () => {
        const enabled = toggleBtn.dataset.enabled === 'true';
        try {
          await mixerApiFetch('PUT', `/api/v1/signal-generators/${encodeURIComponent(id)}`, { enabled: !enabled });
          toggleBtn.dataset.enabled = String(!enabled);
          toggleBtn.textContent = !enabled ? 'ON' : 'OFF';
          toggleBtn.classList.toggle('btn-active', !enabled);
        } catch (e) {
          window.dispatchEvent(new CustomEvent('pb:toast', { detail: { msg: `Generator toggle error: ${e.message}`, type: 'error' } }));
        }
      });
    }
  });
}

function wireDeleteButtons(container, reload) {
  container.querySelectorAll('.btn-del-vca').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.vcaId;
      if (!confirm(`Delete VCA group "${id}"?`)) return;
      try {
        await mixerApiFetch('DELETE', `/api/v1/vca-groups/${encodeURIComponent(id)}`);
        reload();
      } catch (e) {
        window.dispatchEvent(new CustomEvent('pb:toast', { detail: { msg: `Delete VCA error: ${e.message}`, type: 'error' } }));
      }
    });
  });
  container.querySelectorAll('.btn-del-stereo').forEach(btn => {
    btn.addEventListener('click', async () => {
      const left = btn.dataset.left;
      if (!confirm(`Remove stereo link for ch ${left}?`)) return;
      try {
        await mixerApiFetch('DELETE', `/api/v1/stereo-links/${encodeURIComponent(left)}`);
        reload();
      } catch (e) {
        window.dispatchEvent(new CustomEvent('pb:toast', { detail: { msg: `Delete stereo link error: ${e.message}`, type: 'error' } }));
      }
    });
  });
  container.querySelectorAll('.btn-del-gen').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.genId;
      if (!confirm(`Delete generator "${id}"?`)) return;
      try {
        await mixerApiFetch('DELETE', `/api/v1/signal-generators/${encodeURIComponent(id)}`);
        reload();
      } catch (e) {
        window.dispatchEvent(new CustomEvent('pb:toast', { detail: { msg: `Delete generator error: ${e.message}`, type: 'error' } }));
      }
    });
  });
}

function wireNewVca(container, reload) {
  const btnNew = container.querySelector('#btn-new-vca');
  const form = container.querySelector('#mixer-new-vca-form');
  const nameInput = container.querySelector('#vca-name-input');
  const createBtn = container.querySelector('#vca-create-btn');
  const cancelBtn = container.querySelector('#vca-cancel-btn');

  btnNew?.addEventListener('click', () => { form.hidden = false; nameInput.focus(); });
  cancelBtn?.addEventListener('click', () => { form.hidden = true; nameInput.value = ''; });
  createBtn?.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) return;
    try {
      await mixerApiFetch('POST', '/api/v1/vca-groups', { name });
      form.hidden = true;
      nameInput.value = '';
      reload();
    } catch (e) {
      window.dispatchEvent(new CustomEvent('pb:toast', { detail: { msg: `Create VCA error: ${e.message}`, type: 'error' } }));
    }
  });
}

function wireNewGen(container, reload) {
  const btnNew = container.querySelector('#btn-new-gen');
  const form = container.querySelector('#mixer-new-gen-form');
  const nameInput = container.querySelector('#gen-name-input');
  const typeSelect = container.querySelector('#gen-type-select');
  const freqInput = container.querySelector('#gen-freq-input');
  const createBtn = container.querySelector('#gen-create-btn');
  const cancelBtn = container.querySelector('#gen-cancel-btn');

  btnNew?.addEventListener('click', () => { form.hidden = false; nameInput.focus(); });
  cancelBtn?.addEventListener('click', () => { form.hidden = true; nameInput.value = ''; });
  createBtn?.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) return;
    const body = { name, type: typeSelect.value, level_db: -18, enabled: false };
    if (typeSelect.value === 'sine') body.frequency_hz = parseFloat(freqInput.value) || 1000;
    try {
      await mixerApiFetch('POST', '/api/v1/signal-generators', body);
      form.hidden = true;
      nameInput.value = '';
      reload();
    } catch (e) {
      window.dispatchEvent(new CustomEvent('pb:toast', { detail: { msg: `Create generator error: ${e.message}`, type: 'error' } }));
    }
  });
}

// ── Page Lifecycle ────────────────────────────────────────────────────────────

export async function init(container) {
  async function loadData() {
    const [vcaRes, stereoRes, genRes] = await Promise.allSettled([
      mixerApiFetch('GET', '/api/v1/vca-groups'),
      mixerApiFetch('GET', '/api/v1/stereo-links'),
      mixerApiFetch('GET', '/api/v1/signal-generators'),
    ]);
    return {
      vcas: vcaRes.status === 'fulfilled' ? (vcaRes.value?.vca_groups ?? vcaRes.value ?? []) : [],
      stereoLinks: stereoRes.status === 'fulfilled' ? (stereoRes.value?.stereo_links ?? stereoRes.value ?? []) : [],
      generators: genRes.status === 'fulfilled' ? (genRes.value?.generators ?? genRes.value ?? []) : [],
    };
  }

  async function reload() {
    const { vcas, stereoLinks, generators } = await loadData();
    container.innerHTML = buildHtml(vcas, stereoLinks, generators);
    wireVcaFaders(container, vcas);
    wireGenFaders(container);
    wireDeleteButtons(container, reload);
    wireNewVca(container, reload);
    wireNewGen(container, reload);
  }

  await reload();

  // ── DSP Presets Panel ──────────────────────────────────────────────────────
  let _allPresets = {};

  const BLOCK_LABELS = { peq: 'PEQ', cmp: 'Compressor', lim: 'Limiter', deq: 'Dynamic EQ', dly: 'Delay', duck: 'Ducker' };

  function buildPresetsSection() {
    const sec = document.createElement('div');
    sec.className = 'preset-manager-section';
    sec.innerHTML = `
      <div class="preset-manager-header">─ DSP PRESETS</div>
      <div class="preset-manager-controls">
        <select id="pm-block-filter">
          <option value="">All blocks</option>
          ${Object.entries(BLOCK_LABELS).map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
        <button id="pm-refresh-btn" class="btn-secondary">Refresh</button>
      </div>
      <table class="preset-list-table">
        <thead><tr><th>Name</th><th>Block</th><th>Actions</th></tr></thead>
        <tbody id="pm-preset-body"><tr><td colspan="3" class="text-dim">Loading…</td></tr></tbody>
      </table>
      <div class="preset-save-section">
        <input type="text" id="pm-preset-name" placeholder="Preset name…" class="preset-name-input">
        <select id="pm-save-block">
          ${Object.entries(BLOCK_LABELS).map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
        <input type="number" id="pm-save-channel" placeholder="Ch #" min="0" max="63" value="0" class="preset-ch-input">
        <button id="pm-save-btn" class="btn-secondary">Save Preset</button>
        <span id="pm-save-status" class="system-action-status"></span>
      </div>
      <dialog id="pm-recall-dialog">
        <form method="dialog">
          <div class="dialog-header">Recall Preset</div>
          <div class="dialog-body">
            <div class="dialog-field">Name: <strong id="pm-recall-name-label"></strong></div>
            <div class="dialog-field">
              <label>Apply to output channel: <input type="number" id="pm-recall-ch" value="0" min="0" max="63"></label>
            </div>
            <pre id="pm-recall-params" class="preset-params-preview"></pre>
          </div>
          <div class="dialog-actions">
            <button type="button" id="pm-recall-apply-btn" class="btn-primary">Apply</button>
            <button value="cancel">Cancel</button>
          </div>
        </form>
      </dialog>
    `;
    container.appendChild(sec);
    return sec;
  }

  const DSP_BLOCK_FIELD = { peq: 'peq', cmp: 'compressor', lim: 'limiter', deq: 'deq', dly: 'delay', duck: 'ducker' };

  async function pmLoadPresets() {
    const tbody = container.querySelector('#pm-preset-body');
    try {
      _allPresets = await presetsApi.list();
      pmRenderTable();
    } catch (err) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="3" class="text-dim">Error: ${sanitize(apiErrorMessage(err))}</td></tr>`;
    }
  }

  function pmRenderTable() {
    const tbody = container.querySelector('#pm-preset-body');
    const filter = container.querySelector('#pm-block-filter')?.value ?? '';
    if (!tbody) return;
    const rows = [];
    for (const [block, entries] of Object.entries(_allPresets)) {
      if (filter && block !== filter) continue;
      for (const [name, params] of Object.entries(entries)) {
        rows.push({ block, name, params });
      }
    }
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-dim">No presets saved.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(({ block, name, params }) => `
      <tr>
        <td>${sanitize(name)}</td>
        <td>${sanitize(BLOCK_LABELS[block] ?? block)}</td>
        <td>
          <button class="mixer-btn pm-recall-btn" data-name="${sanitize(name)}" data-block="${sanitize(block)}"
            data-params="${sanitize(JSON.stringify(params))}">Recall</button>
          <button class="mixer-btn btn-del-preset" data-name="${sanitize(name)}" data-block="${sanitize(block)}">Delete</button>
        </td>
      </tr>`).join('');
  }

  function pmSetStatus(text, isError = false) {
    const el = container.querySelector('#pm-save-status');
    if (!el) return;
    el.textContent = text;
    el.style.color = isError ? 'var(--danger, #e55)' : '';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.textContent = ''; el.style.color = ''; }, 4000);
  }

  function wirePresetsPanel(sec) {
    sec.querySelector('#pm-refresh-btn').addEventListener('click', pmLoadPresets);
    sec.querySelector('#pm-block-filter').addEventListener('change', pmRenderTable);

    sec.querySelector('#pm-save-btn').addEventListener('click', async () => {
      const name  = sec.querySelector('#pm-preset-name').value.trim();
      const block = sec.querySelector('#pm-save-block').value;
      const ch    = parseInt(sec.querySelector('#pm-save-channel').value, 10);
      if (!name) { pmSetStatus('Enter a preset name.', true); return; }
      if (isNaN(ch)) { pmSetStatus('Enter a valid channel.', true); return; }
      try {
        const dsp = await outputDsp.get(ch);
        const field = DSP_BLOCK_FIELD[block];
        const params = field ? (dsp[field] ?? dsp) : dsp;
        await presetsApi.save(name, block, params);
        pmSetStatus(`Saved "${name}".`);
        await pmLoadPresets();
      } catch (err) {
        pmSetStatus(apiErrorMessage(err), true);
      }
    });

    const dialog = sec.querySelector('#pm-recall-dialog');
    let _recallPending = null;

    sec.addEventListener('click', async (e) => {
      const recallBtn = e.target.closest('.pm-recall-btn');
      if (recallBtn) {
        const name   = recallBtn.dataset.name;
        const block  = recallBtn.dataset.block;
        const params = JSON.parse(recallBtn.dataset.params);
        _recallPending = { name, block, params };
        sec.querySelector('#pm-recall-name-label').textContent = `${name} (${BLOCK_LABELS[block] ?? block})`;
        sec.querySelector('#pm-recall-params').textContent = JSON.stringify(params, null, 2);
        dialog.showModal();
        return;
      }
      const delBtn = e.target.closest('.btn-del-preset');
      if (delBtn) {
        const { name, block } = delBtn.dataset;
        if (!confirm(`Delete preset "${name}" (${BLOCK_LABELS[block] ?? block})?`)) return;
        try {
          await presetsApi.delete(name, block);
          await pmLoadPresets();
        } catch (err) {
          alert(apiErrorMessage(err));
        }
      }
    });

    sec.querySelector('#pm-recall-apply-btn').addEventListener('click', async () => {
      if (!_recallPending) return;
      const ch = parseInt(sec.querySelector('#pm-recall-ch').value, 10);
      if (isNaN(ch)) { alert('Invalid channel number.'); return; }
      const { block, params } = _recallPending;
      try {
        const setters = {
          peq:  (c, p) => outputDsp.setEq(c, p),
          cmp:  (c, p) => outputDsp.setCompressor(c, p),
          lim:  (c, p) => outputDsp.setLimiter(c, p),
          deq:  (c, p) => outputDsp.setDeq(c, p),
          dly:  (c, p) => outputDsp.setDelay(c, p),
        };
        if (setters[block]) {
          await setters[block](ch, params);
        } else {
          // duck and others — use generic PUT via fetch
          await fetch(`/api/v1/outputs/${ch}/dsp/${block}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json',
              ...(sessionStorage.getItem('pb_token') ? { Authorization: `Bearer ${sessionStorage.getItem('pb_token')}` } : {}) },
            body: JSON.stringify(params),
          });
        }
        dialog.close();
        _recallPending = null;
      } catch (err) {
        alert(apiErrorMessage(err));
      }
    });
  }

  const presetsSec = buildPresetsSection();
  wirePresetsPanel(presetsSec);
  await pmLoadPresets();
}

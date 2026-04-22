import { matrix, inputDsp } from '/modules/api.js';

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// Zone accent colours — cycled by zone index using CSS variables for consistency.
const ZONE_COLORS = [
  'var(--color-accent)',
  '#a78bfa',
  '#34d399',
  '#fb923c',
  '#f472b6',
  '#38bdf8',
  '#facc15',
  '#a3e635',
];

function zoneColor(tx) {
  return ZONE_COLORS[tx % ZONE_COLORS.length];
}

export async function init(container) {
  let config = null;
  let meterData = {
    tx_rms:      [],
    rx_rms:      [],
    tx_peak:     [],
    rx_peak:     [],
    tx_gr_db:    [],
    rx_gr_db:    [],
    rx_gate_open:[],
  };
  // Map from rx index → boolean (any DSP block enabled on that input)
  let dspEnabled = {};
  // Current search filter string
  let filterText = '';
  // Zone filter — Set of zone indices to show (empty = all zones)
  let zoneFilter = new Set();
  // Currently focused cell coords for keyboard nav
  let focusedCell = null;

  // Fetch initial config and DSP state in parallel
  let sources, zones, matrixData;
  try {
    config = await matrix.get();
    sources    = config.sources || [];
    zones      = config.zones   || [];
    matrixData = config.matrix  || [];
  } catch (err) {
    container.innerHTML = `<div class="page-placeholder"><h2>MATRIX</h2><p class="text-dim">Failed to load config: ${err.message}</p></div>`;
    return () => {};
  }

  // Load DSP enabled state for all inputs asynchronously (non-blocking).
  // Failure is silent — badges just won't appear.
  async function refreshDspBadges() {
    const results = await Promise.allSettled(
      sources.map((_, rx) => inputDsp.get(rx))
    );
    results.forEach((r, rx) => {
      if (r.status !== 'fulfilled' || !r.value) return;
      const d = r.value;
      dspEnabled[rx] = !!(
        d.eq?.enabled || d.gate?.enabled || d.compressor?.enabled ||
        d.hpf?.enabled || d.lpf?.enabled || d.afs?.enabled ||
        d.aec?.enabled || d.axm?.enabled || d.deq?.enabled
      );
    });
  }

  await refreshDspBadges();

  // Render page shell
  container.className = 'matrix-page';
  container.innerHTML = `
    <div class="matrix-toolbar">
      <div class="matrix-toolbar-title">ROUTING MATRIX</div>
      <input
        id="matrix-search"
        class="matrix-search-input"
        type="search"
        placeholder="Filter sources…"
        autocomplete="off"
        aria-label="Filter source rows"
      />
      <div class="zone-filter-pills" id="zone-filter-pills" role="group" aria-label="Filter by zone"></div>
      <button class="icon-btn" id="matrix-refresh-btn" title="Refresh">↺</button>
    </div>
    <div class="matrix-scroll">
      <table
        class="matrix-table"
        id="matrix-table"
        role="grid"
        aria-label="Routing matrix"
      ></table>
    </div>
  `;

  const tableEl    = container.querySelector('#matrix-table');
  const refreshBtn = container.querySelector('#matrix-refresh-btn');
  const searchEl   = container.querySelector('#matrix-search');

  if (sources.length === 0 || zones.length === 0) {
    tableEl.innerHTML = `<tr><td class="matrix-empty">No sources or zones configured</td></tr>`;
    return () => {};
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  function visibleZones() {
    if (zoneFilter.size === 0) return zones.map((z, i) => ({ zone: z, tx: i }));
    return zones
      .map((z, i) => ({ zone: z, tx: i }))
      .filter(({ tx }) => zoneFilter.has(tx));
  }

  function visibleSources() {
    if (!filterText) return sources.map((s, i) => ({ source: s, rx: i }));
    const q = filterText.toLowerCase();
    return sources
      .map((s, i) => ({ source: s, rx: i }))
      .filter(({ source }) => (source.name || source).toLowerCase().includes(q));
  }

  function isSourceRouted(rx) {
    return zones.some((_, tx) => matrixData[tx]?.[rx]);
  }

  function renderZonePills() {
    const container = document.getElementById('zone-filter-pills');
    if (!container) return;
    container.innerHTML = zones.map((z, tx) => {
      const active = zoneFilter.size === 0 || zoneFilter.has(tx);
      const color = zoneColor(tx);
      return `<button class="zone-pill ${active ? 'active' : ''}"
        data-tx="${tx}"
        style="--zone-color:${color}"
        aria-pressed="${active}"
        title="${esc(z.name || z)}">${esc(z.name || `TX ${tx + 1}`)}</button>`;
    }).join('');

    container.querySelectorAll('.zone-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const tx = parseInt(btn.dataset.tx);
        if (zoneFilter.has(tx)) {
          zoneFilter.delete(tx);
        } else {
          zoneFilter.add(tx);
        }
        renderZonePills();
        renderTable();
      });
    });
  }

  function renderTable() {
    const rows = visibleSources();
    const visibleZoneList = visibleZones();

    let html = '<thead><tr><th class="matrix-corner-th" scope="col"></th>';
    visibleZoneList.forEach(({ zone, tx }) => {
      const color = zoneColor(tx);
      const txRms   = meterData.tx_rms[tx]  ?? -Infinity;
      const barW    = getRmsBarWidth(txRms);
      html += `
        <th class="matrix-th-zone" data-tx="${tx}" scope="col"
            style="--zone-color:${color}" title="${esc(zone.name || zone)}">
          <div class="matrix-th-name">${esc(zone.name || zone)}</div>
          <div class="matrix-th-bar-wrap">
            <div class="matrix-th-bar" style="width:${barW}%;background:${color}"></div>
          </div>
        </th>`;
    });
    html += '</tr></thead><tbody>';

    rows.forEach(({ source, rx }) => {
      const rxRms = meterData.rx_rms[rx] ?? -Infinity;
      const barW  = getRmsBarWidth(rxRms);
      const badge = dspEnabled[rx]
        ? '<span class="matrix-dsp-badge" title="DSP active">DSP</span>'
        : '';
      const routed = isSourceRouted(rx);
      const unroutedWarn = !routed ? '<span class="matrix-unrouted-dot" title="Unrouted to any zone" aria-label="Unrouted"></span>' : '';
      const gateOpen = meterData.rx_gate_open[rx];
      const gateClass = gateOpen === false ? ' gate-closed' : '';

      html += `
        <tr class="matrix-row${gateClass}" data-rx="${rx}">
          <th class="matrix-row-th matrix-th-source" data-rx="${rx}" scope="row">
            <div class="matrix-source-label">
              <span class="matrix-th-name" title="${esc(source.name || source)}">${esc(source.name || source)}</span>
              ${badge}${unroutedWarn}
            </div>
            <div class="matrix-th-bar-wrap">
              <div class="matrix-th-bar" style="width:${barW}%"></div>
            </div>
          </th>`;

      visibleZoneList.forEach(({ zone, tx }) => {
        const routed  = matrixData[tx]?.[rx] ? 1 : 0;
        const color   = zoneColor(tx);
        const focused = focusedCell?.tx === tx && focusedCell?.rx === rx;
        html += `
          <td class="matrix-cell${routed ? ' routed' : ''}${focused ? ' kb-focus' : ''}"
              data-tx="${tx}" data-rx="${rx}"
              role="gridcell"
              tabindex="${focused ? '0' : '-1'}"
              aria-label="${esc((source.name || source))} → ${esc(zone.name || zone)}"
              aria-pressed="${routed ? 'true' : 'false'}"
              ${routed ? `style="background:${getRmsColor(meterData.rx_rms[rx] ?? -Infinity, color)}"` : ''}>
            ${routed ? '<span class="matrix-cell-dot" aria-hidden="true"></span>' : ''}
          </td>`;
      });

      html += '</tr>';
    });

    html += '</tbody>';
    tableEl.innerHTML = html;

    // Attach click handlers
    tableEl.querySelectorAll('.matrix-cell').forEach(cell => {
      cell.addEventListener('click', onCellClick);
    });

    // Focus the focused cell if keyboard is active
    if (focusedCell) {
      const el = tableEl.querySelector(
        `.matrix-cell[data-tx="${focusedCell.tx}"][data-rx="${focusedCell.rx}"]`
      );
      if (el) el.focus({ preventScroll: true });
    }
  }

  // ── Meter helpers ───────────────────────────────────────────────────────────

  function getRmsBarWidth(rms) {
    if (!isFinite(rms) || rms <= -80) return 0;
    if (rms >= 0) return 100;
    return Math.max(0, Math.min(100, ((rms + 80) / 80) * 100));
  }

  function getRmsColor(rms, zColor = 'var(--color-accent)') {
    if (!isFinite(rms) || rms <= -40) return 'transparent';
    const alpha = rms <= -20 ? 0.15 : rms <= -6 ? 0.35 : 0.6;
    // Use CSS color-mix when supported; fallback to transparent tint
    return `color-mix(in srgb, ${zColor} ${Math.round(alpha * 100)}%, transparent)`;
  }

  // ── Live visual update (no full re-render) ──────────────────────────────────

  function updateTableVisuals() {
    tableEl.querySelectorAll('.matrix-th-zone').forEach(th => {
      const tx   = +th.dataset.tx;
      const barW = getRmsBarWidth(meterData.tx_rms[tx] ?? -Infinity);
      const bar  = th.querySelector('.matrix-th-bar');
      if (bar) bar.style.width = `${barW}%`;
    });

    tableEl.querySelectorAll('.matrix-th-source').forEach(th => {
      const rx   = +th.dataset.rx;
      const barW = getRmsBarWidth(meterData.rx_rms[rx] ?? -Infinity);
      const bar  = th.querySelector('.matrix-th-bar');
      if (bar) bar.style.width = `${barW}%`;
    });

    tableEl.querySelectorAll('.matrix-cell.routed').forEach(cell => {
      const rx    = +cell.dataset.rx;
      const tx    = +cell.dataset.tx;
      const color = zoneColor(tx);
      cell.style.background = getRmsColor(meterData.rx_rms[rx] ?? -Infinity, color);
    });

    // Gate state on rows
    tableEl.querySelectorAll('.matrix-row').forEach(row => {
      const rx = +row.dataset.rx;
      const gateOpen = meterData.rx_gate_open[rx];
      row.classList.toggle('gate-closed', gateOpen === false);
    });
  }

  // ── Interactions ────────────────────────────────────────────────────────────

  function toggleCell(tx, rx) {
    const current = matrixData[tx]?.[rx] ? 1 : 0;
    const next    = current ? 0 : 1;

    matrixData[tx]      = matrixData[tx] || [];
    matrixData[tx][rx]  = next;

    const cell = tableEl.querySelector(`.matrix-cell[data-tx="${tx}"][data-rx="${rx}"]`);
    if (cell) {
      cell.classList.toggle('routed', !!next);
      cell.setAttribute('aria-pressed', next ? 'true' : 'false');
      if (next) {
        cell.innerHTML = '<span class="matrix-cell-dot" aria-hidden="true"></span>';
        cell.style.background = getRmsColor(meterData.rx_rms[rx] ?? -Infinity, zoneColor(tx));
      } else {
        cell.innerHTML = '';
        cell.style.background = '';
      }
    }

    matrix.route(tx, rx, !!next).catch(err => {
      // Revert optimistic update
      matrixData[tx][rx] = current;
      if (cell) {
        cell.classList.toggle('routed', !!current);
        cell.setAttribute('aria-pressed', current ? 'true' : 'false');
        if (current) {
          cell.innerHTML = '<span class="matrix-cell-dot" aria-hidden="true"></span>';
        } else {
          cell.innerHTML = '';
          cell.style.background = '';
        }
      }
      console.error('Matrix route failed:', err);
    });
  }

  function onCellClick(evt) {
    const cell = evt.currentTarget;
    const tx   = +cell.dataset.tx;
    const rx   = +cell.dataset.rx;
    focusedCell = { tx, rx };
    toggleCell(tx, rx);
  }

  function onKeydown(evt) {
    if (!focusedCell) return;
    const rows = visibleSources();
    const rowIdx = rows.findIndex(r => r.rx === focusedCell.rx);
    const { tx } = focusedCell;

    switch (evt.key) {
      case 'ArrowRight':
        focusedCell = { tx: Math.min(zones.length - 1, tx + 1), rx: focusedCell.rx };
        break;
      case 'ArrowLeft':
        focusedCell = { tx: Math.max(0, tx - 1), rx: focusedCell.rx };
        break;
      case 'ArrowDown':
        if (rowIdx < rows.length - 1) focusedCell = { tx, rx: rows[rowIdx + 1].rx };
        break;
      case 'ArrowUp':
        if (rowIdx > 0) focusedCell = { tx, rx: rows[rowIdx - 1].rx };
        break;
      case ' ':
      case 'Enter':
        evt.preventDefault();
        toggleCell(focusedCell.tx, focusedCell.rx);
        return;
      default:
        return;
    }
    evt.preventDefault();

    // Update tabindex and focus
    tableEl.querySelectorAll('.matrix-cell').forEach(c => {
      const isFocused = +c.dataset.tx === focusedCell.tx && +c.dataset.rx === focusedCell.rx;
      c.tabIndex = isFocused ? 0 : -1;
      c.classList.toggle('kb-focus', isFocused);
    });
    const el = tableEl.querySelector(
      `.matrix-cell[data-tx="${focusedCell.tx}"][data-rx="${focusedCell.rx}"]`
    );
    el?.focus({ preventScroll: false });
  }

  function onCellFocus(evt) {
    const cell = evt.target.closest('.matrix-cell');
    if (!cell) return;
    focusedCell = { tx: +cell.dataset.tx, rx: +cell.dataset.rx };
  }

  function onMeterUpdate(evt) {
    meterData = evt.detail;
    updateTableVisuals();
  }

  function onSearchInput() {
    filterText = searchEl.value.trim();
    focusedCell = null;
    renderTable();
  }

  const debouncedSearch = debounce(onSearchInput, 150);

  async function onRefreshClick() {
    try {
      const newConfig = await matrix.get();
      config     = newConfig;
      matrixData.length = 0;
      Object.assign(matrixData, config.matrix || []);
      await refreshDspBadges();
      renderTable();
    } catch (err) {
      console.error('Failed to refresh matrix:', err);
    }
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────────

  renderTable();
  renderZonePills();

  refreshBtn.addEventListener('click', onRefreshClick);
  searchEl.addEventListener('input', debouncedSearch);
  tableEl.addEventListener('keydown', onKeydown);
  tableEl.addEventListener('focusin', onCellFocus);
  document.addEventListener('pb:meters', onMeterUpdate);

  return function cleanup() {
    document.removeEventListener('pb:meters', onMeterUpdate);
    refreshBtn.removeEventListener('click', onRefreshClick);
    searchEl.removeEventListener('input', debouncedSearch);
    tableEl.removeEventListener('keydown', onKeydown);
    tableEl.removeEventListener('focusin', onCellFocus);
  };
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

import { matrix } from '/modules/api.js';

export async function init(container) {
  let config = null;
  let meterData = {
    tx_rms: [],
    rx_rms: [],
    tx_peak: [],
    rx_peak: [],
    tx_gr_db: [],
    rx_gr_db: [],
    rx_gate_open: [],
  };

  // Fetch initial config
  try {
    config = await matrix.get();
  } catch (err) {
    container.innerHTML = `<div class="page-placeholder"><h2>MATRIX</h2><p class="text-dim">Failed to load config: ${err.message}</p></div>`;
    return () => {};
  }

  const sources = config.sources || [];
  const zones = config.zones || [];
  const matrixData = config.matrix || [];

  // Render page structure
  container.className = 'matrix-page';
  container.innerHTML = `
    <div class="matrix-toolbar">
      <div class="matrix-toolbar-title">ROUTING MATRIX</div>
      <button class="icon-btn" id="matrix-refresh-btn" title="Refresh">
        <span class="icon-refresh"></span>
      </button>
    </div>
    <div class="matrix-scroll">
      <table class="matrix-table" id="matrix-table"></table>
    </div>
  `;

  const tableEl = container.querySelector('#matrix-table');
  const refreshBtn = container.querySelector('#matrix-refresh-btn');

  // Handle empty config gracefully
  if (sources.length === 0 || zones.length === 0) {
    tableEl.innerHTML = `<tr><td style="text-align: center; color: var(--color-text-dim);">No sources or zones configured</td></tr>`;
    return () => {};
  }

  // Build matrix table
  function renderTable() {
    let html = '<thead><tr><th style="width: 100px;"></th>';

    // Header row: zone names + TX level bars
    zones.forEach((zone, tx) => {
      const txRms = meterData.tx_rms[tx] || -Infinity;
      const barWidth = getRmsBarWidth(txRms);
      html += `
        <th class="matrix-th-zone" data-tx="${tx}">
          <div class="matrix-th-name" title="${zone.name || zone}">${zone.name || zone}</div>
          <div class="matrix-th-bar-wrap">
            <div class="matrix-th-bar" style="width: ${barWidth}%"></div>
          </div>
        </th>
      `;
    });
    html += '</tr></thead><tbody>';

    // Data rows: sources + RX level bars + cells
    sources.forEach((source, rx) => {
      const rxRms = meterData.rx_rms[rx] || -Infinity;
      const barWidth = getRmsBarWidth(rxRms);

      html += `
        <tr class="matrix-row" data-rx="${rx}">
          <th class="matrix-row-th matrix-th-source" data-rx="${rx}">
            <div class="matrix-th-name" title="${source.name || source}">${source.name || source}</div>
            <div class="matrix-th-bar-wrap">
              <div class="matrix-th-bar" style="width: ${barWidth}%"></div>
            </div>
          </th>
      `;

      zones.forEach((zone, tx) => {
        const routed = matrixData[tx] && matrixData[tx][rx] ? 1 : 0;
        const cellRms = meterData.rx_rms[rx] || -Infinity;
        const bgColor = routed ? getRmsColor(cellRms) : 'transparent';
        const symbol = routed ? '✓' : '';

        html += `
          <td class="matrix-cell ${routed ? 'routed' : ''}" 
              data-tx="${tx}" 
              data-rx="${rx}"
              style="background-color: ${bgColor}">
            ${symbol}
          </td>
        `;
      });

      html += '</tr>';
    });

    html += '</tbody>';
    tableEl.innerHTML = html;

    // Attach click handlers
    tableEl.querySelectorAll('.matrix-cell').forEach((cell) => {
      cell.addEventListener('click', onCellClick);
    });
  }

  function getRmsBarWidth(rms) {
    if (rms <= -Infinity || rms <= -80) return 0;
    if (rms >= 0) return 100;
    const normalized = (rms + 80) / 80;
    return Math.max(0, Math.min(100, normalized * 100));
  }

  function getRmsColor(rms) {
    if (rms <= -40) return 'transparent';
    if (rms <= -20) return 'rgba(0, 212, 255, 0.1)';
    if (rms <= -6) return 'rgba(0, 212, 255, 0.3)';
    return 'rgba(255, 159, 28, 0.5)';
  }

  function onCellClick(evt) {
    const cell = evt.currentTarget;
    const tx = parseInt(cell.dataset.tx, 10);
    const rx = parseInt(cell.dataset.rx, 10);

    const currentState = matrixData[tx] && matrixData[tx][rx] ? 1 : 0;
    const newState = currentState ? 0 : 1;

    // Optimistic update
    matrixData[tx] = matrixData[tx] || [];
    matrixData[tx][rx] = newState;

    // Update UI optimistically
    if (newState) {
      cell.classList.add('routed');
      cell.textContent = '✓';
    } else {
      cell.classList.remove('routed');
      cell.textContent = '';
    }

    // Send to API
    matrix.route(tx, rx, newState === 1).catch((err) => {
      // Revert on error
      matrixData[tx][rx] = currentState;
      if (currentState) {
        cell.classList.add('routed');
        cell.textContent = '✓';
      } else {
        cell.classList.remove('routed');
        cell.textContent = '';
      }
      console.error('Failed to update matrix:', err);
    });
  }

  function onMeterUpdate(evt) {
    meterData = evt.detail;
    updateTableVisuals();
  }

  function updateTableVisuals() {
    // Update TX level bars (column headers)
    tableEl.querySelectorAll('.matrix-th-zone').forEach((th) => {
      const tx = parseInt(th.dataset.tx, 10);
      const txRms = meterData.tx_rms[tx] || -Infinity;
      const barWidth = getRmsBarWidth(txRms);
      const bar = th.querySelector('.matrix-th-bar');
      if (bar) bar.style.width = `${barWidth}%`;
    });

    // Update RX level bars (row headers)
    tableEl.querySelectorAll('.matrix-th-source').forEach((th) => {
      const rx = parseInt(th.dataset.rx, 10);
      const rxRms = meterData.rx_rms[rx] || -Infinity;
      const barWidth = getRmsBarWidth(rxRms);
      const bar = th.querySelector('.matrix-th-bar');
      if (bar) bar.style.width = `${barWidth}%`;
    });

    // Update cell heatmap colors (routed cells only)
    tableEl.querySelectorAll('.matrix-cell.routed').forEach((cell) => {
      const rx = parseInt(cell.dataset.rx, 10);
      const cellRms = meterData.rx_rms[rx] || -Infinity;
      cell.style.backgroundColor = getRmsColor(cellRms);
    });
  }

  function onRefreshClick() {
    matrix.get().then((newConfig) => {
      config = newConfig;
      // Re-render the entire table with fresh data
      renderTable();
    }).catch((err) => {
      console.error('Failed to refresh matrix:', err);
    });
  }

  // Initial render
  renderTable();

  // Attach refresh button
  refreshBtn.addEventListener('click', onRefreshClick);

  // Subscribe to meter updates
  document.addEventListener('pb:meters', onMeterUpdate);

  // Cleanup function
  return function cleanup() {
    document.removeEventListener('pb:meters', onMeterUpdate);
    refreshBtn.removeEventListener('click', onRefreshClick);
    tableEl.querySelectorAll('.matrix-cell').forEach((cell) => {
      cell.removeEventListener('click', onCellClick);
    });
  };
}

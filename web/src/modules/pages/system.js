import { system, apiErrorMessage } from '/modules/api.js';

function formatUptime(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function statusDotClass(ok) {
  return ok ? 'status-dot status-dot-ok' : 'status-dot status-dot-err';
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

export async function init(container) {
  let pollStatusId = null;
  let pollLogsId   = null;

  container.innerHTML = `
    <div class="system-page">
      <div class="system-page-title">SYSTEM</div>

      <div class="system-section">
        <div class="system-section-header">─ DANTE</div>
        <div class="system-kv-grid">
          <div class="system-kv-label">Status</div>
          <div class="system-kv-value system-status-row">
            <span id="sp-dante-dot" class="status-dot status-dot-err"></span>
            <span id="sp-dante-status">—</span>
          </div>
          <div class="system-kv-label">Device</div>
          <div class="system-kv-value" id="sp-dante-device">—</div>
          <div class="system-kv-label">NIC</div>
          <div class="system-kv-value" id="sp-dante-nic">—</div>
          <div class="system-kv-label">RX channels</div>
          <div class="system-kv-value" id="sp-dante-rx">0</div>
          <div class="system-kv-label">TX channels</div>
          <div class="system-kv-value" id="sp-dante-tx">0</div>
        </div>
      </div>

      <div class="system-section">
        <div class="system-section-header">─ PTP SYNC</div>
        <div class="system-kv-grid">
          <div class="system-kv-label">Status</div>
          <div class="system-kv-value system-status-row">
            <span id="sp-ptp-dot" class="status-dot status-dot-err"></span>
            <span id="sp-ptp-status">—</span>
          </div>
          <div class="system-kv-label">Offset</div>
          <div class="system-kv-value" id="sp-ptp-offset">—</div>
          <div class="system-kv-label">Socket</div>
          <div class="system-kv-value" id="sp-ptp-socket">—</div>
        </div>
      </div>

      <div class="system-section">
        <div class="system-section-header">─ AUDIO ENGINE</div>
        <div class="system-kv-grid">
          <div class="system-kv-label">Active routes</div>
          <div class="system-kv-value" id="sp-audio-routes">0</div>
          <div class="system-kv-label">Uptime</div>
          <div class="system-kv-value" id="sp-audio-uptime">—</div>
        </div>
      </div>

      <div class="system-section">
        <div class="system-section-header">─ ABOUT</div>
        <div class="system-kv-grid">
          <div class="system-kv-label">Version</div>
          <div class="system-kv-value" id="sp-version">—</div>
          <div class="system-kv-label">Web UI</div>
          <div class="system-kv-value">ES Modules, no build step</div>
        </div>
        <div class="system-actions">
          <button id="sp-reload-btn" class="btn-secondary">Reload Config</button>
          <span id="sp-reload-status" class="system-action-status"></span>
        </div>
      </div>

      <div class="system-section">
        <div class="system-section-header">─ EVENT LOG</div>
        <div class="system-event-log-wrap">
          <table class="system-event-log">
            <thead>
              <tr>
                <th>Time</th>
                <th>Level</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody id="sp-log-body">
              <tr><td colspan="3" class="text-dim">Loading…</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const $ = (id) => container.querySelector(`#${id}`);

  $('sp-reload-btn').addEventListener('click', async () => {
    const btn    = $('sp-reload-btn');
    const status = $('sp-reload-status');
    btn.disabled = true;
    status.textContent = 'Reloading…';
    try {
      await system.reload();
      status.textContent = 'Done';
    } catch (err) {
      status.textContent = apiErrorMessage(err);
    } finally {
      btn.disabled = false;
      setTimeout(() => { status.textContent = ''; }, 4000);
    }
  });

  async function refreshStatus() {
    try {
      const h = await system.status();

      const danteOk = h.dante?.connected ?? false;
      $('sp-dante-dot').className    = statusDotClass(danteOk);
      $('sp-dante-status').textContent = danteOk ? 'Connected' : 'Disconnected';
      $('sp-dante-device').textContent = h.dante?.name || '—';
      $('sp-dante-nic').textContent    = h.dante?.nic  || '—';
      $('sp-dante-rx').textContent     = h.audio?.rx_channels ?? 0;
      $('sp-dante-tx').textContent     = h.audio?.tx_channels ?? 0;

      const ptpOk = h.ptp?.synced ?? false;
      $('sp-ptp-dot').className      = statusDotClass(ptpOk);
      $('sp-ptp-status').textContent = ptpOk ? 'Synced' : 'Not synced';
      const offsetNs = h.ptp?.offset_ns;
      $('sp-ptp-offset').textContent  = offsetNs != null ? `${(offsetNs / 1000).toFixed(2)} µs` : '—';
      $('sp-ptp-socket').textContent  = h.ptp?.socket_path || '—';

      $('sp-audio-routes').textContent = h.audio?.active_routes ?? 0;
      $('sp-audio-uptime').textContent = formatUptime(h.uptime_secs ?? 0);

      $('sp-version').textContent = h.version ? `Minos ${h.version}` : '—';
    } catch (err) {
      console.error('System status failed:', err);
    }
  }

  async function refreshLogs() {
    try {
      const logs = await system.logs();
      const tbody = $('sp-log-body');
      if (!Array.isArray(logs) || logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-dim">No events</td></tr>';
        return;
      }
      tbody.innerHTML = logs.slice().reverse().map(e => {
        const ts  = e.ts ? new Date(e.ts * 1000).toLocaleTimeString() : '—';
        const lvl = escHtml(e.level ?? 'info');
        return `<tr class="log-row log-row-${lvl}">
          <td class="log-ts">${ts}</td>
          <td class="log-level">${lvl.toUpperCase()}</td>
          <td class="log-msg">${escHtml(e.message ?? e.msg ?? '')}</td>
        </tr>`;
      }).join('');
    } catch (err) {
      const tbody = $('sp-log-body');
      if (tbody) tbody.innerHTML = `<tr><td colspan="3" class="text-dim">Unavailable</td></tr>`;
    }
  }

  await Promise.all([refreshStatus(), refreshLogs()]);
  pollStatusId = setInterval(refreshStatus, 5000);
  pollLogsId   = setInterval(refreshLogs,  10000);

  return function cleanup() {
    clearInterval(pollStatusId);
    clearInterval(pollLogsId);
  };
}


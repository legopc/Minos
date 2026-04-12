import { system } from '/modules/api.js';

function formatUptime(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function getStatusDotClass(ok, warn = false) {
  if (warn) return 'status-dot status-dot-warn';
  return ok ? 'status-dot status-dot-ok' : 'status-dot status-dot-err';
}

export async function init(container) {
  let pollId = null;

  // Render static layout with placeholders
  container.innerHTML = `
    <div class="system-page">
      <div class="system-page-title">SYSTEM</div>
      
      <!-- DANTE Section -->
      <div class="system-section">
        <div class="system-section-header">─ DANTE</div>
        <div class="system-kv-grid">
          <div class="system-kv-label">Status:</div>
          <div class="system-kv-value system-status-row">
            <span class="${getStatusDotClass(false)}"></span>
            <span id="dante-status">—</span>
          </div>
          
          <div class="system-kv-label">Device:</div>
          <div class="system-kv-value" id="dante-device">—</div>
          
          <div class="system-kv-label">NIC:</div>
          <div class="system-kv-value" id="dante-nic">—</div>
          
          <div class="system-kv-label">RX Channels:</div>
          <div class="system-kv-value" id="dante-rx">0</div>
          
          <div class="system-kv-label">TX Channels:</div>
          <div class="system-kv-value" id="dante-tx">0</div>
        </div>
      </div>
      
      <!-- PTP SYNC Section -->
      <div class="system-section">
        <div class="system-section-header">─ PTP SYNC</div>
        <div class="system-kv-grid">
          <div class="system-kv-label">Status:</div>
          <div class="system-kv-value system-status-row">
            <span class="${getStatusDotClass(false)}" id="ptp-dot"></span>
            <span id="ptp-status">—</span>
          </div>
          
          <div class="system-kv-label">Socket:</div>
          <div class="system-kv-value" id="ptp-socket">—</div>
        </div>
      </div>
      
      <!-- AUDIO Section -->
      <div class="system-section">
        <div class="system-section-header">─ AUDIO</div>
        <div class="system-kv-grid">
          <div class="system-kv-label">Active Routes:</div>
          <div class="system-kv-value" id="audio-routes">0</div>
          
          <div class="system-kv-label">RX Channels:</div>
          <div class="system-kv-value" id="audio-rx">0</div>
          
          <div class="system-kv-label">TX Channels:</div>
          <div class="system-kv-value" id="audio-tx">0</div>
          
          <div class="system-kv-label">Uptime:</div>
          <div class="system-kv-value" id="audio-uptime">—</div>
        </div>
      </div>
      
      <!-- ABOUT Section -->
      <div class="system-section">
        <div class="system-section-header">─ ABOUT</div>
        <div class="system-kv-grid">
          <div class="system-kv-label" style="grid-column: 1 / -1;">
            Patchbox v1.0 — Dante AoIP Routing Matrix
          </div>
          <div class="system-kv-label" style="grid-column: 1 / -1; margin-top: 4px;">
            Web UI: ES Modules, no build step
          </div>
        </div>
      </div>
    </div>
  `;

  async function refresh() {
    try {
      const h = await system.status();
      
      // DANTE
      const danteConnected = h.dante?.connected ?? false;
      const danteStatusEl = container.querySelector('.system-status-row span:nth-child(1)');
      danteStatusEl.className = getStatusDotClass(danteConnected);
      
      document.getElementById('dante-status').textContent = danteConnected ? 'Connected' : 'Disconnected';
      document.getElementById('dante-device').textContent = h.dante?.name || '—';
      document.getElementById('dante-nic').textContent = h.dante?.nic || '—';
      document.getElementById('dante-rx').textContent = h.audio?.rx_channels ?? 0;
      document.getElementById('dante-tx').textContent = h.audio?.tx_channels ?? 0;
      
      // PTP SYNC
      const ptpSynced = h.ptp?.synced ?? false;
      const ptpDot = document.getElementById('ptp-dot');
      ptpDot.className = getStatusDotClass(ptpSynced);
      
      document.getElementById('ptp-status').textContent = ptpSynced ? 'Synced' : 'Not Synced';
      document.getElementById('ptp-socket').textContent = h.ptp?.socket_path || '—';
      
      // AUDIO
      document.getElementById('audio-routes').textContent = h.audio?.active_routes ?? 0;
      document.getElementById('audio-rx').textContent = h.audio?.rx_channels ?? 0;
      document.getElementById('audio-tx').textContent = h.audio?.tx_channels ?? 0;
      document.getElementById('audio-uptime').textContent = formatUptime(h.uptime_secs ?? 0);
      
    } catch (err) {
      console.error('System status failed:', err);
    }
  }

  await refresh();
  pollId = setInterval(refresh, 5000);

  return function cleanup() {
    clearInterval(pollId);
  };
}

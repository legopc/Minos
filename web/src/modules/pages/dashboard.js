import * as api from '/modules/api.js';
import { VuMeter } from '/modules/components/vu-meter.js';
import { onMeters } from '/modules/ws.js';

let healthPollId = null;
let meterUnsubscribe = null;
const vueMeters = [];

/**
 * Format uptime in seconds to "Xd Yh Zm" format
 */
function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

/**
 * Update health status cards
 */
async function updateHealth() {
  try {
    const health = await api.system.status();
    
    // Dante card
    const danteStatusEl = document.getElementById('dante-status');
    const danteDotEl = document.getElementById('dante-dot');
    const danteChannelsEl = document.getElementById('dante-channels');
    
    if (danteStatusEl && danteDotEl && danteChannelsEl) {
      const danteConnected = health.dante?.connected ?? false;
      danteStatusEl.textContent = danteConnected ? 'Connected' : 'Disconnected';
      danteDotEl.className = danteConnected
        ? 'status-dot status-dot-ok' 
        : 'status-dot status-dot-err';
      danteChannelsEl.textContent = `${health.audio?.rx_channels ?? 0} × ${health.audio?.tx_channels ?? 0} ch`;
    }
    
    // PTP card
    const ptpStatusEl = document.getElementById('ptp-status');
    const ptpDotEl = document.getElementById('ptp-dot');
    
    if (ptpStatusEl && ptpDotEl) {
      if (!health.ptp) {
        ptpStatusEl.textContent = 'No PTP';
        ptpDotEl.className = 'status-dot status-dot-err';
      } else if (health.ptp.synced) {
        ptpStatusEl.textContent = 'Synced';
        ptpDotEl.className = 'status-dot status-dot-ok';
      } else {
        ptpStatusEl.textContent = 'Awaiting Sync';
        ptpDotEl.className = 'status-dot status-dot-warn';
      }
    }
    
    // System card
    const uptimeEl = document.getElementById('uptime');
    if (uptimeEl) {
      uptimeEl.textContent = formatUptime(health.uptime_secs ?? 0);
    }
    
    // Audio activity
    const activeRoutesEl = document.getElementById('active-routes');
    const rxChEl = document.getElementById('rx-ch');
    const txChEl = document.getElementById('tx-ch');
    
    if (activeRoutesEl) activeRoutesEl.textContent = health.audio?.active_routes ?? 0;
    if (rxChEl) rxChEl.textContent = health.audio?.rx_channels ?? 0;
    if (txChEl) txChEl.textContent = health.audio?.tx_channels ?? 0;
  } catch (err) {
    console.error('Health update failed:', err);
  }
}

/**
 * Render zone meters
 */
async function renderZoneMeters() {
  const container = document.getElementById('zone-meters');
  if (!container) return;
  
  try {
    const config = await api.zones.list();
    
    // config has structure with zones array or similar
    const zones = config.zones || config.outputs || [];
    
    if (zones.length === 0) {
      container.innerHTML = '<div class="text-dim" style="padding: 16px;">No zones configured</div>';
      return;
    }
    
    container.innerHTML = '';
    
    // Create meter for each output channel
    zones.forEach((zone, idx) => {
      const wrap = document.createElement('div');
      wrap.className = 'zone-meter-wrap';
      
      // Canvas for VU meter
      const canvas = document.createElement('canvas');
      canvas.className = 'zone-meter-canvas';
      wrap.appendChild(canvas);
      
      // Zone name label
      const nameEl = document.createElement('div');
      nameEl.className = 'zone-meter-name';
      nameEl.textContent = zone.name || (typeof zone === 'string' ? zone : `TX ${idx + 1}`);
      wrap.appendChild(nameEl);
      
      // Mute badge (if muted)
      if (zone.muted === true) {
        const badge = document.createElement('div');
        badge.className = 'zone-mute-badge';
        badge.textContent = 'M';
        wrap.appendChild(badge);
      }
      
      // Click to navigate to outputs
      wrap.addEventListener('click', () => {
        window.location.hash = '#/outputs';
      });
      
      container.appendChild(wrap);
      
      // Create VuMeter instance for this output
      const meter = new VuMeter(canvas, idx, 'output');
      vueMeters.push(meter);
    });
  } catch (err) {
    console.error('Zone meters failed:', err);
    const container = document.getElementById('zone-meters');
    if (container) {
      container.innerHTML = '<div class="text-dim" style="padding: 16px;">Failed to load zones</div>';
    }
  }
}

/**
 * Page init — called by router; returns cleanup function
 */
export async function init(container) {
  // Clean up any previous instance (defensive, in case router didn't call cleanup)
  if (healthPollId !== null) { clearInterval(healthPollId); healthPollId = null; }
  if (meterUnsubscribe) { meterUnsubscribe(); meterUnsubscribe = null; }
  vueMeters.forEach(m => m?.destroy?.());
  vueMeters.length = 0;
  // Build HTML
  container.innerHTML = `
    <div class="dashboard-page">
      <div class="dashboard-status-row">
        <div class="status-card" id="card-dante">
          <div class="status-card-header">
            <span class="status-card-icon">DANTE</span>
            <span class="status-dot status-dot-err" id="dante-dot"></span>
          </div>
          <div class="status-card-body">
            <div class="status-card-title" id="dante-status">--</div>
            <div class="status-card-sub" id="dante-channels">-- × -- ch</div>
          </div>
        </div>
        
        <div class="status-card" id="card-ptp">
          <div class="status-card-header">
            <span class="status-card-icon">PTP</span>
            <span class="status-dot status-dot-warn" id="ptp-dot"></span>
          </div>
          <div class="status-card-body">
            <div class="status-card-title" id="ptp-status">--</div>
            <div class="status-card-sub">Sync Status</div>
          </div>
        </div>
        
        <div class="status-card" id="card-sys">
          <div class="status-card-header">
            <span class="status-card-icon">SYS</span>
            <span class="status-dot status-dot-ok"></span>
          </div>
          <div class="status-card-body">
            <div class="status-card-title" id="uptime">--</div>
            <div class="status-card-sub">Uptime</div>
          </div>
        </div>
      </div>
      
      <div class="dashboard-section">
        <div class="dashboard-section-title">OUTPUT LEVELS</div>
        <div class="zone-meter-row" id="zone-meters">
          <div class="text-dim" style="padding: 16px;">Loading…</div>
        </div>
      </div>
      
      <div class="dashboard-section">
        <div class="dashboard-section-title">AUDIO ACTIVITY</div>
        <div class="activity-grid">
          <div class="activity-item">
            <span class="activity-label">Active Routes</span>
            <span class="activity-value" id="active-routes">--</span>
          </div>
          <div class="activity-item">
            <span class="activity-label">RX Channels</span>
            <span class="activity-value" id="rx-ch">--</span>
          </div>
          <div class="activity-item">
            <span class="activity-label">TX Channels</span>
            <span class="activity-value" id="tx-ch">--</span>
          </div>
          <div class="activity-item">
            <span class="activity-label">Uptime</span>
            <span class="activity-value" id="uptime-display">--</span>
          </div>
        </div>
      </div>
    </div>
  `;
  
  // Initial health fetch
  await updateHealth();
  
  // Render zone meters
  await renderZoneMeters();
  
  // Subscribe to meter events (for VuMeter components)
  meterUnsubscribe = onMeters(() => {
    // VuMeter instances handle this via their own event listeners
    // This subscription just keeps the event flowing
  });
  
  // Start health polling
  healthPollId = setInterval(updateHealth, 3000);

  return function cleanup() {
    if (healthPollId !== null) { clearInterval(healthPollId); healthPollId = null; }
    if (meterUnsubscribe) { meterUnsubscribe(); meterUnsubscribe = null; }
    vueMeters.forEach(m => m?.destroy?.());
    vueMeters.length = 0;
  };
}



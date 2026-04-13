// system.js — System tab
import * as st  from './state.js';
import * as api from './api.js';

export async function render(container) {
  let sys = st.state.system;
  // Refresh from API on tab open
  try { sys = await api.getSystem(); st.setSystem(sys); } catch (_) {}

  const _renderDanteStatus = (status) => {
    if (status === 'connected') {
      return `<span style="color:var(--color-ok)">connected</span>`;
    }
    return `<span style="color:var(--text-muted)">${_e(status ?? '—')}</span>`;
  };

  const _renderPtpStatus = (locked, offset_ns) => {
    if (locked === true) {
      return `<span style="color:var(--color-ok)">LOCKED</span> <span style="color:var(--text-muted)">(${offset_ns} ns)</span>`;
    }
    if (locked === false) {
      return `<span style="color:var(--color-warn)">Checking...</span>`;
    }
    return '—';
  };

  const drops = sys.audio_drops ?? 0;
  const dropsClass = drops > 0 ? 'color:var(--color-danger)' : '';

  container.innerHTML = `
    <div class="sys-page">
      <!-- Status card -->
      <div class="sys-card">
        <div class="sys-card-title">System</div>
        <div class="sys-row"><span class="sys-lbl">Hostname</span><span class="sys-val">${_e(sys.hostname ?? '—')}</span></div>
        <div class="sys-row"><span class="sys-lbl">Version</span><span class="sys-val">${_e(sys.version ?? '—')}</span></div>
        <div class="sys-row"><span class="sys-lbl">Uptime</span><span class="sys-val">${_fmt_uptime(sys.uptime_s)}</span></div>
        <div class="sys-row"><span class="sys-lbl">Sample Rate</span><span class="sys-val">${sys.sample_rate ? (sys.sample_rate/1000).toFixed(1)+' kHz' : '—'}</span></div>
        <div class="sys-row"><span class="sys-lbl">Channels</span><span class="sys-val">${sys.rx_count ?? 0} RX / ${sys.tx_count ?? 0} TX</span></div>
      </div>

      <!-- Dante card -->
      <div class="sys-card">
        <div class="sys-card-title">Dante</div>
        <div class="sys-row"><span class="sys-lbl">Status</span><span class="sys-val sys-dante-status">${_renderDanteStatus(sys.dante_status)}</span></div>
      </div>

      <!-- Clock card -->
      <div class="sys-card">
        <div class="sys-card-title">Clock / PTP</div>
        <div class="sys-row"><span class="sys-lbl">PTP</span><span class="sys-val sys-ptp-val">${_renderPtpStatus(sys.ptp_locked, sys.ptp_offset_ns)}</span></div>
      </div>

      <!-- Audio card -->
      <div class="sys-card">
        <div class="sys-card-title">Audio</div>
        <div class="sys-row"><span class="sys-lbl">Drops</span><span class="sys-val" style="${dropsClass}">${drops}</span></div>
        ${drops > 0 ? '<div class="sys-row"><button class="sys-btn" id="sys-reset-drops">Reset Counter</button></div>' : ''}
      </div>

      <!-- Actions card -->
      <div class="sys-card">
        <div class="sys-card-title">Actions</div>
        <div class="sys-actions">
          <button class="sys-btn" id="sys-export-btn">Export Config</button>
        </div>
      </div>
    </div>`;

  // Wire reset drops button
  document.getElementById('sys-reset-drops')?.addEventListener('click', async () => {
    try {
      const updated = await api.getSystem();
      st.setSystem(updated);
      render(container);
    } catch (e) {
      console.error('Failed to reset drops', e);
    }
  });

  // Wire export config button
  document.getElementById('sys-export-btn')?.addEventListener('click', async () => {
    try {
      const r = await api.getConfigExport();
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'patchbox.toml';
      a.click();
    } catch (e) {
      console.error('Export failed', e);
    }
  });
}

function _e(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _fmt_uptime(s) {
  if (!s) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

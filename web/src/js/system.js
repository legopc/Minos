// system.js — System tab
import * as st  from './state.js';
import * as api from './api.js';

export async function render(container) {
  let sys = st.state.system;
  // Refresh from API on tab open
  try { sys = await api.getSystem(); st.setSystem(sys); } catch (_) {}

  container.innerHTML = `
    <div style="padding:16px;display:flex;flex-direction:column;gap:16px;max-width:600px">
      <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em">System</div>
      <table style="border-collapse:collapse;font-size:10px;width:100%">
        <tr><td style="padding:4px 8px;color:var(--text-muted);width:160px">Hostname</td>
            <td style="padding:4px 8px;color:var(--text-primary)">${_e(sys.hostname ?? '—')}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--text-muted)">Version</td>
            <td style="padding:4px 8px;color:var(--text-primary)">${_e(sys.version ?? '—')}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--text-muted)">Uptime</td>
            <td style="padding:4px 8px;color:var(--text-primary)">${_fmt_uptime(sys.uptime_s)}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--text-muted)">Sample Rate</td>
            <td style="padding:4px 8px;color:var(--text-primary)">${sys.sample_rate ? (sys.sample_rate/1000).toFixed(1)+' kHz' : '—'}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--text-muted)">Audio Drops</td>
            <td style="padding:4px 8px;color:${(sys.audio_drops??0)>0?'var(--dot-error)':'var(--text-primary)'}">${sys.audio_drops ?? 0}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--text-muted)">Dante Status</td>
            <td style="padding:4px 8px;color:var(--text-primary)">${_e(sys.dante_status ?? '—')}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--text-muted)">PTP Locked</td>
            <td style="padding:4px 8px;color:${sys.ptp_locked?'var(--dot-live)':'var(--dot-error)'}">${sys.ptp_locked?'Yes':'No'}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--text-muted)">PTP Offset</td>
            <td style="padding:4px 8px;color:var(--text-primary)">${sys.ptp_offset_ns ?? '—'} ns</td></tr>
      </table>

      <div style="display:flex;gap:8px;margin-top:8px">
        <button id="sys-export-btn" style="background:var(--bg-surface);border:1px solid var(--border-primary);color:var(--text-secondary);padding:6px 12px;border-radius:2px;font-size:10px;cursor:pointer">Export Config</button>
      </div>
    </div>`;

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

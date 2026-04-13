// dante.js — Dante tab
import * as api from './api.js';
import * as st  from './state.js';

export function render(container) {
  const sys = st.state.system;
  container.innerHTML = `
    <div style="padding:16px;display:flex;flex-direction:column;gap:16px;max-width:600px">
      <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em">Dante Device Info</div>
      <table style="border-collapse:collapse;font-size:10px;width:100%">
        <tr><td style="padding:4px 8px;color:var(--text-muted);width:160px">Hostname</td>
            <td style="padding:4px 8px;color:var(--text-primary)">${_e(sys.hostname ?? '—')}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--text-muted)">Dante Status</td>
            <td style="padding:4px 8px;color:var(--text-primary)">${_e(sys.dante_status ?? '—')}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--text-muted)">PTP Locked</td>
            <td style="padding:4px 8px;color:${st.state.ptp.locked ? 'var(--dot-live)' : 'var(--dot-error)'}">${st.state.ptp.locked ? 'Yes' : 'No'}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--text-muted)">PTP Offset</td>
            <td style="padding:4px 8px;color:var(--text-primary)">${sys.ptp_offset_ns ?? '—'} ns</td></tr>
        <tr><td style="padding:4px 8px;color:var(--text-muted)">Sample Rate</td>
            <td style="padding:4px 8px;color:var(--text-primary)">${sys.sample_rate ? (sys.sample_rate/1000).toFixed(1)+' kHz' : '—'}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--text-muted)">RX Channels</td>
            <td style="padding:4px 8px;color:var(--text-primary)">${sys.rx_count ?? '—'}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--text-muted)">TX Channels</td>
            <td style="padding:4px 8px;color:var(--text-primary)">${sys.tx_count ?? '—'}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--text-muted)">Version</td>
            <td style="padding:4px 8px;color:var(--text-primary)">${_e(sys.version ?? '—')}</td></tr>
      </table>
    </div>`;
}

function _e(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

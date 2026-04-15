// system.js — System tab
import * as st    from './state.js';
import * as api   from './api.js';
import { toast }  from './toast.js';

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
      return `<span style="color:var(--color-warn)">—</span>`;
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

      <!-- Channel Configuration card -->
      <div class="sys-card">
        <div class="sys-card-title">Channel Configuration</div>
        <div class="sys-row"><span class="sys-lbl">RX Inputs</span><input type="number" id="cfg-rx-count" class="cfg-input" min="1" max="32" value="${sys.rx_count ?? 0}"></div>
        <div class="sys-row"><span class="sys-lbl">TX Outputs</span><input type="number" id="cfg-tx-count" class="cfg-input" min="1" max="32" value="${sys.tx_count ?? 0}"></div>
        <div class="sys-row"><button class="sys-btn" id="cfg-save-btn">Save & Restart</button></div>
      </div>

      <!-- Bus Settings card -->
      <div class="sys-card">
        <div class="sys-card-title">Internal Buses</div>
        <div class="sys-row"><span class="sys-lbl">Bus Count</span><input type="number" id="bus-count-input" class="cfg-input" min="0" max="8" value="${sys.bus_count ?? 0}"></div>
        <div class="sys-row"><button class="sys-btn" id="bus-count-btn">Apply (restart)</button></div>
        <div class="sys-row"><span class="sys-lbl">Show in Mixer</span><input type="checkbox" id="bus-show-toggle" class="sys-toggle" ${sys.show_buses_in_mixer !== false ? 'checked' : ''}></div>
      </div>

      <!-- Monitor Output (Solo) card -->
      <div class="sys-card">
        <div class="sys-card-title">Monitor Output (Solo)</div>
        <div class="sys-row"><span class="sys-lbl">Device:</span><select id="monitor-device-select" class="cfg-select" aria-label="Monitor output device">
          <option value="">None (solo disabled)</option>
        </select></div>
        <div class="sys-row"><span class="sys-lbl">Volume:</span><input type="range" id="monitor-volume-slider" class="cfg-range" min="-60" max="12" step="1" value="${sys.monitor_volume_db ?? 0}" aria-label="Monitor volume in dB"><span id="monitor-volume-label" class="cfg-label">${sys.monitor_volume_db ?? 0} dB</span></div>
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

  // Wire channel config save button
  document.getElementById('cfg-save-btn')?.addEventListener('click', async () => {
    const rx = parseInt(document.getElementById('cfg-rx-count').value, 10);
    const tx = parseInt(document.getElementById('cfg-tx-count').value, 10);
    if (!rx || !tx || rx < 1 || rx > 32 || tx < 1 || tx > 32) {
      toast('Invalid channel count (1-32)', true);
      return;
    }
    try {
      await api.postAdminChannels(rx, tx);
      _showRestartOverlay();
    } catch(e) {
      toast('Failed: ' + e.message, true);
    }
  });

  // Wire bus count button
  document.getElementById('bus-count-btn')?.addEventListener('click', async () => {
    const busCount = parseInt(document.getElementById('bus-count-input').value, 10);
    if (isNaN(busCount) || busCount < 0 || busCount > 8) {
      toast('Invalid bus count (0-8)', true);
      return;
    }
    try {
      const rx = parseInt(document.getElementById('cfg-rx-count').value, 10);
      const tx = parseInt(document.getElementById('cfg-tx-count').value, 10);
      if (!rx || !tx || rx < 1 || rx > 32 || tx < 1 || tx > 32) {
        toast('Invalid channel count (1-32)', true);
        return;
      }
      await api.postAdminChannels(rx, tx, busCount);
      _showRestartOverlay();
    } catch(e) {
      toast('Failed: ' + e.message, true);
    }
  });

  // Wire show buses toggle
  document.getElementById('bus-show-toggle')?.addEventListener('change', async (e) => {
    try {
      await api.putSystem({ show_buses_in_mixer: e.target.checked });
      if (st.state.system) st.state.system.show_buses_in_mixer = e.target.checked;
      window.dispatchEvent(new CustomEvent('pb:buses-changed'));
    } catch(e) {
      toast('Failed: ' + e.message, true);
      e.target.checked = !e.target.checked;
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

  // Populate monitor device selector
  const monitorSelect = document.getElementById('monitor-device-select');
  if (monitorSelect) {
    try {
      const resp = await api.getAudioDevices();
      (resp.devices ?? []).forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.name;
        opt.textContent = `${d.name} — ${d.description ?? 'Audio Device'}`;
        if (d.name === sys.monitor_device) opt.selected = true;
        monitorSelect.appendChild(opt);
      });
    } catch(e) {
      console.error('Failed to load audio devices:', e);
    }
  }

  // Wire monitor volume slider
  const volSlider = document.getElementById('monitor-volume-slider');
  const volLabel = document.getElementById('monitor-volume-label');
  if (volSlider && volLabel) {
    volSlider.oninput = () => {
      volLabel.textContent = `${volSlider.value} dB`;
    };
    volSlider.onchange = async () => {
      await _saveMonitorConfig(monitorSelect, volSlider);
    };
  }

  // Wire monitor device select
  if (monitorSelect) {
    monitorSelect.onchange = async () => {
      await _saveMonitorConfig(monitorSelect, volSlider);
    };
  }

  // Reflect WS monitor_config_update in the open System tab
  const _onMonitorUpdate = () => {
    const sys = st.state.system;
    if (monitorSelect) {
      for (const opt of monitorSelect.options) {
        opt.selected = opt.value === (sys.monitor_device ?? '');
      }
    }
    if (volSlider && volLabel) {
      volSlider.value = sys.monitor_volume_db ?? 0;
      volLabel.textContent = `${volSlider.value} dB`;
    }
  };
  window.addEventListener('pb:monitor-update', _onMonitorUpdate);
  // Clean up listener when tab is replaced
  const _cleanup = new MutationObserver(() => {
    if (!document.contains(monitorSelect)) {
      window.removeEventListener('pb:monitor-update', _onMonitorUpdate);
      _cleanup.disconnect();
    }
  });
  if (monitorSelect) _cleanup.observe(document.body, { childList: true, subtree: true });
}

async function _saveMonitorConfig(devSelect, volSlider) {
  try {
    await api.putMonitor({
      device: devSelect.value || null,
      volume_db: parseFloat(volSlider.value),
    });
  } catch(e) {
    console.error('Monitor config error:', e);
    toast('Failed to save monitor config: ' + e.message, true);
  }
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

function _showRestartOverlay() {
  const ov = document.createElement('div');
  ov.className = 'restart-overlay';
  ov.innerHTML = '<div class="restart-box"><div class="restart-spinner"></div><p>Restarting…</p><p class="restart-sub">Reconnecting to Minos</p></div>';
  document.body.appendChild(ov);

  let attempts = 0;
  const poll = setInterval(async () => {
    attempts++;
    if (attempts > 30) {
      clearInterval(poll);
      ov.querySelector('.restart-sub').textContent = 'Timed out. Please reload manually.';
      return;
    }
    try {
      const r = await fetch('/api/v1/system', {
        headers: { Authorization: 'Bearer ' + localStorage.getItem('pb_token') }
      });
      if (r.ok) {
        clearInterval(poll);
        location.reload();
      }
    } catch(_) { /* still down */ }
  }, 2000);
}

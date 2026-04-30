// system.js — System tab
import * as st    from './state.js';
import * as api   from './api.js';
import { toast }  from './toast.js';

const CONFIG_PREVIEW_LINE_LIMIT = 10;
const CONFIG_SECTION_LIMIT = 6;
const CONFIG_META_LIMIT = 8;
const CONFIG_VALIDATE_UNSUPPORTED = new Set([404, 405, 501]);
const AUDIT_UNSUPPORTED = new Set([404, 405, 501]);

const configFlowState = {
  liveToml: null,
  validateAvailable: null,
  candidate: null,
  previewBusy: false,
  applyBusy: false,
};

const auditLogState = {
  supported: null,
  loading: false,
  exportBusy: false,
  rows: [],
  query: '',
  level: 'all',
  lastError: '',
  lastUpdated: null,
};

export async function render(container) {
  let sys = st.state.system;
  try { sys = await api.getSystem(); st.setSystem(sys); } catch (_) {}

  let health = null;
  try { health = await api.getHealth(); } catch (_) {}

  const _renderDspCpuBar = (dsp) => {
    if (!dsp) return '<span style="color:var(--text-muted)">—</span>';
    const pct = Math.min(100, Math.max(0, dsp.cpu_percent_avg ?? 0));
    const color = pct >= 90 ? 'var(--color-danger)' : pct >= 70 ? 'var(--color-warn)' : 'var(--color-ok)';
    return `<div class="dsp-cpu-bar-wrap" title="avg ${pct.toFixed(1)}% · inst ${(dsp.cpu_percent ?? 0).toFixed(1)}% · xruns ${dsp.xruns ?? 0}">
      <div class="dsp-cpu-bar" style="width:${pct}%;background:${color}"></div>
      <span class="dsp-cpu-label">${pct.toFixed(1)}%</span>
    </div>`;
  };

  const _renderDanteStatus = (status) => {
    if (status === 'connected') {
      return `<span style="color:var(--color-ok)">connected</span>`;
    }
    return `<span style="color:var(--text-muted)">${_e(status ?? '—')}</span>`;
  };

  const _renderPtpStatus = (locked, offset_ns, ptp_state) => {
    if (locked === true) {
      const stateLabel = ptp_state ? ` (${ptp_state})` : '';
      return `<span style="color:var(--color-ok)">LOCKED${stateLabel}</span> <span style="color:var(--text-muted)">(${offset_ns} ns)</span>`;
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
      <div class="sys-card">
        <div class="sys-card-title">System</div>
        <div class="sys-row"><span class="sys-lbl">Hostname</span><span class="sys-val">${_e(sys.hostname ?? '—')}</span></div>
        <div class="sys-row"><span class="sys-lbl">Version</span><span class="sys-val">${_e(sys.version ?? '—')}</span></div>
        <div class="sys-row"><span class="sys-lbl">Uptime</span><span class="sys-val">${_fmt_uptime(sys.uptime_s)}</span></div>
        <div class="sys-row"><span class="sys-lbl">Sample Rate</span><span class="sys-val">${sys.sample_rate ? (sys.sample_rate / 1000).toFixed(1) + ' kHz' : '—'}</span></div>
        <div class="sys-row"><span class="sys-lbl">Channels</span><span class="sys-val">${sys.rx_count ?? 0} RX / ${sys.tx_count ?? 0} TX</span></div>
      </div>

      <div class="sys-card">
        <div class="sys-card-title">Clock / PTP</div>
        <div class="sys-row"><span class="sys-lbl">PTP</span><span class="sys-val sys-ptp-val">${_renderPtpStatus(sys.ptp_locked, sys.ptp_offset_ns, sys.ptp_state)}</span></div>
      </div>

      <div class="sys-card">
        <div class="sys-card-title">Audio</div>
        <div class="sys-row"><span class="sys-lbl" title="Dante ring buffer realignments — not buffer underruns">Resyncs</span><span class="sys-val" style="${dropsClass}">${drops}</span></div>
        ${drops > 0 ? '<div class="sys-row"><button class="sys-btn" id="sys-reset-drops">Reset Counter</button></div>' : ''}
        <div class="sys-row"><span class="sys-lbl">DSP CPU</span><span class="sys-val sys-dsp-cpu">${_renderDspCpuBar(health?.dsp)}</span></div>
      </div>

      <div class="sys-card">
        <div class="sys-card-title">Channel Configuration</div>
        <div class="sys-row"><span class="sys-lbl">RX Inputs</span><input type="number" id="cfg-rx-count" class="cfg-input" min="1" max="32" value="${sys.rx_count ?? 0}"></div>
        <div class="sys-row"><span class="sys-lbl">TX Outputs</span><input type="number" id="cfg-tx-count" class="cfg-input" min="1" max="32" value="${sys.tx_count ?? 0}"></div>
        <div class="sys-row"><button class="sys-btn" id="cfg-save-btn">Save & Restart</button></div>
      </div>

      <div class="sys-card">
        <div class="sys-card-title">Internal Buses</div>
        <div class="sys-row"><span class="sys-lbl">Bus Count</span><input type="number" id="bus-count-input" class="cfg-input" min="0" max="8" value="${sys.bus_count ?? 0}"></div>
        <div class="sys-row"><button class="sys-btn" id="bus-count-btn">Apply (restart)</button></div>
        <div class="sys-row"><span class="sys-lbl">Show in Mixer</span><input type="checkbox" id="bus-show-toggle" class="sys-toggle" ${sys.show_buses_in_mixer !== false ? 'checked' : ''}></div>
      </div>

      <div class="sys-card">
        <div class="sys-card-title">Monitor Output (Solo)</div>
        <div class="sys-row"><span class="sys-lbl">Device:</span><select id="monitor-device-select" class="cfg-select" aria-label="Monitor output device">
          <option value="">None (solo disabled)</option>
        </select></div>
        <div class="sys-row"><span class="sys-lbl">Volume:</span><input type="range" id="monitor-volume-slider" class="cfg-range" min="-60" max="12" step="1" value="${sys.monitor_volume_db ?? 0}" aria-label="Monitor volume in dB"><span id="monitor-volume-label" class="cfg-label">${sys.monitor_volume_db ?? 0} dB</span></div>
      </div>

      <div class="sys-card">
        <div class="sys-card-title">Metering Preferences</div>
        <div class="sys-row"><span class="sys-lbl">Meter Style</span><div id="meter-ballistics-group"></div></div>
      </div>

      ${_renderConfigCard()}
      ${_renderAuditCard()}
    </div>`;

  document.getElementById('sys-reset-drops')?.addEventListener('click', async () => {
    try {
      const updated = await api.getSystem();
      st.setSystem(updated);
      render(container);
    } catch (e) {
      console.error('Failed to reset resyncs', e);
    }
  });

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
    } catch (e) {
      toast('Failed: ' + e.message, true);
    }
  });

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
    } catch (e) {
      toast('Failed: ' + e.message, true);
    }
  });

  document.getElementById('bus-show-toggle')?.addEventListener('change', async (e) => {
    try {
      await api.putSystem({ show_buses_in_mixer: e.target.checked });
      if (st.state.system) st.state.system.show_buses_in_mixer = e.target.checked;
      window.dispatchEvent(new CustomEvent('pb:buses-changed'));
    } catch (e) {
      toast('Failed: ' + e.message, true);
      e.target.checked = !e.target.checked;
    }
  });

  _setupMeterBallisticsPreference();
  _setupConfigWorkflow();
  _loadBackups();
  _setupAuditLog();

  const monitorSelect = document.getElementById('monitor-device-select');
  if (monitorSelect) {
    try {
      const resp = await api.getAudioDevices();
      const devices = Array.isArray(resp.devices) ? resp.devices : [];
      devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.name;
        opt.textContent = `${d.name} — ${d.description ?? 'Audio Device'}`;
        if (d.name === sys.monitor_device) opt.selected = true;
        monitorSelect.appendChild(opt);
      });
      if (sys.monitor_device && !devices.some((d) => d.name === sys.monitor_device)) {
        const opt = document.createElement('option');
        opt.value = sys.monitor_device;
        opt.textContent = `${sys.monitor_device} — Current config`;
        opt.selected = true;
        monitorSelect.appendChild(opt);
      }
    } catch (e) {
      console.error('Failed to load audio devices:', e);
      if (sys.monitor_device) {
        const opt = document.createElement('option');
        opt.value = sys.monitor_device;
        opt.textContent = `${sys.monitor_device} — Current config`;
        opt.selected = true;
        monitorSelect.appendChild(opt);
      }
    }
  }

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

  if (monitorSelect) {
    monitorSelect.onchange = async () => {
      await _saveMonitorConfig(monitorSelect, volSlider);
    };
  }

  const _onMonitorUpdate = () => {
    const nextSys = st.state.system;
    if (monitorSelect) {
      for (const opt of monitorSelect.options) {
        opt.selected = opt.value === (nextSys.monitor_device ?? '');
      }
    }
    if (volSlider && volLabel) {
      volSlider.value = nextSys.monitor_volume_db ?? 0;
      volLabel.textContent = `${volSlider.value} dB`;
    }
  };
  window.addEventListener('pb:monitor-update', _onMonitorUpdate);
  const _cleanup = new MutationObserver(() => {
    if (!document.contains(monitorSelect)) {
      window.removeEventListener('pb:monitor-update', _onMonitorUpdate);
      _cleanup.disconnect();
    }
  });
  if (monitorSelect) _cleanup.observe(document.body, { childList: true, subtree: true });

  const dspBar = container.querySelector('.sys-dsp-cpu');
  if (dspBar) {
    const _dspPoll = setInterval(async () => {
      if (!document.contains(dspBar)) { clearInterval(_dspPoll); return; }
      try {
        const h = await api.getHealth();
        dspBar.innerHTML = _renderDspCpuBar(h?.dsp);
      } catch (_) {}
    }, 2000);
  }
}

function _renderConfigCard() {
  return `
    <div class="sys-card sys-card-config">
      <div class="sys-card-title">Configuration</div>
      <div class="sys-config-flow">
        <div class="sys-config-step">
          <div class="sys-config-step-head">
            <span class="sys-config-step-num">1</span>
            <div>
              <div class="sys-config-step-title">Choose source</div>
              <div class="sys-config-help">Stage an upload or saved backup before applying it.</div>
            </div>
          </div>
          <div class="sys-config-actions">
            <button class="sys-btn" id="sys-config-download-live-btn">Download live config</button>
            <input type="file" id="sys-config-upload-file" accept=".toml" hidden>
            <button class="sys-btn" id="sys-config-upload-btn">Choose .toml file…</button>
          </div>
          <div id="sys-config-source-summary" class="sys-config-source-summary">${_renderConfigSourceSummary()}</div>
        </div>

        <div class="sys-config-step">
          <div class="sys-config-step-head">
            <span class="sys-config-step-num">2</span>
            <div>
              <div class="sys-config-step-title">Validate &amp; preview</div>
              <div class="sys-config-help">Preview staged changes before import or restore.</div>
            </div>
          </div>
          <div class="sys-config-actions">
            <button class="sys-btn" id="sys-config-validate-btn" ${configFlowState.candidate ? '' : 'disabled'}>${configFlowState.previewBusy ? 'Previewing…' : 'Validate & preview'}</button>
            <span id="sys-config-preview-status" class="sys-config-status">${_esc(_getConfigStatusText())}</span>
          </div>
          <div id="sys-config-preview" class="sys-config-preview">${_renderConfigPreview()}</div>
        </div>

        <div class="sys-config-step">
          <div class="sys-config-step-head">
            <span class="sys-config-step-num">3</span>
            <div>
              <div class="sys-config-step-title">Apply staged config</div>
              <div class="sys-config-help">Applying replaces the current config and restarts the service.</div>
            </div>
          </div>
          <div class="sys-config-actions">
            <button class="sys-btn sys-btn-warn" id="sys-config-apply-btn" ${_canApplyConfigCandidate() ? '' : 'disabled'}>${_getConfigApplyLabel()}</button>
            <button class="sys-btn" id="sys-config-clear-btn" ${configFlowState.candidate || configFlowState.previewBusy || configFlowState.applyBusy ? '' : 'disabled'}>Clear selection</button>
            <span id="sys-config-apply-spinner" class="sys-restore-spinner" style="display:${configFlowState.applyBusy ? 'inline-block' : 'none'}"></span>
          </div>
        </div>

        <div class="sys-config-step">
          <div class="sys-config-step-head">
            <span class="sys-config-step-num">4</span>
            <div>
              <div class="sys-config-step-title">Saved backups</div>
              <div class="sys-config-help">Preview a backup before restoring it. Older and richer backup payloads are both supported.</div>
            </div>
          </div>
          <div id="sys-backups-list" class="sys-backups-list">
            <div class="sys-backups-empty">Loading…</div>
          </div>
        </div>
      </div>
    </div>`;
}

function _renderAuditCard() {
  return `
    <div class="sys-card sys-card-audit">
      <div class="sys-card-title">Audit Log</div>
      <div class="sys-audit-toolbar">
        <label class="sys-audit-filter">
          <span class="sys-audit-filter-label">Search</span>
          <input id="sys-audit-query" class="sys-audit-input" type="search" placeholder="Actor, action, target…" value="${_esc(auditLogState.query)}">
        </label>
        <label class="sys-audit-filter">
          <span class="sys-audit-filter-label">Level</span>
          <select id="sys-audit-level" class="sys-audit-select">
            ${['all', 'info', 'warn', 'error'].map(level => `<option value="${level}" ${auditLogState.level === level ? 'selected' : ''}>${level === 'all' ? 'All levels' : level.toUpperCase()}</option>`).join('')}
          </select>
        </label>
        <div class="sys-audit-actions">
          <button class="sys-btn" id="sys-audit-refresh-btn">${auditLogState.loading ? 'Loading…' : 'Reload'}</button>
          <button class="sys-btn" id="sys-audit-export-btn">${auditLogState.exportBusy ? 'Exporting…' : 'Export'}</button>
        </div>
      </div>
      <div id="sys-audit-status" class="sys-audit-status">${_esc(_getAuditStatusText())}</div>
      <div id="sys-audit-body" class="sys-audit-body">${_renderAuditBody()}</div>
    </div>`;
}

function _setupAuditLog() {
  const queryInput = document.getElementById('sys-audit-query');
  const levelSelect = document.getElementById('sys-audit-level');
  const refreshBtn = document.getElementById('sys-audit-refresh-btn');
  const exportBtn = document.getElementById('sys-audit-export-btn');

  queryInput?.addEventListener('input', () => {
    auditLogState.query = queryInput.value;
    _syncAuditUi();
  });

  levelSelect?.addEventListener('change', () => {
    auditLogState.level = levelSelect.value;
    _syncAuditUi();
  });

  refreshBtn?.addEventListener('click', async () => {
    await _loadAuditLog();
  });

  exportBtn?.addEventListener('click', async () => {
    await _exportAuditLog();
  });

  _syncAuditUi();
  _loadAuditLog();
}

async function _loadAuditLog() {
  auditLogState.loading = true;
  auditLogState.lastError = '';
  _syncAuditUi();

  try {
    const result = await api.getSystemAuditLog({ q: auditLogState.query, level: auditLogState.level, limit: 100 });
    if (result.supported === false || AUDIT_UNSUPPORTED.has(result.status)) {
      auditLogState.supported = false;
      auditLogState.rows = [];
      auditLogState.lastUpdated = null;
      return;
    }

    auditLogState.supported = true;
    auditLogState.rows = (result.rows ?? []).map(_normaliseAuditRow).filter(Boolean);
    auditLogState.lastUpdated = new Date().toLocaleString();
  } catch (e) {
    if (AUDIT_UNSUPPORTED.has(e.status)) {
      auditLogState.supported = false;
      auditLogState.rows = [];
      auditLogState.lastUpdated = null;
    } else {
      auditLogState.supported = true;
      auditLogState.lastError = _extractErrorMessage(e);
    }
  } finally {
    auditLogState.loading = false;
    _syncAuditUi();
  }
}

async function _exportAuditLog() {
  if (auditLogState.exportBusy) return;

  auditLogState.exportBusy = true;
  auditLogState.lastError = '';
  _syncAuditUi();

  try {
    const result = await api.downloadSystemAuditLog({ q: auditLogState.query, level: auditLogState.level });
    if (result.supported === false || AUDIT_UNSUPPORTED.has(result.status)) {
      auditLogState.supported = false;
      toast('Audit export is not available on this device yet.', true);
      return;
    }
    auditLogState.supported = true;
    await _downloadResponse(result.response, 'patchbox-audit-log.json');
  } catch (e) {
    if (AUDIT_UNSUPPORTED.has(e.status)) {
      auditLogState.supported = false;
      toast('Audit export is not available on this device yet.', true);
    } else {
      auditLogState.lastError = _extractErrorMessage(e);
      toast('Audit export failed: ' + _extractErrorMessage(e), true);
    }
  } finally {
    auditLogState.exportBusy = false;
    _syncAuditUi();
  }
}

function _syncAuditUi() {
  const statusEl = document.getElementById('sys-audit-status');
  const bodyEl = document.getElementById('sys-audit-body');
  const refreshBtn = document.getElementById('sys-audit-refresh-btn');
  const exportBtn = document.getElementById('sys-audit-export-btn');
  const queryInput = document.getElementById('sys-audit-query');
  const levelSelect = document.getElementById('sys-audit-level');

  if (queryInput && queryInput.value !== auditLogState.query) queryInput.value = auditLogState.query;
  if (levelSelect && levelSelect.value !== auditLogState.level) levelSelect.value = auditLogState.level;
  if (statusEl) statusEl.textContent = _getAuditStatusText();
  if (bodyEl) bodyEl.innerHTML = _renderAuditBody();
  if (refreshBtn) refreshBtn.textContent = auditLogState.loading ? 'Loading…' : 'Reload';
  if (refreshBtn) refreshBtn.disabled = auditLogState.loading || auditLogState.exportBusy;
  if (exportBtn) exportBtn.textContent = auditLogState.exportBusy ? 'Exporting…' : 'Export';
  if (exportBtn) exportBtn.disabled = auditLogState.loading || auditLogState.exportBusy || auditLogState.supported === false;
}

function _renderAuditBody() {
  if (auditLogState.loading && auditLogState.rows.length === 0) {
    return '<div class="sys-audit-empty">Loading audit log…</div>';
  }

  if (auditLogState.supported === false) {
    return '<div class="sys-audit-empty">Audit backend not available yet. Filters and export wiring are ready for the endpoint.</div>';
  }

  if (auditLogState.lastError) {
    return `<div class="sys-audit-empty">Failed to load audit log: ${_esc(auditLogState.lastError)}</div>`;
  }

  const rows = _getFilteredAuditRows();
  if (rows.length === 0) {
    return '<div class="sys-audit-empty">No audit events to show.</div>';
  }

  return `
    <div class="sys-audit-table-wrap">
      <table class="sys-audit-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Target</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              <td>${_esc(row.whenLabel)}</td>
              <td>${_esc(row.actor)}</td>
              <td>
                <div class="sys-audit-action">${_esc(row.action)}</div>
                ${row.details ? `<div class="sys-audit-details">${_esc(row.details)}</div>` : ''}
              </td>
              <td>${_esc(row.target)}</td>
              <td><span class="sys-audit-badge ${_auditBadgeClass(row.level)}">${_esc(row.outcome)}</span></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function _getFilteredAuditRows() {
  const query = auditLogState.query.trim().toLowerCase();
  return auditLogState.rows.filter(row => {
    if (auditLogState.level !== 'all' && row.level !== auditLogState.level) return false;
    if (!query) return true;
    const haystack = [row.whenLabel, row.actor, row.action, row.target, row.outcome, row.details]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
}

function _getAuditStatusText() {
  if (auditLogState.loading) return 'Loading audit log…';
  if (auditLogState.supported === false) return 'Audit endpoint unavailable on this device.';
  if (auditLogState.lastError) return `Load failed: ${auditLogState.lastError}`;
  const count = _getFilteredAuditRows().length;
  const suffix = auditLogState.lastUpdated ? ` Last updated ${auditLogState.lastUpdated}.` : '';
  return count === 0 ? `No audit events.${suffix}` : `${count} audit event${count === 1 ? '' : 's'} shown.${suffix}`;
}

function _normaliseAuditRow(entry) {
  if (entry == null) return null;

  if (typeof entry === 'string') {
    return {
      whenLabel: '—',
      actor: '—',
      action: entry,
      target: '—',
      outcome: 'Event',
      level: 'info',
      details: '',
    };
  }

  if (typeof entry !== 'object') {
    return {
      whenLabel: '—',
      actor: '—',
      action: String(entry),
      target: '—',
      outcome: 'Event',
      level: 'info',
      details: '',
    };
  }

  const level = _normaliseAuditLevel(entry.level ?? entry.severity ?? entry.result ?? entry.status);
  return {
    whenLabel: _formatAuditTimestamp(entry.timestamp ?? entry.ts ?? entry.time ?? entry.created_at ?? entry.at ?? entry.date),
    actor: String(entry.actor ?? entry.user ?? entry.username ?? entry.principal ?? '—'),
    action: String(entry.action ?? entry.event ?? entry.message ?? entry.summary ?? entry.type ?? 'Event'),
    target: String(entry.target ?? entry.resource ?? entry.object ?? entry.subject ?? entry.path ?? '—'),
    outcome: String(entry.outcome ?? entry.result ?? entry.status ?? entry.level ?? entry.severity ?? 'Event'),
    level,
    details: _auditDetails(entry.details ?? entry.description ?? entry.note ?? ''),
  };
}

function _normaliseAuditLevel(value) {
  const level = String(value ?? '').toLowerCase();
  if (level.includes('error') || level.includes('fail')) return 'error';
  if (level.includes('warn')) return 'warn';
  return 'info';
}

function _formatAuditTimestamp(value) {
  if (value == null || value === '') return '—';
  if (typeof value === 'number') {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toLocaleString();
  }
  const numeric = /^\d+$/.test(String(value)) ? Number(value) : null;
  if (numeric != null) return _formatAuditTimestamp(numeric);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? String(value) : new Date(parsed).toLocaleString();
}

function _auditDetails(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value;
  return _stringifyPayload(value);
}

function _auditBadgeClass(level) {
  if (level === 'error') return 'is-error';
  if (level === 'warn') return 'is-warn';
  return 'is-info';
}

function _setupMeterBallisticsPreference() {
  const group = document.getElementById('meter-ballistics-group');
  if (!group) return;

  import('./metering.js').then(meter => {
    import('./ws.js').then(ws => {
      const saved = localStorage.getItem('patchbox.meters.ballistics') ?? 'Digital';
      const presetNames = Object.keys(meter.BALLISTICS_PRESETS);

      presetNames.forEach(name => {
        const label = document.createElement('label');
        label.style.display = 'inline-block';
        label.style.marginRight = '1rem';
        label.style.cursor = 'pointer';

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'meter-ballistics';
        radio.value = name;
        radio.checked = (name === saved);

        radio.onchange = () => {
          localStorage.setItem('patchbox.meters.ballistics', name);
          ws.setMeteringBallistics(meter.BALLISTICS_PRESETS[name]);
        };

        label.appendChild(radio);
        label.appendChild(document.createTextNode(` ${name}`));
        group.appendChild(label);
      });

      ws.setMeteringBallistics(meter.BALLISTICS_PRESETS[saved]);
    });
  });
}

function _setupConfigWorkflow() {
  const downloadLiveBtn = document.getElementById('sys-config-download-live-btn');
  const uploadBtn = document.getElementById('sys-config-upload-btn');
  const uploadInput = document.getElementById('sys-config-upload-file');
  const validateBtn = document.getElementById('sys-config-validate-btn');
  const applyBtn = document.getElementById('sys-config-apply-btn');
  const clearBtn = document.getElementById('sys-config-clear-btn');

  downloadLiveBtn?.addEventListener('click', async () => {
    try {
      const r = await api.getConfigBackupDownload();
      await _downloadResponse(r, 'patchbox-config.toml');
    } catch (e) {
      toast('Download failed: ' + _extractErrorMessage(e), true);
    }
  });

  uploadBtn?.addEventListener('click', () => uploadInput?.click());
  uploadInput?.addEventListener('change', async () => {
    const file = uploadInput.files?.[0];
    if (!file) return;
    try {
      const toml = await file.text();
      _stageConfigCandidate({
        sourceType: 'upload',
        applyMode: 'import',
        sourceLabel: file.name,
        toml,
        meta: _compactMetaEntries([
          { label: 'File', value: file.name },
          { label: 'Size', value: _formatBytes(file.size) },
          { label: 'Modified', value: file.lastModified ? new Date(file.lastModified).toLocaleString() : null },
        ]),
      });
      _syncConfigWorkflowUi();
      await _runConfigPreview();
    } catch (e) {
      toast('Failed to read file: ' + _extractErrorMessage(e), true);
    } finally {
      uploadInput.value = '';
    }
  });

  validateBtn?.addEventListener('click', async () => {
    await _runConfigPreview();
  });

  applyBtn?.addEventListener('click', async () => {
    await _applyConfigCandidate();
  });

  clearBtn?.addEventListener('click', () => {
    configFlowState.candidate = null;
    configFlowState.previewBusy = false;
    configFlowState.applyBusy = false;
    _syncConfigWorkflowUi();
  });

  _syncConfigWorkflowUi();
}

async function _loadBackups() {
  const listEl = document.getElementById('sys-backups-list');
  if (!listEl) return;
  try {
    const backups = await api.getConfigBackups();
    const rows = Array.isArray(backups) ? backups.map(_normaliseBackupEntry).filter(Boolean) : [];
    if (rows.length === 0) {
      listEl.innerHTML = '<div class="sys-backups-empty">No backups yet</div>';
      return;
    }

    listEl.innerHTML = rows.map(backup => `
      <div class="sys-backup-row${configFlowState.candidate?.name === backup.name && configFlowState.candidate?.sourceType === 'backup' ? ' is-selected' : ''}">
        <div class="sys-backup-main">
          <div class="sys-backup-name">${_esc(backup.title)}</div>
          ${backup.subtitle ? `<div class="sys-backup-subtitle">${_esc(backup.subtitle)}</div>` : ''}
          ${backup.meta.length ? `<div class="sys-backup-meta">${backup.meta.map(item => `<span class="sys-meta-pill"><span class="k">${_esc(item.label)}</span><span class="v">${_esc(item.value)}</span></span>`).join('')}</div>` : ''}
        </div>
        <div class="sys-backup-actions">
          <button class="sys-btn sys-btn-sm" data-backup-preview="${_esc(backup.name)}" ${backup.name ? '' : 'disabled'}>Preview restore</button>
          <button class="sys-btn sys-btn-sm" data-backup-dl="${_esc(backup.name)}" ${backup.name ? '' : 'disabled'}>Download</button>
        </div>
      </div>`).join('');

    listEl.querySelectorAll('[data-backup-dl]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.backupDl;
        if (!name) return;
        try {
          const r = await api.getConfigBackup(name);
          await _downloadResponse(r, name);
        } catch (e) {
          toast('Download failed: ' + _extractErrorMessage(e), true);
        }
      });
    });

    listEl.querySelectorAll('[data-backup-preview]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.backupPreview;
        const backup = rows.find(row => row.name === name);
        if (!name || !backup) return;
        try {
          const response = await api.getConfigBackup(name);
          const toml = await _readTextResponse(response, `Failed to load ${name}`);
          _stageConfigCandidate({
            sourceType: 'backup',
            applyMode: 'backup-restore',
            sourceLabel: backup.title,
            name,
            toml,
            meta: _compactMetaEntries([
              { label: 'Backup', value: backup.title },
              ...backup.meta,
            ]),
          });
          _syncConfigWorkflowUi();
          await _runConfigPreview();
          _highlightSelectedBackup();
        } catch (e) {
          toast('Backup preview failed: ' + _extractErrorMessage(e), true);
        }
      });
    });
  } catch (e) {
    listEl.innerHTML = '<div class="sys-backups-empty">Failed to load backups</div>';
    console.error('Failed to load backups', e);
  }
}

function _stageConfigCandidate(candidate) {
  configFlowState.candidate = {
    ...candidate,
    preview: null,
    validation: null,
    previewReady: false,
  };
}

async function _runConfigPreview() {
  if (!configFlowState.candidate || configFlowState.previewBusy) return;

  configFlowState.previewBusy = true;
  configFlowState.candidate.previewReady = false;
  configFlowState.candidate.validation = null;
  _syncConfigWorkflowUi();

  try {
    configFlowState.liveToml = await _fetchLiveToml();
    const preview = _buildConfigPreview(configFlowState.liveToml, configFlowState.candidate.toml);
    const validation = await _validateConfigCandidate(configFlowState.candidate.toml);

    configFlowState.candidate.preview = preview;
    configFlowState.candidate.validation = validation;
    configFlowState.candidate.previewReady = true;
  } catch (e) {
    toast('Preview failed: ' + _extractErrorMessage(e), true);
  } finally {
    configFlowState.previewBusy = false;
    _syncConfigWorkflowUi();
    _highlightSelectedBackup();
  }
}

async function _validateConfigCandidate(toml) {
  if (configFlowState.validateAvailable === false) {
    return {
      mode: 'unsupported',
      ok: null,
      message: 'Validation endpoint unavailable on this device. Preview uses client-side diff only.',
      warnings: [],
      errors: [],
      payload: null,
    };
  }

  try {
    const result = await api.postConfigValidate(toml);
    if (result.supported === false || CONFIG_VALIDATE_UNSUPPORTED.has(result.status)) {
      configFlowState.validateAvailable = false;
      return {
        mode: 'unsupported',
        ok: null,
        message: 'Validation endpoint unavailable on this device. Preview uses client-side diff only.',
        warnings: [],
        errors: [],
        payload: result.payload,
      };
    }

    const warnings = Array.isArray(result.payload?.warnings) ? result.payload.warnings : [];
    const errors = Array.isArray(result.payload?.errors) ? result.payload.errors : [];
    const ok = result.payload?.valid !== false;
    configFlowState.validateAvailable = true;
    return {
      mode: 'server',
      ok,
      message: ok
        ? warnings.length
          ? `Validated on device with ${warnings.length} compatibility warning${warnings.length === 1 ? '' : 's'}.`
          : 'Validated on device.'
        : (errors[0] ?? 'Validation failed on device.'),
      warnings,
      errors,
      payload: result.payload,
    };
  } catch (e) {
    if (CONFIG_VALIDATE_UNSUPPORTED.has(e.status)) {
      configFlowState.validateAvailable = false;
      return {
        mode: 'unsupported',
        ok: null,
        message: 'Validation endpoint unavailable on this device. Preview uses client-side diff only.',
        warnings: [],
        errors: [],
        payload: e.body ?? null,
      };
    }
    if (e.status === 400) {
      configFlowState.validateAvailable = true;
      return {
        mode: 'server',
        ok: false,
        message: _extractErrorMessage(e),
        warnings: [],
        errors: Array.isArray(e.body?.errors) ? e.body.errors : [],
        payload: e.body ?? null,
      };
    }
    throw e;
  }
}

async function _applyConfigCandidate() {
  const candidate = configFlowState.candidate;
  if (!candidate || !_canApplyConfigCandidate()) return;

  const confirmMessage = candidate.sourceType === 'backup'
    ? `Restore backup "${candidate.sourceLabel}"? Current config will be replaced.`
    : `Import "${candidate.sourceLabel}"? Current config will be replaced.`;
  if (!confirm(confirmMessage)) return;

  configFlowState.applyBusy = true;
  _syncConfigWorkflowUi();

  try {
    if (candidate.applyMode === 'backup-restore' && candidate.name) {
      await api.restoreConfigBackup(candidate.name);
      toast('Backup restored — restarting…');
    } else {
      const response = await api.postConfigImport(candidate.toml);
      if (!response.ok) throw new Error(await response.text());
      toast('Config imported — restarting…');
    }

    configFlowState.candidate = null;
    configFlowState.liveToml = null;
    _syncConfigWorkflowUi();
    _showRestartOverlay();
  } catch (e) {
    toast('Apply failed: ' + _extractErrorMessage(e), true);
  } finally {
    configFlowState.applyBusy = false;
    _syncConfigWorkflowUi();
  }
}

function _syncConfigWorkflowUi() {
  const sourceEl = document.getElementById('sys-config-source-summary');
  const statusEl = document.getElementById('sys-config-preview-status');
  const previewEl = document.getElementById('sys-config-preview');
  const validateBtn = document.getElementById('sys-config-validate-btn');
  const applyBtn = document.getElementById('sys-config-apply-btn');
  const clearBtn = document.getElementById('sys-config-clear-btn');
  const spinnerEl = document.getElementById('sys-config-apply-spinner');

  if (sourceEl) sourceEl.innerHTML = _renderConfigSourceSummary();
  if (statusEl) statusEl.textContent = _getConfigStatusText();
  if (previewEl) previewEl.innerHTML = _renderConfigPreview();
  if (validateBtn) {
    validateBtn.disabled = !configFlowState.candidate || configFlowState.previewBusy || configFlowState.applyBusy;
    validateBtn.textContent = configFlowState.previewBusy ? 'Previewing…' : 'Validate & preview';
  }
  if (applyBtn) {
    applyBtn.disabled = !_canApplyConfigCandidate() || configFlowState.applyBusy;
    applyBtn.textContent = configFlowState.applyBusy ? 'Applying…' : _getConfigApplyLabel();
  }
  if (clearBtn) clearBtn.disabled = !(configFlowState.candidate || configFlowState.previewBusy || configFlowState.applyBusy);
  if (spinnerEl) spinnerEl.style.display = configFlowState.applyBusy ? 'inline-block' : 'none';
  _highlightSelectedBackup();
}

function _renderConfigSourceSummary() {
  const candidate = configFlowState.candidate;
  if (!candidate) {
    return '<div class="sys-config-empty">No staged config selected yet.</div>';
  }

  return `
    <div class="sys-config-source-card">
      <div class="sys-config-source-title">${_esc(candidate.sourceType === 'backup' ? 'Staged backup restore' : 'Staged config import')}</div>
      <div class="sys-config-source-name">${_esc(candidate.sourceLabel)}</div>
      ${candidate.meta?.length ? `<div class="sys-config-meta">${candidate.meta.map(item => `<span class="sys-meta-pill"><span class="k">${_esc(item.label)}</span><span class="v">${_esc(item.value)}</span></span>`).join('')}</div>` : ''}
    </div>`;
}

function _renderConfigPreview() {
  const candidate = configFlowState.candidate;
  if (!candidate) {
    return '<div class="sys-config-empty">Select an upload or backup to preview.</div>';
  }

  const preview = candidate.preview;
  const validation = candidate.validation;
  if (!preview) {
    return '<div class="sys-config-empty">Preview not generated yet.</div>';
  }

  const validationClass = validation?.ok === false
    ? 'is-error'
    : validation?.mode === 'unsupported'
      ? 'is-muted'
      : 'is-ok';
  const warnings = Array.isArray(validation?.warnings) ? validation.warnings : [];

  return `
    <div class="sys-config-preview-blocks">
      <div class="sys-config-preview-card ${validationClass}">
        <div class="sys-config-preview-title">Validation</div>
        <div class="sys-config-preview-copy">${_esc(validation?.message ?? 'Preview ready.')}</div>
        ${warnings.length ? `
          <div class="sys-config-warning-list">
            ${warnings.map((warning) => `
              <div class="sys-config-warning">
                <div class="sys-config-warning-summary">${_esc(warning?.summary ?? warning?.code ?? 'Compatibility warning')}</div>
                <div class="sys-config-warning-details">
                  ${(warning?.details ?? []).map((detail) => `<div>${_esc(detail)}</div>`).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}
        ${validation?.payload != null && validation.payload !== '' && (validation?.ok === false || validation?.mode === 'unsupported')
          ? `<pre class="sys-config-server-payload">${_esc(_stringifyPayload(validation.payload))}</pre>`
          : ''}
      </div>

      <div class="sys-config-preview-card">
        <div class="sys-config-preview-title">Diff preview</div>
        <div class="sys-config-stats">
          <span class="sys-stat-pill"><span class="k">Current lines</span><span class="v">${preview.currentLineCount}</span></span>
          <span class="sys-stat-pill"><span class="k">Staged lines</span><span class="v">${preview.candidateLineCount}</span></span>
          <span class="sys-stat-pill"><span class="k">Changed lines</span><span class="v">${preview.changedLineCount}</span></span>
        </div>
        ${preview.identical ? '<div class="sys-config-preview-copy">Staged config matches the current live config.</div>' : `
          ${preview.sectionSummary.length ? `<div class="sys-config-section-list">${preview.sectionSummary.map(item => `<span class="sys-stat-pill"><span class="k">${_esc(item.label)}</span><span class="v">${_esc(item.value)}</span></span>`).join('')}</div>` : ''}
          ${preview.sample.length ? `<div class="sys-config-diff-list">${preview.sample.map(item => `
            <div class="sys-config-diff-row ${item.kind}">
              <div class="sys-config-diff-meta">Line ${item.line} · ${_esc(item.kind)}</div>
              ${item.before !== null ? `<div class="sys-config-diff-before">− ${_esc(item.before || ' ')}</div>` : ''}
              ${item.after !== null ? `<div class="sys-config-diff-after">+ ${_esc(item.after || ' ')}</div>` : ''}
            </div>`).join('')}</div>` : '<div class="sys-config-preview-copy">No sample lines available.</div>'}
        `}
      </div>
    </div>`;
}

function _getConfigStatusText() {
  const candidate = configFlowState.candidate;
  if (configFlowState.previewBusy) return 'Building preview…';
  if (!candidate) return 'Stage a file or backup to preview changes.';
  if (!candidate.preview) return 'Preview not generated yet.';
  if (candidate.validation?.ok === false) return 'Validation failed. Fix the config before applying.';
  if (candidate.validation?.mode === 'unsupported') return 'Server validation unavailable. Diff preview is client-side only.';
  if ((candidate.validation?.warnings?.length ?? 0) > 0) {
    return `${candidate.validation.warnings.length} compatibility warning${candidate.validation.warnings.length === 1 ? '' : 's'} to review before applying.`;
  }
  return 'Preview ready.';
}

function _getConfigApplyLabel() {
  const candidate = configFlowState.candidate;
  if (!candidate) return 'Apply staged config';
  return candidate.sourceType === 'backup' ? 'Restore staged backup' : 'Import staged config';
}

function _canApplyConfigCandidate() {
  const candidate = configFlowState.candidate;
  return Boolean(candidate && candidate.previewReady && candidate.validation?.ok !== false);
}

async function _fetchLiveToml() {
  const response = await api.getConfigExport();
  return _readTextResponse(response, 'Failed to fetch live config');
}

async function _downloadResponse(response, fallbackName) {
  const blob = await _readBlobResponse(response, 'Download failed');
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="?([^\"]+)"?/i);
  const filename = match?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function _readTextResponse(response, fallbackMessage) {
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(text || `${fallbackMessage} (${response.status})`);
  }
  return text;
}

async function _readBlobResponse(response, fallbackMessage) {
  const blob = await response.blob().catch(() => null);
  if (!response.ok) {
    let text = '';
    try { text = blob ? await blob.text() : ''; } catch (_) {}
    throw new Error(text || `${fallbackMessage} (${response.status})`);
  }
  return blob;
}

function _buildConfigPreview(currentToml, candidateToml) {
  const currentLines = _splitLines(currentToml);
  const candidateLines = _splitLines(candidateToml);
  const sample = [];
  const maxLines = Math.max(currentLines.length, candidateLines.length);
  let changedLineCount = 0;

  for (let idx = 0; idx < maxLines; idx++) {
    const before = currentLines[idx];
    const after = candidateLines[idx];
    if (before === after) continue;
    changedLineCount += 1;
    if (sample.length >= CONFIG_PREVIEW_LINE_LIMIT) continue;
    sample.push({
      line: idx + 1,
      kind: before == null ? 'added' : after == null ? 'removed' : 'changed',
      before: before ?? null,
      after: after ?? null,
    });
  }

  const currentSections = _extractTomlSections(currentToml);
  const nextSections = _extractTomlSections(candidateToml);
  const addedSections = nextSections.filter(name => !currentSections.includes(name)).slice(0, CONFIG_SECTION_LIMIT);
  const removedSections = currentSections.filter(name => !nextSections.includes(name)).slice(0, CONFIG_SECTION_LIMIT);

  return {
    identical: currentToml === candidateToml,
    currentLineCount: currentLines.length,
    candidateLineCount: candidateLines.length,
    changedLineCount,
    sample,
    sectionSummary: _compactMetaEntries([
      addedSections.length ? { label: 'Added sections', value: addedSections.join(', ') } : null,
      removedSections.length ? { label: 'Removed sections', value: removedSections.join(', ') } : null,
    ]),
  };
}

function _splitLines(text) {
  if (!text) return [];
  return String(text).replace(/\r\n/g, '\n').split('\n');
}

function _extractTomlSections(text) {
  const sections = [];
  for (const line of _splitLines(text)) {
    const trimmed = line.trim();
    const match = trimmed.match(/^\[{1,2}([^\]]+)\]{1,2}$/);
    if (match) sections.push(match[1].trim());
  }
  return [...new Set(sections)];
}

function _normaliseBackupEntry(entry) {
  if (entry == null) return null;

  if (typeof entry === 'string') {
    const timestamp = _coerceBackupTimestamp(_guessBackupTimestamp(entry));
    return {
      name: entry,
      title: entry,
      subtitle: timestamp ? _formatBackupTimestamp(timestamp) : '',
      meta: _compactMetaEntries([]),
    };
  }

  if (typeof entry !== 'object') {
    const value = String(entry);
    return { name: value, title: value, subtitle: '', meta: [] };
  }

  const name = String(entry.name ?? entry.filename ?? entry.file ?? entry.path ?? '');
  const timestamp = _coerceBackupTimestamp(entry.timestamp ?? entry.ts ?? entry.created_at ?? entry.createdAt ?? _guessBackupTimestamp(name));
  const extras = [];

  for (const [key, rawValue] of Object.entries(entry)) {
    if (rawValue == null || rawValue === '') continue;
    if (['name', 'filename', 'file', 'path', 'timestamp', 'ts', 'created_at', 'createdAt'].includes(key)) continue;
    extras.push({ label: _humanizeKey(key), value: _formatMetaValue(key, rawValue) });
  }

  return {
    name,
    title: name || 'Backup',
    subtitle: timestamp ? _formatBackupTimestamp(timestamp) : '',
    meta: _compactMetaEntries(extras),
  };
}

function _guessBackupTimestamp(name) {
  const match = String(name ?? '').match(/-bak-(\d+)\.toml$/);
  if (!match) return null;
  return Number(match[1]);
}

function _coerceBackupTimestamp(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    return value > 1e12 ? Math.round(value / 1000) : Math.round(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return _coerceBackupTimestamp(Number(value));
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : Math.round(parsed / 1000);
}

function _formatBackupTimestamp(timestamp) {
  try {
    return new Date(timestamp * 1000).toLocaleString();
  } catch (_) {
    return String(timestamp);
  }
}

function _highlightSelectedBackup() {
  document.querySelectorAll('.sys-backup-row').forEach(row => {
    const previewBtn = row.querySelector('[data-backup-preview]');
    const selected = previewBtn?.dataset.backupPreview && configFlowState.candidate?.sourceType === 'backup'
      && configFlowState.candidate?.name === previewBtn.dataset.backupPreview;
    row.classList.toggle('is-selected', Boolean(selected));
  });
}

function _compactMetaEntries(entries) {
  return (entries ?? []).filter(Boolean).filter(item => item.value != null && item.value !== '').slice(0, CONFIG_META_LIMIT);
}

function _humanizeKey(key) {
  return String(key)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, ch => ch.toUpperCase());
}

function _formatMetaValue(key, value) {
  if (typeof value === 'number' && /size|bytes/i.test(key)) return _formatBytes(value);
  if (typeof value === 'number' && /timestamp|created|updated|saved/i.test(key)) return _formatBackupTimestamp(_coerceBackupTimestamp(value));
  if (Array.isArray(value)) return value.map(item => _formatMetaValue(key, item)).join(', ');
  if (typeof value === 'object') return _stringifyPayload(value);
  return String(value);
}

function _formatBytes(size) {
  if (size == null || Number.isNaN(Number(size))) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(size);
  let unit = units[0];
  for (let idx = 0; idx < units.length - 1 && value >= 1024; idx++) {
    value /= 1024;
    unit = units[idx + 1];
  }
  return `${value >= 10 || unit === 'B' ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function _stringifyPayload(payload) {
  if (typeof payload === 'string') return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch (_) {
    return String(payload);
  }
}

function _extractErrorMessage(error) {
  if (!error) return 'Unknown error';
  if (error.body?.error) return error.body.error;
  if (error.body?.message) return error.body.message;
  return error.message ?? String(error);
}

async function _saveMonitorConfig(devSelect, volSlider) {
  try {
    await api.putMonitor({
      device: devSelect.value || null,
      volume_db: parseFloat(volSlider.value),
    });
  } catch (e) {
    console.error('Monitor config error:', e);
    toast('Failed to save monitor config: ' + e.message, true);
  }
}

function _esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _e(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
    } catch (_) {}
  }, 2000);
}

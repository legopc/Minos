// dante.js — Dante tab
import * as api from './api.js';
import * as st  from './state.js';
import { toast } from './toast.js';

let _pollTimer = null;
let _container = null;
let _diag = null;
let _routeTrace = null;
let _traceTxId = null;
let _traceBusy = false;
let _pendingAction = null;
let _listenersBound = false;

export function render(container) {
  _container = container;
  _ensureListeners();
  _ensurePolling();
  _render();
  _refresh();
}

async function _refresh() {
  if (st.state.activeTab !== 'dante') return;
  try {
    const nextTraceTxId = _getTraceTxId();
    const [diag, trace] = await Promise.all([
      api.getDanteDiagnostics(),
      nextTraceTxId ? api.getRouteTrace(nextTraceTxId).catch(() => null) : Promise.resolve(null),
    ]);
    _diag = diag;
    _routeTrace = trace;
    _traceTxId = nextTraceTxId;
    _render();
  } catch {
    // Ignore transient errors; system poll + WS continue to update other UI bits.
  }
}

function _ensurePolling() {
  if (_pollTimer) return;
  _pollTimer = setInterval(() => {
    if (st.state.activeTab !== 'dante') return;
    _refresh();
  }, 2000);
}

function _render() {
  if (!_container) return;

  const sys = st.state.system;
  const diag = _diag;

  const cards = diag ? `
    <div class="dante-diag-grid">
      ${_renderCard('Device', diag.device)}
      ${_renderRosterCard(diag.roster)}
      ${_renderSubscriptionsCard(diag.subscriptions)}
      ${_renderRouteTraceCard()}
      ${_renderCard('Network', diag.network)}
      ${_renderCard('PTP', diag.ptp)}
      ${_renderPtpHistoryCard(diag.ptp_history)}
      ${_renderEventLogCard(diag.event_log)}
      ${_renderTaskCard()}
      ${_renderRecoveryCard(diag.recovery_actions)}
    </div>
    <div class="dante-diag-meta">Updated: ${_e(diag.generated_at ?? '—')}</div>
  ` : `<div class="dante-diag-loading">Loading diagnostics…</div>`;

  _container.innerHTML = `
    <div class="dante-wrap">
      <div class="dante-title">Dante Diagnostics</div>

      <table class="dante-info-table">
        <tr><td>Hostname</td><td>${_e(sys.hostname ?? '—')}</td></tr>
        <tr><td>Dante Status</td><td>${_e(sys.dante_status ?? '—')}</td></tr>
        <tr><td>PTP Locked</td><td style="color:${st.state.ptp.locked ? 'var(--dot-live)' : 'var(--dot-error)'}">${st.state.ptp.locked ? 'Yes' : 'No'}</td></tr>
        <tr><td>Sample Rate</td><td>${sys.sample_rate ? (sys.sample_rate/1000).toFixed(1)+' kHz' : '—'}</td></tr>
        <tr><td>RX Channels</td><td>${sys.rx_count ?? '—'}</td></tr>
        <tr><td>TX Channels</td><td>${sys.tx_count ?? '—'}</td></tr>
        <tr><td>Version</td><td>${_e(sys.version ?? '—')}</td></tr>
      </table>

      ${cards}
    </div>`;

  _bindRecoveryActions();
  _bindEventLogActions();
  _bindTraceControls();
}

function _renderCard(title, card) {
  if (!card) return '';
  const lvl = String(card.level || 'unknown');
  const items = Array.isArray(card.items) ? card.items : [];
  return `
    <div class="dante-diag-card dante-diag-${_e(lvl)}">
      <div class="dante-diag-card-h">
        <div class="dante-diag-card-title">${_e(title)}</div>
        <div class="dante-diag-card-level">${_e(lvl)}</div>
      </div>
      <div class="dante-diag-card-summary">${_e(card.summary ?? '')}</div>
      <div class="dante-diag-items">
        ${items.map(it => `<div class="dante-diag-item"><div class="k">${_e(it.label ?? '')}</div><div class="v">${_e(it.value ?? '')}</div></div>`).join('')}
      </div>
    </div>`;
}

function _renderPtpHistoryCard(samples) {
  const arr = Array.isArray(samples) ? samples : [];
  const offsets = arr.map(s => (typeof s.offset_ns === 'number' ? s.offset_ns : null)).filter(v => v !== null);

  const lockedCount = arr.filter(s => s.locked === true).length;
  const lockedPct = arr.length ? Math.round((lockedCount / arr.length) * 100) : 0;

  let latest = null;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (typeof arr[i].offset_ns === 'number') { latest = arr[i].offset_ns; break; }
  }

  const min = offsets.length ? Math.min(...offsets) : null;
  const max = offsets.length ? Math.max(...offsets) : null;

  const spark = _sparkline(offsets);

  return `
    <div class="dante-diag-card">
      <div class="dante-diag-card-h">
        <div class="dante-diag-card-title">PTP History</div>
        <div class="dante-diag-card-level">${arr.length ? (arr.length + ' samples') : '—'}</div>
      </div>
      <div class="dante-ptp-history">
        <div class="dante-ptp-stats">
          <div><span class="k">Locked</span><span class="v">${lockedPct}%</span></div>
          <div><span class="k">Latest</span><span class="v">${latest === null ? '—' : (latest + ' ns')}</span></div>
          <div><span class="k">Min</span><span class="v">${min === null ? '—' : (min + ' ns')}</span></div>
          <div><span class="k">Max</span><span class="v">${max === null ? '—' : (max + ' ns')}</span></div>
        </div>
        <div class="dante-ptp-spark">${spark}</div>
      </div>
    </div>`;
}

function _renderSubscriptionsCard(subscriptions) {
  const arr = Array.isArray(subscriptions) ? subscriptions : [];
  const active = arr.filter((entry) => entry?.state === 'active').length;
  const routedSilent = arr.filter((entry) => entry?.state === 'routed_silent').length;
  const muted = arr.filter((entry) => entry?.state === 'muted').length;
  const level = routedSilent > 0 || muted > 0
    ? 'warn'
    : active > 0
    ? 'ok'
    : 'unknown';

  return `
    <div class="dante-diag-card dante-diag-${_e(level)} dante-subscription-card">
      <div class="dante-diag-card-h">
        <div class="dante-diag-card-title">Subscription Health</div>
        <div class="dante-diag-card-level">${active}/${arr.length || 0} active</div>
      </div>
      <div class="dante-diag-card-summary">
        Estimated from Minos routing and output metering.${routedSilent || muted ? ` ${routedSilent + muted} output(s) need attention.` : ''}
      </div>
      <div class="dante-subscription-list">
        ${arr.length === 0 ? '<div class="dante-diag-item">No output subscriptions available.</div>' : arr.map((entry) => `
          <div class="dante-subscription-row">
            <div class="dante-subscription-head">
              <span class="dante-subscription-name">${_e(entry.output_name ?? entry.output_id ?? 'Output')}</span>
              <span class="dante-subscription-badge is-${_e(entry.state ?? 'unrouted')}">${_e(_subscriptionStateLabel(entry.state))}</span>
            </div>
            <div class="dante-subscription-meta">
              ${_e(entry.output_id ?? '—')} · ${_e(entry.summary ?? 'Subscription state unavailable.')}
            </div>
            <div class="dante-subscription-sources">
              ${(entry.sources ?? []).length === 0
                ? '<span class="dante-subscription-source is-empty">No routed sources</span>'
                : (entry.sources ?? []).map((source) => `<span class="dante-subscription-source">${_e(source)}</span>`).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
}

function _renderRosterCard(roster) {
  const arr = Array.isArray(roster) ? roster : [];
  const warn = arr.filter((entry) => entry?.level === 'warn' || entry?.level === 'error').length;
  const ok = arr.filter((entry) => entry?.level === 'ok').length;
  const inputs = arr.filter((entry) => entry?.kind === 'input').length;
  const outputs = arr.filter((entry) => entry?.kind === 'output').length;
  const level = warn > 0
    ? 'warn'
    : ok > 0
    ? 'ok'
    : 'unknown';

  return `
    <div class="dante-diag-card dante-diag-${_e(level)} dante-roster-card">
      <div class="dante-diag-card-h">
        <div class="dante-diag-card-title">Local I/O Roster</div>
        <div class="dante-diag-card-level">${inputs} RX · ${outputs} TX</div>
      </div>
      <div class="dante-diag-card-summary">Estimated from Minos config, routing, and live metering.</div>
      <div class="dante-roster-list">
        ${arr.length === 0 ? '<div class="dante-diag-item">No Dante endpoints available.</div>' : arr.map((entry) => `
          <div class="dante-roster-row">
            <div class="dante-roster-head">
              <span class="dante-roster-kind is-${_e(entry.kind ?? 'input')}">${_e(_rosterKindLabel(entry.kind))}</span>
              <span class="dante-roster-name">${_e(entry.name ?? entry.id ?? 'Endpoint')}</span>
              <span class="dante-roster-signal ${entry.signal_present ? 'is-live' : 'is-idle'}">${entry.signal_present ? 'signal' : 'idle'}</span>
            </div>
            <div class="dante-roster-meta">
              ${_e(entry.id ?? '—')} · ${_e(_formatDbfs(entry.level_dbfs))} · ${_e(String(entry.linked_count ?? 0))} linked
            </div>
            <div class="dante-roster-summary">${_e(entry.summary ?? 'Endpoint state unavailable.')}</div>
          </div>
        `).join('')}
      </div>
    </div>`;
}

function _renderRouteTraceCard() {
  const outputs = st.outputList();
  const selectedTxId = _getTraceTxId();
  const warnings = Array.isArray(_routeTrace?.warnings) ? _routeTrace.warnings : [];
  const paths = Array.isArray(_routeTrace?.paths) ? _routeTrace.paths : [];
  const level = warnings.length > 0
    ? 'warn'
    : paths.length > 0
    ? 'ok'
    : 'unknown';

  return `
    <div class="dante-diag-card dante-diag-${_e(level)} dante-trace-card">
      <div class="dante-diag-card-h">
        <div class="dante-diag-card-title">Route Trace</div>
        <div class="dante-diag-card-level">${paths.length} path${paths.length === 1 ? '' : 's'}</div>
      </div>
      <div class="dante-trace-toolbar">
        <label class="dante-trace-label" for="dante-trace-output">Output</label>
        <select id="dante-trace-output" class="dante-trace-select" data-dante-trace-output ${outputs.length ? '' : 'disabled'}>
          ${outputs.length === 0
            ? '<option value="">No outputs</option>'
            : outputs.map((output) => `
              <option value="${_e(output.id)}" ${output.id === selectedTxId ? 'selected' : ''}>${_e(output.name ?? output.id)}</option>
            `).join('')}
        </select>
      </div>
      <div class="dante-diag-card-summary">
        ${_traceBusy
          ? 'Refreshing trace…'
          : _routeTrace?.output_name
            ? `Resolved signal paths feeding ${_e(_routeTrace.output_name)}.`
            : 'Trace the active routing for one output, including bus chains and generators.'}
      </div>
      ${warnings.length ? `
        <div class="dante-trace-warnings">
          ${warnings.map((warning) => `<div class="dante-trace-warning">${_e(warning)}</div>`).join('')}
        </div>
      ` : ''}
      <div class="dante-trace-list">
        ${paths.length === 0
          ? `<div class="dante-diag-item">${_traceBusy ? 'Loading trace…' : 'No active paths traced for this output.'}</div>`
          : paths.map((path) => `
            <div class="dante-trace-row">
              <div class="dante-trace-head">
                <span class="dante-trace-badge is-${_e(path.kind ?? 'direct')}">${_e(_traceKindLabel(path.kind))}</span>
                <span class="dante-trace-summary">${_e(path.summary ?? 'Trace path')}</span>
              </div>
              <div class="dante-trace-hops">
                ${(path.hops ?? []).map((hop) => `<span class="dante-trace-hop is-${_e(hop.kind ?? 'input')}">${_e(hop.name ?? hop.id ?? 'Hop')}</span>`).join('<span class="dante-trace-arrow">→</span>')}
              </div>
            </div>
          `).join('')}
      </div>
    </div>`;
}

function _renderEventLogCard(events) {
  const arr = Array.isArray(events) ? [...events].reverse() : [];
  return `
    <div class="dante-diag-card dante-eventlog-card">
      <div class="dante-diag-card-h">
        <div class="dante-diag-card-title">Network Event Log</div>
        <div class="dante-eventlog-actions">
          <button class="dante-eventlog-export" data-dante-eventlog-export ${arr.length ? '' : 'disabled'}>
            Export JSON
          </button>
          <div class="dante-diag-card-level">${arr.length ? arr.length + ' events' : '—'}</div>
        </div>
      </div>
      <div class="dante-diag-card-summary">Recent Dante, PTP, and recovery transitions.</div>
      <div class="dante-diag-items dante-eventlog-items">
        ${arr.length === 0 ? '<div class="dante-diag-item">No events recorded.</div>' : arr.map(ev => `
          <div class="dante-diag-item">
            <div class="k">${_e(_formatEventTs(ev.ts_ms))}</div>
            <div class="v"><span class="ev-level ev-${_e(ev.level)}">${_e(ev.level)}</span> ${_e(ev.message)}${ev.details ? ': ' + _e(ev.details) : ''}</div>
          </div>
        `).join('')}
      </div>
    </div>`;
}

function _renderTaskCard() {
  const tasks = _getDanteTasks();
  const latest = tasks[0] ?? null;
  const summary = latest
    ? `${_taskStateLabel(latest.state)} — ${_e(latest.label || latest.kind || latest.id || 'Task')}`
    : 'Queued, running, and completed recovery tasks will appear here.';

  return `
    <div class="dante-diag-card dante-task-card">
      <div class="dante-diag-card-h">
        <div class="dante-diag-card-title">Task Status</div>
        <div class="dante-diag-card-level">${latest ? _e(_taskStateLabel(latest.state)) : 'idle'}</div>
      </div>
      <div class="dante-diag-card-summary">${summary}</div>
      <div class="dante-diag-items dante-task-items">
        ${tasks.length === 0 ? '<div class="dante-diag-item">No task updates yet.</div>' : tasks.map(task => `
          <div class="dante-task-item dante-task-${_e(task.state)}">
            <div class="dante-task-row">
              <span class="dante-task-label">${_e(task.label || task.kind || task.id || 'Task')}</span>
              <span class="dante-task-state">${_e(_taskStateLabel(task.state))}</span>
            </div>
            ${task.message ? `<div class="dante-task-message">${_e(task.message)}</div>` : ''}
            <div class="dante-task-meta">
              ${task.kind ? `<span>${_e(task.kind)}</span>` : '<span>task</span>'}
              <span>${_e(_formatEventTs(task.ts_ms))}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
}

function _renderRecoveryCard(actions) {
  const arr = Array.isArray(actions) ? actions : [];
  return `
    <div class="dante-diag-card dante-recovery-card">
      <div class="dante-diag-card-h">
        <div class="dante-diag-card-title">Recovery Actions</div>
        <div class="dante-diag-card-level">Admin</div>
      </div>
      <div class="dante-diag-card-summary">Use explicit recovery actions when Dante or PTP diagnostics need intervention.</div>
      <div class="dante-recovery-actions">
        ${arr.map(action => {
          const id = String(action?.id || '');
          const busy = _pendingAction === id;
          return `
            <button class="dante-recovery-btn${busy ? ' is-busy' : ''}" data-dante-recovery-action="${_e(id)}" ${busy ? 'disabled' : ''}>
              <span class="label">${_e(action?.label ?? id)}</span>
              <span class="desc">${_e(action?.description ?? '')}</span>
            </button>`;
        }).join('')}
      </div>
    </div>`;
}

function _bindRecoveryActions() {
  if (!_container) return;
  _container.querySelectorAll('[data-dante-recovery-action]').forEach((btn) => {
    btn.addEventListener('click', () => _runRecoveryAction(btn.dataset.danteRecoveryAction));
  });
}

function _bindEventLogActions() {
  if (!_container) return;
  _container.querySelectorAll('[data-dante-eventlog-export]').forEach((btn) => {
    btn.addEventListener('click', _exportEventLog);
  });
}

function _bindTraceControls() {
  if (!_container) return;
  _container.querySelectorAll('[data-dante-trace-output]').forEach((select) => {
    select.addEventListener('change', () => {
      _traceTxId = select.value || null;
      _refreshRouteTrace();
    });
  });
}

function _ensureListeners() {
  if (_listenersBound) return;
  _listenersBound = true;
  window.addEventListener('pb:task-update', () => {
    if (st.state.activeTab === 'dante') _render();
  });
}

async function _runRecoveryAction(action) {
  if (!action || _pendingAction) return;
  _pendingAction = action;
  _updateRecoveryTask(action, {
    state: 'queued',
    message: 'Submitting recovery action…',
    local: true,
  });
  _render();
  try {
    const result = await api.postDanteRecoveryAction(action);
    _updateRecoveryTask(action, {
      state: result?.restarting ? 'running' : 'succeeded',
      message: result?.message ?? 'Recovery action sent.',
      local: true,
    });
    toast(result?.message ?? 'Recovery action sent.');
    if (result?.restarting) {
      _showRestartOverlay();
      return;
    }
    await _refresh();
  } catch (e) {
    _updateRecoveryTask(action, {
      state: 'failed',
      message: e?.message ?? String(e),
      local: true,
    });
    toast('Recovery failed: ' + (e?.message ?? String(e)), true);
  } finally {
    _pendingAction = null;
    _render();
  }
}

function _exportEventLog() {
  const events = Array.isArray(_diag?.event_log) ? _diag.event_log : [];
  if (events.length === 0) return;
  const payload = JSON.stringify(events, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dante-event-log-${new Date().toISOString().replace(/[:]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function _sparkline(values) {
  const w = 240, h = 48, pad = 2;
  if (!values || values.length < 2) {
    return `<svg viewBox="0 0 ${w} ${h}" class="ptp-spark" aria-hidden="true"></svg>`;
  }

  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }

  const xStep = (w - pad * 2) / (values.length - 1);
  const yScale = (h - pad * 2) / (max - min);

  const pts = values.map((v, i) => {
    const x = pad + i * xStep;
    const y = pad + (max - v) * yScale;
    return [x, y];
  });

  const d = pts.map((p, i) => (i === 0 ? `M ${p[0].toFixed(2)} ${p[1].toFixed(2)}` : `L ${p[0].toFixed(2)} ${p[1].toFixed(2)}`)).join(' ');

  const y0 = pad + (max - 0) * yScale;
  const y0clamped = Math.max(pad, Math.min(h - pad, y0));

  return `
    <svg viewBox="0 0 ${w} ${h}" class="ptp-spark" aria-hidden="true">
      <line x1="${pad}" y1="${y0clamped.toFixed(2)}" x2="${(w-pad)}" y2="${y0clamped.toFixed(2)}" class="zero" />
      <path d="${d}" />
    </svg>`;
}

function _e(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _formatEventTs(tsMs) {
  const value = Number(tsMs);
  if (!Number.isFinite(value)) return '—';
  return new Date(value).toLocaleString();
}

function _formatDbfs(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${num.toFixed(1)} dBFS`;
}

function _getTraceTxId() {
  const outputs = st.outputList();
  if (_traceTxId && outputs.some((output) => output.id === _traceTxId)) return _traceTxId;
  return outputs[0]?.id ?? _traceTxId ?? null;
}

async function _refreshRouteTrace() {
  const txId = _getTraceTxId();
  _traceBusy = true;
  _render();
  try {
    _routeTrace = txId ? await api.getRouteTrace(txId) : null;
    _traceTxId = txId;
  } catch {
    _routeTrace = null;
  } finally {
    _traceBusy = false;
    if (st.state.activeTab === 'dante') _render();
  }
}

function _getDanteTasks() {
  return st.taskList()
    .filter(_isDanteTask)
    .slice(0, 4);
}

function _isDanteTask(task) {
  const haystack = [
    task?.scope,
    task?.source,
    task?.kind,
    task?.action,
    task?.label,
    task?.id,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes('dante')
    || haystack.includes('recovery')
    || haystack.includes('rescan')
    || haystack.includes('rebind')
    || haystack.includes('restart');
}

function _taskStateLabel(state) {
  switch (st.normaliseTaskState(state)) {
    case 'queued': return 'Queued';
    case 'running': return 'Running';
    case 'succeeded': return 'Succeeded';
    case 'failed': return 'Failed';
    default: return _e(state ?? 'Task');
  }
}

function _subscriptionStateLabel(state) {
  switch (String(state ?? '').trim().toLowerCase()) {
    case 'active': return 'Active';
    case 'routed_silent': return 'Silent';
    case 'muted': return 'Muted';
    case 'unrouted': return 'Unrouted';
    default: return _e(state ?? 'Unknown');
  }
}

function _rosterKindLabel(kind) {
  switch (String(kind ?? '').trim().toLowerCase()) {
    case 'output': return 'TX';
    case 'input': return 'RX';
    default: return 'I/O';
  }
}

function _traceKindLabel(kind) {
  switch (String(kind ?? '').trim().toLowerCase()) {
    case 'generator': return 'Generator';
    case 'bus': return 'Bus';
    case 'direct': return 'Direct';
    default: return 'Trace';
  }
}

function _updateRecoveryTask(action, patch) {
  const meta = _diag?.recovery_actions?.find((entry) => String(entry?.id ?? '') === String(action));
  const task = st.upsertTask({
    id: `dante-recovery:${action}`,
    kind: `dante.recovery.${action}`,
    action,
    label: meta?.label ?? action,
    scope: 'dante',
    source: 'dante-recovery',
    ts_ms: Date.now(),
    ...patch,
  });

  if (task) {
    window.dispatchEvent(new CustomEvent('pb:task-update', { detail: task }));
  }
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
      const sub = ov.querySelector('.restart-sub');
      if (sub) sub.textContent = 'Timed out. Please reload manually.';
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

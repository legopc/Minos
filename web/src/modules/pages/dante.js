// dante.js — V3 Dante / PTP diagnostics page

async function danteApiFetch(method, path, body) {
  const token = sessionStorage.getItem('pb_token');
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

function sanitize(str) {
  return String(str ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function drawSparkline(canvas, history) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.offsetWidth || canvas.parentElement?.offsetWidth || 400;
  const h = canvas.offsetHeight || 120;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, w, h);

  const accentColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-accent').trim() || '#3af';
  const dimColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--text-dim').trim() || '#555';

  const values = history.map(p => (p.offset_ns ?? 0) / 1000); // → µs
  const maxAbs = Math.max(1, ...values.map(Math.abs));
  const scale = (h / 2) / maxAbs;
  const midY = h / 2;
  const stepX = w / Math.max(values.length - 1, 1);

  // Zero line (dashed)
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = dimColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(w, midY);
  ctx.stroke();
  ctx.restore();

  if (values.length < 2) return;

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = i * stepX;
    const y = midY - v * scale;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

export async function init(container) {
  let pollId = null;
  let ptpHistory = [];
  let health = null;
  let logs = [];

  async function fetchHealth() {
    try {
      health = await danteApiFetch('GET', '/api/v1/health');
    } catch (err) {
      console.error('Health fetch failed:', err);
    }
  }

  async function fetchPtpHistory() {
    try {
      const data = await danteApiFetch('GET', '/api/v1/ptp/history');
      ptpHistory = Array.isArray(data) ? data : (data?.history ?? []);
    } catch {
      // endpoint may not exist — silently ignore
    }
  }

  async function fetchLogs() {
    try {
      const data = await danteApiFetch('GET', '/api/v1/system/logs');
      logs = Array.isArray(data) ? data : (data?.logs ?? []);
    } catch {
      logs = [];
    }
  }

  function renderKv(label, value) {
    return `
      <div class="dante-kv-label">${sanitize(label)}</div>
      <div class="dante-kv-value">${sanitize(String(value ?? '—'))}</div>`;
  }

  function renderLogRows() {
    if (logs.length === 0) return '<div style="color:var(--text-dim)">No log entries</div>';
    return logs.slice(-50).reverse().map(row => `
      <div class="dante-event-row">
        <span class="dante-event-time">${sanitize(row.time ?? row.ts ?? '')}</span>
        <span class="dante-event-msg">${sanitize(row.msg ?? row.message ?? '')}</span>
      </div>`).join('');
  }

  function render() {
    const dante = health?.dante ?? {};
    const ptp = health?.ptp ?? {};

    const ptpState = ptp.locked ? 'Synced' : ptp.state ?? 'Unknown';
    const ptpOffset = ptp.offset_ns != null
      ? `${(ptp.offset_ns / 1000).toFixed(2)} µs`
      : '—';

    container.innerHTML = `
      <div class="dante-page">
        <div class="dante-page-title">DANTE DIAGNOSTICS</div>

        <div class="dante-section">
          <div class="dante-section-header">DEVICE INFO</div>
          <div class="dante-kv-grid">
            ${renderKv('Device name', dante.device_name ?? health?.device_name)}
            ${renderKv('NIC', dante.nic ?? health?.nic)}
            ${renderKv('Connected', dante.connected ? 'Yes' : 'No')}
            ${renderKv('RX channels', health?.audio?.rx_channels)}
            ${renderKv('TX channels', health?.audio?.tx_channels)}
            ${renderKv('Subscriptions', dante.subscription_count ?? health?.audio?.active_routes)}
          </div>
        </div>

        <div class="dante-section">
          <div class="dante-section-header">PTP STATUS</div>
          <div class="dante-kv-grid">
            ${renderKv('State', ptpState)}
            ${renderKv('Offset', ptpOffset)}
            ${renderKv('GM identity', ptp.gm_identity ?? ptp.grandmaster)}
            ${renderKv('Domain', ptp.domain)}
          </div>
          <canvas class="dante-ptp-chart" id="ptp-sparkline"></canvas>
        </div>

        <div class="dante-section">
          <div class="dante-section-header">EVENT LOG</div>
          <div class="dante-event-log" id="dante-log">${renderLogRows()}</div>
        </div>
      </div>`;

    const canvas = container.querySelector('#ptp-sparkline');
    if (canvas && ptpHistory.length > 0) {
      // Defer until layout is done
      requestAnimationFrame(() => drawSparkline(canvas, ptpHistory));
    }
  }

  async function poll() {
    await Promise.all([fetchHealth(), fetchPtpHistory()]);
    render();
  }

  container.innerHTML = '<div class="page-loading">Loading…</div>';

  await Promise.all([fetchHealth(), fetchPtpHistory(), fetchLogs()]);
  render();

  pollId = setInterval(poll, 2000);

  return function cleanup() {
    if (pollId !== null) { clearInterval(pollId); pollId = null; }
  };
}

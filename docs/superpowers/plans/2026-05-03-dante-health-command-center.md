# Dante Health Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Dante tab into an admin-first health command center using the existing diagnostics APIs.

**Architecture:** Keep this as a frontend-first change. `web/src/js/dante.js` will reorganize existing diagnostics into a health verdict, four troubleshooting lanes, explicit stale-data state, and safer recovery controls. `web/src/css/dante.css` will replace the equal-weight card dump with a compact command-center layout. Playwright smoke coverage will validate the visible hierarchy and safety behavior.

**Tech Stack:** Plain browser JavaScript modules, CSS, Playwright smoke tests, Rust backend APIs already exposed by Minos.

---

## Constraints

- Do not add a new statime/PTP backend API in this pass.
- Do not change backend recovery authorization in this pass.
- Do not deploy to dante-doos in this pass.
- Do not commit unless the user explicitly asks. The generic superpowers plan template recommends commits; this workspace explicitly requires user approval before commits.
- Preserve current endpoint usage:
  - `GET /api/v1/system/dante/diagnostics`
  - `GET /api/v1/routes/trace?tx_id=...`
  - `POST /api/v1/system/dante/recovery-actions/:action`

## File Structure

- Modify `web/src/js/dante.js`
  - Owns Dante tab state, polling, health verdict derivation, lane rendering, recovery action handling, and restart confirmation.
  - Keep all Dante-specific rendering in this file. Do not create helper modules unless the file becomes impossible to reason about during implementation.
- Modify `web/src/css/dante.css`
  - Owns layout and visual treatment for the new command center.
  - Retain existing class names only where they are still semantically correct.
- Modify `tests/ui/src/smoke.spec.ts`
  - Add focused Dante UI smoke tests using mocked frontend fetch calls where needed.
  - Keep tests inside the existing `Minos UI smoke` describe block.
- Optionally modify `docs/src/config/dante.md`
  - Only if implementation changes visible user-facing guidance. At minimum, update the stale “See System tab” line if time permits.

## Task 0: Dispatch Statime/Inferno Compatibility Research

**Files:**
- Read-only context: `/home/legopc/_archive/copilot_projects/Inferno_Appliance/inferno-aoip-releases`
- Read-only context: `/home/legopc/_Inferno/inferno-ptpv1-master`
- Read-only context: `/home/legopc/Opencode/minos`

- [ ] **Step 1: Dispatch a read-only research agent before implementation**

Use this prompt exactly:

```text
Research whether Minos can gain richer structured PTP/statime diagnostics without breaking compatibility with the existing Inferno/Virgil statime work.

Relevant paths:
- Virgil/Inferno release project: /home/legopc/_archive/copilot_projects/Inferno_Appliance/inferno-aoip-releases
- PTPv1 master/statime work: /home/legopc/_Inferno/inferno-ptpv1-master
- Minos project: /home/legopc/Opencode/minos

Goals:
1. Inspect the statime branches/configs used by Virgil/Inferno, especially teodly/statime inferno-dev and legopc/statime ptpv1-master.
2. Identify whether statime already exposes structured observation data that Minos can read without scraping journald.
3. Determine whether adding richer diagnostic output is feasible without breaking existing Virgil/Inferno behavior, configs, or service assumptions.
4. Identify the safest compatibility path: reuse existing observation socket, add a separate optional endpoint/socket/file, or add statime logging/JSON output behind config.
5. Propose a minimal JSON shape for Minos PTP diagnostics, including service state, protocol version, domain, role, grandmaster, offset, offset distribution, hardware timestamping, clock socket freshness, and config path.
6. Call out risks around PTPv1 master vs slave configs, protocol-version differences, hardware-clock behavior, usrvclock export, and statime branch drift.

Constraints:
- Do not modify repositories.
- Do not assume Virgil's frontend journal scraping is acceptable for Minos.
- Preserve backward compatibility for existing Inferno/Virgil image/service behavior.
- Return concrete file references, branch/commit details, available data sources, proposed diagnostic schema, and a compatibility recommendation.
```

- [ ] **Step 2: Record the research outcome as future work only**

Do not implement statime backend changes in this branch. If the research finds a safe path, capture it in the final report or a follow-up note.

## Task 1: Add Dante Health Command Center Test Skeleton

**Files:**
- Modify: `tests/ui/src/smoke.spec.ts`

- [ ] **Step 1: Add a helper fixture inside `smoke.spec.ts` near the top of the file**

Add this helper after `loginAndGetToken`:

```ts
function danteDiagnosticsFixture(overrides: Record<string, any> = {}) {
  return {
    generated_at: new Date().toISOString(),
    device: {
      level: 'ok',
      summary: 'Dante connected',
      items: [
        { label: 'Device', value: 'patchbox-test' },
        { label: 'NIC', value: 'eth0' },
        { label: 'RX', value: '4' },
        { label: 'TX', value: '4' },
      ],
    },
    network: {
      level: 'unknown',
      summary: 'Network',
      items: [{ label: 'NIC', value: 'eth0' }],
    },
    ptp: {
      level: 'ok',
      summary: 'PTP locked',
      items: [
        { label: 'Clock socket', value: '/tmp/ptp-usrvclock (present)' },
        { label: 'Observation socket', value: '/run/statime/observation.sock' },
        { label: 'State', value: 'synchronized' },
        { label: 'Offset', value: '120 ns' },
      ],
    },
    ptp_history: [
      { ts_ms: Date.now() - 2000, locked: true, offset_ns: 150 },
      { ts_ms: Date.now() - 1000, locked: true, offset_ns: 120 },
    ],
    roster: [
      {
        id: 'rx_0',
        kind: 'input',
        name: 'Input 1',
        level: 'ok',
        estimated: true,
        linked_count: 1,
        signal_present: true,
        level_dbfs: -18,
        summary: 'Feeds 1 destination and carries signal.',
      },
      {
        id: 'tx_0',
        kind: 'output',
        name: 'Zone 1',
        level: 'ok',
        estimated: true,
        linked_count: 1,
        signal_present: true,
        level_dbfs: -20,
        summary: '1 routed source is feeding this output.',
      },
    ],
    subscriptions: [
      {
        output_id: 'tx_0',
        output_name: 'Zone 1',
        zone_id: 'zone_0',
        state: 'active',
        level: 'ok',
        estimated: true,
        route_count: 1,
        signal_present: true,
        tx_level_dbfs: -20,
        sources: ['Input 1'],
        summary: '1 routed source carrying signal.',
      },
    ],
    event_log: [
      { ts_ms: Date.now(), level: 'info', message: 'Dante connected', details: 'fixture' },
    ],
    recovery_actions: [
      { id: 'rescan', label: 'Rescan now', description: 'Capture a fresh Dante/PTP sample and append it to history.' },
      { id: 'rebind', label: 'Rebind runtime', description: 'Reload config from disk without a full restart.' },
      { id: 'restart', label: 'Restart Minos', description: 'Persist config and restart the service.' },
    ],
    ...overrides,
  };
}
```

- [ ] **Step 2: Add the failing command-center render test near the other tab smoke tests**

Add this test after `can switch core tabs and see basic landmarks`:

```ts
  test('dante tab presents health command center', async ({ page }) => {
    await page.route('**/api/v1/system/dante/diagnostics', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(danteDiagnosticsFixture()),
      });
    });
    await page.route('**/api/v1/routes/trace?**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          output_id: 'tx_0',
          output_name: 'Zone 1',
          paths: [{
            kind: 'direct',
            summary: 'Input 1 -> Zone 1',
            hops: [
              { id: 'rx_0', kind: 'input', name: 'Input 1' },
              { id: 'tx_0', kind: 'output', name: 'Zone 1' },
            ],
          }],
          warnings: [],
        }),
      });
    });

    await page.locator('.tab-btn[data-tab="dante"]').click();

    await expect(page.locator('#tab-dante .dante-health-command')).toBeVisible();
    await expect(page.locator('#tab-dante .dante-health-verdict')).toContainText('Healthy');
    await expect(page.locator('#tab-dante [data-dante-lane="clock"]')).toBeVisible();
    await expect(page.locator('#tab-dante [data-dante-lane="network"]')).toBeVisible();
    await expect(page.locator('#tab-dante [data-dante-lane="audio"]')).toBeVisible();
    await expect(page.locator('#tab-dante [data-dante-lane="activity"]')).toBeVisible();
    await expect(page.locator('#tab-dante')).toContainText('Estimated from Minos config and metering');
  });
```

- [ ] **Step 3: Run the focused test and verify it fails for missing selectors**

Run from repo root:

```bash
cd tests/ui
PATCHBOX_TEST_USERNAME=patchbox-test PATCHBOX_TEST_PASSWORD=patchbox-test npm test -- --grep "dante tab presents health command center"
```

Expected before implementation: FAIL because `.dante-health-command` does not exist.

## Task 2: Implement Health Command Center Markup

**Files:**
- Modify: `web/src/js/dante.js`

- [ ] **Step 1: Add new module state near the existing module globals**

Change the globals at the top of `web/src/js/dante.js` to include refresh state:

```js
let _pollTimer = null;
let _container = null;
let _diag = null;
let _routeTrace = null;
let _traceTxId = null;
let _traceBusy = false;
let _traceError = null;
let _pendingAction = null;
let _confirmingRestart = false;
let _lastSuccessfulRefresh = null;
let _lastRefreshError = null;
let _listenersBound = false;
```

- [ ] **Step 2: Update `_refresh()` to track stale diagnostics state**

Replace `_refresh()` with:

```js
async function _refresh() {
  if (st.state.activeTab !== 'dante') return;
  try {
    const nextTraceTxId = _getTraceTxId();
    const [diag, trace] = await Promise.all([
      api.getDanteDiagnostics(),
      nextTraceTxId ? api.getRouteTrace(nextTraceTxId).catch((error) => {
        _traceError = error?.message ?? String(error);
        return null;
      }) : Promise.resolve(null),
    ]);
    _diag = diag;
    _routeTrace = trace;
    _traceTxId = nextTraceTxId;
    _lastSuccessfulRefresh = Date.now();
    _lastRefreshError = null;
    if (trace) _traceError = null;
    _render();
  } catch (error) {
    _lastRefreshError = error?.message ?? String(error);
    _render();
  }
}
```

- [ ] **Step 3: Replace `_render()` with command-center structure**

Replace `_render()` with:

```js
function _render() {
  if (!_container) return;

  const sys = st.state.system;
  const diag = _diag;

  _container.innerHTML = `
    <div class="dante-wrap">
      <div class="dante-title-row">
        <div>
          <div class="dante-title">Dante Health</div>
          <div class="dante-subtitle">Admin troubleshooting for Dante, PTP, audio flow, and recovery.</div>
        </div>
        <div class="dante-refresh-meta">${_renderRefreshMeta()}</div>
      </div>

      ${_renderRefreshBanner()}
      ${diag ? _renderHealthCommand(sys, diag) : '<div class="dante-diag-loading">Loading diagnostics…</div>'}
      ${diag ? _renderTroubleshootingLanes(diag) : ''}
      ${diag ? _renderRecoveryPanel(diag.recovery_actions) : ''}
    </div>`;

  _bindRecoveryActions();
  _bindEventLogActions();
  _bindTraceControls();
}
```

- [ ] **Step 4: Add health command helper functions after `_render()`**

Add these helpers after `_render()`:

```js
function _renderHealthCommand(sys, diag) {
  const health = _deriveHealth(sys, diag);
  const nic = _cardItemValue(diag.device, 'NIC') ?? _cardItemValue(diag.network, 'NIC') ?? '—';
  const sampleRate = sys.sample_rate ? `${(sys.sample_rate / 1000).toFixed(1)} kHz` : '—';
  const refreshed = _lastSuccessfulRefresh ? `${_formatAge(Date.now() - _lastSuccessfulRefresh)} ago` : 'not refreshed';
  return `
    <section class="dante-health-command dante-health-${_e(health.level)}">
      <div class="dante-health-verdict-wrap">
        <div class="dante-health-label">Dante Health</div>
        <div class="dante-health-verdict">${_e(health.label)}</div>
        <div class="dante-health-reason">${_e(health.reason)}</div>
      </div>
      <div class="dante-health-facts">
        ${_renderHealthFact('Dante', diag.device?.summary ?? sys.dante_status ?? '—', diag.device?.level)}
        ${_renderHealthFact('PTP', diag.ptp?.summary ?? (st.state.ptp.locked ? 'PTP locked' : 'PTP unknown'), diag.ptp?.level)}
        ${_renderHealthFact('Rate', sampleRate)}
        ${_renderHealthFact('I/O', `${sys.rx_count ?? '—'} RX · ${sys.tx_count ?? '—'} TX`)}
        ${_renderHealthFact('NIC', nic)}
        ${_renderHealthFact('Refresh', refreshed, _lastRefreshError ? 'warn' : null)}
      </div>
    </section>`;
}

function _deriveHealth(sys, diag) {
  const levels = [diag.device?.level, diag.ptp?.level]
    .filter(Boolean)
    .map((level) => String(level).toLowerCase());
  if (_lastRefreshError && !_diag) return { level: 'error', label: 'Fault', reason: 'Diagnostics are unavailable.' };
  if (_lastRefreshError) return { level: 'warn', label: 'Degraded', reason: 'Showing stale diagnostics after a refresh failure.' };
  if (levels.includes('error')) return { level: 'error', label: 'Fault', reason: 'One or more Dante diagnostics report a fault.' };
  if (levels.includes('warn')) return { level: 'warn', label: 'Degraded', reason: 'One or more Dante diagnostics need attention.' };
  if (diag.device?.level === 'ok' && diag.ptp?.level === 'ok') return { level: 'ok', label: 'Healthy', reason: 'Dante is connected and PTP is locked.' };
  return { level: 'unknown', label: 'Unknown', reason: 'Not enough diagnostics are available yet.' };
}

function _renderHealthFact(label, value, level = null) {
  const cls = level ? ` is-${_e(level)}` : '';
  return `
    <div class="dante-health-fact${cls}">
      <span class="k">${_e(label)}</span>
      <span class="v">${_e(value ?? '—')}</span>
    </div>`;
}
```

- [ ] **Step 5: Add lane rendering helpers after the health helpers**

Add:

```js
function _renderTroubleshootingLanes(diag) {
  return `
    <div class="dante-lane-grid">
      ${_renderClockLane(diag)}
      ${_renderNetworkLane(diag)}
      ${_renderAudioLane(diag)}
      ${_renderActivityLane(diag)}
    </div>`;
}

function _renderClockLane(diag) {
  return `
    <section class="dante-lane dante-diag-${_e(diag.ptp?.level ?? 'unknown')}" data-dante-lane="clock">
      <div class="dante-lane-h">
        <div>
          <div class="dante-lane-title">Clock / PTP</div>
          <div class="dante-lane-summary">${_e(diag.ptp?.summary ?? 'PTP state unavailable.')}</div>
        </div>
        <div class="dante-lane-level">${_e(diag.ptp?.level ?? 'unknown')}</div>
      </div>
      ${_renderCardItems(diag.ptp)}
      ${_renderPtpHistoryCompact(diag.ptp_history)}
      <div class="dante-future-note">Structured statime diagnostics reserved for a later backend pass.</div>
    </section>`;
}

function _renderNetworkLane(diag) {
  return `
    <section class="dante-lane dante-diag-${_e(diag.device?.level ?? 'unknown')}" data-dante-lane="network">
      <div class="dante-lane-h">
        <div>
          <div class="dante-lane-title">Network / Device</div>
          <div class="dante-lane-summary">${_e(diag.device?.summary ?? 'Device state unavailable.')}</div>
        </div>
        <div class="dante-lane-level">context</div>
      </div>
      ${_renderCardItems(diag.device)}
      <div class="dante-estimated-note">Network data is currently configuration context, not authoritative link health.</div>
      ${_renderCardItems(diag.network)}
    </section>`;
}

function _renderAudioLane(diag) {
  return `
    <section class="dante-lane dante-diag-${_e(_audioLaneLevel(diag.subscriptions))}" data-dante-lane="audio">
      <div class="dante-lane-h">
        <div>
          <div class="dante-lane-title">Audio Flow</div>
          <div class="dante-lane-summary">Estimated from Minos config and metering.</div>
        </div>
        <div class="dante-lane-level">${_e(_audioLaneLabel(diag.subscriptions))}</div>
      </div>
      ${_renderSubscriptionsCard(diag.subscriptions)}
      ${_renderRosterSummary(diag.roster)}
      ${_renderRouteTraceCard()}
    </section>`;
}

function _renderActivityLane(diag) {
  return `
    <section class="dante-lane" data-dante-lane="activity">
      <div class="dante-lane-h">
        <div>
          <div class="dante-lane-title">Recent Activity</div>
          <div class="dante-lane-summary">Dante, PTP, and recovery transitions.</div>
        </div>
      </div>
      ${_renderEventLogCard(diag.event_log)}
      ${_renderTaskCard()}
    </section>`;
}
```

- [ ] **Step 6: Add compact card item and PTP history helpers**

Add:

```js
function _renderCardItems(card) {
  const items = Array.isArray(card?.items) ? card.items : [];
  if (items.length === 0) return '<div class="dante-diag-item">No details available.</div>';
  return `<div class="dante-diag-items">${items.map(it => `<div class="dante-diag-item"><div class="k">${_e(it.label ?? '')}</div><div class="v">${_e(it.value ?? '')}</div></div>`).join('')}</div>`;
}

function _renderPtpHistoryCompact(samples) {
  const arr = Array.isArray(samples) ? samples : [];
  const offsets = arr.map(s => (typeof s.offset_ns === 'number' ? s.offset_ns : null)).filter(v => v !== null);
  const latest = offsets.length ? offsets[offsets.length - 1] : null;
  return `
    <div class="dante-ptp-compact">
      <div class="dante-ptp-compact-meta">
        <span>${arr.length ? `${arr.length} samples` : 'No samples'}</span>
        <span>${latest === null ? 'latest —' : `latest ${latest} ns`}</span>
      </div>
      <div class="dante-ptp-spark">${_sparkline(offsets)}</div>
    </div>`;
}

function _cardItemValue(card, label) {
  const items = Array.isArray(card?.items) ? card.items : [];
  const found = items.find((item) => String(item?.label ?? '').toLowerCase() === String(label).toLowerCase());
  return found?.value ?? null;
}

function _renderRosterSummary(roster) {
  const arr = Array.isArray(roster) ? roster : [];
  const liveInputs = arr.filter((entry) => entry?.kind === 'input' && entry?.signal_present).length;
  const liveOutputs = arr.filter((entry) => entry?.kind === 'output' && entry?.signal_present).length;
  const warnings = arr.filter((entry) => entry?.level === 'warn' || entry?.level === 'error').slice(0, 3);
  return `
    <div class="dante-roster-summary-card">
      <div class="dante-estimated-note">Endpoint roster is estimated from Minos config and metering.</div>
      <div class="dante-roster-counts">
        <span>${liveInputs} live RX</span>
        <span>${liveOutputs} live TX</span>
        <span>${warnings.length} warning${warnings.length === 1 ? '' : 's'}</span>
      </div>
      ${warnings.length ? `<div class="dante-roster-warnings">${warnings.map((entry) => `<div>${_e(entry.name ?? entry.id ?? 'Endpoint')}: ${_e(entry.summary ?? 'Needs attention')}</div>`).join('')}</div>` : ''}
    </div>`;
}
```

- [ ] **Step 7: Add audio lane level helpers near existing label helpers**

Add before `_subscriptionStateLabel`:

```js
function _audioLaneLevel(subscriptions) {
  const arr = Array.isArray(subscriptions) ? subscriptions : [];
  if (arr.some((entry) => entry?.state === 'routed_silent' || entry?.state === 'muted')) return 'warn';
  if (arr.some((entry) => entry?.state === 'active')) return 'ok';
  return 'unknown';
}

function _audioLaneLabel(subscriptions) {
  const arr = Array.isArray(subscriptions) ? subscriptions : [];
  const active = arr.filter((entry) => entry?.state === 'active').length;
  return `${active}/${arr.length || 0} active`;
}
```

- [ ] **Step 8: Run the focused test and verify the missing-selector failure is resolved**

Run:

```bash
cd tests/ui
PATCHBOX_TEST_USERNAME=patchbox-test PATCHBOX_TEST_PASSWORD=patchbox-test npm test -- --grep "dante tab presents health command center"
```

Expected after this task: PASS or fail only on visual/selector issues introduced by CSS not yet present. If it fails because a helper is undefined, fix the helper name before moving on.

## Task 3: Add Stale Refresh And Route Trace Error Behavior

**Files:**
- Modify: `web/src/js/dante.js`
- Modify: `tests/ui/src/smoke.spec.ts`

- [ ] **Step 1: Add a failing stale diagnostics test**

Add this test after the command-center test:

```ts
  test('dante diagnostics show stale banner after refresh failure', async ({ page }) => {
    let diagnosticsCalls = 0;
    await page.route('**/api/v1/system/dante/diagnostics', async route => {
      diagnosticsCalls += 1;
      if (diagnosticsCalls === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(danteDiagnosticsFixture()),
        });
        return;
      }
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'diagnostics unavailable' }),
      });
    });
    await page.route('**/api/v1/routes/trace?**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ output_id: 'tx_0', output_name: 'Zone 1', paths: [], warnings: [] }),
      });
    });

    await page.locator('.tab-btn[data-tab="dante"]').click();
    await expect(page.locator('#tab-dante .dante-health-command')).toBeVisible();

    await page.evaluate(async () => {
      const dante = await import('/js/dante.js');
      await (dante as any).__testRefresh?.();
    });

    await expect(page.locator('#tab-dante .dante-stale-banner')).toBeVisible();
    await expect(page.locator('#tab-dante .dante-health-command')).toBeVisible();
  });
```

- [ ] **Step 2: Export a test-only refresh hook from `dante.js`**

Add this after `render(container)`:

```js
export async function __testRefresh() {
  await _refresh();
}
```

- [ ] **Step 3: Add refresh meta and stale banner helpers**

Add after `_renderHealthFact`:

```js
function _renderRefreshMeta() {
  if (!_lastSuccessfulRefresh) return 'Not refreshed yet';
  return `Updated ${_formatAge(Date.now() - _lastSuccessfulRefresh)} ago`;
}

function _renderRefreshBanner() {
  if (!_lastRefreshError) return '';
  const prefix = _lastSuccessfulRefresh ? 'Showing last good diagnostics.' : 'Diagnostics are unavailable.';
  return `<div class="dante-stale-banner" role="status">${_e(prefix)} Refresh failed: ${_e(_lastRefreshError)}</div>`;
}

function _formatAge(ms) {
  const seconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}
```

- [ ] **Step 4: Update `_refreshRouteTrace()` to preserve lane-local errors**

Replace `_refreshRouteTrace()` with:

```js
async function _refreshRouteTrace() {
  const txId = _getTraceTxId();
  _traceBusy = true;
  _traceError = null;
  _render();
  try {
    _routeTrace = txId ? await api.getRouteTrace(txId) : null;
    _traceTxId = txId;
  } catch (error) {
    _routeTrace = null;
    _traceError = error?.message ?? String(error);
  } finally {
    _traceBusy = false;
    if (st.state.activeTab === 'dante') _render();
  }
}
```

- [ ] **Step 5: Update `_renderRouteTraceCard()` to show route trace errors**

Inside `_renderRouteTraceCard()`, after the warnings block and before `<div class="dante-trace-list">`, insert:

```js
      ${_traceError ? `<div class="dante-trace-warning">Trace refresh failed: ${_e(_traceError)}</div>` : ''}
```

- [ ] **Step 6: Run focused stale test**

Run:

```bash
cd tests/ui
PATCHBOX_TEST_USERNAME=patchbox-test PATCHBOX_TEST_PASSWORD=patchbox-test npm test -- --grep "dante diagnostics show stale banner"
```

Expected: PASS.

- [ ] **Step 7: Add route trace lane-local failure test**

Add this test after the stale diagnostics test:

```ts
  test('dante route trace failure stays inside audio lane', async ({ page }) => {
    await page.route('**/api/v1/system/dante/diagnostics', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(danteDiagnosticsFixture()),
      });
    });
    await page.route('**/api/v1/routes/trace?**', async route => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'trace unavailable' }),
      });
    });

    await page.locator('.tab-btn[data-tab="dante"]').click();

    await expect(page.locator('#tab-dante .dante-health-command')).toBeVisible();
    await expect(page.locator('#tab-dante .dante-stale-banner')).toHaveCount(0);
    await expect(page.locator('#tab-dante [data-dante-lane="audio"]')).toContainText('Trace refresh failed');
  });
```

- [ ] **Step 8: Run focused route trace failure test**

Run:

```bash
cd tests/ui
PATCHBOX_TEST_USERNAME=patchbox-test PATCHBOX_TEST_PASSWORD=patchbox-test npm test -- --grep "dante route trace failure stays inside audio lane"
```

Expected: PASS.

## Task 4: Make Recovery Actions Role-Aware And Confirm Restart

**Files:**
- Modify: `web/src/js/dante.js`
- Modify: `tests/ui/src/smoke.spec.ts`

- [ ] **Step 1: Add failing restart confirmation test**

Add this test after the stale diagnostics test:

```ts
  test('dante restart recovery requires confirmation', async ({ page }) => {
    let recoveryPosts = 0;
    await page.route('**/api/v1/system/dante/diagnostics', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(danteDiagnosticsFixture()),
      });
    });
    await page.route('**/api/v1/routes/trace?**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ output_id: 'tx_0', output_name: 'Zone 1', paths: [], warnings: [] }),
      });
    });
    await page.route('**/api/v1/system/dante/recovery-actions/restart', async route => {
      recoveryPosts += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, action: 'restart', message: 'Restarting Minos.', restarting: true }),
      });
    });

    await page.locator('.tab-btn[data-tab="dante"]').click();
    const restart = page.locator('#tab-dante [data-dante-recovery-action="restart"]');
    await expect(restart).toBeVisible();

    await restart.click();
    await expect(page.locator('#tab-dante .dante-restart-confirm')).toBeVisible();
    expect(recoveryPosts).toBe(0);

    const restartResponse = page.waitForResponse(response =>
      response.url().includes('/api/v1/system/dante/recovery-actions/restart') && response.request().method() === 'POST'
    );
    await page.locator('#tab-dante [data-dante-confirm-restart]').click();
    await restartResponse;
    expect(recoveryPosts).toBe(1);
  });
```

- [ ] **Step 2: Replace `_renderRecoveryCard` with `_renderRecoveryPanel`**

Rename `_renderRecoveryCard(actions)` to `_renderRecoveryPanel(actions)` and replace its body with:

```js
function _renderRecoveryPanel(actions) {
  const arr = Array.isArray(actions) ? actions : [];
  const admin = _isAdmin();
  return `
    <section class="dante-recovery-panel">
      <div class="dante-recovery-h">
        <div>
          <div class="dante-lane-title">Recovery Actions</div>
          <div class="dante-lane-summary">Explicit interventions for Dante/PTP troubleshooting.</div>
        </div>
        <div class="dante-lane-level">${admin ? 'admin' : 'admin required'}</div>
      </div>
      ${admin ? '' : '<div class="dante-estimated-note">Recovery actions require an admin role.</div>'}
      <div class="dante-recovery-actions">
        ${arr.map(action => _renderRecoveryButton(action, admin)).join('')}
      </div>
      ${_confirmingRestart ? _renderRestartConfirm() : ''}
    </section>`;
}
```

- [ ] **Step 3: Add recovery helper functions after `_renderRecoveryPanel`**

Add:

```js
function _renderRecoveryButton(action, admin) {
  const id = String(action?.id || '');
  const busy = _pendingAction === id;
  return `
    <button class="dante-recovery-btn${busy ? ' is-busy' : ''}" data-dante-recovery-action="${_e(id)}" ${busy || !admin ? 'disabled' : ''}>
      <span class="label">${_e(action?.label ?? id)}</span>
      <span class="desc">${_e(action?.description ?? '')}</span>
    </button>`;
}

function _renderRestartConfirm() {
  return `
    <div class="dante-restart-confirm" role="alert">
      <div>
        <div class="dante-restart-title">Confirm Minos restart</div>
        <div class="dante-restart-copy">This persists config and restarts the service. The UI will reconnect after the process comes back.</div>
      </div>
      <div class="dante-restart-actions">
        <button class="dante-restart-cancel" data-dante-cancel-restart>Cancel</button>
        <button class="dante-restart-submit" data-dante-confirm-restart>Restart Minos</button>
      </div>
    </div>`;
}

function _isAdmin() {
  return String(st.state.userRole ?? '').toLowerCase() === 'admin';
}
```

- [ ] **Step 4: Update `_bindRecoveryActions()` for confirmation flow**

Replace `_bindRecoveryActions()` with:

```js
function _bindRecoveryActions() {
  if (!_container) return;
  _container.querySelectorAll('[data-dante-recovery-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.danteRecoveryAction;
      if (action === 'restart') {
        _confirmingRestart = true;
        _render();
        return;
      }
      _runRecoveryAction(action);
    });
  });
  _container.querySelectorAll('[data-dante-cancel-restart]').forEach((btn) => {
    btn.addEventListener('click', () => {
      _confirmingRestart = false;
      _render();
    });
  });
  _container.querySelectorAll('[data-dante-confirm-restart]').forEach((btn) => {
    btn.addEventListener('click', () => {
      _confirmingRestart = false;
      _runRecoveryAction('restart');
    });
  });
}
```

- [ ] **Step 5: Run focused restart confirmation test**

Run:

```bash
cd tests/ui
PATCHBOX_TEST_USERNAME=patchbox-test PATCHBOX_TEST_PASSWORD=patchbox-test npm test -- --grep "dante restart recovery requires confirmation"
```

Expected: PASS.

## Task 5: Apply Command Center Styling

**Files:**
- Modify: `web/src/css/dante.css`

- [ ] **Step 1: Replace top layout styles**

At the top of `dante.css`, keep `#tab-dante` and `.dante-wrap`, then add/replace title and command styles:

```css
.dante-wrap {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dante-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.dante-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
}

.dante-subtitle,
.dante-refresh-meta {
  font-size: 10px;
  color: var(--text-muted);
}

.dante-refresh-meta {
  white-space: nowrap;
}

.dante-stale-banner {
  border: 1px solid var(--dot-warn, #d8b000);
  border-radius: 8px;
  background: rgba(216, 176, 0, 0.08);
  color: var(--text-primary);
  font-size: 11px;
  padding: 8px 10px;
}

.dante-health-command {
  border: 1px solid var(--border-subtle);
  border-left-width: 4px;
  border-radius: 10px;
  background: var(--bg-panel, var(--bg));
  display: grid;
  grid-template-columns: minmax(180px, 0.8fr) minmax(260px, 1.4fr);
  gap: 14px;
  padding: 14px;
  max-width: 1120px;
}

.dante-health-ok { border-left-color: var(--dot-live); }
.dante-health-warn { border-left-color: var(--dot-warn, #d8b000); }
.dante-health-error { border-left-color: var(--dot-error); }
.dante-health-unknown { border-left-color: var(--border-subtle); }

.dante-health-label {
  color: var(--text-muted);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.dante-health-verdict {
  color: var(--text-primary);
  font-size: 28px;
  font-weight: 800;
  line-height: 1.1;
}

.dante-health-reason {
  color: var(--text-muted);
  font-size: 11px;
  margin-top: 4px;
}

.dante-health-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 8px;
}

.dante-health-fact {
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--bg-elevated, rgba(255, 255, 255, 0.03));
  display: grid;
  gap: 3px;
  padding: 8px;
}

.dante-health-fact .k {
  color: var(--text-muted);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.dante-health-fact .v {
  color: var(--text-primary);
  font-size: 11px;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 2: Add troubleshooting lane styles**

Add after command styles:

```css
.dante-lane-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(260px, 1fr));
  gap: 12px;
  max-width: 1120px;
}

.dante-lane,
.dante-recovery-panel {
  border: 1px solid var(--border-subtle);
  border-left-width: 3px;
  border-radius: 10px;
  background: var(--bg-panel, var(--bg));
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  min-width: 0;
}

.dante-lane-h,
.dante-recovery-h {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.dante-lane-title {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
}

.dante-lane-summary,
.dante-future-note,
.dante-estimated-note {
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1.45;
}

.dante-lane-level {
  color: var(--text-muted);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
}

.dante-ptp-compact {
  display: grid;
  gap: 6px;
}

.dante-ptp-compact-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--text-muted);
  font-size: 10px;
}

.dante-roster-summary-card {
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--bg-elevated, rgba(255, 255, 255, 0.03));
  display: grid;
  gap: 6px;
  padding: 8px;
}

.dante-roster-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--text-primary);
  font-size: 10px;
}

.dante-roster-warnings {
  color: var(--dot-warn, #d8b000);
  display: grid;
  gap: 4px;
  font-size: 10px;
}

.dante-recovery-panel {
  max-width: 1120px;
}

.dante-restart-confirm {
  border: 1px solid var(--dot-warn, #d8b000);
  border-radius: 8px;
  background: rgba(216, 176, 0, 0.08);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px;
}

.dante-restart-title {
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 700;
}

.dante-restart-copy {
  color: var(--text-muted);
  font-size: 10px;
  margin-top: 3px;
}

.dante-restart-actions {
  display: flex;
  gap: 8px;
  flex: 0 0 auto;
}

.dante-restart-cancel,
.dante-restart-submit {
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-elevated, rgba(255, 255, 255, 0.03));
  color: var(--text-primary);
  font: inherit;
  font-size: 10px;
  padding: 6px 9px;
  cursor: pointer;
}

.dante-restart-submit {
  border-color: var(--dot-warn, #d8b000);
}
```

- [ ] **Step 3: Add responsive styles at end of file**

Add:

```css
@media (max-width: 760px) {
  .dante-title-row,
  .dante-restart-confirm {
    flex-direction: column;
    align-items: stretch;
  }

  .dante-health-command,
  .dante-lane-grid {
    grid-template-columns: 1fr;
  }

  .dante-refresh-meta {
    white-space: normal;
  }

  .ptp-spark {
    width: 100%;
    max-width: 240px;
  }
}
```

- [ ] **Step 4: Run the command-center smoke test**

Run:

```bash
cd tests/ui
PATCHBOX_TEST_USERNAME=patchbox-test PATCHBOX_TEST_PASSWORD=patchbox-test npm test -- --grep "dante tab presents health command center"
```

Expected: PASS.

## Task 6: Update Docs And Run Verification

**Files:**
- Modify: `docs/src/config/dante.md`
- Verify: `web/src/js/dante.js`, `web/src/js/api.js`, `tests/ui/src/smoke.spec.ts`

- [ ] **Step 1: Update Dante troubleshooting docs**

In `docs/src/config/dante.md`, replace line 39:

```md
See System tab for real-time Dante status.
```

with:

```md
See the Dante tab for the admin troubleshooting view: Dante/PTP health, route tracing, recent Dante events, and recovery actions. The System tab still shows broader device status.
```

- [ ] **Step 2: Run JS syntax checks**

Run from repo root:

```bash
node --input-type=module --check < web/src/js/dante.js
node --input-type=module --check < web/src/js/api.js
```

Expected: both commands exit 0 with no syntax errors.

- [ ] **Step 3: Run focused Dante smoke tests**

Run:

```bash
cd tests/ui
PATCHBOX_TEST_USERNAME=patchbox-test PATCHBOX_TEST_PASSWORD=patchbox-test npm test -- --grep "dante (tab presents health command center|diagnostics show stale banner|route trace failure stays inside audio lane|restart recovery requires confirmation)"
```

Expected: 4 passed.

- [ ] **Step 4: Run broader UI smoke if focused tests pass**

Run:

```bash
cd tests/ui
PATCHBOX_TEST_USERNAME=patchbox-test PATCHBOX_TEST_PASSWORD=patchbox-test npm test
```

Expected: pass. If stale pre-existing tests fail because of known stale selectors like `#login-overlay` or `a.tabbar-docs-link`, record the exact failures and decide whether to fix them in this branch or keep verification focused.

- [ ] **Step 5: Run release build if UI verification is clean**

Run from repo root:

```bash
PATH="$HOME/.cargo/bin:$HOME/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin:$PATH" cargo build --release --features patchbox/inferno
```

Expected: exit 0. Existing warnings are acceptable only if they match the known baseline; new warnings from touched code are not acceptable.

- [ ] **Step 6: Review working tree**

Run:

```bash
git status --short
git diff -- web/src/js/dante.js web/src/css/dante.css tests/ui/src/smoke.spec.ts docs/src/config/dante.md
```

Expected: only intended files changed, plus the already-created spec and plan files if still untracked.

## Task 7: Implementation Review Gate

**Files:**
- Review: `web/src/js/dante.js`
- Review: `web/src/css/dante.css`
- Review: `tests/ui/src/smoke.spec.ts`

- [ ] **Step 1: Request code review after implementation**

Dispatch code review with this prompt:

```text
Review the Dante Health Command Center implementation in /home/legopc/Opencode/minos.

Focus on:
- Frontend behavior regressions in web/src/js/dante.js.
- Stale diagnostics behavior and route trace error isolation.
- Recovery action safety, especially restart confirmation.
- Role-aware recovery controls.
- Playwright smoke test reliability.
- CSS/layout risks on desktop and mobile.

Return blocking issues first with file/line references, then non-blocking suggestions.
```

- [ ] **Step 2: Address blocking review findings**

If review reports blocking issues, fix them before reporting completion. Re-run the focused Dante smoke tests and JS syntax checks after any fix.

- [ ] **Step 3: Final evidence report**

Report:

- Files changed.
- Verification commands run.
- Exact pass/fail outcomes.
- Any known residual risks or skipped verification.

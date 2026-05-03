import { expect, test, type APIRequestContext } from '@playwright/test';

const username = process.env.PATCHBOX_TEST_USERNAME;
const password = process.env.PATCHBOX_TEST_PASSWORD;

async function loginAndGetToken(request: APIRequestContext, baseURL: string): Promise<string> {
  const res = await request.post(new URL('/api/v1/login', baseURL).toString(), {
    data: { username, password },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.token).toBeTruthy();
  return body.token as string;
}

function danteDiagnosticsFixture(overrides: Record<string, unknown> = {}) {
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

test.describe('Minos UI smoke', () => {
  test.skip(!username || !password, 'Set PATCHBOX_TEST_USERNAME/PATCHBOX_TEST_PASSWORD to run UI smoke tests');

  test.beforeAll(async ({ request, baseURL }) => {
    const token = await loginAndGetToken(request, baseURL!);
    process.env.__PATCHBOX_TEST_TOKEN = token;
  });

  test.beforeEach(async ({ page }) => {
    const token = process.env.__PATCHBOX_TEST_TOKEN;
    expect(token).toBeTruthy();
    await page.addInitScript((t) => localStorage.setItem('pb_token', t), token);

    await page.goto('/');
    await expect(page.locator('#tabbar')).toBeVisible();
    await expect(page.locator('#login-overlay')).toBeHidden();
  });

  test('loads shell + tab bar + docs link', async ({ page }) => {
    await expect(page).toHaveTitle('dante-patchbox');

    // Skip link is the first focusable element.
    await page.keyboard.press('Tab');
    await expect(page.locator('#skip-link')).toBeFocused();

    const docs = page.locator('a.tabbar-docs-link');
    await expect(docs).toHaveAttribute('href', '/docs/');
    await expect(docs).toHaveAttribute('target', '_blank');

    await expect(page.locator('.tab-btn[data-tab="matrix"]')).toBeVisible();
    await expect(page.locator('.tab-btn[data-tab="mixer"]')).toBeVisible();
    await expect(page.locator('.tab-btn[data-tab="scenes"]')).toBeVisible();
    await expect(page.locator('.tab-btn[data-tab="zones"]')).toBeVisible();
    await expect(page.locator('.tab-btn[data-tab="system"]')).toBeVisible();
  });

  test('can switch core tabs and see basic landmarks', async ({ page }) => {
    await page.locator('.tab-btn[data-tab="matrix"]').click();
    await expect(page.locator('#tab-matrix .matrix-filter-bar')).toBeVisible();

    await page.locator('.tab-btn[data-tab="mixer"]').click();
    await expect(page.locator('#tab-mixer .mixer-body')).toBeVisible();

    await page.locator('.tab-btn[data-tab="scenes"]').click();
    await expect(page.locator('#tab-scenes .scenes-layout')).toBeVisible();

    await page.locator('.tab-btn[data-tab="zones"]').click();
    await expect(page.locator('#tab-zones #zones-grid')).toBeVisible();

    await page.locator('.tab-btn[data-tab="system"]').click();
    await expect(page.locator('#tab-system #meter-ballistics-group')).toBeVisible();
  });

  test('zones grid presents compact operational controls', async ({ page }) => {
    await page.locator('.tab-btn[data-tab="zones"]').click();

    const state = await page.evaluate(async () => {
      const st = await import('/js/state.js');
      const zones = await import('/js/zones.js');

      st.setZones([
        { id: 'zone_smoke_a', name: 'Smoke Lounge', colour_index: 0, tx_ids: ['tx_0', 'tx_1'] },
        { id: 'zone_smoke_b', name: 'Smoke Bar', colour_index: 1, tx_ids: ['tx_2', 'tx_3'] },
      ]);
      st.setOutput({ id: 'tx_0', name: 'Output 1', volume_db: -6, muted: false });
      st.setOutput({ id: 'tx_1', name: 'Output 2', volume_db: -6, muted: false });
      st.setOutput({ id: 'tx_2', name: 'Output 3', volume_db: -12, muted: true });
      st.setOutput({ id: 'tx_3', name: 'Output 4', volume_db: -12, muted: true });
      st.setChannel({ id: 'rx_0', name: 'Main Bar' });
      st.setChannel({ id: 'rx_1', name: 'DVS PC' });
      st.setRoute({ rx_id: 'rx_0', tx_id: 'tx_0', route_type: 'local' });
      st.setRoute({ rx_id: 'rx_1', tx_id: 'tx_1', route_type: 'local' });

      zones.render(document.getElementById('tab-zones'));

      const firstCard = document.querySelector('.zone-card');
      const firstCheckbox = firstCard?.querySelector('.zone-card-checkbox') as HTMLInputElement | null;
      firstCheckbox?.click();

      return {
        hasCommandBar: !!document.querySelector('.zones-command-bar'),
        hasOldBulkBar: !!document.querySelector('.zones-bulk-bar'),
        selectedCount: document.querySelector('.zones-selected-count')?.textContent ?? null,
        hasCompactMute: !!document.querySelector('.zone-card .zone-mute-btn'),
        hasVolume: !!document.querySelector('.zone-card .zone-vol-slider'),
        hasInputSummary: !!document.querySelector('.zone-card .zone-summary-inputs'),
        hasOutputSummary: !!document.querySelector('.zone-card .zone-summary-outputs'),
        hasDisabledInputSelect: !!document.querySelector('.zone-card .zone-source-sel'),
        cardDisplay: getComputedStyle(document.querySelector('.zone-card') as Element).display,
        handlePosition: getComputedStyle(document.querySelector('.zone-card > .reorder-handle') as Element).position,
      };
    });

    expect(state?.hasCommandBar).toBe(true);
    expect(state?.hasOldBulkBar).toBe(false);
    expect(state?.selectedCount).toContain('1 selected');
    expect(state?.hasCompactMute).toBe(true);
    expect(state?.hasVolume).toBe(true);
    expect(state?.hasInputSummary).toBe(true);
    expect(state?.hasOutputSummary).toBe(true);
    expect(state?.hasDisabledInputSelect).toBe(false);
    expect(state?.cardDisplay).toBe('grid');
    expect(state?.handlePosition).toBe('absolute');

    await page.evaluate(() => {
      (document.querySelector('.zone-card-name-btn') as HTMLButtonElement | null)?.click();
    });
    await expect(page.locator('#tab-zones .zone-panel-header')).toBeVisible();
    await expect(page.locator('#tab-zones .zone-panel-strips')).toBeVisible();
  });

  test('zones mute actions persist after refresh', async ({ page }) => {
    await page.locator('.tab-btn[data-tab="zones"]').click();

    const state = await page.evaluate(async () => {
      const api = await import('/js/api.js');
      const st = await import('/js/state.js');
      const zones = await import('/js/zones.js');

      const outputs = st.outputList().slice(0, 2);
      if (!outputs.length) return { skipped: true };

      const createdZones = [];
      const firstZone = await api.postZone({ name: 'Smoke Persist A', tx_ids: [outputs[0].id] });
      createdZones.push(firstZone);
      if (outputs[1]) createdZones.push(await api.postZone({ name: 'Smoke Persist B', tx_ids: [outputs[1].id] }));
      st.setZones(await api.getZones());
      (await api.getOutputs()).forEach((out) => st.setOutput(out));

      zones.render(document.getElementById('tab-zones'));

      const firstCard = document.querySelector(`.zone-card[data-zone-id="${firstZone.id}"]`);
      (firstCard?.querySelector('.zone-mute-btn') as HTMLButtonElement | null)?.click();

      await new Promise((resolve) => setTimeout(resolve, 500));
      zones.render(document.getElementById('tab-zones'));

      const afterSingle = (firstZone.tx_ids ?? [])
        .map((txId) => st.state.outputs.get(txId)?.muted)
        .every((muted) => muted === true);

      const selectedZones = createdZones;
      selectedZones.forEach((zone) => {
        const card = document.querySelector(`.zone-card[data-zone-id="${zone.id}"]`);
        (card?.querySelector('.zone-card-checkbox') as HTMLInputElement | null)?.click();
      });
      [...document.querySelectorAll('.zones-command-bar .zones-toolbar-btn')]
        .find((btn) => btn.textContent === 'UNMUTE')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      await new Promise((resolve) => setTimeout(resolve, 500));
      zones.render(document.getElementById('tab-zones'));

      const afterBulk = selectedZones
        .flatMap((zone) => zone.tx_ids ?? [])
        .map((txId) => st.state.outputs.get(txId)?.muted)
        .every((muted) => muted === false);

      return { skipped: false, afterSingle, afterBulk };
    });

    expect(state?.skipped).toBe(false);
    expect(state?.afterSingle).toBe(true);
    expect(state?.afterBulk).toBe(true);
  });

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
      (globalThis as any).__MINOS_UI_TEST = true;
      const dante = await import('/js/dante.js');
      await (dante as any).__testRefresh?.();
    });

    await expect(page.locator('#tab-dante .dante-stale-banner')).toBeVisible();
    await expect(page.locator('#tab-dante .dante-health-command')).toBeVisible();
  });

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

  test('matrix Ctrl+F focuses filter, Escape clears', async ({ page }) => {
    await page.locator('.tab-btn[data-tab="matrix"]').click();

    const filter = page.locator('#tab-matrix .matrix-filter-bar .filter-input').first();
    await page.keyboard.press('Control+F');
    await expect(filter).toBeFocused();

    await filter.fill('Zone');
    await expect(filter).toHaveValue('Zone');

    await page.keyboard.press('Escape');
    await expect(filter).toHaveValue('');
  });

  test('matrix disabled DSP badges stay dim after re-render', async ({ page }) => {
    await page.locator('.tab-btn[data-tab="matrix"]').click();

    const channelId = await page.evaluate(async () => {
      const st = await import('/js/state.js');
      const matrix = await import('/js/matrix.js');
      const first = st.channelList()[0];
      if (!first) return null;

      st.setChannel({
        ...first,
        dsp: {
          ...(first.dsp ?? {}),
          cmp: {
            ...(first.dsp?.cmp ?? {}),
            enabled: false,
            bypassed: false,
          },
        },
      });

      matrix.render(document.getElementById('tab-matrix'));
      return first.id;
    });

    expect(channelId).toBeTruthy();

    const badge = page.locator(
      `#tab-matrix .ch-label[data-ch-id="${channelId}"] .ch-dsp-badge[data-block="cmp"]`
    ).first();

    await expect(badge).toBeVisible();
    await expect(badge).toHaveClass(/byp/);
    await expect(badge).toHaveAttribute('title', /disabled/);
  });

  test('AM panel resets to neutral state and marks itself bypassed', async ({ page }) => {
    const state = await page.evaluate(async () => {
      const { buildContent } = await import('/js/dsp/am.js');
      const host = document.createElement('div');
      host.id = 'ui-smoke-am';
      document.body.appendChild(host);

      let last = null;
      const panel = buildContent('rx_0', {
        gain_db: 3.0,
        invert_polarity: true,
        bypassed: false,
      }, '#888', {
        onChange: (_block, params) => { last = params; },
        onBypass: () => {},
      });
      host.appendChild(panel);

      panel.querySelector('.dsp-byp-btn')?.click();

      return {
        opacity: panel.style.opacity,
        bypActive: panel.querySelector('.dsp-byp-btn')?.classList.contains('active'),
        polarityLabel: panel.querySelector('.dsp-toggle-btn')?.textContent,
        gainValue: panel.querySelector('.dsp-slider')?.value,
        last,
      };
    });

    expect(state.opacity).toBe('0.22');
    expect(state.bypActive).toBeTruthy();
    expect(state.polarityLabel).toBe('NORM');
    expect(state.gainValue).toBe('0');
    expect(state.last).toMatchObject({
      gain_db: 0,
      invert_polarity: false,
      bypassed: true,
    });
  });

  test('mixer fader updates aria-valuenow on input', async ({ page }) => {
    await page.locator('.tab-btn[data-tab="mixer"]').click();

    const fader = page.locator('#tab-mixer .strip-fader').first();
    await expect(fader).toBeVisible();

    const before = await fader.getAttribute('aria-valuenow');
    await fader.evaluate((el: HTMLInputElement) => {
      const next = Math.min(1000, Number(el.value) + 25);
      el.value = String(next);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const after = await fader.getAttribute('aria-valuenow');

    expect(after).not.toBe(before);
  });

  test('mixer inputs do not render zone route buttons', async ({ page }) => {
    await page.locator('.tab-btn[data-tab="mixer"]').click();
    await expect(page.locator('#tab-mixer .strip-zone-btn')).toHaveCount(0);
  });

  test('linked input fader mirrors paired strip slider', async ({ page }) => {
    await page.locator('.tab-btn[data-tab="mixer"]').click();

    const mirrored = await page.evaluate(async () => {
      const st = await import('/js/state.js');
      const mixer = await import('/js/mixer.js');
      const channels = st.channelList();
      if (channels.length < 2) return null;

      const [left, right] = channels;
      const leftIdx = parseInt(left.id.replace('rx_', ''), 10);
      const rightIdx = parseInt(right.id.replace('rx_', ''), 10);
      const makeAm = (ch) => ({
        ...(ch.dsp ?? {}),
        am: {
          ...(ch.dsp?.am ?? {}),
          enabled: true,
          bypassed: false,
          params: {
            ...(ch.dsp?.am?.params ?? {}),
            gain_db: 0,
          },
        },
      });

      st.setChannel({ ...left, gain_db: 0, dsp: makeAm(left) });
      st.setChannel({ ...right, gain_db: 0, dsp: makeAm(right) });
      st.setStereoLinks([{ left_channel: leftIdx, right_channel: rightIdx, linked: true, pan: 0.0 }]);
      mixer.render(document.getElementById('tab-mixer'));

      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.includes(`/inputs/${leftIdx}/gain`)) {
          return new Response(null, { status: 204 });
        }
        return originalFetch(input, init);
      };

      try {
        const targetDb = 6;
        const targetSlider = String(st.dbToSlider(targetDb));
        const leftStrip = document.getElementById(`strip-${left.id}`);
        const rightStrip = document.getElementById(`strip-${right.id}`);
        const leftFader = leftStrip?.querySelector('.strip-fader');
        const rightFader = rightStrip?.querySelector('.strip-fader');
        const rightLabel = rightStrip?.querySelector('.strip-fader-label');

        if (!leftFader || !rightFader || !rightLabel) return { error: 'missing-strip' };

        leftFader.value = targetSlider;
        leftFader.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 140));

        return {
          targetSlider,
          targetLabel: '+6.0',
          rightValue: rightFader.value,
          rightLabel: rightLabel.textContent,
          rightAria: rightFader.getAttribute('aria-valuenow'),
          rightGain: st.state.channels.get(right.id)?.gain_db,
        };
      } finally {
        window.fetch = originalFetch;
      }
    });

    expect(mirrored).toBeTruthy();
    expect(mirrored?.error).toBeUndefined();
    expect(mirrored?.rightValue).toBe(mirrored?.targetSlider);
    expect(mirrored?.rightLabel).toBe(mirrored?.targetLabel);
    expect(mirrored?.rightAria).toBe(mirrored?.targetLabel);
    expect(mirrored?.rightGain).toBe(6);
  });

  test('linked output fader mirrors paired strip slider', async ({ page }) => {
    await page.locator('.tab-btn[data-tab="mixer"]').click();

    const mirrored = await page.evaluate(async () => {
      const st = await import('/js/state.js');
      const mixer = await import('/js/mixer.js');
      const outputs = st.outputList();
      if (outputs.length < 2) return null;

      const [left, right] = outputs;
      const leftIdx = parseInt(left.id.replace('tx_', ''), 10);
      const rightIdx = parseInt(right.id.replace('tx_', ''), 10);

      st.setOutput({ ...left, volume_db: 0, muted: false });
      st.setOutput({ ...right, volume_db: 0, muted: false });
      st.setOutputStereoLinks([{ left_channel: leftIdx, right_channel: rightIdx, linked: true, pan: 0.0 }]);
      mixer.render(document.getElementById('tab-mixer'));

      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.includes(`/outputs/${leftIdx}/gain`)) {
          return new Response(null, { status: 204 });
        }
        return originalFetch(input, init);
      };

      try {
        const targetDb = 4;
        const targetSlider = String(st.dbToSlider(targetDb));
        const leftStrip = document.getElementById(`strip-${left.id}`);
        const rightStrip = document.getElementById(`strip-${right.id}`);
        const leftFader = leftStrip?.querySelector('.strip-fader');
        const rightFader = rightStrip?.querySelector('.strip-fader');
        const rightLabel = rightStrip?.querySelector('.strip-fader-label');

        if (!leftFader || !rightFader || !rightLabel) return { error: 'missing-strip' };

        leftFader.value = targetSlider;
        leftFader.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 140));

        return {
          targetSlider,
          targetLabel: '+4.0',
          rightValue: rightFader.value,
          rightLabel: rightLabel.textContent,
          rightAria: rightFader.getAttribute('aria-valuenow'),
          rightVolume: st.state.outputs.get(right.id)?.volume_db,
        };
      } finally {
        window.fetch = originalFetch;
      }
    });

    expect(mirrored).toBeTruthy();
    expect(mirrored?.error).toBeUndefined();
    expect(mirrored?.rightValue).toBe(mirrored?.targetSlider);
    expect(mirrored?.rightLabel).toBe(mirrored?.targetLabel);
    expect(mirrored?.rightAria).toBe(mirrored?.targetLabel);
    expect(mirrored?.rightVolume).toBe(4);
  });

  test('stereo links render as pair controls instead of strip buttons', async ({ page }) => {
    await page.locator('.tab-btn[data-tab="mixer"]').click();

    const layout = await page.evaluate(async () => {
      const st = await import('/js/state.js');
      const mixer = await import('/js/mixer.js');
      const channels = st.channelList();
      const outputs = st.outputList();
      if (channels.length < 2 || outputs.length < 2) return null;

      const [leftIn, rightIn] = channels;
      const [leftOut, rightOut] = outputs;
      const leftInIdx = parseInt(leftIn.id.replace('rx_', ''), 10);
      const rightInIdx = parseInt(rightIn.id.replace('rx_', ''), 10);
      const leftOutIdx = parseInt(leftOut.id.replace('tx_', ''), 10);
      const rightOutIdx = parseInt(rightOut.id.replace('tx_', ''), 10);

      st.setStereoLinks([{ left_channel: leftInIdx, right_channel: rightInIdx, linked: true, pan: 0.0 }]);
      st.setOutputStereoLinks([{ left_channel: leftOutIdx, right_channel: rightOutIdx, linked: true, pan: 0.0 }]);
      mixer.render(document.getElementById('tab-mixer'));

      const inputPair = document.querySelector('.mixer-strips .mixer-strip-pair .stereo-pair-btn');
      const outputPair = document.querySelector('.mixer-zone-masters .mixer-strip-pair .stereo-pair-btn');
      const inputStrip = document.getElementById(`strip-${leftIn.id}`);
      const outputStrip = document.getElementById(`strip-${leftOut.id}`);

      return {
        inputPairLabel: inputPair?.textContent ?? null,
        outputPairLabel: outputPair?.textContent ?? null,
        inputButtonInsideStrip: !!document.querySelector(`#strip-${leftIn.id} .stereo-pair-btn`),
        outputButtonInsideStrip: !!document.querySelector(`#strip-${leftOut.id} .stereo-pair-btn`),
        inputMaxWidth: inputStrip ? getComputedStyle(inputStrip).maxWidth : null,
        outputMaxWidth: outputStrip ? getComputedStyle(outputStrip).maxWidth : null,
      };
    });

    expect(layout).toBeTruthy();
    expect(layout?.inputPairLabel).toBeTruthy();
    expect(layout?.outputPairLabel).toBeTruthy();
    expect(layout?.inputButtonInsideStrip).toBeFalsy();
    expect(layout?.outputButtonInsideStrip).toBeFalsy();
    expect(layout?.inputMaxWidth).toBe(layout?.outputMaxWidth);
  });

  test('stereo pair toggle does not activate matrix tab', async ({ page }) => {
    await page.locator('.tab-btn[data-tab="mixer"]').click();

    const stayedHidden = await page.evaluate(async () => {
      const st = await import('/js/state.js');
      const mixer = await import('/js/mixer.js');
      const channels = st.channelList();
      if (channels.length < 2) return null;

      const [left, right] = channels;
      const leftIdx = parseInt(left.id.replace('rx_', ''), 10);
      const rightIdx = parseInt(right.id.replace('rx_', ''), 10);
      st.setStereoLinks([]);
      mixer.render(document.getElementById('tab-mixer'));

      const matrixTab = document.getElementById('tab-matrix');
      const pairBtn = document.querySelector('.mixer-strip-pair .stereo-pair-btn');
      if (!matrixTab || !pairBtn) return { error: 'missing-elements' };

      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.includes('/stereo-links') && (init?.method === 'POST' || init?.method === 'PUT')) {
          return new Response(JSON.stringify({
            left_channel: leftIdx,
            right_channel: rightIdx,
            linked: true,
            pan: 0.0,
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return originalFetch(input, init);
      };

      try {
        pairBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 50));
        return {
          matrixActive: matrixTab.classList.contains('active'),
          mixerActive: document.getElementById('tab-mixer')?.classList.contains('active') ?? false,
        };
      } finally {
        window.fetch = originalFetch;
      }
    });

    expect(stayedHidden).toBeTruthy();
    expect(stayedHidden?.error).toBeUndefined();
    expect(stayedHidden?.matrixActive).toBeFalsy();
    expect(stayedHidden?.mixerActive).toBeTruthy();
  });

  test('utility strips expose delete action and mixer visibility toggles', async ({ page }) => {
    await page.locator('.tab-btn[data-tab="mixer"]').click();

    const menuState = await page.evaluate(async () => {
      const st = await import('/js/state.js');
      const mixer = await import('/js/mixer.js');
      localStorage.removeItem('minos:mixer:visibility:v1');
      st.setVcaGroups([{
        id: 'vca_smoke',
        name: 'Smoke VCA',
        group_type: 'input',
        members: [],
        gain_db: 0,
        muted: false,
      }]);
      st.setAutomixerGroups([{
        id: 'am_smoke',
        name: 'Smoke AXM',
        enabled: true,
        gating_enabled: false,
        gate_threshold_db: -40,
        off_attenuation_db: -60,
        hold_ms: 300,
      }]);
      st.setGenerators([{
        id: 'gen_smoke',
        name: 'Smoke generator',
        gen_type: 'sine',
        freq_hz: 1000,
        level_db: -20,
        enabled: false,
      }]);
      st.setBus({
        id: 'bus_smoke',
        name: 'Smoke bus',
        routing: [],
        routing_gain: [],
        dsp: {
          am: {
            enabled: true,
            bypassed: true,
            params: { gain_db: 0, invert_polarity: false },
          },
        },
        muted: false,
      });
      mixer.render(document.getElementById('tab-mixer'));

      const destructiveLabelFor = (selector) => {
        const menuBtn = document.querySelector(selector);
        menuBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const label = document.querySelector('.strip-action-menu-item.destructive')?.textContent ?? null;
        document.querySelector('.strip-action-menu')?.remove();
        return label;
      };

      return {
        hasSceneBar: !!document.getElementById('mixer-scene-bar'),
        hasToolbar: !!document.getElementById('mixer-visibility-toolbar'),
        busToggleChecked: (document.getElementById('mixer-toggle-busses') as HTMLInputElement | null)?.checked ?? null,
        groupsToggleChecked: (document.getElementById('mixer-toggle-groups') as HTMLInputElement | null)?.checked ?? null,
        busLabel: destructiveLabelFor('#strip-bus_smoke .strip-menu-btn'),
        vcaLabel: destructiveLabelFor('#vca-strip-vca_smoke .strip-menu-btn'),
        amLabel: destructiveLabelFor('#am-strip-am_smoke .strip-menu-btn'),
        genLabel: destructiveLabelFor('#gen-strip-gen_smoke .strip-menu-btn'),
      };
    });

    expect(menuState?.hasSceneBar).toBe(false);
    expect(menuState?.hasToolbar).toBe(true);
    expect(menuState?.busToggleChecked).toBe(true);
    expect(menuState?.groupsToggleChecked).toBe(true);
    expect(menuState?.busLabel).toBe('Delete bus');
    expect(menuState?.vcaLabel).toBe('Delete VCA group');
    expect(menuState?.amLabel).toBe('Delete automixer group');
    expect(menuState?.genLabel).toBe('Delete generator');

    const hiddenState = await page.evaluate(() => {
      const busToggle = document.getElementById('mixer-toggle-busses') as HTMLInputElement | null;
      const groupsToggle = document.getElementById('mixer-toggle-groups') as HTMLInputElement | null;
      busToggle?.click();
      groupsToggle?.click();
      return {
        busVisible: !!document.getElementById('strip-bus_smoke'),
        vcaVisible: !!document.getElementById('vca-strip-vca_smoke'),
        amVisible: !!document.getElementById('am-strip-am_smoke'),
        genVisible: !!document.getElementById('gen-strip-gen_smoke'),
        busPref: (document.getElementById('mixer-toggle-busses') as HTMLInputElement | null)?.checked ?? null,
        groupsPref: (document.getElementById('mixer-toggle-groups') as HTMLInputElement | null)?.checked ?? null,
      };
    });

    expect(hiddenState?.busVisible).toBe(false);
    expect(hiddenState?.vcaVisible).toBe(false);
    expect(hiddenState?.amVisible).toBe(false);
    expect(hiddenState?.genVisible).toBe(false);
    expect(hiddenState?.busPref).toBe(false);
    expect(hiddenState?.groupsPref).toBe(false);

    const restoredState = await page.evaluate(() => {
      document.getElementById('mixer-toggle-busses')?.click();
      document.getElementById('mixer-toggle-groups')?.click();
      return {
        busVisible: !!document.getElementById('strip-bus_smoke'),
        vcaVisible: !!document.getElementById('vca-strip-vca_smoke'),
        amVisible: !!document.getElementById('am-strip-am_smoke'),
        genVisible: !!document.getElementById('gen-strip-gen_smoke'),
        storedPrefs: localStorage.getItem('minos:mixer:visibility:v1'),
      };
    });

    expect(restoredState?.busVisible).toBe(true);
    expect(restoredState?.vcaVisible).toBe(true);
    expect(restoredState?.amVisible).toBe(true);
    expect(restoredState?.genVisible).toBe(true);
    expect(restoredState?.storedPrefs).toBe('{"busses":true,"groups":true}');
  });

  test('undo/redo shortcuts toggle undo stack + toolbar state', async ({ page }) => {
    await expect(page.locator('#tb-undo')).toBeDisabled();
    await expect(page.locator('#tb-redo')).toBeDisabled();

    await page.evaluate(async () => {
      const { undo } = await import('/js/undo.js');
      (window as any).__uiSmokeUndoState = 1;
      undo.push({
        label: 'UI smoke change',
        apply: async () => {
          (window as any).__uiSmokeUndoState = 1;
        },
        revert: async () => {
          (window as any).__uiSmokeUndoState = 0;
        },
      });
    });

    await expect(page.locator('#tb-undo')).toBeEnabled();
    await expect(page.locator('#tb-redo')).toBeDisabled();

    await page.keyboard.press('Control+Z');
    await expect(page.locator('#tb-undo')).toBeDisabled();
    await expect(page.locator('#tb-redo')).toBeEnabled();

    const stateAfterUndo = await page.evaluate(() => (window as any).__uiSmokeUndoState);
    expect(stateAfterUndo).toBe(0);

    await page.keyboard.press('Control+Y');
    await expect(page.locator('#tb-undo')).toBeEnabled();
    await expect(page.locator('#tb-redo')).toBeDisabled();

    const stateAfterRedo = await page.evaluate(() => (window as any).__uiSmokeUndoState);
    expect(stateAfterRedo).toBe(1);
  });
});

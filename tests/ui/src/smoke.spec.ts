import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const username = process.env.PATCHBOX_TEST_USERNAME;
const password = process.env.PATCHBOX_TEST_PASSWORD;

// Minimal API fixtures — enough for every page to render its structural DOM.
const MOCK_CONFIG = {
  sources: [
    { id: 'rx_0', name: 'IN 1' },
    { id: 'rx_1', name: 'IN 2' },
  ],
  zones: [
    { id: 'tx_0', name: 'Zone 1', gain_db: -10, muted: false },
  ],
  // matrix[tx][rx] — 1 zone × 2 sources, both unrouted
  matrix: [[0, 0]],
};

const MOCK_HEALTH = {
  dante: { connected: true, device: 'dante-test', nic: 'eth0', rx_channels: 2, tx_channels: 1 },
  ptp: { synced: true, offset_ns: 100, socket: '/run/ptp.sock' },
  uptime_secs: 3661,
  audio: { rx_channels: 2, tx_channels: 1, active_routes: 0 },
};

async function mockApis(page: Page): Promise<void> {
  await page.route('**/api/v1/config',       route => route.fulfill({ json: MOCK_CONFIG }));
  await page.route('**/api/v1/health',       route => route.fulfill({ json: MOCK_HEALTH }));
  await page.route('**/api/v1/scenes',       route => route.fulfill({ json: { scenes: [] } }));
  await page.route('**/api/v1/system/logs',  route => route.fulfill({ json: [] }));
  await page.route('**/api/v1/system/reload',route => route.fulfill({ status: 204, body: '' }));
  // DSP endpoints used by ChannelStrip.load() — return empty so strips render without error
  await page.route('**/api/v1/inputs/**',    route => route.fulfill({ json: {} }));
  await page.route('**/api/v1/outputs/**',   route => route.fulfill({ json: [] }));
}

async function loginAndGetToken(request: APIRequestContext, baseURL: string): Promise<string> {
  const res = await request.post(new URL('/api/v1/login', baseURL).toString(), {
    data: { username, password },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.token).toBeTruthy();
  return body.token as string;
}

test.describe('Minos V3 UI smoke', () => {
  test.skip(!username || !password, 'Set PATCHBOX_TEST_USERNAME/PATCHBOX_TEST_PASSWORD to run UI smoke tests');

  test.beforeAll(async ({ request, baseURL }) => {
    const token = await loginAndGetToken(request, baseURL!);
    process.env.__PATCHBOX_TEST_TOKEN = token;
  });

  test.beforeEach(async ({ page }) => {
    const token = process.env.__PATCHBOX_TEST_TOKEN;
    expect(token).toBeTruthy();
    // V3 uses sessionStorage (not localStorage)
    await page.addInitScript((t) => sessionStorage.setItem('pb_token', t), token);
    await mockApis(page);
    await page.goto('/');
    await expect(page.locator('#sidebar')).toBeVisible();
    await expect(page.locator('#login-overlay')).toBeHidden();
  });

  // ── Shell ──────────────────────────────────────────────────────────────────

  test('shell: title, sidebar, skip link, all 9 nav items present', async ({ page }) => {
    await expect(page).toHaveTitle('Minos — Dante Patchbox');

    // Skip link must be the first focusable element
    await page.keyboard.press('Tab');
    await expect(page.locator('#skip-link')).toBeFocused();

    const routes = ['dashboard', 'matrix', 'inputs', 'outputs', 'buses', 'zones', 'scenes', 'dante', 'system'];
    for (const route of routes) {
      await expect(page.locator(`.nav-item[data-route="${route}"]`)).toBeVisible();
    }

    // WS status indicators present in sidebar footer
    await expect(page.locator('#ws-dot')).toBeAttached();
    await expect(page.locator('#ws-label')).toBeAttached();
  });

  // ── Page navigation landmarks ──────────────────────────────────────────────

  test('navigate to matrix: .matrix-toolbar and #matrix-table visible', async ({ page }) => {
    await page.locator('.nav-item[data-route="matrix"]').click();
    await expect(page.locator('.matrix-toolbar')).toBeVisible();
    await expect(page.locator('#matrix-table')).toBeVisible();
  });

  test('navigate to inputs: .strips-page and #inputs-row visible', async ({ page }) => {
    await page.locator('.nav-item[data-route="inputs"]').click();
    await expect(page.locator('.strips-page')).toBeVisible();
    await expect(page.locator('#inputs-row')).toBeVisible();
  });

  test('navigate to outputs: .strips-page with .strips-scroll visible', async ({ page }) => {
    await page.locator('.nav-item[data-route="outputs"]').click();
    await expect(page.locator('.strips-page')).toBeVisible();
    await expect(page.locator('.strips-scroll')).toBeVisible();
  });

  test('navigate to scenes: .scenes-page and #scenes-grid visible', async ({ page }) => {
    await page.locator('.nav-item[data-route="scenes"]').click();
    await expect(page.locator('.scenes-page')).toBeVisible();
    await expect(page.locator('#scenes-grid')).toBeVisible();
  });

  test('navigate to zones: .zones-page and .zones-grid visible', async ({ page }) => {
    await page.locator('.nav-item[data-route="zones"]').click();
    await expect(page.locator('.zones-page')).toBeVisible();
    await expect(page.locator('.zones-grid')).toBeVisible();
  });

  test('navigate to system: .system-page, #sp-reload-btn, #sp-log-body visible', async ({ page }) => {
    await page.locator('.nav-item[data-route="system"]').click();
    await expect(page.locator('.system-page')).toBeVisible();
    await expect(page.locator('#sp-reload-btn')).toBeVisible();
    await expect(page.locator('#sp-log-body')).toBeVisible();
  });

  // ── Matrix ─────────────────────────────────────────────────────────────────

  test('matrix: cells rendered with data-tx and data-rx attributes', async ({ page }) => {
    await page.locator('.nav-item[data-route="matrix"]').click();
    await expect(page.locator('#matrix-table')).toBeVisible();

    const cell = page.locator('.matrix-cell[data-tx][data-rx]').first();
    await expect(cell).toBeVisible();
  });

  test('matrix: clicking unrouted cell toggles .routed class (optimistic UI)', async ({ page }) => {
    await page.route('**/api/v1/matrix', route =>
      route.request().method() === 'PUT'
        ? route.fulfill({ status: 204, body: '' })
        : route.continue()
    );

    await page.locator('.nav-item[data-route="matrix"]').click();
    await expect(page.locator('#matrix-table')).toBeVisible();

    const cell = page.locator('.matrix-cell:not(.routed)').first();
    await expect(cell).toBeVisible();
    await cell.click();
    await expect(cell).toHaveClass(/routed/);
  });

  // ── Scenes ─────────────────────────────────────────────────────────────────

  test('scenes: + NEW SCENE button shows create form with #form-name input', async ({ page }) => {
    await page.locator('.nav-item[data-route="scenes"]').click();
    await expect(page.locator('.scenes-page')).toBeVisible();

    const newBtn = page.locator('#new-scene-btn');
    await expect(newBtn).toBeVisible();
    await expect(newBtn).toContainText('NEW SCENE');

    await newBtn.click();
    await expect(page.locator('#form-name')).toBeVisible();
  });

  // ── Zones ──────────────────────────────────────────────────────────────────

  test('zones: .zone-card elements rendered for configured zones', async ({ page }) => {
    await page.locator('.nav-item[data-route="zones"]').click();
    await expect(page.locator('.zones-page')).toBeVisible();
    await expect(page.locator('.zones-grid')).toBeVisible();
    // MOCK_CONFIG provides 1 zone
    await expect(page.locator('.zone-card')).toHaveCount(1);
  });

  // ── System ─────────────────────────────────────────────────────────────────

  test('system: dante + ptp status dots and log body present', async ({ page }) => {
    await page.locator('.nav-item[data-route="system"]').click();
    await expect(page.locator('.system-page')).toBeVisible();
    await expect(page.locator('#sp-dante-dot')).toBeVisible();
    await expect(page.locator('#sp-ptp-dot')).toBeVisible();
    await expect(page.locator('#sp-log-body')).toBeVisible();
    await expect(page.locator('#sp-reload-btn')).toBeVisible();
  });

  // ── Hash routing ───────────────────────────────────────────────────────────

  test('hash navigation: loading /#/matrix directly renders matrix page', async ({ page }) => {
    // addInitScript from beforeEach re-fires on this second navigation,
    // so sessionStorage token is set before the router boots.
    await page.goto('/#/matrix');
    await expect(page.locator('.matrix-toolbar')).toBeVisible();
    await expect(page.locator('#matrix-table')).toBeVisible();
  });

  // ── Shell interactions ─────────────────────────────────────────────────────

  test('sidebar toggle: clicking #btn-sidebar-toggle adds .sidebar-collapsed to body', async ({ page }) => {
    await expect(page.locator('body')).not.toHaveClass(/sidebar-collapsed/);
    await page.locator('#btn-sidebar-toggle').click();
    await expect(page.locator('body')).toHaveClass(/sidebar-collapsed/);
  });

  test('logout: clicking #btn-logout shows #login-overlay', async ({ page }) => {
    await expect(page.locator('#login-overlay')).toBeHidden();
    await page.locator('#btn-logout').click();
    await expect(page.locator('#login-overlay')).toBeVisible();
  });
});

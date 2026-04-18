import { expect, test } from '@playwright/test';

const username = process.env.PATCHBOX_TEST_USERNAME;
const password = process.env.PATCHBOX_TEST_PASSWORD;

async function loginAndGetToken(request: any, baseURL: string): Promise<string> {
  const res = await request.post(new URL('/api/v1/login', baseURL).toString(), {
    data: { username, password },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.token).toBeTruthy();
  return body.token as string;
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

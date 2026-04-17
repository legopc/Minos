import { defineConfig } from '@playwright/test';

const port = Number(process.env.PATCHBOX_PORT ?? '9191');
const baseURL = process.env.PATCHBOX_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './src',
  globalSetup: './src/global-setup',
  globalTeardown: './src/global-teardown',

  timeout: 30_000,
  expect: { timeout: 7_500 },

  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,

  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});

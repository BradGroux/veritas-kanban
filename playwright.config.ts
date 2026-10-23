import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'path';
import { readBrowserEnvironment } from './scripts/browser-test-environment.mjs';

const { root: e2eDataDir, apiPort, webPort } = readBrowserEnvironment(import.meta.dirname);
const adminKey = process.env.VERITAS_ADMIN_KEY!;

/**
 * Playwright E2E test configuration for Veritas Kanban.
 *
 * Run with pnpm test:e2e. The runner owns disposable storage and credentials.
 * Existing servers are never reused; select unused ports with PLAYWRIGHT_API_PORT
 * and PLAYWRIGHT_WEB_PORT.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Run sequentially — tests may share board state
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter:
    process.env.CI && process.env.PLAYWRIGHT_HTML_REPORT === '1'
      ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
      : process.env.CI
        ? 'github'
        : 'html',
  timeout: 30_000,

  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Synthetic credential generated for this disposable test run.
    extraHTTPHeaders: {
      'X-API-Key': adminKey,
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /(mobile-responsive|pwa-offline)\.spec\.ts/,
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
      testMatch: /(mobile-responsive|pwa-offline)\.spec\.ts/,
    },
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 13'], browserName: 'webkit' },
      testMatch: /(mobile-responsive|pwa-offline)\.spec\.ts/,
    },
  ],

  /* Playwright owns the processes it starts and their teardown. */
  webServer: [
    {
      command: 'node scripts/start-browser-api.mjs',
      port: apiPort,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        VERITAS_ADMIN_KEY: adminKey,
        DATA_DIR: e2eDataDir,
        VERITAS_DATA_DIR: e2eDataDir,
        VERITAS_SQLITE_PATH: resolve(e2eDataDir, '.veritas-kanban/veritas.db'),
        VERITAS_STORAGE: 'file',
        HOST: '127.0.0.1',
        NODE_ENV: 'development',
        VERITAS_DISABLE_WATCHERS: '1',
        VERITAS_AUTH_LOCALHOST_BYPASS: 'true',
        VERITAS_AUTH_LOCALHOST_ROLE: 'admin',
        RATE_LIMIT_MAX: '10000',
        RATE_LIMIT_WRITE_MAX: '10000',
        PORT: String(apiPort),
      },
    },
    {
      command: `cd web && node_modules/.bin/vite --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        VITE_API_URL: `http://127.0.0.1:${apiPort}/api`,
        VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
        VITE_WS_PROXY_TARGET: `ws://127.0.0.1:${apiPort}`,
      },
    },
  ],
});

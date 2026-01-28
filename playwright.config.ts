import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E test configuration for Veritas Kanban.
 *
 * Expects the dev server to be running:
 *   - Vite dev server on http://localhost:3000 (serves frontend, proxies API)
 *   - Express API server on http://localhost:3001
 *
 * Start with: pnpm dev
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Run sequentially — tests may share board state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'html',
  timeout: 30_000,

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Auth bypass — tests run against the dev server with localhost bypass enabled
    extraHTTPHeaders: {
      'X-API-Key': 'dev-admin-key',
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Run dev servers before starting tests (if not already running) */
  // Uncomment to auto-start dev servers:
  // webServer: [
  //   {
  //     command: 'pnpm --filter server dev',
  //     port: 3001,
  //     reuseExistingServer: true,
  //     timeout: 15_000,
  //   },
  //   {
  //     command: 'pnpm --filter web dev',
  //     port: 3000,
  //     reuseExistingServer: true,
  //     timeout: 15_000,
  //   },
  // ],
});

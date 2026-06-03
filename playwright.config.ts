import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load VERITAS_ADMIN_KEY from server/.env so E2E tests use the same key as the server
if (!process.env.VERITAS_ADMIN_KEY) {
  try {
    const envContent = readFileSync(resolve(__dirname, 'server', '.env'), 'utf-8');
    const match = envContent.match(/^VERITAS_ADMIN_KEY=(.+)$/m);
    if (match) {
      process.env.VERITAS_ADMIN_KEY = match[1].trim();
    }
  } catch {
    // server/.env not found — fall through to default
  }
}

/**
 * Playwright E2E test configuration for Veritas Kanban.
 *
 * Expects the dev server to be running:
 *   - Vite dev server on http://127.0.0.1:3000 (serves frontend, proxies API)
 *   - Express API server on http://127.0.0.1:3001
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
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Auth — read admin key from server/.env (loaded via dotenv above)
    extraHTTPHeaders: {
      'X-API-Key': process.env.VERITAS_ADMIN_KEY || 'dev-admin-key',
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /mobile-responsive\.spec\.ts/,
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
      testMatch: /mobile-responsive\.spec\.ts/,
    },
  ],

  /* Run dev servers before starting tests (if not already running) */
  webServer: [
    {
      command: 'cd server && node_modules/.bin/tsx src/index.ts',
      port: 3001,
      reuseExistingServer: true,
      timeout: 30_000,
      env: {
        VERITAS_ADMIN_KEY: process.env.VERITAS_ADMIN_KEY || 'dev-admin-key',
        VERITAS_DISABLE_WATCHERS: '1',
        VERITAS_AUTH_LOCALHOST_BYPASS: 'true',
        VERITAS_AUTH_LOCALHOST_ROLE: 'admin',
      },
    },
    {
      command: 'cd web && node_modules/.bin/vite --host 127.0.0.1',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: true,
      timeout: 30_000,
      env: {
        VITE_API_URL: 'http://127.0.0.1:3001/api',
        VITE_API_PROXY_TARGET: 'http://127.0.0.1:3001',
        VITE_WS_PROXY_TARGET: 'ws://127.0.0.1:3001',
      },
    },
  ],
});

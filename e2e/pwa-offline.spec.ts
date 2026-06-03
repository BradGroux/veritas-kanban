import { test, expect, type Page } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

async function useMobileDeviceContext(page: Page) {
  await page.route('**/api/auth/context', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        role: 'read-only',
        isLocalhost: false,
        actorType: 'device',
        authMethod: 'device-session',
        deviceSessionId: 'e2e-pwa-session',
        deviceId: 'e2e-pwa-phone',
        clientId: 'e2e-pwa-browser',
        clientMode: 'mobile-pwa',
        capabilities: [
          'board:read',
          'workspace:read',
          'task:read',
          'comment:write',
          'workflow:read',
          'notification:read',
          'notification:receive',
        ],
        permissions: [
          'workspace:read',
          'task:read',
          'comment:write',
          'workflow:read',
          'work_product:read',
          'agent:read',
          'settings:read',
        ],
      }),
    })
  );
}

test.describe('mobile PWA offline behavior', () => {
  test.beforeEach(async ({ page }) => {
    await bypassAuth(page);
    await useMobileDeviceContext(page);
  });

  test.afterEach(async ({ page, context }) => {
    await context.setOffline(false);
    await cleanupRoutes(page);
  });

  test('serves install metadata and a static-only service worker', async ({ page }) => {
    await page.goto('/');

    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestHref).toBeTruthy();

    const manifestResponse = await page.request.get(new URL(manifestHref!, page.url()).toString());
    expect(manifestResponse.ok()).toBe(true);
    const manifest = (await manifestResponse.json()) as {
      display: string;
      start_url: string;
      scope: string;
      icons: Array<{ src: string; purpose?: string }>;
    };
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('.');
    expect(manifest.scope).toBe('.');
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);

    const serviceWorkerResponse = await page.request.get(new URL('/sw.js', page.url()).toString());
    expect(serviceWorkerResponse.ok()).toBe(true);
    const serviceWorker = await serviceWorkerResponse.text();
    expect(serviceWorker).toContain("request.method !== 'GET'");
    expect(serviceWorker).toContain("scopedPath.startsWith('api/')");
    expect(serviceWorker).toContain("scopedPath.startsWith('ws/')");
  });

  test('shows a remote-safe offline warning in the mobile shell', async ({ page, context }) => {
    await page.goto('/');

    await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
    await page.waitForLoadState('networkidle');

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));

    await expect(page.getByRole('status', { name: 'Offline' })).toBeVisible();
    await expect(page.getByText(/Cached shell only/)).toBeVisible();
    await expect(page.getByText(/Task data and changes require the trusted server/)).toBeVisible();
  });
});

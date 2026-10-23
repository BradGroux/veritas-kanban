import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

test('shared run route preserves loading and unavailable states', async ({ page }) => {
  await bypassAuth(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let release: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/run-sessions/share_bundle_probe', async (route) => {
    await pending;
    await route.fulfill({ status: 404, json: { error: 'Share unavailable' } });
  });
  try {
    await page.goto('/runs/shared/share_bundle_probe');
    await expect(page.getByText('Loading shared run session...', { exact: true })).toBeVisible();
    release();
    await expect(
      page.getByText(
        'Shared run session is unavailable, revoked, expired, or outside your workspace.',
        { exact: true }
      )
    ).toBeVisible({ timeout: 15_000 });
    expect(errors).toEqual([]);
  } finally {
    release();
    await cleanupRoutes(page);
  }
});

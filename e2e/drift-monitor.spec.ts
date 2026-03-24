import { test, expect } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

test.describe('Drift monitor', () => {
  test.beforeEach(async ({ page }) => {
    await bypassAuth(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('renders alerts and baselines sections', async ({ page }) => {
    await page.goto('/drift', { timeout: 15_000 });

    await expect(page.getByRole('heading', { name: 'Behavioral Drift Monitor' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByPlaceholder('Agent ID')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Analyze Agent' })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible();
    await expect(
      page.locator('text=/No drift alerts for the current filter\.|Severity|Acknowledge/i').first()
    ).toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole('heading', { name: 'Baselines' })).toBeVisible();
    await expect(
      page
        .locator(
          'text=/No drift baselines have been computed yet\.|Reset Agent Baselines|Samples/i'
        )
        .first()
    ).toBeVisible({ timeout: 15_000 });
  });
});

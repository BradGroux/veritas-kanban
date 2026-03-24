import { test, expect } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

test.describe('Feedback panel', () => {
  test.beforeEach(async ({ page }) => {
    await bypassAuth(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('renders feedback browse state and filters', async ({ page }) => {
    await page.goto('/', { timeout: 15_000 });

    await expect(page.getByRole('heading', { name: 'User Feedback' })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('tab', { name: 'Browse' }).click();

    await expect(page.getByPlaceholder('Filter by agent')).toBeVisible({ timeout: 15_000 });
    await expect(
      page
        .locator('button[role="combobox"]')
        .filter({ hasText: /Sentiment|All sentiments/i })
        .first()
    ).toBeVisible();
    await expect(
      page
        .locator('button[role="combobox"]')
        .filter({ hasText: /Category|All categories/i })
        .first()
    ).toBeVisible();
    await expect(
      page
        .locator('button[role="combobox"]')
        .filter({ hasText: /Status|All statuses|Unresolved|Resolved/i })
        .first()
    ).toBeVisible();

    await expect(
      page.locator('text=/No feedback found\.|Loading…|Resolved|Unresolved/i').first()
    ).toBeVisible({ timeout: 15_000 });
  });
});

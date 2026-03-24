import { test, expect } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

test.describe('Governance dashboard widgets', () => {
  test.beforeEach(async ({ page }) => {
    await bypassAuth(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('renders dashboard widgets on the board view', async ({ page }) => {
    await page.goto('/', { timeout: 15_000 });

    await expect(page.getByText('Loading dashboard…'))
      .not.toBeVisible({ timeout: 15_000 })
      .catch(() => {});

    await expect(
      page.getByRole('heading', { name: /dashboard|governance dashboard/i }).first()
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.locator('text=/Filter|Filters|Time Range|Agent|Status/i').first()
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page
        .locator('text=/Success Rate|Token Usage|Average Run Duration|Monthly Budget|Health/i')
        .first()
    ).toBeVisible({ timeout: 15_000 });
  });
});

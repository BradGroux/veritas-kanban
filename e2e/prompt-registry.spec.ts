import { test, expect } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

test.describe('Prompt registry', () => {
  test.beforeEach(async ({ page }) => {
    await bypassAuth(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('renders templates view and create controls', async ({ page }) => {
    await page.goto('/templates', { timeout: 15_000 });

    await expect(page.getByRole('button', { name: 'Templates' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Prompt Templates')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /new template/i })).toBeVisible();

    await expect(
      page.locator('text=/No description|Variables:|Loading templates|Prompt Templates/i').first()
    ).toBeVisible({ timeout: 15_000 });
  });
});

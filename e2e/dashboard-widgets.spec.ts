import { test, expect } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

test.describe('Board sidebar widgets', () => {
  test.beforeEach(async ({ page }) => {
    await bypassAuth(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('renders operational widgets on the board view', async ({ page }) => {
    await page.goto('/', { timeout: 15_000 });

    await expect(page.getByRole('region', { name: 'To Do' })).toBeVisible({
      timeout: 15_000,
    });

    await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Agent Registry' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Recent Status Changes' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Audit Trail' })).toBeVisible();
    await expect(page.getByText('Monthly Budget')).toBeVisible();
  });
});

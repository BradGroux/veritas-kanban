import { test, expect } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

test.describe('Health Check', () => {
  test.beforeEach(async ({ page }) => {
    await bypassAuth(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('app loads and shows the header', async ({ page }) => {
    await page.goto('/');
    // Wait for the header to appear — proves React rendered
    await expect(page.locator('header')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh page' })).toBeVisible();
    await expect(page.getByRole('toolbar', { name: 'Board actions' })).toBeVisible();
  });

  test('kanban board renders with all four columns', async ({ page }) => {
    await page.goto('/');

    // Wait for columns to load — data fetches via API, so allow time for loading
    const todoColumn = page.getByRole('region', { name: 'To Do' });
    const inProgressColumn = page.getByRole('region', { name: 'In Progress' });
    const blockedColumn = page.getByRole('region', { name: 'Blocked' });
    const doneColumn = page.getByRole('region', { name: 'Done' });

    await expect(todoColumn).toBeVisible({ timeout: 15_000 });
    await expect(inProgressColumn).toBeVisible();
    await expect(blockedColumn).toBeVisible();
    await expect(doneColumn).toBeVisible();
  });

  test('header shows create button and settings button', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header')).toBeVisible();

    // The "New Task" / "+" button should be in the header
    const createBtn = page.locator('header button', { hasText: /New Task|Create/ });
    await expect(createBtn).toBeVisible();

    // Settings button (gear icon)
    const settingsBtn = page.locator('header button:has(svg.lucide-settings)');
    await expect(settingsBtn).toBeVisible();
  });
});

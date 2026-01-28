import { test, expect } from '@playwright/test';
import { bypassAuth, seedTestTask, deleteTask } from './helpers/auth';

test.describe('Task List', () => {
  let testTaskId: string | null = null;

  test.beforeEach(async ({ page }) => {
    await bypassAuth(page);
  });

  test.afterEach(async ({ page }) => {
    if (testTaskId) {
      await deleteTask(page, testTaskId);
      testTaskId = null;
    }
  });

  test('tasks appear on the board', async ({ page }) => {
    // Seed a known task
    const task = await seedTestTask(page, {
      title: 'E2E Visible Task',
      status: 'todo',
      priority: 'high',
    });
    testTaskId = (task as { id: string }).id;

    await page.goto('/');

    // The kanban board should show the seeded task
    const taskCard = page.locator(`text=E2E Visible Task`);
    await expect(taskCard).toBeVisible({ timeout: 10_000 });
  });

  test('tasks appear in the correct column', async ({ page }) => {
    const task = await seedTestTask(page, {
      title: 'E2E Column Check Task',
      status: 'in-progress',
      priority: 'medium',
    });
    testTaskId = (task as { id: string }).id;

    await page.goto('/');

    // Find the in-progress column and verify the task is inside it
    const inProgressCol = page.getByRole('region', { name: /In Progress column/ });
    await expect(inProgressCol).toBeVisible({ timeout: 15_000 });
    await expect(inProgressCol.locator('text=E2E Column Check Task')).toBeVisible({ timeout: 10_000 });
  });

  test('multiple tasks render without errors', async ({ page }) => {
    await page.goto('/');

    // Wait for the board to load
    await expect(page.getByRole('region', { name: /To Do column/ })).toBeVisible({ timeout: 15_000 });

    // The page should not have any error messages visible
    await expect(page.locator('text=Connection Error')).not.toBeVisible();
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });
});

import { test, expect } from '@playwright/test';
import { bypassAuth, seedTestTask, deleteTask, cleanupRoutes } from './helpers/auth';

test.describe('Task Status Change', () => {
  let testTaskId: string | null = null;

  test.beforeEach(async ({ page }) => {
    await bypassAuth(page);
  });

  test.afterEach(async ({ page }) => {
    if (testTaskId) {
      await deleteTask(page, testTaskId).catch(() => {});
      testTaskId = null;
    }
    await cleanupRoutes(page);
  });

  test('change task status via detail panel dropdown', async ({ page }) => {
    const uniqueTitle = `E2E Status Change ${Date.now()}`;

    const task = await seedTestTask(page, {
      title: uniqueTitle,
      status: 'todo',
      priority: 'medium',
    });
    testTaskId = (task as { id: string }).id;

    await page.goto('/');

    // Verify the task is in the To Do column
    const todoColumn = page.getByRole('region', { name: 'To Do' });
    await expect(todoColumn.locator(`text=${uniqueTitle}`)).toBeVisible({
      timeout: 15_000,
    });

    // Click the task to open the detail panel
    await todoColumn.locator(`text=${uniqueTitle}`).click();

    const detailPanel = page.locator('[role="dialog"]');
    await expect(detailPanel).toBeVisible({ timeout: 5_000 });

    const statusTrigger = detailPanel.getByRole('combobox', { name: 'Status' });
    await expect(statusTrigger).toBeVisible();
    await statusTrigger.click();

    // Select "In Progress" and wait for the API PATCH response
    const inProgressOption = page.getByRole('option', { name: 'In Progress' });
    await expect(inProgressOption).toBeVisible();

    const [patchResponse] = await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/api/tasks/') && resp.request().method() === 'PATCH',
        { timeout: 10_000 }
      ),
      inProgressOption.click(),
    ]);

    // Ensure the PATCH succeeded
    expect(patchResponse.status()).toBeLessThan(400);

    // Close the detail panel
    await page.keyboard.press('Escape');
    await expect(detailPanel).not.toBeVisible({ timeout: 3_000 });

    // Wait for the task to move to the In Progress column
    const inProgressColumn = page.getByRole('region', { name: 'In Progress' });
    await expect(inProgressColumn.locator(`text=${uniqueTitle}`)).toBeVisible({
      timeout: 10_000,
    });

    // Verify it's no longer in the To Do column
    await expect(todoColumn.locator(`text=${uniqueTitle}`)).not.toBeVisible();
  });

  test('change task status to done via detail panel', async ({ page }) => {
    const uniqueTitle = `E2E Done Task ${Date.now()}`;

    const task = await seedTestTask(page, {
      title: uniqueTitle,
      status: 'in-progress',
      priority: 'low',
    });
    testTaskId = (task as { id: string }).id;

    await page.goto('/');

    // Verify the task starts in In Progress
    const inProgressCol = page.getByRole('region', { name: 'In Progress' });
    await expect(inProgressCol.locator(`text=${uniqueTitle}`)).toBeVisible({ timeout: 15_000 });

    // Open the detail panel
    await inProgressCol.locator(`text=${uniqueTitle}`).click();

    const detailPanel = page.locator('[role="dialog"]');
    await expect(detailPanel).toBeVisible({ timeout: 5_000 });

    const statusTrigger = detailPanel.getByRole('combobox', { name: 'Status' });
    await expect(statusTrigger).toBeVisible();
    await statusTrigger.click();

    // Select "Done" and wait for the API PATCH
    const doneOption = page.getByRole('option', { name: 'Done' });
    await expect(doneOption).toBeVisible();

    const [patchResponse] = await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/api/tasks/') && resp.request().method() === 'PATCH',
        { timeout: 10_000 }
      ),
      doneOption.click(),
    ]);

    expect(patchResponse.status()).toBeLessThan(400);

    // Close panel
    await page.keyboard.press('Escape');

    // Verify the task moved to Done
    const doneCol = page.getByRole('region', { name: 'Done' });
    await expect(doneCol.locator(`text=${uniqueTitle}`)).toBeVisible({ timeout: 10_000 });
  });
});

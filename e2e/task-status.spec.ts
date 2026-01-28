import { test, expect } from '@playwright/test';
import { bypassAuth, seedTestTask, deleteTask } from './helpers/auth';

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
  });

  test('change task status via detail panel dropdown', async ({ page }) => {
    // Seed a task in "todo" status
    const task = await seedTestTask(page, {
      title: 'E2E Status Change Task',
      status: 'todo',
      priority: 'medium',
    });
    testTaskId = (task as { id: string }).id;

    await page.goto('/');

    // Verify the task is in the To Do column
    const todoColumn = page.getByRole('region', { name: /To Do column/ });
    await expect(todoColumn.locator('text=E2E Status Change Task')).toBeVisible({
      timeout: 15_000,
    });

    // Click the task to open the detail panel
    await page.locator('text=E2E Status Change Task').click();

    const detailPanel = page.locator('[role="dialog"]');
    await expect(detailPanel).toBeVisible({ timeout: 5_000 });

    // Find the Status label and its adjacent Select trigger
    const statusSection = detailPanel.locator('text=Status').locator('..');
    const statusTrigger = statusSection.locator('button[role="combobox"]');
    await statusTrigger.click();

    // Select "In Progress" from the dropdown
    const inProgressOption = page.getByRole('option', { name: 'In Progress' });
    await expect(inProgressOption).toBeVisible();
    await inProgressOption.click();

    // Close the detail panel
    await page.keyboard.press('Escape');
    await expect(detailPanel).not.toBeVisible({ timeout: 3_000 });

    // Wait for the task to move to the In Progress column
    const inProgressColumn = page.getByRole('region', { name: /In Progress column/ });
    await expect(inProgressColumn.locator('text=E2E Status Change Task')).toBeVisible({
      timeout: 10_000,
    });

    // Verify it's no longer in the To Do column
    await expect(todoColumn.locator('text=E2E Status Change Task')).not.toBeVisible();
  });

  test('change task status to done via detail panel', async ({ page }) => {
    const task = await seedTestTask(page, {
      title: 'E2E Done Task',
      status: 'in-progress',
      priority: 'low',
    });
    testTaskId = (task as { id: string }).id;

    await page.goto('/');

    // Verify the task starts in In Progress
    const inProgressCol = page.getByRole('region', { name: /In Progress column/ });
    await expect(inProgressCol.locator('text=E2E Done Task')).toBeVisible({ timeout: 15_000 });

    // Open the detail panel
    await page.locator('text=E2E Done Task').click();

    const detailPanel = page.locator('[role="dialog"]');
    await expect(detailPanel).toBeVisible({ timeout: 5_000 });

    // Change status to Done
    const statusSection = detailPanel.locator('text=Status').locator('..');
    const statusTrigger = statusSection.locator('button[role="combobox"]');
    await statusTrigger.click();

    const doneOption = page.getByRole('option', { name: 'Done' });
    await expect(doneOption).toBeVisible();
    await doneOption.click();

    // Close panel
    await page.keyboard.press('Escape');

    // Verify the task moved to Done
    const doneCol = page.getByRole('region', { name: /Done column/ });
    await expect(doneCol.locator('text=E2E Done Task')).toBeVisible({ timeout: 10_000 });
  });
});

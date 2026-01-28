import { test, expect } from '@playwright/test';
import { bypassAuth, seedTestTask, deleteTask } from './helpers/auth';

test.describe('Task Detail Panel', () => {
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

  test('clicking a task opens the detail panel', async ({ page }) => {
    // Seed a task to click on
    const task = await seedTestTask(page, {
      title: 'E2E Detail Test Task',
      description: 'Detail panel test description',
      status: 'todo',
      priority: 'high',
    });
    testTaskId = (task as { id: string }).id;

    await page.goto('/');

    // Click the task card
    const taskCard = page.locator('text=E2E Detail Test Task');
    await expect(taskCard).toBeVisible({ timeout: 10_000 });
    await taskCard.click();

    // The detail panel (Sheet) should open
    const detailPanel = page.locator('[role="dialog"]');
    await expect(detailPanel).toBeVisible({ timeout: 5_000 });

    // Verify the task title is shown in the panel
    await expect(detailPanel.locator('text=E2E Detail Test Task')).toBeVisible();
  });

  test('detail panel shows task information', async ({ page }) => {
    const task = await seedTestTask(page, {
      title: 'E2E Info Panel Task',
      description: 'Description for detail panel verification',
      status: 'todo',
      priority: 'high',
    });
    testTaskId = (task as { id: string }).id;

    await page.goto('/');

    // Click the task to open the detail panel
    const taskCard = page.locator('text=E2E Info Panel Task');
    await expect(taskCard).toBeVisible({ timeout: 10_000 });
    await taskCard.click();

    const detailPanel = page.locator('[role="dialog"]');
    await expect(detailPanel).toBeVisible({ timeout: 5_000 });

    // The details tab should be active by default and show task info
    await expect(detailPanel.locator('text=Details')).toBeVisible();

    // The task title should be editable (it's an input in non-readOnly mode)
    const titleInput = detailPanel.locator('input').first();
    await expect(titleInput).toHaveValue('E2E Info Panel Task');
  });

  test('detail panel closes on Escape', async ({ page }) => {
    const task = await seedTestTask(page, {
      title: 'E2E Close Panel Task',
      status: 'todo',
    });
    testTaskId = (task as { id: string }).id;

    await page.goto('/');

    // Open the detail panel
    const taskCard = page.locator('text=E2E Close Panel Task');
    await expect(taskCard).toBeVisible({ timeout: 10_000 });
    await taskCard.click();

    const detailPanel = page.locator('[role="dialog"]');
    await expect(detailPanel).toBeVisible({ timeout: 5_000 });

    // Press Escape to close
    await page.keyboard.press('Escape');
    await expect(detailPanel).not.toBeVisible({ timeout: 3_000 });
  });
});

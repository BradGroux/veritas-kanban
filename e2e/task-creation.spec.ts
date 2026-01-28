import { test, expect } from '@playwright/test';
import { bypassAuth, deleteTask } from './helpers/auth';

test.describe('Task Creation', () => {
  const createdTaskIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    await bypassAuth(page);
  });

  test.afterEach(async ({ page }) => {
    // Clean up any tasks created during the test
    for (const id of createdTaskIds) {
      await deleteTask(page, id).catch(() => {});
    }
    createdTaskIds.length = 0;
  });

  test('create a new task via the dialog', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header')).toBeVisible();

    // Click the "New Task" button in the header
    const createBtn = page.locator('header button', { hasText: /New Task|Create/ });
    await createBtn.click();

    // Wait for the dialog to open
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('text=Create New Task')).toBeVisible();

    // Fill in the title
    const titleInput = dialog.locator('#title');
    await titleInput.fill('E2E Created Task');

    // Fill in the description
    const descInput = dialog.locator('#description');
    await descInput.fill('This task was created by an E2E test');

    // Submit the form
    const submitBtn = dialog.locator('button[type="submit"]', { hasText: /Create/ });
    await submitBtn.click();

    // Dialog should close after the API call completes
    // (may take longer if rate-limited and retried by the 429 interceptor)
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });

    // The new task should appear on the board (in the To Do column)
    const taskCard = page.locator('text=E2E Created Task');
    await expect(taskCard).toBeVisible({ timeout: 10_000 });

    // Clean up — find the task ID via API and queue for deletion
    const response = await page.request.get('/api/tasks', {
      headers: { 'X-API-Key': 'dev-admin-key' },
    });
    const tasks = await response.json();
    const created = (tasks as { id: string; title: string }[]).find(
      (t) => t.title === 'E2E Created Task',
    );
    if (created) {
      createdTaskIds.push(created.id);
    }
  });

  test('create dialog shows validation (empty title)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header')).toBeVisible();

    // Open create dialog
    const createBtn = page.locator('header button', { hasText: /New Task|Create/ });
    await createBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // The submit button should be disabled when the title is empty
    const submitBtn = dialog.locator('button[type="submit"]', { hasText: /Create/ });
    const titleInput = dialog.locator('#title');

    // Verify the title input is empty
    await expect(titleInput).toHaveValue('');

    // The submit button should be disabled — preventing submission without a title
    await expect(submitBtn).toBeDisabled();

    // The dialog should remain open
    await expect(dialog).toBeVisible();

    // Typing a title should enable the button
    await titleInput.fill('Valid Title');
    await expect(submitBtn).toBeEnabled();

    // Clearing it again should disable it
    await titleInput.clear();
    await expect(submitBtn).toBeDisabled();
  });

  test('create dialog can be closed with cancel', async ({ page }) => {
    await page.goto('/');

    // Open create dialog
    const createBtn = page.locator('header button', { hasText: /New Task|Create/ });
    await createBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Press Escape to close
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible({ timeout: 3_000 });
  });
});

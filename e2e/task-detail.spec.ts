import { test, expect } from '@playwright/test';
import { bypassAuth, seedTestTask, deleteTask, cleanupRoutes } from './helpers/auth';

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
    await cleanupRoutes(page);
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
    const taskCard = page.locator('text=E2E Detail Test Task').first();
    await expect(taskCard).toBeVisible({ timeout: 10_000 });
    await taskCard.click();

    // The detail panel drawer should open
    const detailPanel = page.locator('[role="dialog"]');
    await expect(detailPanel).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.mantine-Drawer-content')).toBeVisible();
    await expect(detailPanel.locator('.mantine-Tabs-root').first()).toBeVisible();
    await expect(page.locator('[data-slot="sheet-content"]')).toHaveCount(0);

    // Verify the task title is shown in the panel — it's an input field
    const titleInput = detailPanel.locator('input').first();
    await expect(titleInput).toHaveValue('E2E Detail Test Task');
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
    const taskCard = page.locator('text=E2E Info Panel Task').first();
    await expect(taskCard).toBeVisible({ timeout: 10_000 });
    await taskCard.click();

    const detailPanel = page.locator('[role="dialog"]');
    await expect(detailPanel).toBeVisible({ timeout: 5_000 });

    // The details tab should be active by default and show task info
    await expect(detailPanel.getByRole('tab', { name: 'Details' })).toBeVisible();
    await expect(
      detailPanel.getByRole('navigation', { name: 'Task workspace modes' })
    ).toBeVisible();

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
    const taskCard = page.locator('text=E2E Close Panel Task').first();
    await expect(taskCard).toBeVisible({ timeout: 10_000 });
    await taskCard.click();

    const detailPanel = page.locator('[role="dialog"]');
    await expect(detailPanel).toBeVisible({ timeout: 5_000 });

    // Press Escape to close
    await page.keyboard.press('Escape');
    await expect(detailPanel).not.toBeVisible({ timeout: 3_000 });
  });

  test('expanded workspace preserves section, scroll, and board focus', async ({ page }) => {
    const title = `E2E Expanded Workspace ${Date.now()}`;
    const task = await seedTestTask(page, {
      title,
      description: `Expanded task context\n\n${'Long task detail content. '.repeat(240)}`,
      type: 'code',
      status: 'todo',
      git: {
        repo: 'BradGroux/veritas-kanban',
        branch: 'feat/e2e-expanded-workspace',
        baseBranch: 'main',
        worktreePath: '/tmp/e2e-expanded-workspace',
      },
    });
    testTaskId = (task as { id: string }).id;

    await page.setViewportSize({ width: 1440, height: 820 });
    await page.goto('/');

    const taskCard = page.getByRole('article', { name: new RegExp(`Task: ${title}`) });
    await taskCard.focus();
    await page.keyboard.press('Enter');

    const detail = page.getByTestId('task-detail-panel');
    await expect(detail).toBeVisible();
    await detail.getByRole('button', { name: 'Plan' }).click();
    await detail.getByRole('tab', { name: 'Details' }).click();
    const scrollRegion = detail.getByTestId('task-detail-scroll-region');
    await scrollRegion.evaluate((element) => {
      element.scrollTop = 240;
    });
    const initialScroll = await scrollRegion.evaluate((element) => element.scrollTop);
    expect(initialScroll).toBeGreaterThan(0);

    await detail.getByRole('button', { name: 'Expand task workspace' }).click();
    await expect(detail).toHaveAttribute('data-presentation', 'expanded');
    await expect(detail.getByRole('button', { name: 'Plan' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    await expect(detail.getByRole('tab', { name: 'Details' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(await scrollRegion.evaluate((element) => element.scrollTop)).toBe(initialScroll);
    const expandedBox = await detail.boundingBox();
    expect(expandedBox?.width ?? 0).toBeGreaterThanOrEqual(1439);
    expect(await detail.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);

    await detail.getByRole('button', { name: 'Exit expanded task workspace' }).click();
    await expect(detail).toHaveAttribute('data-presentation', 'drawer');
    expect(await scrollRegion.evaluate((element) => element.scrollTop)).toBe(initialScroll);

    await detail.getByRole('button', { name: 'Close task workspace' }).click();
    await expect(detail).not.toBeVisible();
    await expect(taskCard).toBeFocused();
  });
});

import { test, expect, type Route } from '@playwright/test';
import { bypassAuth, seedTestTask, deleteTask, cleanupRoutes, unwrapApiData } from './helpers/auth';

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

  for (const theme of ['dark', 'light']) {
    test(`task shell adapts to panel width and text size in ${theme}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript((colorScheme) => {
        localStorage.setItem('veritas-kanban-theme', colorScheme);
      }, theme);
      const title = `E2E Responsive Task ${theme}`;
      const task = await seedTestTask(page, { title, type: 'code', status: 'todo' });
      testTaskId = (task as { id: string }).id;
      await page.setViewportSize({ width: 1440, height: 820 });
      await page.goto('/');
      await page.getByRole('article', { name: `Task: ${title}` }).click();
      const detail = page.getByTestId('task-detail-panel');
      const rail = detail.getByRole('navigation', { name: 'Task workspace modes' });
      const modeSelector = detail.getByRole('combobox', { name: 'Task workspace mode' });
      await expect(rail).toBeVisible();
      await expect(modeSelector).toBeHidden();
      await detail.getByRole('button', { name: 'Results', exact: true }).click();
      await detail.getByRole('tab', { name: 'Evidence', exact: true }).click();

      for (const geometry of [
        { width: 740, height: 700, fontSize: '16px' },
        { width: 900, height: 480, fontSize: '20px' },
      ]) {
        await page.setViewportSize(geometry);
        await page.evaluate((size) => {
          document.documentElement.style.fontSize = size;
        }, geometry.fontSize);
        await expect(rail).toBeHidden();
        await expect(modeSelector).toBeVisible();
        await expect(modeSelector).toHaveValue('Results');
        await detail.getByRole('textbox', { name: 'Task title', exact: true }).focus();
        await page.keyboard.press('Tab');
        await expect(modeSelector).toBeFocused();
        const sectionSelector = detail.getByRole('combobox', { name: 'Results section' });
        await expect(sectionSelector).toHaveValue('Evidence');
        await modeSelector.click();
        await expect(page.getByRole('listbox')).toBeVisible();
        await modeSelector.press('Escape');
        await expect(page.getByRole('listbox')).toBeHidden();
        await expect(detail).toBeVisible();
        await sectionSelector.click();
        await page.getByRole('option', { name: 'Review', exact: true }).click();
        await expect(sectionSelector).toHaveValue('Review');
        await sectionSelector.click();
        await page.getByRole('option', { name: 'Evidence', exact: true }).click();
        const box = (await detail.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.width).toBeLessThanOrEqual(geometry.width);
        expect(box.y + box.height).toBeLessThanOrEqual(geometry.height + 1);
        expect(await detail.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
        const body = (await detail.getByTestId('task-detail-scroll-region').boundingBox())!;
        expect(body.height).toBeGreaterThan(40);
        const close = (await detail
          .getByRole('button', { name: 'Close task workspace' })
          .boundingBox())!;
        expect(close.x + close.width).toBeLessThanOrEqual(geometry.width);
        expect(close.y + close.height).toBeLessThanOrEqual(geometry.height);
      }

      await page.setViewportSize({ width: 1440, height: 820 });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '16px';
      });
      await expect(rail).toBeVisible();
      await expect(detail.getByRole('tab', { name: 'Evidence', exact: true })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      await detail.getByRole('button', { name: 'Close task workspace' }).click();
      await expect(detail).toBeHidden();
    });
  }

  test('task shell retains an in-flight edit across compact and expanded views', async ({
    page,
  }) => {
    const title = 'E2E Unsaved Responsive Task';
    const task = await seedTestTask(page, { title, type: 'code', status: 'todo' });
    testTaskId = (task as { id: string }).id;
    let pendingSave: Route | undefined;
    await page.route(`**/api/tasks/${testTaskId}`, (route) => {
      if (route.request().method() === 'PATCH') pendingSave = route;
      else return route.fallback();
    });
    try {
      await page.setViewportSize({ width: 1440, height: 820 });
      await page.goto('/');
      await page.getByRole('article', { name: `Task: ${title}` }).click();
      const detail = page.getByTestId('task-detail-panel');
      const input = detail.getByRole('textbox', { name: 'Task title', exact: true });
      const editedTitle = `${title} with a pending edit`;
      await input.fill(editedTitle);
      await expect.poll(() => Boolean(pendingSave)).toBe(true);
      await expect(detail.getByText('Saving...', { exact: true })).toBeVisible();
      await page.setViewportSize({ width: 740, height: 700 });
      await expect(input).toHaveValue(editedTitle);
      await detail.getByRole('button', { name: 'Expand task workspace' }).click();
      await page.setViewportSize({ width: 1440, height: 820 });
      await expect(input).toHaveValue(editedTitle);
      await expect(detail.getByText('Saving...', { exact: true })).toBeVisible();
      await detail.getByRole('button', { name: 'Exit expanded task workspace' }).click();
      await expect(input).toHaveValue(editedTitle);
      await pendingSave!.fallback();
      pendingSave = undefined;
      await expect(detail.getByText('Saving...', { exact: true })).toBeHidden();
      await expect(input).toHaveValue(editedTitle);
      const persisted = await page.request.get(
        `${process.env.API_BASE_URL || 'http://127.0.0.1:3001'}/api/tasks/${testTaskId}`
      );
      expect(persisted.ok()).toBe(true);
      expect(unwrapApiData<{ title: string }>(await persisted.json()).title).toBe(editedTitle);
      await detail.getByRole('button', { name: 'Close task workspace' }).click();
    } finally {
      await pendingSave?.abort().catch(() => undefined);
    }
  });
});

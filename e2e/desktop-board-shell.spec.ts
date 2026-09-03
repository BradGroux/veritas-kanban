import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask } from './helpers/auth';

test.describe('Desktop board shell containment', () => {
  const taskIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    await bypassAuth(page);
    await page.addInitScript(() => {
      window.localStorage.setItem('veritas-kanban-theme', 'dark');
      window.localStorage.setItem('veritas.desktop.rightRailOpen', 'true');
      window.localStorage.setItem('veritas.workbench.dockPosition', 'bottom');
      window.localStorage.setItem('veritas.workbench.bottomPanelHeight', '640');
      Object.defineProperty(window, 'veritasDesktop', {
        configurable: true,
        value: {
          onMenuCommand: () => () => undefined,
          toggleWindowMaximize: async () => ({ maximized: false }),
        },
      });
    });
  });

  test.afterEach(async ({ page }) => {
    await Promise.all(taskIds.splice(0).map((taskId) => deleteTask(page, taskId).catch(() => {})));
    await cleanupRoutes(page);
  });

  test('keeps chat and a real drag inside the populated desktop viewport', async ({ page }) => {
    for (let index = 0; index < 6; index += 1) {
      const task = await seedTestTask(page, {
        title: `Desktop shell source ${index + 1}`,
        description:
          'Representative populated-board task whose wrapped content exercises the constrained desktop workspace.',
        type: index % 2 === 0 ? 'code' : 'content',
      });
      taskIds.push(task.id as string);
    }
    const destination = await seedTestTask(page, {
      title: 'Desktop shell destination',
      description: 'Visible drop target for the desktop shell containment regression.',
      status: 'blocked',
    });
    taskIds.push(destination.id as string);

    await page.setViewportSize({ width: 1224, height: 768 });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-client', 'desktop');
    await expect(page.getByLabel('Board right sidebar')).toBeVisible();
    const rightRailToggle = page.getByRole('button', { name: 'Collapse right sidebar' });
    await expect(rightRailToggle).toHaveAttribute('aria-controls', 'board-right-sidebar');
    await expect(rightRailToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#board-right-sidebar')).toBeVisible();
    await rightRailToggle.click();
    await expect(page.getByRole('button', { name: 'Expand right sidebar' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    await expect(page.locator('#board-right-sidebar')).toBeHidden();
    await page.getByRole('button', { name: 'Expand right sidebar' }).click();
    await expect(page.getByRole('button', { name: 'Collapse right sidebar' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expect(page.locator('#board-right-sidebar')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open chat dock' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open Board Chat' }).locator('svg')).toHaveClass(
      /lucide-message-square/
    );
    await expect(page.getByRole('button', { name: 'Open Squad Chat' }).locator('svg')).toHaveClass(
      /lucide-users/
    );
    await expect
      .poll(() =>
        page.evaluate(() => window.localStorage.getItem('veritas.workbench.dockPosition'))
      )
      .toBeNull();
    await expect
      .poll(() =>
        page.evaluate(() => window.localStorage.getItem('veritas.workbench.bottomPanelHeight'))
      )
      .toBeNull();
    await Promise.all(
      taskIds.map((taskId) => expect(page.locator(`[data-task-id="${taskId}"]`)).toBeAttached())
    );

    await page.getByRole('button', { name: 'Open Board Chat' }).click();
    const workbench = page.getByRole('region', { name: 'Workbench right dock' });
    await expect(workbench).toBeVisible();
    await expect(workbench).toHaveAttribute('id', 'workbench-right-dock');
    await expect(page.getByRole('button', { name: 'Close Board Chat' })).toHaveAttribute(
      'aria-controls',
      'workbench-right-dock'
    );
    await expect(workbench.getByRole('radiogroup', { name: 'Dock position' })).toHaveCount(0);

    const readViewport = () =>
      page.evaluate(() => ({
        innerHeight: window.innerHeight,
        documentHeight: document.documentElement.scrollHeight,
        scrollY: window.scrollY,
        shellHeight: document.querySelector('.desktop-app-shell')?.getBoundingClientRect().height,
      }));
    const expectedViewport = {
      innerHeight: 768,
      documentHeight: 768,
      scrollY: 0,
      shellHeight: 768,
    };
    expect(await readViewport()).toEqual(expectedViewport);

    const resizer = page.getByRole('button', { name: 'Resize right dock' });
    const widthBeforeResize = await workbench.evaluate(
      (element) => element.getBoundingClientRect().width
    );
    await resizer.focus();
    await page.keyboard.press('ArrowLeft');
    await expect
      .poll(() => workbench.evaluate((element) => element.getBoundingClientRect().width))
      .toBeGreaterThan(widthBeforeResize);
    expect(await readViewport()).toEqual(expectedViewport);

    await page.getByRole('button', { name: 'Switch to Squad Chat' }).click();
    await expect(page.getByRole('region', { name: 'Squad Chat' })).toBeVisible();
    expect(await readViewport()).toEqual(expectedViewport);

    await page.getByRole('button', { name: 'Close right dock' }).click();
    await expect(page.getByRole('region', { name: 'Workbench right dock' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Activity', exact: true }).click();
    await expect(page).toHaveURL(/\/activity$/);
    await expect(page.getByRole('button', { name: /right sidebar/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open chat dock' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open Board Chat' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Squad Chat' })).toBeVisible();

    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('button', { name: 'Collapse right sidebar' })).toBeVisible();

    const movingId = taskIds[5];
    const destinationId = destination.id as string;
    const source = page.locator(`[data-task-id="${movingId}"]`);
    const destinationCard = page.locator(`[data-task-id="${destinationId}"]`);
    const blocked = page.getByRole('region', { name: 'Blocked' });
    await expect(source).toHaveClass(/cursor-grab/);
    const sourceBox = await source.boundingBox();
    const destinationBox = await destinationCard.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(destinationBox).not.toBeNull();
    expect(
      await page.evaluate(
        ({ x, y }) =>
          document.elementFromPoint(x, y)?.closest('[data-task-id]')?.getAttribute('data-task-id'),
        { x: sourceBox!.x + sourceBox!.width / 2, y: sourceBox!.y + 18 }
      )
    ).toBe(movingId);

    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + 18);
    await page.mouse.down();
    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2 + 30, sourceBox!.y + 48, {
      steps: 8,
    });
    await expect(page.locator('[data-board-drag-overlay]')).toHaveCount(1);
    await page.mouse.move(destinationBox!.x + destinationBox!.width / 2, destinationBox!.y + 18, {
      steps: 8,
    });
    await page.mouse.up();
    await expect(blocked.locator(`[data-task-id="${movingId}"]`)).toBeVisible();
    expect(await readViewport()).toEqual(expectedViewport);
  });
});

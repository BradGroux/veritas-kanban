import { expect, test, type Locator, type Page } from '@playwright/test';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask } from './helpers/auth';

interface ViewportProbe {
  frame: number;
  samples: number[];
  menuOverflows: string[];
}
declare global {
  interface Window {
    viewportProbe: ViewportProbe;
  }
}
async function startViewportProbe(page: Page) {
  await page.evaluate(() => {
    const probe: ViewportProbe = { frame: 0, samples: [], menuOverflows: [] };
    window.viewportProbe = probe;
    const sample = () => {
      probe.samples.push(innerWidth);
      for (const menu of document.querySelectorAll('.mantine-Select-dropdown')) {
        const rect = menu.getBoundingClientRect();
        const style = getComputedStyle(menu);
        if (
          rect.width > 0 &&
          Number(style.opacity) > 0.1 &&
          style.visibility !== 'hidden' &&
          (rect.left < -1 || rect.right > document.documentElement.clientWidth + 1)
        ) {
          probe.menuOverflows.push(rect.left + '..' + rect.right);
        }
      }
      probe.frame = requestAnimationFrame(sample);
    };
    sample();
  });
}
async function assertReachable(locator: Locator) {
  await expect(locator).toBeVisible();
  expect(
    await locator.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return (
        rect.left >= 0 &&
        rect.right <= document.documentElement.clientWidth &&
        !!hit &&
        el.contains(hit)
      );
    })
  ).toBe(true);
}

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
test.beforeEach(async ({ page }) => bypassAuth(page));
test.afterEach(async ({ page }) => {
  await page.evaluate(() => cancelAnimationFrame(window.viewportProbe?.frame));
  await cleanupRoutes(page);
});

for (const width of [320, 390, 430]) {
  for (const textSize of [16, 20]) {
    test(`Mobile controls fit ${width}px with ${textSize}px text`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript(
        (theme) => localStorage.setItem('veritas-kanban-theme', theme),
        textSize === 20 ? 'light' : 'dark'
      );
      const taskTitle = `Viewport ${width} ${textSize}`;
      const task = await seedTestTask(page, { title: taskTitle, type: 'code' });
      try {
        await page.goto('/');
        await page.addStyleTag({ content: `:root { font-size: ${textSize}px !important; }` });
        await expect(page.locator('#mobile-board-columns')).toBeVisible();
        expect(await page.evaluate(() => innerWidth)).toBe(width);
        await startViewportProbe(page);
        const header = page.locator('.desktop-app-header');
        for (const name of [
          'Refresh page',
          'WebSocket connected',
          'New Task',
          'More views',
          'Search',
          'Session menu',
        ]) {
          await assertReachable(header.getByRole('button', { name, exact: true }));
        }
        const overlaps = await header.evaluate((el) => {
          const buttons = [...el.querySelectorAll('button')]
            .map((button) => ({
              name: button.getAttribute('aria-label'),
              rect: button.getBoundingClientRect(),
            }))
            .filter(({ rect }) => rect.width > 0 && rect.height > 0);
          return buttons.flatMap((a, index) =>
            buttons
              .slice(index + 1)
              .filter(
                (b) =>
                  Math.min(a.rect.right, b.rect.right) > Math.max(a.rect.left, b.rect.left) &&
                  Math.min(a.rect.bottom, b.rect.bottom) > Math.max(a.rect.top, b.rect.top)
              )
              .map((b) => [a.name, b.name])
          );
        });
        expect(overlaps).toEqual([]);
        await testInfo.attach('mobile-header', {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
        await header.getByRole('button', { name: 'More views', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Activity', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Mobile board', exact: true }).click();
        await expect(page.locator('#mobile-board-columns')).toBeVisible();
        await page.getByRole('button', { name: 'Mobile home', exact: true }).click();
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);

        await page.getByRole('combobox', { name: 'Filter by type', exact: true }).click();
        await page.getByRole('option', { name: 'All Types', exact: true }).click();
        await page.getByRole('heading', { name: taskTitle, exact: true }).click();
        const detail = page.getByTestId('task-detail-panel');
        await expect(detail).toBeVisible();
        const mode = detail.getByRole('combobox', { name: 'Task workspace mode', exact: true });
        await mode.click();
        await assertReachable(page.getByRole('option', { name: 'Plan', exact: true }));
        await testInfo.attach('mobile-menu', {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
        await page.getByRole('option', { name: 'Plan', exact: true }).click();
        await detail.getByRole('combobox', { name: 'Plan section', exact: true }).click();
        await page.getByRole('option', { name: 'Details', exact: true }).click();
        await mode.click();
        await page.getByRole('option', { name: 'Overview', exact: true }).click();
        await assertReachable(detail.getByRole('button', { name: 'Close task workspace' }));
        await testInfo.attach('mobile-workspace', {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
        await detail.getByRole('button', { name: 'Close task workspace' }).click();
        await expect(detail).not.toBeVisible();
        await page.getByRole('button', { name: 'Mobile board', exact: true }).click();
        const result = await page.evaluate(() => {
          cancelAnimationFrame(window.viewportProbe.frame);
          return window.viewportProbe;
        });
        expect(result.samples.length).toBeGreaterThan(5);
        expect(Math.min(...result.samples)).toBe(width);
        expect(Math.max(...result.samples)).toBe(width);
        expect(result.menuOverflows).toEqual([]);
      } finally {
        await deleteTask(page, task.id as string);
      }
    });
  }
}

test.describe('wide browser Select positioning', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

  test('preserves wide navigation and anchors a portaled menu after scrolling', async ({
    page,
  }) => {
    const task = await seedTestTask(page, { title: 'Desktop dropdown positioning', type: 'code' });
    try {
      await page.goto('/');
      await expect(page.locator('#mobile-board-columns')).toBeVisible();
      const header = page.locator('.desktop-app-header');
      await assertReachable(header.getByRole('button', { name: 'Activity', exact: true }));
      await page
        .getByRole('heading', { name: 'Desktop dropdown positioning', exact: true })
        .click();
      const detail = page.getByTestId('task-detail-panel');
      await detail.getByRole('button', { name: 'Plan', exact: true }).click();
      const priority = detail.getByRole('combobox', { name: 'Priority', exact: true });
      await priority.scrollIntoViewIfNeeded();
      await priority.click();
      const option = page.getByRole('option', { name: 'Medium', exact: true });
      await assertReachable(option);
      const dropdown = page.locator('.mantine-Select-dropdown:visible');
      const [targetBox, menuBox] = await Promise.all([
        priority.boundingBox(),
        dropdown.boundingBox(),
      ]);
      expect(targetBox).not.toBeNull();
      expect(menuBox).not.toBeNull();
      expect(Math.abs(menuBox!.x - targetBox!.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(menuBox!.width - targetBox!.width)).toBeLessThanOrEqual(2);
      await option.click();
      await expect(priority).toHaveValue('Medium');
      await detail.getByRole('button', { name: 'Close task workspace' }).click();
      await expect(detail).not.toBeVisible();
    } finally {
      await deleteTask(page, task.id as string);
    }
  });
});

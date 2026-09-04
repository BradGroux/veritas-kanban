import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

test.use({ viewport: { width: 320, height: 844 }, isMobile: true, hasTouch: true });

test.beforeEach(async ({ page }) => {
  await bypassAuth(page);
  await page.route('**/api/status-history?*', (route) =>
    route.fulfill({
      json: { success: true, data: [], meta: { timestamp: '2026-09-04T09:00:00.000Z' } },
    })
  );
  await page.route('**/api/activity?*', (route) =>
    route.fulfill({
      json: {
        success: true,
        meta: { timestamp: '2026-09-04T09:00:00.000Z' },
        data: Array.from({ length: 20 }, (_, index) => ({
          id: `activity-mobile-${index}`,
          type: 'status_changed',
          taskId: `task_20260904_mobile${index}`,
          taskTitle: `Populated Activity task ${index}`,
          actor: 'service:admin',
          details: { from: 'todo', status: 'blocked' },
          timestamp: '2026-09-04T09:00:00.000Z',
        })),
      },
    })
  );
});
test.afterEach(async ({ page }) => cleanupRoutes(page));

for (const width of [320, 430]) {
  for (const textSize of [16, 20]) {
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      test(`populated Activity preserves mobile controls at ${width}px, ${textSize}px text, ${reducedMotion}`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ reducedMotion });
        await page.addInitScript(
          (theme) => localStorage.setItem('veritas-kanban-theme', theme),
          textSize === 20 ? 'light' : 'dark'
        );
        await page.goto('/');
        await page.addStyleTag({ content: `:root { font-size: ${textSize}px !important; }` });
        await page.getByRole('button', { name: 'More views', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Activity', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
        await expect(
          page.getByRole('button', { name: /Populated Activity task 0$/ })
        ).toBeVisible();
        expect(await page.evaluate(() => innerWidth)).toBe(width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        const screenshot = testInfo.outputPath('populated-activity.png');
        await page.screenshot({ path: screenshot });
        await testInfo.attach('populated-activity', { path: screenshot, contentType: 'image/png' });
        const board = page.getByRole('button', { name: 'Mobile board', exact: true });
        for (const control of [
          ...(await page
            .getByRole('navigation', { name: 'Mobile navigation' })
            .getByRole('button')
            .all()),
          page.getByRole('button', { name: 'Open chat', exact: true }),
        ]) {
          await expect
            .poll(() =>
              control.evaluate((button) => {
                const rect = button.getBoundingClientRect();
                return button.contains(
                  document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
                );
              })
            )
            .toBe(true);
        }
        await board.click();
        await expect(page.locator('#mobile-board-columns')).toBeVisible();
        await page.goto('/activity');
        await page.addStyleTag({ content: `:root { font-size: ${textSize}px !important; }` });
        await expect(
          page.getByRole('button', { name: /Populated Activity task 0$/ })
        ).toBeVisible();
        expect(await page.locator('html').evaluate((el) => getComputedStyle(el).fontSize)).toBe(
          `${textSize}px`
        );
        await board.focus();
        await board.press('Enter');
        await expect(page.locator('#mobile-board-columns')).toBeVisible();
      });
    }
  }
}

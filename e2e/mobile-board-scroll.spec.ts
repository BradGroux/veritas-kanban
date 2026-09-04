import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test.beforeEach(async ({ page }) => {
  await bypassAuth(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});
test.afterEach(async ({ page }) => cleanupRoutes(page));

test('Board navigation from Activity waits for the columns to render', async ({ page }) => {
  await page.goto('/activity');
  await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mobile board', exact: true }).click();
  await expect(page.locator('#mobile-board-columns')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const columns = document.getElementById('mobile-board-columns')!;
        const header = document.querySelector('.desktop-app-header')!;
        return columns.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
      })
    )
    .toBeGreaterThanOrEqual(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const columns = document.getElementById('mobile-board-columns')!;
        const header = document.querySelector('.desktop-app-header')!;
        return columns.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
      })
    )
    .toBeLessThanOrEqual(2);
});

for (const width of [390, 430]) {
  for (const textSize of [16, 20]) {
    test(`Board navigation clears the toolbar at ${width}px with ${textSize}px text`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/');
      await page.addStyleTag({ content: `:root { font-size: ${textSize}px !important; }` });
      const columns = page.locator('#mobile-board-columns');
      await expect(columns).toBeVisible();
      const geometry = await page.evaluate(() => {
        const header = document.querySelector('.desktop-app-header')!;
        return {
          width: innerWidth,
          position: getComputedStyle(header).position,
          height: header.getBoundingClientRect().height,
        };
      });
      expect(geometry.width).toBe(width);
      expect(geometry.position).toBe('sticky');
      expect(geometry.height).toBeGreaterThan(40);
      await page.getByRole('button', { name: 'Mobile board', exact: true }).click();
      await expect
        .poll(() =>
          page
            .locator('.desktop-app-header')
            .evaluate((header) => header.getBoundingClientRect().top)
        )
        .toBe(0);
      const gap = () =>
        page.evaluate(() => {
          const board = document.getElementById('mobile-board-columns')!;
          const header = document.querySelector('.desktop-app-header')!;
          return board.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
        });
      await expect.poll(gap).toBeGreaterThanOrEqual(0);
      await expect.poll(gap).toBeLessThanOrEqual(2);
      await testInfo.attach('mobile-board-position', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      await page.getByRole('button', { name: 'Mobile home', exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      await page.getByRole('button', { name: 'Mobile board', exact: true }).click();
      await expect.poll(gap).toBeGreaterThanOrEqual(0);
      await expect.poll(gap).toBeLessThanOrEqual(2);
    });
  }
}

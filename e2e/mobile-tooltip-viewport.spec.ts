import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask } from './helpers/auth';

declare global {
  interface Window {
    tooltipViewportProbe: { frame: number; widths: number[] };
  }
}

test.use({ viewport: { width: 320, height: 844 }, isMobile: true, hasTouch: true });
test.beforeEach(async ({ page }) => bypassAuth(page));
test.afterEach(async ({ page }) => {
  await page.evaluate(() => cancelAnimationFrame(window.tooltipViewportProbe?.frame));
  await cleanupRoutes(page);
});

for (const width of [320, 430]) {
  for (const textSize of [16, 20]) {
    test(`delayed task tooltip preserves ${width}px viewport at ${textSize}px text`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      const title = `Tooltip viewport ${width} ${textSize}`;
      const task = await seedTestTask(page, {
        title,
        type: 'code',
        ...(width === 320 && textSize === 20
          ? { description: `Evidence reference: ${'0123456789abcdef'.repeat(8)}` }
          : {}),
      });
      try {
        await page.goto('/');
        await page.addStyleTag({ content: `:root { font-size: ${textSize}px !important; }` });
        const status = page.getByRole('combobox', {
          name: `Change status for ${title}`,
          exact: true,
        });
        await expect(status).toBeVisible();
        await status.evaluate((el) => {
          const bar = document
            .querySelector('[data-mobile-navigation-surface]')!
            .getBoundingClientRect();
          scrollBy(0, el.getBoundingClientRect().bottom - bar.top + 16);
        });
        await page.evaluate(() => {
          const probe = { frame: 0, widths: [] as number[] };
          window.tooltipViewportProbe = probe;
          const sample = () => {
            probe.widths.push(innerWidth);
            probe.frame = requestAnimationFrame(sample);
          };
          sample();
        });
        await status.hover();
        // Fast local interactions otherwise finish before the card's delayed tooltip opens.
        const tooltip = page.getByRole('tooltip').filter({ hasText: title });
        await expect(tooltip).toBeVisible();
        expect(await page.evaluate(() => innerWidth)).toBe(width);
        const box = (await tooltip.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(await tooltip.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
        await testInfo.attach('delayed-tooltip', {
          body: await page.screenshot({ path: testInfo.outputPath('delayed-tooltip.png') }),
          contentType: 'image/png',
        });
        await status.click();
        await expect(page.getByRole('option', { name: 'Blocked', exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Open chat', exact: true }).click();
        await expect(
          page.getByRole('textbox', { name: 'Message Board Chat', exact: true })
        ).toBeVisible();
        await page.getByRole('button', { name: 'Close Board Chat panel', exact: true }).click();
        expect(await page.evaluate(() => innerWidth)).toBe(width);
        const widths = await page.evaluate(() => {
          cancelAnimationFrame(window.tooltipViewportProbe.frame);
          return window.tooltipViewportProbe.widths;
        });
        expect(widths.length).toBeGreaterThan(5);
        expect(Math.min(...widths)).toBe(width);
        expect(Math.max(...widths)).toBe(width);
      } finally {
        await deleteTask(page, task.id as string);
      }
    });
  }
}

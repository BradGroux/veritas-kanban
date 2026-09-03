import { test, expect } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

test('desktop vocabulary renders readable states at normal and increased text sizes', async ({
  page,
}, testInfo) => {
  await bypassAuth(page);
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto('/?ui-gallery=1');
  const gallery = page.locator('[data-ui-vocabulary-gallery]');
  await expect(gallery).toBeVisible();
  for (const scheme of ['light', 'dark']) {
    for (const fontSize of [16, 20]) {
      await page.evaluate(
        ({ scheme, fontSize }) => {
          document.documentElement.classList.toggle('dark', scheme === 'dark');
          document.documentElement.dataset.mantineColorScheme = scheme;
          document.documentElement.style.fontSize = `${fontSize}px`;
        },
        { scheme, fontSize }
      );
      const metrics = await gallery
        .locator('[data-ui-action], [data-ui-pill]')
        .evaluateAll((elements) =>
          elements.map((el) => {
            const rect = el.getBoundingClientRect();
            const label = el.querySelector('.mantine-Button-label, .mantine-Badge-label');
            return {
              action: el.hasAttribute('data-ui-action'),
              height: rect.height,
              width: rect.width,
              clipped: label
                ? label.scrollWidth > label.clientWidth + 1 ||
                  label.scrollHeight > label.clientHeight + 1
                : false,
            };
          })
        );
      for (const metric of metrics) {
        expect(metric.height).toBeGreaterThanOrEqual(
          ((metric.action ? 34 : 22) * fontSize) / 16 - 1
        );
        expect(metric.clipped).toBe(false);
      }
      const contrasts = await gallery
        .locator('[data-ui-pill], [data-ui-action]:not(:disabled):not([data-disabled])')
        .evaluateAll((elements) => {
          const luminance = (rgb: string) => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d')!;
            context.fillStyle = rgb;
            context.fillRect(0, 0, 1, 1);
            const channels = Array.from(context.getImageData(0, 0, 1, 1).data)
              .slice(0, 3)
              .map((c) => {
                const v = c / 255;
                return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
              });
            return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
          };
          return elements.map((element) => {
            const style = getComputedStyle(element);
            let background = style.backgroundColor;
            let parent = element.parentElement;
            while (background === 'rgba(0, 0, 0, 0)' && parent) {
              background = getComputedStyle(parent).backgroundColor;
              parent = parent.parentElement;
            }
            const levels = [luminance(style.color), luminance(background)].sort((a, b) => b - a);
            return {
              label: element.textContent || element.getAttribute('aria-label'),
              foreground: style.color,
              background,
              ratio: (levels[0] + 0.05) / (levels[1] + 0.05),
            };
          });
        });
      for (const contrast of contrasts)
        expect(contrast.ratio, JSON.stringify({ scheme, ...contrast })).toBeGreaterThanOrEqual(4.5);
      const inlineIcon = gallery.getByRole('button', { name: 'Inline icon' }).locator('svg');
      expect(await inlineIcon.evaluate((el) => getComputedStyle(el).marginInlineEnd)).toBe(
        `${(6 * fontSize) / 16}px`
      );
      await gallery.getByRole('button', { name: 'Primary', exact: true }).focus();
      await expect(gallery.getByRole('button', { name: 'Primary', exact: true })).toBeFocused();
      await expect(gallery.getByRole('button', { name: 'Disabled', exact: true })).toBeDisabled();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      );
      expect(overflow).toBe(false);
      await testInfo.attach(`ui-vocabulary-${scheme}-${fontSize}.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    }
  }
  await cleanupRoutes(page);
});

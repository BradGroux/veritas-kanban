import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

test('Settings fields share edges regardless of units or control type', async ({
  page,
}, testInfo) => {
  await bypassAuth(page);
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.locator('.settings-dialog-content');
  await settings.getByRole('tab', { name: 'Tasks', exact: true }).click();
  const names = [
    'Max File Size',
    'Max Files Per Task',
    'Max Total Size',
    'Auto-save Delay',
    'Default Priority',
  ];
  for (const theme of ['light', 'dark']) {
    for (const fontSize of [16, 20]) {
      await page.evaluate(
        ({ theme, fontSize }) => {
          document.documentElement.style.fontSize = `${fontSize}px`;
          document.documentElement.dataset.mantineColorScheme = theme;
          document.documentElement.classList.toggle('dark', theme === 'dark');
        },
        { theme, fontSize }
      );
      const boxes = [];
      for (const name of names) {
        const field = settings.getByLabel(name, { exact: true });
        await expect(field).toBeVisible();
        boxes.push(await field.boundingBox());
      }
      for (const box of boxes) {
        expect(Math.abs(box!.x - boxes[0]!.x)).toBeLessThan(2);
        expect(Math.abs(box!.width - boxes[0]!.width)).toBeLessThan(2);
        expect(Math.abs(box!.height - boxes[0]!.height)).toBeLessThan(2);
      }
      await settings.getByLabel('Default Priority', { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`settings-${theme}-${fontSize}.png`) });
    }
  }
  await expect(settings.getByLabel('Max File Size', { exact: true })).toHaveValue('10 MB');
  await settings.getByLabel('Default Priority', { exact: true }).click();
  await expect(page.getByRole('option', { name: 'Critical', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 620, height: 650 });
  const compactWidths = await Promise.all(
    names.map(
      async (name) => (await settings.getByLabel(name, { exact: true }).boundingBox())!.width
    )
  );
  expect(Math.max(...compactWidths) - Math.min(...compactWidths)).toBeLessThan(2);
  await cleanupRoutes(page);
});

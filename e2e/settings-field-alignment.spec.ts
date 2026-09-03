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
  await expect(settings.getByLabel('Default Priority', { exact: true })).toBeFocused();
  await expect(settings).toBeVisible();
  await settings.getByLabel('Default Priority', { exact: true }).click();
  await page.getByRole('option', { name: 'High', exact: true }).click();
  await expect(settings.getByLabel('Default Priority', { exact: true })).toHaveValue('High');
  await page.setViewportSize({ width: 620, height: 650 });
  const compactWidths = await Promise.all(
    names.map(
      async (name) => (await settings.getByLabel(name, { exact: true }).boundingBox())!.width
    )
  );
  expect(Math.max(...compactWidths) - Math.min(...compactWidths)).toBeLessThan(2);
  await page.setViewportSize({ width: 1180, height: 760 });
  await settings.getByRole('tab', { name: 'Board', exact: true }).click();
  const density = settings.getByLabel('Card Density', { exact: true });
  const status = settings.getByLabel('Default task status', { exact: true });
  expect((await density.boundingBox())!.width).toBe((await status.boundingBox())!.width);
  await density.click();
  await page.getByRole('option', { name: 'Compact', exact: true }).click();
  await expect(density).toHaveValue('Compact');

  await settings.getByRole('tab', { name: 'Data', exact: true }).click();
  for (const name of ['Budget Tracking', 'Default Run Budget']) {
    const toggle = settings.getByRole('switch', { name, exact: true });
    if (!(await toggle.isChecked())) {
      await toggle.focus();
      await page.keyboard.press('Space');
      await expect(toggle).toBeChecked();
    }
  }
  const branches = settings.getByLabel('Fan-out Limit', { exact: true });
  await expect(branches).toBeVisible();
  await branches.fill('100');
  await branches.blur();
  await expect(branches).toHaveValue('100 branches');
  const clearance = await branches.evaluate((el) => {
    const input = el as HTMLInputElement;
    const style = getComputedStyle(input);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    context.font = style.font;
    return (
      input.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight) -
      context.measureText(input.value).width
    );
  });
  expect(clearance).toBeGreaterThan(8);
  const action = settings.getByLabel('Hard Threshold Action', { exact: true });
  expect((await branches.boundingBox())!.width).toBe((await action.boundingBox())!.width);
  await branches.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('settings-long-unit.png') });
  await cleanupRoutes(page);
});

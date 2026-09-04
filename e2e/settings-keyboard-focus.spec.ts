import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

test.afterEach(async ({ page }) => cleanupRoutes(page));

test('Settings retains keyboard focus while switching sections and resizing', async ({ page }) => {
  await bypassAuth(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const opener = page.getByRole('button', { name: 'Settings', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByRole('tab', { name: 'Board', exact: true }).click();
  await expect(dialog.getByLabel('Select settings section')).toHaveCount(0);
  const close = dialog.getByRole('button', { name: 'Close settings', exact: true });
  await close.focus();
  for (let step = 0; step < 12; step++) {
    await page.keyboard.press('Tab');
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
      `Tab ${step + 1}`
    ).toBe(true);
  }
  await expect(dialog.getByLabel('Card Density', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.click();
  await page.setViewportSize({ width: 620, height: 650 });
  await expect(dialog.getByRole('tablist')).toHaveCount(0);
  await expect(dialog.getByLabel('Select settings section')).toHaveValue('Board');
  await expect(dialog.getByRole('tabpanel', { name: 'Board', exact: true })).toBeVisible();
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await close.focus();
  for (let step = 0; step < 8; step++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Settings actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Import Settings', exact: true }).click();
  expect((await chooser).isMultiple()).toBe(false);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(dialog.getByRole('tab', { name: 'Board', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(dialog.getByLabel('Select settings section')).toHaveCount(0);
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // Toolbar opener replacement on resize is tracked independently in #1445.
});

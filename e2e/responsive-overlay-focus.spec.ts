import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';
import { installSettingsPopoutFixtures } from './helpers/settings-popout-fixtures';

test.afterEach(async ({ page }) => cleanupRoutes(page));

test.beforeEach(async ({ page }) => {
  await bypassAuth(page);
  await installSettingsPopoutFixtures(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
});

test('Settings returns focus to its remounted desktop opener after resizing', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Settings', exact: true });
  await opener.click();
  const settings = page.locator('.settings-dialog-content');
  await expect(settings).toBeVisible();
  await page.setViewportSize({ width: 620, height: 650 });
  await expect(opener).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(opener).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(opener).toBeFocused();
});

test('Settings compact dismissal uses visible Search after nested dismissal', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.locator('.settings-dialog-content');
  const reset = settings.getByRole('button', { name: 'Reset All', exact: true });
  await reset.click();
  const confirmation = page.getByRole('dialog', { name: 'Reset all settings?', exact: true });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation).toBeHidden();
  await expect(reset).toBeFocused();
  await page.setViewportSize({ width: 620, height: 650 });
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeFocused();
});

for (const finishCompact of [true, false]) {
  test(`New Task returns to its current ${finishCompact ? 'compact' : 'desktop'} action`, async ({
    page,
  }) => {
    const opener = page.getByRole('button', { name: 'New Task', exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Create New Task', exact: true });
    await expect(dialog).toBeVisible();
    await page.setViewportSize({ width: 620, height: 650 });
    await expect(opener).toHaveAttribute('aria-label', 'New Task');
    if (!finishCompact) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await expect(opener).toHaveAttribute('data-size', 'sm');
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
}

test('palette handoff after compact resize keeps focus inside Settings', async ({ page }) => {
  await page.getByRole('button', { name: 'Command palette', exact: true }).click();
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  await page.setViewportSize({ width: 620, height: 650 });
  const input = palette.getByRole('textbox', { name: 'Search commands' });
  await input.fill('Settings');
  await input.press('Enter');
  const settings = page.locator('.settings-dialog-content');
  await expect(settings).toBeVisible();
  await expect
    .poll(() => settings.evaluate((el) => el.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeFocused();
});

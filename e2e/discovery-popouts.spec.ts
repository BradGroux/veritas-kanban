import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';
import { exerciseDiscoveryPopouts, installDiscoveryFixtures } from './helpers/discovery-popouts';

test.afterEach(async ({ page }) => cleanupRoutes(page));
test('reopening an animated palette cancels its previous command', async ({ page }) => {
  await bypassAuth(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const opener = page.getByRole('button', { name: /Command palette/ });
  await opener.click();
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  const input = palette.getByRole('textbox', { name: 'Search commands' });
  await input.fill('New Task');
  await input.press('Enter');
  await page.keyboard.press('Control+k');
  await expect(input).toBeFocused();
  await input.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(page.getByRole('dialog', { name: 'Create New Task', exact: true })).toBeHidden();
  await expect(opener).toBeFocused();
});
for (const theme of ['light', 'dark']) {
  test(`discovery popouts preserve geometry and keyboard handoffs in ${theme}`, async ({
    page,
  }, info) => {
    test.setTimeout(90_000);
    await bypassAuth(page);
    await page.addInitScript((theme) => {
      localStorage.setItem('veritas-kanban-theme', theme);
      Object.defineProperty(window, 'veritasDesktop', {
        configurable: true,
        value: { onMenuCommand: () => () => undefined },
      });
    }, theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const writes = await installDiscoveryFixtures(page);
    for (const [width, height, font] of [
      [1700, 900, 16],
      [1180, 760, 20],
      [900, 480, 20],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await page.evaluate((font) => (document.documentElement.style.fontSize = `${font}px`), font);
      await exerciseDiscoveryPopouts(page, async (name) => {
        await page.screenshot({ path: info.outputPath(`${name}-${width}.png`) });
      });
    }
    expect(writes).toEqual([]);
  });
}

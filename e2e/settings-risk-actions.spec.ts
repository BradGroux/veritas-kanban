import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';
import { installSettingsPopoutFixtures } from './helpers/settings-popout-fixtures';

test.afterEach(async ({ page }) => cleanupRoutes(page));

for (const theme of ['light', 'dark']) {
  test(`Skill-risk actions retain intact labels in ${theme}`, async ({ page }, testInfo) => {
    await bypassAuth(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript((theme) => {
      localStorage.setItem('veritas-kanban-theme', theme);
      Object.defineProperty(window, 'veritasDesktop', {
        configurable: true,
        value: { onMenuCommand: () => () => undefined },
      });
    }, theme);
    let mutations = 0;
    await page.route('**/api/**', async (route) => {
      if (!['GET', 'HEAD'].includes(route.request().method())) {
        mutations++;
        await route.abort();
      } else await route.fallback();
    });
    await installSettingsPopoutFixtures(page);
    await page.goto('/');
    const opener = page.getByRole('button', { name: 'Settings', exact: true });
    const settings = page.locator('.settings-dialog-content');
    const row = settings.getByRole('row').filter({ hasText: 'Fixture skill' });
    for (const viewport of [
      { width: 1700, height: 900, font: 16 },
      { width: 1180, height: 760, font: 20 },
      { width: 900, height: 480, font: 20 },
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate((font) => {
        document.documentElement.style.fontSize = `${font}px`;
      }, viewport.font);
      await opener.click();
      await settings.getByRole('tab', { name: 'Shared Resources', exact: true }).click();
      for (const name of ['Task', 'Exception']) {
        const action = row.getByRole('button', { name, exact: true });
        await action.scrollIntoViewIfNeeded();
        await expect(action).toBeInViewport({ ratio: 1 });
        const label = action.locator('.mantine-Button-label');
        expect(
          await label.evaluate((el) => {
            const range = document.createRange();
            range.selectNodeContents(el);
            return (
              range.getBoundingClientRect().height <=
              parseFloat(getComputedStyle(el).lineHeight) + 1
            );
          })
        ).toBe(true);
        expect(await action.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      }
      expect(await settings.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      const trigger = row.getByRole('button', { name: 'Exception', exact: true });
      await trigger.focus();
      await trigger.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Exception for Fixture skill', exact: true });
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      await page.screenshot({
        path: testInfo.outputPath(`risk-actions-${viewport.width}.png`),
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
      await expect(settings).toBeHidden();
      await expect(opener).toBeFocused();
    }
    expect(mutations).toBe(0);
  });
}

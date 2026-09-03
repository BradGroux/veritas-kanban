import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

test('Settings destinations preserve navigation and readable controls across themes and text sizes', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await bypassAuth(page);
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.locator('.settings-dialog-content');
  const tabs = settings.getByRole('tab');
  await expect(tabs).toHaveCount(20);
  const names = await tabs.allTextContents();

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
      for (const name of names) {
        const tab = tabs.filter({ hasText: new RegExp(`^${name}$`) });
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await expect(settings.locator('[data-settings-page]')).toBeVisible();
        const clipped = await settings
          .locator('.mantine-Button-label, .vk-ui-pill .mantine-Badge-label')
          .evaluateAll((elements) =>
            elements
              .filter(
                (el) =>
                  el.clientWidth > 0 &&
                  (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2)
              )
              .map((el) => el.textContent)
          );
        expect(clipped, `${name}, ${scheme}, ${fontSize}px`).toEqual([]);
        if (name === 'Manage') {
          const rows = settings.locator('[data-settings-sortable-row]');
          await expect(rows.first()).toBeVisible();
          const displays = await rows.evaluateAll((elements) =>
            elements.map((el) => getComputedStyle(el).display)
          );
          expect(displays.every((display) => display === 'flex')).toBe(true);
        }
      }
    }
  }
  await expect(tabs.filter({ hasText: /advanced/i })).toHaveCount(0);
  await tabs.first().click();
  await tabs.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(tabs.nth(2)).toBeFocused();
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');

  // Below the native minimum, exercise the compact web/diagnostic layout too.
  await page.setViewportSize({ width: 620, height: 650 });
  await expect(settings.getByRole('combobox', { name: 'Select settings section' })).toBeVisible();
  await settings.getByRole('button', { name: 'Settings actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Export Settings' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Import Settings' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Reset All' })).toBeVisible();
  await page.keyboard.press('Escape');
  await cleanupRoutes(page);
});

import { expect, test, type Locator } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';
import { installSettingsPopoutFixtures } from './helpers/settings-popout-fixtures';

test.afterEach(async ({ page }) => cleanupRoutes(page));

for (const theme of ['light', 'dark']) {
  test(`Settings nested popouts preserve geometry and focus in ${theme}`, async ({ page }) => {
    test.setTimeout(60_000);
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
      } else {
        await route.fallback();
      }
    });
    await installSettingsPopoutFixtures(page);
    await page.goto('/');
    const opener = page.getByRole('button', { name: 'Settings', exact: true });
    const settings = page.locator('.settings-dialog-content');
    const settingsRoot = page.locator('[data-overlay-variant]').filter({ has: settings });

    for (const viewport of [
      { width: 1180, height: 760, font: 16 },
      { width: 900, height: 480, font: 20 },
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate((font) => {
        document.documentElement.style.fontSize = `${font}px`;
      }, viewport.font);
      await opener.click();
      await expect(settings).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', theme);
      await expect(settingsRoot).toHaveAttribute('data-overlay-variant', 'authoring');
      const inBounds = async (target: Locator) => {
        const box = await target.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
        expect(await target.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      };
      await inBounds(settings);
      await expect(settings.locator('[data-settings-content-scroll]')).toHaveCSS(
        'padding',
        `${viewport.font}px`
      );

      const child = async (
        trigger: Locator,
        title: string,
        first: 'Cancel' | 'Close' | 'Role Name' | 'Allowed Tools' | 'Owner'
      ) => {
        await trigger.click();
        const dialog = page.getByRole('dialog', { name: title, exact: true });
        await expect(dialog).toBeVisible();
        await expect(settingsRoot).toHaveAttribute('inert', '');
        const initial =
          first === 'Cancel' || first === 'Close'
            ? dialog.getByRole('button', { name: first, exact: true })
            : dialog.getByRole('textbox', { name: first, exact: true });
        await expect(initial).toBeFocused();
        await expect(initial).toBeInViewport({ ratio: 1 });
        await inBounds(dialog);
        await inBounds(dialog.locator('.vk-overlay-footer'));
        await page.keyboard.press('Tab');
        expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(settingsRoot).not.toHaveAttribute('inert');
        await expect(trigger).toBeFocused();
      };

      await child(
        settings.getByRole('button', { name: 'Reset All', exact: true }),
        'Reset all settings?',
        'Cancel'
      );
      await settings.getByRole('tab', { name: 'General', exact: true }).click();
      await child(
        settings.getByRole('button', { name: 'Remove Fixture repository', exact: true }),
        'Remove repository?',
        'Cancel'
      );
      await settings.getByRole('tab', { name: 'Tasks', exact: true }).click();
      await child(
        settings.getByRole('button', { name: 'Reset', exact: true }).first(),
        'Reset to defaults?',
        'Cancel'
      );
      await settings.getByRole('tab', { name: 'Tool Policies', exact: true }).click();
      await child(
        settings.getByRole('button', { name: 'New Policy', exact: true }),
        'Create Tool Policy',
        'Role Name'
      );
      await child(
        settings.getByRole('button', { name: 'Edit custom', exact: true }),
        'Edit Policy: custom',
        'Allowed Tools'
      );
      await settings.getByRole('tab', { name: 'Security', exact: true }).click();
      await child(
        settings.getByRole('button', { name: 'Reset All Security', exact: true }),
        'Reset all security settings?',
        'Cancel'
      );
      await settings.getByRole('tab', { name: 'Agents', exact: true }).click();
      await child(
        settings.getByRole('button', { name: 'Remove Fixture Agent', exact: true }),
        'Remove agent?',
        'Cancel'
      );
      await settings.getByRole('tab', { name: 'Manage', exact: true }).click();
      await child(
        settings.getByRole('button', { name: 'Delete Fixture Type', exact: true }),
        'Delete Item?',
        'Cancel'
      );
      await child(
        settings.getByRole('button', { name: 'Delete Fixture Template', exact: true }),
        'Delete template?',
        'Cancel'
      );
      await settings.getByRole('tab', { name: 'Maintenance', exact: true }).click();
      await child(
        settings.getByRole('button', { name: 'Review Cleanup', exact: true }),
        'Review cleanup',
        'Close'
      );
      await settings.getByRole('tab', { name: 'Shared Resources', exact: true }).click();
      await child(
        settings.getByRole('button', { name: 'Exception', exact: true }),
        'Exception for Fixture skill',
        'Owner'
      );
      await page.keyboard.press('Escape');
      await expect(settings).toBeHidden();
      await expect(opener).toBeFocused();
      expect(
        await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)
      ).toBe(true);
    }
    expect(mutations).toBe(0);
  });
}

import { expect, test } from '@playwright/test';
import { DEFAULT_FEATURE_SETTINGS } from '../shared/dist/index.js';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

for (const theme of ['light', 'dark']) {
  test(`long sprint names and archive actions stay inside the Board in ${theme}`, async ({
    page,
  }) => {
    await bypassAuth(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript((theme) => {
      localStorage.setItem('veritas-kanban-theme', theme);
      Object.defineProperty(window, 'veritasDesktop', {
        configurable: true,
        value: { onMenuCommand: () => () => undefined },
      });
    }, theme);
    const sprint = 'LongSprintName'.repeat(8);
    await page.route('**/api/settings/features', (route) =>
      route.fulfill({
        json: {
          ...DEFAULT_FEATURE_SETTINGS,
          board: { ...DEFAULT_FEATURE_SETTINGS.board, showArchiveSuggestions: true },
        },
      })
    );
    await page.route('**/api/tasks/archive/suggestions', (route) =>
      route.fulfill({ json: [{ sprint, taskCount: 3 }] })
    );
    await page.route(/\/api\/tasks(?:\?.*)?$/, (route) => route.fulfill({ json: [] }));
    let archiveRequests = 0;
    await page.route('**/api/tasks/archive/sprint/**', (route) => {
      archiveRequests += 1;
      return route.abort();
    });
    await page.goto('/');
    for (const size of [
      { width: 1180, height: 760, font: '16px' },
      { width: 1180, height: 760, font: '20px' },
      { width: 620, height: 760, font: '20px' },
    ]) {
      await page.setViewportSize(size);
      await page.evaluate((font) => {
        document.documentElement.style.fontSize = font;
      }, size.font);
      const dismiss = page.getByRole('button', {
        name: `Dismiss archive suggestion for ${sprint}`,
      });
      const banner = dismiss.locator('../..');
      await expect(banner).toBeVisible();
      expect(await banner.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      const title = banner.getByText(`Sprint "${sprint}" is complete!`, { exact: true });
      expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      const archive = banner.getByRole('button', { name: 'Archive Sprint', exact: true });
      await expect(archive).toBeInViewport({ ratio: 1 });
      await expect(dismiss).toBeInViewport({ ratio: 1 });
      const before = await banner.boundingBox();
      await archive.click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(archive).toBeFocused();
      const after = await banner.boundingBox();
      expect(after!.x).toBe(before!.x);
    }
    await page.getByRole('button', { name: `Dismiss archive suggestion for ${sprint}` }).click();
    await expect(page.getByText(`Sprint "${sprint}" is complete!`, { exact: true })).toBeHidden();
    expect(archiveRequests).toBe(0);
    await cleanupRoutes(page);
  });
}

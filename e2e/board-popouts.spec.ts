import { expect, test } from '@playwright/test';
import { DEFAULT_FEATURE_SETTINGS } from '../shared/dist/index.js';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

for (const theme of ['light', 'dark']) {
  test(`Board popouts keep their footer and focus at constrained sizes in ${theme}`, async ({
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
    const savedView = {
      id: 'popout-fixture',
      name: 'LongSavedView'.repeat(6),
      filters: { search: '', project: null, type: null, agent: null },
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    };
    await page.route('**/api/settings/features', (route) =>
      route.fulfill({
        json: {
          ...DEFAULT_FEATURE_SETTINGS,
          board: {
            ...DEFAULT_FEATURE_SETTINGS.board,
            savedViews: [savedView],
            showArchiveSuggestions: true,
          },
        },
      })
    );
    await page.route('**/api/tasks/archive/suggestions', (route) =>
      route.fulfill({ json: [{ sprint: 'LongSprintName'.repeat(8), taskCount: 3 }] })
    );
    await page.route(/\/api\/tasks(?:\?.*)?$/, (route) =>
      route.fulfill({
        json: [
          {
            id: 'popout-task',
            title: 'Synthetic board task',
            description: '',
            type: 'code',
            status: 'todo',
            priority: 'medium',
            created: '2026-09-01T00:00:00Z',
            updated: '2026-09-01T00:00:00Z',
          },
        ],
      })
    );
    let destructiveRequests = 0;
    await page.route('**/api/tasks/archive/sprint/**', (route) => {
      destructiveRequests += 1;
      return route.abort();
    });
    await page.route('**/api/tasks/popout-task', (route) => {
      destructiveRequests += 1;
      return route.abort();
    });
    await page.goto('/');
    for (const size of [
      { width: 1180, height: 760, font: '16px' },
      { width: 900, height: 480, font: '20px' },
    ]) {
      await page.setViewportSize(size);
      await page.evaluate((font) => {
        document.documentElement.style.fontSize = font;
      }, size.font);
      for (const name of [
        'Save view',
        'Rename saved view',
        'Delete saved view',
        'Archive Sprint',
        'Delete',
      ]) {
        if (name === 'Delete') {
          await page.getByRole('button', { name: 'Select', exact: true }).click();
          await page.getByRole('button', { name: 'Select all tasks', exact: true }).click();
        }
        const opener = page.getByRole('button', { name, exact: true });
        await opener.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        const initial = ['Save view', 'Rename saved view'].includes(name)
          ? dialog.getByRole('textbox', { name: 'View name' })
          : dialog.getByRole('button', { name: 'Cancel', exact: true });
        await expect(initial).toBeFocused();
        const box = await dialog.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1);
        expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 1);
        await expect(dialog.locator('.vk-overlay-footer')).toBeInViewport({ ratio: 1 });
        expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
        await initial.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(opener).toBeFocused();
        if (name === 'Delete')
          await page.getByRole('button', { name: 'Exit selection mode' }).click();
      }
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(size.height);
    }
    expect(destructiveRequests).toBe(0);
    await cleanupRoutes(page);
  });
}

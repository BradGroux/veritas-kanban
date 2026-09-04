import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

for (const theme of ['light', 'dark']) {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`workflow start preserves context in ${theme}, motion ${reducedMotion}`, async ({
      page,
    }) => {
      await bypassAuth(page);
      await page.emulateMedia({ reducedMotion });
      await page.addInitScript(
        (theme) => localStorage.setItem('veritas-kanban-theme', theme),
        theme
      );
      const workflow = {
        id: 'start-fixture',
        name: 'Start fixture',
        version: 1,
        description: 'Fixture only',
        agents: [],
        steps: [],
        variables: { releaseChannel: 'stable' },
      };
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const writes: unknown[] = [];
      await page.route(/\/api\/workflows(?:\/|\?|$)/, async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (request.method() !== 'GET') {
          writes.push(request.postDataJSON());
          await gate;
          return route.fulfill({ status: 503, json: { error: 'Fixture start failed' } });
        }
        return route.fulfill({
          json: path.endsWith('/workflows')
            ? [workflow]
            : path.endsWith('/start-fixture')
              ? workflow
              : [],
        });
      });
      try {
        await page.setViewportSize({ width: 1700, height: 900 });
        await page.goto('/workflows');
        const opener = page
          .getByRole('button', { name: 'Start Run', exact: true })
          .and(page.getByTitle('Start run', { exact: true }));
        await opener.press('Enter');
        const dialog = page.getByRole('dialog', { name: 'Start Start fixture', exact: true });
        await expect(dialog).toBeVisible();
        await dialog.getByLabel('Task ID', { exact: true }).fill('task_fixture');
        const context = JSON.stringify(
          {
            note: 'Retain this context',
            targets: Array.from({ length: 20 }, (_, i) => `Target ${i}`),
          },
          null,
          2
        );
        await dialog.getByLabel('Run context', { exact: true }).fill(context);
        for (const size of [
          { width: 1700, height: 900, fontSize: '16px' },
          { width: 1180, height: 760, fontSize: '20px' },
          { width: 900, height: 480, fontSize: '20px' },
        ]) {
          await page.setViewportSize(size);
          await page.evaluate((fontSize) => {
            document.documentElement.style.fontSize = fontSize;
          }, size.fontSize);
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
              )
          );
          const close = dialog.getByRole('button', { name: 'Close dialog' });
          await expect(close).toHaveCSS('width', size.fontSize === '20px' ? '42.5px' : '34px');
          await dialog.evaluate(async (el) => {
            await Promise.all(
              el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {}))
            );
          });
          const footer = dialog.locator('.vk-overlay-footer');
          const before = await footer.boundingBox();
          await dialog.locator('.vk-overlay-scroll').evaluate((el) => {
            el.scrollTop = el.scrollHeight;
          });
          expect(await footer.boundingBox()).toEqual(before);
          for (const name of ['Close dialog', 'Cancel', 'Start Run']) {
            await expect(dialog.getByRole('button', { name, exact: true })).toBeInViewport({
              ratio: 1,
            });
            await dialog.getByRole('button', { name, exact: true }).click({ trial: true });
          }
          expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
        }
        await dialog.getByRole('button', { name: 'Start Run', exact: true }).click();
        await expect.poll(() => writes.length).toBe(1);
        await page.keyboard.press('Escape');
        await page.mouse.click(3, 3);
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeDisabled();
        await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        await expect(dialog.getByLabel('Task ID', { exact: true })).toBeDisabled();
        await expect(dialog.getByLabel('Run context', { exact: true })).toBeDisabled();
        release();
        const error = dialog.getByRole('alert');
        await expect(error).toContainText('Fixture start failed');
        await expect(error).toBeInViewport({ ratio: 1 });
        await expect(error.getByText('Fixture start failed', { exact: true })).toBeInViewport({
          ratio: 1,
        });
        await expect(error).toBeFocused();
        await expect(dialog.getByLabel('Task ID', { exact: true })).toHaveValue('task_fixture');
        await expect(dialog.getByLabel('Run context', { exact: true })).toHaveValue(context);
        await expect(dialog.getByRole('button', { name: 'Start Run', exact: true })).toBeEnabled();
        expect(writes).toEqual([{ taskId: 'task_fixture', context: JSON.parse(context) }]);
        await page.screenshot({ path: test.info().outputPath('workflow-start-failure.png') });
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(opener).toBeFocused();
      } finally {
        release();
        await cleanupRoutes(page).catch(() => {});
      }
    });
  }
}

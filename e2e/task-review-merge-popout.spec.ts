import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask } from './helpers/auth';

for (const theme of ['light', 'dark']) {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`review merge retains pending ownership in ${theme}, motion ${reducedMotion}`, async ({
      page,
    }) => {
      await bypassAuth(page);
      await page.emulateMedia({ reducedMotion });
      await page.addInitScript(
        (theme) => localStorage.setItem('veritas-kanban-theme', theme),
        theme
      );
      const title = `Review merge fixture ${theme} ${reducedMotion}`;
      const task = await seedTestTask(page, {
        title,
        type: 'code',
        git: {
          repo: 'Fixture/repo',
          branch: 'fixture',
          baseBranch: 'main',
          worktreePath: '/tmp/task-overlay-fixture',
        },
      });
      // Review approval and managed ownership exist only in browser reads.
      await page.route(/\/api\/tasks(?:\/[^/?]+)?(?:\?.*)?$/, async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const response = await route.fetch();
        const json = JSON.parse(JSON.stringify(await response.json()), (_key, value) =>
          value && typeof value === 'object' && value.id === task.id
            ? {
                ...value,
                review: { decision: 'approved' },
                git: { ...value.git, worktreeManifestId: 'fixture-manifest' },
              }
            : value
        );
        return route.fulfill({ response, json });
      });
      const writes: Array<{ path: string; body: unknown }> = [];
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(new RegExp(`/api/tasks/${task.id}/worktree(?:/|\\?|$)`), async (route) => {
        const request = route.request();
        if (request.method() === 'GET')
          return route.fulfill({
            json: { hasChanges: false, aheadBehind: { ahead: 1, behind: 0 } },
          });
        writes.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
        await gate;
        return route.fulfill({ status: 503, json: { error: 'Fixture review merge failed' } });
      });
      try {
        await page.setViewportSize({ width: 1700, height: 900 });
        await page.goto('/');
        await page.getByRole('article', { name: `Task: ${title}` }).press('Enter');
        const workspace = page.getByTestId('task-detail-panel');
        await workspace.getByRole('button', { name: 'Results', exact: true }).click();
        await workspace.getByRole('tab', { name: 'Review', exact: true }).click();
        const opener = workspace.getByRole('button', { name: 'Merge & Close Task', exact: true });
        await opener.press('Enter');
        const dialog = page.getByRole('dialog', { name: 'Merge changes to main?' });
        await expect(dialog).toBeVisible();
        await expect(workspace).toHaveAttribute('inert', '');
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
          await expect(dialog.getByRole('button', { name: 'Close dialog' })).toHaveCSS(
            'width',
            size.fontSize === '20px' ? '42.5px' : '34px'
          );
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
          for (const name of ['Close dialog', 'Cancel', 'Merge & Close']) {
            await expect(dialog.getByRole('button', { name, exact: true })).toBeInViewport({
              ratio: 1,
            });
            await dialog.getByRole('button', { name, exact: true }).click({ trial: true });
          }
          expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
        }
        await dialog.getByRole('button', { name: 'Merge & Close' }).click();
        await expect.poll(() => writes.length).toBe(1);
        await page.keyboard.press('Escape');
        await dialog.getByRole('button', { name: 'Close dialog' }).click();
        await page.mouse.click(3, 3);
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        release();
        const error = dialog.getByRole('alert');
        await expect(error).toHaveText('Fixture review merge failed');
        await expect(error).toBeFocused();
        await expect(error).toBeInViewport({ ratio: 1 });
        await expect(dialog.getByRole('button', { name: 'Merge & Close' })).toBeEnabled();
        await dialog.getByRole('button', { name: 'Merge & Close' }).click({ trial: true });
        expect(writes).toEqual([{ path: `/api/tasks/${task.id}/worktree/merge`, body: null }]);
        await page.screenshot({ path: test.info().outputPath('review-merge-failure.png') });
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(opener).toBeFocused();
      } finally {
        release();
        await deleteTask(page, String(task.id)).catch(() => {});
        await cleanupRoutes(page).catch(() => {});
      }
    });
  }
}

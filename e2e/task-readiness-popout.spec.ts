import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask } from './helpers/auth';

for (const theme of ['light', 'dark']) {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`readiness override preserves launch context in ${theme}, motion ${reducedMotion}`, async ({
      page,
    }) => {
      await bypassAuth(page);
      await page.emulateMedia({ reducedMotion });
      await page.addInitScript(
        (theme) => localStorage.setItem('veritas-kanban-theme', theme),
        theme
      );
      const title = `Readiness fixture ${theme} ${reducedMotion}`;
      const task = await seedTestTask(page, {
        title,
        type: 'code',
        description: 'Too short',
        git: {
          repo: 'Fixture/repo',
          branch: 'fixture',
          baseBranch: 'main',
          worktreePath: '/tmp/task-overlay-fixture',
        },
      });
      await page.route('**/api/agents/route', (route) =>
        route.fulfill({
          json: { agent: 'codex', model: 'sonnet', reason: 'Fixture routing only' },
        })
      );
      const writes: Array<{ path: string; body: unknown }> = [];
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(new RegExp(`/api/agents/${task.id}(?:/|\\?|$)`), async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (request.method() !== 'GET') {
          writes.push({ path, body: request.postDataJSON() });
          await gate;
          return route.fulfill({ status: 503, json: { error: 'Fixture launch failed' } });
        }
        if (path.endsWith('/status')) return route.fulfill({ json: { running: false } });
        if (path.endsWith('/attempts')) return route.fulfill({ json: [] });
        return route.fulfill({ json: {} });
      });
      try {
        await page.setViewportSize({ width: 1700, height: 900 });
        await page.goto('/');
        await page.getByRole('article', { name: `Task: ${title}` }).press('Enter');
        const workspace = page.getByTestId('task-detail-panel');
        await workspace.getByRole('button', { name: 'Run', exact: true }).click();
        await workspace.getByRole('tab', { name: 'Agent', exact: true }).click();
        await expect(workspace.locator('[title="Fixture routing only"]')).toBeVisible();
        const opener = workspace.getByRole('button', { name: 'Start', exact: true });
        await opener.press('Enter');
        const dialog = page.getByRole('dialog', { name: 'Start with readiness override?' });
        await expect(dialog).toBeVisible();
        await expect(workspace).toHaveAttribute('inert', '');
        const reason = dialog.getByLabel('Override reason');
        const submit = dialog.getByRole('button', { name: 'Start Anyway' });
        await reason.fill('short');
        await expect(submit).toBeDisabled();
        await reason.fill('  Maintainer reviewed this synthetic task  ');
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
          for (const name of ['Close dialog', 'Cancel', 'Start Anyway']) {
            await expect(dialog.getByRole('button', { name, exact: true })).toBeInViewport({
              ratio: 1,
            });
            await dialog.getByRole('button', { name, exact: true }).click({ trial: true });
          }
          expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
          await reason.scrollIntoViewIfNeeded();
          await expect(reason).toBeInViewport({ ratio: 1 });
        }
        await submit.click();
        await expect.poll(() => writes.length).toBe(1);
        await expect(reason).toBeDisabled();
        await page.keyboard.press('Escape');
        await dialog.getByRole('button', { name: 'Close dialog' }).click();
        await page.mouse.click(3, 3);
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        release();
        const error = dialog.getByRole('alert');
        await expect(error).toHaveText('Fixture launch failed');
        await expect(error).toBeFocused();
        await expect(error).toBeInViewport({ ratio: 1 });
        await expect(reason).toHaveValue('  Maintainer reviewed this synthetic task  ');
        await expect(submit).toBeEnabled();
        await submit.click({ trial: true });
        expect(writes).toEqual([
          {
            path: `/api/agents/${task.id}/start`,
            body: { agent: 'codex', overrideReason: 'Maintainer reviewed this synthetic task' },
          },
        ]);
        await page.screenshot({ path: test.info().outputPath('readiness-failure.png') });
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

import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask, unwrapApiData } from './helpers/auth';

for (const operation of ['start', 'stop'] as const) {
  for (const theme of ['light', 'dark']) {
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      test(`preview ${operation} retains pending ownership in ${theme}, motion ${reducedMotion}`, async ({
        page,
      }) => {
        await bypassAuth(page);
        await page.emulateMedia({ reducedMotion });
        await page.addInitScript(
          (theme) => localStorage.setItem('veritas-kanban-theme', theme),
          theme
        );
        const title = `Preview ${operation} fixture ${theme} ${reducedMotion}`;
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
        await page.route(/\/api\/tasks(?:\/[^/?]+)?(?:\?.*)?$/, async (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          const response = await route.fetch();
          const json = JSON.parse(JSON.stringify(await response.json()), (_key, value) =>
            value && typeof value === 'object' && value.id === task.id
              ? { ...value, git: { ...value.git, worktreeManifestId: 'fixture-manifest' } }
              : value
          );
          return route.fulfill({ response, json });
        });
        await page.route('**/api/config', async (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          const config = unwrapApiData<Record<string, unknown>>(await (await route.fetch()).json());
          return route.fulfill({
            json: {
              ...config,
              repos: [
                { name: 'Fixture/repo', path: '/tmp/task-overlay-fixture', defaultBranch: 'main' },
              ],
            },
          });
        });
        const unexpectedWrites: string[] = [];
        await page.route(`**/api/tasks/${task.id}/worktree`, (route) => {
          if (route.request().method() !== 'GET') {
            unexpectedWrites.push(`${route.request().method()} ${route.request().url()}`);
            return route.fulfill({ status: 405, json: { error: 'Unexpected worktree write' } });
          }
          return route.fulfill({
            json: { hasChanges: false, aheadBehind: { ahead: 1, behind: 0 } },
          });
        });
        await page.route('**/preview-fixture-page', (route) =>
          route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><h1>Preview fixture</h1><p>No development server is running.</p>',
          })
        );
        const writes: Array<{ method: string; path: string; body: unknown }> = [];
        let release = () => {};
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const message = `Fixture preview ${operation} failed. The request can be retried without losing the task.`;
        await page.route(new RegExp(`/api/preview/${task.id}(?:/|\\?|$)`), async (route) => {
          const request = route.request();
          if (request.method() === 'GET')
            return route.fulfill({
              json:
                operation === 'start'
                  ? { status: 'stopped' }
                  : {
                      status: 'running',
                      url: new URL('/preview-fixture-page', request.url()).href,
                      output: [],
                    },
            });
          writes.push({
            method: request.method(),
            path: new URL(request.url()).pathname,
            body: request.postDataJSON(),
          });
          await gate;
          return route.fulfill({ status: 503, json: { error: message } });
        });
        try {
          await page.setViewportSize({ width: 1700, height: 900 });
          await page.goto('/');
          await page.getByRole('article', { name: `Task: ${title}` }).press('Enter');
          const workspace = page.getByTestId('task-detail-panel');
          await workspace.getByRole('button', { name: 'Run', exact: true }).click();
          await workspace.getByRole('tab', { name: /Git/ }).click();
          const opener = workspace.getByRole('button', { name: 'Preview', exact: true });
          await opener.press('Enter');
          const dialog = page.getByRole('dialog', { name: 'Preview', exact: true });
          await expect(workspace).toHaveAttribute('inert', '');
          const submit = dialog.getByRole('button', {
            name: operation === 'start' ? 'Start Preview' : 'Stop preview',
            exact: true,
          });
          await submit.click();
          await expect.poll(() => writes.length).toBe(1);
          await submit.evaluate((el) => (el as HTMLButtonElement).click());
          const controls =
            operation === 'start'
              ? ['Start Preview', 'Close dialog']
              : [
                  'Stop preview',
                  'Refresh preview',
                  'Open preview externally',
                  'Toggle preview output',
                  'Close dialog',
                ];
          for (const phase of ['pending', 'error'] as const) {
            if (phase === 'error') {
              release();
              const error = dialog.getByRole('alert', { name: 'Preview request failed' });
              await expect(error).toContainText(message);
              await expect(error).toBeFocused();
              await expect(error).toBeInViewport({ ratio: 1 });
              await expect(error.getByText(message, { exact: true })).toBeInViewport({ ratio: 1 });
            }
            for (const size of [
              { width: 1700, height: 900, fontSize: '16px' },
              { width: 1180, height: 760, fontSize: '20px' },
              { width: 900, height: 480, fontSize: '20px' },
            ]) {
              await page.setViewportSize(size);
              await page.evaluate((fontSize) => {
                document.documentElement.style.fontSize = fontSize;
              }, size.fontSize);
              await expect(dialog.getByRole('button', { name: 'Close dialog' })).toHaveCSS(
                'width',
                size.fontSize === '20px' ? '42.5px' : '34px'
              );
              await dialog.evaluate(async (el) => {
                await Promise.all(
                  el
                    .getAnimations({ subtree: true })
                    .filter((a) => a.effect?.getTiming().iterations !== Infinity)
                    .map((a) => a.finished.catch(() => {}))
                );
              });
              const before = await submit.boundingBox();
              await dialog.locator('.vk-overlay-scroll').evaluate((el) => {
                el.scrollTop = el.scrollHeight;
              });
              expect(await submit.boundingBox()).toEqual(before);
              for (const name of controls) {
                const control = dialog.getByRole('button', { name, exact: true });
                await expect(control).toBeInViewport({ ratio: 1 });
                if (phase === 'pending') await expect(control).toBeDisabled();
                else {
                  await expect(control).toBeEnabled();
                  await control.click({ trial: true });
                }
              }
              if (phase === 'pending') {
                await page.keyboard.press('Escape');
                await dialog
                  .getByRole('button', { name: 'Close dialog' })
                  .evaluate((el) => (el as HTMLButtonElement).click());
                await page.mouse.click(3, 3);
                await expect(dialog).toBeVisible();
              } else {
                const error = dialog.getByRole('alert', { name: 'Preview request failed' });
                await error.evaluate((el) =>
                  el.scrollIntoView({ block: 'center', behavior: 'instant' })
                );
                await expect(error).toBeInViewport({ ratio: 1 });
                await expect(error.getByText(message, { exact: true })).toBeInViewport({
                  ratio: 1,
                });
              }
              expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
            }
            await page.screenshot({
              path: test.info().outputPath(`preview-${operation}-${phase}.png`),
            });
          }
          expect(writes).toEqual([
            { method: 'POST', path: `/api/preview/${task.id}/${operation}`, body: null },
          ]);
          await page.keyboard.press('Escape');
          await expect(dialog).toHaveCount(0);
          await expect(opener).toBeFocused();
          expect(unexpectedWrites).toEqual([]);
        } finally {
          release();
          await cleanupRoutes(page).catch(() => {});
          await deleteTask(page, String(task.id)).catch(() => {});
        }
      });
    }
  }
}

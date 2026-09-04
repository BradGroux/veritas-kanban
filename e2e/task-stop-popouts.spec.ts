import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask } from './helpers/auth';

for (const family of [
  { name: 'overview', dialog: 'Stop the active run?', opener: 'Stop active run' },
  { name: 'agent', dialog: 'Stop the agent?', opener: 'Stop agent' },
]) {
  for (const theme of ['light', 'dark']) {
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      test(`${family.name} stop stays pending in ${theme}, motion ${reducedMotion}`, async ({
        page,
      }) => {
        await bypassAuth(page);
        await page.emulateMedia({ reducedMotion });
        await page.addInitScript(
          (theme) => localStorage.setItem('veritas-kanban-theme', theme),
          theme
        );
        const title = `Stop fixture ${family.name} ${theme} ${reducedMotion}`;
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
            return route.fulfill({ status: 503, json: { error: 'Fixture stop failed' } });
          }
          if (path.endsWith('/status'))
            return route.fulfill({
              json: {
                running: true,
                attemptId: 'attempt-fixture',
                controls: {
                  controls: [
                    {
                      action: 'stop',
                      capabilityId: 'run.stop',
                      state: 'supported',
                      available: true,
                      advisory: false,
                      reason: 'Fixture capability only',
                    },
                  ],
                },
              },
            });
          if (path.endsWith('/attempts')) return route.fulfill({ json: [] });
          return route.fulfill({ json: {} });
        });
        try {
          await page.setViewportSize({ width: 1700, height: 900 });
          await page.goto('/');
          await page.getByRole('article', { name: `Task: ${title}` }).press('Enter');
          const workspace = page.getByTestId('task-detail-panel');
          if (family.name === 'agent') {
            await workspace.getByRole('button', { name: 'Run', exact: true }).click();
            await workspace.getByRole('tab', { name: 'Agent', exact: true }).click();
          } else {
            await workspace.getByRole('button', { name: 'Overview', exact: true }).click();
          }
          const opener = workspace.getByRole('button', { name: family.opener, exact: true });
          await opener.press('Enter');
          const dialog = page.getByRole('dialog', { name: family.dialog, exact: true });
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
            for (const name of ['Close dialog', 'Cancel', 'Stop Agent']) {
              await expect(dialog.getByRole('button', { name, exact: true })).toBeInViewport({
                ratio: 1,
              });
              await dialog.getByRole('button', { name, exact: true }).click({ trial: true });
            }
            expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
          }
          await dialog.getByRole('button', { name: 'Stop Agent', exact: true }).click();
          await expect.poll(() => writes.length).toBe(1);
          await expect(dialog).toBeVisible();
          await page.keyboard.press('Escape');
          await dialog.getByRole('button', { name: 'Close dialog' }).click();
          await page.mouse.click(3, 3);
          await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
          release();
          await expect(dialog.getByRole('alert')).toContainText('Fixture stop failed');
          await expect(dialog.getByText('Fixture stop failed', { exact: true })).toBeInViewport({
            ratio: 1,
          });
          await expect(
            dialog.getByRole('button', { name: 'Stop Agent', exact: true })
          ).toBeEnabled();
          await dialog
            .getByRole('button', { name: 'Stop Agent', exact: true })
            .click({ trial: true });
          expect(writes).toEqual([
            { path: `/api/agents/${task.id}/stop`, body: { attemptId: 'attempt-fixture' } },
          ]);
          await page.screenshot({ path: test.info().outputPath('stop-failure.png') });
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
}

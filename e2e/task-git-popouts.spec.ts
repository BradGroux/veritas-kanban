import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask, unwrapApiData } from './helpers/auth';

const families = [
  { name: 'PR', opener: 'Create PR', title: 'Create Pull Request', submit: 'Create PR' },
  { name: 'merge', opener: 'Merge', title: 'Merge to main?', submit: 'Merge & Complete' },
  { name: 'cleanup', opener: 'Delete Worktree', title: 'Delete worktree?', submit: 'Delete' },
];

for (const theme of ['light', 'dark']) {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    for (const family of families) {
      test(`${family.name} confirmation retains pending work in ${theme}, motion ${reducedMotion}`, async ({
        page,
      }) => {
        await bypassAuth(page);
        await page.emulateMedia({ reducedMotion });
        await page.addInitScript(
          (theme) => localStorage.setItem('veritas-kanban-theme', theme),
          theme
        );
        const title = `Git dialog fixture ${family.name} ${theme} ${reducedMotion}`;
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
        // Ownership exists only in intercepted browser reads, never real storage.
        await page.route(/\/api\/tasks(?:\/[^/?]+)?(?:\?.*)?$/, async (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          const response = await route.fetch();
          const json = JSON.parse(JSON.stringify(await response.json()), (_key, value) =>
            value && typeof value === 'object' && value.id === task.id
              ? { ...value, git: { ...value.git, worktreeManifestId: 'fixture-manifest' } }
              : value
          );
          await route.fulfill({ response, json });
        });
        await page.route('**/api/config', async (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          const config = unwrapApiData<Record<string, unknown>>(await (await route.fetch()).json());
          await route.fulfill({
            json: {
              ...config,
              repos: [
                { name: 'Fixture/repo', path: '/tmp/task-overlay-fixture', defaultBranch: 'main' },
              ],
            },
          });
        });
        const requests: { method: string; path: string; body: unknown }[] = [];
        let release = () => {};
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const failure = `Fixture ${family.name} failed`;
        await page.route(
          new RegExp(`/api/(?:github/|tasks/${task.id}/worktree|conflicts/${task.id})`),
          async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (request.method() !== 'GET') {
              requests.push({
                method: request.method(),
                path: url.pathname + url.search,
                body: request.postDataJSON(),
              });
              await gate;
              return route.fulfill({ status: 503, json: { error: failure } });
            }
            if (url.pathname === '/api/github/status')
              return route.fulfill({ json: { authenticated: true } });
            if (url.pathname === `/api/conflicts/${task.id}`)
              return route.fulfill({
                json: { hasConflicts: false, conflictingFiles: [], rebaseInProgress: false },
              });
            if (url.pathname === `/api/tasks/${task.id}/worktree`)
              return route.fulfill({
                json: {
                  aheadBehind: { ahead: 1, behind: 0 },
                  hasChanges: false,
                  changedFiles: 0,
                  remoteState: { stale: false },
                  cleanupPreview: {
                    eligible: false,
                    requiresOverride: true,
                    blockedReasons: [
                      {
                        code: 'unmerged',
                        message: 'The worktree HEAD is not merged into the remote base.',
                        overrideable: true,
                      },
                    ],
                  },
                },
              });
            return route.fulfill({ status: 404, json: { error: 'Fixture route unavailable' } });
          }
        );
        try {
          await page.setViewportSize({ width: 1700, height: 900 });
          await page.goto('/');
          await page.getByRole('article', { name: `Task: ${title}` }).press('Enter');
          const workspace = page.getByTestId('task-detail-panel');
          await workspace.getByRole('button', { name: 'Run', exact: true }).click();
          await workspace.getByRole('tab', { name: /Git/ }).click();
          const opener = workspace.getByRole('button', { name: family.opener, exact: true });
          await opener.press('Enter');
          const dialog = page.getByRole('dialog', { name: family.title, exact: true });
          await expect(dialog).toBeVisible();
          await expect(dialog).toHaveCSS('opacity', '1');
          await expect(workspace).toHaveAttribute('inert', '');
          const draft = 'Retain the reviewed operator draft.';
          if (family.name === 'PR')
            await dialog.getByRole('textbox', { name: 'Description' }).fill(draft);
          if (family.name === 'cleanup')
            await dialog.getByRole('textbox', { name: 'Override reason' }).fill(draft);
          for (const geometry of [
            { width: 1700, height: 900, fontSize: '16px' },
            { width: 1180, height: 760, fontSize: '20px' },
            { width: 900, height: 480, fontSize: '20px' },
          ]) {
            await page.setViewportSize(geometry);
            await page.evaluate((size) => {
              document.documentElement.style.fontSize = size;
            }, geometry.fontSize);
            await page.evaluate(
              () =>
                new Promise<void>((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
                )
            );
            for (const action of ['Close dialog', 'Cancel', family.submit]) {
              const button = dialog.getByRole('button', { name: action, exact: true });
              await expect(button).toBeInViewport({ ratio: 1 });
              await button.click({ trial: true });
            }
            const footer = dialog.locator('.vk-overlay-footer');
            const before = await footer.boundingBox();
            await dialog.locator('.vk-overlay-scroll').evaluate((element) => {
              element.scrollTop = element.scrollHeight;
            });
            expect(await footer.boundingBox()).toEqual(before);
            const bounds = await dialog.evaluate((element) => ({
              top: element.getBoundingClientRect().top,
              bottom: element.getBoundingClientRect().bottom,
              overflow: element.scrollWidth - element.clientWidth,
            }));
            expect(bounds.top).toBeGreaterThanOrEqual(0);
            expect(bounds.bottom).toBeLessThanOrEqual(geometry.height);
            expect(bounds.overflow).toBe(0);
          }
          await dialog.getByRole('button', { name: family.submit, exact: true }).click();
          await expect.poll(() => requests.length).toBe(1);
          await page.keyboard.press('Escape');
          await expect(dialog).toBeVisible();
          await dialog.getByRole('button', { name: 'Close dialog' }).click();
          await page.mouse.click(3, 3);
          await expect(dialog).toBeVisible();
          await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
          await expect(workspace).toHaveAttribute('inert', '');
          release();
          await expect(dialog.getByRole('alert').filter({ hasText: failure })).toBeVisible();
          await expect(
            dialog.getByRole('button', { name: family.submit, exact: true })
          ).toBeEnabled();
          if (family.name === 'PR')
            await expect(dialog.getByRole('textbox', { name: 'Description' })).toHaveValue(draft);
          if (family.name === 'cleanup')
            await expect(dialog.getByRole('textbox', { name: 'Override reason' })).toHaveValue(
              draft
            );
          for (const name of ['Cancel', family.submit]) {
            const action = dialog.getByRole('button', { name, exact: true });
            await expect(action).toBeInViewport({ ratio: 1 });
            await action.click({ trial: true });
          }
          await page.screenshot({ path: test.info().outputPath(`${family.name}-failure.png`) });
          expect(requests).toHaveLength(1);
          if (family.name === 'PR') {
            expect(requests[0]).toEqual({
              method: 'POST',
              path: '/api/github/pr',
              body: { taskId: task.id, title, body: draft, draft: false },
            });
          } else if (family.name === 'merge') {
            expect(requests[0]).toEqual({
              method: 'POST',
              path: `/api/tasks/${task.id}/worktree/merge`,
              body: null,
            });
          } else {
            const requestUrl = new URL(requests[0].path, 'http://fixture.local');
            expect(requests[0].method).toBe('DELETE');
            expect(requestUrl.pathname).toBe(`/api/tasks/${task.id}/worktree`);
            expect(requestUrl.searchParams.get('force')).toBe('true');
            expect(requestUrl.searchParams.get('reason')).toBe(draft);
          }
          await page.keyboard.press('Escape');
          await expect(dialog).toHaveCount(0);
          await expect(opener).toBeFocused();
          await expect(workspace).not.toHaveAttribute('inert');
        } finally {
          release();
          await deleteTask(page, String(task.id)).catch(() => {});
          await cleanupRoutes(page).catch(() => {});
        }
      });
    }
  }
}

import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask, unwrapApiData } from './helpers/auth';

for (const operation of ['resolve', 'abort', 'continue'] as const) {
  for (const theme of ['light', 'dark']) {
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      test(`conflict ${operation} retains pending ownership in ${theme}, motion ${reducedMotion}`, async ({
        page,
      }) => {
        await bypassAuth(page);
        await page.emulateMedia({ reducedMotion });
        await page.addInitScript(
          (value) => localStorage.setItem('veritas-kanban-theme', value),
          theme
        );
        const title = `Conflict ${operation} fixture ${theme} ${reducedMotion}`;
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
        await page.route(`**/api/conflicts/${task.id}`, (route) =>
          route.fulfill({
            json: {
              hasConflicts: true,
              conflictingFiles: operation === 'continue' ? [] : ['fixture.txt'],
              rebaseInProgress: true,
              mergeInProgress: false,
            },
          })
        );
        await page.route(`**/api/conflicts/${task.id}/file?*`, (route) =>
          route.fulfill({
            json: {
              path: 'fixture.txt',
              content: 'Initial resolution',
              oursContent: 'Ours\n'.repeat(80),
              theirsContent: 'Theirs\n'.repeat(80),
              baseContent: '',
              markers: [],
            },
          })
        );
        const writes: Array<{ method: string; path: string; body: unknown }> = [];
        let release = () => {};
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const message = `Fixture conflict ${operation} failed. The draft remains available.`;
        await page.route(
          new RegExp(`/api/conflicts/${task.id}/(?:resolve|abort|continue)(?:\\?|$)`),
          async (route) => {
            const request = route.request();
            writes.push({
              method: request.method(),
              path: new URL(request.url()).pathname,
              body: request.postDataJSON(),
            });
            await gate;
            return route.fulfill({ status: 503, json: { error: message } });
          }
        );
        try {
          await page.setViewportSize({ width: 1700, height: 900 });
          await page.goto('/');
          await page.locator(`[role="article"][data-task-id="${task.id}"]`).press('Enter');
          const workspace = page.getByTestId('task-detail-panel');
          await workspace.getByRole('button', { name: 'Run', exact: true }).click();
          await workspace.getByRole('tab', { name: /Git/ }).click();
          const opener = workspace.getByRole('button', { name: 'Resolve Conflicts', exact: true });
          await opener.press('Enter');
          const resolver = page.getByRole('dialog', { name: 'Merge Conflicts', exact: true });
          let owner = resolver;
          let submit;
          if (operation === 'resolve') {
            await resolver.getByRole('tab', { name: 'Manual Edit' }).click();
            await resolver
              .getByPlaceholder('Edit the file content to resolve conflicts...')
              .fill('Keep my resolution');
            submit = resolver.getByRole('button', { name: 'Save Resolution' });
          } else if (operation === 'abort') {
            await resolver.getByRole('button', { name: 'Abort', exact: true }).click();
            owner = page.getByRole('dialog', { name: 'Abort Rebase?', exact: true });
            submit = owner.getByRole('button', { name: 'Abort', exact: true });
          } else submit = resolver.getByRole('button', { name: 'Continue Rebase' });
          await submit.click();
          await expect.poll(() => writes.length).toBe(1);
          await submit.evaluate((element) => (element as HTMLButtonElement).click());
          for (const phase of ['pending', 'error'] as const) {
            if (phase === 'error') {
              release();
              const error = owner.getByRole('alert', { name: 'Conflict operation failed' });
              await expect(error).toContainText(message);
              await expect(error).toBeFocused();
              await expect(error).toBeInViewport({ ratio: 1 });
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
              await expect(owner).toBeInViewport({ ratio: 1 });
              await expect(submit).toBeInViewport({ ratio: 1 });
              if (phase === 'pending') {
                await expect(submit).toBeDisabled();
                if (operation === 'resolve') {
                  await expect(resolver.getByRole('tab', { name: 'Manual Edit' })).toBeDisabled();
                  await expect(resolver.getByRole('tab', { name: 'Side by Side' })).toBeDisabled();
                }
                await page.keyboard.press('Escape');
                await owner
                  .getByRole('button', { name: 'Close dialog' })
                  .evaluate((element) => (element as HTMLButtonElement).click());
                await page.mouse.click(3, 3);
                await expect(owner).toBeVisible();
              } else {
                await expect(submit).toBeEnabled();
                const error = owner.getByRole('alert', { name: 'Conflict operation failed' });
                await error.evaluate((element) =>
                  element.scrollIntoView({ block: 'center', behavior: 'instant' })
                );
                await expect(error).toBeInViewport({ ratio: 1 });
              }
              expect(
                await owner.evaluate((element) => element.scrollWidth - element.clientWidth)
              ).toBe(0);
            }
            await page.screenshot({
              path: test.info().outputPath(`conflict-${operation}-${phase}.png`),
            });
          }
          if (operation === 'resolve')
            await expect(
              resolver.getByPlaceholder('Edit the file content to resolve conflicts...')
            ).toHaveValue('Keep my resolution');
          expect(writes).toEqual([
            {
              method: 'POST',
              path: `/api/conflicts/${task.id}/${operation}`,
              body:
                operation === 'resolve'
                  ? { resolution: 'manual', manualContent: 'Keep my resolution' }
                  : operation === 'continue'
                    ? {}
                    : null,
            },
          ]);
          await page.keyboard.press('Escape');
          await expect(owner).toHaveCount(0);
          if (operation === 'abort') await page.keyboard.press('Escape');
          await expect(resolver).toHaveCount(0);
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

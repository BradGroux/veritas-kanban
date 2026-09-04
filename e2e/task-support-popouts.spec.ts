import { expect, test, type Locator, type Route } from '@playwright/test';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask } from './helpers/auth';

for (const theme of ['light', 'dark']) {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`task support popouts preserve geometry and focus in ${theme}, motion ${reducedMotion}`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await bypassAuth(page);
      await page.emulateMedia({ reducedMotion });
      await page.addInitScript(
        (theme) => localStorage.setItem('veritas-kanban-theme', theme),
        theme
      );
      const title = `Support popout fixture ${theme} ${reducedMotion}`;
      const task = await seedTestTask(page, { title, type: 'code' });
      const writes: string[] = [];
      const timestamp = '2026-09-01T09:00:00Z';
      // Synthetic browser reads exercise populated controls without creating files,
      // observations, comments, or deliverables in the backend.
      await page.route(/\/api\/tasks(?:\/[^/?]+)?(?:\?.*)?$/, async (route) => {
        if (route.request().method() !== 'GET') {
          writes.push(route.request().url());
          return route.fulfill({ status: 409, json: { error: 'Read-only fixture' } });
        }
        const response = await route.fetch();
        const json = JSON.parse(JSON.stringify(await response.json()), (_key, value) =>
          value && typeof value === 'object' && value.id === task.id
            ? {
                ...value,
                comments: [
                  { id: 'comment-fixture', author: 'Reviewer', text: 'Review note', timestamp },
                ],
                attachments: [
                  {
                    id: 'attachment-fixture',
                    filename: 'notes.md',
                    originalName: 'Notes.md',
                    mimeType: 'text/markdown',
                    size: 128,
                    uploaded: timestamp,
                  },
                ],
                observations: [
                  {
                    id: 'observation-fixture',
                    type: 'insight',
                    content: 'Keep geometry checks',
                    score: 7,
                    timestamp,
                  },
                ],
                deliverables: [
                  {
                    id: 'deliverable-fixture',
                    title: 'Acceptance notes',
                    type: 'document',
                    status: 'pending',
                    created: timestamp,
                  },
                ],
              }
            : value
        );
        return route.fulfill({ response, json });
      });
      await page.route(new RegExp(`/api/tasks/${task.id}/`), (route) => {
        if (route.request().method() === 'GET') return route.fallback();
        writes.push(route.request().url());
        return route.fulfill({ status: 409, json: { error: 'Read-only fixture' } });
      });

      try {
        await page.setViewportSize({ width: 1700, height: 900 });
        await page.goto('/');
        await page.getByRole('article', { name: `Task: ${title}` }).press('Enter');
        const workspace = page.getByTestId('task-detail-panel');
        await workspace.getByRole('button', { name: 'Plan', exact: true }).click();

        const inspect = async (opener: Locator, name: string, actions: string[]) => {
          await opener.scrollIntoViewIfNeeded();
          await opener.focus();
          await opener.press('Enter');
          const dialog = page.getByRole('dialog', { name, exact: true });
          await expect(dialog).toBeVisible();
          await expect(dialog).toHaveCSS('opacity', '1');
          await expect(workspace).toHaveAttribute('inert', '');
          for (const geometry of [
            { width: 1700, height: 900, fontSize: '16px' },
            { width: 1180, height: 760, fontSize: '20px' },
            { width: 900, height: 480, fontSize: '20px' },
          ]) {
            await page.setViewportSize(geometry);
            await page.evaluate((fontSize) => {
              document.documentElement.style.fontSize = fontSize;
            }, geometry.fontSize);
            const footer = dialog.locator('.vk-overlay-footer');
            const scroll = dialog.locator('.vk-overlay-scroll');
            for (const action of actions) {
              await expect(
                footer.getByRole('button', { name: action, exact: true })
              ).toBeInViewport({ ratio: 1 });
            }
            const before = await footer.boundingBox();
            await scroll.evaluate((element) => {
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
          await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus();
          await page.keyboard.press('Tab');
          expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
            true
          );
          await page.screenshot({
            path: test.info().outputPath(`${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`),
          });
          await page.keyboard.press('Escape');
          await expect(dialog).toHaveCount(0);
          await expect(workspace).not.toHaveAttribute('inert');
          await expect(opener).toBeFocused();
          await expect(
            workspace.getByRole('textbox', { name: 'Task title', exact: true })
          ).toHaveValue(title);
          await page.setViewportSize({ width: 1700, height: 900 });
          await page.evaluate(() => {
            document.documentElement.style.fontSize = '16px';
          });
          // Keep requests entirely in the browser fixture. A delayed failure must
          // retain the dialog, avoid duplicate submission, and preserve the draft.
          let release = () => {};
          const pending = new Promise<void>((resolve) => {
            release = resolve;
          });
          let requests = 0;
          const delayedFailure = async (route: Route) => {
            if (route.request().method() === 'GET') return route.fallback();
            requests += 1;
            await pending;
            return route.fulfill({ status: 503, json: { error: 'Fixture request failed' } });
          };
          await page.route('**/api/**', delayedFailure);
          try {
            await opener.press('Enter');
            await expect(dialog).toBeVisible();
            if (name === 'Add Time Entry') {
              await dialog.getByRole('textbox', { name: 'Duration', exact: true }).fill('45m');
              await dialog
                .getByRole('textbox', { name: 'Description (optional)' })
                .fill('Retain this draft');
            }
            const submit = dialog.getByRole('button', { name: actions[1], exact: true });
            await submit.click();
            await expect.poll(() => requests).toBe(1);
            await page.keyboard.press('Escape');
            await expect(dialog).toBeVisible();
            await expect(
              dialog.getByRole('button', { name: 'Cancel', exact: true })
            ).toBeDisabled();
            await expect(submit).toBeDisabled();
            await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
            await page.mouse.click(4, 4);
            await expect(dialog).toBeVisible();
            await expect(workspace).toHaveAttribute('inert', '');
            release();
            await expect(dialog.getByRole('alert')).toBeVisible();
            await expect(submit).toBeEnabled();
            if (name === 'Add Time Entry') {
              await expect(
                dialog.getByRole('textbox', { name: 'Duration', exact: true })
              ).toHaveValue('45m');
              await expect(
                dialog.getByRole('textbox', { name: 'Description (optional)' })
              ).toHaveValue('Retain this draft');
            }
            expect(requests).toBe(1);
            await page.keyboard.press('Escape');
            await expect(dialog).toHaveCount(0);
            await expect(opener).toBeFocused();
          } finally {
            release();
            await page.unroute('**/api/**', delayedFailure);
          }
        };

        await inspect(
          workspace.getByRole('button', { name: 'Add Time', exact: true }),
          'Add Time Entry',
          ['Cancel', 'Add Entry']
        );
        await inspect(
          workspace.getByRole('button', { name: 'Delete comment by Reviewer' }),
          'Delete comment?',
          ['Cancel', 'Delete']
        );
        await inspect(
          workspace.getByRole('button', { name: 'Delete', exact: true }),
          'Delete this task?',
          ['Cancel', 'Delete']
        );
        await workspace.getByRole('tab', { name: /Attachments/ }).click();
        await inspect(
          workspace.getByRole('button', { name: 'Delete attachment', exact: true }),
          'Delete attachment?',
          ['Cancel', 'Delete']
        );
        await workspace.getByRole('tab', { name: /Observations/ }).click();
        await inspect(
          workspace.getByRole('button', {
            name: 'Delete observation: Keep geometry checks',
            exact: true,
          }),
          'Delete Observation',
          ['Cancel', 'Delete']
        );
        await workspace.getByRole('button', { name: 'Results', exact: true }).click();
        await inspect(
          workspace.getByRole('button', {
            name: 'Delete deliverable: Acceptance notes',
            exact: true,
          }),
          'Delete deliverable?',
          ['Cancel', 'Delete']
        );
        expect(writes).toEqual([]);
      } finally {
        await deleteTask(page, String(task.id)).catch(() => {});
        await cleanupRoutes(page).catch(() => {});
      }
    });
  }
}

import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

for (const theme of ['light', 'dark']) {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`Create Task retains its draft in ${theme}, motion ${reducedMotion}`, async ({ page }) => {
      await bypassAuth(page);
      await page.emulateMedia({ reducedMotion });
      await page.addInitScript(
        (theme) => localStorage.setItem('veritas-kanban-theme', theme),
        theme
      );

      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const writes: unknown[] = [];
      const unexpectedWrites: Array<{ method: string; path: string }> = [];
      let attempt = 0;
      await page.route(/\/api\/tasks(?:\/|\?|$)/, async (route) => {
        const request = route.request();
        if (request.method() === 'GET') return route.fallback();

        const path = new URL(request.url()).pathname;
        if (request.method() !== 'POST' || path !== '/api/tasks') {
          unexpectedWrites.push({ method: request.method(), path });
          return route.fulfill({ status: 500, json: { error: 'Unexpected fixture write' } });
        }

        writes.push(request.postDataJSON());
        attempt += 1;
        if (attempt === 1) {
          await gate;
          return route.fulfill({
            status: 503,
            json: { error: 'Fixture task creation failed' },
          });
        }

        return route.fulfill({
          status: 201,
          json: {
            id: 'task_fixture_create',
            title: 'Retain this complete draft',
            description: 'Do not discard this task description.',
            type: 'code',
            status: 'todo',
            priority: 'medium',
            created: '2026-09-04T00:00:00.000Z',
            updated: '2026-09-04T00:00:00.000Z',
            subtasks: [],
            comments: [],
            reviewComments: [],
          },
        });
      });

      try {
        await page.setViewportSize({ width: 1700, height: 900 });
        await page.goto('/board');
        const opener = page.getByRole('button', { name: 'New Task', exact: true });
        await opener.press('Enter');
        const dialog = page.getByRole('dialog', { name: 'Create New Task', exact: true });
        await expect(dialog).toBeVisible();
        await dialog.getByLabel('Title', { exact: true }).fill('Retain this complete draft');
        await dialog
          .getByLabel('Description', { exact: true })
          .fill('Do not discard this task description.');

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
          await dialog.evaluate(async (element) => {
            await Promise.all(
              element
                .getAnimations({ subtree: true })
                .map((animation) => animation.finished.catch(() => {}))
            );
          });

          const footer = dialog.locator('.vk-overlay-footer');
          const before = await footer.boundingBox();
          await dialog.locator('.vk-overlay-scroll').evaluate((element) => {
            element.scrollTop = element.scrollHeight;
          });
          expect(await footer.boundingBox()).toEqual(before);
          for (const name of ['Close dialog', 'Cancel', 'Create Task']) {
            const action = dialog.getByRole('button', { name, exact: true });
            await expect(action).toBeInViewport({ ratio: 1 });
            await action.click({ trial: true });
          }
          expect(
            await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)
          ).toBe(0);
        }

        const submit = dialog.getByRole('button', { name: 'Create Task', exact: true });
        await submit.click();
        await expect.poll(() => writes.length).toBe(1);
        await page.keyboard.press('Escape');
        await page.mouse.click(3, 3);
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeDisabled();
        await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        await expect(dialog.getByLabel('Title', { exact: true })).toBeDisabled();
        await expect(dialog.getByLabel('Description', { exact: true })).toBeDisabled();
        await expect(dialog.getByLabel('Type', { exact: true })).toBeDisabled();
        await submit.click({ force: true });
        expect(writes).toHaveLength(1);

        release();
        const error = dialog.getByRole('alert', { name: 'Task not created' });
        await expect(error).toContainText('Fixture task creation failed');
        await expect(error).toBeInViewport({ ratio: 1 });
        await expect(error).toBeFocused();
        await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue(
          'Retain this complete draft'
        );
        await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue(
          'Do not discard this task description.'
        );
        await expect(submit).toBeEnabled();
        await page.screenshot({ path: test.info().outputPath('create-task-failure.png') });

        await submit.click();
        await expect.poll(() => writes.length).toBe(2);
        await expect(dialog).toHaveCount(0);
        await expect(opener).toBeFocused();
        expect(writes[0]).toEqual({
          title: 'Retain this complete draft',
          description: 'Do not discard this task description.',
          type: 'code',
          priority: 'medium',
        });
        expect(writes[1]).toEqual(writes[0]);
        expect(unexpectedWrites).toEqual([]);
      } finally {
        release();
        await cleanupRoutes(page).catch(() => {});
      }
    });
  }
}

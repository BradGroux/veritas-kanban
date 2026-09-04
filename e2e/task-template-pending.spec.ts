import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask } from './helpers/auth';

for (const theme of ['light', 'dark']) {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`template application retains pending state in ${theme}, motion ${reducedMotion}`, async ({
      page,
    }) => {
      await bypassAuth(page);
      await page.emulateMedia({ reducedMotion });
      await page.addInitScript(
        (theme) => localStorage.setItem('veritas-kanban-theme', theme),
        theme
      );
      const title = `Template pending fixture ${theme} ${reducedMotion}`;
      const task = await seedTestTask(page, { title, type: 'code', description: '' });
      const writes: Array<{ method: string; path: string; body: unknown }> = [];
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route('**/api/templates', (route) =>
        route.fulfill({
          json: [
            {
              id: 'template-pending-fixture',
              name: 'Pending fixture',
              category: 'bug',
              taskDefaults: { descriptionTemplate: 'Investigate {{custom:ticket}}' },
              subtaskTemplates: [],
            },
          ],
        })
      );
      await page.route(
        new RegExp(`/api/tasks/${task.id}(?:/apply-template)?(?:\\?|$)`),
        async (route) => {
          const request = route.request();
          if (request.method() === 'GET') return route.fallback();
          writes.push({
            method: request.method(),
            path: new URL(request.url()).pathname,
            body: request.postDataJSON(),
          });
          await gate;
          return route.fulfill({
            status: 503,
            json: { error: 'Template fixture update failed. Your draft is retained for retry.' },
          });
        }
      );
      try {
        await page.setViewportSize({ width: 1700, height: 900 });
        await page.goto('/');
        await page.getByRole('article', { name: `Task: ${title}` }).press('Enter');
        const workspace = page.getByTestId('task-detail-panel');
        await workspace.getByRole('button', { name: 'Plan', exact: true }).click();
        const opener = workspace.getByRole('button', { name: 'Template', exact: true });
        await opener.press('Enter');
        const dialog = page.getByRole('dialog', { name: 'Apply Template to Task' });
        await expect(workspace).toHaveAttribute('inert', '');
        await dialog.getByRole('combobox', { name: 'Template', exact: true }).click();
        await page.getByRole('option', { name: /Pending fixture/ }).click();
        const variable = dialog.getByLabel('ticket', { exact: true });
        await variable.fill('BUG-42');
        await dialog.getByRole('switch', { name: 'Force overwrite' }).press('Space');
        await expect(dialog.getByRole('switch', { name: 'Force overwrite' })).toBeChecked();
        await dialog.getByRole('button', { name: 'Help', exact: true }).click();
        const submit = dialog.getByRole('button', { name: 'Apply Template', exact: true });
        await submit.click();
        await expect.poll(() => writes.length).toBe(1);
        await submit.evaluate((el) => (el as HTMLButtonElement).click());
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
          const footer = dialog.locator('.vk-overlay-footer');
          const before = await footer.boundingBox();
          await dialog.locator('.vk-overlay-scroll').evaluate((el) => {
            el.scrollTop = el.scrollHeight;
          });
          expect(await footer.boundingBox()).toEqual(before);
          for (const name of ['Apply Template', 'Cancel', 'Close dialog']) {
            await expect(dialog.getByRole('button', { name, exact: true })).toBeDisabled();
            await expect(dialog.getByRole('button', { name, exact: true })).toBeInViewport({
              ratio: 1,
            });
          }
          await expect(variable).toBeDisabled();
          await expect(dialog.getByRole('combobox', { name: 'Template' })).toBeDisabled();
          await expect(dialog.getByRole('switch', { name: 'Force overwrite' })).toBeDisabled();
          await page.keyboard.press('Escape');
          await dialog
            .getByRole('button', { name: 'Close dialog' })
            .evaluate((el) => (el as HTMLButtonElement).click());
          await page.mouse.click(3, 3);
          await expect(dialog).toBeVisible();
          expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
        }
        await page.screenshot({ path: test.info().outputPath('template-pending.png') });
        release();
        const error = dialog.getByRole('alert', { name: 'Template not applied' });
        await expect(error).toContainText('Template fixture update failed');
        await expect(error).toBeFocused();
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
          await error.scrollIntoViewIfNeeded();
          await expect(error).toBeInViewport({ ratio: 1 });
          await expect(
            error.getByText('Template fixture update failed. Your draft is retained for retry.', {
              exact: true,
            })
          ).toBeInViewport({ ratio: 1 });
          const footer = dialog.locator('.vk-overlay-footer');
          const before = await footer.boundingBox();
          await dialog.locator('.vk-overlay-scroll').evaluate((el) => {
            el.scrollTop = el.scrollHeight;
          });
          expect(await footer.boundingBox()).toEqual(before);
          for (const name of ['Apply Template', 'Cancel', 'Close dialog']) {
            await expect(dialog.getByRole('button', { name, exact: true })).toBeEnabled();
            await expect(dialog.getByRole('button', { name, exact: true })).toBeInViewport({
              ratio: 1,
            });
            await dialog.getByRole('button', { name, exact: true }).click({ trial: true });
          }
        }
        await expect(error).toBeInViewport({ ratio: 1 });
        await expect(
          error.getByText('Template fixture update failed. Your draft is retained for retry.', {
            exact: true,
          })
        ).toBeInViewport({ ratio: 1 });
        await expect(variable).toHaveValue('BUG-42');
        await expect(dialog.getByRole('switch', { name: 'Force overwrite' })).toBeChecked();
        await expect(submit).toBeEnabled();
        await submit.click({ trial: true });
        expect(writes).toEqual([
          {
            method: 'PATCH',
            path: `/api/tasks/${task.id}`,
            body: { description: 'Investigate BUG-42' },
          },
        ]);
        // The query's global failure notification is separate from the retained inline error.
        const notificationClose = page.getByRole('button', { name: 'Close notification' });
        if (await notificationClose.isVisible()) await notificationClose.click();
        await page.screenshot({ path: test.info().outputPath('template-failure.png') });
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(opener).toBeFocused();
      } finally {
        release();
        await cleanupRoutes(page).catch(() => {});
        await deleteTask(page, String(task.id)).catch(() => {});
      }
    });
  }
}

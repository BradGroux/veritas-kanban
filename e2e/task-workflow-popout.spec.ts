import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask } from './helpers/auth';

for (const theme of ['light', 'dark']) {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`task workflow chooser retains pending ownership in ${theme}, motion ${reducedMotion}`, async ({
      page,
    }) => {
      await bypassAuth(page);
      await page.emulateMedia({ reducedMotion });
      await page.addInitScript(
        (theme) => localStorage.setItem('veritas-kanban-theme', theme),
        theme
      );
      const title = `Workflow fixture ${theme} ${reducedMotion}`;
      const task = await seedTestTask(page, { title, type: 'code' });
      const workflows = Array.from({ length: 12 }, (_, i) => ({
        id: `fixture-${i}`,
        name: `Fixture workflow ${i}`,
        version: 1,
        description:
          'Reviewed workflow with a deliberately long description to exercise wrapping and scrolling.',
        agents: [],
        steps: [],
      }));
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const writes: Array<{ path: string; body: unknown }> = [];
      await page.route(/\/api\/workflows(?:\/|\?|$)/, async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (request.method() !== 'GET') {
          writes.push({ path, body: request.postDataJSON() });
          await gate;
          return route.fulfill({ status: 503, json: { error: 'Fixture workflow launch failed' } });
        }
        return route.fulfill({
          json: path.endsWith('/workflows')
            ? workflows
            : path.endsWith('/launch-recommendations')
              ? { recommendations: [] }
              : [],
        });
      });
      try {
        await page.setViewportSize({ width: 1700, height: 900 });
        await page.goto('/');
        await page.getByRole('article', { name: `Task: ${title}` }).press('Enter');
        const workspace = page.getByTestId('task-detail-panel');
        await workspace.getByRole('button', { name: 'Run', exact: true }).click();
        await workspace.getByRole('tab', { name: 'Workflow', exact: true }).click();
        const opener = workspace.getByRole('button', { name: 'Choose workflow' });
        await opener.press('Enter');
        const dialog = page.getByRole('dialog', { name: 'Run Workflow', exact: true });
        await expect(dialog.getByRole('button', { name: 'Start', exact: true })).toHaveCount(12);
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
          await dialog.evaluate(async (element) => {
            await Promise.all(
              element
                .getAnimations({ subtree: true })
                .map((animation) => animation.finished.catch(() => {}))
            );
          });
          const before = await close.boundingBox();
          await dialog
            .getByRole('button', { name: 'Start', exact: true })
            .last()
            .scrollIntoViewIfNeeded();
          await dialog
            .getByRole('button', { name: 'Start', exact: true })
            .last()
            .click({ trial: true });
          expect(await close.boundingBox()).toEqual(before);
          await expect(close).toBeInViewport({ ratio: 1 });
          const geometry = await dialog.evaluate((el) => ({
            bottom: el.getBoundingClientRect().bottom,
            top: el.getBoundingClientRect().top,
            overflow: el.scrollWidth - el.clientWidth,
          }));
          expect(geometry.top).toBeGreaterThanOrEqual(0);
          expect(geometry.bottom).toBeLessThanOrEqual(size.height);
          expect(geometry.overflow).toBe(0);
        }
        await dialog.getByRole('button', { name: 'Start', exact: true }).last().click();
        await expect.poll(() => writes.length).toBe(1);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Close dialog' }).click();
        await page.mouse.click(3, 3);
        for (const button of await dialog.getByRole('button', { name: 'Start', exact: true }).all())
          await expect(button).toBeDisabled();
        await page.goBack();
        await expect(dialog).toBeVisible();
        await expect
          .poll(() => page.evaluate(() => window.history.state?.veritasTaskWorkflow))
          .toBe(`${task.id}:workflow`);
        release();
        const error = dialog.getByRole('alert');
        await expect(error).toContainText('Fixture workflow launch failed');
        await expect(error).toBeInViewport({ ratio: 1 });
        await expect(error).toBeFocused();
        await page.screenshot({ path: test.info().outputPath('workflow-failure.png') });
        await expect(
          dialog.getByRole('button', { name: 'Start', exact: true }).last()
        ).toBeEnabled();
        expect(writes).toEqual([
          { path: '/api/workflows/fixture-11/runs', body: { taskId: task.id } },
        ]);
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(opener).toBeFocused();
        await expect(workspace).not.toHaveAttribute('inert', '');
      } finally {
        release();
        await deleteTask(page, String(task.id)).catch(() => {});
        await cleanupRoutes(page).catch(() => {});
      }
    });
  }
}

import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask } from './helpers/auth';

for (const theme of ['light', 'dark']) {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`task metrics export preserves filters and recovers in ${theme}, motion ${reducedMotion}`, async ({
      page,
    }) => {
      await bypassAuth(page);
      await page.emulateMedia({ reducedMotion });
      await page.addInitScript(
        (theme) => localStorage.setItem('veritas-kanban-theme', theme),
        theme
      );
      const title = `Export fixture ${theme} ${reducedMotion}`;
      const task = await seedTestTask(page, { title, type: 'code' });
      await page.route(`**/api/telemetry/events/task/${task.id}`, (route) =>
        route.fulfill({
          json: [
            {
              id: 'evt_fixture',
              type: 'run.started',
              timestamp: '2026-09-01T10:00:00Z',
              taskId: task.id,
              agent: 'fixture',
              attemptId: 'attempt_fixture',
            },
          ],
        })
      );
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const requests: URL[] = [];
      await page.route('**/api/telemetry/export?*', async (route) => {
        requests.push(new URL(route.request().url()));
        if (requests.length === 1) {
          await gate;
          return route.fulfill({ status: 503, json: { error: 'Fixture export failed' } });
        }
        return route.fulfill({
          contentType: 'application/json',
          body: '[{"fixture":true}]',
        });
      });
      try {
        await page.setViewportSize({ width: 1700, height: 900 });
        await page.goto('/');
        await page.getByRole('article', { name: `Task: ${title}` }).press('Enter');
        const workspace = page.getByTestId('task-detail-panel');
        await workspace.getByRole('button', { name: 'History', exact: true }).click();
        await workspace.getByRole('tab', { name: 'Metrics', exact: true }).click();
        const opener = workspace.getByRole('button', { name: 'Export', exact: true });
        await opener.press('Enter');
        const dialog = page.getByRole('dialog', { name: 'Export Metrics' });
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveCSS('opacity', '1');
        await expect(workspace).toHaveAttribute('inert', '');
        await dialog.getByLabel('Format', { exact: true }).click();
        await page.getByRole('option', { name: 'JSON (Programmatic)', exact: true }).click();
        await dialog.getByLabel('From', { exact: true }).fill('2026-09-01');
        await dialog.getByLabel('To', { exact: true }).fill('2026-09-02');
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
          for (const name of ['Close dialog', 'Cancel', 'Export']) {
            const action = dialog.getByRole('button', { name, exact: true });
            await expect(action).toBeInViewport({ ratio: 1 });
            await action.click({ trial: true });
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
        await dialog.getByRole('button', { name: 'Export', exact: true }).click();
        await expect.poll(() => requests.length).toBe(1);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Close dialog' }).click();
        await page.mouse.click(3, 3);
        await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        for (const label of ['Format', 'Scope', 'Task ID', 'From', 'To'])
          await expect(dialog.getByLabel(label, { exact: true })).toBeDisabled();
        release();
        await expect(dialog.getByRole('alert')).toContainText('Fixture export failed');
        await expect(dialog.getByRole('alert')).toBeInViewport({ ratio: 1 });
        await expect(dialog.getByRole('alert')).toBeFocused();
        await expect(dialog.getByLabel('From', { exact: true })).toHaveValue('2026-09-01');
        await expect(dialog.getByLabel('To', { exact: true })).toHaveValue('2026-09-02');
        await expect(dialog.getByLabel('Format', { exact: true })).toHaveValue(
          'JSON (Programmatic)'
        );
        await page.screenshot({ path: test.info().outputPath('export-failure.png') });
        const downloadEvent = page.waitForEvent('download');
        await dialog.getByRole('button', { name: 'Export', exact: true }).click();
        const download = await downloadEvent;
        // This surface test covers the documented fallback when the response
        // has no filename. Cross-origin filename exposure is tracked separately.
        expect(download.suggestedFilename()).toBe('telemetry-export.json');
        expect(await download.failure()).toBeNull();
        await expect(dialog).toHaveCount(0);
        await expect(opener).toBeFocused();
        expect(requests).toHaveLength(2);
        expect(requests[0].search).toBe(requests[1].search);
        expect(requests[0].searchParams.get('format')).toBe('json');
        expect(requests[0].searchParams.get('taskId')).toBe(task.id);
        expect(requests[0].searchParams.get('from')).toBe('2026-09-01T00:00:00.000Z');
        expect(requests[0].searchParams.get('to')).toBeTruthy();
      } finally {
        release();
        await deleteTask(page, String(task.id)).catch(() => {});
        await cleanupRoutes(page).catch(() => {});
      }
    });
  }
}

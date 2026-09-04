import { expect, test, type Locator } from '@playwright/test';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask } from './helpers/auth';

for (const theme of ['light', 'dark']) {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`work-product popouts keep content and actions reachable in ${theme}, motion ${reducedMotion}`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await bypassAuth(page);
      await page.emulateMedia({ reducedMotion });
      await page.addInitScript(
        (theme) => localStorage.setItem('veritas-kanban-theme', theme),
        theme
      );
      const title = `Product popout fixture ${theme} ${reducedMotion}`;
      const task = await seedTestTask(page, { title, type: 'code' });
      const timestamp = '2026-09-01T09:00:00Z';
      const report = {
        id: 'wp_report_fixture',
        workspaceId: 'local',
        kind: 'report',
        title: 'Acceptance report',
        status: 'active',
        version: 30,
        taskId: task.id,
        sourceRunId: 'run_fixture',
        sourceLinks: [],
        redacted: true,
        snippet: 'Reviewed acceptance notes',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const artifact = {
        schemaVersion: 'work-product-artifact/v1',
        id: 'wpa_fixture',
        productId: 'wp_file_fixture',
        version: 1,
        workspaceId: 'local',
        taskId: task.id,
        runId: 'run_fixture',
        attemptId: 'attempt_fixture',
        producingEventId: 'event_fixture',
        requestIdDigest: `sha256:${'a'.repeat(64)}`,
        launchManifestDigest: `sha256:${'b'.repeat(64)}`,
        mediaType: 'text/plain',
        byteSize: 2400,
        sha256: 'c'.repeat(64),
        safeName: 'acceptance.txt',
        state: 'available',
        redaction: { state: 'none' },
        createdAt: timestamp,
      };
      const file = {
        ...report,
        id: artifact.productId,
        kind: 'file',
        title: 'Acceptance artifact',
        version: 1,
        artifact,
      };
      const writes: string[] = [];
      let releaseSave = () => {};
      const saveGate = new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      let saveRequests = 0;
      await page.route('**/api/work-products/**', async (route) => {
        const url = new URL(route.request().url());
        if (route.request().method() !== 'GET') {
          if (
            url.pathname === `/api/work-products/${report.id}` &&
            route.request().method() === 'PATCH'
          ) {
            saveRequests += 1;
            await saveGate;
            return route.fulfill({ status: 503, json: { error: 'Fixture save failed' } });
          }
          writes.push(url.pathname);
          return route.fulfill({ status: 409, json: { error: 'Read-only fixture' } });
        }
        if (url.pathname.endsWith('/versions')) {
          return route.fulfill({
            json: Array.from({ length: 30 }, (_, index) => ({
              id: `wpv_${index}`,
              productId: report.id,
              workspaceId: 'local',
              version: 30 - index,
              changeType: 'manual',
              changeSummary: `Review ${30 - index}: retained acceptance evidence`,
              render: { schemaVersion: 1, kind: 'markdown', markdown: '# Report' },
              title: report.title,
              kind: 'report',
              createdAt: timestamp,
            })),
          });
        }
        if (url.pathname.endsWith('/export')) {
          return route.fulfill({
            contentType: 'text/markdown',
            body: '# Reviewed report\n\n' + 'Acceptance evidence.\n'.repeat(80),
          });
        }
        if (url.pathname.endsWith('/artifact/preview')) {
          return route.fulfill({
            json: {
              schemaVersion: 'work-product-artifact-preview/v1',
              status: 'ready',
              renderer: 'text',
              message: 'Preview is ready.',
              artifact,
              sourceRunId: 'run_fixture',
              redactionState: 'none',
              causalEvent: {
                taskId: task.id,
                runId: 'run_fixture',
                attemptId: 'attempt_fixture',
                eventId: 'event_fixture',
              },
              limits: { maxBytes: 8192, maxPages: 100 },
              truncation: { truncated: false, reasons: [] },
              actions: { downloadAllowed: true, openAssociatedAppAllowed: false },
              content: { kind: 'text', text: 'Artifact evidence\n'.repeat(100) },
            },
          });
        }
        return route.fulfill({ status: 404, json: { error: 'Fixture route not supplied' } });
      });
      await page.route(`**/api/tasks/${task.id}/work-products?*`, (route) =>
        route.fulfill({ json: [report, file] })
      );
      try {
        await page.setViewportSize({ width: 1700, height: 900 });
        await page.goto('/');
        await page.getByRole('article', { name: `Task: ${title}` }).press('Enter');
        const workspace = page.getByTestId('task-detail-panel');
        await workspace.getByRole('button', { name: 'Results', exact: true }).click();
        const checkGeometry = async (dialog: Locator, actions: string[]) => {
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
            // Textarea row metrics update through ResizeObserver after a font
            // or viewport change. Measure scrolling only after that layout pass.
            await page.evaluate(
              () =>
                new Promise<void>((resolve) => {
                  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
                })
            );
            await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeInViewport({
              ratio: 1,
            });
            for (const action of actions) {
              await expect(
                dialog.getByRole('button', { name: action, exact: true })
              ).toBeInViewport({ ratio: 1 });
              await dialog
                .getByRole('button', { name: action, exact: true })
                .click({ trial: true });
            }
            const footer = dialog.locator('.vk-overlay-footer');
            const before = (await footer.count()) ? await footer.boundingBox() : null;
            const body = (await dialog.locator('.vk-overlay-scroll').count())
              ? dialog.locator('.vk-overlay-scroll')
              : dialog.locator('.vk-overlay-body');
            await body.evaluate((element) => {
              element.scrollTop = element.scrollHeight;
            });
            if (before) expect(await footer.boundingBox()).toEqual(before);
            const bounds = await dialog.evaluate((element) => ({
              top: element.getBoundingClientRect().top,
              bottom: element.getBoundingClientRect().bottom,
              overflow: element.scrollWidth - element.clientWidth,
            }));
            expect(bounds.top).toBeGreaterThanOrEqual(0);
            expect(bounds.bottom).toBeLessThanOrEqual(geometry.height);
            expect(bounds.overflow).toBe(0);
          }
        };
        const dismiss = async (dialog: Locator, opener: Locator) => {
          await page.keyboard.press('Escape');
          await expect(dialog).toHaveCount(0);
          await expect(workspace).not.toHaveAttribute('inert');
          await expect(opener).toBeFocused();
          await page.setViewportSize({ width: 1700, height: 900 });
          await page.evaluate(() => {
            document.documentElement.style.fontSize = '16px';
          });
        };
        const historyOpener = workspace.getByRole('button', {
          name: `Open version history for ${report.title}`,
          exact: true,
        });
        await historyOpener.press('Enter');
        const history = page.getByRole('dialog', { name: `Version history: ${report.title}` });
        await expect(
          history.getByText('Review 1: retained acceptance evidence', { exact: true })
        ).toBeAttached();
        await checkGeometry(history, []);
        await page.screenshot({ path: test.info().outputPath('version-history.png') });
        await dismiss(history, historyOpener);

        const editOpener = workspace.getByRole('button', {
          name: `Edit ${report.title}`,
          exact: true,
        });
        await editOpener.press('Enter');
        const editor = page.getByRole('dialog', { name: `Edit: ${report.title}` });
        await expect(editor.getByRole('textbox', { name: 'Redacted markdown' })).toHaveValue(
          /Reviewed report/
        );
        await checkGeometry(editor, ['Cancel', 'Save Version']);
        await editor
          .getByRole('textbox', { name: 'Redacted markdown' })
          .fill('# Retain this draft');
        await editor.getByRole('button', { name: 'Save Version' }).click();
        await expect.poll(() => saveRequests).toBe(1);
        await page.keyboard.press('Escape');
        await editor.getByRole('button', { name: 'Close dialog' }).click();
        await expect(editor.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        await expect(workspace).toHaveAttribute('inert', '');
        releaseSave();
        await expect(editor.getByRole('button', { name: 'Save Version' })).toBeEnabled();
        await expect(editor.getByRole('textbox', { name: 'Redacted markdown' })).toHaveValue(
          '# Retain this draft'
        );
        await page.screenshot({ path: test.info().outputPath('work-product-editor.png') });
        await dismiss(editor, editOpener);
        // A transient failed-save toast is not part of the next preview surface.
        await page
          .locator('.mantine-Notification-root')
          .filter({ hasText: 'Fixture save failed' })
          .getByRole('button')
          .click();
        await expect(page.getByText('Fixture save failed', { exact: true })).toBeHidden();

        const previewOpener = workspace.getByRole('button', {
          name: `Preview ${artifact.safeName}`,
          exact: true,
        });
        await previewOpener.press('Enter');
        const preview = page.getByRole('dialog', { name: `Preview: ${file.title}` });
        await expect(preview.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
        await checkGeometry(preview, ['Causal event', 'Download']);
        await page.screenshot({ path: test.info().outputPath('artifact-preview.png') });
        await dismiss(preview, previewOpener);
        expect(saveRequests).toBe(1);
        expect(writes).toEqual([]);
      } finally {
        releaseSave();
        await deleteTask(page, String(task.id)).catch(() => {});
        await cleanupRoutes(page).catch(() => {});
      }
    });
  }
}

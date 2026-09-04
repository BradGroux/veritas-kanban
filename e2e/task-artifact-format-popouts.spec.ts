import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { WORK_PRODUCT_HTML_PREVIEW_CSP } from '../shared/src/types/work-product.types';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask } from './helpers/auth';

for (const kind of ['image', 'pdf', 'html'] as const) {
  for (const theme of ['light', 'dark']) {
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      test(`${kind} artifact controls in ${theme}, motion ${reducedMotion}`, async ({
        page,
        context,
      }) => {
        test.fixme(
          kind === 'pdf',
          '#1448: PDF page rendering is unproven: the sandboxed viewer is blank; footer checks are not acceptance.'
        );
        await bypassAuth(page);
        await page.emulateMedia({ reducedMotion });
        await page.addInitScript(
          (theme) => localStorage.setItem('veritas-kanban-theme', theme),
          theme
        );
        const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${WORK_PRODUCT_HTML_PREVIEW_CSP}"><style>body{font:20px sans-serif;padding:24px}p{margin:24px 0}</style><h1>Artifact fixture</h1>${'<p>Bounded preview acceptance content.</p>'.repeat(20)}`;
        let bytes =
          kind === 'image' ? readFileSync('web/public/icons/pwa-icon-512.png') : Buffer.from(html);
        if (kind === 'pdf') {
          const source = await context.newPage();
          await source.setContent(
            '<h1>Artifact PDF fixture</h1><p>One bounded, visible page for preview acceptance.</p>'
          );
          bytes = await source.pdf({ format: 'A4' });
          await source.close();
        }
        const title = `Artifact format fixture ${kind} ${theme} ${reducedMotion}`;
        const task = await seedTestTask(page, { title, type: 'code' });
        const mediaType =
          kind === 'image' ? 'image/png' : kind === 'pdf' ? 'application/pdf' : 'text/html';
        const artifact = {
          schemaVersion: 'work-product-artifact/v1',
          id: 'wpa_format',
          productId: 'wp_format',
          version: 1,
          workspaceId: 'local',
          taskId: task.id,
          runId: 'run_fixture',
          attemptId: 'attempt_fixture',
          producingEventId: 'event_fixture',
          requestIdDigest: `sha256:${'a'.repeat(64)}`,
          launchManifestDigest: `sha256:${'b'.repeat(64)}`,
          mediaType,
          byteSize: bytes.length,
          sha256: 'c'.repeat(64),
          safeName: `fixture.${kind === 'image' ? 'png' : kind}`,
          state: 'available',
          redaction: { state: 'none' },
          createdAt: '2026-09-01T09:00:00Z',
        };
        const file = {
          id: artifact.productId,
          workspaceId: 'local',
          kind: 'file',
          title: 'Format artifact',
          status: 'active',
          version: 1,
          taskId: task.id,
          sourceRunId: 'run_fixture',
          sourceLinks: [],
          redacted: true,
          snippet: 'Bounded format fixture',
          createdAt: artifact.createdAt,
          updatedAt: artifact.createdAt,
          artifact,
        };
        let reads = 0;
        let release = () => {};
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const audits: unknown[] = [];
        await page.route('**/api/work-products/**', async (route) => {
          const request = route.request();
          const path = new URL(request.url()).pathname;
          if (request.method() !== 'GET') {
            if (path.endsWith('/artifact/preview/audit')) {
              audits.push(request.postDataJSON());
              return route.fulfill({ json: {} });
            }
            return route.fulfill({ status: 409, json: { error: 'Fixture write forbidden' } });
          }
          if (path.endsWith('/artifact/download'))
            return route.fulfill({ contentType: mediaType, body: bytes });
          if (path.endsWith('/artifact/preview')) {
            reads += 1;
            if (reads === 2) await gate;
            return route.fulfill({
              json: {
                schemaVersion: 'work-product-artifact-preview/v1',
                status: 'ready',
                renderer: kind,
                message: 'Preview ready',
                artifact,
                sourceRunId: 'run_fixture',
                causalEvent: {
                  taskId: task.id,
                  runId: 'run_fixture',
                  attemptId: 'attempt_fixture',
                  eventId: 'event_fixture',
                },
                redactionState: 'none',
                limits: { maxBytes: 1048576 },
                truncation: { truncated: false, reasons: [] },
                actions: { downloadAllowed: true, openAssociatedAppAllowed: false },
                content:
                  kind === 'html'
                    ? {
                        kind,
                        document: html,
                        interactive: false,
                        contentSecurityPolicy: WORK_PRODUCT_HTML_PREVIEW_CSP,
                        sandbox: '',
                      }
                    : kind === 'image'
                      ? {
                          kind,
                          base64: bytes.toString('base64'),
                          width: 512,
                          height: 512,
                          animated: false,
                        }
                      : { kind, base64: bytes.toString('base64'), pages: 1 },
              },
            });
          }
          return route.fulfill({ status: 404, json: { error: 'Fixture route missing' } });
        });
        await page.route(`**/api/tasks/${task.id}/work-products?*`, (route) =>
          route.fulfill({ json: [file] })
        );
        try {
          await page.setViewportSize({ width: 1700, height: 900 });
          await page.goto('/');
          await page.getByRole('article', { name: `Task: ${title}` }).press('Enter');
          const workspace = page.getByTestId('task-detail-panel');
          await workspace.getByRole('button', { name: 'Results', exact: true }).click();
          const opener = workspace.getByRole('button', {
            name: `Preview ${artifact.safeName}`,
            exact: true,
          });
          await opener.press('Enter');
          const dialog = page.getByRole('dialog', { name: 'Preview: Format artifact' });
          await expect(dialog.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
          await expect(workspace).toHaveAttribute('inert', '');
          if (kind === 'image') {
            await expect
              .poll(() =>
                dialog
                  .getByRole('img', { name: artifact.safeName, exact: true })
                  .evaluate((el) => (el as HTMLImageElement).naturalWidth)
              )
              .toBe(512);
          } else {
            await expect(dialog.locator('iframe')).toHaveAttribute('sandbox', '');
            await expect(dialog.locator('iframe')).toHaveAttribute('referrerpolicy', 'no-referrer');
          }
          if (kind === 'html')
            await expect(
              dialog.frameLocator('iframe').getByRole('heading', { name: 'Artifact fixture' })
            ).toBeVisible();
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
            await expect(dialog.getByRole('button', { name: 'Close dialog' })).toHaveCSS(
              'width',
              size.fontSize === '20px' ? '42.5px' : '34px'
            );
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
            for (const name of [
              'Close dialog',
              'Download',
              'Causal event',
              ...(kind === 'html' ? ['Refresh'] : ['Zoom preview in', 'Zoom preview out']),
            ]) {
              await expect(dialog.getByRole('button', { name, exact: true })).toBeInViewport({
                ratio: 1,
              });
              await dialog.getByRole('button', { name, exact: true }).click({ trial: true });
            }
            expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
            if (kind === 'html')
              expect((await dialog.locator('iframe').boundingBox())!.height).toBeGreaterThan(500);
          }
          if (kind !== 'html') {
            await dialog.getByRole('button', { name: 'Zoom preview in' }).click();
            await expect(dialog.getByLabel('Preview zoom 125 percent')).toBeVisible();
            await dialog.getByRole('button', { name: 'Zoom preview out' }).click();
            await expect(dialog.getByLabel('Preview zoom 100 percent')).toBeVisible();
          } else {
            await dialog.getByRole('button', { name: 'Refresh' }).click();
            await expect.poll(() => reads).toBe(2);
            await expect(dialog.getByRole('button', { name: 'Refresh' })).toBeDisabled();
            await page.keyboard.press('Escape');
            await expect(dialog).toBeVisible();
            await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeDisabled();
            await expect(dialog.getByRole('button', { name: 'Causal event' })).toBeDisabled();
            expect(
              audits.filter((entry) => (entry as { action: string }).action === 'refresh')
            ).toHaveLength(1);
            release();
            await expect(dialog.getByRole('button', { name: 'Refresh' })).toBeEnabled();
            expect(audits).toContainEqual({ action: 'refresh', version: 1 });
          }
          const download = page.waitForEvent('download');
          await dialog.getByRole('button', { name: 'Download', exact: true }).click();
          const result = await download;
          expect(result.suggestedFilename()).toBe(artifact.safeName);
          expect(await result.failure()).toBeNull();
          await dialog.locator('.vk-overlay-scroll').evaluate((el) => {
            el.scrollTop = 0;
          });
          await page.screenshot({ path: test.info().outputPath(`${kind}-preview.png`) });
          await page.setViewportSize({ width: 1700, height: 900 });
          await page.evaluate(() => {
            document.documentElement.style.fontSize = '16px';
          });
          await page.screenshot({ path: test.info().outputPath(`${kind}-preview-large.png`) });
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

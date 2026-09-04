import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask } from './helpers/auth';

for (const decision of ['approved', 'rejected'] as const) {
  for (const theme of ['light', 'dark']) {
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      test(`exact ${decision} decision in ${theme}, motion ${reducedMotion}`, async ({ page }) => {
        await bypassAuth(page);
        await page.emulateMedia({ reducedMotion });
        await page.addInitScript(
          (theme) => localStorage.setItem('veritas-kanban-theme', theme),
          theme
        );
        const title = `Approval fixture ${decision} ${theme} ${reducedMotion}`;
        const task = await seedTestTask(page, { title, type: 'code' });
        const approval = {
          schemaVersion: 'run-approval/v1',
          id: 'runapproval_fixture_001',
          workspaceId: 'local',
          taskId: task.id,
          agentId: 'fixture',
          attemptId: 'attempt-fixture',
          provider: 'codex-app-server',
          requestKind: 'approval',
          actionClass: 'filesystem',
          action: 'Update fixture documentation',
          actionHash: 'a'.repeat(64),
          details:
            'Synthetic approval used only for dialog acceptance. No provider action is executed.',
          resourceScope: Array.from({ length: 25 }, (_, i) => `docs/fixture-${i}.md`),
          workingDirectory: '/tmp/task-overlay-fixture',
          policyReason: 'Exact action requires review',
          riskClass: 'high',
          evidenceRevision: 'provider-runtime-probe/v6',
          providerRequestId: 'fixture-request',
          mobileSafe: false,
          status: 'pending',
          revision: 7,
          createdAt: '2026-09-01T10:00:00Z',
          updatedAt: '2026-09-01T10:00:00Z',
          expiresAt: '2026-09-05T10:00:00Z',
        };
        const writes: Array<{ path: string; body: unknown }> = [];
        let release = () => {};
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        await page.route(/\/api\/run-approvals(?:\/|\?|$)/, async (route) => {
          const request = route.request();
          if (request.method() === 'GET') return route.fulfill({ json: [approval] });
          writes.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
          await gate;
          return route.fulfill({ status: 503, json: { error: 'Fixture decision failed' } });
        });
        try {
          await page.setViewportSize({ width: 1700, height: 900 });
          await page.goto('/');
          await page.getByRole('article', { name: `Task: ${title}` }).press('Enter');
          const workspace = page.getByTestId('task-detail-panel');
          await workspace.getByRole('button', { name: 'History', exact: true }).click();
          await workspace.getByRole('tab', { name: 'Timeline', exact: true }).click();
          const opener = workspace.getByRole('button', {
            name: decision === 'approved' ? 'Approve once' : 'Reject',
            exact: true,
          });
          await opener.press('Enter');
          const dialog = page.getByRole('dialog', {
            name: decision === 'approved' ? 'Approve exact action' : 'Reject action',
          });
          const submitName = decision === 'approved' ? 'Confirm approval' : 'Confirm rejection';
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
            for (const name of ['Close dialog', 'Cancel', submitName]) {
              await expect(dialog.getByRole('button', { name, exact: true })).toBeInViewport({
                ratio: 1,
              });
              await dialog.getByRole('button', { name, exact: true }).click({ trial: true });
            }
            expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
          }
          await dialog.getByRole('button', { name: submitName }).click();
          await expect.poll(() => writes.length).toBe(1);
          await page.keyboard.press('Escape');
          await dialog.getByRole('button', { name: 'Close dialog' }).click();
          await page.mouse.click(3, 3);
          await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
          await expect(dialog).toBeVisible();
          release();
          const error = dialog.getByRole('alert');
          await expect(error).toHaveText('Fixture decision failed');
          await expect(error).toBeInViewport({ ratio: 1 });
          await expect(error).toBeFocused();
          const hash = dialog.getByText(approval.actionHash, { exact: true });
          expect(await hash.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0);
          await expect(dialog.getByRole('button', { name: submitName })).toBeEnabled();
          await dialog.getByRole('button', { name: submitName }).click({ trial: true });
          expect(writes).toEqual([
            {
              path: `/api/run-approvals/${approval.id}/decision`,
              body: { decision, expectedRevision: 7, expectedActionHash: approval.actionHash },
            },
          ]);
          await page.screenshot({ path: test.info().outputPath('approval-failure.png') });
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

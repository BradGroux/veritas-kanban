import { expect, test } from '@playwright/test';
import { cleanupRoutes, deleteTask, seedTestTask } from './helpers/auth';

const apiBase = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';

test('cross-origin metrics downloads retain server filenames and the absent-header fallback', async ({
  page,
}) => {
  const task = await seedTestTask(page, { title: 'Cross-origin export fixture', type: 'code' });
  // Only authentication presentation is mocked. Export requests and CORS use the real server.
  await page.route('**/api/auth/status', (route) =>
    route.fulfill({
      json: {
        needsSetup: false,
        authenticated: true,
        authEnabled: true,
        sessionExpiry: new Date(Date.now() + 86400000).toISOString(),
      },
    })
  );
  // Present a synthetic run so the existing Metrics export action is available.
  // The exported data itself still comes from the real, disposable API store.
  await page.route(`**/api/telemetry/events/task/${task.id}`, (route) =>
    route.fulfill({
      json: [
        {
          id: 'evt_export_fixture',
          type: 'run.started',
          timestamp: '2026-09-01T10:00:00Z',
          taskId: task.id,
          agent: 'fixture',
          attemptId: 'attempt_fixture',
        },
      ],
    })
  );
  try {
    await page.setViewportSize({ width: 1700, height: 900 });
    await page.goto('/');
    expect(new URL(page.url()).origin).not.toBe(new URL(apiBase).origin);
    await page.getByRole('article', { name: `Task: ${task.title}` }).press('Enter');
    const workspace = page.getByTestId('task-detail-panel');
    await workspace.getByRole('button', { name: 'History', exact: true }).click();
    await workspace.getByRole('tab', { name: 'Metrics', exact: true }).click();
    for (const format of ['csv', 'json'] as const) {
      await workspace.getByRole('button', { name: 'Export', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Export Metrics' });
      await dialog.getByLabel('Format', { exact: true }).click();
      await page
        .getByRole('option', {
          name: format === 'csv' ? 'CSV (Spreadsheets)' : 'JSON (Programmatic)',
          exact: true,
        })
        .click();
      const responseEvent = page.waitForResponse((response) =>
        response.url().includes('/api/telemetry/export?')
      );
      const downloadEvent = page.waitForEvent('download');
      await dialog.getByRole('button', { name: 'Export', exact: true }).click();
      const response = await responseEvent;
      expect(new URL(response.url()).origin).toBe(new URL(apiBase).origin);
      expect(response.status()).toBe(200);
      const disposition = response.headers()['content-disposition'];
      expect(disposition).toContain(task.id);
      const expectedName = disposition.match(/filename="([^"]+)"/)![1];
      const download = await downloadEvent;
      expect(download.suggestedFilename()).toBe(expectedName);
      expect(await download.failure()).toBeNull();
      expect(expectedName).toMatch(new RegExp(`\\.${format}$`));
      await expect(dialog).toHaveCount(0);
    }
    // A separate synthetic response proves the consumer still has its generic fallback.
    await page.route('**/api/telemetry/export?*', (route) =>
      route.fulfill({ contentType: 'text/csv', body: 'fixture\n' })
    );
    await workspace.getByRole('button', { name: 'Export', exact: true }).click();
    const downloadEvent = page.waitForEvent('download');
    await page
      .getByRole('dialog', { name: 'Export Metrics' })
      .getByRole('button', { name: 'Export', exact: true })
      .click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe('telemetry-export.csv');
    expect(await download.failure()).toBeNull();
  } finally {
    await deleteTask(page, String(task.id)).catch(() => {});
    await cleanupRoutes(page).catch(() => {});
  }
});

test('the live CORS middleware exposes only download metadata to allowed origins', async ({
  request,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const allowed = await request.get(`${apiBase}/api/health`, { headers: { Origin: origin } });
  expect(allowed.status()).toBe(200);
  expect(allowed.headers()['access-control-allow-origin']).toBe(origin);
  expect(allowed.headers()['access-control-allow-credentials']).toBe('true');
  expect(allowed.headers()['access-control-expose-headers']).toBe('Content-Disposition');
  const preflight = await request.fetch(`${apiBase}/api/telemetry/export`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'X-API-Key',
    },
  });
  expect(preflight.status()).toBe(204);
  expect(preflight.headers()['access-control-allow-methods']).toBe(
    'GET,POST,PUT,PATCH,DELETE,OPTIONS'
  );
  expect(preflight.headers()['access-control-allow-headers']).toBe(
    'Content-Type,Authorization,X-API-Key,X-API-Version,X-Request-ID'
  );
  for (const rejectedOrigin of [
    'https://untrusted.example',
    'https://localhost.attacker.example',
    'not-an-origin',
  ]) {
    const rejected = await request.get(`${apiBase}/api/health`, {
      headers: { Origin: rejectedOrigin },
    });
    expect(rejected.status()).toBe(403);
    expect(rejected.headers()['access-control-allow-origin']).toBeUndefined();
    expect(rejected.headers()['access-control-expose-headers']).toBeUndefined();
  }
});

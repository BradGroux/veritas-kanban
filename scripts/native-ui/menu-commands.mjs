/* global window */
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

/** Uses the installed native menu, preload, and real mounted application. */
export async function verifyNativeMenuCommands(app, page) {
  const cases = [
    ['New Task', 'Create Task'],
    ['Settings', 'Settings'],
    ['Search', 'Search'],
    ['Command Center', 'Command Center'],
    ['Import', 'Settings'],
    ['Export', 'Settings'],
    ['Create Backup', 'Settings'],
    ['Create Debug Bundle', 'Settings'],
  ];
  const results = [];
  for (const [label, surface] of cases) {
    await app.evaluate(({ Menu }, label) => {
      const find = (menu) => {
        for (const item of menu.items) {
          if (item.label === label) return item;
          const nested = item.submenu && find(item.submenu);
          if (nested) return nested;
        }
      };
      const item = find(Menu.getApplicationMenu());
      if (!item || !item.enabled) throw new Error(`Native command unavailable: ${label}`);
      item.click();
    }, label);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveCount(1);
    await expect(dialog).toBeVisible();
    if (surface === 'Settings') {
      await expect(
        dialog.getByRole('button', { name: 'Close settings', exact: true })
      ).toBeVisible();
      if (['Import', 'Export', 'Create Backup', 'Create Debug Bundle'].includes(label)) {
        await expect(
          dialog.getByRole('heading', { name: 'Maintenance', exact: true })
        ).toBeVisible();
        await expect(
          dialog.getByRole('button', { name: 'Debug Bundle', exact: true })
        ).toBeVisible();
      }
    } else if (surface === 'Command Center') {
      await expect(dialog.getByRole('textbox', { name: 'Search commands' })).toBeVisible();
    } else if (surface === 'Search') {
      await expect(dialog.getByRole('textbox', { name: 'Search Veritas' })).toBeVisible();
    } else {
      await expect(dialog.getByRole('textbox', { name: /title/i }).first()).toBeVisible();
    }
    results.push({ label, surface, dialogs: await dialog.count() });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
  const unsupported = await page.evaluate(() =>
    window.veritasDesktop.dispatchCommand({ command: 'export-work-product', source: 'menu' })
  );
  assert.equal(unsupported.accepted, false);
  assert(unsupported.message);
  return results;
}

/** Native roles must be wired in Electron, including a live managed-server lifecycle. */
export async function verifyNativeWindowMenu(app, page) {
  const items = await app.evaluate(({ Menu }) => {
    const flatten = (menu) =>
      menu.items.flatMap((item) => [
        { role: item.role, accelerator: item.accelerator },
        ...(item.submenu ? flatten(item.submenu) : []),
      ]);
    return flatten(Menu.getApplicationMenu());
  });
  for (const role of [
    'quit',
    'close',
    'hide',
    'hideOthers',
    'unhide',
    'services',
    'resetZoom',
    'zoomIn',
    'zoomOut',
    'togglefullscreen',
  ]) {
    assert(
      items.some((item) => item.role === role),
      `Missing native role: ${role}`
    );
  }
  const clickRole = (role) =>
    app.evaluate(({ Menu }, role) => {
      const find = (menu) => {
        for (const item of menu.items) {
          if (item.role === role) return item;
          const nested = item.submenu && find(item.submenu);
          if (nested) return nested;
        }
      };
      const item = find(Menu.getApplicationMenu());
      if (!item?.enabled) throw new Error(`Role unavailable: ${role}`);
      item.click();
    }, role);
  const zoom = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()
    );
  await clickRole('zoomIn');
  await expect.poll(zoom).toBeGreaterThan(1);
  await clickRole('resetZoom');
  await expect.poll(zoom).toBe(1);
  await clickRole('zoomOut');
  await expect.poll(zoom).toBeLessThan(1);
  await clickRole('resetZoom');
  await expect.poll(zoom).toBe(1);
  await clickRole('togglefullscreen');
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())
    )
    .toBe(true);
  await clickRole('togglefullscreen');
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())
    )
    .toBe(false);
  const before = await page.evaluate(() => window.veritasDesktop.getConnectionStatus());
  const closed = page.waitForEvent('close');
  await clickRole('close');
  await closed;
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 0);
  const opened = app.waitForEvent('window');
  await app.evaluate(({ app }) => app.emit('activate'));
  const reopened = await opened;
  await expect(reopened.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  const after = await reopened.evaluate(() => window.veritasDesktop.getConnectionStatus());
  assert.equal(
    after.server.pid,
    before.server.pid,
    'Closing the window restarted the managed server'
  );
  return { page: reopened, roles: items };
}

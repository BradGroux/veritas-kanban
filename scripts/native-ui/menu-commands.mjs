/* global window, setTimeout, clearTimeout */
import { nativeSettingsPage, closeNativeSettings } from './settings-window.mjs';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
    if (surface === 'Settings') {
      const settings = await nativeSettingsPage(app);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      if (['Import', 'Export', 'Create Backup', 'Create Debug Bundle'].includes(label)) {
        await expect(
          settings.getByRole('heading', { name: 'Maintenance', exact: true })
        ).toBeVisible();
        await expect(
          settings.getByRole('button', { name: 'Debug Bundle', exact: true })
        ).toBeVisible();
      }
      results.push({ label, surface, nativeSettingsWindow: true, mainDialogs: 0 });
      await closeNativeSettings(app, settings);
      continue;
    }
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveCount(1);
    await expect(dialog).toBeVisible();
    if (surface === 'Command Center') {
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
      items.some((item) => item.role?.toLowerCase() === role.toLowerCase()),
      `Missing native role: ${role}`
    );
  }
  const clickRole = async (role) => {
    const shortcuts = {
      zoomIn: '+',
      resetZoom: '0',
      zoomOut: '-',
      togglefullscreen: 'f',
      close: 'w',
    };
    assert(shortcuts[role], `No native shortcut defined for ${role}`);
    const modifiers =
      role === 'togglefullscreen' ? '{control down, command down}' : '{command down}';
    // Target the disposable packaged process by PID, never the installed app name.
    await promisify(execFile)(
      'osascript',
      [
        '-e',
        `on run argv
      tell application "System Events"
        set targetProcess to first application process whose unix id is (item 1 of argv as integer)
        set frontmost of targetProcess to true
        tell targetProcess to keystroke (item 2 of argv) using ${modifiers}
      end tell
    end run`,
        String(app.process().pid),
        shortcuts[role],
      ],
      { timeout: 10000 }
    );
  };
  const zoom = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find(
          (window) => !new URL(window.webContents.getURL()).searchParams.has('desktop-settings')
        )
        .webContents.getZoomFactor()
    );
  await clickRole('zoomIn');
  await expect.poll(zoom).toBeGreaterThan(1);
  await clickRole('resetZoom');
  await expect.poll(zoom).toBe(1);
  await clickRole('zoomOut');
  await expect.poll(zoom).toBeLessThan(1);
  await clickRole('resetZoom');
  await expect.poll(zoom).toBe(1);
  for (const event of ['enter-full-screen', 'leave-full-screen']) {
    const transition = app.evaluate(
      ({ BrowserWindow }, event) =>
        new Promise((resolve, reject) => {
          const window = BrowserWindow.getAllWindows().find(
            (window) => !new URL(window.webContents.getURL()).searchParams.has('desktop-settings')
          );
          const timeout = setTimeout(() => reject(new Error(`No ${event} event`)), 10000);
          window.once(event, () => {
            clearTimeout(timeout);
            resolve(true);
          });
        }),
      event
    );
    await clickRole('togglefullscreen');
    await transition;
  }
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find(
            (window) => !new URL(window.webContents.getURL()).searchParams.has('desktop-settings')
          )
          .isFullScreen()
      )
    )
    .toBe(false);
  const normalBounds = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(
      (window) => !new URL(window.webContents.getURL()).searchParams.has('desktop-settings')
    );
    const bounds = window.getNormalBounds();
    window.maximize();
    return bounds;
  });
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find(
            (window) => !new URL(window.webContents.getURL()).searchParams.has('desktop-settings')
          )
          .isMaximized()
      )
    )
    .toBe(true);
  const before = await page.evaluate(() => window.veritasDesktop.getConnectionStatus());
  const closed = page.waitForEvent('close');
  await clickRole('close');
  await closed;
  assert.equal(
    await app.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().filter((window) => window.isVisible()).length
    ),
    0
  );
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
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find(
            (window) => !new URL(window.webContents.getURL()).searchParams.has('desktop-settings')
          )
          .isMaximized()
      )
    )
    .toBe(true);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => !new URL(window.webContents.getURL()).searchParams.has('desktop-settings'))
      .unmaximize()
  );
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find(
            (window) => !new URL(window.webContents.getURL()).searchParams.has('desktop-settings')
          )
          .getBounds()
      )
    )
    .toEqual(normalBounds);
  return { page: reopened, roles: items, normalBounds };
}

export async function verifyConfiguredTitlebarAction(app, page) {
  const preference = await app.evaluate(({ systemPreferences }) =>
    systemPreferences.getUserDefault('AppleActionOnDoubleClick', 'string')
  );
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(
      (window) => !new URL(window.webContents.getURL()).searchParams.has('desktop-settings')
    );
    window.restore();
    window.unmaximize();
  });
  const state = () =>
    app.evaluate(({ BrowserWindow }) => ({
      maximized: BrowserWindow.getAllWindows()
        .find(
          (window) => !new URL(window.webContents.getURL()).searchParams.has('desktop-settings')
        )
        .isMaximized(),
      minimized: BrowserWindow.getAllWindows()
        .find(
          (window) => !new URL(window.webContents.getURL()).searchParams.has('desktop-settings')
        )
        .isMinimized(),
    }));
  await expect.poll(state).toEqual({ maximized: false, minimized: false });
  await page.getByRole('navigation', { name: 'Main navigation' }).dispatchEvent('dblclick');
  const expected = {
    maximized: ['', 'Maximize', 'Fill'].includes(preference),
    minimized: preference === 'Minimize',
  };
  await expect.poll(state).toEqual(expected);
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(
      (window) => !new URL(window.webContents.getURL()).searchParams.has('desktop-settings')
    );
    window.restore();
    window.unmaximize();
    window.focus();
  });
  return { preference: preference || 'system default', expected };
}

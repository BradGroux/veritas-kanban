/* global window */
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export async function nativeSettingsPage(app) {
  let page;
  await expect
    .poll(() => {
      const matches = app
        .windows()
        .filter(
          (candidate) => new URL(candidate.url()).searchParams.get('desktop-settings') === '1'
        );
      assert(matches.length <= 1, 'More than one native Settings renderer');
      page = matches[0];
      return Boolean(page);
    })
    .toBe(true);
  await expect(page.getByRole('main', { name: 'Settings', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      app.evaluate(
        ({ BrowserWindow }, url) =>
          BrowserWindow.getAllWindows()
            .find((window) => window.webContents.getURL() === url)
            ?.isVisible(),
        page.url()
      )
    )
    .toBe(true);
  return page;
}

export async function closeNativeSettings(app, page) {
  await app.evaluate(({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(
      (window) => window.webContents.getURL() === url
    );
    if (!window) throw new Error('Settings window disappeared');
    window.close();
  }, page.url());
  await expect
    .poll(() =>
      app.evaluate(
        ({ BrowserWindow }, url) =>
          BrowserWindow.getAllWindows()
            .find((window) => window.webContents.getURL() === url)
            ?.isVisible(),
        page.url()
      )
    )
    .toBe(false);
}

/** Feature journey: menu reuse, modeless board, safe synchronization and retained edits. */
export async function verifyNativeSettingsWindow(app, board) {
  const request = { command: 'open-settings', source: 'shortcut', payload: { section: 'general' } };
  const results = await board.evaluate(
    async (request) =>
      Promise.all([
        window.veritasDesktop.dispatchCommand(request),
        window.veritasDesktop.dispatchCommand(request),
      ]),
    request
  );
  assert(
    results.every((result) => result.accepted),
    'Settings dispatch was not acknowledged'
  );
  const settings = await nativeSettingsPage(app);
  await expect(board.getByRole('dialog')).toHaveCount(0);
  await board.getByRole('button', { name: 'New Task', exact: true }).click();
  await expect(board.getByRole('dialog')).toHaveCount(1);
  await board.keyboard.press('Escape');
  const input = settings.getByRole('textbox', { name: 'Display Name (Squad Chat)', exact: true });
  await expect(input).toBeVisible();
  const changed = 'Native Settings fixture';
  await input.fill(changed);
  await closeNativeSettings(app, settings);
  await expect
    .poll(async () =>
      board.evaluate(async () => {
        const response = await fetch('/api/settings/features');
        const body = await response.json();
        return (body.data ?? body).general.humanDisplayName;
      })
    )
    .toBe(changed);
  const result = await board.evaluate(
    (request) => window.veritasDesktop.dispatchCommand(request),
    request
  );
  assert(result.accepted);
  assert.equal(
    await nativeSettingsPage(app),
    settings,
    'Close/reopen replaced the editing renderer'
  );
  await expect(input).toHaveValue(changed);
  const frames = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => ({
      settings: new URL(window.webContents.getURL()).searchParams.get('desktop-settings') === '1',
      visible: window.isVisible(),
      preferences: window.webContents.getLastWebPreferences(),
    }))
  );
  assert.equal(frames.filter((frame) => frame.settings).length, 1);
  const preferences = frames.find((frame) => frame.settings).preferences;
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.sandbox, true);
  await closeNativeSettings(app, settings);
  return { reusedWindow: true, boardUsable: true, retainedEdit: true, sandboxed: true };
}

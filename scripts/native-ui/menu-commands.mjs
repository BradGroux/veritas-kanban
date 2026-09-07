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

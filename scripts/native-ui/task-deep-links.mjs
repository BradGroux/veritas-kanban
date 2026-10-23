import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { expect } from '@playwright/test';
import { createNativeSession } from './session.mjs';

const { values } = parseArgs({
  options: {
    app: { type: 'string' },
    commit: { type: 'string' },
    version: { type: 'string' },
    output: { type: 'string' },
  },
});
for (const key of ['app', 'commit', 'version', 'output'])
  assert(values[key], `--${key} is required`);
assert.equal(process.platform, 'darwin', 'This lane verifies native macOS URL delivery');
await mkdir(values.output, { recursive: false });
const session = await createNativeSession({
  packagePath: values.app,
  commit: values.commit,
  version: values.version,
});
const report = { commit: values.commit, version: values.version, status: 'running', cases: [] };
let active;
async function capture(page, name) {
  const filename = `${name}.png`;
  await page.screenshot({ path: path.join(values.output, filename) });
  return {
    path: filename,
    sha256: createHash('sha256')
      .update(await readFile(path.join(values.output, filename)))
      .digest('hex'),
  };
}
async function taskSurface(page, task, mode, section) {
  const dialog = page.getByRole('dialog', { name: `Task workspace: ${task.title}`, exact: true });
  await expect(dialog).toBeVisible();
  await expect(
    dialog
      .getByRole('navigation', { name: 'Task workspace modes' })
      .getByRole('button', { name: mode, exact: true })
  ).toHaveAttribute('aria-current', 'page');
  await expect(dialog.getByRole('tab', { name: section, exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
}
async function osLink(url) {
  await promisify(execFile)('open', ['-a', values.app, url], { timeout: 10_000 });
}
try {
  active = await session.launch();
  const task = await active.page.evaluate(async () => {
    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Native task link fixture', type: 'code', priority: 'medium' }),
    });
    if (!response.ok) throw new Error(`Disposable task creation failed: HTTP ${response.status}`);
    const body = await response.json();
    return body.data ?? body;
  });
  const uri = `veritas://task/${encodeURIComponent(task.id)}`;
  await osLink(`${uri}?tab=work-products`);
  await taskSurface(active.page, task, 'Results', 'Work Products');
  report.cases.push({
    name: 'existing-app-os-link',
    taskId: task.id,
    tab: 'work-products',
    screenshot: await capture(active.page, 'existing-app'),
  });
  await active.page.keyboard.press('Escape');
  await expect(
    active.page.getByRole('dialog', { name: `Task workspace: ${task.title}`, exact: true })
  ).toHaveCount(0);
  await osLink('veritas://task/task_native_missing_fixture');
  await expect(
    active.page.getByText(
      'The requested task could not be opened. Check your access or try the link again.',
      { exact: true }
    )
  ).toBeVisible();
  report.cases.push({
    name: 'missing-task-visible-failure',
    screenshot: await capture(active.page, 'missing-task'),
  });
  await active.app.evaluate(({ Menu }) => {
    const find = (menu) => {
      for (const item of menu.items) {
        if (item.label === 'Command Center') return item;
        const nested = item.submenu && find(item.submenu);
        if (nested) return nested;
      }
    };
    const command = find(Menu.getApplicationMenu());
    if (!command?.enabled) throw new Error('Command Center menu unavailable');
    command.click();
  });
  await expect(active.page.getByRole('textbox', { name: 'Search commands' })).toBeVisible();
  await active.page.keyboard.press('Escape');
  report.cases.push({ name: 'ordinary-command-center-menu', status: 'passed' });
  await active.page.evaluate(async () => {
    const response = await fetch('/api/auth/logout', { method: 'POST' });
    if (!response.ok) throw new Error(`Disposable logout failed: HTTP ${response.status}`);
  });
  await active.app.close();
  active = undefined;
  active = await session.launch({
    deepLink: `${uri}?tab=timeline`,
    beforeAuthenticate: async ({ page }) => {
      await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
      await expect(page.getByRole('dialog', { name: /^Task workspace:/ })).toHaveCount(0);
      report.cases.push({
        name: 'cold-start-link-waits-for-login',
        screenshot: await capture(page, 'locked-cold-start'),
      });
    },
  });
  await taskSurface(active.page, task, 'History', 'Timeline');
  report.cases.push({
    name: 'cold-start-link-after-login',
    taskId: task.id,
    tab: 'timeline',
    screenshot: await capture(active.page, 'cold-start-task'),
  });
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  try {
    if (active) await active.app.close();
  } catch (error) {
    report.status = 'failed';
    report.shutdownError = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
  }
  await writeFile(
    path.join(values.output, 'task-deep-links.json'),
    JSON.stringify(report, null, 2) + '\n'
  );
}

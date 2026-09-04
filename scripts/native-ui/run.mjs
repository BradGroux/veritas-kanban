#!/usr/bin/env node
/* global window, document, innerWidth, innerHeight, getComputedStyle, requestAnimationFrame */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { _electron, expect } from '@playwright/test';
import {
  fileDigest,
  geometryFailures,
  modes,
  packageDigest,
  routes,
  schema,
  settingsSections,
  states,
} from './contract.mjs';
import { installPreviewFixture } from './preview-fixture.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const [packageArgument, outputArgument] = process.argv.slice(2);
assert(
  packageArgument?.endsWith('.app') && outputArgument,
  'Usage: node scripts/native-ui/run.mjs <candidate.app> <new-evidence-directory>'
);
assert.equal(process.platform, 'darwin', 'This gate must run on macOS');
const packagePath = await realpath(packageArgument);
const output = path.resolve(outputArgument);
await mkdir(output); // Never overwrite a previous run or its failure artifacts.
const profile = await mkdtemp(path.join(os.tmpdir(), 'vk-native-conformance-'));
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const commit = git('rev-parse', 'HEAD');
const version = JSON.parse(await readFile(path.join(root, 'desktop/package.json'), 'utf8')).version;
const report = {
  schema,
  boundary: 'packaged-macos',
  status: 'running',
  commit,
  dirty: !!git('status', '--porcelain'),
  version,
  packagePath,
  packageDigest: await packageDigest(packagePath),
  startedAt: new Date().toISOString(),
  entries: [],
};
const persist = () =>
  writeFile(path.join(output, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
await persist();
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const password = randomBytes(24).toString('base64url');
const env = Object.fromEntries(
  ['PATH', 'HOME', 'TMPDIR', 'LANG', 'USER', 'LOGNAME']
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]])
);
Object.assign(env, {
  VERITAS_DESKTOP_PROFILE: 'native-ui-conformance',
  VERITAS_DESKTOP_SERVER_PORT: String(port),
});
let app;
let page;
let fixtureTask;
async function launch() {
  app = await _electron.launch({
    executablePath: path.join(packagePath, 'Contents/MacOS/veritas-kanban'),
    args: [`--user-data-dir=${profile}`],
    env,
  });
  const actual = await app.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    userData: app.getPath('userData'),
    appPath: app.getAppPath(),
  }));
  assert(actual.packaged, 'Unpackaged runtime is not native acceptance');
  assert.equal(
    await realpath(actual.userData),
    await realpath(profile),
    'Profile isolation failed'
  );
  assert.equal(
    await realpath(actual.appPath),
    await realpath(path.join(packagePath, 'Contents/Resources/app.asar')),
    'Wrong package launched'
  );
  page = await app.firstWindow();
  page.setDefaultTimeout(10_000);
  await page.waitForURL(`${origin}/**`, { timeout: 60_000 });
  const setup = page.getByRole('button', { name: 'Continue to Password', exact: true });
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  const login = page.getByRole('button', { name: 'Login', exact: true });
  await expect(setup.or(settings).or(login)).toBeVisible({ timeout: 30_000 });
  if (await setup.isVisible()) {
    await setup.click();
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create Password', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Save Your Recovery Key' })).toBeVisible();
    await page.reload(); // Never record recovery keys or the synthetic password.
  }
  await expect(login.or(settings)).toBeVisible({ timeout: 30_000 });
  if (await login.isVisible()) {
    await page.getByLabel('Password', { exact: true }).fill(password);
    await login.click();
  }
  await expect(settings).toBeVisible({ timeout: 30_000 });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      report.httpFailures ??= [];
      report.httpFailures.push({
        state: report.entries.at(-1)?.id ?? 'startup',
        path: new URL(response.url()).pathname,
        method: response.request().method(),
        status: response.status(),
      });
    }
  });
  report.identity = await page.evaluate(() => window.veritasDesktop.getAppInfo());
  assert.equal(
    report.identity.buildIdentity,
    commit,
    'Rebuild the candidate with VERITAS_BUILD_SHA equal to HEAD'
  );
  assert.equal(report.identity.version, version);
  await app.evaluate(({ app, BrowserWindow }) => {
    app.focus({ steal: true });
    BrowserWindow.getAllWindows()[0].focus();
  });
}
async function resize(width, height) {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows().find((w) => w.isVisible());
      window.webContents.setZoomFactor(1);
      window.setContentSize(size.width, size.height);
    },
    { width, height }
  );
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height]);
}
async function configure(mode) {
  await resize(mode.width, mode.height);
  if (await page.getByRole('dialog').count()) await page.goto(origin);
  if ((await page.locator('html').getAttribute('data-mantine-color-scheme')) !== mode.theme)
    await button('Toggle theme').click();
  if (new URL(page.url()).pathname !== '/')
    await page
      .getByRole('complementary', { name: 'Desktop navigation' })
      .getByRole('button', { name: 'Board', exact: true })
      .click();
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', mode.theme);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
}
async function metrics() {
  return page.evaluate(() => {
    const shell = document.querySelector('.desktop-app-shell');
    if (!shell) throw new Error('Missing production desktop shell');
    const rect = (el) => {
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right, bottom: b.bottom };
    };
    const paintedOpacity = (el) => {
      let opacity = 1;
      for (let node = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.visibility !== 'visible' || style.display === 'none') return 0;
        opacity *= Number(style.opacity);
      }
      return opacity;
    };
    return {
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      shell: rect(shell),
      overlays: [
        ...document.querySelectorAll(
          '[data-overlay-active="true"] .vk-overlay-content, .vk-overlay-content[data-overlay-active="true"], [data-testid="task-detail-panel"][data-overlay-active="true"]'
        ),
      ].map((el) => ({
        ...rect(el),
        opacity: paintedOpacity(el),
        overflow: el.scrollWidth - el.clientWidth,
        parts: [
          ...el.querySelectorAll(
            '.vk-overlay-header, .vk-overlay-body, .vk-overlay-footer, .vk-task-workspace-header, .mantine-Drawer-body'
          ),
        ].map((part) => {
          const style = getComputedStyle(part);
          const b = rect(part);
          return {
            name: part.matches('.vk-overlay-header, .vk-task-workspace-header')
              ? 'header'
              : part.matches('.vk-overlay-footer')
                ? 'footer'
                : 'body',
            ...b,
            visible:
              b.width > 0 &&
              b.height > 0 &&
              b.x >= 0 &&
              b.y >= 0 &&
              b.right <= innerWidth + 1 &&
              b.bottom <= innerHeight + 1,
            padding: [
              style.paddingTop,
              style.paddingRight,
              style.paddingBottom,
              style.paddingLeft,
            ].map(parseFloat),
          };
        }),
      })),
    };
  });
}
async function capture(entry) {
  // Native capturePage does not wait for CSS transitions as Playwright screenshots do.
  // Wait for the real fade to complete, then allow the compositor to paint it.
  await expect
    .poll(async () => (await metrics()).overlays.every((overlay) => overlay.opacity >= 0.999))
    .toBe(true);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
  entry.route = new URL(page.url()).pathname;
  entry.theme = await page.locator('html').getAttribute('data-mantine-color-scheme');
  entry.geometry = await metrics();
  const native = await app.evaluate(async ({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows().find((w) => w.isVisible());
    return {
      bounds: window.getBounds(),
      contentBounds: window.getContentBounds(),
      minimumSize: window.getMinimumSize(),
      scaleFactor: screen.getDisplayMatching(window.getBounds()).scaleFactor,
      png: (await window.capturePage()).toPNG().toString('base64'),
    };
  });
  const name = `${entry.id.replaceAll('/', '--')}.png`;
  await writeFile(path.join(output, name), Buffer.from(native.png, 'base64'));
  delete native.png;
  entry.nativeWindow = native;
  entry.screenshot = { path: name, sha256: await fileDigest(path.join(output, name)) };
  assert.deepEqual(geometryFailures(entry.geometry), [], entry.id);
}
const button = (name) => page.getByRole('button', { name, exact: true });
async function dismiss(dialog, opener) {
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  if (opener) await expect(opener).toBeFocused();
}
async function createTask(title) {
  await button('New Task').click();
  const dialog = page.getByRole('dialog', { name: 'Create New Task', exact: true });
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await dialog
    .getByLabel('Description', { exact: true })
    .fill('Public-safe native UI acceptance fixture.');
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/tasks' && r.request().method() === 'POST'
  );
  await dialog.getByRole('button', { name: 'Create Task', exact: true }).click();
  const result = await response;
  assert(result.ok(), 'Synthetic task creation failed');
  await expect(dialog).toBeHidden();
  const body = await result.json();
  return body.data ?? body;
}
async function openTask() {
  if (!fixtureTask) fixtureTask = await createTask('Native public-safe fixture');
  await page.locator(`[data-task-id="${fixtureTask.id}"]`).click();
  const panel = page.getByTestId('task-detail-panel');
  await expect(panel).toBeVisible();
  return panel;
}
async function exercise(state, mode, shot) {
  if (state === 'board') {
    await expect(page.locator('html')).toHaveAttribute('data-client', 'desktop');
    await shot();
  } else if (state.startsWith('route-')) {
    const [, route, title] = routes.find(([id]) => state === `route-${id}`);
    // Use the actual navigation button so route transition and Back are exercised.
    const navLabel =
      {
        'Task Templates': 'Templates',
        'Behavioral Drift Monitor': 'Drift Monitor',
        'Agent Output Scoring': 'Scoring',
        'Agent Policies': 'Policies',
      }[title] ?? title;
    await page
      .getByRole('complementary', { name: 'Desktop navigation' })
      .getByRole('button', { name: navLabel, exact: true })
      .click();
    await expect(page).toHaveURL(`${origin}${route}`);
    const shell = page.locator('[data-page-shell="primary"]');
    await expect(shell.getByRole('heading', { name: title, level: 1, exact: true })).toBeFocused();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(button('Expand right sidebar').or(button('Collapse right sidebar'))).toHaveCount(
      0
    );
    const back = shell.getByRole('button', { name: 'Back', exact: true });
    await expect(back).toHaveText('');
    await shot();
    await back.click();
    await expect(page).toHaveURL(`${origin}/`);
  } else if (state.startsWith('settings-')) {
    const tab = settingsSections.find((label) => state === `settings-${label.toLowerCase()}`);
    const opener = button('Settings');
    await opener.click();
    const dialog = page.locator('.settings-dialog-content');
    await dialog.getByRole('tab', { name: tab, exact: true }).click();
    await expect(dialog.getByRole('tab', { name: tab, exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await shot();
    await dismiss(dialog, opener);
  } else if (state === 'left-rail' || state === 'right-rail') {
    const side = state === 'left-rail' ? 'left' : 'right';
    const expand = button(`Expand ${side} sidebar`);
    if (await expand.isVisible()) await expand.click();
    const collapse = button(`Collapse ${side} sidebar`);
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    const controlled = page.locator(`#${await collapse.getAttribute('aria-controls')}`);
    await expect(controlled).toBeVisible();
    await shot();
    await collapse.click();
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
  } else if (state === 'board-chat' || state === 'squad-chat') {
    const channel = state === 'board-chat' ? 'Board Chat' : 'Squad Chat';
    await button(`Open ${channel}`).click();
    const dock = page.getByRole('region', { name: 'Workbench right dock' });
    await expect(dock).toBeVisible();
    if (state === 'squad-chat') {
      const sender = dock.getByRole('combobox', { name: 'Sending as' });
      await sender.click();
      await expect(page.getByRole('listbox', { name: 'Sending as' })).toBeInViewport();
      await sender.press('Escape');
      await expect(sender).toBeFocused();
    }
    await shot();
    await button(`Close ${channel}`).click();
    await expect(dock).toBeHidden();
  } else if (['task-drawer', 'task-expanded', 'task-chat'].includes(state)) {
    const panel = await openTask();
    if (state === 'task-expanded')
      await panel.getByRole('button', { name: 'Expand task workspace', exact: true }).click();
    if (state === 'task-chat') {
      await panel.getByRole('button', { name: 'Chat', exact: true }).first().click();
      const chat = panel.getByRole('region', { name: /^Task Chat:/ });
      await chat
        .getByRole('textbox', { name: 'Message Task Chat' })
        .fill('Unsent public-safe draft');
      await shot();
      await chat.getByRole('button', { name: 'Close Task Chat panel', exact: true }).click();
      await expect(chat).toBeHidden();
    } else await shot();
    await panel.getByRole('button', { name: 'Close task workspace', exact: true }).click();
    await expect(panel).toBeHidden();
  } else if (state === 'preview') {
    if (!fixtureTask) fixtureTask = await createTask('Native public-safe fixture');
    const removeFixture = await installPreviewFixture(page, fixtureTask.id);
    try {
      const panel = await openTask();
      await panel.getByRole('button', { name: 'Results', exact: true }).click();
      const opener = panel.getByRole('button', { name: 'Preview acceptance.txt', exact: true });
      await opener.click();
      const dialog = page.getByRole('dialog', {
        name: 'Preview: Native acceptance artifact',
        exact: true,
      });
      await expect(dialog).toContainText('Native text evidence');
      await expect(dialog.getByRole('button', { name: 'Download', exact: true })).toBeInViewport({
        ratio: 1,
      });
      await shot({ fixtureBoundary: 'read-only text artifact responses' });
      await dismiss(dialog, opener);
      await panel.getByRole('button', { name: 'Close task workspace', exact: true }).click();
    } finally {
      await removeFixture();
    }
  } else if (state === 'create-template' || state === 'edit-template') {
    await page.goto(`${origin}/templates`);
    const name = `Native template ${mode.id}`;
    if (state === 'edit-template') {
      await page.getByPlaceholder('Search templates...').fill(name);
      await button('Edit').click();
    } else await button('New Template').click();
    const dialog = page.getByRole('dialog', {
      name: state === 'edit-template' ? 'Edit Template' : 'Create New Template',
      exact: true,
    });
    await expect(dialog.getByRole('textbox', { name: 'Template Name', exact: true })).toBeFocused();
    await dialog.getByRole('textbox', { name: 'Template Name', exact: true }).fill(name);
    const text = `# Native acceptance\n\n${'Public-safe description.\n'.repeat(40)}${state}`;
    await dialog.getByLabel('Description Template', { exact: true }).fill(text);
    const scroll = dialog.getByTestId('template-editor-scroll-region');
    await scroll.hover();
    await page.mouse.wheel(0, 900);
    const save = dialog.getByRole('button', {
      name: state === 'edit-template' ? 'Update Template' : 'Create Template',
      exact: true,
    });
    await expect(save).toBeInViewport({ ratio: 1 });
    await shot();
    await save.click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await page.getByPlaceholder('Search templates...').fill(name);
    await button('Edit').click();
    const edited = page.getByRole('dialog', { name: 'Edit Template', exact: true });
    await expect(edited.getByLabel('Description Template', { exact: true })).toHaveValue(text);
    await edited.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(edited).toBeHidden();
  } else if (state === 'header-controls') {
    const header = page.getByRole('navigation', { name: 'Main navigation', exact: true });
    const controls = await header
      .locator('button:visible, input[role="combobox"]:visible')
      .evaluateAll((elements) =>
        elements.map((el) => ({
          name: el.getAttribute('aria-label') || el.textContent.trim(),
          role: el.getAttribute('role'),
        }))
      );
    const exercised = [];
    for (const { name, role } of controls) {
      const control =
        role === 'combobox'
          ? header.getByRole('combobox', { name, exact: true })
          : header.getByRole('button', { name, exact: true });
      if (name === 'Refresh page') {
        await Promise.all([page.waitForEvent('load'), control.click()]);
        await expect(button('Settings')).toBeVisible();
      } else if (/^(Expand|Collapse) (left|right) sidebar$/.test(name)) {
        const before = await control.getAttribute('aria-expanded');
        await control.click();
        const side = name.includes('left') ? 'left' : 'right';
        await expect(
          button(`${before === 'true' ? 'Expand' : 'Collapse'} ${side} sidebar`)
        ).toHaveAttribute('aria-expanded', before === 'true' ? 'false' : 'true');
      } else if (
        name === 'New Task' ||
        name === 'Settings' ||
        name === 'Search' ||
        name === 'Command palette'
      ) {
        await control.click();
        const dialog = page.getByRole('dialog', {
          name: {
            'New Task': 'Create New Task',
            Settings: /^Settings(?: Board Only)?$/,
            Search: 'Universal Search',
            'Command palette': 'Command palette',
          }[name],
          exact: true,
        });
        await expect(dialog).toBeVisible();
        await dismiss(dialog);
      } else if (/^(Open|Close|Switch to) (Board|Squad) Chat$/.test(name)) {
        await control.click();
        const dock = page.getByRole('region', { name: 'Workbench right dock' });
        await expect(dock).toBeVisible();
        await button(name.includes('Squad') ? 'Close Squad Chat' : 'Close Board Chat').click();
        await expect(dock).toBeHidden();
      } else if (name === 'Toggle theme') {
        await control.click();
        await expect(page.locator('html')).toHaveAttribute(
          'data-mantine-color-scheme',
          mode.theme === 'light' ? 'dark' : 'light'
        );
        await control.click();
      } else if (name === 'Workspace') {
        await control.click();
        await expect(page.getByRole('listbox', { name: 'Workspace' })).toBeVisible();
        await control.press('Escape');
      } else if (name === 'More views') {
        await control.click();
        await expect(page.getByRole('menu')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menu')).toBeHidden();
      } else if (name === 'Session menu') {
        await control.click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toBeHidden();
      } else if (/^WebSocket /.test(name)) {
        await control.click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.keyboard.press('Escape');
      } else throw new Error(`Visible header control has no behavioral assertion: ${name}`);
      exercised.push(name);
    }
    assert.equal(exercised.length, controls.length);
    await shot({ headerControls: exercised });
  } else if (state === 'create-task') {
    const opener = button('New Task');
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Create New Task', exact: true });
    await expect(dialog.getByRole('textbox', { name: 'Title', exact: true })).toBeFocused();
    await dialog
      .getByRole('textbox', { name: 'Title', exact: true })
      .fill(`Native acceptance ${mode.id}`);
    await dialog
      .getByLabel('Description', { exact: true })
      .fill('Public-safe native UI acceptance task.');
    await shot();
    await dialog.getByRole('button', { name: 'Create Task', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('heading', { name: `Native acceptance ${mode.id}`, exact: true })
    ).toBeVisible();
  } else if (state === 'confirmation') {
    await button('Settings').click();
    const settings = page.locator('.settings-dialog-content');
    const reset = settings.getByRole('button', { name: 'Reset All', exact: true });
    await reset.click();
    const dialog = page.getByRole('dialog', { name: 'Reset all settings?', exact: true });
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await shot();
    await dismiss(dialog, reset);
    await dismiss(settings, button('Settings'));
  } else if (state === 'search' || state === 'command-palette') {
    const palette = state === 'command-palette';
    if (palette) await page.keyboard.press('Meta+k');
    else await button('Search').click();
    const dialog = page.getByRole('dialog', {
      name: palette ? 'Command palette' : 'Universal Search',
      exact: true,
    });
    await expect(
      dialog.getByRole('textbox', {
        name: palette ? 'Search commands' : 'Search Veritas',
        exact: true,
      })
    ).toBeFocused();
    await shot();
    await dismiss(dialog);
  } else if (state === 'responsive-collapse') {
    await resize(1700, 1000);
    if (await button('Expand left sidebar').isVisible())
      await button('Expand left sidebar').click();
    if (await button('Expand right sidebar').isVisible())
      await button('Expand right sidebar').click();
    await button('Open Board Chat').click();
    await resize(1180, 760);
    await expect(page.getByRole('region', { name: 'Workbench right dock' })).toBeHidden();
    await expect(button('Expand left sidebar')).toBeVisible();
    await expect(button('Expand right sidebar')).toBeVisible();
    await resize(mode.width, mode.height);
    await shot();
  } else if (state === 'relaunch') {
    await app.close();
    app = undefined;
    await launch();
    await expect
      .poll(() => page.evaluate(() => [innerWidth, innerHeight]))
      .toEqual([mode.width, mode.height]);
    await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', mode.theme);
    await expect(
      page.getByRole('heading', { name: `Native acceptance ${mode.id}`, exact: true })
    ).toBeVisible();
    await shot();
  } else {
    throw new Error(`Required scenario has not been implemented: ${state}`);
  }
}
try {
  await launch();
  for (const mode of modes) {
    for (const state of states) {
      const entry = { id: `${mode.id}/${state}`, status: 'running' };
      report.entries.push(entry);
      let captured = false;
      try {
        await configure(mode);
        await exercise(state, mode, async (details) => {
          Object.assign(entry, details);
          await capture(entry);
          captured = true;
          assert.deepEqual(
            [entry.theme, entry.geometry.width, entry.geometry.height],
            [mode.theme, mode.width, mode.height],
            `${entry.id}: capture mode changed during interaction`
          );
        });
        assert(captured, 'Scenario did not capture native evidence');
        entry.completionGeometry = await metrics();
        assert.deepEqual(
          [entry.completionGeometry.width, entry.completionGeometry.height],
          [mode.width, mode.height],
          `${entry.id}: completion viewport changed during interaction`
        );
        assert.deepEqual(
          geometryFailures(entry.completionGeometry),
          [],
          `${entry.id}: after interaction`
        );
        assert.equal(
          (report.httpFailures ?? []).filter(
            (failure) =>
              failure.state === entry.id && (failure.status === 429 || failure.status >= 500)
          ).length,
          0,
          'Native state encountered rate limiting or a server failure'
        );
        entry.status = 'passed';
      } catch (error) {
        entry.status = 'failed';
        entry.error = error.message;
        if (captured) {
          entry.failure = { id: `${entry.id}-failure` };
          try {
            await capture(entry.failure);
          } catch (captureError) {
            entry.failure.captureError = captureError.message;
          }
        } else {
          try {
            await capture(entry);
          } catch (captureError) {
            entry.captureError = captureError.message;
          }
        }
      }
      console.log(
        `${entry.status}: ${entry.id}${entry.error ? `: ${entry.error.split('\n')[0]}` : ''}`
      );
      await persist();
    }
  }
  report.status = report.entries.every((entry) => entry.status === 'passed') ? 'passed' : 'failed';
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
} finally {
  if (app) await app.close();
  report.completedAt = new Date().toISOString();
  await persist();
}
console.log(`Native evidence: ${path.join(output, 'evidence.json')} (${report.status})`);
process.exitCode = report.status === 'passed' ? 0 : 1;

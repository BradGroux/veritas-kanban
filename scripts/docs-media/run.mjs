#!/usr/bin/env node
/* global window, document, innerWidth, innerHeight, getComputedStyle, requestAnimationFrame */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium, expect } from '@playwright/test';
import { createNativeSession } from '../native-ui/session.mjs';
import { contentSizes, fileDigest, packageDigest } from '../native-ui/contract.mjs';
import { maintainedAssets, mediaSchema, mediaEvidenceFailures } from './verify.mjs';
import { encodeInteraction, recordInteraction } from './record.mjs';
import { finalizeCapture } from './finalize.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const [appArgument, outputArgument, mode = 'capture'] = process.argv.slice(2);
assert(
  appArgument?.endsWith('.app') && outputArgument && mode === 'capture',
  'Usage: node scripts/docs-media/run.mjs <candidate.app> <new-external-directory> [capture]'
);
assert.equal(process.platform, 'darwin', 'Desktop documentation captures require macOS');
const output = path.join(
  await realpath(path.dirname(path.resolve(outputArgument))),
  path.basename(outputArgument)
);
const canonicalRoot = await realpath(root);
assert(
  !output.startsWith(canonicalRoot + path.sep) && output !== canonicalRoot,
  'Capture evidence must remain outside the candidate checkout'
);
await mkdir(output); // Refuse to overwrite either successful or failed evidence.
const packagePath = await realpath(appArgument);
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const commit = git('rev-parse', 'HEAD');
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const report = {
  schema: mediaSchema,
  status: 'running',
  mode,
  commit,
  version,
  dirty: git('status', '--porcelain') !== '',
  packagePath,
  packageDigest: await packageDigest(packagePath),
  startedAt: new Date().toISOString(),
  macOS: os.release(),
  assets: [],
};
const persist = () =>
  writeFile(path.join(output, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
await persist();
let app, browser, page;
const session = await createNativeSession({ packagePath, commit, version });
const { origin } = session;
const button = (name) => page.getByRole('button', { name, exact: true });
const panel = () => page.getByTestId('task-detail-panel');
const title = 'Prepare the release candidate';
let mobile = false;

async function apiRequest(method, pathname, data) {
  assert.equal(new URL(page.url()).origin, origin);
  return page.evaluate(
    async ({ method, pathname, data }) => {
      const response = await fetch(pathname, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return { ok: response.ok, status: response.status, body: await response.json() };
    },
    { method, pathname, data }
  );
}

async function settle() {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    if (document.getElementById('documentation-capture-caret')) return;
    const style = document.createElement('style');
    style.id = 'documentation-capture-caret';
    style.textContent =
      'input, textarea, [contenteditable] { caret-color: transparent !important; }';
    document.head.append(style);
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-overlay-active="true"]')].every(
          (element) => Number(getComputedStyle(element).opacity) >= 0.999
        )
      )
    )
    .toBe(true);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
}
async function capture() {
  if (mobile) {
    assert.deepEqual(await page.evaluate(() => [innerWidth, innerHeight]), [390, 844]);
    assert.equal(await page.evaluate(() => typeof window.veritasDesktop), 'undefined');
    return {
      bytes: await page.screenshot({ fullPage: false }),
      width: 390,
      height: 844,
      scaleFactor: 1,
    };
  }
  const native = await app.evaluate(async ({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.isVisible());
    return {
      bounds: win.getBounds(),
      contentBounds: win.getContentBounds(),
      scaleFactor: screen.getDisplayMatching(win.getBounds()).scaleFactor,
      png: (await win.capturePage()).toPNG().toString('base64'),
    };
  });
  assert.equal(native.contentBounds.width, 1700);
  assert.equal(native.contentBounds.height, 1000);
  return {
    bytes: Buffer.from(native.png, 'base64'),
    width: 1700,
    height: 1000,
    scaleFactor: native.scaleFactor,
    nativeWindow: { bounds: native.bounds, contentBounds: native.contentBounds },
  };
}
async function recordAsset(name, captured, method, recording) {
  const file = path.join(output, name);
  report.assets.push({
    name,
    decision: 'replace',
    reason: 'Recaptured the converged interface from the candidate',
    path: `docs/assets/v${version}/${name}`,
    sha256: await fileDigest(file),
    capture: {
      commit,
      version,
      packageDigest: report.packageDigest,
      boundary: mobile ? 'mobile-browser' : 'packaged-macos',
      packaged: !mobile,
      width: captured.width,
      height: captured.height,
      scaleFactor: captured.scaleFactor,
      nativeWindow: captured.nativeWindow,
      method,
      capturedAt: new Date().toISOString(),
    },
    ...(recording ? { recording } : {}),
  });
  await persist();
  console.log(`captured: ${name}`);
}
async function still(name) {
  await settle();
  const captured = await capture();
  await writeFile(path.join(output, name), captured.bytes, { flag: 'wx' });
  await recordAsset(name, captured, 'window-capture');
}
async function openTask() {
  await page.getByRole('heading', { name: title, exact: true }).click();
  await expect(panel()).toBeVisible();
}
async function workspaceMode(name) {
  if (mobile) {
    await page.getByRole('combobox', { name: 'Task workspace mode', exact: true }).click();
    await page.getByRole('option', { name, exact: true }).click();
  } else
    await panel()
      .getByRole('navigation', { name: 'Task workspace modes' })
      .getByRole('button', { name, exact: true })
      .click();
  await expect(panel().locator('#task-workspace-mode-heading')).toHaveText(name);
}
async function interaction(name) {
  await settle();
  const directory = path.join(output, name.replace('.gif', '-frames'));
  const stages = [
    {
      label: 'Board before opening task',
      act: async () => {},
      verify: async () =>
        expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible(),
    },
    {
      label: 'Open task workspace',
      act: openTask,
      verify: async () => expect(panel()).toBeVisible(),
    },
    {
      label: 'Switch to Plan',
      act: () => workspaceMode('Plan'),
      verify: async () =>
        expect(panel().locator('#task-workspace-mode-heading')).toHaveText('Plan'),
    },
    {
      label: 'Return to Overview',
      act: () => workspaceMode('Overview'),
      verify: async () =>
        expect(panel().locator('#task-workspace-mode-heading')).toHaveText('Overview'),
    },
    {
      label: 'Close workspace and return to board',
      act: () => button('Close task workspace').click(),
      verify: async () => expect(panel()).toBeHidden(),
    },
  ];
  const recording = await recordInteraction({ directory, capture, stages });
  encodeInteraction({
    directory,
    output: path.join(output, name),
    fps: recording.fps,
    width: mobile ? 390 : 1200,
  });
  if (!mobile) {
    const video = path.join(output, 'demo-overview.mp4');
    encodeInteraction({ directory, output: video, fps: recording.fps, width: 1200, format: 'mp4' });
    report.demoVideo = {
      name: 'demo-overview.mp4',
      sha256: await fileDigest(video),
      source: path.basename(directory),
    };
  }
  await recordAsset(name, await capture(), 'interaction-recording', {
    path: `${path.basename(directory)}/recording.json`,
    sha256: await fileDigest(path.join(directory, 'recording.json')),
    events: recording.events,
  });
}
async function theme() {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if ((await page.locator('html').getAttribute('data-mantine-color-scheme')) !== 'dark') {
    const toggle = page.getByRole('button', { name: 'Toggle theme', exact: true });
    await toggle.click();
  }
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
}
try {
  assert(!report.dirty, 'Capture requires a clean build checkout');
  const launched = await session.launch();
  ({ app, page } = launched);
  report.identity = launched.identity;
  await app.evaluate(({ BrowserWindow }, sizes) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.isVisible());
    win.webContents.setZoomFactor(1);
    win.setContentSize(sizes.normal.width, sizes.normal.height);
  }, contentSizes);
  await expect
    .poll(() => page.evaluate(() => [innerWidth, innerHeight]))
    .toEqual([contentSizes.normal.width, contentSizes.normal.height]);
  await theme();
  // Use the actual isolated packaged API and its authenticated cookie, no auth bypass.
  for (const [name, status, type] of [
    [title, 'todo', 'code'],
    ['Refresh the visual tour', 'todo', 'content'],
    ['Verify workspace behavior', 'in-progress', 'research'],
    ['Resolve documentation drift', 'blocked', 'content'],
    ['Complete feature verification', 'done', 'research'],
  ]) {
    const response = await apiRequest('POST', '/api/tasks', {
      title: name,
      description: 'Public-safe documentation fixture for the release candidate.',
      type,
      priority: 'medium',
    });
    assert(response.ok, `Fixture creation failed: ${response.status}`);
    const body = response.body;
    const task = body.data ?? body;
    if (status !== 'todo') {
      const changed = await apiRequest('PATCH', `/api/tasks/${task.id}`, { status });
      assert(changed.ok, `Fixture status update failed: ${changed.status}`);
    }
  }
  await page.reload();
  await expect(page.getByRole('button', { name: /^System health: Stable/ })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await still('board-overview.png');
  await interaction('board-to-workspace.gif');
  await openTask();
  await still('task-workspace.png');
  await button('Close task workspace').click();
  await button('Settings').click();
  const settings = page.getByRole('dialog', { name: /^Settings(?: Board Only)?$/ });
  await expect(settings).toBeVisible();
  await still('settings-navigation.png');
  for (const [name, file] of [
    ['Agents', 'agent-providers.png'],
    ['Maintenance', 'maintenance-center.png'],
    ['Notifications', 'notification-adapters.png'],
  ]) {
    await settings.getByRole('tab', { name, exact: true }).click();
    await expect(settings.getByRole('heading', { name, exact: true })).toBeVisible();
    await still(file);
  }
  await button('Close settings').click();
  await button('Command palette').click();
  await expect(page.getByRole('textbox', { name: 'Search commands' })).toBeVisible();
  await still('command-palette.png');
  await page.keyboard.press('Escape');
  await button('Open Board Chat').click();
  await expect(page.getByRole('region', { name: 'Workbench right dock' })).toBeVisible();
  await still('workbench-panel.png');
  await page
    .getByRole('region', { name: 'Workbench right dock' })
    .getByText('Squad Chat', { exact: true })
    .click();
  await expect(page.getByRole('region', { name: 'Squad Chat', exact: true })).toBeVisible();
  await still('squad-chat.png');
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  page = await context.newPage();
  mobile = true;
  await page.goto(origin);
  await session.authenticate(page);
  await expect(page.getByRole('button', { name: 'Mobile board', exact: true })).toBeVisible();
  await button('Mobile board').click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await still('mobile-board.png');
  await interaction('mobile-flow.gif');
  await openTask();
  await still('mobile-task-workspace.png');
  await button('Close task workspace').click();
  await button('Mobile settings').click();
  await expect(page.getByRole('dialog', { name: /^Settings(?: Board Only)?$/ })).toBeVisible();
  await still('mobile-settings.png');
  report.assets.sort((a, b) => maintainedAssets.indexOf(a.name) - maintainedAssets.indexOf(b.name));
  report.completedAt = new Date().toISOString();
  report.status = 'captured';
  assert.deepEqual(mediaEvidenceFailures(report, report), []);
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  const failures = await finalizeCapture({
    report,
    persist,
    resources: [
      [
        'mobile browser',
        async () => {
          if (browser) await browser.close();
        },
      ],
      [
        'native app',
        async () => {
          if (app) await app.close();
        },
      ],
    ],
  });
  if (failures.length) process.exitCode = 1;
}
console.log(
  `Documentation capture: ${path.join(output, 'evidence.json')} (${report.status}; ${mode})`
);

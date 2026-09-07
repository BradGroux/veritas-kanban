/* global AbortSignal, window, document, KeyboardEvent, requestAnimationFrame, PerformanceObserver */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { mkdir, writeFile, readFile, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { verifyLargeBoardJourney } from './large-board-journey.mjs';
const root = path.resolve(import.meta.dirname, '../..');
const { createNativeSession } = await import(
  pathToFileURL(`${root}/scripts/native-ui/session.mjs`)
);
const { SqliteDatabase } = await import(
  pathToFileURL(`${root}/server/src/storage/sqlite/database.ts`)
);
const { SqliteTaskRepository } = await import(
  pathToFileURL(`${root}/server/src/storage/sqlite/task-repository.ts`)
);
const { packageDigest } = await import(pathToFileURL(`${root}/scripts/native-ui/contract.mjs`));
const require = createRequire(`${root}/package.json`);
const { expect } = require('@playwright/test');
assert(
  process.argv[2]?.endsWith('.app') && process.argv[3],
  'Usage: node --import tsx scripts/native-ui/board-performance.mjs <candidate.app> <new-evidence-directory>'
);
const output = path.resolve(process.argv[3]);
await mkdir(output);
const packagePath = await realpath(process.argv[2]);
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
assert.equal(git.status, 0);
const commit = git.stdout.trim();
const version = JSON.parse(await readFile(path.join(root, 'desktop/package.json'), 'utf8')).version;
const session = await createNativeSession({ packagePath, commit, version });
const report = {
  commit,
  version,
  packageDigest: await packageDigest(packagePath),
  profile: session.profile,
  status: 'running',
  origin: session.origin,
  entries: [],
  fixture: {
    descriptionBytes: 4096,
    columns: ['todo', 'in-progress', 'blocked', 'done'],
    dependencies: 'every fifth task depends on first To Do task',
    order: 'explicit position',
    seeding: 'offline canonical SQLite repository, packaged server confirmed stopped',
  },
  viewport: { width: 1360, height: 900 },
  environment: { node: process.version, platform: process.platform, arch: process.arch },
};
const persist = () => writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n');
let app, page;
try {
  ({ app, page } = await session.launch());
  report.identity = await page.evaluate(() => window.veritasDesktop.getAppInfo());
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1360, 900)
  );
  let seeded = 0;
  for (const count of [100, 1000, 5000]) {
    await app.close();
    app = null;
    let serverStopped = false;
    try {
      await fetch(`${session.origin}/api/health`, { signal: AbortSignal.timeout(1000) });
    } catch (error) {
      serverStopped = error.cause?.code === 'ECONNREFUSED';
    }
    if (!serverStopped) throw new Error('Packaged server must be stopped before offline seeding');
    const database = new SqliteDatabase({
      databasePath: `${session.profile}/profiles/native-ui-conformance/workspaces/local/data/.veritas-kanban/veritas.db`,
    });
    database.open();
    try {
      const repository = new SqliteTaskRepository(database);
      for (let i = seeded; i < count; i++)
        await repository.create({
          id: `task_scale_${String(i).padStart(5, '0')}`,
          revision: 1,
          title: `Scale fixture ${String(i).padStart(5, '0')}`,
          description: 'Public-safe board performance fixture. '.repeat(120).slice(0, 4096),
          status: report.fixture.columns[i % 4],
          type: 'code',
          priority: 'medium',
          position: i,
          created: new Date(1700000000000 + i).toISOString(),
          updated: new Date(1700000000000 + i).toISOString(),
          ...(i > 0 && i % 5 === 0 ? { blockedBy: ['task_scale_00000'] } : {}),
        });
    } finally {
      database.close();
    }
    seeded = count;
    console.log(`Seeded ${count} disposable tasks offline`);
    ({ app, page } = await session.launch());
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1360, 900)
    );
    await page.addInitScript(() => {
      performance.setResourceTimingBufferSize(1000);
      window.__scaleLongTasks = [];
      new PerformanceObserver((list) =>
        window.__scaleLongTasks.push(...list.getEntries().map((e) => e.duration))
      ).observe({ type: 'longtask', buffered: true });
    });
    const started = performance.now();
    await page.goto(session.origin);
    await expect
      .poll(
        () =>
          page
            .locator('[data-column-status] .vk-column-status-count')
            .evaluateAll((elements) =>
              elements.reduce((sum, element) => sum + Number(element.textContent), 0)
            ),
        { timeout: 30000 }
      )
      .toBe(count);
    await page.mouse.move(10, 10);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
    const loadRenderMs = performance.now() - started;
    const input = [];
    for (let i = 0; i < 10; i++)
      input.push(
        await page.evaluate(
          () =>
            new Promise((resolve) => {
              const start = performance.now();
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve(performance.now() - start))
              );
            })
        )
      );
    input.sort((a, b) => a - b);
    const metrics = await page.evaluate(() => ({
      cards: document.querySelectorAll('[data-task-id][role="article"]').length,
      elements: document.querySelectorAll('*').length,
      longTasks: window.__scaleLongTasks ?? [],
      heapUsed: performance.memory?.usedJSHeapSize,
    }));
    const responses = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter((entry) => new URL(entry.name).pathname === '/api/tasks')
        .map((entry) => ({
          query: new URL(entry.name).search,
          decodedBytes: entry.decodedBodySize,
          encodedBytes: entry.encodedBodySize,
          durationMs: entry.duration,
        }))
    );
    const entry = {
      count,
      loadRenderMs,
      inputMedianMs: input[5],
      inputP95Ms: input[9],
      responses,
      ...metrics,
    };
    report.entries.push(entry);
    await persist();
    console.log(
      JSON.stringify({
        count,
        loadRenderMs,
        inputP95Ms: entry.inputP95Ms,
        cards: metrics.cards,
        elements: metrics.elements,
      })
    );
    await page.screenshot({ path: `${output}/board-${count}.png` });
    entry.budgets = {
      loadRenderMs: count === 100 ? 1000 : count === 1000 ? 2000 : 5000,
      inputP95Ms: 100,
      cards: 120,
      decodedBytes: count * 1200,
    };
    entry.failures = [];
    for (const key of ['loadRenderMs', 'inputP95Ms', 'cards'])
      if (entry[key] > entry.budgets[key])
        entry.failures.push(`${key}: ${entry[key]} > ${entry.budgets[key]}`);
    const decodedBytes = responses.reduce((sum, response) => sum + response.decodedBytes, 0);
    if (decodedBytes > entry.budgets.decodedBytes)
      entry.failures.push(`decodedBytes: ${decodedBytes} > ${entry.budgets.decodedBytes}`);
    if (responses.some((response) => !response.query.includes('view=board')))
      entry.failures.push('Initial board requested full task records');
    await persist();
    if (count === 5000) {
      report.journey = await verifyLargeBoardJourney(page, count);
      await persist();
    }
  }
  report.status = report.entries.some((entry) => entry.failures.length) ? 'failed' : 'passed';
  if (report.status === 'failed') process.exitCode = 1;
} catch (error) {
  report.status = 'failed';
  report.error = String(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  await persist();
  console.log(JSON.stringify({ status: report.status, error: report.error, output }));
}

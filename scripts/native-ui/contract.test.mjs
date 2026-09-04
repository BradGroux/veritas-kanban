/* global structuredClone */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  contentSizes,
  evidenceFailures,
  geometryFailures,
  modes,
  requiredEntries,
  requiresOverlay,
  requiredOverlayParts,
  packageDigest,
  schema,
  routes,
  seededCases,
} from './contract.mjs';
import { crc32, deflateSync } from 'node:zlib';
import { screenshotSize } from './png.mjs';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const commit = 'a'.repeat(40);
const digest = 'b'.repeat(64);
const now = Date.now();
test('native content sizes fit the hosted macOS runner while retaining expanded width', () => {
  assert.deepEqual(contentSizes, {
    normal: { width: 1700, height: 760 },
    minimum: { width: 1180, height: 760 },
  });
  assert.equal(modes.length, 4);
  assert(modes.every((mode) => mode.height === 760));
});
test('bundle identity includes web resources and rejects external symlinks', async (t) => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'native-ui-contract-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const bundle = path.join(fixture, 'candidate.app');
  await mkdir(bundle);
  await writeFile(path.join(bundle, 'app.asar'), 'fixed runtime');
  await writeFile(path.join(bundle, 'web.js'), 'renderer one');
  const before = await packageDigest(bundle);
  await writeFile(path.join(bundle, 'web.js'), 'renderer two');
  assert.notEqual(await packageDigest(bundle), before);
  await writeFile(path.join(fixture, 'outside.js'), 'external renderer');
  await symlink('../outside.js', path.join(bundle, 'external.js'));
  await assert.rejects(packageDigest(bundle), /escapes bundle/);
});
function report() {
  const value = {
    schema,
    status: 'passed',
    boundary: 'packaged-macos',
    commit,
    packageDigest: digest,
    version: '6.1.6',
    dirty: false,
    httpFailures: [],
    identity: {
      packaged: true,
      platform: 'darwin',
      buildIdentity: commit,
      version: '6.1.6',
      osVersion: '26.0',
    },
    completedAt: new Date(now).toISOString(),
    seededFailures: seededCases.map(([id, reason]) => ({
      id: `seed/${id}`,
      status: 'detected',
      observedFailures: [reason],
      screenshot: { path: `seed--${id}.png`, sha256: digest },
    })),
    entries: requiredEntries.map((id) => {
      const mode = modes.find((mode) => id.startsWith(`${mode.id}/`));
      return {
        id,
        status: 'passed',
        theme: mode.theme,
        screenshot: { path: `${id}.png`, sha256: digest },
        nativeWindow: {
          bounds: { x: 0, y: 0, width: mode.width, height: mode.height },
          contentBounds: { x: 0, y: 0, width: mode.width, height: mode.height },
          scaleFactor: 2,
        },
        completionGeometry: {
          rem: 16,
          width: mode.width,
          height: mode.height,
          scrollWidth: mode.width,
          scrollHeight: mode.height,
          shell: { x: 0, y: 0, width: mode.width, height: mode.height },
          overlays: [],
        },
        geometry: {
          rem: 16,
          primaryHeader: {
            header: { x: 0, y: 0, width: 1000, height: 82, right: 1000, bottom: 82 },
            title: { x: 52, y: 0, width: 200, height: 32, right: 252, bottom: 32 },
            back: { x: 0, y: 2, width: 40, height: 40, right: 40, bottom: 42 },
            content: { x: 0, y: 82, width: 1000, height: 500, right: 1000, bottom: 582 },
            titleText: routes.find(([name]) => id.endsWith(`/route-${name}`))?.[2],
            titleCount: 1,
            backText: '',
            boardRailControls: 0,
            fontSize: 24,
            lineHeight: 32,
          },
          width: mode.width,
          height: mode.height,
          scrollWidth: mode.width,
          scrollHeight: mode.height,
          shell: { x: 0, y: 0, width: mode.width, height: mode.height },
          overlays: requiresOverlay(id)
            ? [
                {
                  x: 1,
                  y: 1,
                  width: mode.width - 2,
                  height: mode.height - 2,
                  right: mode.width - 1,
                  bottom: mode.height - 1,
                  overflow: 0,
                  opacity: 1,
                  parts: requiredOverlayParts(id).map((kind) => ({
                    x: 2,
                    y: 2,
                    width: 100,
                    height: 30,
                    right: 102,
                    bottom: 32,
                    name: kind.includes('header')
                      ? 'header'
                      : kind === 'footer'
                        ? 'footer'
                        : 'body',
                    insetKind: kind,
                    visible: true,
                    padding:
                      kind === 'header'
                        ? [10, 16, 10, 16]
                        : kind === 'task-body'
                          ? [0, 0, 0, 0]
                          : [16, 16, 16, 16],
                  })),
                },
              ]
            : [],
        },
      };
    }),
  };
  for (const seed of value.seededFailures) {
    const state = ['seed/clipped-modal', 'seed/overlay-padding'].includes(seed.id)
      ? 'create-task'
      : 'route-activity';
    seed.geometry = structuredClone(
      value.entries.find((entry) => entry.id === `light-normal/${state}`).geometry
    );
    if (seed.id === 'seed/shell-blank') seed.geometry.shell.height -= 100;
    if (seed.id === 'seed/clipped-modal') {
      const overlay = seed.geometry.overlays[0];
      overlay.x += 1700;
      overlay.right += 1700;
    }
    if (seed.id === 'seed/heading-offset') {
      seed.geometry.primaryHeader.title.y += 16;
      seed.geometry.primaryHeader.title.bottom += 16;
    }
    if (seed.id === 'seed/context-invalid-header')
      seed.geometry.primaryHeader.boardRailControls = 1;
    if (seed.id === 'seed/overlay-padding')
      seed.geometry.overlays[0].parts[0].padding = [0, 0, 0, 0];
    if (seed.id === 'seed/dead-header')
      seed.behavior = {
        control: 'New Task',
        visibleBefore: true,
        enabledBefore: true,
        dialogVisibleBefore: false,
        clickCompleted: true,
        waitedMs: 1000,
        dialogVisibleAfter: false,
      };
  }
  return value;
}
const failures = (value) =>
  evidenceFailures(value, { commit, packageDigest: digest, version: '6.1.6' }, now);
test('complete candidate-bound matrix is accepted by the structural validator', () =>
  assert.deepEqual(failures(report()), []));
test('late rate limits and server failures reject otherwise passing native evidence', () => {
  for (const status of [429, 500, 503]) {
    for (const state of ['startup', 'light-normal/board', 'seed/dead-header', 'teardown']) {
      const r = report();
      r.httpFailures.push({ state, path: '/api/tasks', method: 'GET', status });
      assert(
        failures(r).includes(`${state}: HTTP ${status} GET /api/tasks`),
        `accepted late HTTP ${status} in ${state}`
      );
    }
  }
});
test('missing or malformed HTTP evidence fails closed', () => {
  for (const httpFailures of [undefined, null, {}, [{ status: '500' }]]) {
    const r = report();
    r.httpFailures = httpFailures;
    assert(failures(r).includes('missing or malformed native HTTP evidence'));
  }
});
test('a missing optional chat session is not a server failure', () => {
  const r = report();
  r.httpFailures.push({
    state: 'light-normal/task-chat',
    path: '/api/chat/sessions/task_fixture',
    method: 'GET',
    status: 404,
  });
  assert.deepEqual(failures(r), []);
});
test('partial, duplicate and failed matrices cannot pass', () => {
  for (const mutate of [
    (r) => r.entries.pop(),
    (r) => (r.entries[1] = r.entries[0]),
    (r) => (r.entries[0].status = 'failed'),
    (r) => r.seededFailures.pop(),
    (r) => (r.seededFailures[0].observedFailures = []),
  ]) {
    const r = report();
    mutate(r);
    assert(failures(r).length);
  }
});
test('browser, dirty, stale, wrong-commit and wrong-package reports fail closed', () => {
  for (const mutate of [
    (r) => (r.boundary = 'browser'),
    (r) => (r.identity.packaged = false),
    (r) => (r.dirty = true),
    (r) => (r.completedAt = '2020-01-01'),
    (r) => (r.commit = 'c'.repeat(40)),
    (r) => (r.identity.buildIdentity = null),
    (r) => (r.packageDigest = 'c'.repeat(64)),
  ]) {
    const r = report();
    mutate(r);
    assert(failures(r).length);
  }
});
test('seeded shell blank space and root overflow fail', () => {
  const r = report();
  r.entries[0].geometry.shell.height -= 200;
  assert(failures(r).some((message) => message.includes('fill viewport')));
  r.entries[0].geometry.scrollHeight += 1_000;
  assert(failures(r).some((message) => message.includes('shell overflow')));
});
test('seeded clipped overlay and unreachable footer fail', () => {
  const g = report().entries[0].geometry;
  g.overlays = [
    {
      x: 10,
      y: 10,
      right: g.width + 20,
      bottom: g.height,
      overflow: 0,
      parts: [{ name: 'footer', visible: false, padding: [16, 16, 16, 16] }],
    },
  ];
  assert.deepEqual(geometryFailures(g), [
    'inconsistent overlay footer padding',
    'unmeasured overlay',
    'transparent or unmeasured overlay',
    'missing overlay header/body',
    'clipped overlay',
    'unreachable or unmeasured overlay footer',
  ]);
});
test('heading, Back, context-invalid controls and inconsistent route baselines fail closed', () => {
  for (const mutate of [
    (h) => {
      h.title.y += 8;
    },
    (h) => {
      h.back.width = 20;
    },
    (h) => {
      h.fontSize = 12;
    },
    (h) => {
      h.backText = 'Back';
    },
    (h) => {
      h.boardRailControls = 1;
    },
    (h) => {
      h.content.y += 20;
    },
    (h) => {
      for (const key of ['header', 'title', 'back', 'content']) {
        h[key].x -= 2000;
        h[key].right -= 2000;
      }
    },
    (h) => {
      h.back.right = 999;
    },
    (h) => {
      h.title.width = 1200;
      h.title.right = h.title.x + 1200;
    },
  ]) {
    const r = report();
    mutate(
      r.entries.find((entry) => entry.id === 'light-normal/route-workflows').geometry.primaryHeader
    );
    assert(failures(r).length);
  }
});
test('insets use the shared rem contract, including zero-padding compound bodies', () => {
  const r = report();
  const g = r.entries.find((entry) => entry.id === 'light-normal/create-task').geometry;
  const overlay = g.overlays[0];
  overlay.parts[1].padding = [0, 0, 0, 0];
  assert(geometryFailures(g).includes('inconsistent overlay body padding'));
  overlay.compound = true;
  assert.deepEqual(geometryFailures(g), []);
  overlay.parts[0].padding[1] = 4;
  assert(geometryFailures(g).includes('inconsistent overlay header padding'));
});
test('claimed seed detection requires retained defective measurements and behavioral evidence', () => {
  for (const seedIndex of seededCases.keys()) {
    const r = report();
    const seed = r.seededFailures[seedIndex];
    delete seed.geometry;
    assert(failures(r).some((error) => error.startsWith(seed.id)));
  }
  for (const seedIndex of seededCases.keys()) {
    const r = report();
    const seed = r.seededFailures[seedIndex];
    seed.geometry = structuredClone(
      r.entries.find((entry) => entry.id === 'light-normal/route-activity').geometry
    );
    delete seed.behavior;
    assert(failures(r).some((error) => error.startsWith(seed.id)));
  }
  for (const mutate of [
    (b) => {
      b.clickCompleted = false;
    },
    (b) => {
      b.visibleBefore = false;
    },
    (b) => {
      b.enabledBefore = false;
    },
    (b) => {
      b.dialogVisibleBefore = true;
    },
    (b) => {
      b.dialogVisibleAfter = true;
    },
    (b) => {
      b.waitedMs = 10;
    },
  ]) {
    const r = report();
    mutate(r.seededFailures.find((seed) => seed.id === 'seed/dead-header').behavior);
    assert(failures(r).some((error) => error.startsWith('seed/dead-header')));
  }
});
test('required footer and compound scroll measurements cannot disappear', () => {
  for (const [state, kind] of [
    ['confirmation', 'footer'],
    ['create-task', 'scroll'],
    ['settings-general', 'scroll'],
  ]) {
    const r = report();
    const overlay = r.entries.find((entry) => entry.id === `light-normal/${state}`).geometry
      .overlays[0];
    overlay.parts = overlay.parts.filter((part) => part.insetKind !== kind);
    assert(failures(r).some((error) => error.includes(`missing required overlay ${kind}`)));
  }
  const g = report().entries.find((entry) => entry.id === 'light-normal/create-task').geometry;
  g.overlays[0].compound = true;
  g.overlays[0].parts = g.overlays[0].parts.filter((part) => part.insetKind !== 'scroll');
  assert(geometryFailures(g).includes('missing compound overlay scroll'));
});
test('missing overlay measurements and invalid native bounds fail closed', () => {
  for (const mutate of [
    (r) => (r.entries.find((e) => requiresOverlay(e.id)).geometry.overlays = []),
    (r) => (r.entries.find((e) => requiresOverlay(e.id)).geometry.overlays = [{ parts: [] }]),
    (r) => (r.entries[0].nativeWindow.bounds = {}),
    (r) => (r.entries[0].nativeWindow.scaleFactor = -2),
    (r) => (r.entries.find((e) => requiresOverlay(e.id)).geometry.overlays[0].width = 0),
    (r) => (r.entries.find((e) => requiresOverlay(e.id)).geometry.overlays[0].opacity = 0),
    (r) => delete r.entries.find((e) => requiresOverlay(e.id)).geometry.overlays[0].opacity,
    (r) => delete r.entries[0].completionGeometry,
    (r) => (r.entries[0].completionGeometry.shell.height -= 100),
    (r) => {
      const g = r.entries[0].completionGeometry;
      g.width = g.scrollWidth = g.shell.width = 0;
      g.height = g.scrollHeight = g.shell.height = 0;
    },
    (r) => delete r.entries.find((e) => requiresOverlay(e.id)).geometry.overlays[0].parts[0].width,
  ]) {
    const r = report();
    mutate(r);
    assert(failures(r).length);
  }
});
test('screenshots require complete, checksummed, decodable PNG data', () => {
  const chunk = (type, data) => {
    const value = Buffer.alloc(data.length + 12);
    value.writeUInt32BE(data.length);
    value.write(type, 4);
    data.copy(value, 8);
    value.writeUInt32BE(crc32(value.subarray(4, -4)), value.length - 4);
    return value;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const valid = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(5))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  assert.deepEqual(screenshotSize(valid), { width: 1, height: 1 });
  assert.throws(() => screenshotSize(valid.subarray(0, 24)));
  assert.throws(() => screenshotSize(valid.subarray(0, -12)));
  const corrupted = Buffer.from(valid);
  corrupted[45] ^= 1;
  assert.throws(() => screenshotSize(corrupted));
});
test('missing screenshots, dimensions and native environment cannot pass', () => {
  for (const mutate of [
    (r) => delete r.entries[0].screenshot,
    (r) => (r.entries[0].geometry.width = 1),
    (r) => delete r.entries[0].nativeWindow,
    (r) => delete r.identity.osVersion,
  ]) {
    const r = report();
    mutate(r);
    assert(failures(r).length);
  }
});

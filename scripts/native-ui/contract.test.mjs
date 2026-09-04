import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evidenceFailures,
  geometryFailures,
  modes,
  requiredEntries,
  requiresOverlay,
  packageDigest,
  schema,
} from './contract.mjs';
import { crc32, deflateSync } from 'node:zlib';
import { screenshotSize } from './png.mjs';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const commit = 'a'.repeat(40);
const digest = 'b'.repeat(64);
const now = Date.now();
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
  return {
    schema,
    status: 'passed',
    boundary: 'packaged-macos',
    commit,
    packageDigest: digest,
    version: '6.1.6',
    dirty: false,
    identity: {
      packaged: true,
      platform: 'darwin',
      buildIdentity: commit,
      version: '6.1.6',
      osVersion: '26.0',
    },
    completedAt: new Date(now).toISOString(),
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
          width: mode.width,
          height: mode.height,
          scrollWidth: mode.width,
          scrollHeight: mode.height,
          shell: { x: 0, y: 0, width: mode.width, height: mode.height },
          overlays: [],
        },
        geometry: {
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
                  parts: ['header', 'body'].map((name) => ({
                    x: 2,
                    y: 2,
                    width: 100,
                    height: 30,
                    right: 102,
                    bottom: 32,
                    name,
                    visible: true,
                    padding: [16, 16, 16, 16],
                  })),
                },
              ]
            : [],
        },
      };
    }),
  };
}
const failures = (value) =>
  evidenceFailures(value, { commit, packageDigest: digest, version: '6.1.6' }, now);
test('complete candidate-bound matrix is accepted by the structural validator', () =>
  assert.deepEqual(failures(report()), []));
test('partial, duplicate and failed matrices cannot pass', () => {
  for (const mutate of [
    (r) => r.entries.pop(),
    (r) => (r.entries[1] = r.entries[0]),
    (r) => (r.entries[0].status = 'failed'),
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
    'unmeasured overlay',
    'transparent or unmeasured overlay',
    'missing overlay header/body',
    'clipped overlay',
    'unreachable or unmeasured overlay footer',
  ]);
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

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { maintainedAssets, mediaSchema } from './verify.mjs';
import {
  publicationSchema,
  verifyPublishedMedia,
  verifyPublicationHistory,
} from './publication.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'media-publication-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'repo');
  const captureDirectory = path.join(directory, 'capture');
  await mkdir(root);
  await mkdir(captureDirectory);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  await writeFile(path.join(root, 'app.js'), 'original application');
  git('add', '.');
  git('commit', '-qm', 'build');
  const buildCommit = git('rev-parse', 'HEAD');
  const expected = { commit: buildCommit, version: '6.1.7', packageDigest: 'b'.repeat(64) };
  const capture = {
    schema: mediaSchema,
    status: 'captured',
    mode: 'capture',
    dirty: false,
    ...expected,
    completedAt: new Date(Date.now() - 1000).toISOString(),
    assets: maintainedAssets.map((name) => ({
      name,
      decision: 'replace',
      reason: 'Current public interface',
      path: `docs/assets/v6.1.7/${name}`,
      sha256: hash(name),
      capture: {
        ...expected,
        boundary: name.startsWith('mobile-') ? 'mobile-browser' : 'packaged-macos',
        packaged: !name.startsWith('mobile-'),
        width: name.startsWith('mobile-') ? 390 : 1700,
        height: name.startsWith('mobile-') ? 844 : 760,
        scaleFactor: 1,
        method: name.endsWith('.gif') ? 'interaction-recording' : 'window-capture',
        capturedAt: new Date(Date.now() - 2000).toISOString(),
      },
    })),
    demoVideo: { name: 'demo-overview.mp4', sha256: hash('recorded video') },
  };
  await mkdir(path.join(root, 'docs/assets/v6.1.7'), { recursive: true });
  await mkdir(path.join(root, 'assets'));
  for (const asset of capture.assets) {
    await writeFile(path.join(root, asset.path), asset.name);
    await writeFile(path.join(captureDirectory, asset.name), asset.name);
  }
  for (const file of ['assets/demo-overview.mp4', 'docs/assets/demo-overview.mp4'])
    await writeFile(path.join(root, file), 'recorded video');
  await writeFile(path.join(captureDirectory, 'demo-overview.mp4'), 'recorded video');
  await writeFile(path.join(root, 'README.md'), '![Board](docs/assets/v6.1.7/board-overview.png)');
  git('add', '.');
  git('commit', '-qm', 'publish captured media');
  expected.publicationCommit = git('rev-parse', 'HEAD');
  const captureBytes = JSON.stringify(capture);
  await writeFile(path.join(captureDirectory, 'evidence.json'), captureBytes);
  const publication = {
    schema: publicationSchema,
    status: 'verified',
    publicationCommit: expected.publicationCommit,
    verifiedAt: new Date().toISOString(),
    captureManifest: { path: 'evidence.json', sha256: hash(captureBytes) },
  };
  const evidencePath = path.join(captureDirectory, 'publication.json');
  await writeFile(evidencePath, JSON.stringify(publication));
  return {
    root,
    git,
    capture,
    publication,
    captureDirectory,
    evidencePath,
    expected,
    args: {
      root,
      evidencePath,
      expected,
      maintainedContents: [['README.md', await readFile(path.join(root, 'README.md'), 'utf8')]],
    },
  };
}

test('a docs-only publication verifies original captured bytes without a second recording', async (t) => {
  const f = await fixture(t);
  assert.notEqual(f.expected.commit, f.expected.publicationCommit);
  assert.deepEqual(await verifyPublishedMedia(f.args), []);
  assert.equal(
    JSON.parse(await readFile(path.join(f.captureDirectory, 'evidence.json'))).commit,
    f.expected.commit
  );
});

test('changed app code, dependency files, and executable docs require a new capture', async (t) => {
  for (const file of ['app.js', 'pnpm-lock.yaml', 'docs/executable.md']) {
    const f = await fixture(t);
    await writeFile(path.join(f.root, file), 'changed', {
      mode: file.endsWith('.md') ? 0o755 : 0o644,
    });
    f.git('add', '.');
    f.git('commit', '-qm', 'changed source');
    assert.throws(
      () =>
        verifyPublicationHistory({
          root: f.root,
          buildCommit: f.expected.commit,
          publicationCommit: f.git('rev-parse', 'HEAD'),
          version: f.expected.version,
        }),
      /requires a new build\/capture/
    );
  }
});

test('changing and reverting app code still requires a new capture, including merged history', async (t) => {
  for (const merge of [false, true]) {
    const f = await fixture(t);
    if (merge) f.git('checkout', '-qb', 'intervening');
    await writeFile(path.join(f.root, 'app.js'), 'temporary code change');
    f.git('add', '.');
    f.git('commit', '-qm', 'change app');
    f.git('revert', '--no-edit', 'HEAD');
    if (merge) {
      f.git('checkout', '-q', '-');
      f.git('merge', '--no-ff', '-m', 'merge reverted code', 'intervening');
    }
    assert.equal(f.git('diff', f.expected.publicationCommit, 'HEAD'), '');
    assert.throws(
      () =>
        verifyPublicationHistory({
          root: f.root,
          buildCommit: f.expected.commit,
          publicationCommit: f.git('rev-parse', 'HEAD'),
          version: f.expected.version,
        }),
      /requires a new build\/capture/
    );
  }
});

test('docs-only merge commits can publish the captured build', async (t) => {
  const f = await fixture(t);
  f.git('checkout', '-qb', 'docs');
  await writeFile(path.join(f.root, 'docs/guide.md'), 'documentation');
  f.git('add', '.');
  f.git('commit', '-qm', 'write guide');
  f.git('checkout', '-q', '-');
  f.git('merge', '--no-ff', '-m', 'merge docs', 'docs');
  assert.doesNotThrow(() =>
    verifyPublicationHistory({
      root: f.root,
      buildCommit: f.expected.commit,
      publicationCommit: f.git('rev-parse', 'HEAD'),
      version: f.expected.version,
    })
  );
});

test('dirty, stale, and unrelated publication history cannot reuse a build', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'README.md'), 'uncommitted edit');
  assert((await verifyPublishedMedia(f.args)).some((error) => error.includes('must be clean')));
  f.git('add', '.');
  f.git('commit', '-qm', 'later docs');
  assert(
    (await verifyPublishedMedia(f.args)).some((error) => error.includes('Stale publication commit'))
  );
  f.git('checkout', '--orphan', 'unrelated');
  f.git('commit', '-qm', 'unrelated root');
  assert.throws(
    () =>
      verifyPublicationHistory({
        root: f.root,
        buildCommit: f.expected.commit,
        publicationCommit: f.git('rev-parse', 'HEAD'),
        version: f.expected.version,
      }),
    /publication history/
  );
});

test('modified original captures or their manifest fail even when published assets are unchanged', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.captureDirectory, 'board-overview.png'), 'other pixels');
  assert(
    (await verifyPublishedMedia(f.args)).some((error) =>
      error.includes('original captured bytes changed')
    )
  );
  await writeFile(path.join(f.captureDirectory, 'board-overview.png'), 'board-overview.png');
  await writeFile(
    path.join(f.captureDirectory, 'evidence.json'),
    JSON.stringify({ ...f.capture, dirty: true })
  );
  assert(
    (await verifyPublishedMedia(f.args)).some((error) =>
      error.includes('Original capture manifest changed')
    )
  );
});

test('media must be committed unchanged, including both demo-video copies', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'docs/assets/demo-overview.mp4'), 'different video');
  f.git('add', '.');
  f.git('commit', '-qm', 'altered video');
  f.expected.publicationCommit = f.git('rev-parse', 'HEAD');
  f.publication.publicationCommit = f.expected.publicationCommit;
  await writeFile(f.evidencePath, JSON.stringify(f.publication));
  assert(
    (await verifyPublishedMedia(f.args)).some((error) => error.includes('committed media differs'))
  );
});

test('a symlink cannot substitute an external original capture', async (t) => {
  const f = await fixture(t);
  const file = path.join(f.captureDirectory, 'board-overview.png');
  await rm(file);
  await symlink(path.join(f.root, 'docs/assets/v6.1.7/board-overview.png'), file);
  assert((await verifyPublishedMedia(f.args)).some((error) => error.includes('symlink')));
});

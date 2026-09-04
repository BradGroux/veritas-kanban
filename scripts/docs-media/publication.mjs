import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileDigest } from '../native-ui/contract.mjs';
import { maintainedAssets, verifyMediaEvidence } from './verify.mjs';

export const publicationSchema = 'documentation-media-publication/v1';
const sha = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `Cannot verify publication history: ${result.stderr.trim()}`);
  return result.stdout;
}

function publicationPath(file, version) {
  return (
    file === 'README.md' ||
    /^docs\/(?:[^/]+\/)*[^/]+\.md$/.test(file) ||
    file === 'docs/index.json' ||
    file === 'docs/demo/index.html' ||
    ['assets/demo-overview.mp4', 'docs/assets/demo-overview.mp4'].includes(file) ||
    maintainedAssets.some((name) => file === `docs/assets/v${version}/${name}`)
  );
}

function verifyCommittedFile(root, commit, file, expectedDigest) {
  const tree = git(root, 'ls-tree', commit, '--', file).trim();
  assert(tree.startsWith('100644 blob '), `${file}: media is not a committed regular file`);
  const blob = spawnSync('git', ['cat-file', 'blob', `${commit}:${file}`], {
    cwd: root,
    maxBuffer: 256 * 1024 * 1024,
  });
  assert.equal(blob.status, 0, `${file}: cannot read committed media`);
  assert.equal(
    createHash('sha256').update(blob.stdout).digest('hex'),
    expectedDigest,
    `${file}: committed media differs from the original capture`
  );
}

// A later documentation commit must not broaden which application build passed.
// Inspect Git objects, not a producer-supplied changed-files list.
export function verifyPublicationHistory({ root, buildCommit, publicationCommit, version }) {
  assert(sha(buildCommit) && sha(publicationCommit), 'Invalid build/publication commit');
  assert.equal(
    git(root, 'rev-parse', 'HEAD').trim(),
    publicationCommit,
    'Stale publication commit'
  );
  assert.equal(git(root, 'status', '--porcelain').trim(), '', 'Publication checkout must be clean');
  git(root, 'merge-base', '--is-ancestor', buildCommit, publicationCommit);
  const commits = git(root, 'rev-list', `${buildCommit}..${publicationCommit}`)
    .trim()
    .split('\n')
    .filter(Boolean);
  for (const commit of commits) {
    const records = git(
      root,
      'diff-tree',
      '-m',
      '--root',
      '--no-commit-id',
      '-r',
      '--raw',
      '--no-abbrev',
      '--no-renames',
      '--no-ext-diff',
      '-z',
      commit,
      '--'
    )
      .split('\0')
      .filter(Boolean);
    for (let index = 0; index < records.length; index += 2) {
      const [oldMode, newMode] = records[index].slice(1).split(' ');
      const file = records[index + 1];
      assert(
        publicationPath(file, version) &&
          ['000000', '100644'].includes(oldMode) &&
          ['000000', '100644'].includes(newMode),
        `Application or unsupported publication change requires a new build/capture: ${file}`
      );
    }
  }
}

async function sibling(evidencePath, name) {
  assert(
    typeof name === 'string' && name !== '.' && name !== '..' && path.basename(name) === name,
    'Invalid capture artifact filename'
  );
  const directory = await realpath(path.dirname(evidencePath));
  const intended = path.join(directory, name);
  assert.equal(await realpath(intended), intended, 'Capture artifact traverses a symlink');
  return intended;
}

export async function loadMediaPublication({ evidencePath, root, publicationCommit, publication }) {
  publication ??= JSON.parse(await readFile(evidencePath, 'utf8'));
  assert.equal(publication.schema, publicationSchema, 'Missing documentation publication manifest');
  assert.equal(publication.status, 'verified', 'Documentation publication was not verified');
  assert.equal(publication.publicationCommit, publicationCommit, 'Stale publication commit');
  assert(digest(publication.captureManifest?.sha256), 'Missing original capture manifest digest');
  const capturePath = await sibling(evidencePath, publication.captureManifest.path);
  assert.equal(
    await fileDigest(capturePath),
    publication.captureManifest.sha256,
    'Original capture manifest changed'
  );
  const capture = JSON.parse(await readFile(capturePath, 'utf8'));
  const verified = Date.parse(publication.verifiedAt);
  const completed = Date.parse(capture.completedAt);
  assert(
    Number.isFinite(verified) &&
      Number.isFinite(completed) &&
      verified >= completed &&
      verified <= Date.now(),
    'Invalid publication verification time'
  );
  assert.equal(
    capture.mode,
    'capture',
    'Publication requires an original capture, not a preparation run'
  );
  assert.equal(capture.dirty, false, 'Capture checkout was dirty');
  verifyPublicationHistory({
    root,
    buildCommit: capture.commit,
    publicationCommit,
    version: capture.version,
  });
  return { publication, capture, capturePath };
}

export async function verifyPublishedMedia({
  evidencePath,
  root,
  expected,
  maintainedContents,
  publication,
}) {
  try {
    const { capture, capturePath } = await loadMediaPublication({
      evidencePath,
      root,
      publicationCommit: expected.publicationCommit,
      publication,
    });
    const errors = await verifyMediaEvidence({
      evidencePath: capturePath,
      root,
      expected,
      maintainedContents,
    });
    if (errors.length) return errors;
    for (const asset of capture.assets) {
      if (asset.decision === 'retire') continue;
      verifyCommittedFile(root, expected.publicationCommit, asset.path, asset.sha256);
      assert.equal(
        await fileDigest(await sibling(capturePath, asset.name)),
        asset.sha256,
        `${asset.name}: original captured bytes changed`
      );
    }
    assert.equal(capture.demoVideo?.name, 'demo-overview.mp4', 'Missing captured demo video');
    assert(digest(capture.demoVideo.sha256), 'Missing demo video digest');
    assert.equal(
      await fileDigest(await sibling(capturePath, capture.demoVideo.name)),
      capture.demoVideo.sha256,
      'Original demo video changed'
    );
    const canonicalRoot = await realpath(root);
    for (const file of ['assets/demo-overview.mp4', 'docs/assets/demo-overview.mp4']) {
      verifyCommittedFile(root, expected.publicationCommit, file, capture.demoVideo.sha256);
      const intended = path.join(canonicalRoot, file);
      assert.equal(await realpath(intended), intended, 'Published demo video traverses a symlink');
      assert.equal(
        await fileDigest(intended),
        capture.demoVideo.sha256,
        'Published demo video changed'
      );
    }
    return [];
  } catch (error) {
    return [error.message];
  }
}

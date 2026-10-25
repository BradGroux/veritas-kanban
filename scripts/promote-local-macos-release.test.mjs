import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  assertReleaseDestination,
  assertTagDestination,
  ensureLocalPublicationTag,
  planReleaseAssets,
} from './promote-local-macos-release.mjs';

const commit = 'a'.repeat(40);
const tag = 'v6.3.0';
const notes = 'Reviewed source notes.\n';

test('destination release must remain the matching human-owned draft with exact notes', () => {
  const release = {
    tag_name: tag,
    author: { login: 'BradGroux' },
    body: notes,
    draft: true,
    prerelease: false,
  };
  const expected = { tag, notes, prerelease: false };
  assertReleaseDestination(release, expected);
  for (const change of [
    { tag_name: 'v6.2.1' },
    { author: { login: 'another-account' } },
    { body: notes.trim() },
    { draft: false },
    { prerelease: true },
    { performed_via_github_app: { id: 1 } },
  ])
    assert.throws(() => assertReleaseDestination({ ...release, ...change }, expected));
});

test('tag guard accepts an absent tag for initial creation and peels existing annotated tags', () => {
  assert.equal(assertTagDestination('', tag, commit), false);
  assert.equal(assertTagDestination(`${commit}\trefs/tags/${tag}\n`, tag, commit), true);
  assert.equal(
    assertTagDestination(
      `${'b'.repeat(40)}\trefs/tags/${tag}\n${commit}\trefs/tags/${tag}^{}\n`,
      tag,
      commit
    ),
    true
  );
  for (const listing of [
    `${'c'.repeat(40)}\trefs/tags/${tag}\n`,
    `${commit}\trefs/tags/other\n`,
    `${commit}\trefs/tags/${tag}\n${commit}\trefs/tags/${tag}\n`,
    `${commit}\trefs/tags/${tag}\n${'d'.repeat(40)}\trefs/tags/${tag}^{}\n`,
  ])
    assert.throws(() => assertTagDestination(listing, tag, commit), /never rewrite/);
});

test('partial draft uploads keep matching assets and plan only the missing files', () => {
  const expected = [
    { name: 'app.zip', size: 20, sha256: 'a'.repeat(64) },
    { name: 'latest-mac.yml', size: 5, sha256: 'b'.repeat(64) },
  ];
  const uploaded = {
    name: 'app.zip',
    size: 20,
    state: 'uploaded',
    digest: `sha256:${'a'.repeat(64)}`,
  };
  assert.deepEqual(planReleaseAssets([], expected), expected);
  assert.deepEqual(planReleaseAssets([uploaded], expected), [expected[1]]);
  const legacy = { ...uploaded };
  delete legacy.digest;
  assert.deepEqual(planReleaseAssets([legacy], expected), [expected[1]]); // Actual bytes still require download/readback.
  for (const assets of [
    [uploaded, uploaded],
    [{ ...uploaded, name: '../outside' }],
    [{ ...uploaded, size: 21 }],
    [{ ...uploaded, state: 'starter' }],
    [{ ...uploaded, digest: `sha256:${'c'.repeat(64)}` }],
  ])
    assert.throws(() => planReleaseAssets(assets, expected));
});

test('stable destination requires an annotated tag without tightening other channels', () => {
  const lightweight = `${commit}\trefs/tags/${tag}\n`;
  assert.equal(assertTagDestination(lightweight, tag, commit), true);
  assert.throws(
    () => assertTagDestination(lightweight, tag, commit, { requireAnnotated: true }),
    /annotated remote tag/
  );
  const annotated = `${'b'.repeat(40)}\trefs/tags/${tag}\n${commit}\trefs/tags/${tag}^{}\n`;
  assert.equal(assertTagDestination(annotated, tag, commit, { requireAnnotated: true }), true);
});

test('publication pushes a reusable annotated object to a disposable bare remote', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vk-annotated-tag-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = Object.fromEntries(
    ['PATH', 'HOME', 'TMPDIR']
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]])
  );
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = os.devNull;
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: directory, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init');
  git('config', 'core.hooksPath', os.devNull);
  git('config', 'user.name', 'Release Fixture');
  git('config', 'user.email', '3053586+BradGroux@users.noreply.github.com');
  git('config', 'commit.gpgSign', 'false');
  git('config', 'tag.gpgSign', 'false');
  git('commit', '--allow-empty', '-m', 'fixture');
  const target = git('rev-parse', 'HEAD');
  const remote = path.join(directory, 'remote.git');
  git('init', '--bare', remote);
  git('remote', 'add', 'origin', remote);
  const ref = ensureLocalPublicationTag(git, tag, target, { requireAnnotated: true });
  assert.equal(git('cat-file', '-t', ref), 'tag');
  assert.equal(
    git('for-each-ref', '--format=%(taggeremail)', ref),
    '<3053586+BradGroux@users.noreply.github.com>'
  );
  const object = git('rev-parse', ref);
  assert.notEqual(object, target);
  git('push', 'origin', `${ref}:${ref}`);
  const listing = git('ls-remote', '--tags', 'origin', ref, `${ref}^{}`);
  assert(listing.includes(`${object}\t${ref}`));
  assert.equal(assertTagDestination(listing, tag, target, { requireAnnotated: true }), true);
  ensureLocalPublicationTag(git, tag, target, { requireAnnotated: true });
  assert.equal(git('rev-parse', ref), object);
  const other = 'v6.3.1';
  git('tag', other, target);
  assert.throws(
    () => ensureLocalPublicationTag(git, other, target, { requireAnnotated: true }),
    /annotated local tag/
  );
  assert.equal(git('rev-parse', `refs/tags/${other}`), target);
  assert.throws(
    () => ensureLocalPublicationTag(git, tag, 'f'.repeat(40), { requireAnnotated: true }),
    /Existing local tag differs/
  );
  git('config', 'user.email', 'fixture@example.invalid');
  assert.throws(
    () => ensureLocalPublicationTag(git, 'v6.3.2', target, { requireAnnotated: true }),
    /approved private email/
  );
  assert.equal(git('tag', '--list', 'v6.3.2'), '');
});

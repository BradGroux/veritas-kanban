import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertReleaseDestination,
  assertTagDestination,
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

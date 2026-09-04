import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateArchiveEntries,
  validateCaptureRun,
  validateCandidateMetadata,
  validateCaptureIdentity,
  validateDistributionManifest,
} from './restore-candidate.mjs';

test('promotion accepts only successful explicitly dispatched captures from this workflow/repository', () => {
  const run = {
    conclusion: 'success',
    event: 'workflow_dispatch',
    head_repository: { full_name: 'owner/repo' },
    path: '.github/workflows/desktop-release.yml',
    head_sha: 'a'.repeat(40),
  };
  assert.doesNotThrow(() => validateCaptureRun(run, 'owner/repo'));
  for (const change of [
    { conclusion: 'failure' },
    { event: 'pull_request' },
    { head_repository: { full_name: 'other/repo' } },
    { path: 'other.yml' },
    { head_sha: 'wrong' },
  ])
    assert.throws(() => validateCaptureRun({ ...run, ...change }, 'owner/repo'));
});

test('promotion binds the retained run and native identity to the original update channel', () => {
  const run = { head_sha: 'a'.repeat(40) };
  const candidate = {
    schema: 'retained-macos-candidate/v1',
    runId: '123',
    commit: run.head_sha,
    channel: 'stable',
  };
  const report = {
    commit: run.head_sha,
    version: '6.1.7',
    identity: { buildIdentity: run.head_sha, channel: 'stable' },
  };
  assert.doesNotThrow(() => validateCandidateMetadata(candidate, run, '123', 'stable'));
  assert.doesNotThrow(() => validateCaptureIdentity(report, run, '6.1.7', 'stable'));
  for (const channel of ['beta', 'dev', 'invalid']) {
    assert.throws(() => validateCandidateMetadata(candidate, run, '123', channel));
    assert.throws(() => validateCaptureIdentity(report, run, '6.1.7', channel));
  }
  assert.throws(() => validateCandidateMetadata(candidate, run, '456', 'stable'));
  assert.throws(() =>
    validateCandidateMetadata({ ...candidate, commit: 'b'.repeat(40) }, run, '123', 'stable')
  );
  assert.throws(() => validateCaptureIdentity({ ...report, identity: {} }, run, '6.1.7', 'stable'));
  assert.throws(() =>
    validateCaptureIdentity(
      { ...report, identity: { ...report.identity, buildIdentity: 'b'.repeat(40) } },
      run,
      '6.1.7',
      'stable'
    )
  );
});

test('candidate archives reject traversal, links, devices, and unexpected roots', () => {
  assert.doesNotThrow(() =>
    validateArchiveEntries(
      'release/app.zip\nnative-ui-evidence/evidence.json\ndocumentation-media/board.png\nnative-distribution.sha256\n',
      '-rw-r--r-- file\ndrwxr-xr-x folder\n'
    )
  );
  for (const name of [
    '/release/file',
    'release/../../outside',
    'unexpected/file',
    'documentation-media/../outside',
  ])
    assert.throws(() => validateArchiveEntries(name, '-rw-r--r-- file'), /Unsafe/);
  for (const mode of ['lrwxrwxrwx link', 'brw-r--r-- device', 'hrw-r--r-- hardlink'])
    assert.throws(() => validateArchiveEntries('release/file', mode), /link or special/);
});

test('the distribution checksum list contains each exact release artifact once', () => {
  const names = [
    'latest-mac.yml',
    'Veritas-Kanban-6.1.7-mac-arm64.zip',
    'Veritas-Kanban-6.1.7-mac-arm64.zip.blockmap',
    'Veritas-Kanban-6.1.7-mac-arm64.dmg',
    'Veritas-Kanban-6.1.7-mac-arm64.dmg.blockmap',
  ];
  const manifest = names.map((name) => `${'b'.repeat(64)}  ${name}`).join('\n');
  assert.doesNotThrow(() => validateDistributionManifest(manifest, '6.1.7'));
  assert.throws(() => validateDistributionManifest(manifest, '6.1.8'));
  assert.throws(() =>
    validateDistributionManifest(`${manifest}\n${'b'.repeat(64)}  latest-mac.yml`, '6.1.7')
  );
  assert.throws(() =>
    validateDistributionManifest(manifest.replace('latest-mac.yml', '../outside'), '6.1.7')
  );
  assert.throws(() =>
    validateDistributionManifest(manifest.split('\n').slice(1).join('\n'), '6.1.7')
  );
});

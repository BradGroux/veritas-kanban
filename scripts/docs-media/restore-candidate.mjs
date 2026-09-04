#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateCaptureRun(run, repository) {
  assert.equal(run.conclusion, 'success', 'Capture run did not succeed');
  assert.equal(run.event, 'workflow_dispatch', 'Capture was not explicitly dispatched');
  assert.equal(run.head_repository?.full_name, repository, 'Capture came from another repository');
  assert.equal(
    run.path?.split('@')[0],
    '.github/workflows/desktop-release.yml',
    'Wrong capture workflow'
  );
  assert(/^[a-f0-9]{40}$/.test(run.head_sha ?? ''), 'Missing capture build commit');
}

export function validateCandidateMetadata(candidate, run, runId, channel) {
  assert.equal(candidate.schema, 'retained-macos-candidate/v1', 'Unknown retained candidate');
  assert.equal(candidate.runId, runId, 'Candidate run ID mismatch');
  assert.equal(candidate.commit, run.head_sha, 'Candidate build mismatch');
  assert(['stable', 'beta', 'dev'].includes(channel), 'Invalid publication channel');
  assert.equal(candidate.channel, channel, 'Capture/publication channel mismatch');
}

export function validateCaptureIdentity(report, run, version, channel) {
  assert.equal(report.commit, run.head_sha, 'Capture run/build mismatch');
  assert.equal(report.version, version, 'Release version mismatch');
  assert.equal(report.identity?.buildIdentity, run.head_sha, 'Native build identity mismatch');
  assert.equal(report.identity?.channel, channel, 'Native capture/publication channel mismatch');
}

export function validateArchiveEntries(names, listing) {
  for (const name of names.trim().split('\n')) {
    assert(
      name &&
        !path.posix.isAbsolute(name) &&
        !name.split('/').includes('..') &&
        /^(?:release\/|native-ui-evidence\/|documentation-media\/|native-distribution\.sha256$|release-candidate\.json$)/.test(
          name
        ),
      `Unsafe candidate archive entry: ${name}`
    );
  }
  for (const entry of listing.trim().split('\n'))
    assert(/^[d-]/.test(entry), 'Candidate archive contains a link or special file');
}

export function validateDistributionManifest(text, version) {
  const names = new Set([
    'latest-mac.yml',
    ...['zip', 'dmg'].flatMap((extension) => {
      const name = `Veritas-Kanban-${version}-mac-arm64.${extension}`;
      return [name, `${name}.blockmap`];
    }),
  ]);
  for (const line of text.trim().split('\n')) {
    const match = /^([a-f0-9]{64}) {2}([^/\\]+)$/.exec(line);
    assert(match && names.delete(match[2]), 'Invalid or duplicated distribution checksum');
  }
  assert.equal(names.size, 0, 'Missing distribution checksum');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { CAPTURE_RUN_ID: runId, GITHUB_REPOSITORY: repository, RUNNER_TEMP: temp } = process.env;
    assert(
      /^[1-9][0-9]*$/.test(runId ?? '') && /^[\w.-]+\/[\w.-]+$/.test(repository ?? '') && temp,
      'Missing or invalid capture run context'
    );
    const exec = (command, args) =>
      execFileSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const run = JSON.parse(exec('gh', ['api', `repos/${repository}/actions/runs/${runId}`]));
    validateCaptureRun(run, repository);
    const root = path.resolve(import.meta.dirname, '../..');
    const version = JSON.parse(
      await readFile(path.join(root, 'desktop/package.json'), 'utf8')
    ).version;
    const download = path.join(temp, 'retained-macos-download');
    const output = path.join(temp, 'retained-macos-candidate');
    await mkdir(download);
    await mkdir(output);
    exec('gh', [
      'run',
      'download',
      runId,
      '--repo',
      repository,
      '--name',
      'signed-macos-release-candidate',
      '--dir',
      download,
    ]);
    const archive = path.join(download, 'signed-macos-candidate.tar.gz');
    validateArchiveEntries(exec('tar', ['-tzf', archive]), exec('tar', ['-tvzf', archive]));
    exec('tar', ['-xzf', archive, '-C', output]);
    validateCandidateMetadata(
      JSON.parse(await readFile(path.join(output, 'release-candidate.json'), 'utf8')),
      run,
      runId,
      process.env.VERITAS_UPDATE_CHANNEL
    );
    validateDistributionManifest(
      await readFile(path.join(output, 'native-distribution.sha256'), 'utf8'),
      version
    );
    for (const file of ['documentation-media/evidence.json', 'native-ui-evidence/evidence.json']) {
      const report = JSON.parse(await readFile(path.join(output, file), 'utf8'));
      validateCaptureIdentity(report, run, version, process.env.VERITAS_UPDATE_CHANNEL);
    }
    console.log(
      `Restored capture run ${runId} at build ${run.head_sha}; publication verification is still required.`
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

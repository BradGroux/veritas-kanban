import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createLocalCandidate,
  distributionNames,
  localCandidateFile,
  verifyLocalCandidate,
} from './local-macos-candidate.mjs';
import {
  assertRestorableProtocol,
  restoreProtocolHandler,
  releaseEnvironment,
  validateSigningEnvironment,
  validateKeychainSigningIdentity,
} from './capture-local-macos-release.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const commit = 'a'.repeat(40);
const packageDigest = 'b'.repeat(64);
const version = '6.3.0';
const channel = 'stable';

// These synthetic bytes test retention integrity only, never native acceptance.
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vk-local-packet-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of [
    'release',
    'native-ui-evidence',
    'documentation-media',
    'large-board-evidence',
  ])
    await mkdir(path.join(directory, name));
  const checksums = [];
  for (const name of distributionNames(version)) {
    const bytes = `synthetic ${name}`;
    await writeFile(path.join(directory, 'release', name), bytes);
    checksums.push(`${sha(bytes)}  ${name}`);
  }
  await writeFile(path.join(directory, 'native-distribution.sha256'), checksums.join('\n') + '\n');
  for (const [file, status] of [
    ['native-ui-evidence/evidence.json', 'passed'],
    ['documentation-media/evidence.json', 'captured'],
    ['large-board-evidence/report.json', 'passed'],
  ]) {
    await writeFile(
      path.join(directory, file),
      JSON.stringify({
        status,
        commit,
        version,
        packageDigest,
        dirty: false,
        identity: { buildIdentity: commit, channel },
      })
    );
  }
  for (const file of ['protocol-before.json', 'protocol-after.json'])
    await writeFile(
      path.join(directory, file),
      JSON.stringify({ scheme: 'veritas', applicationPath: '/original.app' })
    );
  await writeFile(
    path.join(directory, 'capture-state.json'),
    JSON.stringify({ status: 'captured' })
  );
  await writeFile(path.join(directory, 'documentation-media', 'board.png'), 'synthetic image');
  return directory;
}

async function seal(directory, changes = {}) {
  const manifest = {
    ...(await createLocalCandidate({
      directory,
      commit,
      tree: 'c'.repeat(40),
      version,
      channel,
      packageDigest,
    })),
    ...changes,
  };
  const bytes = JSON.stringify(manifest);
  await writeFile(path.join(directory, localCandidateFile), bytes);
  return { directory, expectedDigest: sha(bytes) };
}

test('release subprocesses receive signing credentials only in the signing phase', () => {
  const source = {
    PATH: '/test',
    HOME: '/synthetic',
    CSC_LINK: 'synthetic certificate',
    CSC_KEY_PASSWORD: 'synthetic password',
    APPLE_ID: 'synthetic user',
    APPLE_APP_SPECIFIC_PASSWORD: 'synthetic app password',
    APPLE_TEAM_ID: 'synthetic team',
    GITHUB_ACTIONS: 'true',
    GITHUB_TOKEN: 'synthetic token',
    OPENAI_API_KEY: 'synthetic key',
    VITE_API_URL: 'unexpected',
    VERITAS_BUILD_SHA: 'unexpected',
  };
  const ordinary = releaseEnvironment(source, commit, channel);
  assert.deepEqual(
    Object.keys(ordinary).sort(),
    ['CI', 'HOME', 'PATH', 'VERITAS_BUILD_SHA', 'VERITAS_UPDATE_CHANNEL'].sort()
  );
  assert.equal(ordinary.VERITAS_BUILD_SHA, commit);
  const signing = releaseEnvironment(source, commit, channel, true);
  assert.equal(signing.CSC_LINK, source.CSC_LINK);
  assert.equal(signing.APPLE_APP_SPECIFIC_PASSWORD, source.APPLE_APP_SPECIFIC_PASSWORD);
  assert(!('GITHUB_TOKEN' in signing));
  assert.equal(validateSigningEnvironment(signing), 'apple-id');
});

test('notarization rejects absent, partial and conflicting credential modes', () => {
  const certificate = { CSC_LINK: 'synthetic', CSC_KEY_PASSWORD: 'synthetic' };
  const api = {
    APPLE_API_KEY: '/synthetic.p8',
    APPLE_API_KEY_ID: 'synthetic',
    APPLE_API_ISSUER: 'synthetic',
  };
  const password = {
    APPLE_ID: 'synthetic',
    APPLE_APP_SPECIFIC_PASSWORD: 'synthetic',
    APPLE_TEAM_ID: 'synthetic',
  };
  assert.equal(validateSigningEnvironment({ ...certificate, ...api }), 'api-key');
  for (const env of [
    {},
    certificate,
    api,
    { ...certificate, APPLE_ID: 'partial' },
    { ...certificate, ...password, APPLE_API_KEY: 'partial' },
    { ...certificate, ...api, ...password },
  ])
    assert.throws(() => validateSigningEnvironment(env));
});

test('existing Keychain identities and notarization profiles need no exported private key', () => {
  const source = {
    PATH: '/synthetic',
    CSC_NAME: 'a'.repeat(40),
    APPLE_KEYCHAIN_PROFILE: 'existing-profile',
  };
  assert.equal(validateSigningEnvironment(source), 'keychain-profile');
  assert.equal(releaseEnvironment(source, commit, channel).CSC_NAME, undefined);
  assert.equal(releaseEnvironment(source, commit, channel).APPLE_KEYCHAIN_PROFILE, undefined);
  const signing = releaseEnvironment(source, commit, channel, true);
  assert.equal(signing.CSC_NAME, source.CSC_NAME);
  assert.equal(signing.APPLE_KEYCHAIN_PROFILE, source.APPLE_KEYCHAIN_PROFILE);
  const identities =
    '  1) ' +
    'A'.repeat(40) +
    ' "Developer ID Application: Example, Inc. (TEAM)"\n' +
    '  2) ' +
    'B'.repeat(40) +
    ' "Apple Development: Example (TEAM)"\n';
  validateKeychainSigningIdentity(identities, source.CSC_NAME);
  validateKeychainSigningIdentity(identities, 'Example, Inc. (TEAM)');
  for (const value of ['', 'b'.repeat(40), 'Unknown', 'Developer ID Application: Example'])
    assert.throws(() => validateKeychainSigningIdentity(identities, value));
  assert.throws(() =>
    validateKeychainSigningIdentity(identities + identities, 'Example, Inc. (TEAM)')
  );
  for (const env of [
    { ...source, CSC_LINK: 'partial' },
    { ...source, CSC_KEY_PASSWORD: 'partial' },
    { ...source, CSC_LINK: 'synthetic', CSC_KEY_PASSWORD: 'synthetic' },
    { ...source, APPLE_ID: 'partial' },
    { ...source, APPLE_API_KEY: 'partial' },
    {
      ...source,
      APPLE_ID: 'synthetic',
      APPLE_APP_SPECIFIC_PASSWORD: 'synthetic',
      APPLE_TEAM_ID: 'synthetic',
    },
    { ...source, APPLE_KEYCHAIN_PROFILE: '   ' },
  ])
    assert.throws(() => validateSigningEnvironment(env));
});

test('protocol restoration preserves a foreign choice and requires a recoverable backup', () => {
  const original = { scheme: 'veritas', applicationPath: '/original.app' };
  assertRestorableProtocol(original, original);
  assertRestorableProtocol(
    { ...original, applicationPath: '/candidate.app' },
    original,
    '/candidate.app'
  );
  for (const applicationPath of [null, undefined, '/foreign.app'])
    assert.throws(() =>
      assertRestorableProtocol({ ...original, applicationPath }, original, '/candidate.app')
    );
  assert.throws(() => assertRestorableProtocol({ scheme: 'veritas' }, { scheme: 'veritas' }));
  assert.throws(() => assertRestorableProtocol({ ...original, scheme: 'other' }, original));
});

const localTest = process.platform === 'darwin' && process.arch === 'arm64' ? test : test.skip;

test('protocol recovery verifies exact readback and never restores over a foreign handler', async () => {
  const original = { scheme: 'veritas', applicationPath: '/original.app' };
  const candidatePath = '/candidate.app';
  const calls = [];
  let current = { ...original, applicationPath: candidatePath };
  const inspect = async () => {
    calls.push('inspect');
    return current;
  };
  const restore = async (applicationPath) => {
    calls.push(applicationPath);
    current = original;
  };
  assert.deepEqual(
    await restoreProtocolHandler({ original, candidatePath, inspect, restore }),
    original
  );
  assert.deepEqual(calls, ['inspect', '/original.app', 'inspect']);
  calls.length = 0;
  await restoreProtocolHandler({ original, candidatePath, inspect, restore });
  assert.deepEqual(calls, ['inspect', 'inspect']);
  current = { ...original, applicationPath: '/foreign.app' };
  calls.length = 0;
  await assert.rejects(
    restoreProtocolHandler({ original, candidatePath, inspect, restore }),
    /Another application/
  );
  assert.deepEqual(calls, ['inspect']);
  current = { ...original, applicationPath: candidatePath };
  await assert.rejects(
    restoreProtocolHandler({ original, candidatePath, inspect, restore: async () => {} }),
    /readback differs/
  );
  await assert.rejects(
    restoreProtocolHandler({
      original,
      candidatePath,
      inspect,
      restore: async () => {
        throw new Error('setter failed');
      },
    }),
    /setter failed/
  );
});

localTest(
  'local retention verifies the reviewed seal and permits only a later publication record',
  async (t) => {
    const directory = await fixture(t);
    const options = await seal(directory);
    assert.equal((await verifyLocalCandidate({ ...options, version, channel })).commit, commit);
    await assert.rejects(
      verifyLocalCandidate({ ...options, expectedDigest: '0'.repeat(64) }),
      /changed since review/
    );
    await assert.rejects(verifyLocalCandidate({ ...options, version: '6.4.0' }), /version differs/);
    await writeFile(path.join(directory, 'documentation-media/publication.json'), '{}');
    await assert.rejects(verifyLocalCandidate(options), /previous publication/);
    await verifyLocalCandidate({ ...options, allowPublication: true });
    await assert.rejects(
      createLocalCandidate({
        directory,
        commit,
        tree: 'c'.repeat(40),
        version,
        channel,
        packageDigest,
      }),
      /previous publication/
    );
  }
);

for (const file of [
  'release/latest-mac.yml',
  'documentation-media/evidence.json',
  'documentation-media/board.png',
  'native-ui-evidence/evidence.json',
  'large-board-evidence/report.json',
  'protocol-after.json',
  'capture-state.json',
]) {
  localTest(`retention detects modified ${file}`, async (t) => {
    const options = await seal(await fixture(t));
    await writeFile(path.join(options.directory, file), 'changed');
    await assert.rejects(verifyLocalCandidate(options), /files changed/);
  });
}

localTest('retention rejects changed seals, missing files, unknown roots and links', async (t) => {
  const options = await seal(await fixture(t));
  const manifestPath = path.join(options.directory, localCandidateFile);
  const bytes = await readFile(manifestPath);
  await writeFile(manifestPath, Buffer.concat([bytes, Buffer.from('\n')]));
  await assert.rejects(verifyLocalCandidate(options), /changed since review/);
  await writeFile(manifestPath, bytes);
  await writeFile(path.join(options.directory, 'unexpected'), 'x');
  await assert.rejects(verifyLocalCandidate(options), /Unexpected candidate root/);
  await rm(path.join(options.directory, 'unexpected'));
  await symlink(manifestPath, path.join(options.directory, 'documentation-media/link'));
  await assert.rejects(verifyLocalCandidate(options), /contains a link/);
  await rm(path.join(options.directory, 'documentation-media/link'));
  await rm(path.join(options.directory, 'protocol-before.json'));
  await assert.rejects(verifyLocalCandidate(options), /files changed/);
});

localTest('sealing rejects mismatched report identities and incomplete captures', async (t) => {
  const directory = await fixture(t);
  const file = path.join(directory, 'native-ui-evidence/evidence.json');
  const original = JSON.parse(await readFile(file, 'utf8'));
  for (const change of [
    { commit: 'd'.repeat(40) },
    { version: '6.2.1' },
    { packageDigest: 'e'.repeat(64) },
    { dirty: true },
    { status: 'failed' },
    { identity: { buildIdentity: commit, channel: 'beta' } },
  ]) {
    await writeFile(file, JSON.stringify({ ...original, ...change }));
    await assert.rejects(seal(directory));
  }
  await writeFile(file, JSON.stringify(original));
  await writeFile(
    path.join(directory, 'protocol-after.json'),
    JSON.stringify({ scheme: 'veritas', applicationPath: '/foreign.app' })
  );
  await assert.rejects(seal(directory), /restoration was not verified/);
});

localTest(
  'a reviewed seal cannot claim hosted provenance or hide duplicate distribution checksums',
  async (t) => {
    const directory = await fixture(t);
    for (const changes of [
      { runId: '123' },
      { producer: { kind: 'hosted', platform: 'darwin', arch: 'arm64' } },
      { tree: 'invalid' },
    ])
      await assert.rejects(verifyLocalCandidate(await seal(directory, changes)));
    const file = path.join(directory, 'native-distribution.sha256');
    const text = await readFile(file, 'utf8');
    await writeFile(file, text + text.split('\n')[0] + '\n');
    await assert.rejects(seal(directory), /duplicated distribution checksum/);
  }
);

test(
  'capture preflight invokes the selected existing identity before reporting unrelated blockers',
  { skip: process.platform === 'win32' },
  async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'vk-signing-preflight-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const executable = path.join(directory, 'security');
    const marker = path.join(directory, 'identity-queried');
    const fingerprint = 'A'.repeat(40);
    await writeFile(
      executable,
      `#!${process.execPath}
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, 'queried');
console.log('  1) ${fingerprint} "Developer ID Application: Example (TEAM)"');
`
    );
    await chmod(executable, 0o700);
    const module = new URL('./capture-local-macos-release.mjs', import.meta.url).href;
    const script = `import { preflightCapture } from ${JSON.stringify(module)}; console.log(JSON.stringify(await preflightCapture({version: '0.0.0', channel: 'stable', output: ${JSON.stringify(path.join(directory, 'candidate'))}})));`;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
      env: {
        PATH: directory + path.delimiter + process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: os.tmpdir(),
        CSC_NAME: fingerprint,
        APPLE_KEYCHAIN_PROFILE: 'synthetic-unresolved-profile',
      },
    });
    assert.equal(child.status, 0, child.stderr);
    const report = JSON.parse(child.stdout);
    assert.equal(await readFile(marker, 'utf8'), 'queried');
    assert(
      !report.blockers.includes('Existing Developer ID signing identity is missing or ambiguous')
    );
    assert.equal(report.ready, false);
    assert(
      report.blockers.some((blocker) => blocker.includes('does not match the target version'))
    );
  }
);

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileDigest } from './native-ui/contract.mjs';
import { validateDistributionManifest } from './docs-media/restore-candidate.mjs';

export const localCandidateSchema = 'local-macos-release-candidate/v1';
export const localCandidateFile = 'local-release-candidate.json';
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const revision = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const directoryNames = new Set([
  'release',
  'native-ui-evidence',
  'documentation-media',
  'large-board-evidence',
]);
const rootFiles = new Set([
  'native-distribution.sha256',
  'protocol-before.json',
  'protocol-after.json',
  'capture-state.json',
  localCandidateFile,
]);

export function distributionNames(version) {
  assert(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version), 'Invalid release version');
  return [
    'latest-mac.yml',
    ...['zip', 'dmg'].flatMap((extension) => {
      const name = `Veritas-Kanban-${version}-mac-arm64.${extension}`;
      return [name, `${name}.blockmap`];
    }),
  ];
}

async function inventory(directory, allowPublication = false) {
  assert((await lstat(directory)).isDirectory(), 'Candidate must be a regular directory');
  const files = [];
  async function walk(relative = '') {
    for (const name of (await readdir(path.join(directory, relative))).sort()) {
      assert(name !== '.' && name !== '..' && !name.includes('\\'), 'Unsafe candidate filename');
      const file = relative ? `${relative}/${name}` : name;
      const info = await lstat(path.join(directory, file));
      assert(!info.isSymbolicLink(), `Candidate contains a link: ${file}`);
      if (!relative)
        assert(
          directoryNames.has(name) || rootFiles.has(name),
          `Unexpected candidate root: ${name}`
        );
      if (info.isDirectory()) {
        assert(relative || directoryNames.has(name), `Unexpected candidate directory: ${name}`);
        await walk(file);
      } else {
        assert(info.isFile(), `Candidate contains a special file: ${file}`);
        if (file === localCandidateFile) continue;
        if (file === 'documentation-media/publication.json') {
          assert(allowPublication, 'A new capture cannot adopt a previous publication record');
          continue;
        }
        files.push({
          path: file,
          size: info.size,
          sha256: await fileDigest(path.join(directory, file)),
        });
      }
    }
  }
  await walk();
  return files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );
}

function validateMetadata(manifest) {
  const allowed = new Set([
    'schema',
    'status',
    'producer',
    'commit',
    'tree',
    'version',
    'channel',
    'packageDigest',
    'files',
    'verifiedAt',
  ]);
  assert(
    Object.keys(manifest).every((key) => allowed.has(key)),
    'Unexpected local provenance field'
  );
  assert.equal(manifest.schema, localCandidateSchema, 'Unknown local candidate schema');
  assert.equal(manifest.status, 'verified', 'Local capture did not finish successfully');
  assert.equal(manifest.producer?.kind, 'local', 'Candidate is not local provenance');
  assert.equal(manifest.producer.platform, 'darwin', 'Candidate was not produced on macOS');
  assert.equal(manifest.producer.arch, 'arm64', 'Candidate is not Apple Silicon');
  assert(
    Object.keys(manifest.producer).every((key) =>
      ['kind', 'platform', 'arch', 'node'].includes(key)
    ),
    'Unexpected local producer identity'
  );
  assert(
    typeof manifest.producer.node === 'string' && /^\d+\.\d+\.\d+$/.test(manifest.producer.node),
    'Missing build Node version'
  );
  assert(
    typeof manifest.verifiedAt === 'string' && Number.isFinite(Date.parse(manifest.verifiedAt)),
    'Missing local verification timestamp'
  );
  assert(
    !('runId' in manifest) && !('workflow' in manifest),
    'Local provenance cannot claim a hosted run'
  );
  assert(revision(manifest.commit) && revision(manifest.tree), 'Invalid source commit/tree');
  distributionNames(manifest.version);
  assert(['stable', 'beta', 'dev'].includes(manifest.channel), 'Invalid update channel');
  assert(digest(manifest.packageDigest), 'Invalid original app digest');
  assert(
    Array.isArray(manifest.files) && manifest.files.length > 0,
    'Missing candidate file inventory'
  );
}

async function verifyRequiredFiles(directory, manifest) {
  const files = new Map(manifest.files.map((file) => [file.path, file]));
  for (const file of [
    ...distributionNames(manifest.version).map((name) => `release/${name}`),
    'native-ui-evidence/evidence.json',
    'documentation-media/evidence.json',
    'large-board-evidence/report.json',
    'native-distribution.sha256',
    'protocol-before.json',
    'protocol-after.json',
    'capture-state.json',
  ])
    assert(files.has(file), `Missing retained candidate file: ${file}`);
  const checksums = await readFile(path.join(directory, 'native-distribution.sha256'), 'utf8');
  validateDistributionManifest(checksums, manifest.version);
  for (const line of checksums.trim().split('\n')) {
    const [expected, name] = line.split('  ');
    assert.equal(files.get(`release/${name}`)?.sha256, expected, `Distribution changed: ${name}`);
  }
  for (const [name, status] of [
    ['native-ui-evidence/evidence.json', 'passed'],
    ['documentation-media/evidence.json', 'captured'],
    ['large-board-evidence/report.json', 'passed'],
  ]) {
    const report = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
    assert.equal(report.status, status, `${name}: acceptance did not pass`);
    assert.notEqual(report.dirty, true, `${name}: dirty capture source`);
    assert.equal(report.commit, manifest.commit, `${name}: wrong build commit`);
    assert.equal(report.version, manifest.version, `${name}: wrong version`);
    assert.equal(report.packageDigest, manifest.packageDigest, `${name}: wrong app digest`);
    assert.equal(
      report.identity?.buildIdentity,
      manifest.commit,
      `${name}: wrong app build identity`
    );
    assert.equal(report.identity?.channel, manifest.channel, `${name}: wrong app update channel`);
  }
  const before = JSON.parse(await readFile(path.join(directory, 'protocol-before.json'), 'utf8'));
  const after = JSON.parse(await readFile(path.join(directory, 'protocol-after.json'), 'utf8'));
  assert.equal(before.scheme, 'veritas', 'Wrong protocol backup');
  assert(
    typeof before.applicationPath === 'string' && before.applicationPath.endsWith('.app'),
    'Missing recoverable protocol application'
  );
  assert.equal(after.scheme, before.scheme, 'Protocol restore scheme differs');
  assert.equal(
    after.applicationPath,
    before.applicationPath,
    'Protocol restoration was not verified'
  );
  const state = JSON.parse(await readFile(path.join(directory, 'capture-state.json'), 'utf8'));
  assert.equal(state.status, 'captured', 'Capture is incomplete or failed');
}

// This seals file identity, not an independent claim of native/signing acceptance.
// Capture runs the existing verifiers before sealing; promotion must run them again.
export async function createLocalCandidate({
  directory,
  commit,
  tree,
  version,
  channel,
  packageDigest,
}) {
  const manifest = {
    schema: localCandidateSchema,
    status: 'verified',
    producer: {
      kind: 'local',
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
    },
    commit,
    tree,
    version,
    channel,
    packageDigest,
    files: await inventory(directory),
    verifiedAt: new Date().toISOString(),
  };
  validateMetadata(manifest);
  await verifyRequiredFiles(directory, manifest);
  return manifest;
}

export async function verifyLocalCandidate({
  directory,
  expectedDigest,
  version,
  channel,
  allowPublication = false,
}) {
  assert(digest(expectedDigest), 'Provide the independently retained candidate manifest SHA-256');
  const file = path.join(directory, localCandidateFile);
  assert(
    (await lstat(file)).isFile() && !(await lstat(file)).isSymbolicLink(),
    'Candidate manifest must be a regular file'
  );
  const bytes = await readFile(file);
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    expectedDigest,
    'Candidate manifest changed since review'
  );
  const manifest = JSON.parse(bytes);
  validateMetadata(manifest);
  if (version) assert.equal(manifest.version, version, 'Candidate version differs');
  if (channel) assert.equal(manifest.channel, channel, 'Candidate channel differs');
  assert.deepEqual(
    await inventory(directory, allowPublication),
    manifest.files,
    'Retained candidate files changed'
  );
  await verifyRequiredFiles(directory, manifest);
  return manifest;
}

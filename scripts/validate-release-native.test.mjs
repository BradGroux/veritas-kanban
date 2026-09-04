import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { packageDigest, schema } from './native-ui/contract.mjs';
import { remoteTagCommit } from './validate-release.mjs';

const root = path.resolve(import.meta.dirname, '..');
function validate(args, env = process.env) {
  const result = spawnSync(
    process.execPath,
    ['scripts/validate-release.mjs', '--skip-build-output', ...args],
    {
      cwd: root,
      encoding: 'utf8',
      env,
    }
  );
  assert.ifError(result.error);
  return { code: result.status, output: result.stdout + result.stderr };
}

test('full release validation cannot bypass absent evidence by skipping builds', () => {
  const result = validate([]);
  assert.equal(result.code, 1);
  assert.match(
    result.output,
    /FAIL Packaged macOS evidence.*Both --native-evidence and --native-app are required/
  );
  assert.doesNotMatch(result.output, /Release validation passed/);
  assert.match(
    result.output,
    /FAIL Documentation media freshness.*--media-evidence and --native-app are required/
  );
});

test('destination release tags resolve to their commit, not an annotated tag object', () => {
  const candidate = 'a'.repeat(40);
  const different = 'b'.repeat(40);
  const tag = 'v6.1.6';
  const ref = `refs/tags/${tag}`;
  assert.equal(remoteTagCommit(`${candidate}\t${ref}\n`, tag), candidate);
  assert.equal(remoteTagCommit(`${different}\t${ref}\n${candidate}\t${ref}^{}\n`, tag), candidate);
  assert.notEqual(remoteTagCommit(`${different}\t${ref}\n`, tag), candidate);
  assert.notEqual(
    remoteTagCommit(`${candidate}\t${ref}\n${different}\t${ref}^{}\n`, tag),
    candidate
  );
  assert.equal(remoteTagCommit('', tag), undefined);
  assert.equal(remoteTagCommit(`${candidate}\trefs/tags/v0.0.0\n`, tag), undefined);
  assert.equal(remoteTagCommit(`invalid\t${ref}\n`, tag), undefined);
  assert.equal(remoteTagCommit(`${candidate}\t${ref}\n${candidate}\t${ref}\n`, tag), undefined);
});

test(
  'GitHub validation rejects a destination tag bound to a different commit',
  { skip: process.platform === 'win32' },
  async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'native-release-tag-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
    const releaseBody = await readFile(path.join(root, `docs/releases/v${version}.md`), 'utf8');
    const candidate = 'a'.repeat(40);
    const tag = `v${version}`;
    await writeFile(
      path.join(directory, 'git'),
      `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === 'tag') console.log(${JSON.stringify(tag)});
else if (args[0] === 'rev-parse') console.log(${JSON.stringify(candidate)});
else if (args[0] === 'ls-remote') {
  if (!args.includes(${JSON.stringify(`refs/tags/${tag}^{}`)})) process.exit(2);
  console.log('b'.repeat(40) + '\\t' + ${JSON.stringify(`refs/tags/${tag}`)});
  console.log(process.env.TEST_RELEASE_COMMIT + '\\t' + ${JSON.stringify(`refs/tags/${tag}^{}`)});
} else process.exit(2);
`,
      { mode: 0o755 }
    );
    await writeFile(
      path.join(directory, 'gh'),
      `#!${process.execPath}
console.log(${JSON.stringify(JSON.stringify({ tagName: tag, isDraft: false, body: releaseBody }))});
`,
      { mode: 0o755 }
    );
    const env = {
      ...process.env,
      PATH: `${directory}${path.delimiter}${process.env.PATH}`,
      TEST_RELEASE_COMMIT: candidate,
    };
    const matching = validate(['--source-only', '--github'], env);
    assert.equal(matching.code, 0, matching.output);
    const mismatched = validate(['--source-only', '--github'], {
      ...env,
      TEST_RELEASE_COMMIT: 'c'.repeat(40),
    });
    assert.equal(mismatched.code, 1, mismatched.output);
    assert.match(mismatched.output, /FAIL Origin release tag matches candidate/);
  }
);

test('source-only preflight is explicitly not release acceptance and cannot consume native evidence', () => {
  const result = validate(['--source-only']);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Source preflight passed/);
  assert.doesNotMatch(result.output, /Release validation passed/);
  const ambiguous = validate(['--source-only', '--native-app', '/not-a-candidate']);
  assert.equal(ambiguous.code, 1);
  assert.match(ambiguous.output, /FAIL Source-only preflight does not consume candidate evidence/);
  const ambiguousMedia = validate(['--source-only', '--media-evidence', '/not-a-capture']);
  assert.equal(ambiguousMedia.code, 1);
  assert.match(
    ambiguousMedia.output,
    /FAIL Source-only preflight does not consume candidate evidence/
  );
});

test('full validator rejects stale documentation metadata independently of native evidence', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'media-release-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = path.join(directory, 'fixture.app');
  const media = path.join(directory, 'media.json');
  await mkdir(app);
  await writeFile(path.join(app, 'fixture.txt'), 'not a release app');
  await writeFile(
    media,
    JSON.stringify({ schema: 'documentation-media-capture/v1', commit: '0'.repeat(40), assets: [] })
  );
  const result = validate(['--native-app', app, '--media-evidence', media]);
  assert.equal(result.code, 1);
  assert.match(
    result.output,
    /FAIL Documentation media freshness.*stale documentation candidate commit/
  );
  assert.match(result.output, /missing or duplicate maintained media decisions/);
});

test('full validator delegates to candidate, freshness, and matrix validation', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'native-release-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = path.join(directory, 'fixture.app');
  const evidence = path.join(directory, 'evidence.json');
  await mkdir(app);
  await writeFile(path.join(app, 'fixture.txt'), 'not a release app');
  const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  await writeFile(
    evidence,
    JSON.stringify({
      schema,
      status: 'passed',
      boundary: 'packaged-macos',
      dirty: false,
      commit: '0'.repeat(40),
      version,
      completedAt: '2020-01-01T00:00:00Z',
      packageDigest: await packageDigest(app),
      identity: { packaged: true, platform: 'darwin', buildIdentity: '0'.repeat(40), version },
      entries: [],
      seededFailures: [],
    })
  );
  const result = validate(['--native-evidence', evidence, '--native-app', app]);
  assert.equal(result.code, 1);
  for (const reason of [
    'candidate commit mismatch',
    'missing or stale native evidence',
    'incomplete native matrix',
  ])
    assert(result.output.includes(reason), reason);
});

test('macOS publication stages without upload and verifies the distribution before upload', async () => {
  const workflow = await readFile(path.join(root, '.github/workflows/desktop-release.yml'), 'utf8');
  const desktop = JSON.parse(await readFile(path.join(root, 'desktop/package.json'), 'utf8'));
  assert.match(desktop.scripts['release:mac'], /--publish never$/);
  assert.doesNotMatch(workflow, /--publish (?:always|onTag)/);
  const steps = workflow.split(/(?=^ {6}- (?:name:|uses:))/m);
  const native = steps.find((step) => step.includes('id: native-ui'));
  const upload = steps.find((step) => step.includes('name: Upload macOS release assets'));
  const retention = steps.find((step) => step.includes('name: Retain native macOS evidence'));
  assert(native && upload && retention);
  assert(
    workflow.indexOf('node scripts/finalize-macos-release-assets.mjs') < workflow.indexOf(native)
  );
  assert(workflow.indexOf(native) < workflow.indexOf(upload));
  assert.match(native, /ditto -x -k "\$\{zip\}" "\$\{candidate_dir\}"/);
  assert.match(native, /codesign --verify --deep --strict/);
  assert.match(native, /spctl --assess --type execute/);
  assert.match(native, /node scripts\/native-ui\/run.mjs/);
  assert.match(native, /node scripts\/native-ui\/verify.mjs/);
  assert.match(native, /native-distribution.sha256/);
  assert.match(retention, /if: always\(\)/);
  assert.match(retention, /native-ui-evidence/);
  assert.doesNotMatch(native + upload, /continue-on-error|if:|\|\| true|--source-only/);
  const checksum = upload.indexOf('shasum -a 256 -c');
  const verification = upload.indexOf('node ../scripts/validate-release.mjs --native-evidence');
  const publication = upload.indexOf('gh release upload');
  assert(checksum >= 0 && verification > checksum && publication > verification);
  assert.match(upload, /--native-app "\$\{VERIFIED_NATIVE_APP\}"/);
  assert.match(upload, /--native-app "\$\{VERIFIED_NATIVE_APP\}" --github/);
  assert.match(workflow, /fetch-depth: 0/);
});

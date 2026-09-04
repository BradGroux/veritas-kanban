import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  maintainedAssets,
  mediaSchema,
  mediaEvidenceFailures,
  staleMediaReferences,
  verifyMediaEvidence,
} from './verify.mjs';

const expected = { commit: 'a'.repeat(40), version: '6.1.7', packageDigest: 'b'.repeat(64) };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  return {
    schema: mediaSchema,
    status: 'captured',
    mode: 'verify',
    committedBytesMatch: true,
    dirty: false,
    ...expected,
    completedAt: '2026-09-04T09:00:00Z',
    assets: maintainedAssets.map((name) => ({
      name,
      decision: 'replace',
      reason: 'Changed desktop UI',
      path: `docs/assets/v6.1.7/${name}`,
      sha256: hash(name),
      capture: {
        ...expected,
        boundary: name.startsWith('mobile-') ? 'mobile-browser' : 'packaged-macos',
        packaged: !name.startsWith('mobile-'),
        width: name.startsWith('mobile-') ? 390 : 1700,
        height: name.startsWith('mobile-') ? 844 : 1000,
        scaleFactor: 1,
        method: name.endsWith('.gif') ? 'interaction-recording' : 'window-capture',
        capturedAt: '2026-09-04T08:59:00Z',
      },
    })),
  };
}

test('fourteen explicit captures bind both native and mobile media to the candidate', () => {
  assert.equal(maintainedAssets.length, 14);
  assert.deepEqual(mediaEvidenceFailures(fixture(), expected), []);
  assert(mediaEvidenceFailures(fixture(), { ...expected, version: '../escape' }).length);
});

test('seeded stale documentation identity and changed capture bytes fail closed', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'docs-media-freshness-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const report = fixture();
  const evidencePath = path.join(root, 'capture.json');
  await mkdir(path.join(root, 'docs/assets/v6.1.7'), { recursive: true });
  for (const asset of report.assets) await writeFile(path.join(root, asset.path), asset.name);
  await writeFile(evidencePath, JSON.stringify(report));
  const args = {
    evidencePath,
    root,
    expected,
    maintainedContents: [['README.md', 'assets/v6.1.7/board-overview.png']],
  };
  assert.deepEqual(await verifyMediaEvidence(args), []);
  for (const change of [{ mode: 'prepare' }, { dirty: true }, { committedBytesMatch: false }]) {
    await writeFile(evidencePath, JSON.stringify({ ...report, ...change }));
    assert(
      (await verifyMediaEvidence(args)).includes(
        'documentation media requires a final clean capture matching committed bytes'
      )
    );
  }
  const stale = fixture();
  stale.assets[0].capture.commit = 'c'.repeat(40);
  await writeFile(evidencePath, JSON.stringify(stale));
  assert((await verifyMediaEvidence(args)).includes('agent-providers.png: stale capture identity'));
  await writeFile(evidencePath, JSON.stringify(report));
  await writeFile(path.join(root, report.assets[0].path), 'old screenshot bytes');
  assert(
    (await verifyMediaEvidence(args)).includes('agent-providers.png: stale or changed media bytes')
  );
});

test('missing, duplicate, old-directory, mock-desktop and montage evidence is rejected', () => {
  const mutations = [
    [(r) => r.assets.pop(), 'missing or duplicate'],
    [(r) => (r.assets[0] = r.assets[1]), 'missing or duplicate'],
    [(r) => (r.commit = 'c'.repeat(40)), 'stale documentation candidate commit'],
    [(r) => (r.version = '6.1.6'), 'stale documentation version'],
    [(r) => (r.packageDigest = 'c'.repeat(64)), 'stale documentation candidate package'],
    [
      (r) => (r.assets[0].path = 'docs/assets/v6.1.6/agent-providers.png'),
      'candidate versioned media directory',
    ],
    [(r) => (r.assets[0].capture.packaged = false), 'did not use the packaged application'],
    [(r) => (r.assets[0].capture.boundary = 'browser'), 'wrong capture boundary'],
    [(r) => (r.assets[5].capture.width = 900), 'wrong supported mobile viewport'],
    [(r) => (r.assets[2].capture.method = 'still-image-montage'), 'not an interaction recording'],
    [(r) => (r.assets[0].reason = ''), 'explicit media decision'],
    [(r) => (r.assets[0].capture.capturedAt = '2030-01-01'), 'invalid capture time'],
    [(r) => (r.completedAt = '2030-01-01'), 'completion time'],
    [(r) => (r.assets[0].sha256 = 'bad'), 'missing asset digest'],
  ];
  for (const [mutate, reason] of mutations) {
    const report = fixture();
    mutate(report);
    assert(
      mediaEvidenceFailures(report, expected).some((e) => e.includes(reason)),
      reason
    );
  }
});

test('keep still requires current capture; retirement cannot hide named GIFs or references', () => {
  const report = fixture();
  report.assets[0].decision = 'keep';
  assert.deepEqual(mediaEvidenceFailures(report, expected), []);
  delete report.assets[0].capture;
  assert(mediaEvidenceFailures(report, expected).some((e) => e.includes('stale capture identity')));
  report.assets[0] = {
    name: 'agent-providers.png',
    decision: 'retire',
    reason: 'Replaced by textual guide',
  };
  assert.deepEqual(mediaEvidenceFailures(report, expected), []);
  assert(
    staleMediaReferences(
      [['docs/AGENT-PROVIDERS.md', 'assets/v6.1.7/agent-providers.png']],
      report,
      expected.version
    ).some((e) => e.includes('retired media'))
  );
  report.assets[2] = { name: 'board-to-workspace.gif', decision: 'retire', reason: 'Not captured' };
  assert(mediaEvidenceFailures(report, expected).some((e) => e.includes('must remain maintained')));
});

test('maintained guides and index metadata reject old references while release history remains historical', () => {
  const refs = [
    ['README.md', '![Board](docs/assets/v6.1.6/board-overview.png)'],
    ['docs/index.json', '{"image":"assets\\/v6.1.6\\/task-workspace.png"}'],
    ['docs/features/squad-chat.md', '../assets/v6.1.7/squad-chat.png'],
    ['docs/releases/v6.1.6.md', '../assets/v6.1.6/board-overview.png'],
  ];
  const errors = staleMediaReferences(refs, fixture(), expected.version);
  assert.equal(errors.length, 2);
  assert(errors[0].startsWith('README.md:'));
  assert(errors[1].startsWith('docs/index.json:'));
});

test('relative, encoded and dot-segment destinations cannot hide superseded or retired media', () => {
  const refs = [
    ['README.md', '![Board](docs/assets/v6.1.7/../v6.1.6/board-overview.png)'],
    ['docs/index.json', '{"image":"assets/v6.1.6/%62oard-overview.png"}'],
    ['docs/assets/index.md', '![Board](v6.1.6/board-overview.png)'],
    [
      'docs/index.md',
      '<img src="https://example.com/assets/v6.1.6/board-overview.png?raw=1#board">',
    ],
    ['docs/index.md', '![Board](assets/v6.1.7/%2e%2e/v6.1.6/board-overview.png)'],
  ];
  assert.equal(staleMediaReferences(refs, fixture(), expected.version).length, refs.length);
  assert.deepEqual(
    staleMediaReferences(
      [['docs/assets/index.md', '![Board](v6.1.7/board-overview.png)']],
      fixture(),
      expected.version
    ),
    []
  );
  const report = fixture();
  report.assets[1].decision = 'retire';
  assert(
    staleMediaReferences(
      [['docs/index.md', '![Board](assets/v6.1.7/%62oard-overview.png)']],
      report,
      expected.version
    ).some((e) => e.includes('retired media'))
  );
});

test('symlinked media directories cannot supply outside artifacts', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'docs-media-symlink-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const report = fixture(),
    evidencePath = path.join(root, 'capture.json');
  await mkdir(path.join(root, 'outside'));
  await mkdir(path.join(root, 'docs/assets'), { recursive: true });
  await symlink(path.join(root, 'outside'), path.join(root, 'docs/assets/v6.1.7'), 'dir');
  await writeFile(evidencePath, JSON.stringify(report));
  assert.deepEqual(
    await verifyMediaEvidence({
      root,
      evidencePath,
      expected,
      maintainedContents: [['README.md', '']],
    }),
    ['versioned media directory traverses a symlink']
  );
});

test('JSON escapes and HTML entities resolve before checking metadata destinations', () => {
  const refs = [
    ['docs/index.json', '{"image":"assets/v6.1.6/\\u0062oard-overview.png"}'],
    ['docs/index.html', '<img src="assets/v6.1.6/&#98;oard-overview.png">'],
    ['docs/index.html', '<img src="assets&sol;v6.1.6&sol;&#x62;oard-overview&period;png">'],
    ['docs/index.html', '<img src=assets/v6.1.6/board-overview.png>'],
  ];
  assert.equal(staleMediaReferences(refs, fixture(), expected.version).length, refs.length);
  assert.deepEqual(
    staleMediaReferences(
      [['docs/index.html', '<img src=assets/v6.1.7/board-overview.png>']],
      fixture(),
      expected.version
    ),
    []
  );
});

test('missing maintained reference inventory cannot silently skip stale-reference checks', async () => {
  assert.deepEqual(await verifyMediaEvidence({}), [
    'missing maintained documentation reference inventory',
  ]);
});

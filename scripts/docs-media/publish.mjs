#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileDigest, packageDigest } from '../native-ui/contract.mjs';
import { publicationSchema, verifyPublishedMedia } from './publication.mjs';

const root = path.resolve(import.meta.dirname, '../..');
try {
  const [captureArgument, appArgument, publicationArgument] = process.argv.slice(2);
  assert(
    captureArgument && appArgument?.endsWith('.app') && publicationArgument,
    'Usage: node scripts/docs-media/publish.mjs <capture.json> <candidate.app> <new-publication.json>'
  );
  const capturePath = await realpath(captureArgument);
  const directory = await realpath(path.dirname(path.resolve(publicationArgument)));
  assert.equal(
    directory,
    path.dirname(capturePath),
    'Keep publication evidence beside the original capture'
  );
  const canonicalRoot = await realpath(root);
  assert(
    directory !== canonicalRoot && !directory.startsWith(canonicalRoot + path.sep),
    'Publication evidence must remain outside the checkout'
  );
  const evidencePath = path.join(directory, path.basename(publicationArgument));
  const capture = JSON.parse(await readFile(capturePath, 'utf8'));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const publicationCommit = git('rev-parse', 'HEAD').trim();
  const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  const publication = {
    schema: publicationSchema,
    status: 'verified',
    publicationCommit,
    verifiedAt: new Date().toISOString(),
    captureManifest: { path: path.basename(capturePath), sha256: await fileDigest(capturePath) },
  };
  const maintainedContents = [];
  for (const file of git('ls-files', '-z', '--', 'README.md', 'docs').split('\0').filter(Boolean)) {
    const bytes = await readFile(path.join(root, file));
    if (!bytes.includes(0)) maintainedContents.push([file, bytes.toString('utf8')]);
  }
  const errors = await verifyPublishedMedia({
    evidencePath,
    publication,
    root,
    maintainedContents,
    expected: {
      commit: capture.commit,
      publicationCommit,
      version,
      packageDigest: await packageDigest(appArgument),
    },
  });
  assert.deepEqual(errors, [], errors.join('\n'));
  await writeFile(evidencePath, JSON.stringify(publication, null, 2) + '\n', { flag: 'wx' });
  console.log(`Captured media verified for publication: ${evidencePath}`);
  console.log(
    'No recapture performed. Visual review, native acceptance, signing, and release verification remain separate.'
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

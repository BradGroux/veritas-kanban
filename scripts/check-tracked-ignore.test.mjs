import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findIgnoredTrackedFiles } from './check-tracked-ignore.mjs';

const isolatedGitEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
);

async function createRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'veritas-tracked-ignore-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root, env: isolatedGitEnvironment });
  return root;
}

async function write(root, relativePath, content = '') {
  const destination = path.join(root, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content, 'utf8');
}

test('reports a tracked file covered by a later ignore rule', async (t) => {
  const root = await createRepository();
  t.after(() => rm(root, { recursive: true, force: true }));

  await write(root, 'server/src/__tests__/storage/example.test.ts', 'export {};\n');
  execFileSync('git', ['add', 'server/src/__tests__/storage/example.test.ts'], {
    cwd: root,
    env: isolatedGitEnvironment,
  });
  await write(root, '.gitignore', 'storage/\n');

  assert.deepEqual(findIgnoredTrackedFiles(root, isolatedGitEnvironment), [
    'server/src/__tests__/storage/example.test.ts',
  ]);
});

test('allows tracked storage source while anchored runtime roots stay ignored', async (t) => {
  const root = await createRepository();
  t.after(() => rm(root, { recursive: true, force: true }));

  await write(root, '.gitignore', '/storage/\n/server/storage/\n');
  await write(root, 'server/src/storage/repository.ts', 'export {};\n');
  await write(root, 'server/src/__tests__/storage/repository.test.ts', 'export {};\n');
  execFileSync(
    'git',
    [
      'add',
      '.gitignore',
      'server/src/storage/repository.ts',
      'server/src/__tests__/storage/repository.test.ts',
    ],
    { cwd: root, env: isolatedGitEnvironment }
  );

  assert.deepEqual(findIgnoredTrackedFiles(root, isolatedGitEnvironment), []);
  assert.equal(
    execFileSync('git', ['check-ignore', 'storage/runtime.json'], {
      cwd: root,
      env: isolatedGitEnvironment,
      encoding: 'utf8',
    }),
    'storage/runtime.json\n'
  );
  assert.equal(
    execFileSync('git', ['check-ignore', 'server/storage/runtime.json'], {
      cwd: root,
      env: isolatedGitEnvironment,
      encoding: 'utf8',
    }),
    'server/storage/runtime.json\n'
  );
});

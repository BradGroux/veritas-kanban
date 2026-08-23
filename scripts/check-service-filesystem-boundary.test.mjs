import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { findDirectFilesystemImports } from './check-service-filesystem-boundary.mjs';

const CHECK_SCRIPT = path.resolve('scripts/check-service-filesystem-boundary.mjs');

function createFixture({ source, entries = [], servicePath = 'example-service.ts' }) {
  const root = mkdtempSync(path.join(tmpdir(), 'veritas-service-fs-boundary-'));
  const serviceDirectory = path.join(root, 'server/src/services');
  const sourcePath = path.join(serviceDirectory, servicePath);
  mkdirSync(path.dirname(sourcePath), { recursive: true });
  writeFileSync(sourcePath, source);
  writeFileSync(
    path.join(root, 'service-filesystem-boundary.json'),
    `${JSON.stringify({ schemaVersion: 1, maximumEntries: entries.length, entries }, null, 2)}\n`
  );
  return root;
}

function runCheck(root) {
  return spawnSync(
    process.execPath,
    [CHECK_SCRIPT, '--root', root, '--inventory', 'service-filesystem-boundary.json'],
    { encoding: 'utf8' }
  );
}

test('rejects a new service filesystem import with a file diagnostic', () => {
  const root = createFixture({
    source: "import { readFile } from 'node:fs/promises';\n",
  });

  const result = runCheck(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /server\/src\/services\/example-service\.ts/);
  assert.match(result.stderr, /unclassified direct filesystem import/);
});

test('scans nested service directories', () => {
  const root = createFixture({
    source: "const fs = require('fs');\n",
    servicePath: 'nested/example-service.ts',
  });

  const result = runCheck(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /server\/src\/services\/nested\/example-service\.ts/);
});

test('ignores filesystem calls embedded in strings and comments', () => {
  const source = [
    `const command = "require('node:fs').writeFileSync('/tmp/example', 'x')";`,
    `// import fs from 'node:fs';`,
    `/* require('fs/promises') */`,
  ].join('\n');

  assert.deepEqual(findDirectFilesystemImports(source), []);
});

test('detects filesystem re-exports', () => {
  assert.deepEqual(findDirectFilesystemImports("export { readFile } from 'node:fs';\n"), [
    { module: 'node:fs', line: 1 },
  ]);
});

test('accepts a classified direct filesystem import', () => {
  const entry = {
    path: 'server/src/services/example-service.ts',
    category: 'compatibility-debt',
    owner: '#1189',
    rationale: 'Migration is tracked by the final storage boundary issue.',
  };
  const root = createFixture({
    source: "const fs = await import('fs/promises');\n",
    entries: [entry],
  });

  const result = runCheck(root);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 classified exception/);
});

test('rejects stale inventory entries so the exception count ratchets downward', () => {
  const entry = {
    path: 'server/src/services/example-service.ts',
    category: 'compatibility-debt',
    owner: '#1189',
    rationale: 'Migration is tracked by the final storage boundary issue.',
  };
  const root = createFixture({ source: 'export const value = 1;\n', entries: [entry] });

  const result = runCheck(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /stale inventory entry/);
});

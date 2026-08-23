import assert from 'node:assert/strict';
import test from 'node:test';

import { coverageCommands, parsePackageSelection } from './run-coverage.mjs';

test('defaults to every applicable workspace and rejects unknown packages', () => {
  assert.deepEqual(parsePackageSelection([]), ['server', 'web', 'cli', 'mcp', 'desktop']);
  assert.deepEqual(parsePackageSelection(['--packages=web,server,web']), ['web', 'server']);
  assert.throws(() => parsePackageSelection(['--packages', 'unknown']), /Unknown/);
});

test('builds shared first and emits isolated machine-readable and HTML reports', () => {
  const commands = coverageCommands(['web', 'desktop']);
  assert.deepEqual(commands[0], ['--filter', '@veritas-kanban/shared', 'build']);
  assert.equal(commands.length, 3);

  const web = commands[1].join(' ');
  assert.match(web, /--filter @veritas-kanban\/web/);
  assert.match(web, /--coverage\.reporter=json-summary/);
  assert.match(web, /--coverage\.reporter=html/);
  assert.match(web, /--coverage\.reportsDirectory=\.\.\/coverage\/web/);
  assert.match(web, /--testTimeout=15000/);
  assert.match(web, /useWebSocket/);

  const server = coverageCommands(['server'])[1].join(' ');
  assert.match(server, /--maxWorkers=2/);
  assert.match(server, /--testTimeout=30000/);
  assert.match(server, /workflow-run-service/);

  assert.match(commands[2].join(' '), /--coverage\.reportsDirectory=\.\.\/coverage\/desktop/);
});

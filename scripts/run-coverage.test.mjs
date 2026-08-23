import assert from 'node:assert/strict';
import test from 'node:test';

import { coverageCommands, coverageEnvironment, parsePackageSelection } from './run-coverage.mjs';

const policy = {
  packages: [
    {
      id: 'server',
      runner: {
        maxWorkers: 2,
        extraArgs: ['--testTimeout=30000'],
        testFiles: ['src/__tests__/provider-runtime.test.ts'],
      },
    },
    {
      id: 'web',
      runner: {
        extraArgs: ['--testTimeout=15000'],
        testFiles: ['src/__tests__/useWebSocket.test.ts'],
      },
    },
    { id: 'desktop' },
  ],
};

test('defaults to every applicable workspace and rejects unknown packages', () => {
  const available = ['server', 'web', 'desktop'];
  assert.deepEqual(parsePackageSelection([], available), available);
  assert.deepEqual(parsePackageSelection(['--packages=web,server,web'], available), [
    'web',
    'server',
  ]);
  assert.throws(() => parsePackageSelection(['--packages', 'unknown'], available), /Unknown/);
});

test('builds shared first and emits isolated machine-readable and HTML reports', () => {
  const commands = coverageCommands(policy, ['web', 'desktop']);
  assert.deepEqual(commands[0], ['--filter', '@veritas-kanban/shared', 'build']);
  assert.equal(commands.length, 3);

  const web = commands[1].join(' ');
  assert.match(web, /--filter @veritas-kanban\/web/);
  assert.match(web, /--coverage\.reporter=json-summary/);
  assert.match(web, /--coverage\.reporter=html/);
  assert.match(web, /--coverage\.reportsDirectory=\.\.\/coverage\/web/);
  assert.match(web, /--testTimeout=15000/);
  assert.match(web, /src\/__tests__\/useWebSocket\.test\.ts/);

  const server = coverageCommands(policy, ['server'])[1].join(' ');
  assert.match(server, /--maxWorkers=2/);
  assert.match(server, /--testTimeout=30000/);
  assert.match(server, /src\/__tests__\/provider-runtime\.test\.ts/);

  assert.match(commands[2].join(' '), /--coverage\.reportsDirectory=\.\.\/coverage\/desktop/);
});

test('removes every live integration opt-in from the coverage environment', () => {
  const environment = coverageEnvironment({
    PATH: '/bin',
    HERMES_SMOKE_TEST: 'true',
    VERITAS_CLAUDE_CODE_SMOKE: '1',
    VERITAS_CODEX_APP_SERVER_SMOKE: '1',
    VERITAS_RUN_NATIVE_SANDBOX_SMOKE: '1',
    VK_MCP_INTEGRATION_TEST: '1',
  });

  assert.equal(environment.PATH, '/bin');
  assert.equal(environment.NODE_ENV, 'test');
  assert.equal(environment.VERITAS_DISABLE_WATCHERS, '1');
  for (const key of [
    'HERMES_SMOKE_TEST',
    'VERITAS_CLAUDE_CODE_SMOKE',
    'VERITAS_CODEX_APP_SERVER_SMOKE',
    'VERITAS_RUN_NATIVE_SANDBOX_SMOKE',
    'VK_MCP_INTEGRATION_TEST',
  ]) {
    assert.equal(environment[key], undefined);
  }
});

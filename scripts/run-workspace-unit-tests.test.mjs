import assert from 'node:assert/strict';
import test from 'node:test';

import {
  UNIT_TEST_STAGES,
  runWorkspaceUnitTests,
  validateStage,
} from './run-workspace-unit-tests.mjs';

test('runs the shared prerequisite and every unit-test workspace in order', () => {
  const calls = [];
  const lines = [];

  const status = runWorkspaceUnitTests({
    run: (stage) => {
      calls.push(stage.id);
      return 0;
    },
    log: (line) => lines.push(line),
  });

  assert.equal(status, 0);
  assert.deepEqual(
    calls,
    UNIT_TEST_STAGES.map((stage) => stage.id)
  );
  assert.match(lines.at(-1), /server: PASS.*web: PASS.*cli: PASS.*mcp: PASS/);
});

test('stops after the first failure and reports unexecuted workspaces', () => {
  const calls = [];
  const lines = [];

  const status = runWorkspaceUnitTests({
    run: (stage) => {
      calls.push(stage.id);
      return stage.id === 'web' ? 7 : 0;
    },
    log: (line) => lines.push(line),
  });

  assert.equal(status, 7);
  assert.deepEqual(calls, ['shared-build', 'server', 'web']);
  assert.match(lines.at(-1), /server: PASS.*web: FAIL.*cli: NOT RUN.*mcp: NOT RUN/);
});

test('fails before execution when a workspace test script is missing', () => {
  const calls = [];
  const lines = [];

  const status = runWorkspaceUnitTests({
    validate: (stage) =>
      validateStage(stage, {
        readPackageJson: () => ({
          name: stage.packageName,
          scripts: { [stage.requiredScript]: stage.id === 'cli' ? '' : 'test-command' },
        }),
      }),
    run: (stage) => {
      calls.push(stage.id);
      return 0;
    },
    log: (line) => lines.push(line),
  });

  assert.equal(status, 1);
  assert.deepEqual(calls, ['shared-build', 'server', 'web']);
  assert.match(lines.at(-2), /must define a non-empty test script/);
  assert.match(lines.at(-1), /server: PASS.*web: PASS.*cli: FAIL.*mcp: NOT RUN/);
});

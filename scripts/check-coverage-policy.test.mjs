import assert from 'node:assert/strict';
import test from 'node:test';

import { validateCoveragePolicy } from './check-coverage-policy.mjs';

const packages = ['server', 'web', 'cli', 'mcp', 'desktop'].map((id) => ({
  id,
  report: `coverage/${id}/coverage-summary.json`,
  boundaries: [
    {
      id: 'critical',
      description: 'Critical boundary.',
      include: [`${id}/src/**/*.ts`],
      thresholds: { lines: 50, branches: 40, functions: 50, statements: 50 },
    },
  ],
}));

const valid = {
  policy: {
    schemaVersion: 'critical-path-coverage/v1',
    longTermTarget: { lines: 80, branches: 80, functions: 80, statements: 80 },
    packages,
  },
  packageJson: {
    scripts: { 'test:coverage': 'node scripts/run-coverage.mjs' },
    devDependencies: { '@vitest/coverage-v8': '^4.1.11' },
  },
  workflow:
    'critical-path-coverage:\nneeds.select-tests.outputs.coverage_packages\npnpm test:coverage --packages\nactions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
  configs: Object.fromEntries(
    ['server', 'web', 'cli', 'mcp', 'desktop'].map((id) => [
      id,
      "provider: 'v8'\nall: true\n'src/**/*.d.ts'",
    ])
  ),
};

test('accepts a complete measured policy and rejects zero floors', () => {
  assert.deepEqual(validateCoveragePolicy(valid), []);

  const invalid = globalThis.structuredClone(valid);
  invalid.policy.packages[0].boundaries[0].thresholds.lines = 0;
  assert.match(validateCoveragePolicy(invalid).join('\n'), /lines threshold/);
});

test('requires the command, CI artifact, and all workspace configs', () => {
  const invalid = globalThis.structuredClone(valid);
  invalid.packageJson.scripts = {};
  invalid.workflow = '';
  invalid.configs.web = '';
  const errors = validateCoveragePolicy(invalid).join('\n');

  assert.match(errors, /documented test:coverage command/);
  assert.match(errors, /CI must define/);
  assert.match(errors, /web coverage must use V8/);
});

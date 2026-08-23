import assert from 'node:assert/strict';
import test from 'node:test';

import { compareCoveragePolicy, validateCoveragePolicy } from './check-coverage-policy.mjs';

const packages = ['server', 'web', 'cli', 'mcp', 'desktop'].map((id) => ({
  id,
  report: `coverage/${id}/coverage-summary.json`,
  ...(id === 'server' || id === 'web'
    ? { runner: { testFiles: ['src/__tests__/critical.test.ts'] } }
    : {}),
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
    'jobs:\n  critical-path-coverage:\n    fetch-depth: 0\n    needs.select-tests.outputs.coverage_packages\n    needs.select-tests.outputs.base_sha\n    pnpm test:coverage --packages\n    COVERAGE_BASE_REF:\n    if: always() && needs.select-tests.outputs.coverage_packages\n    actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a\n  build:\n    runs-on: ubuntu-latest',
  configs: Object.fromEntries(
    ['server', 'web', 'cli', 'mcp', 'desktop'].map((id) => [
      id,
      [
        "provider: 'v8'",
        'all: true',
        "'src/**/*.d.ts'",
        "'src/**/__fixtures__/**'",
        "'src/**/fixtures/**'",
        "'src/**/generated/**'",
        "'src/**/*.generated.*'",
        "'src/**/types.ts'",
        "'src/types/**/*.ts'",
      ].join('\n'),
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
  assert.match(errors, /fetch the base commit/);
  assert.match(errors, /web coverage must use V8/);
});

test('requires the coverage job itself to fetch the comparison base', () => {
  const invalid = globalThis.structuredClone(valid);
  invalid.workflow = invalid.workflow.replace('    fetch-depth: 0\n', '');

  assert.match(validateCoveragePolicy(invalid).join('\n'), /fetch the base commit/);
});

test('rejects missing governed test inventory entries', () => {
  const errors = validateCoveragePolicy({
    ...valid,
    fileExists: (relativePath) => relativePath !== 'server/src/__tests__/critical.test.ts',
  }).join('\n');

  assert.match(errors, /governed coverage test file does not exist/);
});

test('rejects lowered floors, removed boundaries, and narrowed governed scope', () => {
  const baseline = globalThis.structuredClone(valid.policy);
  const lowered = globalThis.structuredClone(valid.policy);
  lowered.packages[0].report = 'coverage/fabricated/coverage-summary.json';
  lowered.packages[0].runner.testFiles = [];
  lowered.packages[0].boundaries[0].thresholds.lines = 49;
  lowered.packages[0].boundaries[0].include = [];
  lowered.packages[1].boundaries = [];

  const errors = compareCoveragePolicy(lowered, baseline).join('\n');
  assert.match(errors, /server\/critical lines threshold cannot decrease/);
  assert.match(errors, /cannot remove governed runner testFiles input/);
  assert.match(errors, /cannot remove governed include pattern/);
  assert.match(errors, /coverage boundary web\/critical cannot be removed/);

  assert.match(
    validateCoveragePolicy({ ...valid, policy: lowered, baselinePolicy: baseline }).join('\n'),
    /canonical machine-readable coverage summary/
  );
});

test('requires exact, tracked, short-lived coverage exceptions', () => {
  const invalid = globalThis.structuredClone(valid);
  invalid.policy.packages[0].boundaries[0].exceptions = [
    {
      path: 'server/src/**',
      reason: 'short',
      owner: 'not a login!',
      trackingIssue: 'later',
      reviewBy: 'never',
    },
  ];
  const errors = validateCoveragePolicy({ ...invalid, today: '2026-08-23' }).join('\n');

  assert.match(errors, /one exact repository-relative file/);
  assert.match(errors, /at least 20 characters/);
  assert.match(errors, /GitHub login/);
  assert.match(errors, /tracking issue/);
  assert.match(errors, /real YYYY-MM-DD date/);
});

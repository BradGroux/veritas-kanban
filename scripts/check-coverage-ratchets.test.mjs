import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateCoverage,
  markdownSummary,
  normalizeCoverageSummary,
  normalizeDetailedCoverage,
  parseChangedLineNumbers,
  parseSelectedPackages,
} from './check-coverage-ratchets.mjs';

const metric = (covered, total) => ({ covered, total, skipped: 0, pct: (covered / total) * 100 });
const fileCoverage = (covered, total) => ({
  lines: metric(covered, total),
  branches: metric(covered, total),
  functions: metric(covered, total),
  statements: metric(covered, total),
});

const policy = {
  schemaVersion: 'critical-path-coverage/v1',
  longTermTarget: { lines: 80, branches: 80, functions: 80, statements: 80 },
  packages: [
    {
      id: 'server',
      runner: { testFiles: ['src/__tests__/auth.test.ts'] },
      boundaries: [
        {
          id: 'auth',
          description: 'Authentication boundary.',
          include: ['server/src/middleware/**/*.ts'],
          thresholds: { lines: 75, branches: 75, functions: 75, statements: 75 },
        },
      ],
    },
  ],
};

test('normalizes absolute report paths to repository-relative POSIX paths', () => {
  const summary = {
    total: fileCoverage(1, 1),
    '/repo/server/src/middleware/auth.ts': fileCoverage(3, 4),
  };

  assert.deepEqual(Object.keys(normalizeCoverageSummary(summary, '/repo')), [
    'server/src/middleware/auth.ts',
  ]);
  assert.deepEqual(
    Object.keys(
      normalizeDetailedCoverage(
        { '/repo/server/src/middleware/auth.ts': { statementMap: {}, s: {} } },
        '/repo'
      )
    ),
    ['server/src/middleware/auth.ts']
  );
});

test('extracts added and modified line numbers from zero-context diffs', () => {
  const lines = parseChangedLineNumbers(
    '@@ -4 +4,2 @@\n-old\n+new\n+next\n@@ -10,2 +11 @@\n-old\n-old\n+new\n@@ -20 +21,0 @@\n-old\n'
  );
  assert.deepEqual([...lines], [4, 5, 11]);
});

test('aggregates a boundary and accepts its measured floor', () => {
  const evaluation = evaluateCoverage(policy, {
    server: {
      'server/src/middleware/auth.ts': fileCoverage(3, 4),
      'server/src/routes/tasks.ts': fileCoverage(0, 10),
    },
  });

  assert.deepEqual(evaluation.failures, []);
  assert.equal(evaluation.results[0].metrics.lines.pct, 75);
  assert.match(markdownSummary(evaluation, policy.longTermTarget), /server \| auth \| 75%/);
});

test('rejects a metric regression and a boundary without report entries', () => {
  const regression = evaluateCoverage(policy, {
    server: { 'server/src/middleware/auth.ts': fileCoverage(2, 4) },
  });
  assert.equal(regression.failures.length, 4);

  const missing = evaluateCoverage(policy, {
    server: { 'server/src/routes/tasks.ts': fileCoverage(4, 4) },
  });
  assert.deepEqual(missing.failures, ['server/auth matched no reported source files']);
  assert.equal(missing.results[0].status, 'fail');
  assert.equal(missing.results[0].metrics.lines.pct, 0);
});

test('requires bounded reviewed exceptions and omits active exceptions', () => {
  const withException = globalThis.structuredClone(policy);
  withException.packages[0].boundaries[0].exceptions = [
    {
      path: 'server/src/middleware/legacy.ts',
      reason: 'Legacy adapter awaiting removal.',
      owner: 'BradGroux',
      trackingIssue: '#1169',
      reviewBy: '2026-09-30',
    },
  ];
  const evaluation = evaluateCoverage(
    withException,
    {
      server: {
        'server/src/middleware/auth.ts': fileCoverage(4, 4),
        'server/src/middleware/legacy.ts': fileCoverage(0, 4),
      },
    },
    '2026-08-23'
  );
  assert.deepEqual(evaluation.failures, []);
  assert.deepEqual(evaluation.results[0].files, ['server/src/middleware/auth.ts']);

  withException.packages[0].boundaries[0].exceptions[0].reviewBy = 'never';
  assert.throws(
    () => evaluateCoverage(withException, { server: {} }, '2026-08-23'),
    /reviewBy must be a real YYYY-MM-DD date/
  );
});

test('rejects a changed critical file without covered executable lines', () => {
  const uncovered = evaluateCoverage(
    policy,
    {
      server: {
        'server/src/middleware/auth.ts': fileCoverage(3, 4),
        'server/src/middleware/new-auth.ts': fileCoverage(0, 4),
      },
    },
    '2026-08-23',
    ['server/src/middleware/new-auth.ts']
  );
  assert.ok(
    uncovered.failures.includes(
      'server/auth changed critical file server/src/middleware/new-auth.ts has no covered lines'
    )
  );
  assert.equal(uncovered.results[0].status, 'fail');
});

test('requires changed executable statements themselves to be covered', () => {
  const summary = { server: { 'server/src/middleware/auth.ts': fileCoverage(3, 4) } };
  const details = {
    server: {
      'server/src/middleware/auth.ts': {
        statementMap: {
          0: { start: { line: 10 }, end: { line: 10 } },
          1: { start: { line: 20 }, end: { line: 22 } },
        },
        s: { 0: 1, 1: 0 },
      },
    },
  };
  const changedLines = new Map([['server/src/middleware/auth.ts', new Set([21])]]);
  const uncovered = evaluateCoverage(
    policy,
    summary,
    '2026-08-23',
    ['server/src/middleware/auth.ts'],
    details,
    changedLines
  );
  assert.match(uncovered.failures.join('\n'), /uncovered executable statements on line\(s\) 20/);
  assert.equal(uncovered.results[0].status, 'fail');

  details.server['server/src/middleware/auth.ts'].s[1] = 1;
  const covered = evaluateCoverage(
    policy,
    summary,
    '2026-08-23',
    ['server/src/middleware/auth.ts'],
    details,
    changedLines
  );
  assert.deepEqual(covered.failures, []);
  assert.equal(covered.results[0].status, 'pass');
});

test('rejects broad and untracked exceptions', () => {
  const invalid = globalThis.structuredClone(policy);
  invalid.packages[0].boundaries[0].exceptions = [
    {
      path: 'server/src/middleware/**',
      reason: 'This reason is long enough for review.',
      owner: 'BradGroux',
      trackingIssue: '#1169',
      reviewBy: '2026-09-01',
    },
  ];
  assert.throws(
    () => evaluateCoverage(invalid, { server: {} }, '2026-08-23'),
    /one exact repository-relative file/
  );
});

test('validates selected coverage packages', () => {
  assert.deepEqual(parseSelectedPackages([], ['server', 'web']), ['server', 'web']);
  assert.deepEqual(parseSelectedPackages(['--packages=web'], ['server', 'web']), ['web']);
  assert.throws(() => parseSelectedPackages(['--packages', 'unknown'], ['server']), /Unknown/);
});

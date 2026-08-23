import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findGitleaksIgnoreViolations,
  findSecurityWorkflowViolations,
} from './check-security-gates.mjs';

const SHA = 'db488ddef3bf6cb639b32c2e9a7c0a7ea8271d28';

test('accepts a least-privilege scheduled CodeQL and gitleaks workflow', () => {
  const workflow = `
name: Security Gates
on:
  pull_request:
  push:
    branches: [main]
  schedule:
    - cron: '17 9 * * 3'
permissions:
  contents: read
jobs:
  codeql:
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: github/codeql-action/init@${SHA} # v4.37.8
      - uses: github/codeql-action/analyze@${SHA} # v4.37.8
  gitleaks:
    permissions:
      contents: read
    steps:
      - run: pnpm check:gitleaks
`;

  assert.deepEqual(findSecurityWorkflowViolations(workflow), []);
});

test('rejects missing schedules, broad permissions, and incomplete gates', () => {
  assert.deepEqual(
    findSecurityWorkflowViolations(`
name: Security Gates
on: [pull_request]
permissions: write-all
jobs:
  codeql:
    steps:
      - uses: github/codeql-action/init@v4
  gitleaks:
    env:
      GITLEAKS_BIN: \${{ runner.temp }}/gitleaks
`),
    [
      'security workflow must run for pull requests, main pushes, and a schedule',
      'top-level workflow permissions must be contents: read only',
      'CodeQL job must grant only contents: read and security-events: write',
      'CodeQL init and analyze actions must both be present',
      'runner context must not be used in job-level environment values',
      'gitleaks job must run pnpm check:gitleaks with contents: read permission',
    ]
  );
});

test('accepts exact gitleaks fingerprints with review comments', () => {
  assert.deepEqual(
    findGitleaksIgnoreViolations(
      `# Reviewed synthetic fixture\nserver/src/example.test.ts:generic-api-key:42\n`
    ),
    []
  );
});

test('rejects broad or undocumented gitleaks suppressions', () => {
  assert.deepEqual(
    findGitleaksIgnoreViolations(`server/.*\n# documented\n.*:generic-api-key:42\n`),
    [
      'line 1: every ignored fingerprint needs a preceding review comment',
      'line 1: ignore must be an exact path:rule:line fingerprint',
      'line 3: ignore must be an exact path:rule:line fingerprint',
    ]
  );
});

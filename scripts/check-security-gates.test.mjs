import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findGitleaksIgnoreViolations,
  findSecurityWorkflowViolations,
} from './check-security-gates.mjs';

const SHA_4_37_8 = 'db488ddef3bf6cb639b32c2e9a7c0a7ea8271d28';
const SHA_4_37_9 = 'cdf488f595d80d6e07e03d4674febd5ab45fa938';

function securityWorkflow({
  initSha = SHA_4_37_8,
  initVersion = 'v4.37.8',
  analyzeSha = SHA_4_37_8,
  analyzeVersion = 'v4.37.8',
} = {}) {
  return `
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
      - uses: github/codeql-action/init@${initSha} # ${initVersion}
      - uses: github/codeql-action/analyze@${analyzeSha} # ${analyzeVersion}
  gitleaks:
    permissions:
      contents: read
    steps:
      - run: pnpm check:gitleaks
`;
}

test('accepts a least-privilege scheduled CodeQL and gitleaks workflow', () => {
  assert.deepEqual(findSecurityWorkflowViolations(securityWorkflow()), []);
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

test('rejects mixed CodeQL action revisions', () => {
  assert.deepEqual(findSecurityWorkflowViolations(securityWorkflow({ analyzeSha: SHA_4_37_9 })), [
    'CodeQL init and analyze actions must use the same pinned revision',
  ]);
});

test('rejects mismatched CodeQL action version annotations', () => {
  assert.deepEqual(
    findSecurityWorkflowViolations(securityWorkflow({ analyzeVersion: 'v4.37.9' })),
    ['CodeQL init and analyze actions must use the same pinned revision']
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

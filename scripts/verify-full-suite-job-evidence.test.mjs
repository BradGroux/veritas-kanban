import assert from 'node:assert/strict';
import test from 'node:test';

import { hasSuccessfulFullSuiteEvidence } from './verify-full-suite-job-evidence.mjs';

function job(overrides = {}) {
  return {
    status: 'completed',
    conclusion: 'success',
    steps: [
      {
        name: 'Run workspace unit tests',
        status: 'completed',
        conclusion: 'success',
      },
      {
        name: 'Run desktop readiness regression tests',
        status: 'completed',
        conclusion: 'success',
      },
      {
        name: 'Run dual-storage parity tests',
        status: 'completed',
        conclusion: 'success',
      },
    ],
    ...overrides,
  };
}

test('accepts a successful job only when every full-suite step passed', () => {
  assert.equal(hasSuccessfulFullSuiteEvidence(job()), true);
});

test('rejects a successful wrapper job whose workspace suite was skipped', () => {
  const evidence = job({
    steps: job().steps.map((step) =>
      step.name === 'Run workspace unit tests' ? { ...step, conclusion: 'skipped' } : step
    ),
  });

  assert.equal(hasSuccessfulFullSuiteEvidence(evidence), false);
});

test('rejects failed, incomplete, malformed, and missing job evidence', () => {
  assert.equal(hasSuccessfulFullSuiteEvidence(job({ conclusion: 'failure' })), false);
  assert.equal(hasSuccessfulFullSuiteEvidence(job({ status: 'in_progress' })), false);
  assert.equal(hasSuccessfulFullSuiteEvidence(job({ steps: [] })), false);
  assert.equal(hasSuccessfulFullSuiteEvidence({}), false);
  assert.equal(hasSuccessfulFullSuiteEvidence(null), false);
});

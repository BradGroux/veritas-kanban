import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  hasSuccessfulCoverageEvidence,
  hasSuccessfulFullSuiteEvidence,
} from './verify-full-suite-job-evidence.mjs';

const scriptPath = fileURLToPath(new URL('./verify-full-suite-job-evidence.mjs', import.meta.url));

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

test('command-line entrypoint validates piped GitHub job JSON', () => {
  const accepted = spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify(job()),
    encoding: 'utf8',
  });
  assert.equal(accepted.status, 0, accepted.stderr);

  const rejected = spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify(job({ steps: [] })),
    encoding: 'utf8',
  });
  assert.equal(rejected.status, 1, rejected.stderr);
});

test('requires successful policy, ratchet, and artifact steps for coverage evidence', () => {
  const coverageJob = job({
    steps: [
      { name: 'Verify coverage policy', status: 'completed', conclusion: 'success' },
      { name: 'Measure and ratchet critical paths', status: 'completed', conclusion: 'success' },
      { name: 'Upload coverage reports', status: 'completed', conclusion: 'success' },
    ],
  });
  assert.equal(hasSuccessfulCoverageEvidence(coverageJob), true);
  coverageJob.steps[2].conclusion = 'skipped';
  assert.equal(hasSuccessfulCoverageEvidence(coverageJob), false);

  const accepted = spawnSync(process.execPath, [scriptPath, 'coverage'], {
    input: JSON.stringify({
      ...coverageJob,
      steps: coverageJob.steps.map((step) => ({ ...step, conclusion: 'success' })),
    }),
    encoding: 'utf8',
  });
  assert.equal(accepted.status, 0, accepted.stderr);
});

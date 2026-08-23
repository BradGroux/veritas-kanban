#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_FULL_SUITE_STEPS = [
  'Run workspace unit tests',
  'Run desktop readiness regression tests',
  'Run dual-storage parity tests',
];
const REQUIRED_COVERAGE_STEPS = [
  'Verify coverage policy',
  'Measure and ratchet critical paths',
  'Upload coverage reports',
];

function hasSuccessfulJobEvidence(job, requiredSteps) {
  if (
    !job ||
    typeof job !== 'object' ||
    job.status !== 'completed' ||
    job.conclusion !== 'success' ||
    !Array.isArray(job.steps)
  ) {
    return false;
  }

  return requiredSteps.every((requiredName) =>
    job.steps.some(
      (step) =>
        step &&
        typeof step === 'object' &&
        step.name === requiredName &&
        step.status === 'completed' &&
        step.conclusion === 'success'
    )
  );
}

export function hasSuccessfulFullSuiteEvidence(job) {
  return hasSuccessfulJobEvidence(job, REQUIRED_FULL_SUITE_STEPS);
}

export function hasSuccessfulCoverageEvidence(job) {
  return hasSuccessfulJobEvidence(job, REQUIRED_COVERAGE_STEPS);
}

async function main() {
  let job;

  try {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
    }
    job = JSON.parse(input);
  } catch {
    process.exitCode = 1;
    return;
  }

  const validator =
    process.argv[2] === 'coverage' ? hasSuccessfulCoverageEvidence : hasSuccessfulFullSuiteEvidence;
  if (!validator(job)) {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}

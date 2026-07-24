#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_FULL_SUITE_STEPS = [
  'Run workspace unit tests',
  'Run desktop readiness regression tests',
  'Run dual-storage parity tests',
];

export function hasSuccessfulFullSuiteEvidence(job) {
  if (
    !job ||
    typeof job !== 'object' ||
    job.status !== 'completed' ||
    job.conclusion !== 'success' ||
    !Array.isArray(job.steps)
  ) {
    return false;
  }

  return REQUIRED_FULL_SUITE_STEPS.every((requiredName) =>
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

async function main() {
  let job;

  try {
    job = JSON.parse(await readFile(0, 'utf8'));
  } catch {
    process.exitCode = 1;
    return;
  }

  if (!hasSuccessfulFullSuiteEvidence(job)) {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}

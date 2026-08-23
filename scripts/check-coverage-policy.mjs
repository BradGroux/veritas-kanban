#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { coverageExceptionErrors } from './coverage-policy-utils.mjs';

const EXPECTED_PACKAGES = ['server', 'web', 'cli', 'mcp', 'desktop'];
const METRICS = ['lines', 'branches', 'functions', 'statements'];
const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const GLOB_PATTERN = /[*?[\]{}!]/;

export function compareCoveragePolicy(current, baseline) {
  const errors = [];
  for (const baselinePackage of baseline?.packages ?? []) {
    const currentPackage = current.packages?.find(({ id }) => id === baselinePackage.id);
    if (!currentPackage) {
      errors.push(`coverage package ${baselinePackage.id} cannot be removed`);
      continue;
    }
    for (const baselineBoundary of baselinePackage.boundaries ?? []) {
      const fullId = `${baselinePackage.id}/${baselineBoundary.id}`;
      const currentBoundary = currentPackage.boundaries?.find(
        ({ id }) => id === baselineBoundary.id
      );
      if (!currentBoundary) {
        errors.push(`coverage boundary ${fullId} cannot be removed`);
        continue;
      }
      for (const metric of METRICS) {
        if (currentBoundary.thresholds?.[metric] < baselineBoundary.thresholds?.[metric]) {
          errors.push(`${fullId} ${metric} threshold cannot decrease`);
        }
      }
      for (const pattern of baselineBoundary.include ?? []) {
        if (!currentBoundary.include?.includes(pattern)) {
          errors.push(`${fullId} cannot remove governed include pattern ${pattern}`);
        }
      }
    }
    for (const field of ['testFiles', 'triggerPatterns']) {
      for (const input of baselinePackage.runner?.[field] ?? []) {
        if (!currentPackage.runner?.[field]?.includes(input)) {
          errors.push(`${baselinePackage.id} cannot remove governed runner ${field} input ${input}`);
        }
      }
    }
  }
  return errors;
}

export function validateCoveragePolicy({
  policy,
  baselinePolicy,
  packageJson,
  workflow,
  configs,
  today = new Date().toISOString().slice(0, 10),
}) {
  const errors = [];
  const packageIds = policy.packages?.map(({ id }) => id) ?? [];
  const coverageJob = workflow.match(
    /(?:^|\n) {2}critical-path-coverage:\n[\s\S]*?(?=\n {2}[a-zA-Z0-9_-]+:\n|$)/
  )?.[0];

  if (policy.schemaVersion !== 'critical-path-coverage/v1') {
    errors.push('coverage policy must use critical-path-coverage/v1');
  }
  if (JSON.stringify(packageIds) !== JSON.stringify(EXPECTED_PACKAGES)) {
    errors.push(`coverage policy packages must be ${EXPECTED_PACKAGES.join(', ')}`);
  }
  for (const metric of METRICS) {
    if (policy.longTermTarget?.[metric] < 80) {
      errors.push(`long-term ${metric} target must be at least 80%`);
    }
  }

  const boundaryIds = new Set();
  for (const packagePolicy of policy.packages ?? []) {
    if (packagePolicy.report !== `coverage/${packagePolicy.id}/coverage-summary.json`) {
      errors.push(`${packagePolicy.id} must use its canonical machine-readable coverage summary`);
    }
    for (const testFile of packagePolicy.runner?.testFiles ?? []) {
      if (
        path.posix.normalize(testFile) !== testFile ||
        path.posix.isAbsolute(testFile) ||
        GLOB_PATTERN.test(testFile) ||
        !/\.test\.[cm]?[jt]sx?$/.test(testFile)
      ) {
        errors.push(`${packagePolicy.id} coverage test files must be exact test paths`);
      }
    }
    for (const boundary of packagePolicy.boundaries ?? []) {
      const fullId = `${packagePolicy.id}/${boundary.id}`;
      if (boundaryIds.has(fullId)) errors.push(`duplicate boundary ${fullId}`);
      boundaryIds.add(fullId);
      if (
        !boundary.description ||
        !Array.isArray(boundary.include) ||
        boundary.include.length === 0
      ) {
        errors.push(`${fullId} requires a description and include patterns`);
      }
      for (const metric of METRICS) {
        const threshold = boundary.thresholds?.[metric];
        if (typeof threshold !== 'number' || threshold <= 0 || threshold > 100) {
          errors.push(`${fullId} ${metric} threshold must be between 0 and 100`);
        }
      }
      for (const exception of boundary.exceptions ?? []) {
        errors.push(...coverageExceptionErrors(exception, fullId, today));
      }
    }
  }

  if (!packageJson.scripts?.['test:coverage']?.includes('scripts/run-coverage.mjs')) {
    errors.push('package.json must expose the documented test:coverage command');
  }
  if (!packageJson.devDependencies?.['@vitest/coverage-v8']) {
    errors.push('the root workspace must own @vitest/coverage-v8');
  }
  if (!workflow.includes('critical-path-coverage:')) {
    errors.push('CI must define the Critical Path Coverage job');
  }
  if (!workflow.includes('needs.select-tests.outputs.coverage_packages')) {
    errors.push('CI coverage must use the deterministic package selection output');
  }
  if (!workflow.includes('pnpm test:coverage --packages')) {
    errors.push('CI must execute the documented coverage command');
  }
  if (!workflow.includes('COVERAGE_BASE_REF:')) {
    errors.push('CI must compare coverage policy and changed critical files with the base commit');
  }
  if (!coverageJob?.includes('fetch-depth: 0')) {
    errors.push('CI coverage checkout must fetch the base commit used by coverage ratchets');
  }
  if (!workflow.includes('if: always() && needs.select-tests.outputs.coverage_packages')) {
    errors.push('CI must preserve coverage artifacts after a failed ratchet');
  }
  if (!workflow.includes('actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a')) {
    errors.push('CI must upload coverage with the immutable approved action');
  }

  for (const packageId of EXPECTED_PACKAGES) {
    const config = configs[packageId] ?? '';
    if (!config.includes("provider: 'v8'") || !config.includes('all: true')) {
      errors.push(`${packageId} coverage must use V8 and include untested source`);
    }
    if (!config.includes("'src/**/*.d.ts'")) {
      errors.push(`${packageId} coverage must exclude type declarations`);
    }
    for (const pattern of [
      'src/**/__fixtures__/**',
      'src/**/fixtures/**',
      'src/**/generated/**',
      'src/**/*.generated.*',
      'src/**/types.ts',
      'src/types/**/*.ts',
    ]) {
      if (!config.includes(pattern)) errors.push(`${packageId} coverage must exclude ${pattern}`);
    }
  }
  for (const packageId of ['server', 'web']) {
    if (
      (policy.packages.find(({ id }) => id === packageId)?.runner?.testFiles?.length ?? 0) === 0
    ) {
      errors.push(`${packageId} critical coverage must use exact test files`);
    }
  }

  errors.push(...compareCoveragePolicy(policy, baselinePolicy));

  return errors;
}

function readBaselinePolicy(repoRoot) {
  const baselineRef = process.env.COVERAGE_BASE_REF;
  if (!baselineRef) return undefined;
  if (!COMMIT_SHA_PATTERN.test(baselineRef)) {
    throw new Error('COVERAGE_BASE_REF must be a hexadecimal commit ID.');
  }
  execFileSync('git', ['cat-file', '-e', `${baselineRef}^{commit}`], {
    cwd: repoRoot,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  let baselineText;
  try {
    baselineText = execFileSync(
      'git',
      ['show', `${baselineRef}:docs/testing/critical-path-coverage.json`],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    );
  } catch {
    return undefined;
  }
  return JSON.parse(baselineText);
}

async function main(repoRoot = process.cwd()) {
  const [policy, packageJson, workflow, ...configTexts] = await Promise.all([
    readFile(path.join(repoRoot, 'docs/testing/critical-path-coverage.json'), 'utf8').then(
      JSON.parse
    ),
    readFile(path.join(repoRoot, 'package.json'), 'utf8').then(JSON.parse),
    readFile(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8'),
    ...EXPECTED_PACKAGES.map((packageId) =>
      readFile(path.join(repoRoot, packageId, 'vitest.config.ts'), 'utf8')
    ),
  ]);
  const configs = Object.fromEntries(
    EXPECTED_PACKAGES.map((packageId, index) => [packageId, configTexts[index]])
  );
  const errors = validateCoveragePolicy({
    policy,
    baselinePolicy: readBaselinePolicy(repoRoot),
    packageJson,
    workflow,
    configs,
  });

  if (errors.length > 0) {
    throw new Error(`Coverage policy check failed:\n- ${errors.join('\n- ')}`);
  }
  console.log(
    `Critical-path coverage policy covers ${EXPECTED_PACKAGES.length} packages and ${policy.packages.reduce((sum, packagePolicy) => sum + packagePolicy.boundaries.length, 0)} boundaries.`
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

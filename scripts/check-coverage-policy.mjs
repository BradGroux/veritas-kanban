#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_PACKAGES = ['server', 'web', 'cli', 'mcp', 'desktop'];
const METRICS = ['lines', 'branches', 'functions', 'statements'];

export function validateCoveragePolicy({ policy, packageJson, workflow, configs }) {
  const errors = [];
  const packageIds = policy.packages?.map(({ id }) => id) ?? [];

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
    if (!packagePolicy.report?.endsWith('/coverage-summary.json')) {
      errors.push(`${packagePolicy.id} must declare a machine-readable coverage summary`);
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
        if (!exception.path || !exception.reason || !exception.owner || !exception.reviewBy) {
          errors.push(`${fullId} exceptions require path, reason, owner, and reviewBy`);
        }
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
  }

  return errors;
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
  const errors = validateCoveragePolicy({ policy, packageJson, workflow, configs });

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

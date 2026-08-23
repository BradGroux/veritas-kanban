#!/usr/bin/env node
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path, { matchesGlob } from 'node:path';
import { fileURLToPath } from 'node:url';

const METRICS = ['lines', 'branches', 'functions', 'statements'];
const POLICY_PATH = 'docs/testing/critical-path-coverage.json';

function roundPercent(covered, total) {
  if (total === 0) return 100;
  return Math.floor((covered / total) * 10000) / 100;
}

export function parseSelectedPackages(args, available) {
  const valueIndex = args.findIndex((arg) => arg === '--packages');
  const inline = args.find((arg) => arg.startsWith('--packages='));
  const raw =
    inline?.slice('--packages='.length) ?? (valueIndex >= 0 ? args[valueIndex + 1] : undefined);
  const selected = raw
    ? [
        ...new Set(
          raw
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        ),
      ]
    : [...available];
  const unknown = selected.filter((id) => !available.includes(id));

  if (unknown.length > 0) throw new Error(`Unknown coverage package(s): ${unknown.join(', ')}`);
  if (selected.length === 0) throw new Error('At least one coverage package is required.');
  return selected;
}

export function normalizeCoverageSummary(summary, repoRoot) {
  return Object.fromEntries(
    Object.entries(summary)
      .filter(([file]) => file !== 'total')
      .map(([file, metrics]) => {
        const relative = path.isAbsolute(file) ? path.relative(repoRoot, file) : file;
        return [relative.split(path.sep).join('/'), metrics];
      })
  );
}

function validateException(exception, today) {
  if (!exception.path || !exception.reason || !exception.owner || !exception.reviewBy) {
    throw new Error('Coverage exceptions require path, reason, owner, and reviewBy.');
  }
  if (exception.reviewBy < today) {
    throw new Error(`Coverage exception expired for ${exception.path} on ${exception.reviewBy}.`);
  }
}

function aggregate(entries) {
  return Object.fromEntries(
    METRICS.map((metric) => {
      const total = entries.reduce((sum, [, value]) => sum + value[metric].total, 0);
      const covered = entries.reduce((sum, [, value]) => sum + value[metric].covered, 0);
      return [metric, { total, covered, pct: roundPercent(covered, total) }];
    })
  );
}

export function evaluateCoverage(policy, summaries, today = new Date().toISOString().slice(0, 10)) {
  if (policy.schemaVersion !== 'critical-path-coverage/v1') {
    throw new Error(`Unsupported coverage policy schema: ${policy.schemaVersion}`);
  }

  const results = [];
  const failures = [];

  for (const packagePolicy of policy.packages) {
    const summary = summaries[packagePolicy.id];
    if (!summary) continue;

    for (const boundary of packagePolicy.boundaries) {
      const exceptions = boundary.exceptions ?? [];
      for (const exception of exceptions) validateException(exception, today);

      const entries = Object.entries(summary).filter(([file]) => {
        const included = boundary.include.some((pattern) => matchesGlob(file, pattern));
        const excepted = exceptions.some((exception) => matchesGlob(file, exception.path));
        return included && !excepted;
      });

      if (entries.length === 0) {
        failures.push(`${packagePolicy.id}/${boundary.id} matched no reported source files`);
        continue;
      }

      const metrics = aggregate(entries);
      const regressions = METRICS.filter(
        (metric) => metrics[metric].pct < boundary.thresholds[metric]
      );
      for (const metric of regressions) {
        failures.push(
          `${packagePolicy.id}/${boundary.id} ${metric} ${metrics[metric].pct}% is below ${boundary.thresholds[metric]}%`
        );
      }

      results.push({
        package: packagePolicy.id,
        boundary: boundary.id,
        description: boundary.description,
        files: entries.map(([file]) => file).sort(),
        metrics,
        thresholds: boundary.thresholds,
        status: regressions.length === 0 ? 'pass' : 'fail',
      });
    }
  }

  return { results, failures };
}

export function markdownSummary(evaluation, longTermTarget) {
  const lines = [
    '### Critical-path coverage ratchets',
    '',
    '| Package | Boundary | Lines | Branches | Functions | Statements | Result |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- |',
  ];

  for (const result of evaluation.results) {
    lines.push(
      `| ${result.package} | ${result.boundary} | ${result.metrics.lines.pct}% | ${result.metrics.branches.pct}% | ${result.metrics.functions.pct}% | ${result.metrics.statements.pct}% | ${result.status} |`
    );
  }

  lines.push(
    '',
    `Long-term critical-path target: ${longTermTarget.lines}% lines, ${longTermTarget.branches}% branches, ${longTermTarget.functions}% functions, and ${longTermTarget.statements}% statements.`,
    ''
  );
  return lines.join('\n');
}

export async function runCoverageRatchets({
  repoRoot = process.cwd(),
  args = process.argv.slice(2),
} = {}) {
  const policy = JSON.parse(await readFile(path.join(repoRoot, POLICY_PATH), 'utf8'));
  const available = policy.packages.map(({ id }) => id);
  const selected = parseSelectedPackages(args, available);
  const summaries = {};

  for (const packagePolicy of policy.packages) {
    if (!selected.includes(packagePolicy.id)) continue;
    const reportPath = path.join(repoRoot, packagePolicy.report);
    const summary = JSON.parse(await readFile(reportPath, 'utf8'));
    summaries[packagePolicy.id] = normalizeCoverageSummary(summary, repoRoot);
  }

  const evaluation = evaluateCoverage(policy, summaries);
  const machineReport = {
    schemaVersion: 'critical-path-coverage-report/v1',
    longTermTarget: policy.longTermTarget,
    packages: selected,
    results: evaluation.results,
    failures: evaluation.failures,
  };
  const markdown = markdownSummary(evaluation, policy.longTermTarget);
  const outputDir = path.join(repoRoot, 'coverage');
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, 'critical-path-summary.json'),
    `${JSON.stringify(machineReport, null, 2)}\n`
  );
  await writeFile(path.join(outputDir, 'critical-path-summary.md'), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
  }

  console.log(markdown);
  if (evaluation.failures.length > 0) {
    throw new Error(`Coverage ratchet failed:\n- ${evaluation.failures.join('\n- ')}`);
  }
  return machineReport;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  runCoverageRatchets().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

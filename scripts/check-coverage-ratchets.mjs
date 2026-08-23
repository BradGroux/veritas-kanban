#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path, { matchesGlob } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { coverageExceptionErrors } from './coverage-policy-utils.mjs';

const METRICS = ['lines', 'branches', 'functions', 'statements'];
const POLICY_PATH = 'docs/testing/critical-path-coverage.json';
const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

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

export function normalizeDetailedCoverage(coverage, repoRoot) {
  return Object.fromEntries(
    Object.entries(coverage).map(([file, details]) => {
      const relative = path.isAbsolute(file) ? path.relative(repoRoot, file) : file;
      return [relative.split(path.sep).join('/'), details];
    })
  );
}

function validateException(exception, label, today) {
  const errors = coverageExceptionErrors(exception, label, today);
  if (errors.length > 0) throw new Error(errors.join('\n'));
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

function emptyMetrics() {
  return Object.fromEntries(METRICS.map((metric) => [metric, { total: 0, covered: 0, pct: 0 }]));
}

function uncoveredChangedStatements(details, changedLines) {
  if (!details || changedLines.size === 0) return [];
  return Object.entries(details.statementMap ?? {})
    .filter(([, location]) => {
      for (let line = location.start.line; line <= location.end.line; line += 1) {
        if (changedLines.has(line)) return true;
      }
      return false;
    })
    .filter(([id]) => (details.s?.[id] ?? 0) === 0)
    .map(([, location]) => location.start.line)
    .sort((left, right) => left - right);
}

function changedTokenSpans(changedLines, changedSpans, sourceFile) {
  const lineStarts = sourceFile.getLineStarts();
  return new Map(
    [...changedLines].flatMap((line) => {
      if (line < 1 || line > lineStarts.length) return [];
      const lineStart = lineStarts[line - 1];
      const nextLineStart = lineStarts[line] ?? sourceFile.text.length;
      const lineLength = sourceFile.text
        .slice(lineStart, nextLineStart)
        .replace(/[\r\n]+$/, '').length;
      const spans = changedSpans.get(line) ?? [{ start: 0, end: Number.POSITIVE_INFINITY }];
      return [
        [
          line,
          spans.map(({ start, end, replacement = '' }) => ({
            start: lineStart + Math.min(start, lineLength),
            end:
              end === Number.POSITIVE_INFINITY
                ? Number.POSITIVE_INFINITY
                : lineStart + Math.min(end, lineLength),
            replacement,
          })),
        ],
      ];
    })
  );
}

function transpiledRuntime(source, fileName) {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
      target: ts.ScriptTarget.ESNext,
    },
    fileName,
    reportDiagnostics: true,
  });
  const hasErrors = (result.diagnostics ?? []).some(
    ({ category }) => category === ts.DiagnosticCategory.Error
  );
  return hasErrors ? undefined : result.outputText.trim();
}

export function executableChangedLineNumbers(
  source,
  changedLines,
  previousSource = undefined,
  changedSpans = new Map(),
  fileName = 'coverage-source.ts'
) {
  if (changedLines.size === 0) return changedLines;
  const emitted = transpiledRuntime(source, fileName);
  if (previousSource !== undefined) {
    const previousEmitted = transpiledRuntime(previousSource, fileName);
    if (emitted !== undefined && emitted === previousEmitted) return new Set();
  }

  const executableLines = new Set();
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.getScriptKindFromFileName(fileName)
  );
  const languageVariant = /\.[jt]sx$/.test(fileName)
    ? ts.LanguageVariant.JSX
    : ts.LanguageVariant.Standard;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, languageVariant, source);
  const spansByLine = new Map(
    [...changedTokenSpans(changedLines, changedSpans, sourceFile)].map(([line, spans]) => [
      line,
      spans.filter((span) => {
        if (emitted === undefined || span.end === Number.POSITIVE_INFINITY) return true;
        const reverted = `${source.slice(0, span.start)}${span.replacement}${source.slice(span.end)}`;
        return transpiledRuntime(reverted, fileName) !== emitted;
      }),
    ])
  );
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    const tokenStart = scanner.getTokenPos();
    const tokenEnd = scanner.getTextPos();
    for (const [line, spans] of spansByLine) {
      if (
        spans.some((span) =>
          span.start === span.end
            ? tokenStart <= span.start && tokenEnd >= span.end
            : tokenStart < span.end && tokenEnd > span.start
        )
      ) {
        executableLines.add(line);
      }
    }
  }
  return executableLines;
}

export function evaluateCoverage(
  policy,
  summaries,
  today = new Date().toISOString().slice(0, 10),
  changedFiles = [],
  detailedCoverage = {},
  changedLineNumbers = new Map()
) {
  if (policy.schemaVersion !== 'critical-path-coverage/v1') {
    throw new Error(`Unsupported coverage policy schema: ${policy.schemaVersion}`);
  }

  const results = [];
  const failures = [];

  for (const packagePolicy of policy.packages) {
    const summary = summaries[packagePolicy.id];
    if (!summary) continue;
    const details = detailedCoverage[packagePolicy.id] ?? {};

    for (const boundary of packagePolicy.boundaries) {
      const failureCountBeforeBoundary = failures.length;
      const exceptions = boundary.exceptions ?? [];
      for (const exception of exceptions) {
        validateException(exception, `${packagePolicy.id}/${boundary.id}`, today);
      }

      const entries = Object.entries(summary).filter(([file]) => {
        const included = boundary.include.some((pattern) => matchesGlob(file, pattern));
        const excepted = exceptions.some((exception) => file === exception.path);
        return included && !excepted;
      });

      if (entries.length === 0) {
        failures.push(`${packagePolicy.id}/${boundary.id} matched no reported source files`);
        results.push({
          package: packagePolicy.id,
          boundary: boundary.id,
          description: boundary.description,
          files: [],
          metrics: emptyMetrics(),
          thresholds: boundary.thresholds,
          status: 'fail',
        });
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

      for (const changedFile of changedFiles) {
        const included = boundary.include.some((pattern) => matchesGlob(changedFile, pattern));
        const excepted = exceptions.some((exception) => exception.path === changedFile);
        if (!included || excepted) continue;
        const fileCoverage = summary[changedFile];
        if (!fileCoverage || fileCoverage.lines.total === 0) {
          failures.push(
            `${packagePolicy.id}/${boundary.id} changed critical file ${changedFile} has no executable coverage entry`
          );
        } else if (fileCoverage.lines.covered === 0) {
          failures.push(
            `${packagePolicy.id}/${boundary.id} changed critical file ${changedFile} has no covered lines`
          );
        }
        const changedLines = changedLineNumbers.get(changedFile) ?? new Set();
        const detailedFileCoverage = details[changedFile];
        if (changedLines.size > 0 && !detailedFileCoverage) {
          failures.push(
            `${packagePolicy.id}/${boundary.id} changed critical file ${changedFile} has no statement coverage entry`
          );
        } else {
          const uncoveredLines = uncoveredChangedStatements(detailedFileCoverage, changedLines);
          if (uncoveredLines.length > 0) {
            failures.push(
              `${packagePolicy.id}/${boundary.id} changed critical file ${changedFile} has uncovered executable statements on line(s) ${uncoveredLines.join(', ')}`
            );
          }
        }
      }

      results.push({
        package: packagePolicy.id,
        boundary: boundary.id,
        description: boundary.description,
        files: entries.map(([file]) => file).sort(),
        metrics,
        thresholds: boundary.thresholds,
        status: failures.length === failureCountBeforeBoundary ? 'pass' : 'fail',
      });
    }
  }

  return { results, failures };
}

export function changedFilesFromBase(repoRoot, baselineRef) {
  if (!baselineRef) return [];
  if (!COMMIT_SHA_PATTERN.test(baselineRef)) {
    throw new Error('COVERAGE_BASE_REF must be a hexadecimal commit ID.');
  }
  return execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMR', `${baselineRef}...HEAD`],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    }
  )
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean);
}

export function changedLineNumbersFromBase(repoRoot, baselineRef, changedFiles) {
  if (!baselineRef || changedFiles.length === 0) return new Map();
  const changedLines = new Map();
  for (const file of changedFiles) {
    const diff = execFileSync(
      'git',
      ['diff', '--unified=0', '--no-color', `${baselineRef}...HEAD`, '--', file],
      { cwd: repoRoot, encoding: 'utf8' }
    );
    const parsedLines = parseChangedLineNumbers(diff);
    const parsedSpans = parseChangedLineSpans(diff);
    if (!/\.[cm]?[jt]sx?$/.test(file)) {
      changedLines.set(file, parsedLines);
      continue;
    }
    const source = readFileSync(path.join(repoRoot, file), 'utf8');
    let previousSource;
    try {
      previousSource = execFileSync('git', ['show', `${baselineRef}:${file}`], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      previousSource = '';
    }
    changedLines.set(
      file,
      executableChangedLineNumbers(source, parsedLines, previousSource, parsedSpans, file)
    );
  }
  return changedLines;
}

export function parseChangedLineNumbers(diff) {
  const lines = new Set();
  for (const match of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    for (let line = start; line < start + count; line += 1) lines.add(line);
  }
  return lines;
}

export function parseChangedLineSpans(diff) {
  const spans = new Map();
  const diffLines = diff.split('\n');
  for (let index = 0; index < diffLines.length; index += 1) {
    const header = diffLines[index].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!header) continue;
    let newLine = Number(header[3]);
    const removed = [];
    const added = [];
    for (index += 1; index < diffLines.length && !diffLines[index].startsWith('@@ '); index += 1) {
      const line = diffLines[index];
      if (line.startsWith('-')) removed.push(line.slice(1));
      if (line.startsWith('+')) {
        added.push({ line: newLine, text: line.slice(1) });
        newLine += 1;
      }
    }
    index -= 1;
    for (let addedIndex = 0; addedIndex < added.length; addedIndex += 1) {
      const current = added[addedIndex];
      const previous = removed.length === added.length ? removed[addedIndex] : undefined;
      if (previous === undefined) {
        spans.set(current.line, [{ start: 0, end: current.text.length, replacement: '' }]);
        continue;
      }
      let start = 0;
      while (
        start < previous.length &&
        start < current.text.length &&
        previous[start] === current.text[start]
      ) {
        start += 1;
      }
      let previousEnd = previous.length;
      let currentEnd = current.text.length;
      while (
        previousEnd > start &&
        currentEnd > start &&
        previous[previousEnd - 1] === current.text[currentEnd - 1]
      ) {
        previousEnd -= 1;
        currentEnd -= 1;
      }
      spans.set(current.line, [
        {
          start,
          end: currentEnd,
          replacement: previous.slice(start, previousEnd),
        },
      ]);
    }
  }
  return spans;
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
  const detailedCoverage = {};

  for (const packagePolicy of policy.packages) {
    if (!selected.includes(packagePolicy.id)) continue;
    const reportPath = path.join(repoRoot, packagePolicy.report);
    const [summary, details] = await Promise.all([
      readFile(reportPath, 'utf8').then(JSON.parse),
      readFile(path.join(path.dirname(reportPath), 'coverage-final.json'), 'utf8').then(JSON.parse),
    ]);
    summaries[packagePolicy.id] = normalizeCoverageSummary(summary, repoRoot);
    detailedCoverage[packagePolicy.id] = normalizeDetailedCoverage(details, repoRoot);
  }

  const changedFiles = changedFilesFromBase(repoRoot, process.env.COVERAGE_BASE_REF);
  const changedLineNumbers = changedLineNumbersFromBase(
    repoRoot,
    process.env.COVERAGE_BASE_REF,
    changedFiles
  );
  const evaluation = evaluateCoverage(
    policy,
    summaries,
    undefined,
    changedFiles,
    detailedCoverage,
    changedLineNumbers
  );
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

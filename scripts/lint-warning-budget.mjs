#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const KNOWN_PACKAGES = new Set(['cli', 'desktop', 'mcp', 'server', 'shared', 'web']);
const repoRoot = process.cwd();

function parseArgs(argv) {
  const eslintArgs = [];
  let maxWarnings = null;
  let showAllRules = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--max-warnings') {
      const value = argv[index + 1];
      if (!value) throw new Error('--max-warnings requires a numeric value');
      maxWarnings = Number(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--max-warnings=')) {
      maxWarnings = Number(arg.slice('--max-warnings='.length));
      continue;
    }
    if (arg === '--all-rules') {
      showAllRules = true;
      continue;
    }
    eslintArgs.push(arg);
  }

  if (maxWarnings !== null && !Number.isInteger(maxWarnings)) {
    throw new Error('--max-warnings must be an integer');
  }

  return {
    eslintArgs: eslintArgs.length > 0 ? eslintArgs : ['.'],
    maxWarnings,
    showAllRules,
  };
}

function relativeFile(filePath) {
  const relative = path.relative(repoRoot, filePath);
  if (relative.startsWith('..')) return filePath;
  return relative.split(path.sep).join('/');
}

function packageFor(filePath) {
  const [firstSegment] = filePath.split('/');
  if (!firstSegment) return 'root';
  if (KNOWN_PACKAGES.has(firstSegment)) return firstSegment;
  if (firstSegment === 'load-tests') return 'load-tests';
  if (firstSegment === 'scripts') return 'scripts';
  return firstSegment.startsWith('.') ? firstSegment : 'root';
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function table(headers, rows) {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => String(row[index]).length))
  );
  const line = (cells) =>
    `| ${cells.map((cell, index) => String(cell).padEnd(widths[index], ' ')).join(' | ')} |`;
  const separator = `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`;
  return [line(headers), separator, ...rows.map(line)].join('\n');
}

function summarize(results) {
  const packages = new Map();
  const rules = new Map();
  const packageRules = new Map();
  const packageFiles = new Map();
  let errorCount = 0;
  let warningCount = 0;

  for (const result of results) {
    const filePath = relativeFile(result.filePath);
    const packageName = packageFor(filePath);

    errorCount += result.errorCount;
    warningCount += result.warningCount;

    if (result.warningCount > 0) {
      increment(packages, packageName, result.warningCount);
      increment(packageFiles, packageName);
    }

    for (const message of result.messages) {
      if (message.severity !== 1) continue;
      const ruleId = message.ruleId ?? 'unknown';
      increment(rules, ruleId);
      increment(packageRules, `${packageName}\t${ruleId}`);
    }
  }

  return { errorCount, warningCount, packages, rules, packageRules, packageFiles };
}

function sortedEntries(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function printReport(summary, options) {
  const budgetLabel =
    options.maxWarnings === null
      ? 'not enforced'
      : `${options.maxWarnings} (${options.maxWarnings - summary.warningCount} remaining)`;

  console.log('Lint warning report');
  console.log(`ESLint target: ${options.eslintArgs.join(' ')}`);
  console.log(`Errors: ${summary.errorCount}`);
  console.log(`Warnings: ${summary.warningCount}`);
  console.log(`Warning budget: ${budgetLabel}`);

  const packageRows = sortedEntries(summary.packages).map(([packageName, warnings]) => [
    packageName,
    warnings,
    summary.packageFiles.get(packageName) ?? 0,
  ]);
  if (packageRows.length > 0) {
    console.log('\nWarnings by package');
    console.log(table(['Package', 'Warnings', 'Files'], packageRows));
  }

  const ruleRows = sortedEntries(summary.rules).map(([rule, warnings]) => [rule, warnings]);
  if (ruleRows.length > 0) {
    console.log('\nWarnings by rule');
    console.log(table(['Rule', 'Warnings'], ruleRows));
  }

  const packageRuleRows = sortedEntries(summary.packageRules)
    .slice(0, options.showAllRules ? undefined : 25)
    .map(([key, warnings]) => {
      const [packageName, rule] = key.split('\t');
      return [packageName, rule, warnings];
    });
  if (packageRuleRows.length > 0) {
    console.log('\nWarnings by package and rule');
    console.log(table(['Package', 'Rule', 'Warnings'], packageRuleRows));
  }
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}

const eslint = spawnSync('eslint', [...options.eslintArgs, '--format', 'json'], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 64,
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (eslint.error) {
  console.error(eslint.error.message);
  process.exit(2);
}

if (eslint.stderr.trim()) {
  process.stderr.write(eslint.stderr);
}

let results;
try {
  results = JSON.parse(eslint.stdout);
} catch {
  process.stdout.write(eslint.stdout);
  console.error('Failed to parse ESLint JSON output.');
  process.exit(eslint.status || 2);
}

const summary = summarize(results);
printReport(summary, options);

if (summary.errorCount > 0) {
  process.exitCode = 1;
} else if (options.maxWarnings !== null && summary.warningCount > options.maxWarnings) {
  console.error(
    `\nLint warning budget exceeded: ${summary.warningCount} warnings > ${options.maxWarnings}.`
  );
  process.exitCode = 1;
}

#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function yamlBlock(content, key, indentation) {
  const prefix = ' '.repeat(indentation);
  const startPattern = new RegExp(`^${prefix}${key}:\\s*$`, 'm');
  const match = startPattern.exec(content);
  if (!match) return '';

  const rest = content.slice(match.index + match[0].length + 1);
  const endPattern = new RegExp(`^${prefix}\\S`, 'm');
  const end = endPattern.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
}

function normalizedPermissionLines(block) {
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

export function findSecurityWorkflowViolations(content) {
  const violations = [];
  const hasRequiredEvents =
    /^on:\s*$/m.test(content) &&
    /^\s{2}pull_request:\s*$/m.test(content) &&
    /^\s{2}push:\s*$/m.test(content) &&
    /^\s{4}branches:\s*\[main\]\s*$/m.test(content) &&
    /^\s{2}schedule:\s*$/m.test(content) &&
    /^\s{4}- cron:\s*['"][^'"]+['"]\s*$/m.test(content);
  if (!hasRequiredEvents) {
    violations.push('security workflow must run for pull requests, main pushes, and a schedule');
  }

  const topPermissions = normalizedPermissionLines(yamlBlock(content, 'permissions', 0));
  if (
    topPermissions.length !== 1 ||
    topPermissions[0] !== 'contents: read' ||
    /^permissions:\s+write-all\s*$/m.test(content)
  ) {
    violations.push('top-level workflow permissions must be contents: read only');
  }

  const codeqlJob = yamlBlock(content, 'codeql', 2);
  const codeqlPermissions = normalizedPermissionLines(yamlBlock(codeqlJob, 'permissions', 4));
  if (
    codeqlPermissions.length !== 2 ||
    !codeqlPermissions.includes('contents: read') ||
    !codeqlPermissions.includes('security-events: write')
  ) {
    violations.push('CodeQL job must grant only contents: read and security-events: write');
  }
  if (
    !/uses:\s*github\/codeql-action\/init@[0-9a-f]{40}\s+#\s*\S+/.test(codeqlJob) ||
    !/uses:\s*github\/codeql-action\/analyze@[0-9a-f]{40}\s+#\s*\S+/.test(codeqlJob)
  ) {
    violations.push('CodeQL init and analyze actions must both be present');
  }

  const gitleaksJob = yamlBlock(content, 'gitleaks', 2);
  const gitleaksJobEnvironment = yamlBlock(gitleaksJob, 'env', 4);
  if (/\$\{\{\s*runner\./.test(gitleaksJobEnvironment)) {
    violations.push('runner context must not be used in job-level environment values');
  }
  const gitleaksPermissions = normalizedPermissionLines(yamlBlock(gitleaksJob, 'permissions', 4));
  if (
    gitleaksPermissions.length !== 1 ||
    gitleaksPermissions[0] !== 'contents: read' ||
    !/run:\s*pnpm check:gitleaks\s*$/.test(gitleaksJob)
  ) {
    violations.push('gitleaks job must run pnpm check:gitleaks with contents: read permission');
  }

  return violations;
}

export function findGitleaksIgnoreViolations(content) {
  const violations = [];
  let hasReviewComment = false;

  content.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      hasReviewComment = false;
      return;
    }
    if (trimmed.startsWith('#')) {
      hasReviewComment = true;
      return;
    }
    if (!hasReviewComment) {
      violations.push(
        `line ${index + 1}: every ignored fingerprint needs a preceding review comment`
      );
    }
    if (!/^[A-Za-z0-9_.\u002f-]+:[a-z0-9-]+:[1-9][0-9]*$/.test(trimmed)) {
      violations.push(`line ${index + 1}: ignore must be an exact path:rule:line fingerprint`);
    }
  });

  return violations;
}

export function checkSecurityGates({ workflow, gitleaksIgnore }) {
  return [
    ...findSecurityWorkflowViolations(workflow).map(
      (message) => `.github/workflows/security.yml: ${message}`
    ),
    ...findGitleaksIgnoreViolations(gitleaksIgnore).map((message) => `.gitleaksignore: ${message}`),
  ];
}

function main() {
  const violations = checkSecurityGates({
    workflow: readFileSync('.github/workflows/security.yml', 'utf8'),
    gitleaksIgnore: readFileSync('.gitleaksignore', 'utf8'),
  });

  if (violations.length > 0) {
    console.error('Security gate policy violations:');
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
    return;
  }

  console.log('Security workflow and exact gitleaks fingerprint policy verified.');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}

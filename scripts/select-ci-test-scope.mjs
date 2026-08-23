#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKSPACE_NAMES = ['server', 'web', 'cli', 'mcp', 'desktop'];

const FULL_SUITE_PATH_PATTERNS = [
  /^\.github\/workflows\//,
  /^scripts\/select-ci-test-scope(?:\.test)?\.mjs$/,
  /^scripts\/verify-full-suite-job-evidence(?:\.test)?\.mjs$/,
  /^scripts\/(?:run-coverage|check-coverage-(?:policy|ratchets))(?:\.test)?\.mjs$/,
  /^docs\/testing\/critical-path-coverage\.json$/,
  /^(?:server|web|cli|mcp|desktop)\/vitest\.config\.ts$/,
];

const ALL_WORKSPACE_PATH_PATTERNS = [
  /^shared\//,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^eslint\.config\.[cm]?[jt]s$/,
  /^(?:vitest|playwright|electron\.vite)\.config\.[cm]?[jt]s$/,
  /^tsconfig(?:\.[^/]+)?\.json$/,
];

const CRITICAL_COVERAGE_PATH_PATTERNS = {
  server: [
    /^server\/src\/middleware\//,
    /^server\/src\/storage\//,
    /^server\/src\/config\/security\.ts$/,
    /^server\/src\/lib\/redact\.ts$/,
    /^server\/src\/utils\/(?:codex-env|hermes-env|paths|sanitize)\.ts$/,
    /^server\/src\/services\/(?:.*provider.*|clawdbot-agent-service|workflow-run-service|workflow-step-executor|run-launch-manifest-service|run-recovery-policy-service|run-supervisor-service)\.ts$/,
  ],
  web: [
    /^web\/src\/lib\/api\//,
    /^web\/src\/lib\/(?:client-policy|sanitize)\.ts$/,
    /^web\/src\/hooks\/use(?:Auth|Identity|WebSocket|TaskSync|Tasks|Backlog)\.tsx?$/,
    /^web\/src\/contexts\/WebSocketContext\.tsx$/,
  ],
  cli: [
    /^cli\/src\/utils\/api\.ts$/,
    /^cli\/src\/commands\/(?:agents|admission|tasks|sqlite|doctor)\.ts$/,
  ],
  mcp: [/^mcp\/src\/utils\/api\.ts$/, /^mcp\/src\/tools\//],
  desktop: [
    /^desktop\/src\/preload\/index\.ts$/,
    /^desktop\/src\/shared\/desktop-bridge-contracts\.ts$/,
    /^desktop\/src\/main\/(?:bridge|navigation|secrets|updates|process-supervisor)\.ts$/,
  ],
};

const DOCUMENTATION_PATH_PATTERNS = [
  /\.md$/i,
  /^docs\//,
  /^prompt-registry\//,
  /^\.github\/ISSUE_TEMPLATE\//,
  /^\.github\/PULL_REQUEST_TEMPLATE\.md$/,
  /^(?:CODE_OF_CONDUCT|LICENSE|SECURITY)(?:\.[^/]+)?$/,
];

const DEPENDENCY_FREE_SCOPE_CONTROL_PATH_PATTERNS = [
  /^scripts\/check-delivery-cadence(?:\.test)?\.mjs$/,
];

const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

function normalizeFiles(files) {
  return [...new Set(files.map((file) => file.trim()).filter(Boolean))].sort();
}

function summarizePaths(files) {
  const visible = files.slice(0, 5);
  const remainder = files.length - visible.length;
  return `${visible.join(', ')}${remainder > 0 ? `, and ${remainder} more` : ''}`;
}

export function isDocumentationPath(file) {
  return DOCUMENTATION_PATH_PATTERNS.some((pattern) => pattern.test(file));
}

export function isDependencyFreeScopeControlPath(file) {
  return DEPENDENCY_FREE_SCOPE_CONTROL_PATH_PATTERNS.some((pattern) => pattern.test(file));
}

export function requiresFullSuite(file) {
  return FULL_SUITE_PATH_PATTERNS.some((pattern) => pattern.test(file));
}

export function affectedWorkspaces(files) {
  const selected = new Set();

  for (const file of files) {
    if (ALL_WORKSPACE_PATH_PATTERNS.some((pattern) => pattern.test(file))) {
      for (const workspace of WORKSPACE_NAMES) selected.add(workspace);
    }
    const workspace = WORKSPACE_NAMES.find((name) => file.startsWith(`${name}/`));
    if (workspace) selected.add(workspace);
  }

  return WORKSPACE_NAMES.filter((name) => selected.has(name));
}

export function coverageWorkspaces(files, scope = 'focused') {
  if (scope === 'full') return [...WORKSPACE_NAMES];
  if (scope === 'none') return [];

  return WORKSPACE_NAMES.filter((workspace) =>
    files.some((file) =>
      CRITICAL_COVERAGE_PATH_PATTERNS[workspace].some((pattern) => pattern.test(file))
    )
  );
}

export function classifyCiTestScope({
  eventName,
  manualScope = '',
  labels = [],
  changedFiles = [],
  deletedFiles = [],
  reviewedFullSuite = false,
  reviewedPullRequest = '',
  reviewedFullSuiteMode = '',
}) {
  const files = normalizeFiles(changedFiles);
  const deleted = normalizeFiles(deletedFiles);
  const packages = affectedWorkspaces([...files, ...deleted]);

  if (eventName === 'schedule') {
    return {
      scope: 'full',
      packages: WORKSPACE_NAMES,
      files,
      reason: 'Scheduled CI is the authoritative recurring full-suite drift gate.',
    };
  }

  if (eventName === 'workflow_dispatch' && manualScope === 'full') {
    return {
      scope: 'full',
      packages: WORKSPACE_NAMES,
      files,
      reason: 'Manual dispatch explicitly requested the full verification tier.',
    };
  }

  if (eventName === 'pull_request' && labels.includes('ci:full')) {
    return {
      scope: 'full',
      packages: WORKSPACE_NAMES,
      files,
      reason: 'The pull request carries the ci:full release or high-risk verification label.',
    };
  }

  if (eventName === 'push' && reviewedFullSuite) {
    const prSuffix = reviewedPullRequest ? ` for PR #${reviewedPullRequest}` : '';
    const evidence =
      reviewedFullSuiteMode === 'identical-tree'
        ? 'has the exact Git tree published by this squash merge'
        : 'is an ancestor of this merge commit';
    return {
      scope: 'none',
      packages: [],
      files,
      reason: `The reviewed head${prSuffix} already passed Workspace Unit Tests and ${evidence}.`,
    };
  }

  const unclassifiedDeletedCodePaths = deleted.filter(
    (file) =>
      !isDocumentationPath(file) &&
      !isDependencyFreeScopeControlPath(file) &&
      affectedWorkspaces([file]).length === 0
  );
  if (unclassifiedDeletedCodePaths.length > 0) {
    return {
      scope: 'full',
      packages: WORKSPACE_NAMES,
      files,
      reason: `Deleted non-documentation paths outside a known workspace fail safe to the full suite: ${summarizePaths(
        unclassifiedDeletedCodePaths
      )}`,
    };
  }

  const fullSuitePaths = files.filter(requiresFullSuite);
  if (fullSuitePaths.length > 0) {
    return {
      scope: 'full',
      packages: WORKSPACE_NAMES,
      files,
      reason: `CI control paths require the full suite before the selector change can take effect: ${summarizePaths(
        fullSuitePaths
      )}`,
    };
  }

  if (files.length === 0) {
    return {
      scope: 'none',
      packages: [],
      files,
      reason:
        'The selected base/head range contains no added, copied, modified, renamed, or deleted files.',
    };
  }

  if (files.every((file) => isDocumentationPath(file) || isDependencyFreeScopeControlPath(file))) {
    return {
      scope: 'none',
      packages: [],
      files,
      reason:
        'Only documentation or dependency-free delivery-cadence controls checked by the selector changed.',
    };
  }

  const unclassifiedCodePaths = files.filter(
    (file) =>
      !isDocumentationPath(file) &&
      !isDependencyFreeScopeControlPath(file) &&
      affectedWorkspaces([file]).length === 0
  );
  if (unclassifiedCodePaths.length > 0) {
    return {
      scope: 'full',
      packages: WORKSPACE_NAMES,
      files,
      reason: `Non-documentation paths outside a known test workspace fail safe to the full suite: ${summarizePaths(
        unclassifiedCodePaths
      )}`,
    };
  }

  if (packages.length === 0) {
    return {
      scope: 'none',
      packages: [],
      files,
      reason: 'No testable workspace changed.',
    };
  }

  return {
    scope: 'focused',
    packages,
    files,
    reason: `Run Vitest related coverage for affected workspace packages: ${packages.join(', ')}.`,
  };
}

export function diffRangeFor(baseSha, headSha, eventName) {
  if (!baseSha || !headSha || baseSha === headSha) return '';
  if (!COMMIT_SHA_PATTERN.test(baseSha) || !COMMIT_SHA_PATTERN.test(headSha)) {
    throw new Error('CI base and head revisions must be hexadecimal commit IDs.');
  }

  return eventName === 'push' ? `${baseSha}..${headSha}` : `${baseSha}...${headSha}`;
}

export function changedFilesForRange(baseSha, headSha, eventName, cwd = process.cwd()) {
  const range = diffRangeFor(baseSha, headSha, eventName);
  if (!range) return [];
  const output = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMRD', range], {
    cwd,
    encoding: 'utf8',
  });

  return normalizeFiles(output.split('\n'));
}

export function deletedFilesForRange(baseSha, headSha, eventName, cwd = process.cwd()) {
  const range = diffRangeFor(baseSha, headSha, eventName);
  if (!range) return [];
  const output = execFileSync('git', ['diff', '--name-only', '--diff-filter=D', range], {
    cwd,
    encoding: 'utf8',
  });

  return normalizeFiles(output.split('\n'));
}

function parseLabels(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((label) => typeof label === 'string') : [];
  } catch {
    throw new Error('CI_PR_LABELS must be a JSON array of label names.');
  }
}

function githubOutputLines(result, input) {
  const diffRange = diffRangeFor(input.baseSha, input.headSha, input.eventName);
  const coveragePackages = coverageWorkspaces(result.files, result.scope);
  return [
    `scope=${result.scope}`,
    `packages=${result.packages.join(',')}`,
    `coverage_packages=${coveragePackages.join(',')}`,
    `diff_range=${diffRange}`,
    `reason=${result.reason}`,
  ].join('\n');
}

function summaryMarkdown(result, input) {
  const focusedDecision =
    result.scope === 'focused'
      ? `run for ${result.packages.map((name) => `\`${name}\``).join(', ')}`
      : `skip because scope is \`${result.scope}\``;
  const fullDecision =
    result.scope === 'full'
      ? 'run the complete release-grade suite'
      : `skip because scope is \`${result.scope}\``;

  return [
    '### CI test scope',
    '',
    '| Evidence | Value |',
    '| --- | --- |',
    `| Event | \`${input.eventName}\` |`,
    `| Base | \`${input.baseSha || 'not required'}\` |`,
    `| Head | \`${input.headSha || 'not required'}\` |`,
    `| Changed paths | ${result.files.length} |`,
    `| Selected scope | \`${result.scope}\` |`,
    `| Reason | ${result.reason.replaceAll('|', '\\|')} |`,
    '',
    '| Test tier | Decision |',
    '| --- | --- |',
    `| Changed Tests | ${focusedDecision} |`,
    `| Workspace Unit Tests | ${fullDecision} |`,
    '',
  ].join('\n');
}

async function main() {
  const input = {
    eventName: process.env.CI_EVENT_NAME || '',
    baseSha: process.env.CI_BASE_SHA || '',
    headSha: process.env.CI_HEAD_SHA || '',
    manualScope: process.env.CI_MANUAL_SCOPE || '',
    labels: parseLabels(process.env.CI_PR_LABELS || '[]'),
    reviewedFullSuite: process.env.CI_REVIEWED_FULL === 'true',
    reviewedPullRequest: process.env.CI_REVIEWED_PR || '',
    reviewedFullSuiteMode: process.env.CI_REVIEWED_MODE || '',
  };

  if (!input.eventName) {
    throw new Error('CI_EVENT_NAME is required.');
  }

  const changedFiles = changedFilesForRange(input.baseSha, input.headSha, input.eventName);
  const deletedFiles = deletedFilesForRange(input.baseSha, input.headSha, input.eventName);
  const result = classifyCiTestScope({ ...input, changedFiles, deletedFiles });

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `${githubOutputLines(result, input)}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown(result, input));
  }

  console.log(
    JSON.stringify(
      {
        ...result,
        baseSha: input.baseSha,
        headSha: input.headSha,
      },
      null,
      2
    )
  );
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  await main();
}

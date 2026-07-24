#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKSPACE_NAMES = ['server', 'web', 'cli', 'mcp', 'desktop'];

const FULL_SUITE_PATH_PATTERNS = [
  /^\.github\/workflows\//,
  /^desktop\//,
  /^shared\//,
  /^server\/src\/storage\//,
  /^server\/src\/__tests__\/storage\//,
  /^scripts\/select-ci-test-scope(?:\.test)?\.mjs$/,
  /(^|\/)package\.json$/,
  /(^|\/)(?:vitest|playwright|electron\.vite)\.config\.[cm]?[jt]s$/,
  /(^|\/)tsconfig(?:\.[^/]+)?\.json$/,
  /^eslint\.config\.[cm]?[jt]s$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
];

const DOCUMENTATION_PATH_PATTERNS = [
  /\.md$/i,
  /^docs\//,
  /^prompt-registry\//,
  /^\.github\/ISSUE_TEMPLATE\//,
  /^\.github\/PULL_REQUEST_TEMPLATE\.md$/,
  /^(?:CODE_OF_CONDUCT|LICENSE|SECURITY)(?:\.[^/]+)?$/,
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

export function requiresFullSuite(file) {
  return FULL_SUITE_PATH_PATTERNS.some((pattern) => pattern.test(file));
}

export function affectedWorkspaces(files) {
  const selected = new Set();

  for (const file of files) {
    const workspace = WORKSPACE_NAMES.find((name) => file.startsWith(`${name}/`));
    if (workspace) selected.add(workspace);
  }

  return WORKSPACE_NAMES.filter((name) => selected.has(name));
}

export function classifyCiTestScope({
  eventName,
  manualScope = '',
  labels = [],
  changedFiles = [],
  deletedFiles = [],
  reviewedFullSuite = false,
  reviewedPullRequest = '',
}) {
  const files = normalizeFiles(changedFiles);
  const deleted = normalizeFiles(deletedFiles);
  const packages = affectedWorkspaces(files);

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
    return {
      scope: 'none',
      packages: [],
      files,
      reason: `The reviewed head${prSuffix} already passed Workspace Unit Tests and is an ancestor of this merge commit.`,
    };
  }

  const deletedCodePaths = deleted.filter((file) => !isDocumentationPath(file));
  if (deletedCodePaths.length > 0) {
    return {
      scope: 'full',
      packages: WORKSPACE_NAMES,
      files,
      reason: `Deleted non-documentation paths cannot use dependency-graph related selection and require the full suite: ${summarizePaths(
        deletedCodePaths
      )}`,
    };
  }

  const fullSuitePaths = files.filter(requiresFullSuite);
  if (fullSuitePaths.length > 0) {
    return {
      scope: 'full',
      packages: WORKSPACE_NAMES,
      files,
      reason: `High-risk CI, manifest, shared, storage, or desktop paths require the full suite: ${summarizePaths(
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

  if (files.every(isDocumentationPath)) {
    return {
      scope: 'none',
      packages: [],
      files,
      reason: 'Only documentation or issue-template paths changed.',
    };
  }

  const unclassifiedCodePaths = files.filter(
    (file) =>
      !isDocumentationPath(file) &&
      !WORKSPACE_NAMES.some((workspace) => file.startsWith(`${workspace}/`))
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
  return [
    `scope=${result.scope}`,
    `packages=${result.packages.join(',')}`,
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

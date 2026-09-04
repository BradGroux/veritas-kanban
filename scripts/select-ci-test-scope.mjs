#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COVERAGE_POLICY = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../docs/testing/critical-path-coverage.json', import.meta.url)),
    'utf8'
  )
);
const WORKSPACE_NAMES = COVERAGE_POLICY.packages.map(({ id }) => id);

const ALL_WORKSPACE_PATH_PATTERNS = [
  /^shared\//,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^eslint\.config\.[cm]?[jt]s$/,
  /^(?:vitest|playwright|electron\.vite)\.config\.[cm]?[jt]s$/,
  /^tsconfig(?:\.[^/]+)?\.json$/,
];

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

export function isDocumentationPath(file) {
  return DOCUMENTATION_PATH_PATTERNS.some((pattern) => pattern.test(file));
}

export function isDependencyFreeScopeControlPath(file) {
  return DEPENDENCY_FREE_SCOPE_CONTROL_PATH_PATTERNS.some((pattern) => pattern.test(file));
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

export function coverageWorkspaces(_files, scope = 'focused') {
  if (scope === 'full') return [...WORKSPACE_NAMES];
  return [];
}

export function classifyCiTestScope({
  eventName,
  manualScope = '',
  labels = [],
  changedFiles = [],
  deletedFiles = [],
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

  if (eventName === 'workflow_dispatch' && manualScope === 'focused') {
    if (packages.length === 0) {
      return {
        scope: 'none',
        packages: [],
        files,
        reason: 'The manually selected range does not affect a testable workspace.',
      };
    }
    return {
      scope: 'focused',
      packages,
      files,
      reason: `Manual dispatch explicitly requested focused diagnostics for: ${packages.join(', ')}.`,
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
        'Only documentation or dependency-free policy controls changed; workspace tests are reserved for explicit milestones.',
    };
  }

  return {
    scope: 'none',
    packages,
    files,
    reason:
      packages.length > 0
        ? `Ordinary changes defer workspace tests and coverage to an explicit milestone. Affected packages: ${packages.join(', ')}.`
        : 'This ordinary change is not an explicit test milestone; workspace tests and coverage are deferred.',
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

function currentPullRequestLabels(input) {
  const repository = process.env.GITHUB_REPOSITORY || '';
  const number = process.env.CI_PR_NUMBER || '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[1-9]\d*$/.test(number)) {
    throw new Error('A valid GITHUB_REPOSITORY and CI_PR_NUMBER are required for PR scope.');
  }
  let pullRequest;
  try {
    pullRequest = JSON.parse(
      execFileSync('gh', ['api', `repos/${repository}/pulls/${number}`], {
        encoding: 'utf8',
        timeout: 30_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    );
  } catch {
    throw new Error('Unable to resolve current PR label state; refusing to skip requested tests.');
  }
  if (!/^[a-f0-9]{40}$/i.test(input.headSha) || pullRequest.head?.sha !== input.headSha) {
    throw new Error('The PR head changed; this stale run cannot select scope for another head.');
  }
  if (
    !Array.isArray(pullRequest.labels) ||
    pullRequest.labels.some((label) => typeof label?.name !== 'string')
  ) {
    throw new Error('The current PR label response is invalid.');
  }
  // Requests captured for this head stay full even if the label is later removed.
  const explicitlyLabeled =
    process.env.CI_PR_ACTION === 'labeled' && process.env.CI_PR_EVENT_LABEL === 'ci:full';
  return [
    ...new Set([
      ...input.labels,
      ...pullRequest.labels.map((label) => label.name),
      ...(explicitlyLabeled ? ['ci:full'] : []),
    ]),
  ];
}

export function githubOutputLines(result, input) {
  const diffRange = diffRangeFor(input.baseSha, input.headSha, input.eventName);
  const coveragePackages = coverageWorkspaces(result.files, result.scope);
  return [
    `scope=${result.scope}`,
    `packages=${result.packages.join(',')}`,
    `coverage_packages=${coveragePackages.join(',')}`,
    `base_sha=${input.baseSha}`,
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
  };

  if (!input.eventName) {
    throw new Error('CI_EVENT_NAME is required.');
  }

  if (input.eventName === 'pull_request') input.labels = currentPullRequestLabels(input);

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

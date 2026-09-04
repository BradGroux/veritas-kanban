import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

function selectScope(
  t,
  {
    snapshot = [],
    live = ['ci:full'],
    action = 'opened',
    eventLabel = '',
    liveHead = head,
    fail = false,
  } = {}
) {
  const fixture = mkdtempSync(path.join(tmpdir(), 'vk-ci-labels-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  writeFileSync(
    path.join(fixture, 'gh'),
    `#!${process.execPath}\n${fail ? 'process.exit(1);' : `console.log(${JSON.stringify(JSON.stringify({ head: { sha: liveHead }, labels: live.map((name) => ({ name })) }))});`}\n`,
    { mode: 0o700 }
  );
  return spawnSync(process.execPath, ['scripts/select-ci-test-scope.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fixture}${path.delimiter}${process.env.PATH}`,
      GITHUB_REPOSITORY: 'BradGroux/veritas-kanban',
      CI_EVENT_NAME: 'pull_request',
      CI_PR_NUMBER: '1394',
      CI_PR_ACTION: action,
      CI_PR_EVENT_LABEL: eventLabel,
      CI_PR_LABELS: JSON.stringify(snapshot),
      CI_BASE_SHA: head,
      CI_HEAD_SHA: head,
      GITHUB_OUTPUT: '',
      GITHUB_STEP_SUMMARY: '',
    },
  });
}

test('stale opened snapshot cannot downgrade a currently labeled exact PR head', (t) => {
  const run = selectScope(t);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).scope, 'full');
});

test('explicit label request survives subsequent removal before scope selection', (t) => {
  const run = selectScope(t, { action: 'labeled', eventLabel: 'ci:full', live: [] });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).scope, 'full');
});

test('deliberate removal affects new ordinary events, not already captured full requests', (t) => {
  const removed = selectScope(t, { action: 'unlabeled', eventLabel: 'ci:full', live: [] });
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(JSON.parse(removed.stdout).scope, 'none');
  const captured = selectScope(t, { snapshot: ['ci:full'], live: [] });
  assert.equal(captured.status, 0, captured.stderr);
  assert.equal(JSON.parse(captured.stdout).scope, 'full');
});

test('unavailable live labels fail closed instead of selecting a green skip', (t) => {
  assert.notEqual(selectScope(t, { fail: true }).status, 0);
});

test('labels from a different PR head do not silently authorize a stale run', (t) => {
  assert.notEqual(selectScope(t, { liveHead: 'a'.repeat(40) }).status, 0);
});

const workflow = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');

function concurrencyGroup({
  action = 'opened',
  snapshot = [],
  label = '',
  sha = head,
  runId = 1,
  eventName = 'pull_request',
  manualScope = '',
} = {}) {
  // Evaluate the checked-in expression's shared JS/GitHub boolean subset, not a
  // second implementation of the grouping policy. Only the wildcard needs adapting.
  const expression = workflow.match(/concurrency:[\s\S]*?group: >-\s*\$\{\{([\s\S]*?)\}\}/)?.[1];
  assert.ok(expression, 'workflow concurrency expression is present');
  const evaluate = new Function(
    'github',
    'inputs',
    'format',
    'contains',
    'fromJSON',
    `return (${expression.replaceAll('github.event.pull_request.labels.*.name', 'github.event.pull_request.labels.map(label => label.name)')});`
  );
  return evaluate(
    {
      workflow: 'CI',
      ref: eventName === 'pull_request' ? 'refs/pull/1394/merge' : 'refs/heads/main',
      sha,
      event_name: eventName,
      run_id: runId,
      event: {
        action,
        label: { name: label },
        pull_request: { head: { sha }, labels: snapshot.map((name) => ({ name })) },
      },
    },
    { test_scope: manualScope },
    (template, ...values) => template.replace(/\{(\d+)\}/g, (_, index) => values[index]),
    (values, value) => values.includes(value),
    JSON.parse
  );
}

test('actual workflow isolates stale, removed, cosmetic and different-head events from full requests', () => {
  const full = concurrencyGroup({ action: 'labeled', label: 'ci:full' });
  assert.match(full, /full-request$/);
  assert.equal(concurrencyGroup({ action: 'synchronize', snapshot: ['ci:full'] }), full);
  for (const event of [
    {},
    { action: 'unlabeled', label: 'ci:full' },
    { action: 'labeled', label: 'documentation', snapshot: ['ci:full'] },
    { action: 'synchronize', snapshot: ['ci:full'], sha: 'b'.repeat(40) },
  ])
    assert.notEqual(concurrencyGroup(event), full);
  assert.notEqual(
    concurrencyGroup({ action: 'labeled', label: 'docs', runId: 1 }),
    concurrencyGroup({ action: 'labeled', label: 'docs', runId: 2 })
  );
});

test('workflow supplies authenticated read-only PR state and runs the regression contract', () => {
  assert.match(workflow, /pull-requests: read/);
  for (const name of ['GH_TOKEN', 'CI_PR_NUMBER', 'CI_PR_ACTION', 'CI_PR_EVENT_LABEL']) {
    assert.match(workflow, new RegExp(`${name}: \\$\\{\\{`));
  }
  assert.match(workflow, /scripts\/ci-pr-label-state\.test\.mjs/);
});

test('manual and scheduled full gates are isolated from ordinary pushes at the same SHA', () => {
  const push = concurrencyGroup({ eventName: 'push' });
  const manual = concurrencyGroup({ eventName: 'workflow_dispatch', manualScope: 'full' });
  assert.notEqual(manual, push);
  assert.match(manual, /full-request$/);
  assert.equal(concurrencyGroup({ eventName: 'schedule' }), manual);
  assert.equal(concurrencyGroup({ eventName: 'workflow_dispatch', manualScope: 'focused' }), push);
});

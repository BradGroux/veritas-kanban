import assert from 'node:assert/strict';
import test from 'node:test';

import {
  affectedWorkspaces,
  classifyCiTestScope,
  diffRangeFor,
  isDocumentationPath,
  requiresFullSuite,
} from './select-ci-test-scope.mjs';

test('classifies documentation-only pull requests without unit tests', () => {
  const result = classifyCiTestScope({
    eventName: 'pull_request',
    changedFiles: ['README.md', 'docs/AGENTS-TEMPLATE.md'],
  });

  assert.equal(result.scope, 'none');
  assert.deepEqual(result.packages, []);
});

test('selects affected workspaces for ordinary code changes', () => {
  const result = classifyCiTestScope({
    eventName: 'pull_request',
    changedFiles: ['web/src/App.tsx', 'server/src/routes/tasks.ts', 'README.md'],
  });

  assert.equal(result.scope, 'focused');
  assert.deepEqual(result.packages, ['server', 'web']);
});

test('ci:full overrides a documentation-only pull request', () => {
  const result = classifyCiTestScope({
    eventName: 'pull_request',
    labels: ['documentation', 'ci:full'],
    changedFiles: ['docs/V6-GA-CHECKLIST.md'],
  });

  assert.equal(result.scope, 'full');
});

test('selects the full suite for CI, manifest, shared, storage, and desktop paths', () => {
  const paths = [
    '.github/workflows/ci.yml',
    'package.json',
    'shared/src/types/task.types.ts',
    'server/src/storage/sqlite/repositories.ts',
    'desktop/src/main/index.ts',
  ];

  for (const file of paths) {
    const result = classifyCiTestScope({
      eventName: 'pull_request',
      changedFiles: [file],
    });
    assert.equal(result.scope, 'full', file);
    assert.equal(requiresFullSuite(file), true, file);
  }
});

test('scheduled and explicitly full manual runs select the full suite', () => {
  assert.equal(classifyCiTestScope({ eventName: 'schedule', changedFiles: [] }).scope, 'full');
  assert.equal(
    classifyCiTestScope({
      eventName: 'workflow_dispatch',
      manualScope: 'full',
      changedFiles: ['README.md'],
    }).scope,
    'full'
  );
});

test('focused manual runs still classify the selected range by risk', () => {
  assert.equal(
    classifyCiTestScope({
      eventName: 'workflow_dispatch',
      manualScope: 'focused',
      changedFiles: ['server/src/routes/tasks.ts'],
    }).scope,
    'focused'
  );
  assert.equal(
    classifyCiTestScope({
      eventName: 'workflow_dispatch',
      manualScope: 'focused',
      changedFiles: ['pnpm-lock.yaml'],
    }).scope,
    'full'
  );
});

test('a successful reviewed full suite suppresses duplicate post-merge tests', () => {
  const result = classifyCiTestScope({
    eventName: 'push',
    reviewedFullSuite: true,
    reviewedPullRequest: '1000',
    changedFiles: ['.github/workflows/ci.yml'],
  });

  assert.equal(result.scope, 'none');
  assert.match(result.reason, /PR #1000/);
  assert.match(result.reason, /ancestor/);
});

test('an exact reviewed tree suppresses duplicate tests after a squash merge', () => {
  const result = classifyCiTestScope({
    eventName: 'push',
    reviewedFullSuite: true,
    reviewedPullRequest: '1011',
    reviewedFullSuiteMode: 'identical-tree',
    changedFiles: ['.github/workflows/ci.yml'],
  });

  assert.equal(result.scope, 'none');
  assert.match(result.reason, /PR #1011/);
  assert.match(result.reason, /exact Git tree/);
});

test('ordinary post-merge pushes remain limited to affected packages', () => {
  const result = classifyCiTestScope({
    eventName: 'push',
    changedFiles: ['cli/src/commands/doctor.ts'],
  });

  assert.equal(result.scope, 'focused');
  assert.deepEqual(result.packages, ['cli']);
});

test('unknown non-documentation paths fail safe to the full suite', () => {
  const result = classifyCiTestScope({
    eventName: 'pull_request',
    changedFiles: ['site/src/runtime.ts'],
  });

  assert.equal(result.scope, 'full');
});

test('deleted source fails safe to full while deleted documentation stays lightweight', () => {
  assert.equal(
    classifyCiTestScope({
      eventName: 'pull_request',
      changedFiles: ['server/src/obsolete.ts'],
      deletedFiles: ['server/src/obsolete.ts'],
    }).scope,
    'full'
  );
  assert.equal(
    classifyCiTestScope({
      eventName: 'pull_request',
      changedFiles: ['docs/obsolete.md'],
      deletedFiles: ['docs/obsolete.md'],
    }).scope,
    'none'
  );
});

test('empty ranges select no unit-test tier', () => {
  const result = classifyCiTestScope({
    eventName: 'push',
    changedFiles: [],
  });

  assert.equal(result.scope, 'none');
});

test('documentation and workspace helpers are deterministic', () => {
  assert.equal(isDocumentationPath('prompt-registry/review.md'), true);
  assert.equal(isDocumentationPath('server/src/index.ts'), false);
  assert.deepEqual(
    affectedWorkspaces([
      'desktop/src/main/index.ts',
      'mcp/src/index.ts',
      'server/src/index.ts',
      'server/src/routes/tasks.ts',
    ]),
    ['server', 'mcp', 'desktop']
  );
});

test('uses two-dot push ranges, three-dot review ranges, and rejects non-SHAs', () => {
  const base = 'a'.repeat(40);
  const head = 'b'.repeat(40);

  assert.equal(diffRangeFor(base, head, 'push'), `${base}..${head}`);
  assert.equal(diffRangeFor(base, head, 'pull_request'), `${base}...${head}`);
  assert.throws(
    () => diffRangeFor('--output=/tmp/unsafe', head, 'workflow_dispatch'),
    /hexadecimal commit IDs/
  );
});

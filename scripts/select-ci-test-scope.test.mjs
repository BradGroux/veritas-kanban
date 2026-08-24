import assert from 'node:assert/strict';
import test from 'node:test';

import {
  affectedWorkspaces,
  classifyCiTestScope,
  coverageWorkspaces,
  diffRangeFor,
  githubOutputLines,
  isDependencyFreeScopeControlPath,
  isDocumentationPath,
} from './select-ci-test-scope.mjs';

test('classifies documentation-only pull requests without unit tests', () => {
  const result = classifyCiTestScope({
    eventName: 'pull_request',
    changedFiles: ['README.md', 'docs/AGENTS-TEMPLATE.md'],
  });

  assert.equal(result.scope, 'none');
  assert.deepEqual(result.packages, []);
});

test('dependency-free cadence controls do not trigger workspace unit tests', () => {
  const result = classifyCiTestScope({
    eventName: 'pull_request',
    changedFiles: [
      'CHANGELOG.md',
      'scripts/check-delivery-cadence.mjs',
      'scripts/check-delivery-cadence.test.mjs',
    ],
  });

  assert.equal(result.scope, 'none');
  assert.deepEqual(result.packages, []);
  assert.equal(isDependencyFreeScopeControlPath('scripts/check-delivery-cadence.mjs'), true);
});

test('cadence controls do not turn an ordinary workspace change into a test milestone', () => {
  const result = classifyCiTestScope({
    eventName: 'pull_request',
    changedFiles: ['scripts/check-delivery-cadence.mjs', 'server/src/routes/tasks.ts'],
  });

  assert.equal(result.scope, 'none');
  assert.deepEqual(result.packages, ['server']);
});

test('records affected workspaces without testing an ordinary code change', () => {
  const result = classifyCiTestScope({
    eventName: 'pull_request',
    changedFiles: ['web/src/App.tsx', 'server/src/routes/tasks.ts', 'README.md'],
  });

  assert.equal(result.scope, 'none');
  assert.deepEqual(result.packages, ['server', 'web']);
});

test('selects critical coverage only for the full milestone scope', () => {
  const files = [
    'server/src/storage/file-storage.ts',
    'web/src/components/Board.tsx',
    'mcp/src/tools/tasks.ts',
  ];

  assert.deepEqual(coverageWorkspaces(files), []);
  assert.deepEqual(coverageWorkspaces(files, 'focused'), []);
  assert.deepEqual(coverageWorkspaces(files, 'none'), []);
  assert.deepEqual(coverageWorkspaces(files, 'full'), ['server', 'web', 'cli', 'mcp', 'desktop']);
});

test('defers governed critical-path coverage until a milestone', () => {
  assert.deepEqual(
    coverageWorkspaces([
      'server/src/__tests__/provider-completion-service.test.ts',
      'server/src/schemas/auth-schemas.ts',
      'shared/src/utils/api-permissions.ts',
      'web/src/__tests__/useWebSocket.test.ts',
      'mcp/src/__tests__/task-tools.test.ts',
    ]),
    []
  );
});

test('ci:full overrides a documentation-only pull request', () => {
  const result = classifyCiTestScope({
    eventName: 'pull_request',
    labels: ['documentation', 'ci:full'],
    changedFiles: ['docs/V6-GA-CHECKLIST.md'],
  });

  assert.equal(result.scope, 'full');
});

test('CI control paths require an explicit milestone instead of auto-running the full suite', () => {
  const paths = [
    '.github/workflows/ci.yml',
    'scripts/select-ci-test-scope.mjs',
    'scripts/verify-full-suite-job-evidence.mjs',
    'scripts/run-coverage.mjs',
    'scripts/check-coverage-policy.test.mjs',
    'docs/testing/critical-path-coverage.json',
    'web/vitest.config.ts',
  ];

  for (const file of paths) {
    const result = classifyCiTestScope({
      eventName: 'pull_request',
      changedFiles: [file],
    });
    assert.equal(result.scope, 'none', file);
  }
});

test('records shared, storage, desktop, and manifest workspaces without automatic tests', () => {
  const cases = [
    {
      file: 'shared/src/types/task.types.ts',
      packages: ['server', 'web', 'cli', 'mcp', 'desktop'],
    },
    { file: 'server/src/storage/sqlite/repositories.ts', packages: ['server'] },
    { file: 'desktop/src/main/index.ts', packages: ['desktop'] },
    { file: 'server/package.json', packages: ['server'] },
    { file: 'package.json', packages: ['server', 'web', 'cli', 'mcp', 'desktop'] },
    { file: 'pnpm-lock.yaml', packages: ['server', 'web', 'cli', 'mcp', 'desktop'] },
  ];

  for (const { file, packages } of cases) {
    const result = classifyCiTestScope({
      eventName: 'pull_request',
      changedFiles: [file],
    });
    assert.equal(result.scope, 'none', file);
    assert.deepEqual(result.packages, packages, file);
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
    'focused'
  );
});

test('ordinary post-merge pushes defer tests while recording affected packages', () => {
  const result = classifyCiTestScope({
    eventName: 'push',
    changedFiles: ['cli/src/commands/doctor.ts'],
  });

  assert.equal(result.scope, 'none');
  assert.deepEqual(result.packages, ['cli']);
});

test('unknown non-documentation paths wait for an explicit milestone', () => {
  const result = classifyCiTestScope({
    eventName: 'pull_request',
    changedFiles: ['site/src/runtime.ts'],
  });

  assert.equal(result.scope, 'none');
});

test('deleted source paths are recorded without automatic test escalation', () => {
  assert.equal(
    classifyCiTestScope({
      eventName: 'pull_request',
      changedFiles: ['server/src/obsolete.ts'],
      deletedFiles: ['server/src/obsolete.ts'],
    }).scope,
    'none'
  );
  assert.equal(
    classifyCiTestScope({
      eventName: 'pull_request',
      changedFiles: ['site/src/obsolete.ts'],
      deletedFiles: ['site/src/obsolete.ts'],
    }).scope,
    'none'
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

test('exports the resolved base SHA for downstream coverage gates', () => {
  const baseSha = 'a'.repeat(40);
  const headSha = 'b'.repeat(40);
  const output = githubOutputLines(
    { scope: 'focused', packages: ['server'], files: [], reason: 'test' },
    { baseSha, headSha, eventName: 'workflow_dispatch' }
  );

  assert.match(output, new RegExp(`^base_sha=${baseSha}$`, 'm'));
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CADENCE_CONTRACTS,
  findAmbiguousFocusedTestCommands,
  findMissingCadenceContracts,
  findUnsafeCanonicalCadenceStatements,
  findUnsafePromptStatements,
} from './check-delivery-cadence.mjs';

function validContractFiles() {
  return Object.fromEntries(
    Object.entries(CADENCE_CONTRACTS).map(([file, rules]) => [
      file,
      rules.map((rule) => rule.pattern.source.replaceAll('\\', '')).join('\n'),
    ])
  );
}

test('reports a missing canonical cadence rule with its file', () => {
  const files = validContractFiles();
  files['AGENTS.md'] = files['AGENTS.md'].replace(
    'one independently shippable behavior',
    'one oversized behavior'
  );

  assert.deepEqual(findMissingCadenceContracts(files), [
    {
      file: 'AGENTS.md',
      message:
        'required cadence contract is missing: one independently shippable behavior per issue and pull request',
    },
  ]);
});

test('rejects unconditional workspace-wide pnpm test commands', () => {
  assert.deepEqual(
    findUnsafePromptStatements({
      'prompt-registry/example.md': 'Before completion, run `pnpm test`.',
    }),
    [
      {
        file: 'prompt-registry/example.md',
        message: 'active prompts must not prescribe an unconditional workspace-wide `pnpm test`',
      },
    ]
  );
});

test('allows explicit guidance not to run the workspace-wide pnpm test command', () => {
  assert.deepEqual(
    findUnsafePromptStatements({
      'prompt-registry/example.md':
        'Do not run `pnpm test` unless deterministic CI selects the full tier.',
    }),
    []
  );
});

test('rejects unqualified complete-suite requirements', () => {
  assert.deepEqual(
    findUnsafePromptStatements({
      'prompt-registry/example.md': 'Run the complete workspace suite before opening every PR.',
    }),
    [
      {
        file: 'prompt-registry/example.md',
        message: 'unqualified complete-suite requirement: "Run the complete workspace suite"',
      },
    ]
  );
});

test('allows milestone-qualified complete-suite guidance', () => {
  assert.deepEqual(
    findUnsafePromptStatements({
      'prompt-registry/example.md':
        'Run the complete workspace suite only at an explicit release milestone.',
    }),
    []
  );
});

test('rejects mandatory cross-model review language', () => {
  assert.deepEqual(
    findUnsafePromptStatements({
      'prompt-registry/example.md': 'Cross-model review is required for every code change.',
    }),
    [
      {
        file: 'prompt-registry/example.md',
        message: 'active prompts must not make cross-model review unconditional',
      },
    ]
  );
});

test('allows optional cross-model review language', () => {
  assert.deepEqual(
    findUnsafePromptStatements({
      'prompt-registry/example.md':
        'Cross-model review is optional unless the issue owner explicitly requires it.',
    }),
    []
  );
});

test('rejects mandatory multi-review gates before every commit', () => {
  assert.deepEqual(
    findUnsafeCanonicalCadenceStatements({
      'CONTRIBUTING.md':
        'Before every commit, run these 4 reviews. All four must pass before committing.',
    }),
    [
      {
        file: 'CONTRIBUTING.md',
        message: 'canonical guidance must not require multiple reviews before every commit',
      },
    ]
  );
});

test('rejects mandatory cross-model review in canonical guidance', () => {
  assert.deepEqual(
    findUnsafeCanonicalCadenceStatements({
      'AGENTS.md': 'Cross-model review is mandatory for every code change.',
    }),
    [
      {
        file: 'AGENTS.md',
        message: 'canonical guidance must not make cross-model review unconditional',
      },
    ]
  );
});

test('rejects unconditional workspace build and typecheck gates for every merge', () => {
  assert.deepEqual(
    findUnsafeCanonicalCadenceStatements({
      'CONTRIBUTING.md':
        'Before merging any branch, verify `pnpm typecheck` succeeds for all workspace packages.',
    }),
    [
      {
        file: 'CONTRIBUTING.md',
        message:
          'canonical guidance must not require workspace-wide build or typecheck for every merge',
      },
    ]
  );
});

test('rejects unconditional browser smoke tests for every branch', () => {
  assert.deepEqual(
    findUnsafeCanonicalCadenceStatements({
      'CONTRIBUTING.md':
        'Before declaring a branch ready to merge, verify runtime behavior. You must test in a running browser.',
    }),
    [
      {
        file: 'CONTRIBUTING.md',
        message: 'canonical guidance must scope runtime smoke tests to affected product boundaries',
      },
    ]
  );
});

test('allows one risk-proportional review and affected-boundary smoke tests', () => {
  assert.deepEqual(
    findUnsafeCanonicalCadenceStatements({
      'CONTRIBUTING.md':
        'Review the changed behavior once before committing. Run browser or API smoke tests only when the change affects that product boundary.',
    }),
    []
  );
});

test('allows workspace-wide gates at an explicit release milestone', () => {
  assert.deepEqual(
    findUnsafeCanonicalCadenceStatements({
      'CONTRIBUTING.md':
        'Run the complete workspace suite only at an explicit release milestone. At that milestone, run `pnpm typecheck` and `pnpm build` once.',
    }),
    []
  );
});

test('rejects package test wrappers that can expand an intended file slice', () => {
  assert.deepEqual(
    findAmbiguousFocusedTestCommands({
      'prompt-registry/example.md':
        'Run `pnpm --filter @veritas-kanban/server test -- --run src/example.test.ts`.',
    }),
    [
      {
        file: 'prompt-registry/example.md',
        message:
          'focused Vitest files must use direct `pnpm --filter <package> exec vitest run <exact-test-files>` invocation',
      },
    ]
  );
});

test('allows direct Vitest exact-file invocation', () => {
  assert.deepEqual(
    findAmbiguousFocusedTestCommands({
      'prompt-registry/example.md':
        'Run `pnpm --filter @veritas-kanban/server exec vitest run src/example.test.ts`.',
    }),
    []
  );
});

test('allows an explicit warning against the ambiguous package test wrapper', () => {
  assert.deepEqual(
    findAmbiguousFocusedTestCommands({
      'AGENTS.md':
        'Do not use `pnpm --filter <package> test -- --run <test-files>` for focused verification.',
    }),
    []
  );
});

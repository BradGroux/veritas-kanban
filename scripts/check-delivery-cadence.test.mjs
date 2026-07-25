import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CADENCE_CONTRACTS,
  findAmbiguousFocusedTestCommands,
  findMissingCadenceContracts,
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

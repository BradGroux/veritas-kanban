import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CADENCE_CONTRACTS,
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

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findActionPinningViolations,
  findDependabotConfigurationViolations,
} from './check-actions-pinned.mjs';

const SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1';
const DIGEST = 'a'.repeat(64);

test('accepts immutable external action pins with release comments', () => {
  assert.deepEqual(
    findActionPinningViolations({
      '.github/workflows/ci.yml': `steps:\n  - uses: actions/checkout@${SHA} # v7.0.1\n`,
    }),
    []
  );
});

test('rejects mutable tags, branches, short SHAs, and missing release comments', () => {
  assert.deepEqual(
    findActionPinningViolations({
      '.github/workflows/ci.yml': [
        'steps:',
        '  - uses: actions/checkout@v7',
        '  - uses: actions/setup-node@main',
        '  - uses: actions/upload-artifact@043fb46',
        `  - uses: pnpm/action-setup@${SHA}`,
      ].join('\n'),
    }),
    [
      {
        file: '.github/workflows/ci.yml',
        line: 2,
        reference: 'actions/checkout@v7',
        message: 'external action must use a full 40-character commit SHA',
      },
      {
        file: '.github/workflows/ci.yml',
        line: 3,
        reference: 'actions/setup-node@main',
        message: 'external action must use a full 40-character commit SHA',
      },
      {
        file: '.github/workflows/ci.yml',
        line: 4,
        reference: 'actions/upload-artifact@043fb46',
        message: 'external action must use a full 40-character commit SHA',
      },
      {
        file: '.github/workflows/ci.yml',
        line: 5,
        reference: `pnpm/action-setup@${SHA}`,
        message: 'immutable external action pin must include a trailing release comment',
      },
    ]
  );
});

test('allows local actions without a commit pin', () => {
  assert.deepEqual(
    findActionPinningViolations({
      '.github/workflows/ci.yml': 'steps:\n  - uses: ./.github/actions/setup\n',
    }),
    []
  );
});

test('requires immutable digests for Docker actions', () => {
  assert.deepEqual(
    findActionPinningViolations({
      '.github/actions/example/action.yml': [
        'runs:',
        '  using: docker',
        '  image: docker://alpine:3.22',
        '  - uses: docker://alpine:3.22',
        `  - uses: docker://alpine@sha256:${DIGEST} # 3.22.1`,
      ].join('\n'),
    }),
    [
      {
        file: '.github/actions/example/action.yml',
        line: 4,
        reference: 'docker://alpine:3.22',
        message: 'Docker action must use a full sha256 digest',
      },
    ]
  );
});

test('requires Dependabot maintenance for GitHub Actions', () => {
  assert.deepEqual(
    findDependabotConfigurationViolations("version: 2\nupdates:\n  - package-ecosystem: 'npm'\n"),
    ['Dependabot must retain a github-actions ecosystem entry']
  );
  assert.deepEqual(
    findDependabotConfigurationViolations(
      "version: 2\nupdates:\n  - package-ecosystem: 'github-actions'\n    directory: '/'\n"
    ),
    []
  );
});

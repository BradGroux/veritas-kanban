# Lint Warning Debt

Review date: 2026-06-04

The repository still allows lint warnings, but warning debt is now managed with a
ratchetable budget and a repeatable package/rule report.

## Commands

Plain lint remains available for the full ESLint output:

```bash
pnpm lint
```

The CI gate runs:

```bash
pnpm lint:budget
```

The budget script runs ESLint in JSON mode, prints counts by package, rule, and
package/rule pair, then fails when warnings exceed the configured ceiling.

For a local report without enforcing the ceiling:

```bash
pnpm lint:report
```

## Current Budget

Current warning budget: 601.

Baseline after the production unused-value cleanup:

| Package | Warnings |
| ------- | -------- |
| server  | 536      |
| web     | 38       |
| mcp     | 25       |
| shared  | 2        |

Current warning classes:

| Rule                                       | Warnings |
| ------------------------------------------ | -------- |
| `@typescript-eslint/no-explicit-any`       | 342      |
| `@typescript-eslint/no-non-null-assertion` | 227      |
| `@typescript-eslint/no-unused-vars`        | 31       |
| `react-hooks/exhaustive-deps`              | 1        |

## Cleanup Order

1. Production code before test fixtures.
2. Unused values before type-shape cleanups.
3. `no-explicit-any` in API boundaries and storage repositories before broad
   test mocks.
4. Non-null assertions in runtime paths before test setup helpers.
5. React hook dependency fixes only when the behavior is understood and covered.

Each cleanup PR should lower `lint:budget` to the new observed count. Do not
relax rules or add ignore blocks just to hide the backlog.

## Touched Code Rule

When editing a file with existing warning debt, avoid adding new warnings in
that file. If a warning is directly adjacent to the change and cheap to fix,
fix it and ratchet the budget in the same PR.

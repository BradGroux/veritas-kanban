# Lint Warning Debt

Review date: 2026-08-24

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

Current warning budget: 458.

The 6.1.2 audit reduced the repository ceiling from 600 to 458 by narrowing
production server boundaries, replacing unsafe assertions, and removing unused
values without relaxing rules or adding broad suppressions. Use
`pnpm lint:report` for the current package and rule distribution; do not copy a
historical distribution into release evidence.

The final 6.1.2 release matrix records the freshly measured total and report.

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

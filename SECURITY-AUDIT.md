# Security Audit Report

**Last audited:** 2026-03-02
**Tool:** pnpm audit (pnpm 9.15.4)
**Node version:** 22.x

## Summary

| Severity | Count |
| -------- | ----- |
| Critical | 0     |
| High     | 0     |
| Moderate | 0     |
| Low      | 0     |

**Result: No known vulnerabilities found.**

## Production Dependencies

`pnpm audit --prod` — **Clean.** No vulnerabilities in production dependency tree.

## All Dependencies (including devDependencies)

`pnpm audit` — **Clean.** No vulnerabilities in full dependency tree.

## Overrides

The following version overrides are configured in the root `package.json` to pin patched versions:

| Package     | Override   | Reason                                           |
| ----------- | ---------- | ------------------------------------------------ |
| `hono`      | `>=4.12.2` | Timing attack vulnerability fix (GHSA-xh87-mx6m) |
| `minimatch` | `>=10.2.3` | ReDoS vulnerabilities (GHSA-7r86, GHSA-23c5)     |
| `qs`        | `^6.14.2`  | Prototype pollution fix                          |

## Accepted Risks / Suppressions

_None at this time. All dependencies are clean._

## CI Integration

- **Blocking audit:** `pnpm audit --prod --audit-level=high` — fails the pipeline on high/critical vulnerabilities in production dependencies.
- **Informational audit:** `pnpm audit` — reports all vulnerabilities (including devDependencies) without blocking, for visibility.

## Process

1. Run `pnpm audit` periodically and before releases
2. CI automatically blocks merges with high/critical production vulnerabilities
3. For accepted risks, document in this file with justification and review date
4. Use `pnpm.overrides` in root `package.json` to pin fixed versions when transitive deps lag

# Critical-path coverage ratchets

Veritas measures risk-weighted execution boundaries instead of presenting one repository-wide
percentage as a quality claim. The governed policy is
[`critical-path-coverage.json`](critical-path-coverage.json).

## Run the coverage gate

```bash
pnpm test:coverage
```

The command builds `@veritas-kanban/shared`, then runs each applicable workspace from its own
working directory. It uses two Vitest workers for the import-heavy server boundary suite and at
most four elsewhere. This preserves package-specific path and timeout behavior while collecting
V8 coverage for `server`, `web`, `cli`, `mcp`, and `desktop`. Server and web execute the governed
critical-path test filters; the smaller CLI, MCP, and desktop suites run completely. The ordinary
canonical unit gate remains responsible for every test. Coverage requires no live credentials or
external services.

To measure only the packages selected by CI:

```bash
pnpm test:coverage --packages server,web
```

Each measured package writes HTML and `coverage-summary.json` under `coverage/<package>/`.
The root `coverage/critical-path-summary.json` and `.md` files contain the machine-readable and
human-readable boundary results. Coverage output is generated evidence and remains ignored by
Git.

## Governed boundaries

The initial floors were measured on 2026-08-23 with Node 22-compatible Vitest 4.1.11 and V8. A
floor is the exact measured percentage, not a rounded repository target. Any lower line, branch,
function, or statement result fails the gate.

| Package | Boundary                  |  Lines | Branches | Functions | Statements |
| ------- | ------------------------- | -----: | -------: | --------: | ---------: |
| server  | dispatch-runtime          | 64.97% |   57.48% |    70.22% |     63.67% |
| server  | auth-validation-redaction | 62.84% |   60.11% |    61.86% |     61.79% |
| server  | storage-locks-migrations  | 39.51% |   34.11% |    46.90% |     38.73% |
| web     | api-auth-realtime         | 37.74% |   34.36% |    28.67% |     36.79% |
| cli     | api-compatibility         | 52.07% |   44.53% |    65.45% |     51.02% |
| mcp     | api-tool-contracts        | 52.39% |   43.67% |    60.00% |     51.44% |
| desktop | preload-ipc-trust         | 66.24% |   66.54% |    54.86% |     65.50% |

The long-term floor for every critical boundary and metric is 80%. Raise ratchets whenever added
tests improve a result. Prioritize branches and functions below 80%, starting with the web API,
authentication, mutation, and realtime boundary. Do not reduce a floor to make CI pass.

## CI behavior

The deterministic scope selector emits `coverage_packages` separately from ordinary affected
workspaces. A full verification run measures all five packages. A focused run measures only a
package whose governed critical-path files changed. CI publishes the complete `coverage/`
directory for 14 days and writes the boundary table to the job summary. Documentation and
non-critical source changes do not repeat the coverage suite.

Broad source patterns in the policy automatically include new files in governed areas. Because
workspace coverage uses `all: true`, an untested critical file contributes zero coverage and
drops its boundary below the ratchet unless other coverage rises by the same amount.

## Exclusions and reviewed exceptions

Generated output, test files, fixtures, declaration files, and the SQLite test helper are excluded
consistently in workspace Vitest configs. Production source is not globally excluded.

If a critical source file cannot be tested immediately, add a narrow `exceptions` entry to its
boundary with all four fields:

```json
{
  "path": "server/src/example.ts",
  "reason": "Why automated coverage is not currently practical.",
  "owner": "BradGroux",
  "reviewBy": "2026-09-30"
}
```

The gate rejects incomplete and expired exceptions. The pull request must explain the compensating
verification. Remove the exception when coverage lands.

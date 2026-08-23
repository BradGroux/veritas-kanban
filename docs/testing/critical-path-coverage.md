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
critical-path test files listed exactly in the policy; the smaller CLI, MCP, and desktop suites run completely. Live provider and MCP integration opt-ins are removed from the coverage process environment. The ordinary
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
function, or statement result fails the gate. CI checks out complete Git history and compares the
policy with the event's base commit, so removing boundaries, narrowing include patterns, or
lowering a floor fails even when the edited policy would otherwise pass.

| Package | Boundary                  |  Lines | Branches | Functions | Statements |
| ------- | ------------------------- | -----: | -------: | --------: | ---------: |
| server  | dispatch-runtime          | 64.97% |   57.48% |    70.22% |     63.67% |
| server  | auth-validation-redaction | 57.58% |   52.85% |    50.91% |     56.89% |
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
package whose governed critical-path source or tests changed. CI publishes the complete `coverage/`
directory for 14 days and writes the boundary table to the job summary. Documentation and
non-critical source changes do not repeat the coverage suite. Artifact upload uses `always()` so
partial and failing reports remain available for diagnosis.

Broad source patterns in the policy automatically include new files in governed areas. Because
workspace coverage uses `all: true`, an untested critical file contributes zero coverage and
drops its boundary. CI additionally rejects every changed governed source file with no executable
coverage entry or zero covered lines, so stronger coverage elsewhere cannot hide new untested code.
The authentication boundary includes server Zod schemas and the shared authoritative API
permission map in addition to middleware and redaction code.

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
  "trackingIssue": "#1234",
  "reviewBy": "2026-09-30"
}
```

Exception paths must name one exact repository-relative file; globs and traversal are rejected.
The reason must be substantive, the owner must be a GitHub login, the tracking issue must remain
linked, and the real ISO review date must fall within 90 days. The pull request must explain the
compensating verification and receive normal review. Remove the exception when coverage lands.

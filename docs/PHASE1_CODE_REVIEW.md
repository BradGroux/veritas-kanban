# Phase 1 Code Review — 10x4

## Scores

| Dimension    | Score | Notes                                                                                                                                  |
| ------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Code Quality | 7/10  | Strong typing/doc coverage, but workflow validation misses duplicate IDs and update route ignores path params.                         |
| Security     | 6/10  | Path traversal gaps fixed (commit db7596d), yet ACL/RBAC enforcement still absent so any authenticated user can mutate workflows.      |
| Performance  | 7/10  | File I/O is async and scoped to .veritas-kanban, but listing endpoints lack pagination/limits if workflow/run counts grow.             |
| Architecture | 6/10  | Core engine matches spec after blocked-run fix, but RBAC/audit hooks and workflow diff protections from the spec remain unimplemented. |

## 🔴 Blocking Issues (must fix before merge)

None — the blocking items discovered during review (ID sanitization and blocked-run handling) were addressed in commit `db7596d (fix: workflow ID safety & blocked runs (K-2SO review))` and validated with `pnpm --filter @veritas-kanban/server typecheck`.

## 🟡 Important (fix before Phase 2)

1. **Workflow routes ignore ACL/RBAC design** (`server/src/routes/workflows.ts`). The architecture spec (§4.1.1) calls for filtering by `WorkflowACL`, per-action permission checks, and audit logging. Right now the routes never consult ACLs or call `auditChange`, so any authenticated user can list/edit/delete/start runs for every workflow. Hook the route handlers into ACL enforcement and emit audit events for create/edit/delete/run as described in the spec.
2. **`PUT /api/workflows/:id` disregards the path parameter**. The handler trusts `req.body.id` rather than `req.params.id`, allowing a client to update workflow `B` while hitting `/api/workflows/A`. Enforce that the path ID matches the body ID (or derive from the path entirely) before saving, and return 400 when they disagree.
3. **Workflow validation does not prevent duplicate step/agent IDs**. `validateWorkflow()` only checks that referenced IDs exist. If a YAML defines the same `step.id` twice, `run.steps.find()` will always pick the first entry, corrupting run state and context keys for the duplicate. Add an explicit uniqueness check (both for agents and steps) so runs remain deterministic.
4. **Audit log helper is never used**. `WorkflowService.auditChange()` exists but is never called, so there is no immutable history of workflow CRUD/run events despite the architectural requirement. Wire the POST/PUT/DELETE/run routes to append audit entries (including user ID, action, version, runId when applicable).

## 🟢 Nice-to-have

- **Hot reload for YAML edits**: `WorkflowService` caches definitions indefinitely, so editing a workflow file outside the API requires a server restart or manual `clearCache()`. Adding a cache-busting option or `etag`-style mtime check would make local iteration smoother.
- **Template context lacks progress/task helpers**: Phase 1 injects only `workflow`, `run`, `variables`, and custom context. The example workflow references `{{task.title}}`, but `startRun()` never loads the task payload, so prompts render with placeholders unless the API caller supplies `task` manually. Loading the task (or providing a helper) would make built-in templates usable from the UI.

## ✅ What's Good

- Solid TypeScript coverage with dedicated domain types (`server/src/types/workflow.ts`) matching the architecture spec.
- Storage locations follow `.veritas-kanban` conventions and use helpers from `utils/paths.ts`, keeping filesystem access centralized.
- Step outputs are persisted with sanitized filenames, making future debugging straightforward.
- Example workflow (`feature-dev-simple.yml`) demonstrates retry policies and acceptance criteria clearly for downstream authors.
- Implementation notes and architecture spec are thorough and consistent, which made review much faster.

## Verdict

- 🟡 APPROVED WITH NOTES

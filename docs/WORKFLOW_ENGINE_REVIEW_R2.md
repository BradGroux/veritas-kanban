# Workflow Engine Architecture Review — Round 2

## Round 1 Fix Verification

- ✅ **Retry routing (`retry_step`)** — Section 3.2 + the updated `WorkflowRunService.executeRun` now drive execution off a mutable step queue with `handleStepFailure`, so retries, requeues, and failure context (`_retryContext`) are explicitly defined end-to-end.
- ✅ **Loop verification flags** — `WorkflowStepExecutor.executeLoopStep` evaluates `completion:any_done`, runs the configured `verify_step` after each iteration when `verify_each` is true, and short-circuits the loop appropriately.
- ✅ **RBAC / auditing** — The RBAC model in §4.1.1 plus the rewritten `/api/workflows` routes enforce `requireAuth`, permission checks for every verb, and emit `auditWorkflowChange` entries (including `run` events).
- ✅ **Retention / concurrency** — §4.2.1 adds concrete retention thresholds, a cleanup cron, OpenClaw session teardown, and queue-based concurrency limits with clear caps and queue behavior.
- ✅ **WebSocket payloads** — `broadcastWorkflowStatus` now publishes the complete `WorkflowRun` payload (steps, durations, errors) that `WorkflowRunView` consumes without extra fetches, preserving frontend parity.
- ✅ **Antfarm parity** — Dedicated `setup` steps, watchdog monitoring/timeout handling, and the `vk workflow` CLI suite cover the previously-missing Antfarm ergonomics (env prep, watchdogs, resume/status commands).
- ✅ **Acceptance criteria validation** — `StepOutputValidator` introduces regex/JSON-schema/custom-function checks, gating every step before completion and making validator behavior concrete.
- ✅ **Task payload injection** — `WorkflowRunService.startRun` now hydrates the full task payload (metadata, git info, deliverables, timestamps) into `run.context.task`, so templates can rely on consistent fields.

## New Issues Found

- 🟢 **Schema loader TODO** — The `StepOutputValidator.loadSchema()` helper still notes "not yet implemented". Documenting the schema lookup path (e.g., resolving `workflow.schemas` by ID) would remove the last bit of ambiguity for teams planning to lean on `schema:` acceptance checks.

## Overall Score

| Dimension            | Score | Notes                                                                                                                         |
| -------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------- |
| Completeness         | 8     | All major services, routes, and parity items are now spelled out; only the schema-loader TODO remains.                        |
| Feasibility          | 8     | Designs align with the current Express/OpenClaw stack and include concrete code paths for retries, verification, and RBAC.    |
| Security             | 8     | Workflow CRUD/run routes are authenticated/authorized, audit trails are defined, and task context handling is explicit.       |
| Scalability          | 7     | Retention, cleanup, and concurrency controls are documented, though parallel-step execution remains a future phase.           |
| Developer Experience | 8     | YAML schema, interfaces, CLI commands, and acceptance criteria guidance give seniors enough to implement Phase 1 confidently. |

## Verdict

✅ **APPROVED** — Ready for Phase 1 implementation. Address the schema-loader note during development, but no blockers remain.

# Workflow Engine Architecture Review — #107

> **Doc updates applied:**
>
> 1. Replaced the unsafe `new Function` expression evaluation with an `expr-eval` sandbox.
> 2. Added structured output parsing (YAML/JSON) plus sanitized step-output filenames (via `sanitize-filename`).
> 3. Ensured workflow run context always includes the associated task payload for templates.

## Executive Summary

The proposed workflow engine establishes a solid YAML-first foundation with thoughtful integration points across tasks, squad chat, telemetry, and the UI. However, several critical behaviors remain underspecified or only sketched-in (loop verification, retry routing, context parsing before I patched it, lifecycle management of run artifacts, and security/RBAC for workflow CRUD). The plan is technically feasible on the existing Express/better-sqlite3/React stack, but additional design work is required to make it production-ready and to reach parity with Antfarm’s battle-tested ergonomics. Addressing the identified gaps before implementation will prevent stalled development during Phase 1 and avoid regressions in multi-agent safety.

## Score (1-10)

| Dimension                 | Score | Notes                                                                                                                               |
| ------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Completeness              | 6     | Core services covered, but retry routing, loop verification, cleanup, and RBAC are undefined.                                       |
| Feasibility               | 7     | Fits current stack, yet WebSocket payloads, task context plumbing (before fix), and OpenClaw integration details need clarity.      |
| Security                  | 6     | Injection surface reduced after edits, but workflow CRUD authorization, YAML trust boundaries, and escalation handling remain open. |
| Scalability & Performance | 5     | No concurrency controls or storage retention strategy; WebSocket/event storms unaccounted for.                                      |
| Developer Experience      | 6     | YAML schema + interfaces help, yet missing instructions for acceptance-criteria validation, schema tooling, and CLI parity.         |
| Comparison with Antfarm   | 6     | Clear improvements (UI, squad chat), but lacks Antfarm’s setup steps, watchdogs, and CLI ergonomics.                                |

## Strengths

- **YAML-first workflows** keep definitions version-controlled and human-reviewable.
- **Clear separation of services** (definition loader, run orchestrator, executor) matches VK’s modular backend style.
- **Frontend surfaces** (WorkflowsPage + RunView) bring observability into VK, differentiating from CLI-only tooling.
- **Progress + telemetry integration** ensures workflows feed existing squad chat/time-tracking expectations.
- **Loop/gate primitives** (even if unfinished) set the stage for advanced orchestration.

## Issues Found

### 🔴 Blocking

- None — previously blocking security issues (expression evaluation & output path traversal) were fixed directly in the architecture doc as noted above.

### 🟡 Important

1. **Retry routing isn’t actually specified.** `retry_step` is marked TODO; there’s no mechanism to jump backwards or requeue a prior step, so workflows that rely on verifier-triggered retries (feature-dev, security-audit) can’t function as described.
2. **Loop verification flags are ignored.** `loop.verify_each`, `verify_step`, and `completion:any_done` never execute in the provided executor, leaving critical QA behavior undefined.
3. **Acceptance criteria & schema validation lack an implementation plan.** The doc states criteria will be enforced, yet there’s no mention of how outputs are inspected (regex vs schema). Without this, deterministic gating is impossible.
4. **Workflow CRUD endpoints don’t define RBAC.** `/api/workflows` and `/api/workflow-runs` expose full create/update/delete without limiting to admins or validating signed commits, which conflicts with Brad’s production-quality bar.
5. **No lifecycle management for `.veritas-kanban/workflow-runs`.** Step outputs accumulate forever; even 10 concurrent runs could create thousands of files with no retention strategy or size budgeting.
6. **WebSocket payload mismatch.** `WorkflowRunView` expects the full `WorkflowRun`, but `broadcastWorkflowStatus` only emits minimal fields; resume buttons and progress bars would fail or require extra HTTP fetches every event.
7. **Concurrency/back-pressure plan is absent.** There’s no queue, max-run limit, or per-step throttling, so a burst of tasks could spawn unbounded OpenClaw sessions and overwhelm the host.
8. **Comparison with Antfarm misses key capabilities.** Antfarm’s setup/prepare steps, watchdog cron, and CLI-driven resume/status flows aren’t addressed, leaving parity gaps in repo prep, automated cleanup, and offline monitoring.

### 🟢 Nice-to-have

1. **Example workflow inconsistencies.** `review` references an undefined `verifier` agent; minor, but undermines copy/paste readiness.
2. **Cache invalidation for workflow definitions.** `WorkflowService` caches YAML but never invalidates; hot-editing files during development would require restarts.
3. **Schema discovery tooling.** Developers lack a `workflow lint`/`typescript-json-schema` command to validate YAML against the interfaces.
4. **WebSocket event volume optimizations.** No batching/backoff strategy is described for high-frequency step updates.

## Specific Recommendations

1. **Define retry routing semantics** (state machine diagram + executor logic) so `retry_step` and verifier handoffs are deterministic. Consider modeling the run as a queue of step IDs rather than a simple `for` loop.
2. **Implement loop verification hooks** by scheduling `verify_step` as a child step per iteration and wiring the result into completion logic. Document exactly how `loop.verify_each` interacts with retries/escalations.
3. **Document an acceptance-criteria engine.** E.g., `StepOutputValidator` that can run regex rules, JSON Schema (using Ajv), or custom functions referenced by ID.
4. **Specify RBAC for workflow APIs.** Restrict CRUD to admin/API-key contexts, audit updates, and require signed commits (or repo PRs) to change production workflows.
5. **Plan storage retention.** Add config for `maxRunHistory` (count and disk quota) plus a cron/CLI cleanup command; document how archives are exported before deletion.
6. **Align WebSocket payloads with UI needs.** Either emit the full serialized run (including durations and errors) or include a version field so the frontend knows when to refetch.
7. **Add concurrency controls.** Introduce a simple in-memory queue with configurable `MAX_CONCURRENT_RUNS` and per-agent throttles to protect OpenClaw and SQLite.
8. **Close feature gaps vs Antfarm.** Incorporate `setup`/environment steps, a CLI parity layer (`vk workflow status`, `resume`), and watchdog polling so workflows survive server restarts and headless deployments.
9. **Provide dev tooling.** Ship `pnpm vk workflow lint` to validate YAML schemas and hot-reload workflows (invalidate cache when files change).
10. **Polish examples.** Fix agent references, add comments showing expected outputs, and include at least one YAML that uses each step type (gate/loop/parallel) with valid syntax.

## Open Questions

1. How will workflow YAML changes be code-reviewed? Through Git PRs or in-app editors with signing?
2. What is the expected maximum number of concurrent runs, and how does that map to machine resources/token budget?
3. Should workflow runs surface cost/token telemetry per step in the UI?
4. How are human escalations handled — does VK pause the run until an operator resolves the issue inside the app?
5. Will workflows ever need secrets (API keys, service creds) and, if so, where are they injected safely into templates?
6. Do we need a migration path for existing Antfarm YAMLs (import/export tooling)?

## Verdict

**Needs revision before implementation.** The overall direction is strong, but retry semantics, verification hooks, RBAC, resource controls, and lifecycle/cleanup details must be specified (and in some cases prototyped) to avoid rework once coding begins. Address the Important issues above, ensure security expectations are codified, and then Phase 1 can proceed with confidence.

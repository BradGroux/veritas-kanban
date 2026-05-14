# Board Manager Architecture — Example Approval Workflow

Status: design/spec only. This document describes an optional automation pattern; it does not install or require any persistent scheduler.

This document describes an example short-lived board manager that uses configurable board columns and service-level workflow gates. It is not intended to hard-code a personal workflow into Veritas. The concrete names below are example operator/worker roles; downstream teams can rename roles, columns, and dispatch mechanisms to match their own environment.

For the generic configurable-column model, see [Configurable Board Columns](CONFIGURABLE-BOARD-COLUMNS.md).

## Example Board Workflow

Configured board columns, in order:

1. `triage` — **Triage**: raw capture. New tasks default here after this board configuration is applied.
2. `todo` — **To Do**: operator review / approval queue. Existing `todo` tasks remain here.
3. `ready` — **Ready**: approved, assigned, worker-actionable.
4. `in-progress` — **In Progress**: worker has claimed/started.
5. `blocked` — **Blocked**: worker needs input, dependency, access, or decision.
6. `done` — **Done**: completed with deliverable/comment/verification.

These columns preserve a local locked workflow semantics: raw intake must be shaped before approval; approved work must be assigned before execution; blocked work must carry visible blocker context; done work must leave evidence.

## Example Role Responsibilities

### Intake / Enrichment Role

The intake role owns Triage enrichment. For each `triage` card it adds or verifies:

- clarified objective
- context/background
- acceptance criteria / definition of done
- suggested worker type
- expected artifact/output
- risks, blockers, and open questions

After enrichment, the intake role moves the card to `todo`, not `ready`.

### Operator / Approver Role

The operator reviews `todo` cards. Approved/assigned cards are manually moved to `ready`.

### Worker Roles

Example worker roster:

- `librarian`
- `implementer`
- `researcher`
- `writer`
- `ops`

Workers do **not** need to poll Veritas. In this architecture, a worker receives one assigned task, does that task, returns a result, and stops.

## Assignment Field

Prefer the existing visible `agent` field when it maps cleanly to the target worker. Otherwise use `assignedWorker`, a lightweight task field for board-manager assignment. The UI exposes `assignedWorker` as **Assigned Worker** with the example roster above.

## Transition Gates

Hard blocks are preferred over warnings for this approval workflow.

### `todo` -> `ready`

Block unless:

- assigned worker exists (`assignedWorker` or usable `agent`)
- acceptance criteria / definition of done exists in the description or subtask acceptance criteria

### `in-progress` / active work -> `done`

Block unless:

- completion comment exists
- deliverable/artifact is attached or recorded
- verification note exists, either via checked verification step or comment text

### Any -> `blocked`

Block unless a concrete blocker is recorded via `blockedReason.note` or a blocker-style visible comment. Blocked notifications are immediate only for high-priority/urgent work; otherwise they are comment/digest material.

## Board Manager Lifecycle

The board manager is intentionally short-lived and idempotent. A production deployment could trigger it periodically, but this patch does **not** install or require any persistent scheduler.

One run:

1. acquire local lock
2. health check Veritas/API/config/state
3. load structured local state
4. reconcile active work first
   - inspect active run/session IDs
   - reconcile stale/finished workers
   - write visible comments and status transitions
5. triage/enrichment dispatch
   - dispatch intake/enrichment role for eligible `triage` cards
   - worker returns enrichment and stops
   - manager comments and moves enriched cards to `todo`
6. ready pickup
   - choose `ready` cards within concurrency limits
   - infer worker readiness from active run state, not worker polling
   - dispatch worker directly
   - record run/session IDs in local state and visible Veritas comment
   - move task to `in-progress`
7. release lock and exit

## State and Recovery

Use two recovery surfaces:

- visible Veritas comments/status transitions for human audit and partial recovery
- structured local state for manager idempotency and worker-run reconciliation

Suggested local state shape:

```json
{
  "activeRuns": {
    "task_YYYYMMDD_xxxxxx": {
      "worker": "implementer",
      "sessionId": "...",
      "runId": "...",
      "status": "running",
      "startedAt": "2026-05-13T00:00:00.000Z",
      "lastSeenAt": "2026-05-13T00:00:00.000Z"
    }
  },
  "lastManagerRunAt": "2026-05-13T00:00:00.000Z"
}
```

Concurrency defaults:

- one active task per worker
- max 3 active worker tasks globally

## Manual Run Affordance

Practical command shape for a future implementation:

```bash
pnpm --filter server board-manager:run-once
```

or a repo script wrapper:

```bash
pnpm board-manager:run-now
```

The command should run the exact short-lived lifecycle above once, then exit with a clear status code.

## Upstream/Fork Framing

This document is best treated as an example architecture layered on top of configurable board columns, not as a core requirement for all Veritas users. The reusable upstream pieces are:

- configured board columns
- server-validated status transitions
- first-class blocked reason support
- visible assignment metadata
- service-level gates that cannot be bypassed by alternate clients

The environment-specific pieces are:

- worker names and dispatch implementation
- scheduler choice
- local state file location
- notification policy
- exact gate rules beyond the currently implemented service checks

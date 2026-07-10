# PRD Traceability and Work-Item Hierarchy

**Status:** Design Draft  
**GitHub Issue:** [#773](https://github.com/BradGroux/veritas-kanban/issues/773)  
**Priority:** High  
**Related:** [PRD-Driven Development](prd-driven-development.md), [SQLite Schema](../SQLITE-SCHEMA.md), [API Reference](../API-REFERENCE.md)

---

## Overview

This document specifies a first-class, optional traceability layer for Veritas Kanban that
connects work items to the PRD requirements, risks, decisions, and verification evidence they
satisfy. Combined with an explicit work-item hierarchy (`initiative → epic → story → task →
child-task`), this layer allows both humans and autonomous agents to answer planning and safety
questions from structured fields—without parsing prose descriptions or inferring hierarchy from
title prefixes.

The design is entirely additive. Existing boards continue to work with zero changes. All new
fields are optional. When traceability metadata is absent, all existing behavior is unchanged.

---

## Current State

Veritas Kanban v5.2.1 already provides:

| Existing capability         | Surface                                              |
| --------------------------- | ---------------------------------------------------- |
| Project and sprint grouping | `task.project`, `task.sprint`                        |
| Subtasks with AC            | `task.subtasks[].acceptanceCriteria`                 |
| Top-level verification      | `task.verificationSteps`                             |
| Bidirectional dependencies  | `task.dependencies.depends_on` / `.blocks`           |
| Blocked state and reasons   | `task.blockedReason`, `BlockedCategory`              |
| Observations                | `task.observations` (decision, blocker, insight, context) |
| Deliverables                | `task.deliverables`                                  |
| External tracker backlinks  | `task.externalWorkItems`                             |
| Task readiness checks       | `shared/src/utils/task-readiness.ts`                 |
| PRD-driven development SOPs | `docs/features/prd-driven-development.md`            |

**Not yet present in any surface:**

- Parent task ID / hierarchy link
- Explicit work-item level (`initiative`, `epic`, `story`, `task`, `child-task`) — note: the
  level `subtask` is deliberately avoided here because `task.subtasks[]` already uses that term
  for checklist items; `child-task` refers to a full-record structural child (see Design section)
- PRD requirement IDs mapped to tasks
- Risk IDs and per-risk disposition (`mitigated`, `gated`, `accepted`, `blocked`, `deferred`)
- Verification IDs linking to test/evidence artifacts
- Queryable human-gate labels as structured fields
- Stop conditions as named predicates with a resolved/unresolved toggle
- Dependency-aware "next safe unblocked task" selection that considers gate and risk state

---

## Problem Statement

The current state works for human-driven boards where practitioners can read descriptions and
infer context. For autonomous or semi-autonomous agent work it creates fragile operating conditions:

1. **Agents infer hierarchy from prose.** Title prefixes like `EPIC-01A` or `US-3` are
   conventions, not structured fields. Agents must parse them and risk misreading new formats.

2. **Requirement coverage is invisible.** There is no machine-readable answer to "which PRD
   requirement does this task satisfy?" or "which requirements have no associated tasks?"

3. **Risk disposition is buried in comments.** Whether a given risk is mitigated, gated,
   accepted, or still open requires reading comments. Autonomous agents cannot safely evaluate
   whether it is appropriate to proceed.

4. **Human gates are implicit.** Tasks that require explicit human approval before an agent
   proceeds encode that constraint in task descriptions or observation notes, not in queryable
   fields.

5. **"What is the next safe thing to do?" is underdefined.** `task.status = 'todo'` and all
   `dependencies.depends_on` done is necessary but not sufficient. Gate and risk state matter too.

---

## Goals

- Give agents structured planning metadata to safely choose the next work item.
- Give humans auditable requirement-coverage and risk-coverage views without parsing prose.
- Make existing dependency, verification, and observation surfaces more useful by connecting
  them to explicit IDs.
- Remain completely optional. No existing workflow changes.

## Non-Goals

- Not a Jira-style process requirement. Nothing in this design is mandatory.
- Not a replacement for projects, sprints, subtasks, or dependencies.
- Not a full Gantt or critical-path system.
- Not storing the full PRD inside VK. Requirement IDs reference durable external docs.
- Not a new top-level entity type. Hierarchy is expressed through fields on existing tasks.

---

## Design

### Work-Item Hierarchy Model

The hierarchy is a labeling convention on individual tasks. VK does not enforce a strict
tree structure—tasks may exist without a level or parent. The `parentId` field creates an
optional parent–child edge navigable through the API.

```
initiative
  └─ epic
       └─ story
            └─ task
                 └─ child-task   ← full-record structural child task
```

**`child-task` vs. `task.subtasks[]`:** VK already uses `task.subtasks[]` for lightweight
checklist items (not full task records). The level `child-task` is for a full first-class
`Task` record that belongs under a parent task in the hierarchy. To avoid any naming
collision, the `WorkItemLevel` union uses `'child-task'` (not `'subtask'`).

Level semantics are advisory and do not gate status transitions. Teams may use any subset of
levels.

### TypeScript Schema

New types in `shared/src/types/task.types.ts`:

```typescript
/**
 * Five-level work-item hierarchy. All values are optional labels; enforcement is advisory.
 * NOTE: 'child-task' is used instead of 'subtask' to avoid collision with
 * task.subtasks[], which holds lightweight checklist items (not full task records).
 */
export type WorkItemLevel = 'initiative' | 'epic' | 'story' | 'task' | 'child-task';

/**
 * Disposition of a tracked risk as it relates to this task.
 * - mitigated  — Risk is resolved; evidence present or linked in verificationIds.
 * - gated      — Risk remains open; this task may not proceed until the gate is cleared.
 * - accepted   — Risk is acknowledged and consciously accepted by the team.
 * - blocked    — Task is blocked because this risk is unresolved.
 * - deferred   — Risk handling is intentionally deferred to a later task or phase.
 * - unknown    — Risk disposition has not been evaluated (default when riskIds set but disposition absent).
 */
export type RiskDisposition =
  | 'mitigated'
  | 'gated'
  | 'accepted'
  | 'blocked'
  | 'deferred'
  | 'unknown';

/**
 * Optional traceability layer for a task.
 * All fields are optional; absent traceability is equivalent to an empty object.
 * Existing board behavior is entirely unaffected when this field is absent or null.
 *
 * PATCH semantics: sending `"traceability": null` clears all traceability.
 * Sending a partial object replaces each present key. To clear a scalar field, pass null.
 * To clear an array field, pass []. To clear riskDisposition/stopConditionResolved, pass {}.
 */
export interface TaskTraceability {
  /**
   * ID of the parent task in the work-item hierarchy.
   * Pass null to explicitly clear a previously set parentId.
   * The referenced task must exist in the same workspace.
   * Circular parent chains are rejected with 400.
   */
  parentId?: string | null;

  /**
   * Advisory level in the work-item hierarchy.
   * 'child-task' refers to a full-record structural child task.
   * This is distinct from task.subtasks[], which holds lightweight checklist items.
   * Pass null to clear.
   */
  workItemLevel?: WorkItemLevel | null;

  /**
   * PRD requirement IDs this task satisfies. Format is project-defined.
   * Examples: ["REQ-001", "REQ-017"], ["auth.1", "auth.2"].
   * Coverage reporting cross-references these against the project requirement catalog.
   * Replaces the array on each update; pass [] to clear.
   */
  requirementIds?: string[];

  /**
   * Risk IDs tracked by this task. Format is project-defined.
   * Examples: ["RISK-SEC-01"], ["auth-risk-1"].
   * Replaces the array on each update; pass [] to clear.
   */
  riskIds?: string[];

  /**
   * Decision IDs that affect this task. Format is project-defined.
   * Examples: ["ADR-0001"], ["DEC-2026-03-auth"].
   * Replaces the array on each update; pass [] to clear.
   */
  decisionIds?: string[];

  /**
   * Verification / test IDs that prove requirements or risks are handled.
   * Examples: ["TEST-42"], ["spec/auth.test.ts"].
   * Cross-references to task.verificationSteps are by description or position within the same task.
   * Replaces the array on each update; pass [] to clear.
   */
  verificationIds?: string[];

  /**
   * Named human-gate labels.
   * Any non-empty humanGates array blocks next-safe selection for this task.
   * Pass [] to clear all gates.
   */
  humanGates?: string[];

  /**
   * Named stop conditions. Each condition is a free-form string.
   * Resolved state is tracked separately in stopConditionResolved.
   * next_safe excludes tasks with at least one unresolved stop condition.
   * Pass [] to clear.
   */
  stopConditions?: string[];

  /**
   * Resolved state for each stop condition, keyed by condition string.
   * A stop condition absent from this map (but present in stopConditions) is unresolved.
   * Example: { "regression suite must be green": true }
   * Pass {} to reset all resolved states.
   */
  stopConditionResolved?: Record<string, boolean>;

  /**
   * Per-risk disposition keyed by risk ID.
   * Disposition for IDs not present in this map is treated as 'unknown'.
   * Example: { "RISK-SEC-01": "mitigated", "RISK-PERF-02": "gated" }
   * Pass {} to reset all dispositions.
   */
  riskDisposition?: Record<string, RiskDisposition>;
}
```

Add to the `Task` interface (after `qaGate`):

```typescript
export interface Task {
  // ... existing fields ...

  /**
   * Optional traceability metadata connecting this task to PRD requirements,
   * risks, decisions, verification evidence, and the work-item hierarchy.
   * Absent or null is equivalent to no traceability metadata.
   */
  traceability?: TaskTraceability | null;
}
```

Add to `UpdateTaskInput`:

```typescript
export interface UpdateTaskInput {
  // ... existing fields ...
  traceability?: TaskTraceability | null;
}
```

Add `traceability` to `TaskSummary` when `?include=traceability` is requested (see API section).

### SQLite Schema

New table added in migration `0050_task_traceability.up.sql` (number to be assigned per
`docs/SQLITE-SCHEMA.md` migration numbering rules):

```sql
CREATE TABLE task_traceability (
  task_id                       TEXT PRIMARY KEY
                                  REFERENCES tasks(id) ON DELETE CASCADE,
  parent_id                     TEXT
                                  REFERENCES tasks(id) ON DELETE SET NULL,
  work_item_level               TEXT CHECK (
                                  work_item_level IN (
                                    'initiative','epic','story','task','child-task'
                                  )
                                ),
  requirement_ids_json          TEXT,   -- JSON array of strings, e.g. ["REQ-001","REQ-002"]
  risk_ids_json                 TEXT,   -- JSON array of strings
  decision_ids_json             TEXT,   -- JSON array of strings
  verification_ids_json         TEXT,   -- JSON array of strings
  human_gates_json              TEXT,   -- JSON array of strings
  stop_conditions_json          TEXT,   -- JSON array of strings
  stop_condition_resolved_json  TEXT,   -- JSON object: { "condition string": true/false }
  risk_disposition_json         TEXT,   -- JSON object: { "RISK-01": "mitigated", ... }
  created_at                    TEXT NOT NULL,
  updated_at                    TEXT NOT NULL,
  created_by                    TEXT,
  updated_by                    TEXT
);

CREATE INDEX idx_task_traceability_parent
  ON task_traceability(parent_id)
  WHERE parent_id IS NOT NULL;

CREATE INDEX idx_task_traceability_level
  ON task_traceability(work_item_level)
  WHERE work_item_level IS NOT NULL;
```

Down migration (`0050_task_traceability.down.sql`):

```sql
DROP INDEX IF EXISTS idx_task_traceability_level;
DROP INDEX IF EXISTS idx_task_traceability_parent;
DROP TABLE IF EXISTS task_traceability;
```

**Design trade-off — JSON columns vs. normalized junction tables:** The requirement/risk/
decision/verification ID arrays are stored as JSON blobs rather than junction tables (unlike
`task_dependencies`, `task_subtasks`, `task_verification_steps`). This is intentional for
the initial phase: these are reference-only identifiers, not VK entity IDs requiring FK
integrity. Coverage queries use `json_each()` to iterate, which is adequate for typical
cardinalities. If performance or integrity requirements change (e.g., a native risk register
entity lands), a follow-up migration can normalize these into `task_requirements`,
`task_risks`, etc. junction tables.

**Archive/delete semantics for hierarchy:** VK archives tasks rather than physically deleting
them. The `ON DELETE SET NULL` on `parent_id` applies only to hard deletes (rare purge path).
For archived parents, the implementation must define explicit behavior:

- Archiving a task that has active (non-archived) children issues a warning in the API
  response (`archiveWarning: "N active children retain this task as parent"`). The archive
  proceeds regardless. Children's `parentId` is preserved — callers that want to reparent
  or cascade the archive must do so explicitly in separate requests.
  (Enforced at the service layer; not a DB FK constraint.)
- `/api/tasks/:id/children` excludes archived children by default; pass `?include_archived=true`
  to include them.
- `GET /api/hierarchy` excludes archived nodes by default; archived ancestors are rendered as
  `[archived]` stub nodes when a live descendant is shown.

**Cross-scope parent links:** When `project` or `sprint` is set on a task, its `parentId`
is validated to reference a task in the same project (same `project` field). Cross-project
parent links are rejected with `400 Bad Request`. Tasks without a project may parent tasks
in any project, but hierarchy queries scoped to a project treat such parents as external roots.

### File-Backed Storage Compatibility

For file-backed (v4) projects, `traceability` is persisted as an optional top-level field in
the per-task JSON file, following the same pattern as `qaGate`, `checkpoint`, and `observations`.
No schema change is required for file-backed projects. The storage abstraction layer handles
serialization transparently.

The file-to-SQLite migration (`FileToSqliteMigrationService`) maps the `traceability` field
to the `task_traceability` table. Absent or null `traceability` in the source file produces no
row in `task_traceability`.

---

## API Design

### Updated Endpoints

#### `GET /api/tasks` and `GET /api/tasks/:id`

No breaking changes. Traceability is **not** included in default responses to preserve payload
size for boards with many tasks.

**Include traceability in responses:**

```
GET /api/tasks?include=traceability
GET /api/tasks/:id?include=traceability
```

The `include` parameter accepts a comma-separated list (e.g. `include=traceability,deliverables`)
for future extensibility.

#### `PATCH /api/tasks/:id`

Accepts `traceability` partial update in the existing request body:

```json
{
  "traceability": {
    "parentId": "TASK-001",
    "workItemLevel": "story",
    "requirementIds": ["REQ-005", "REQ-006"],
    "riskIds": ["RISK-AUTH-01"],
    "riskDisposition": { "RISK-AUTH-01": "mitigated" },
    "humanGates": [],
    "verificationIds": ["TEST-22"]
  }
}
```

Send `"traceability": null` to clear all traceability metadata.

Partial updates are merged at the top `traceability` object level. Individual array fields
are replaced, not appended, consistent with how `subtasks` and `verificationSteps` are updated.

Validation rules:
- `parentId`, if provided, must reference an existing task in the same workspace. Pass `null`
  to clear; omit to leave unchanged.
- Parent must be in the same `project` as the child task (when both have a project). Cross-project
  parent links are rejected with `400 Bad Request`.
- Circular parent references (A → B → A) are rejected with `400 Bad Request`.
- `workItemLevel` must be one of the five permitted values or `null` to clear.
- `riskDisposition` keys should appear in `riskIds` (soft validation warning in response, not rejection).
- `humanGates` and `stopConditions` items are free-form strings, max 255 chars each.
- Arrays are bounded at 100 items each.
- `stopConditionResolved` keys must match strings in `stopConditions` (soft warning, not rejection).

#### `GET /api/tasks` — next-safe selection

New optional query parameters:

```
GET /api/tasks?next_safe=true
GET /api/tasks?next_safe=true&project=rubicon
GET /api/tasks?next_safe=true&allow_unknown_risks=true
```

`next_safe=true` **forces** `status=todo` regardless of other status filters. Combining
`next_safe=true` with an explicit `status` other than `todo` returns `400 Bad Request`.

A task qualifies as "next safe" when **all** of the following hold:

1. `status` is exactly `todo`.
2. All tasks in the **union of** `dependencies.depends_on` and `blockedBy` have `status = 'done'`.
   This covers both the modern dependency graph and legacy `blockedBy` semantics.
3. `blockedReason` is absent or null.
4. `traceability.humanGates` is absent or empty.
5. `traceability.stopConditions` is absent or empty, OR every stop condition in
   `stopConditions` has a corresponding `true` entry in `stopConditionResolved`.
6. None of the `traceability.riskIds` has disposition `blocked` or `gated` in
   `traceability.riskDisposition`. Both `blocked` and `gated` explicitly signal "this task may
   not proceed" and are always excluded with no override available.
7. None of the `traceability.riskIds` has disposition `unknown` (either absent from
   `riskDisposition` or explicitly set to `unknown`), **unless** `allow_unknown_risks=true`
   is passed.

Results are ordered by: `priority` descending (`critical` first), then `position` ascending,
then `created` ascending.

Response includes `traceability` fields when `next_safe=true` is set (equivalent to
`include=traceability`).

### New Endpoints

#### `GET /api/tasks/:id/traceability`

Dedicated read endpoint for traceability metadata. Returns the `TaskTraceability` object or
`{}` if none is set.

```
GET /api/tasks/TASK-042/traceability
```

Response:
```json
{
  "taskId": "TASK-042",
  "traceability": {
    "parentId": "TASK-001",
    "workItemLevel": "story",
    "requirementIds": ["REQ-005", "REQ-006"],
    "riskIds": ["RISK-AUTH-01"],
    "riskDisposition": { "RISK-AUTH-01": "mitigated" },
    "humanGates": [],
    "stopConditions": ["regression suite must be green"],
    "stopConditionResolved": { "regression suite must be green": true },
    "verificationIds": ["TEST-22"]
  }
}
```

#### `GET /api/tasks/:id/children`

Returns direct children of a task in the hierarchy (`parentId = :id`). Excludes archived
children by default; pass `?include_archived=true` to include them. Supports standard
pagination and `?include=traceability`.

```
GET /api/tasks/TASK-001/children?page=1&limit=25
```

#### `GET /api/coverage/requirements`

Requirement coverage report for a project or sprint.

```
GET /api/coverage/requirements?project=rubicon
GET /api/coverage/requirements?sprint=sprint-3
```

**Coverage semantics and the requirement catalog:**

`total` in the summary is the count of distinct `requirementIds` seen across all tasks in
scope **plus** any IDs registered in the project's requirement catalog (see
`POST /api/projects/:id/catalog/requirements` below). Without a catalog, `total` equals the
number of distinct IDs observed in tasks, so "uncovered" means no task in scope references
that ID. With a catalog, requirement IDs registered but not referenced by any task appear as
uncovered rows (`tasks: []`).

**Verification semantics:** A requirement is considered `verified` when at least one task
that references it has:
- `status = 'done'`, **and**
- at least one `verificationSteps` entry with `checked = true`, **or**
- at least one entry in `verificationIds`.

Mere presence of `verificationSteps` or `verificationIds` without `done` status or checked
steps does **not** count as verified.

Response:
```json
{
  "project": "rubicon",
  "catalogSource": "registered",
  "requirements": [
    {
      "id": "REQ-001",
      "tasks": ["TASK-010", "TASK-011"],
      "verificationIds": ["TEST-01", "TEST-02"],
      "covered": true,
      "verified": true
    },
    {
      "id": "REQ-007",
      "tasks": [],
      "verificationIds": [],
      "covered": false,
      "verified": false
    }
  ],
  "summary": {
    "total": 12,
    "covered": 9,
    "verified": 7,
    "uncovered": 3,
    "coveragePercent": 75,
    "verificationPercent": 58
  }
}
```

`catalogSource`: `"registered"` when a catalog exists; `"derived"` when computed from task
IDs only (no uncovered rows possible in derived mode).

#### `POST /api/projects/:id/catalog/requirements`

Register a set of requirement IDs for a project. Enables `GET /api/coverage/requirements` to
report truly uncovered requirements (those in the catalog but referenced by no tasks).

```json
{
  "requirementIds": ["REQ-001", "REQ-002", "REQ-007", "REQ-010", "REQ-011"],
  "replace": true
}
```

`replace: true` (default) clears the existing catalog before saving. `replace: false` merges.

#### `POST /api/projects/:id/catalog/risks`

Same semantics as the requirements catalog, for risk IDs.

```json
{
  "riskIds": ["RISK-AUTH-01", "RISK-PERF-02", "RISK-SEC-05"],
  "replace": true
}
```

#### `GET /api/coverage/risks`

Risk coverage report.

```
GET /api/coverage/risks?project=rubicon
```

**Verification semantics:** A risk is `verified` when at least one task that tracks it has
`status = 'done'` **and** at least one `verificationSteps` entry with `checked = true` or
at least one entry in `verificationIds`. Risks with `disposition: 'accepted'` are excluded
from the verified check (accepted risks do not require evidence).

Response:
```json
{
  "project": "rubicon",
  "catalogSource": "registered",
  "risks": [
    {
      "id": "RISK-AUTH-01",
      "tasks": ["TASK-010"],
      "disposition": "mitigated",
      "verified": true
    },
    {
      "id": "RISK-PERF-02",
      "tasks": ["TASK-015"],
      "disposition": "gated",
      "verified": false
    },
    {
      "id": "RISK-SEC-05",
      "tasks": [],
      "disposition": "unknown",
      "verified": false
    }
  ],
  "summary": {
    "total": 8,
    "mitigated": 3,
    "gated": 2,
    "accepted": 1,
    "blocked": 0,
    "deferred": 1,
    "unknown": 1,
    "openRisks": 4
  }
}
```

`openRisks` = count of risks with disposition `gated`, `blocked`, `deferred`, or `unknown`.
Risks in the catalog but not referenced by any task are included with `disposition: 'unknown'`
and `tasks: []` when a catalog is registered (`catalogSource: "registered"`).

#### `GET /api/hierarchy`

Returns the task tree for a project, optionally rooted at a specific task. Archived tasks
are excluded by default; pass `?include_archived=true` to include them (rendered as stub nodes
with `archived: true`).

```
GET /api/hierarchy?project=rubicon
GET /api/hierarchy?root=TASK-001&depth=3
```

Response:
```json
{
  "nodes": [
    {
      "id": "TASK-001",
      "title": "Authentication epic",
      "status": "in-progress",
      "workItemLevel": "epic",
      "children": [
        {
          "id": "TASK-010",
          "title": "OAuth2 login flow",
          "status": "done",
          "workItemLevel": "story",
          "children": []
        },
        {
          "id": "TASK-011",
          "title": "Token refresh handling",
          "status": "todo",
          "workItemLevel": "story",
          "children": []
        }
      ]
    }
  ]
}
```

Depth defaults to 5. Tasks without `traceability.parentId` appear as roots when no `root`
parameter is given. Tasks without `workItemLevel` are included with `workItemLevel: null`.

---

## CLI Design

All changes are additive to existing `vk update` and `vk list` commands.

### `vk update` — traceability flags

```
# Work-item hierarchy
vk update <id> --parent <taskId>
vk update <id> --level initiative|epic|story|task|child-task
vk update <id> --clear-parent        # remove parentId (sets parentId: null)

# Requirement and risk traceability
vk update <id> --requirements REQ-001,REQ-002
vk update <id> --risks RISK-AUTH-01,RISK-PERF-02
vk update <id> --decisions ADR-0001
vk update <id> --verification-ids TEST-22,TEST-23

# Risk disposition
vk update <id> --risk-disposition RISK-AUTH-01=mitigated,RISK-PERF-02=gated

# Gates and stop conditions
vk update <id> --human-gate "Coby approval before production write"
vk update <id> --stop-condition "regression suite must be green"
vk update <id> --resolve-stop-condition "regression suite must be green"   # marks resolved=true
vk update <id> --clear-human-gates
vk update <id> --clear-stop-conditions

# Show current traceability
vk show <id> --traceability
```

Array flags (`--requirements`, `--risks`, etc.) **replace** the existing array. Prepend `+` to
append: `--requirements +REQ-003`. Prepend `-` to remove: `--requirements -REQ-001`.

### `vk list --next-safe`

```
vk list --next-safe
vk list --next-safe --project rubicon
vk list --next-safe --allow-unknown-risks   # include tasks where risk disposition is unknown
vk list --next-safe --json
```

Output (default):
```
┌ Next safe tasks (3 found) ──────────────────────────────────┐
│ TASK-011  [story]   Token refresh handling          [todo]  │
│ TASK-018  [task]    Write migration tests           [todo]  │
│ TASK-021  [task]    Update API docs                 [todo]  │
└──────────────────────────────────────────────────────────────┘
```

Blocked reasons are shown inline when `--verbose` is used.

### `vk coverage` commands

```
vk coverage requirements [--project <id>] [--sprint <id>] [--json]
vk coverage risks [--project <id>] [--sprint <id>] [--json]
```

Default (non-JSON) output:
```
Requirements coverage — project: rubicon
  Covered:    9/12 (75%)
  Verified:   7/12 (58%)
  Uncovered:  REQ-007, REQ-010, REQ-011

Risk coverage — project: rubicon
  Mitigated:  3   Gated:    2
  Accepted:   1   Blocked:  0
  Deferred:   1   Unknown:  1
  Open risks: RISK-PERF-02 (gated), RISK-SEC-05 (unknown)
```

### `vk hierarchy` command

```
vk hierarchy [--project <id>] [--root <taskId>] [--depth <n>] [--json]
```

Default output renders an indented tree. `--json` returns the same structure as `GET /api/hierarchy`.

---

## PRD / Backlog Import Helper (Phase 4)

A future `vk import prd` command will accept a structured JSON payload and create a hierarchy
of tasks with traceability populated.

Input schema (v1):
```json
{
  "project": "rubicon",
  "sprint": "sprint-4",
  "items": [
    {
      "externalId": "REQ-001",
      "title": "User can log in via OAuth2",
      "level": "story",
      "parentExternalId": null,
      "requirementIds": ["REQ-001"],
      "riskIds": ["RISK-AUTH-01"],
      "acceptanceCriteria": ["Login succeeds with Google", "Login fails gracefully on error"],
      "verificationIds": ["TEST-01", "TEST-02"]
    }
  ]
}
```

The importer creates tasks in dependency order, sets `traceability` fields from the payload,
and returns a summary of created task IDs keyed by `externalId`.

This phase is out of scope for the initial implementation. The endpoint placeholder is
`POST /api/import/prd`.

---

## Migration and Backward Compatibility

### Task API

- `GET /api/tasks` responses do **not** include `traceability` by default. No payload size
  regression for existing clients.
- `PATCH /api/tasks/:id` ignores unknown top-level fields under the `UpdateTaskInput` Zod schema,
  so old clients sending requests without `traceability` are unaffected.
- All new query parameters (`next_safe`, `include=traceability`) are additive and ignored by
  older server versions.

### SQLite Migration

Migration `0050_task_traceability` is forward-only-safe:
- Adding a new table does not affect existing queries.
- Existing tasks have no row in `task_traceability`, which is equivalent to `traceability: null`.
- The down migration drops the table cleanly, restoring pre-0050 schema state.

The migration sequence must be applied atomically: up migration runs in a SQLite transaction;
rollback drops the table and removes the `schema_migrations` row.

### File-Backed (v4) Projects

- `traceability` is an optional top-level field in per-task JSON. Absent means no traceability.
- Reading old task files without the field returns `undefined` for `traceability`, which the
  API serializes as absent (not `null`) in responses.
- Writing traceability to a v4-backed task adds the field to the JSON file. No file structure
  change; no migration required.

### CLI

All new flags are additive. Existing `vk update`, `vk list`, and `vk show` behavior is unchanged.
The `vk coverage` and `vk hierarchy` commands are new; they do not conflict with existing commands.

---

## Acceptance Criteria

| # | Criterion |
|---|-----------|
| 1 | Existing boards continue to work with no changes. Zero regressions in task CRUD, board rendering, and agent task-pick behavior. |
| 2 | `PATCH /api/tasks/:id` with a valid `traceability` payload persists all fields and returns them in subsequent `GET /api/tasks/:id?include=traceability` responses. |
| 3 | `PATCH /api/tasks/:id` with `"traceability": { "parentId": null }` clears `parentId` only; other traceability fields are preserved. |
| 4 | `PATCH /api/tasks/:id` with `"traceability": null` clears all traceability metadata. |
| 5 | `GET /api/tasks?next_safe=true` returns only `todo` tasks where: (a) all `depends_on` **and** `blockedBy` tasks are `done`, (b) `blockedReason` is absent, (c) `humanGates` is empty, (d) `stopConditions` are all resolved, and (e) no risk has disposition `blocked`, `gated`, or `unknown`. |
| 6 | `GET /api/tasks?next_safe=true` with an explicit `status` other than `todo` returns `400 Bad Request`. |
| 7 | `GET /api/tasks?next_safe=true&allow_unknown_risks=true` includes tasks whose risks have `unknown` disposition but still excludes tasks whose risks have `blocked` or `gated` disposition. |
| 8 | `GET /api/coverage/requirements?project=<id>` in "derived" mode (no catalog) reports only IDs observed in tasks; the `uncovered` count is 0. In "registered" mode (catalog present), IDs in the catalog but absent from tasks appear as uncovered rows. |
| 9 | A requirement is reported `verified: true` only when at least one `done` task referencing it has at least one `verificationSteps` entry with `checked = true`, or at least one `verificationIds` entry. |
| 10 | `GET /api/coverage/risks?project=<id>` returns a risk register with per-disposition counts and correctly identifies open risks; risks with `disposition: 'accepted'` are excluded from the verified check. |
| 11 | `GET /api/hierarchy?project=<id>` returns a correct tree of tasks linked via `traceability.parentId`, up to 5 levels deep; archived tasks are excluded by default. |
| 12 | `PATCH /api/tasks/:id` with a cross-project `parentId` (parent in a different project) returns `400 Bad Request`. |
| 13 | `PATCH /api/tasks/:id` with a circular `parentId` chain returns `400 Bad Request`. |
| 14 | Archiving a task with active (non-archived) children without reparenting them returns a warning (not a hard block) and the child's `parentId` is preserved until explicitly cleared. |
| 15 | `vk update <id> --parent <taskId>` sets `traceability.parentId`. `vk update <id> --clear-parent` sets it to null. `vk show <id> --traceability` prints the current traceability fields. |
| 16 | `vk list --next-safe` returns the same set as API criterion 5. |
| 17 | `vk coverage requirements` and `vk coverage risks` produce human-readable output matching the API response summaries. |
| 18 | File-backed (v4) projects can set and retrieve traceability fields with no migration step. |
| 19 | SQLite migration `0050` applies and rolls back cleanly in a test fixture with no foreign-key violations. |

---

## Rollout Sequence

### Phase 1 — Schema and Core API (required for everything downstream)

1. Add `TaskTraceability`, `WorkItemLevel`, `RiskDisposition` types to `shared/src/types/task.types.ts`.
   Use `'child-task'` for the hierarchy leaf level.
2. Add `traceability` field to `Task` and `UpdateTaskInput`. Include `stopConditionResolved`.
3. Add `task_traceability` table migration (`0050`) with `stop_condition_resolved_json` column
   and `work_item_level` CHECK for `'child-task'` instead of `'subtask'`.
4. Implement `TaskTraceabilityRepository` (SQLite and file-backed).
5. Update `TaskRepository.update()` and `TaskRepository.getById()` to persist and hydrate
   traceability when `include=traceability` is requested.
6. Add `traceability` to `UpdateTaskInput` Zod schema with validation:
   - Circular parent check (traverse `parentId` chain up to depth 20 before failing).
   - Cross-project parent check (reject `parentId` in a different project).
   - `workItemLevel` enum check.
   - `parentId: null` clears the field cleanly.
   - Array bounds (100 items each).
7. Update `GET /api/tasks/:id`, `PATCH /api/tasks/:id`, and `GET /api/tasks` with the
   `include=traceability` parameter.
8. Add `GET /api/tasks/:id/traceability` dedicated endpoint.
9. Add `GET /api/tasks/:id/children` endpoint (with `?include_archived=true`).
10. Add `next_safe=true` filter to `GET /api/tasks`. The filter must evaluate:
    - `depends_on ∪ blockedBy` all done.
    - `blockedReason` absent.
    - `humanGates` empty.
    - All `stopConditions` resolved (or no stop conditions).
    - No risk with disposition `blocked` or `gated`; no risk with disposition `unknown` unless
      `allow_unknown_risks=true` is set. (`blocked` and `gated` are always excluded — no override.)
    - Returns `400` when combined with a non-`todo` status filter.
11. Unit tests for storage, validation (circular/cross-project), and next-safe logic.

### Phase 2 — Coverage and Hierarchy APIs

12. Implement `POST /api/projects/:id/catalog/requirements` and `/catalog/risks`.
13. Implement `GET /api/coverage/requirements` with `project` and `sprint` scopes.
    Verified = `done` task + at least one `verificationSteps[].checked=true` or `verificationIds` entry.
    `catalogSource`: `"registered"` or `"derived"`.
14. Implement `GET /api/coverage/risks` with `project` and `sprint` scopes.
    Accepted risks excluded from verified check.
15. Implement `GET /api/hierarchy` with `project`, `root`, `depth`, and `include_archived` parameters.
    Archived ancestors shown as `{ id, title, archived: true, children: [] }` stubs when a
    live descendant is included.
16. Integration tests for coverage (derived/registered modes), verification semantics, and
    hierarchy depth/archive behavior.

### Phase 3 — CLI

17. Add `--parent`, `--clear-parent`, `--level`, `--requirements`, `--risks`, `--decisions`,
    `--verification-ids`, `--risk-disposition`, `--human-gate`, `--stop-condition`,
    `--resolve-stop-condition`, `--clear-human-gates`, and `--clear-stop-conditions` to `vk update`.
18. Add `--traceability` flag to `vk show`.
19. Add `vk list --next-safe` (passes `allow_unknown_risks` when `--allow-unknown-risks` set).
20. Add `vk coverage requirements` and `vk coverage risks`.
21. Add `vk hierarchy`.
22. CLI integration tests using the test server fixture.

### Phase 4 — PRD Import Helper (follow-up issue)

23. Define `POST /api/import/prd` endpoint with versioned input schema (`"version": "1"`).
24. Implement dependency-ordered batch creation with traceability population.
25. Add `vk import prd` command.

### Phase 5 — UI (follow-up issue)

26. Hierarchy tree view in task detail sidebar.
27. Coverage dashboard widget in project view.
28. Traceability fields in task edit form (collapsed by default).
29. "Safe to start" filter in board UI (equivalent to `next_safe=true`).

---

## Implementation Backlog

The following issues should be filed when Phase 1 begins. Each issue closes a distinct
increment to keep PRs reviewable.

| # | Title | Phase | Notes |
|---|-------|-------|-------|
| B-1 | Add `TaskTraceability` types to `shared/` and `UpdateTaskInput` Zod schema | 1 | Purely additive TypeScript and Zod. No runtime change. Includes `stopConditionResolved`. |
| B-2 | Add `task_traceability` SQLite migration and repository | 1 | Migration `0050`. `work_item_level` CHECK uses `'child-task'`. Includes file-backed path. |
| B-3 | Integrate traceability into `GET /api/tasks/:id` and `PATCH /api/tasks/:id` | 1 | `?include=traceability`, null-clear, `parentId: null` clear, circular+cross-project validation. |
| B-4 | Add `GET /api/tasks/:id/traceability` and `GET /api/tasks/:id/children` | 1 | Children endpoint excludes archived by default. |
| B-5 | Add `next_safe=true` filter to `GET /api/tasks` | 1 | Evaluates `depends_on ∪ blockedBy`, gates, resolved stop conditions, risk disposition. Excludes `blocked` and `gated` (no override); excludes `unknown` unless `allow_unknown_risks=true`. Returns `400` on bad status combo. |
| B-6 | Add project requirement and risk catalogs | 2 | `POST /api/projects/:id/catalog/requirements` and `/risks`. Enables uncovered-row semantics. |
| B-7 | Implement `GET /api/coverage/requirements` | 2 | Derived and registered catalog modes. Verified = done + checked steps. |
| B-8 | Implement `GET /api/coverage/risks` | 2 | Derived and registered catalog modes. Accepted risks exempt from verified check. |
| B-9 | Implement `GET /api/hierarchy` | 2 | Tree builder with configurable depth. Archive stub semantics. |
| B-10 | CLI: `vk update` traceability flags | 3 | Includes `--resolve-stop-condition`. Add/replace/remove array syntax (`+`, `-` prefix). |
| B-11 | CLI: `vk list --next-safe` and `vk show --traceability` | 3 | Consumes Phase 1 API. Passes `allow_unknown_risks` to server. |
| B-12 | CLI: `vk coverage` and `vk hierarchy` commands | 3 | Consumes Phase 2 API. |
| B-13 | PRD import helper (`POST /api/import/prd`, `vk import prd`) | 4 | Separate issue; versioned input schema, dependency-ordered batch create. |
| B-14 | UI: Hierarchy tree, coverage widget, traceability edit form | 5 | Separate issue. Design exploration needed. |

---

## Open Questions

1. **Soft enforcement of levels** — Should VK optionally warn (not block) when a `story`-level
   task has no `parentId` pointing to an `epic`? Flagging in `TaskReadinessCheck` seems
   appropriate rather than a hard validation. Decision deferred to Phase 1 implementation.

2. **Risk register entity** — Risk IDs are currently free-form strings. A future risk register
   entity (outside scope here) would allow richer metadata per risk. This design is forward
   compatible: `riskIds` can point to VK risk entity IDs when that entity exists, and to
   external risk-tracker IDs until it does. The catalog endpoints (B-6) are an incremental step.

3. **Human-gate clearance UX** — This design treats `humanGates` as a simple array of strings.
   A future enhancement could make each gate a structured record with a cleared timestamp and
   cleared-by actor. Out of scope for Phase 1.

4. **Import format versioning** — The PRD import payload (Phase 4) must include a `"version": "1"`
   field from the start. Deferred to the Phase 4 issue (B-13).

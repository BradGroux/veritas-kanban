# Configurable Board Columns

Status: proposal / branch documentation for configurable task-status columns.

## Problem

Veritas historically assumed a small, fixed board lifecycle. That works for simple task tracking, but it becomes limiting when teams want to model a real operating process, for example:

- an intake lane before work is approved
- a ready/approved queue before agents or humans start work
- a blocked lane with required blocker context
- custom status labels that match an existing team workflow
- keyboard shortcuts, counts, drag/drop, and API validation that all use the same column model

When the board layout is hard-coded, the UI, task service, CLI/API clients, metrics, and tests can drift from each other. Configurable columns make the board lifecycle explicit in feature settings instead of scattering status assumptions across the app.

For AI-assisted workflows, configurable columns also turn the board into a durable coordination layer instead of leaving work trapped in one conversational thread. A typical operating loop becomes:

> Capture rough work → enrich it into executable tasks → approve/assign it → execute it → record evidence on the card

That separation lets humans capture incomplete work quickly, lets task-shaping agents clarify it later, and lets execution agents pick up only approved work with visible progress, blockers, deliverables, and verification.

## Feature

Board columns are configured from `features.board.columns` and rendered in that configured order. Each column has:

- `id`: the task status value stored on tasks
- `title`: the human-readable column title shown in the board UI

New tasks use `features.board.defaultStatus` when no status is provided. If `defaultStatus` is missing from the configured columns, the server falls back to the first configured column, then to `todo` as a final safety fallback.

The default branch configuration in this work is:

```json
{
  "features": {
    "board": {
      "columns": [
        { "id": "triage", "title": "Triage" },
        { "id": "todo", "title": "To Do" },
        { "id": "ready", "title": "Ready" },
        { "id": "in-progress", "title": "In Progress" },
        { "id": "blocked", "title": "Blocked" },
        { "id": "done", "title": "Done" }
      ],
      "defaultStatus": "triage"
    }
  }
}
```

## Configuration Model

The configuration lives under feature settings:

```ts
interface BoardColumnConfig {
  id: TaskStatus;
  title: string;
}

interface BoardSettings {
  columns: BoardColumnConfig[];
  defaultStatus: TaskStatus;
}
```

Validation rules:

- `columns` is optional in PATCH payloads, but resolves to defaults when omitted.
- `columns` must contain 1-12 entries when provided.
- `column.id` must be 1-50 characters.
- `column.id` must be lowercase alphanumeric with dashes: `^[a-z0-9][a-z0-9-]*$`.
- `column.title` must be 1-50 characters.
- `defaultStatus` must use the same slug format as a column ID.

`TaskStatus` remains string-extensible, so custom status IDs can flow through shared types without requiring a source-code enum edit for every workflow.

## UI Behavior

The board renders from the configured column list:

- columns appear in `features.board.columns` order
- loading skeletons use the same configured column count
- drag/drop accepts configured status IDs
- task grouping uses configured status IDs
- task counts and sidebar views can address custom status IDs through generic count records
- number-key shortcuts map to the current column order instead of a fixed 1-4 set
- column names in move announcements resolve from configured titles

Settings -> Board & Display includes a **Board Columns** section for editing visible workflow columns. The current UI supports adding columns before/after existing columns and editing column titles/status IDs. Existing task statuses are not automatically rewritten when a column ID is changed.

## Server Validation

The task service treats configured columns as the authoritative set of active task statuses.

On task creation:

- if the request includes `status`, it must match a configured column ID
- if the request omits `status`, the server uses the configured default status
- if the configured default is invalid or missing, the first configured column is used
- an unconfigured status returns `ValidationError` with `INVALID_STATUS`

On task update/status change:

- requested status changes must match a configured column ID
- invalid status updates are rejected before writing task files
- service-level validation applies to PATCH, bulk update, CLI/MCP, and future automation paths that call `TaskService.updateTask`

This keeps UI drag/drop, API clients, and automation clients behind the same guardrail.

## Workflow Gates

This branch also includes service-level workflow gates that assume a six-column approval workflow:

- `todo` -> `ready` requires an assigned worker (`assignedWorker` or usable `agent`) and acceptance criteria / definition of done.
- entering `blocked` requires a first-class blocked reason with category and note.

These gates are intentionally enforced in the task service rather than only in the UI, so bulk updates and automated clients cannot bypass them.

For an upstream contribution, treat these as a first implementation of configurable workflow enforcement, not as the only possible policy model. Future work could make gate rules themselves configurable, for example by declaring required fields per transition.

## Backward Compatibility

Config loading still deep-merges feature settings with `DEFAULT_FEATURE_SETTINGS`, so existing installations that do not define `features.board.columns` receive the default columns automatically.

Task files remain Markdown with YAML frontmatter. Existing task status values are preserved on disk; this feature does not rewrite existing tasks during config load.

Compatibility considerations:

- Existing tasks whose statuses match configured column IDs continue to appear in the board.
- Existing tasks with statuses that are no longer configured are preserved, but they may not appear in visible board columns until the status is re-added or the task is migrated.
- API/CLI callers that hard-code old status values must be updated if an installation removes or renames those columns.
- Default migrations should prefer additive column changes over destructive renames.

## Migration / Default Behavior

Recommended migration path for existing installs:

1. Load current settings; if `features.board.columns` is absent, use defaults.
2. Add new columns without removing legacy statuses first.
3. Move or bulk-update existing tasks into the new workflow intentionally.
4. Only remove old columns after no active tasks use those status IDs.
5. Keep `defaultStatus` aligned with an existing configured column.

For fresh installs, the default six-column workflow starts new tasks in `triage`.

For conservative upstream rollout, maintainers may choose to keep the historical four-column default (`todo`, `in-progress`, `blocked`, `done`) and document the six-column workflow as an example configuration. The implementation supports either default.

## Limitations

Current limitations / follow-ups:

- Workflow gates are not yet fully configurable; the current gates target the `todo` -> `ready` and `blocked` transitions.
- The board settings UI does not automatically migrate task statuses when a column ID changes.
- Removing or renaming a column can hide tasks with the old status from the visible board until migrated or reconfigured.
- Some documentation and examples may still mention the historical four-column workflow and should be updated as part of final upstream polish.
- External integrations should discover configured columns from settings rather than assuming a fixed status list.

## Related Documentation

- [Board Manager Architecture](BOARD-MANAGER-ARCHITECTURE.md) — example automation architecture using configurable columns and service-level gates.
- [Configurable Board Columns PR Notes](PR-CONFIGURABLE-BOARD-COLUMNS.md) — upstream PR framing and rollout checklist.

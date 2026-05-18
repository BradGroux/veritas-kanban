# PR: Configurable Board Columns + Workflow Gates

Status: draft PR framing for upstream or fork contribution.

## Summary

This change makes kanban board columns configurable through feature settings and routes board rendering, keyboard moves, drag/drop, task creation, and task status validation through the same configured column model.

It also adds service-level workflow gates for approval-oriented boards:

- `todo` -> `ready` requires an assigned worker and acceptance criteria / definition of done.
- entering `blocked` requires a structured blocked reason.

## Why

Fixed board columns are too rigid for teams that use Veritas as an operating board rather than a simple todo list. Common workflows need intake, approval, ready-for-worker, active, blocked, and done states. If those statuses are hard-coded in each UI/service surface, behavior drifts and automation can bypass process rules.

Configurable columns provide one source of truth for active task statuses. Server-side validation ensures UI, API, CLI, MCP, bulk updates, and future automation paths agree on which statuses are valid.

This is especially useful for AI-assisted task orchestration because it moves work out of a single chat thread and onto durable cards. Teams can separate raw intake, task enrichment, human approval, active execution, blockers, and completion evidence while keeping the same status model across UI and API surfaces.

## User-Facing Changes

- Board columns render from `features.board.columns`.
- New tasks default to `features.board.defaultStatus` when no status is provided.
- Settings -> Board & Display includes a **Board Columns** editor.
- Keyboard number shortcuts map to configured column order.
- Loading skeletons, board grid width, drag/drop targets, and column titles follow the configured board.
- Invalid status moves are rejected with a clear validation error.
- Approval workflow gates can block moves that lack required context.

Default six-column example:

1. Triage
2. To Do
3. Ready
4. In Progress
5. Blocked
6. Done

## Technical Changes

Shared/config:

- Adds `BoardColumnConfig` and `BoardSettings.columns` / `BoardSettings.defaultStatus` to feature settings.
- Keeps `TaskStatus` string-extensible so custom workflow IDs are type-compatible.
- Updates default feature settings to include board columns and default status.
- Expands status labels for common six-column statuses.

Server:

- Validates create/update statuses against configured board columns.
- Uses configured default status for task creation.
- Falls back safely if default status is missing from configured columns.
- Enforces workflow gates in `TaskService.updateTask` so API, bulk, CLI/MCP, and automation paths share the same rules.
- Updates migration/summary/metrics/service logic to handle configurable statuses.

Web:

- Renders board columns from feature settings.
- Updates drag/drop, keyboard shortcuts, task grouping, loading skeleton, sidebar/counts, and board settings UI to respect configured columns.
- Exposes `assignedWorker` and blocked reason fields needed by workflow gates.

Tests:

- Adds/updates service tests for configurable statuses and workflow gates.
- Updates frontend tests/mocks around dynamic columns.
- Updates task/service/storage/migration/summary coverage for the expanded default workflow.

Docs:

- Adds generic configurable board columns documentation.
- Frames the board manager as an example automation architecture rather than an environment-specific requirement.

## Validation

Branch validation already performed before this packaging pass:

- Configurable board columns branch validates.
- Existing code/test changes are present on branch `zora/configurable-board-columns`.

Documentation packaging validation to run before commit/PR:

```bash
# Generic framing sanity: no environment-specific labels should appear outside this checklist.
rg -n "environment-specific-label-placeholder" docs/CONFIGURABLE-BOARD-COLUMNS.md docs/PR-CONFIGURABLE-BOARD-COLUMNS.md docs/BOARD-MANAGER-ARCHITECTURE.md
rg -n "CONFIGURABLE-BOARD-COLUMNS|PR-CONFIGURABLE-BOARD-COLUMNS|Board Manager Architecture" docs
rg -n "[[:blank:]]$" docs/CONFIGURABLE-BOARD-COLUMNS.md docs/PR-CONFIGURABLE-BOARD-COLUMNS.md docs/BOARD-MANAGER-ARCHITECTURE.md

git diff --check
```

Suggested full validation before upstream PR, if code has changed after this doc pass:

```bash
pnpm install --frozen-lockfile
pnpm --filter @veritas-kanban/shared build
pnpm --filter @veritas-kanban/server test
pnpm --filter @veritas-kanban/server typecheck
pnpm --filter @veritas-kanban/server build
pnpm --filter @veritas-kanban/web typecheck
pnpm --filter @veritas-kanban/web build
git diff --check
```

Run the shared build before server tests in clean checkouts where `shared/dist` is absent. Use the repository's current canonical test commands if they differ.

Observed non-blocking validation warnings during local packaging:

- `pnpm --filter @veritas-kanban/web build` emits existing Vite warnings about large chunks and an ineffective dynamic import involving `src/lib/api/index.ts`. The build still succeeds.
- `pnpm --filter @veritas-kanban/server test` emitted a Node `MaxListenersExceededWarning` during one local post-commit validation run. The full server test suite still passed.

These warnings were not introduced as failing conditions by this branch, but they should be visible to maintainers during PR review.

Additional local validation evidence after packaging:

- Re-applied the package in a clean local validation copy.
- Re-ran validation: shared build, full server suite (105 files / 1557 tests), server typecheck/build, web typecheck/build, and `git diff --check` all passed.
- Verified API health, web UI response, configured six-column board order, default `triage` status, and transition gate behavior in a local runtime smoke test.
- Smoke-created tasks were deleted after verification.

## Compatibility

Backward-compatible defaults:

- Existing configs without `features.board.columns` get defaults through feature-settings merge.
- Existing task files are not rewritten during config load.
- Existing status values remain valid if those IDs remain configured.

Potentially breaking behavior:

- If an installation removes or renames a column, tasks with the old status may no longer render in visible board columns until migrated or the column is restored.
- API/CLI clients that assume fixed statuses must discover configured columns or align with the instance configuration.
- The six-column default changes where new tasks land (`triage`) compared with older four-column defaults (`todo`). Upstream maintainers may choose to keep the historical default and document six columns as an opt-in example.

## Risks

- Hidden fixed-status assumptions may remain in older docs, tests, screenshots, or integrations.
- Current workflow gates are hard-coded to specific transitions; this is useful for the included approval workflow but should become configurable for broad upstream use.
- Column ID edits in settings do not migrate existing tasks, which can make old-status tasks disappear from the rendered board until handled.
- Custom status IDs may need careful handling in metrics, summaries, exports, and external integrations.

## Screenshots / GIFs

Add before PR submission:

- [ ] Settings -> Board & Display -> Board Columns editor
- [ ] Settings -> Board & Display remains vertically scrollable; lower controls such as Drag & Drop and Done Column Metrics are reachable after the Board Columns editor is visible
- [ ] Board showing six configured columns
- [ ] Drag/drop or keyboard move into a configured column
- [ ] Validation error for an invalid or gated move
- [ ] Task detail showing Assigned Worker / Blocked Reason fields

## Rollout Notes

Recommended rollout for maintainers:

1. Decide whether the upstream default should remain the historical four-column board or move to the six-column workflow.
2. If preserving maximum compatibility, ship configurable columns first with the historical default and include six-column configuration as an example.
3. Add a release note warning that removing/renaming columns does not migrate existing task statuses automatically.
4. Encourage API/CLI/MCP clients to read configured board columns instead of hard-coding statuses.
5. Consider a follow-up issue for configurable transition gates.

## Suggested PR Description

```markdown
## What

Adds configurable kanban board columns through feature settings and uses that configuration across board rendering, drag/drop, keyboard shortcuts, task creation, and task status validation. Also adds service-level workflow gates for approval-oriented boards.

## Why

Teams use Veritas with different operating workflows. Making columns configurable avoids hard-coded status drift and gives UI/API/automation clients one source of truth for valid task statuses.

## Validation

- [ ] Server tests
- [ ] Web tests
- [ ] Typecheck
- [ ] `git diff --check`
- [ ] Manual UI smoke: configure columns, create task, drag/drop, keyboard move, invalid move validation

## Compatibility

Existing configs receive defaults. Existing task files are preserved. Installations that remove/rename statuses should migrate tasks or keep legacy columns visible until no active tasks use them.
```

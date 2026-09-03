# Task workspace information architecture

This document records the reviewed design direction for issue #1299. It accounts for the current task-detail surfaces and defines the destination contract for the progressive task workspace before application code changes.

The accompanying [interactive prototype](../prototypes/task-workspace/index.html) compares the two navigation candidates and demonstrates representative task lifecycle states. It is a design artifact only. It does not read or mutate task data.

## Product job

The task workspace serves an operator who needs to answer one question first: **what should happen next for this task?** It must support quick triage in the drawer and deep execution or review without making every diagnostic surface compete for attention.

## Selected direction

Use a compact vertical mode rail on desktop and a single adaptive mode selector at narrow widths.

- The drawer grows to approximately half of the application width, capped at a readable maximum.
- Overview, Plan, Run, Results, and History are the only primary modes.
- Each mode owns its local section navigation. Local destinations are not another permanently visible tab row.
- The task header keeps one primary action, Chat, an Expand action, and a small overflow for rare global actions.
- The current task state is dominant. Readiness, attempt, transport, review, and evidence statuses stay attached to the objects they describe.
- The expanded presentation reuses the same mode and local-section state rather than creating another task-detail implementation.

The vertical rail is preferred over compact top navigation because the labels remain visible without horizontal scrolling, the active mode stays stable while long content scrolls, and the content column retains a predictable start edge. The prototype retains a navigation-variant switch so the decision can be reviewed rather than inferred.

## Current surface inventory and destination map

| Current surface | Current availability                     | New destination         | Replacement contract                                                      |
| --------------- | ---------------------------------------- | ----------------------- | ------------------------------------------------------------------------- |
| Work            | Default for active or consequential work | Overview                | Replace the duplicated summary with a state-aware composition.            |
| Details         | All tasks; editable unless archived      | Plan / Details          | Preserve debounced task edits, validation, archive, and restore behavior. |
| Progress        | All tasks                                | Plan / Progress         | Preserve subtasks, verification, dependencies, and progress mutations.    |
| Work Products   | All tasks                                | Results / Work Products | Keep creation, versioning, preview, and deliverable relationships.        |
| Observations    | All tasks                                | Plan / Observations     | Preserve add and delete mutations and scored observation types.           |
| Attachments     | Feature setting enabled                  | Plan / Attachments      | Preserve upload, extraction, download, delete, and feature gating.        |
| Git             | Code tasks                               | Run / Source            | Keep repository, branch, worktree, status, and source mutations.          |
| Agent           | Code tasks                               | Run / Session           | Keep provider, session, control, resume, retry, and permission behavior.  |
| Timeline        | Code tasks                               | History / Timeline      | Preserve selected attempt and event targets and causal ordering.          |
| Evidence        | All tasks                                | Results / Evidence      | Keep evidence chronology and links without treating it as task status.    |
| Changes         | Code tasks; disabled without worktree    | Results / Changes       | Preserve diff loading, review comments, and worktree gating.              |
| Review          | Code tasks                               | Results / Review        | Preserve decisions, findings, decision reviews, and merge completion.     |
| Metrics         | All tasks                                | History / Metrics       | Preserve attempt, cost, token, duration, and task aggregate metrics.      |

## Current action inventory

| Current action          | New placement                    | Notes                                                                   |
| ----------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| Chat                    | Header secondary action          | Available across modes because conversation can support any task stage. |
| Template                | Plan / Details contextual action | Remove from the global row after the Plan path is verified.             |
| Workflow                | Run contextual action            | Open the existing workflow overlay from Run.                            |
| Preview                 | Run / Source specialist action   | Preserve code-task, repository, setting, and local-control gates.       |
| Close                   | Header utility                   | Restore focus to the invoking board element.                            |
| Resolve blocker         | Overview primary action          | Shown only when the task is blocked.                                    |
| Fix readiness           | Overview primary action          | Links to the exact missing Plan requirement.                            |
| Monitor active run      | Overview primary action          | Links to Run and the selected active attempt.                           |
| Prepare worktree        | Overview primary action          | Links to Run / Source for eligible code tasks.                          |
| Complete verification   | Overview primary action          | Links to Plan / Progress or Results / Verification as appropriate.      |
| Address review decision | Overview primary action          | Links to Results / Review.                                              |
| Review handoff          | Overview primary action          | Links to Results / Work Products.                                       |

Rare actions remain inside the section they affect or in a labeled overflow. The same action must not appear simultaneously in the header, Overview, and a mode unless each placement has a distinct job.

## Status ownership

| Status class   | Source                                             | Presentation rule                                                                   |
| -------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Task lifecycle | `task.status`                                      | The only dominant status at the top of Overview.                                    |
| Readiness      | computed readiness checks                          | A gate summary with the first missing requirement and a Plan link.                  |
| Attempt        | `task.attempt.status` and run records              | Attached to the active or latest attempt in Overview and Run.                       |
| Transport      | WebSocket or event-stream connection               | A subordinate connection label inside live activity, never a global success signal. |
| Review         | `task.review.decision` and open findings           | Attached to Results and summarized in Overview when it changes the next action.     |
| Evidence       | work products, deliverables, verification, handoff | Expressed as completeness or counts, not as task lifecycle state.                   |

The design deliberately allows a failed attempt and a connected event stream to coexist. The labels must read "Attempt failed" and "Event stream connected" so they do not appear contradictory.

## Lifecycle compositions

| Lifecycle fixture | Dominant state   | Recommended action    | Visible supporting summary                                       |
| ----------------- | ---------------- | --------------------- | ---------------------------------------------------------------- |
| New               | Not ready        | Complete task details | Objective and first missing readiness requirement.               |
| Ready             | Ready to run     | Start run             | Concise readiness confirmation and selected execution path.      |
| Active            | In progress      | Monitor active run    | Current step, elapsed time, provider, and recent output.         |
| Blocked           | Blocked          | Resolve blocker       | Blocker reason, owner, remediation, and collapsed diagnostics.   |
| Failed            | Attempt failed   | Review failure        | Failure summary, retry posture, and latest safe recovery action. |
| Review            | Ready for review | Review changes        | Change summary, verification, open findings, and review owner.   |
| Done              | Done             | Review handoff        | Deliverables, evidence completeness, and handoff status.         |

Irrelevant empty sections remain absent. A missing section receives a compact callout only when its absence blocks the recommended action.

## Permission and availability boundaries

- Archived or otherwise read-only tasks retain inspection but not edit controls.
- Attachments remain governed by the existing task feature setting.
- Git, Agent, Timeline, Changes, and Review retain their code-task visibility rules.
- Changes remains unavailable without a worktree, but Results still explains the prerequisite.
- Preview retains the existing repository, preview-setting, and local-agent-control requirements.
- Child components continue to enforce their current identity permissions. The shell does not widen authority.
- Fallback selection must choose an available mode and local destination without rendering a forbidden surface.

## Deep-link compatibility

`TaskDetailNavigationTarget.tab` remains accepted during migration. Each legacy value maps to the mode and local destination in the inventory table. `timelineAttemptId` and `timelineEventId` map to History / Timeline and retain exact selection. Search results, dashboard drill-downs, board events, artifact causal links, workflow-run links, commands, and internal cross-links must all use the same translator.

New callers may use a versioned target containing `mode` and `section` only after the shell lands. Legacy tab targets remain supported until every caller and persisted link has migrated.

## Presentation state

The drawer and expanded view share one UI state object:

- task ID
- primary mode
- local section
- selected attempt and event
- drawer or expanded presentation
- per-mode scroll position
- focus return target
- unsaved local edit state

Only stable user preferences, such as the last selected mode or collapsed diagnostic groups, may persist. Task truth continues to come from existing task, attempt, workflow, evidence, review, and work-product contracts.

## Responsive and accessibility contract

- Desktop: sticky vertical mode rail, readable content column, and a drawer near 50 percent of the viewport.
- Short desktop: rail and content scroll independently; the task header and recommended action remain reachable.
- Narrow: replace the rail with one labeled native-feeling selector and stack header actions without horizontal overflow.
- Increased text: use wrapping labels and intrinsic control sizing; do not depend on fixed card heights.
- Keyboard: enter the active mode, move through local sections, invoke the primary action, open diagnostics, expand, close, and return focus without pointer input.
- Screen readers: expose one task-workspace landmark, one mode navigation landmark, one main heading, owned status labels, and section headings.
- Reduced motion: mode and disclosure changes use no required animation; optional transitions respect `prefers-reduced-motion`.
- Dark and light themes use the existing neutral and violet token hierarchy. Red, amber, green, and blue remain semantic.

## Delivery boundaries

1. Land the shell and compatibility translator without moving data ownership.
2. Replace Work with the state-aware Overview.
3. Migrate Plan, Run, Results, and History independently.
4. Add the expanded presentation using the same state and renderers.
5. Remove legacy duplication only after focused deep-link, mutation, permission, and lifecycle verification proves the replacement paths.

The integrated release gate owns the full workspace suite. Each child issue runs only the focused tests and rendered checks for its feature boundary.

## Implemented replacement and retirement map

The drawer and expanded presentation now render the same workspace component tree. Expanding changes only the presentation width, so task edits, the active mode and section, selected attempt and event targets, scroll position, and nested workflow or chat context remain owned by one surface.

- The header retains Chat, Expand or Exit expanded, and Close as workspace-wide actions.
- Template is owned by Plan. Workflow and Preview are owned by their Run sections.
- Verification and deliverables no longer compete inside Details; Results owns their reviewed replacement paths.
- Overview recommendations link to the exact Plan, Run, Results, or History destination instead of duplicating those controls.
- Legacy `TaskDetailNavigationTarget.tab` links remain a compatibility input, but the mode and local-section translator is the only navigation authority.
- The board records the invoking control and restores focus there after the workspace closes, with the task card as a stable fallback.

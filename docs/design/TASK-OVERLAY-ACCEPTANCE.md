# Task overlay family acceptance

Tracking: [#1444](https://github.com/BradGroux/veritas-kanban/issues/1444), [#1383](https://github.com/BradGroux/veritas-kanban/issues/1383), and [#1385](https://github.com/BradGroux/veritas-kanban/issues/1385). This is the maintained implementation and verification contract, not a declaration that the installed app or release has passed. Dated candidate results and outstanding integration work belong in [the implementation PR](https://github.com/BradGroux/veritas-kanban/pull/1446) and its linked follow-ups.

## Shared ownership and geometry

The task workspace must retain one mounted content tree through drawer, expanded, and chat presentation changes. `UiTaskSurface` and `UiModal` share registration, focus ownership, nested depth, and dismissal arbitration. Registration happens before paint. Drawer sizing applies to the content, not the positioning wrapper.

Each surface owns viewport bounds, scrim, active/inert state, keyboard containment, Escape, and exact-opener restoration. A child confirmation keeps its parent inert until it closes. Successive Escape presses dismiss only the active level. An exiting/reopening surface must restore the current external opener, not a previous trigger or an internal control from the exiting surface.

Task forms and confirmations use shared widths and insets, one primary scrolling body, fixed action footers, and quiet Cancel actions. Nested Preview and Conflict Resolver tools use the shared authoring-dialog presentation. Utility control bars stay outside the primary scroller. Conflict Resolver's Abort confirmation participates in the same depth provider.

## Consumer inventory

Source paths below are relative to `web/src/components/`. Keep this inventory synchronized when adding, moving, or retiring a task overlay.

| Family                        | Sources                                                                                                                   | Required interaction coverage                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Task root and chat            | `task/TaskDetailPanel.tsx`, `ui/UiOverlay.tsx` (`UiTaskSurface`)                                                          | Drawer/expanded/chat transitions retain mode, section, selected attempt, scroll, focus, unsaved edit and chat draft; closing restores the board opener.                  |
| Apply template                | `task/ApplyTemplateDialog.tsx`                                                                                            | Keyboard entry, retained fields, parent inertness, fixed footer, exact opener and operation guards.                                                                      |
| Preview                       | `task/PreviewPanel.tsx`                                                                                                   | Fixed Start/control bar, visible status/failure, child ownership and parent focus restoration.                                                                           |
| Conflict resolver and Abort   | `task/ConflictResolver.tsx`                                                                                               | Fixed utility actions, nested confirmation, successive Escape ownership and exact parent opener.                                                                         |
| Task deletion                 | `task/detail/TaskDetailsTab.tsx`                                                                                          | Pending dismissal/submission guard, visible failure, retry availability and exact opener.                                                                                |
| Task stopping                 | `task/TaskWorkView.tsx`                                                                                                   | Exact task/attempt binding, pending guard, visible failure and retry availability.                                                                                       |
| Supporting records            | `task/AttachmentsSection.tsx`, `task/CommentsSection.tsx`, `task/DeliverablesSection.tsx`, `task/ObservationsSection.tsx` | Each deletion dialog separately: fields/actions/permissions retained, pending guard, visible failure and exact opener.                                                   |
| Manual time                   | `task/TimeTrackingSection.tsx`                                                                                            | Retained draft after failure, one submission, pending dismissal guard and reachable actions.                                                                             |
| Agent stop/readiness override | `task/AgentPanel.tsx`                                                                                                     | Stop and override separately; exact routed-agent/reason or attempt binding, eligibility recheck, frozen pending controls and retained failed draft.                      |
| Approval decisions            | `task/AgentRunTimelinePanel.tsx`                                                                                          | Approve and reject separately; exact ID/revision/action hash, unclipped scope/hash, guarded pending state, visible failure and immediate switching between openers.      |
| Review merge                  | `task/ReviewPanel.tsx`                                                                                                    | Approved/worktree eligibility, exact task binding, pending guard, visible failure; completion callback only after success.                                               |
| Work products                 | `task/WorkProductsSection.tsx`, `task/ArtifactPreviewModal.tsx`                                                           | Version history, editor and each artifact format separately; scroll to final version, retain failed edit, fixed controls, refresh/navigation ownership and exact opener. |
| Git operations                | `task/git/PRDialog.tsx`, `task/git/WorktreeStatus.tsx`                                                                    | Create PR, merge and cleanup separately; exact arguments, retained drafts, pending guards and visible failures.                                                          |
| Workflows                     | `task/WorkflowSection.tsx`, `workflows/WorkflowStartDialog.tsx`                                                           | Chooser and standalone form; later-row reachability, competing-launch prevention, pending Back/dismissal guard, frozen fields, retained context and focused failure.     |
| Metrics export                | `dashboard/ExportDialog.tsx`                                                                                              | Retained scope/date filters, guarded pending state, focused visible failure, identical-query retry, exact download bytes/filename and opener restoration.                |

Do not retire compatibility wrappers until every task-path call site is accounted for. Preserve existing fields, permissions, attempt/capability checks and run/governance evidence. Non-overlay content styling across Overview, Plan, Run, Results and History remains part of #1385.

## Pending operations and failure recovery

Acquire synchronous ownership before dispatch, rather than relying exclusively on a query mutation flag that may still be stale. Submission and dismissal handlers must consult the same ownership state. Release it after settlement; keep failures in the surface and preserve the user's input. Recheck eligibility at the action boundary.

While a request is unresolved, test immediate duplicate activation, Escape, header close, backdrop, Cancel and competing actions. Include browser Back where the surface owns a history entry. A disabled control losing focus to the document must not let the board consume Escape and dismiss a parent.

Assert the actual error message and long hash/scope content are visible, not just their containing boxes. Focus error feedback without scrolling the document, then reveal it inside the primary body scroller. Keep body children from collapsing in flex layouts. Successful mocked retry, retry availability after failure and a successful real operation are different evidence boundaries; report them separately.

## Artifact formats

Text preview does not prove image or HTML behavior. Use an actual image with validated natural dimensions; test zoom and reachable footer controls. For passive HTML, inspect the existing sandbox/CSP contract, visible document content, refresh audit/request ownership and competing navigation/dismissal guards. Do not relax sandbox restrictions to make a preview render.

PDFs are downloadable deliverables only, as approved in [#1448](https://github.com/BradGroux/veritas-kanban/issues/1448) and implemented separately in [#1458](https://github.com/BradGroux/veritas-kanban/pull/1458). Verify authorized download, exact filename/bytes, explicit viewer guidance, denied-download behavior and defensive handling of older ready responses. No inline PDF renderer, automatic file opening or additional rendering dependency is required. The original blank-frame finding does not justify restoring inline rendering.

## Verification matrix

Exercise every applicable family and operation in light/dark, normal/reduced motion, normal/enlarged text, and at the minimum supported native window size. Browser diagnostics additionally cover 1700×900 at 16px, 1180×760 at 20px and 900×480 at 20px; the smaller browser case must not be mislabeled as a supported native window size.

For each applicable state:

- Enter and dismiss by keyboard; verify containment, nested active/inert state, successive Escape and exact opener.
- Scroll real content to meaningful endpoints. Compare fixed header/footer positions before and after scrolling; check both viewport containment and actual hit targets.
- Require zero horizontal surface overflow and a renderer-filling app shell. Record body/header/footer insets, text size and native dimensions.
- Exercise pending requests and failure recovery without launching providers or performing destructive operations. Keep intercepted fixtures explicit; verify request count and exact arguments.
- For root presentation changes, verify the same content node and retained mode, section, attempt, scroll, input, chat draft and keyboard focus.
- Inspect uncropped native captures for padding, clipping, labels, readable scale and empty-space regressions. File existence or a passing geometry helper alone is insufficient.

Use deterministic public-safe fixtures, an isolated authenticated profile and the real packaged application. Bind results to version, exact commit, whole-package digest, preload identity, native window dimensions, theme, text size and display scale. Retain failures and their captures. Do not overwrite or relabel earlier candidate evidence.

The shared 144-state conformance run samples routes and surfaces; it cannot replace richer task-family interaction coverage. Before closing #1444, integrate required follow-ups, including responsive and rapid-reopen focus corrections, and reconcile or rerun affected family checks against the final clean packaged candidate.

## Separate release gates

Keep raw reports and dated working ledgers in the issue/PR workflow or ignored `.veritas-kanban/internal/`, in accordance with the public documentation boundary. Archive final native reports/captures with the exact signed distribution and verify their integrity independently.

Installed-app verification, stale-documentation capture rejection, all maintained screenshot/GIF replacements and playback checks, version/changelog updates, required CI/security gates and release publication are separate requirements. Passing this contract's diagnostic subset does not complete those requirements or the broader backlog goal.

# Task overlay family acceptance

Tracking: #1444, parent #1383. Status: implementation in progress. This is not installed-app or release acceptance.

## Implementation

The task workspace retains one mounted content tree through drawer, expanded, and chat presentation changes. `UiTaskSurface` shares registration, focus ownership, nested depth, and dismissal arbitration with `UiModal`. Registration happens before paint to preserve rapid-reopen keyboard behavior. Drawer styling targets content only, not Mantine's positioning wrapper.

Task confirmations and forms use shared widths and insets, a primary scrolling body, fixed action footers, and quiet Cancel actions. Nested Preview and Conflict Resolver panels become authoring dialogs. Their control bars remain outside the primary scroller. Conflict Resolver's Abort confirmation is inside the shared depth provider, so closing it reactivates the resolver rather than the task behind it.

| Family                                            | Source                                        | Browser geometry evidence                                                                            | Packaged macOS evidence |
| ------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------- |
| Task root                                         | `TaskDetailPanel`, `UiTaskSurface`            | Expanded mode retains section, scroll, board opener                                                  | Pending                 |
| Apply template                                    | `ApplyTemplateDialog`                         | Light/dark; 1700×900 at 16px, 1180×760 and 900×480 at 20px; fixed footer, parent inert, exact opener | Pending                 |
| Preview                                           | `PreviewPanel`                                | Light/dark; 900×480 at 20px; fixed Start control and parent focus restoration                        | Pending                 |
| Conflict resolver and Abort                       | `ConflictResolver`                            | Light/dark; 900×480 at 20px; fixed Abort, nested inert parents, successive Escape ownership          | Pending                 |
| Task deletion and stopping                        | `TaskDetailsTab`, `TaskWorkView`              | Every-family checks pending                                                                          | Pending                 |
| Attachments, comments, deliverables, observations | Respective task sections                      | Every-family checks pending                                                                          | Pending                 |
| Manual time                                       | `TimeTrackingSection`                         | Every-family checks pending                                                                          | Pending                 |
| Agent stop and readiness override                 | `AgentPanel`                                  | Every-family checks pending                                                                          | Pending                 |
| Approval decisions                                | `AgentRunTimelinePanel`                       | Every-family checks pending                                                                          | Pending                 |
| Review merge                                      | `ReviewPanel`                                 | Every-family checks pending                                                                          | Pending                 |
| Work product versions, editing, artifact preview  | `WorkProductsSection`, `ArtifactPreviewModal` | Every-family checks pending                                                                          | Pending                 |
| Git PR, merge, worktree removal                   | `PRDialog`, `WorktreeStatus`                  | Every-family checks pending                                                                          | Pending                 |
| Workflows                                         | `WorkflowSection`, `WorkflowStartDialog`      | Every-family checks pending                                                                          | Pending                 |
| Task metrics export                               | `ExportDialog`                                | Every-family checks pending                                                                          | Pending                 |

## Diagnostic evidence

- Web typecheck and changed-source ESLint passed.
- `ui-overlay.test.tsx`: 12 tests passed, including three-level task/utility/confirmation ownership, exact opener restoration, retained draft DOM identity, and content-only task sizing classes.
- Seven existing task-family component slices: 59 tests passed. They cover task detail, review/preview/conflict actions, Git/workflow actions, agent/template/metrics, supporting sections, work products, and artifact previews. Component tests do not prove rendered geometry.
- `task-detail.spec.ts` expanded-workspace case passed. `task-popout-stack.spec.ts` adds template and nested-utility browser checks. Fixtures do not launch agents, start preview servers, resolve conflicts, or create managed worktrees; managed ownership exists only in intercepted browser reads.
- Independent standards and specification source reviews identified scrolling utility controls and non-quiet Cancel actions. Both were corrected and cleared on recheck. Remaining evidence gaps are explicit above.

The initial browser run exposed task container classes accidentally applied to Mantine's outer positioning layer. Content-only `classNames` fixed the collapsed workspace; the expanded-workspace browser case and a DOM-placement assertion guard it. Earlier test setup failures included an incorrect isolated API port and missing synthetic repository/managed-worktree read fixtures; these are not accepted product checks.

## Remaining acceptance

Complete every family in both themes, normal and enlarged text, minimum native window size, keyboard entry/dismissal, reduced motion, pending-operation states, and viewport/footer reachability. Rebuild the packaged application with the complete family and inspect native captures. Reconcile the consumer inventory only against that evidence. Final installed-app verification and the maintained documentation screenshots/GIF refresh remain separate, unfinished work.

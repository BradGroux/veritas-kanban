# Task overlay family acceptance

Tracking: #1444, parent #1383. Status: implementation in progress. This is not installed-app or release acceptance.

## Implementation

The task workspace retains one mounted content tree through drawer, expanded, and chat presentation changes. `UiTaskSurface` shares registration, focus ownership, nested depth, and dismissal arbitration with `UiModal`. Registration happens before paint to preserve rapid-reopen keyboard behavior. Drawer styling targets content only, not Mantine's positioning wrapper.

Task confirmations and forms use shared widths and insets, a primary scrolling body, fixed action footers, and quiet Cancel actions. Nested Preview and Conflict Resolver panels become authoring dialogs. Their control bars remain outside the primary scroller. Conflict Resolver's Abort confirmation is inside the shared depth provider, so closing it reactivates the resolver rather than the task behind it.

| Family                                            | Source                                        | Browser geometry evidence                                                                                  | Packaged macOS evidence |
| ------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------- |
| Task root                                         | `TaskDetailPanel`, `UiTaskSurface`            | Expanded mode retains section, scroll, board opener                                                        | Pending                 |
| Apply template                                    | `ApplyTemplateDialog`                         | Light/dark; 1700×900 at 16px, 1180×760 and 900×480 at 20px; fixed footer, parent inert, exact opener       | Pending                 |
| Preview                                           | `PreviewPanel`                                | Light/dark; 900×480 at 20px; fixed Start control and parent focus restoration                              | Pending                 |
| Conflict resolver and Abort                       | `ConflictResolver`                            | Light/dark; 900×480 at 20px; fixed Abort, nested inert parents, successive Escape ownership                | Pending                 |
| Task deletion                                     | `TaskDetailsTab`                              | Light/dark; three sizes; normal/reduced motion; pending dismissal and failed-request recovery              | Pending                 |
| Task stopping                                     | `TaskWorkView`                                | Every-family checks pending                                                                                | Pending                 |
| Attachments, comments, deliverables, observations | Respective task sections                      | Light/dark; three sizes; normal/reduced motion; pending dismissal and failed-request recovery              | Pending                 |
| Manual time                                       | `TimeTrackingSection`                         | Light/dark; three sizes; normal/reduced motion; pending dismissal, failed-request recovery, retained draft | Pending                 |
| Agent stop and readiness override                 | `AgentPanel`                                  | Every-family checks pending                                                                                | Pending                 |
| Approval decisions                                | `AgentRunTimelinePanel`                       | Every-family checks pending                                                                                | Pending                 |
| Review merge                                      | `ReviewPanel`                                 | Every-family checks pending                                                                                | Pending                 |
| Work product versions, editing, artifact preview  | `WorkProductsSection`, `ArtifactPreviewModal` | Light/dark; three sizes; normal/reduced motion; editor pending/failure recovery; text preview only         | Pending                 |
| Git PR, merge, worktree removal                   | `PRDialog`, `WorktreeStatus`                  | Light/dark; three sizes; normal/reduced motion; pending dismissal, retained drafts, inline failures        | Pending                 |
| Workflows                                         | `WorkflowSection`, `WorkflowStartDialog`      | Every-family checks pending                                                                                | Pending                 |
| Task metrics export                               | `ExportDialog`                                | Every-family checks pending                                                                                | Pending                 |

## Diagnostic evidence

- Web typecheck and changed-source ESLint passed.
- `ui-overlay.test.tsx`: 12 tests passed, including three-level task/utility/confirmation ownership, exact opener restoration, retained draft DOM identity, and content-only task sizing classes.
- Seven existing task-family component slices: 59 tests passed. They cover task detail, review/preview/conflict actions, Git/workflow actions, agent/template/metrics, supporting sections, work products, and artifact previews. Component tests do not prove rendered geometry.
- `task-detail.spec.ts` expanded-workspace case passed. `task-popout-stack.spec.ts` adds template and nested-utility browser checks. Fixtures do not launch agents, start preview servers, resolve conflicts, or create managed worktrees; managed ownership exists only in intercepted browser reads.
- Independent standards and specification source reviews identified scrolling utility controls and non-quiet Cancel actions. Both were corrected and cleared on recheck. Remaining evidence gaps are explicit above.

### Supporting task dialogs

`task-support-popouts.spec.ts` covers task, comment, attachment, observation, and deliverable deletion plus manual time entry. Each family is exercised in light/dark, normal/reduced motion, and 1700×900 at 16px, 1180×760 at 20px, and 900×480 at 20px. Checks cover bounded bodies, fixed/reachable footers, no horizontal overflow, keyboard opening, trapped focus, exact opener restoration, and retained task title. Delayed synthetic failed requests exercise Escape, header-close, and backdrop dismissal guards, one submission, inline error recovery, and preserved manual-time drafts. This proves retry availability, not a successful retry. No supporting-record mutation reaches the backend.

The original delayed-request test reproduced dismissal during submission. A guard based only on the query mutation's `isPending` also failed: browser instrumentation showed the request had started while the close callback still saw the previous flag. Hook-backed deletes now acquire a synchronous ref lock before calling the mutation and release it in `finally`. Their Cancel and close handlers use that same lock; errors remain visible in the dialog. Manual time and observations use their local busy state. The board keyboard handler also leaves Escape to visible modal surfaces when a disabled control loses focus to `body`.

The focused keyboard, task-detail, and supporting-section slices passed 43 tests after this change, along with web typecheck and changed-source lint. Independent specification and standards rechecks found no remaining source issue in this increment. Representative light manual-time and dark attachment captures were inspected; these are browser diagnostics, not refreshed documentation media or packaged macOS evidence.

The initial browser run exposed task container classes accidentally applied to Mantine's outer positioning layer. Content-only `classNames` fixed the collapsed workspace; the expanded-workspace browser case and a DOM-placement assertion guard it. Earlier test setup failures included an incorrect isolated API port and missing synthetic repository/managed-worktree read fixtures; these are not accepted product checks.

### Work-product dialogs

`task-product-popouts.spec.ts` exercises a 30-version history, a long Markdown editor, and a long text artifact preview in both themes and motion settings at the same three viewport/text combinations. Checks cover viewport bounds, horizontal overflow, fixed footers, actionable footer hit targets, inert parent workspace, keyboard entry, and exact opener restoration. A deferred synthetic failed save tests Escape and header-close guards, one submission, preserved Markdown, and retry availability. It does not prove a successful save. Reads and save requests are intercepted; no work product is mutated on the backend.

Measurements wait for two animation frames after viewport/font changes so textarea row recalculation settles before comparing footer positions across scrolling. The failed-save notification is explicitly dismissed before preview capture; the initial capture showed that notification obscuring the next surface even though the footer was inside the viewport. This is why hit-target checks supplement viewport checks. Text preview coverage does not establish image/PDF zoom or HTML refresh geometry. These remain pending, as does packaged macOS verification for all three dialogs.

### Git confirmations

`task-git-popouts.spec.ts` covers PR creation, merge, and worktree cleanup in both themes and motion settings at the three viewport/text combinations. Browser checks exercise footer hit targets and fixed geometry, parent inertness, exact opener restoration, Escape/header-close/backdrop attempts while pending, single submission, inline error recovery, retained PR/cleanup drafts, and exact request payloads. All Git writes are intercepted and fail synthetically; no PR, merge, or worktree removal occurs on the backend. Managed ownership is added only to intercepted reads.

All three initial pending-request cases failed: PR creation allowed Escape dismissal, while merge and cleanup closed immediately after dispatch. The handlers now acquire synchronous ref locks before dispatch, wait for completion, and release in `finally`. Controls are disabled while pending; errors remain in the dialog. Cleanup clears its reason only after success. Component tests deliberately keep mutation `isPending` false and verify duplicate prevention, retained drafts on failure, and closing after a successful mocked retry. Those unit-level successes do not prove live Git operations.

Independent specification and standards reviews found no actionable source issue in this increment. Browser captures were inspected for PR and cleanup at enlarged text/minimum size. Packaged macOS acceptance remains pending for all three.

## Remaining acceptance

Complete every family in both themes, normal and enlarged text, minimum native window size, keyboard entry/dismissal, reduced motion, pending-operation states, and viewport/footer reachability. Rebuild the packaged application with the complete family and inspect native captures. Reconcile the consumer inventory only against that evidence. Final installed-app verification and the maintained documentation screenshots/GIF refresh remain separate, unfinished work.

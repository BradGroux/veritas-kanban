# Task overlay family acceptance

Tracking: #1444, parent #1383. Status: implementation in progress. This is not installed-app or release acceptance.

## Implementation

The task workspace retains one mounted content tree through drawer, expanded, and chat presentation changes. `UiTaskSurface` shares registration, focus ownership, nested depth, and dismissal arbitration with `UiModal`. Registration happens before paint to preserve rapid-reopen keyboard behavior. Drawer styling targets content only, not Mantine's positioning wrapper.

Task confirmations and forms use shared widths and insets, a primary scrolling body, fixed action footers, and quiet Cancel actions. Nested Preview and Conflict Resolver panels become authoring dialogs. Their control bars remain outside the primary scroller. Conflict Resolver's Abort confirmation is inside the shared depth provider, so closing it reactivates the resolver rather than the task behind it.

Reduced-motion preferences make CSS transitions immediate, with no transition delay. A tiny nonzero duration on every element would introduce default `all` transitions and temporarily retain old modal widths, padding, and gaps when text size changes. Footer checks retain exact before/after-scroll geometry rather than waiting away that layout regression. Explicit keyframe animations retain their finite reduced duration for animation-event compatibility.

| Family                                            | Source                                        | Browser geometry evidence                                                                                                 | Packaged macOS evidence |
| ------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Task root                                         | `TaskDetailPanel`, `UiTaskSurface`            | Expanded mode retains section, scroll, board opener                                                                       | Pending                 |
| Create task                                       | `CreateTaskDialog`                            | Light/dark; three sizes; normal/reduced motion; pending guards, retained draft, focused failure, safe retry boundary      | Pending                 |
| Apply template                                    | `ApplyTemplateDialog`                         | Light/dark; 1700×900 at 16px, 1180×760 and 900×480 at 20px; fixed footer, parent inert, exact opener                      | Pending                 |
| Preview                                           | `PreviewPanel`                                | Light/dark; 900×480 at 20px; fixed Start control and parent focus restoration                                             | Pending                 |
| Conflict resolver and Abort                       | `ConflictResolver`                            | Light/dark; 900×480 at 20px; fixed Abort, nested inert parents, successive Escape ownership                               | Pending                 |
| Task deletion                                     | `TaskDetailsTab`                              | Light/dark; three sizes; normal/reduced motion; pending dismissal and failed-request recovery                             | Pending                 |
| Task stopping                                     | `TaskWorkView`                                | Light/dark; three sizes; normal/reduced motion; pending guards, visible failures, exact opener                            | Pending                 |
| Attachments, comments, deliverables, observations | Respective task sections                      | Light/dark; three sizes; normal/reduced motion; pending dismissal and failed-request recovery                             | Pending                 |
| Manual time                                       | `TimeTrackingSection`                         | Light/dark; three sizes; normal/reduced motion; pending dismissal, failed-request recovery, retained draft                | Pending                 |
| Agent stop and readiness override                 | `AgentPanel`                                  | Both: light/dark, three sizes, both motion settings, pending/failure recovery, retained override reason                   | Pending                 |
| Approval decisions                                | `AgentRunTimelinePanel`                       | Approve/reject: light/dark, three sizes, both motion settings, pending guards, visible failure/hash, exact bindings       | Pending                 |
| Review merge                                      | `ReviewPanel`                                 | Light/dark; three sizes; both motion settings; pending guards, focused visible failure, exact task binding                | Pending                 |
| Work product versions, editing, artifact preview  | `WorkProductsSection`, `ArtifactPreviewModal` | Light/dark; three sizes; both motion settings; text/image/HTML controls; PDF download-only workflow (#1448)               | Pending                 |
| Git PR, merge, worktree removal                   | `PRDialog`, `WorktreeStatus`                  | Light/dark; three sizes; normal/reduced motion; pending dismissal, retained drafts, inline failures                       | Pending                 |
| Workflows                                         | `WorkflowSection`, `WorkflowStartDialog`      | Chooser and start form: light/dark, three sizes, both motion settings, pending guards, visible failures, retained context | Pending                 |
| Task metrics export                               | `ExportDialog`                                | Light/dark; three sizes; normal/reduced motion; pending guards, retained filters, failed then successful fixture download | Pending                 |

## Diagnostic evidence

- Web typecheck and changed-source ESLint passed.
- `ui-overlay.test.tsx`: 12 tests passed, including three-level task/utility/confirmation ownership, exact opener restoration, retained draft DOM identity, and content-only task sizing classes.
- Seven existing task-family component slices: 59 tests passed. They cover task detail, review/preview/conflict actions, Git/workflow actions, agent/template/metrics, supporting sections, work products, and artifact previews. Component tests do not prove rendered geometry.
- `task-detail.spec.ts` expanded-workspace case passed. `task-popout-stack.spec.ts` adds template and nested-utility browser checks. Fixtures do not launch agents, start preview servers, resolve conflicts, or create managed worktrees; managed ownership exists only in intercepted browser reads.
- Independent standards and specification source reviews identified scrolling utility controls and non-quiet Cancel actions. Both were corrected and cleared on recheck. Remaining evidence gaps are explicit above.

### Create Task submission

Create Task owns submission and dismissal from the first submit event until the complete single-task or blueprint operation settles. Every form control, template control, duplicate-result action, Cancel action and close route remains disabled while pending. Failure retains the complete draft and selected template state and focuses a visible inline error. A single-task failure or a blueprint failure before any write releases the guard for deliberate retry. A partially written blueprint reports the completed count and blocks blind retry so the operator can reconcile the board first. Form and template state reset only after successful creation.

`create-task-pending.spec.ts` checks fixed-footer geometry in both themes and motion settings at 1700×900/16px, 1180×760/20px and 900×480/20px. At the compact size it also checks disabled dismissal and fields while pending, one-request ownership, a visible focused error, retained title and description, successful same-payload retry and exact opener restoration. The browser fixture accepts only the expected create endpoint; it does not create a real task, exercise a blueprint or establish packaged macOS acceptance. Component coverage checks the partial-blueprint retry block. Delivery remains under parent #1383.

### Apply Template submission

Apply Template owns submission and dismissal until both the task update and non-fatal activity logging settle. Template selection, variables, overwrite strategy and close controls stay disabled during that operation. Update failures preserve the draft and focus a visible inline error; logging failure after a successful update still completes the application. Variable input values remain stable across deferred rendering.

The verification contract includes immediate duplicate prevention, retained inputs, deliberate retry and delayed logging failure. `task-template-pending.spec.ts` checks pending and failed states in both themes and motion settings at 1700×900/16px, 1180×760/20px and 900×480/20px, with fixed/reachable footers, exact intercepted update payloads, disabled dismissal/inputs and opener restoration. Fixture-backed browser checks do not establish native utility-operation or final documentation-media acceptance. Delivery evidence is tracked in #1503.

### Preview operations

Start, Stop and Try Again share one synchronous operation guard. Competing controls and dismissal remain disabled until the request settles. Failures focus a visible inline error and release the guard for a deliberate retry without replacing the backend preview status or removing existing output and iframe behavior.

The verification contract covers immediate duplicate prevention, pending dismissal, failed Start and Stop, successful mocked retry and exact task bindings. `task-preview-pending.spec.ts` checks both themes and motion settings at 1700×900/16px, 1180×760/20px and 900×480/20px, including initial error visibility, fixed/reachable controls and opener restoration. Browser fixtures intercept preview writes and reject unexpected worktree writes; they never start or stop a real development server. Native operation acceptance remains separate. Delivery evidence is tracked in #1505.

### Conflict operations

Resolve, Continue and confirmed Abort share one synchronous operation guard. File selection, navigation, editing, competing actions and dismissal remain disabled until settlement. Abort failures stay in the nested confirmation. Other failures stay in the resolver. Both focus a visible inline error and release the guard for deliberate retry. A same-file background refresh does not replace a manual draft, and the client consumes the server's `{ aborted: true }` response shape.

The verification contract covers immediate duplicate prevention, nested pending dismissal, all three failure paths, successful mocked retries and retained manual input. `task-conflict-pending.spec.ts` checks both themes and motion settings at 1700×900/16px, 1180×760/20px and 900×480/20px, including focused errors, fixed/reachable controls, exact intercepted writes and opener restoration. Fixture-backed browser checks do not mutate real worktrees or establish packaged native operation acceptance. Delivery evidence is tracked in #1507.

### Supporting task dialogs

`task-support-popouts.spec.ts` covers task, comment, attachment, observation, and deliverable deletion plus manual time entry. Each family is exercised in light/dark, normal/reduced motion, and 1700×900 at 16px, 1180×760 at 20px, and 900×480 at 20px. Checks cover bounded bodies, fixed/reachable footers, no horizontal overflow, keyboard opening, trapped focus, exact opener restoration, and retained task title. Delayed synthetic failed requests exercise Escape, header-close, and backdrop dismissal guards, one submission, inline error recovery, and preserved manual-time drafts. This proves retry availability, not a successful retry. No supporting-record mutation reaches the backend.

The original delayed-request test reproduced dismissal during submission. A guard based only on the query mutation's `isPending` also failed: browser instrumentation showed the request had started while the close callback still saw the previous flag. Hook-backed deletes now acquire a synchronous ref lock before calling the mutation and release it in `finally`. Their Cancel and close handlers use that same lock; errors remain visible in the dialog. Manual time and observations use their local busy state. The board keyboard handler also leaves Escape to visible modal surfaces when a disabled control loses focus to `body`.

The focused keyboard, task-detail, and supporting-section slices passed 43 tests after this change, along with web typecheck and changed-source lint. Independent specification and standards rechecks found no remaining source issue in this increment. Representative light manual-time and dark attachment captures were inspected; these are browser diagnostics, not refreshed documentation media or packaged macOS evidence.

The initial browser run exposed task container classes accidentally applied to Mantine's outer positioning layer. Content-only `classNames` fixed the collapsed workspace; the expanded-workspace browser case and a DOM-placement assertion guard it. Earlier test setup failures included an incorrect isolated API port and missing synthetic repository/managed-worktree read fixtures; these are not accepted product checks.

### Work-product dialogs

`task-product-popouts.spec.ts` exercises a 30-version history, a long Markdown editor, and a long text artifact preview in both themes and motion settings at the same three viewport/text combinations. Checks cover viewport bounds, horizontal overflow, fixed footers, actionable footer hit targets, inert parent workspace, keyboard entry, and exact opener restoration. A deferred synthetic failed save tests Escape and header-close guards, one submission, preserved Markdown, and retry availability. It does not prove a successful save. Reads and save requests are intercepted; no work product is mutated on the backend.

Measurements wait for two animation frames after viewport/font changes so textarea row recalculation settles before comparing footer positions across scrolling. The failed-save notification is explicitly dismissed before preview capture; the initial capture showed that notification obscuring the next surface even though the footer was inside the viewport. This is why hit-target checks supplement viewport checks. Text preview coverage alone does not establish image zoom, PDF download controls, or HTML refresh geometry. The format-specific checks below extend browser evidence; final integrated packaged macOS verification remains pending for all three dialogs.

### Artifact formats and refresh

`task-artifact-format-popouts.spec.ts` passes eight image/HTML cases across both themes and motion settings at the three viewport/text sizes. A real 512px image and passive HTML document render visibly; checks cover fixed footer hit targets, parent inertness, exact opener restoration, synthetic downloads, image zoom controls, and pending HTML refresh/dismissal. The original HTML case reproduced an enabled Refresh during the fetch. Refresh and causal navigation now share synchronous ownership across their audits and fetch/navigation, disabling competing operations and dismissal until completion. Preview body children retain their height instead of collapsing inside the scroll container. Six component tests pass, including duplicate prevention during audit, failure recovery, successful mocked retry, and delayed navigation followed by attempted refresh. Both source reviews caught the navigation-before-refresh race; the shared ownership and delayed-navigation regression address it. Web typecheck and changed-source lint pass. The first unit attempt had a test-only document keyboard-target exception; targeting the body corrected it.

Light minimum-size HTML and dark enlarged-window image captures were inspected. These are browser diagnostics, not final documentation media. The original PDF investigation under #1448 found a valid one-page document rendered as a blank frame despite passing footer and zoom-label checks; four rendering cases were initially marked `fixme`. That failure remains historical evidence, not proof of a working viewer.

On September 4, the maintainer approved downloadable PDF deliverables instead of inline rendering. Current server responses return no PDF preview bytes, and the client handles legacy PDF preview responses without embedding them. PDF zoom controls are removed. Users choose Download and then open the file in their preferred viewer themselves; there is no automatic launch or new rendering dependency. Authenticated immutable-version downloads retain integrity, policy, quarantine, expiry, and parsing checks. Visible PDF pages are no longer an acceptance requirement.

The maintained PDF browser cases in `task-artifact-format-popouts.spec.ts` now exercise guidance, absent embeds and zoom controls, fixed/reachable Download controls, synthetic filename/completion, and exact opener restoration across both themes, both motion settings, and three viewport/text sizes; they are no longer `fixme`. [PR #1458](https://github.com/BradGroux/veritas-kanban/pull/1458) retains the browser, component/server, and older packaged-candidate diagnostic evidence, including current/legacy responses and denied downloads. These fixture-backed diagnostics do not prove live artifact registration, external-viewer launch, the final integrated candidate, or installed-app acceptance. Final native reconciliation, maintained documentation media, and release verification remain open.

### Git confirmations

`task-git-popouts.spec.ts` covers PR creation, merge, and worktree cleanup in both themes and motion settings at the three viewport/text combinations. Browser checks exercise footer hit targets and fixed geometry, parent inertness, exact opener restoration, Escape/header-close/backdrop attempts while pending, single submission, inline error recovery, retained PR/cleanup drafts, and exact request payloads. All Git writes are intercepted and fail synthetically; no PR, merge, or worktree removal occurs on the backend. Managed ownership is added only to intercepted reads.

All three initial pending-request cases failed: PR creation allowed Escape dismissal, while merge and cleanup closed immediately after dispatch. The handlers now acquire synchronous ref locks before dispatch, wait for completion, and release in `finally`. Controls are disabled while pending; errors remain in the dialog. Cleanup clears its reason only after success. Component tests deliberately keep mutation `isPending` false and verify duplicate prevention, retained drafts on failure, and closing after a successful mocked retry. Those unit-level successes do not prove live Git operations.

Independent specification and standards reviews found no actionable source issue in this increment. Browser captures were inspected for PR and cleanup at enlarged text/minimum size. Packaged macOS acceptance remains pending for all three.

### Metrics export

Export dates use inclusive UTC calendar-day bounds: From starts at 00:00:00.000Z and To ends at 23:59:59.999Z on the selected dates. The dialog states this convention. Exact-query component checks cover ordinary dates and daylight-saving transition dates; run the date slice under UTC, America/Chicago, and Asia/Tokyo to verify independence from the host timezone.

`task-export-popout.spec.ts` opens export from task History/Metrics and tests both themes and motion settings at the three viewport/text combinations. It checks fixed footer geometry and hit targets, viewport containment, nested inert state, guarded Escape/header/backdrop dismissal, disabled filters while exporting, retained filters after failure, and a successful synthetic download on retry with an identical query and exact opener restoration. The retry uses a response with no filename header and verifies the generic fallback name. No real telemetry export is performed.

The original browser case reproduced dismissal while the request was pending. Export now uses a synchronous submission/dismissal lock, exposes an inline error, and preserves scope/date filters on failure. The error receives focus without native scrolling and is then centered in the primary scroller; focus alone left its bottom edge clipped at minimum size. Browser and component checks verify the focus/scroll behavior. The component regression also tests immediate duplicate submission and restored Cancel availability.

All four browser cases passed, along with five focused component tests, web typecheck, changed-source lint, and formatting. Light and dark minimum-size captures were inspected. Both independent source review axes cleared the final change. These are browser diagnostics, not packaged macOS or documentation-media acceptance.

The first download check exposed a separate transport defect: cross-origin responses do not expose `Content-Disposition`, so the app falls back to a generic name despite the server sending a scoped filename. This is tracked in #1447 and is not fixed by the overlay increment. Workflow and native acceptance remain pending.

### Task workflow chooser

`task-workflow-popout.spec.ts` exercises a 12-workflow list through task Run/Workflow in both themes and motion settings at the same three viewport/text sizes. It verifies reachable row actions, fixed header close control, viewport containment, no horizontal overflow, inert task parent, pending Escape/header/backdrop/Back guards, disabled competing Start actions, one exact launch request, fully visible focused failure feedback, restored action availability, and exact opener restoration after dismissal. All workflow reads/writes are intercepted; the launch fails synthetically and no workflow executes. Successful retry and the separate workflow-start form are not established by this test.

The unit regression reproduced two launches from competing Start clicks while the first was unresolved. The browser regression reproduced Escape dismissal before the response. A synchronous guard now owns both launch and dismissal, including restoring the chooser history entry after Back during a pending request. Failure remains inline and scrolls into view; the lock releases in `finally`. The 13-test Git/workflow component slice, web typecheck, and changed-source lint passed. Four final browser cases passed. Geometry measurements wait for font sizing and active transitions to settle before comparing positions across scrolling; initial transition measurements were not accepted as product failures.

Light normal-motion and dark reduced-motion failure captures were inspected at 900×480 with 20px text. They are diagnostic captures, not documentation media or native acceptance. Both source review axes found no actionable issue in this increment.

### Workflow start form

`workflow-start-popout.spec.ts` opens the form from Workflows and exercises both themes/motion settings at the three viewport/text sizes. Fixed footers and hit targets, pending disabled fields/close/Cancel, Escape/backdrop guards, retained task/context input, exact request body, visible focused failure content, and exact opener restoration pass. All workflow requests are intercepted; no workflow is started. The two-test component slice covers invalid JSON-object context, immediate duplicate submission, failure preservation, and successful mocked retry. Web typecheck, changed-source lint, and formatting passed.

The first browser check reproduced editable fields during the unresolved request. Those fields now freeze while pending; a synchronous lock protects submission and dismissal. Errors focus and scroll into view. Screenshot inspection then caught an alert whose root was in the viewport but whose message was clipped by flex shrinking. `shrink-0` preserves the alert's content height, and the browser now asserts the actual error message is fully visible. The stronger assertion failed before that correction; all four final browser cases passed afterward. Normal-motion closure checks wait for the exiting dialog to finish and identify the original button by its title, not a label shared with the submit button.

Final light normal-motion and dark reduced-motion captures were inspected at minimum size/enlarged text. Both source review axes cleared the final correction. Native acceptance remains pending for both workflow surfaces.

### Stop confirmations

`task-stop-popouts.spec.ts` covers Overview and Agent stop confirmations in both themes and motion settings at the same three viewport/text sizes. All eight cases pass: bounded content, fixed and reachable footer actions, inert task parent, pending Escape/header/backdrop guards, disabled Cancel, one exact task/attempt request, fully visible failure text, retry availability, and exact opener restoration. All stop requests are intercepted and fail synthetically; no running agent is stopped.

Both initial browser cases reproduced immediate dismissal after dispatch. Both handlers now await the response under a synchronous submission/dismissal lock, retain inline failures, and release the lock in `finally`. Existing attempt/capability checks and client permission gates remain enforced. The two component slices pass 30 tests, including immediate duplicate prevention and successful mocked retries while mutation `isPending` deliberately remains false. Web typecheck, changed-source lint, formatting, and both independent source review axes passed. Light Overview and dark Agent minimum-size failure captures were inspected. These are browser diagnostics, not native or maintained documentation-media acceptance. Readiness override remains pending.

### Approval decisions

`task-approval-popouts.spec.ts` covers approval and rejection with 25 resource-scope entries in both themes and motion settings at the three viewport/text sizes. All eight cases pass, including fixed/reachable footer controls, inert parent, pending Escape/header/backdrop guards, one exact decision request, focused fully visible failure text, retry availability, and exact opener restoration. Browser requests fail synthetically; no real approval or rejection is sent. The 12-test component slice passes, including failure followed by successful mocked retry with the identical approval ID, revision, action hash, and decision.

The initial component regressions reproduced dismissal while each decision was pending. A synchronous lock now owns submission/dismissal until settlement. Failures are caught and retained inline rather than escaping the event handler. Screenshot inspection caught a second defect: the action hash was vertically clipped by flex shrinking despite passing error/footer checks. A stronger browser assertion reproduced 22px of clipping; direct body children now retain their content height inside the primary scroller. All eight cases passed after that correction. Light approval and dark rejection failure captures were inspected at minimum size/enlarged text. Web typecheck, changed-source lint, formatting, and both independent source review axes passed. Native acceptance remains pending.

### Readiness override

`task-readiness-popout.spec.ts` passes all four theme/motion combinations at the three viewport/text sizes. It verifies minimum reason length, exact trimmed reason and routed-agent payload, fixed/reachable footers, fully visible textarea, pending disabled reason/Cancel, Escape/header/backdrop guards, retained draft, focused visible failure, retry availability, and exact opener restoration. Routing and launch responses are intercepted; no provider launches. The first browser run failed during seed validation because the synthetic agent was not registered; the corrected fixture mocks routing without changing the registry.

The component regression first reproduced an editable reason during launch. The shared start handler now takes synchronous ownership, rechecks current launch eligibility, waits for completion, retains inline override failures, and clears the reason only after success. Direct ready launches retain the same payload and show failures as a toast. The 13-test component slice and a subsequent focused permission-revocation test passed, along with web typecheck, changed-source lint, formatting, and both source review axes. Light normal-motion and dark reduced-motion minimum-size captures were inspected. These are browser diagnostics; native acceptance remains pending.

### Review merge

`task-review-merge-popout.spec.ts` passes all four theme/motion combinations at the three viewport/text sizes. It checks fixed/reachable footer actions, inert parent, pending Escape/header/backdrop guards, disabled Cancel, one exact merge request, focused fully visible failure, retry availability, and exact opener restoration. Approved review and managed ownership exist only in intercepted task reads; merge writes fail synthetically. No Git merge, task completion, or worktree deletion occurs.

The initial component regression reproduced immediate dismissal after dispatch. The handler now synchronously owns the pending request, rechecks approved/worktree eligibility, catches inline errors, and invokes completion only after a successful response. Eight component tests passed, including failure without completion and successful mocked retry, along with web typecheck, changed-source lint, formatting, and both source review axes. Light normal-motion and dark reduced-motion captures were inspected at minimum size/enlarged text. Native acceptance remains pending.

## Remaining acceptance

Shared loading buttons retain a static centering transform when reduced-motion transitions omit their styles. Normal-motion transitions continue to own their animated transform. The HTML artifact Refresh regression checks a held request at normal and enlarged text sizes, requiring the loading indicator to remain centered and fully inside its button. The original packaged-candidate clipping remains historical evidence; fresh affected native verification is required after integration and rebuilding.

Complete every family in both themes, normal and enlarged text, minimum native window size, keyboard entry/dismissal, reduced motion, pending-operation states, and viewport/footer reachability. Rebuild the packaged application with the complete family and inspect native captures. Reconcile the consumer inventory only against that evidence. Final installed-app verification and the maintained documentation screenshots/GIF refresh remain separate, unfinished work.

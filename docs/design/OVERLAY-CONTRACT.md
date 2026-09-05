# Shared popout contract

Tracking: #1383; foundation and Template family slice #1401. Status: accepted for v6.1.7 in both the packaged candidate and the Homebrew-installed app. The inventory below preserves the original audit snapshot; final reconciliation and evidence follow it.

## Geometry

All values scale with the root text size. Header inset is 1rem horizontally and 0.625rem vertically, minimum height 3.5rem. Body and footer insets and section gaps are 1rem. The close target is 2.125rem square, with one accessible name, a Close tooltip, and the shared visible focus treatment. Header, body, and footer use the same background and border tokens.

| Variant   | Maximum width | Presentation                  |
| --------- | ------------- | ----------------------------- |
| confirm   | 28rem         | Centered confirmation         |
| form      | 36rem         | Centered form                 |
| authoring | 65rem         | Centered multi-section editor |
| utility   | 38rem         | Right-side panel              |
| task      | 60rem         | Task workspace                |
| chat      | 31rem         | Chat panel                    |

Ordinary dialogs clamp to the viewport minus 1rem on each edge. Utility panels occupy the available height. Compound layouts use one primary `vk-overlay-scroll` region and a non-scrolling `OverlayFooter`; feature code must not subtract guessed header heights from the viewport. A utility panel opened inside a dialog is presented as a centered authoring dialog instead of stacking arbitrary drawers.

The shared provider registers only open overlays, removes unmounted entries, and gives Escape, outside-click, and focus trapping to the top entry. Inactive parents remain visible behind the scrim but are inert. Shared overlays require the default portal so a child cannot inherit its parent's inert subtree. Closing a child returns focus to its trigger after the parent trap reactivates. Form data remains owned by feature components. Explicit Escape guards remain respected. Entire parent/child families must migrate together; raw legacy children are not members of this stack.

## Consumer inventory

The task-family migration in #1444 is tracked in [Task overlay family acceptance](TASK-OVERLAY-ACCEPTANCE.md). The table records the state when the audit opened. Its `pending` labels are historical and must not be read as the current release state.

Line numbers identify the audited opening and may move during migration. A shared primitive alone does not prove the feature's inner scroll, spacing, or keyboard behavior. Each row remains subject to rendered acceptance.

| Consumer                                                                                          | Opening line | Intended variant | Status                                               |
| ------------------------------------------------------------------------------------------------- | -----------: | ---------------- | ---------------------------------------------------- |
| [TemplateEditorDialog.tsx](../../web/src/components/templates/TemplateEditorDialog.tsx)           |          188 | authoring        | Shared primitive adopted; runtime acceptance pending |
| [TemplatesPage.tsx](../../web/src/components/templates/TemplatesPage.tsx)                         |          274 | confirm          | Shared primitive adopted; runtime acceptance pending |
| [TemplatesPage.tsx](../../web/src/components/templates/TemplatesPage.tsx)                         |          298 | form             | Shared primitive adopted; runtime acceptance pending |
| [SearchDialog.tsx](../../web/src/components/search/SearchDialog.tsx)                              |          282 | authoring        | Shared geometry; browser/native passed #1440         |
| [AdmissionQueuePanel.tsx](../../web/src/components/digest/AdmissionQueuePanel.tsx)                |          315 | form             | Migration pending                                    |
| [WorkflowStartDialog.tsx](../../web/src/components/workflows/WorkflowStartDialog.tsx)             |           71 | form             | Migration pending; migrate with nested consumers     |
| [CreateTaskDialog.tsx](../../web/src/components/task/CreateTaskDialog.tsx)                        |          267 | form             | Migration pending; migrate with nested consumers     |
| [PolicyManager.tsx](../../web/src/components/policies/PolicyManager.tsx)                          |          552 | authoring        | Shared modal; runtime acceptance pending in #1423    |
| [PolicyManager.tsx](../../web/src/components/policies/PolicyManager.tsx)                          |          906 | form             | Shared modal; runtime acceptance pending in #1423    |
| [TimeTrackingSection.tsx](../../web/src/components/task/TimeTrackingSection.tsx)                  |          243 | form             | Migration pending                                    |
| [BulkActionsBar.tsx](../../web/src/components/board/BulkActionsBar.tsx)                           |          366 | confirm          | Migration pending                                    |
| [ArchiveSuggestionBanner.tsx](../../web/src/components/board/ArchiveSuggestionBanner.tsx)         |           92 | confirm          | Migration pending                                    |
| [ConflictResolver.tsx](../../web/src/components/task/ConflictResolver.tsx)                        |          124 | utility          | Migration pending                                    |
| [ConflictResolver.tsx](../../web/src/components/task/ConflictResolver.tsx)                        |          383 | confirm          | Migration pending                                    |
| [FilterBar.tsx](../../web/src/components/board/FilterBar.tsx)                                     |          349 | form             | Migration pending                                    |
| [FilterBar.tsx](../../web/src/components/board/FilterBar.tsx)                                     |          374 | confirm          | Migration pending                                    |
| [ChatPanel.tsx](../../web/src/components/chat/ChatPanel.tsx)                                      |          279 | chat             | Migration pending; migrate with nested consumers     |
| [ChatPanel.tsx](../../web/src/components/chat/ChatPanel.tsx)                                      |          297 | confirm          | Migration pending; migrate with nested consumers     |
| [TaskWorkView.tsx](../../web/src/components/task/TaskWorkView.tsx)                                |         1055 | confirm          | Migration pending                                    |
| [ObservationsSection.tsx](../../web/src/components/task/ObservationsSection.tsx)                  |          118 | confirm          | Migration pending                                    |
| [SquadChatPanel.tsx](../../web/src/components/chat/SquadChatPanel.tsx)                            |          522 | chat             | Migration pending; migrate with nested consumers     |
| [ReviewPanel.tsx](../../web/src/components/task/ReviewPanel.tsx)                                  |          212 | form             | Migration pending                                    |
| [ArtifactPreviewModal.tsx](../../web/src/components/task/ArtifactPreviewModal.tsx)                |          112 | authoring        | Migration pending                                    |
| [CommandPalette.tsx](../../web/src/components/layout/CommandPalette.tsx)                          |          293 | form             | Shared geometry; browser/native passed #1440         |
| [SettingsDialog.tsx](../../web/src/components/settings/SettingsDialog.tsx)                        |          529 | authoring        | Shared geometry; browser/native passed #1436         |
| [SettingsDialog.tsx](../../web/src/components/settings/SettingsDialog.tsx)                        |          739 | confirm          | Shared geometry; browser/native passed #1436         |
| [PRDialog.tsx](../../web/src/components/task/git/PRDialog.tsx)                                    |           36 | authoring        | Migration pending                                    |
| [ActivitySidebar.tsx](../../web/src/components/layout/ActivitySidebar.tsx)                        |          244 | utility          | Migration pending                                    |
| [SortableListItem.tsx](../../web/src/components/settings/SortableListItem.tsx)                    |          171 | confirm          | Shared geometry; browser/native passed #1436         |
| [WorktreeStatus.tsx](../../web/src/components/task/git/WorktreeStatus.tsx)                        |          374 | form             | Migration pending                                    |
| [WorktreeStatus.tsx](../../web/src/components/task/git/WorktreeStatus.tsx)                        |          404 | confirm          | Migration pending                                    |
| [TaskDetailsTab.tsx](../../web/src/components/task/detail/TaskDetailsTab.tsx)                     |          254 | confirm          | Migration pending                                    |
| [KeyboardShortcutsDialog.tsx](../../web/src/components/layout/KeyboardShortcutsDialog.tsx)        |           49 | form             | Shared geometry; browser/native passed #1440         |
| [ArchiveSidebar.tsx](../../web/src/components/layout/ArchiveSidebar.tsx)                          |          240 | utility          | Migration pending                                    |
| [MobileShell.tsx](../../web/src/components/layout/MobileShell.tsx)                                |          129 | utility          | Migration pending                                    |
| [ApplyTemplateDialog.tsx](../../web/src/components/task/ApplyTemplateDialog.tsx)                  |          305 | authoring        | Migration pending                                    |
| [PreviewPanel.tsx](../../web/src/components/task/PreviewPanel.tsx)                                |           71 | utility          | Migration pending; migrate with nested consumers     |
| [AttachmentsSection.tsx](../../web/src/components/task/AttachmentsSection.tsx)                    |          172 | confirm          | Migration pending                                    |
| [SectionHeader.tsx](../../web/src/components/settings/shared/SectionHeader.tsx)                   |           66 | confirm          | Shared geometry; browser/native passed #1436         |
| [DesktopOnboarding.tsx](../../web/src/components/auth/DesktopOnboarding.tsx)                      |          711 | authoring        | Migration pending                                    |
| [AgentRunTimelinePanel.tsx](../../web/src/components/task/AgentRunTimelinePanel.tsx)              |         1373 | form             | Migration pending                                    |
| [DeliverablesSection.tsx](../../web/src/components/task/DeliverablesSection.tsx)                  |          272 | confirm          | Migration pending                                    |
| [DrillDownPanel.tsx](../../web/src/components/dashboard/DrillDownPanel.tsx)                       |           14 | utility          | Migration pending                                    |
| [WorkflowSection.tsx](../../web/src/components/task/WorkflowSection.tsx)                          |          266 | authoring        | Migration pending                                    |
| [CommentsSection.tsx](../../web/src/components/task/CommentsSection.tsx)                          |          190 | confirm          | Migration pending                                    |
| [TaskDetailPanel.tsx](../../web/src/components/task/TaskDetailPanel.tsx)                          |          271 | task             | Migration pending                                    |
| [sheet.tsx](../../web/src/components/ui/sheet.tsx)                                                |          147 | utility          | Migration pending                                    |
| [alert-dialog.tsx](../../web/src/components/ui/alert-dialog.tsx)                                  |          136 | form             | Migration pending                                    |
| [WorkProductsSection.tsx](../../web/src/components/task/WorkProductsSection.tsx)                  |          504 | authoring        | Migration pending                                    |
| [WorkProductsSection.tsx](../../web/src/components/task/WorkProductsSection.tsx)                  |          551 | authoring        | Migration pending                                    |
| [AgentPanel.tsx](../../web/src/components/task/AgentPanel.tsx)                                    |          630 | confirm          | Migration pending                                    |
| [AgentPanel.tsx](../../web/src/components/task/AgentPanel.tsx)                                    |          661 | form             | Migration pending                                    |
| [dialog.tsx](../../web/src/components/ui/dialog.tsx)                                              |          157 | form             | Migration pending                                    |
| [ExportDialog.tsx](../../web/src/components/dashboard/ExportDialog.tsx)                           |          106 | form             | Migration pending                                    |
| [SkillRiskDashboardPanel.tsx](../../web/src/components/settings/tabs/SkillRiskDashboardPanel.tsx) |          339 | form             | Shared geometry; browser/native passed #1436         |
| [ToolPoliciesTab.tsx](../../web/src/components/settings/tabs/ToolPoliciesTab.tsx)                 |          269 | authoring        | Shared geometry; browser/native passed #1436         |
| [GeneralTab.tsx](../../web/src/components/settings/tabs/GeneralTab.tsx)                           |          404 | confirm          | Shared geometry; browser/native passed #1436         |
| [TemplateComponents.tsx](../../web/src/components/settings/tabs/TemplateComponents.tsx)           |          252 | confirm          | Shared geometry; browser/native passed #1436         |
| [SecurityTab.tsx](../../web/src/components/settings/tabs/SecurityTab.tsx)                         |          174 | confirm          | Shared geometry; browser/native passed #1436         |
| [AgentsTab.tsx](../../web/src/components/settings/tabs/AgentsTab.tsx)                             |         2331 | confirm          | Shared geometry; browser/native passed #1436         |
| [MaintenanceTab.tsx](../../web/src/components/settings/tabs/MaintenanceTab.tsx)                   |          590 | form             | Shared geometry; browser/native passed #1436         |

## Final reconciliation

The required desktop consumer families now use the shared `UiModal`, `UiTaskSurface`, and overlay primitives: Settings and its confirmations, Create Task, Templates, Search, Command Palette, the task workspace and nested task forms, Task Chat, artifact Preview, workflow dialogs, policy dialogs, and confirmations. The task workspace keeps one mounted content tree across drawer and expanded presentations. Workbench chat remains a non-modal right dock with the shared header/composer spacing and no bottom-dock presentation.

The original inventory also found raw Mantine roots outside that required nested desktop family. `DrillDownPanel`, `AdmissionQueuePanel`, and `DesktopOnboarding` retain their existing standalone presentation; this acceptance does not falsely claim that they were migrated. The mobile notification drawer remains an intentional bottom-sheet exception. Compatibility wrappers in `ui/dialog.tsx`, `ui/alert-dialog.tsx`, and `ui/sheet.tsx` remain for isolated compatibility tests and have no production imports.

## Acceptance surface

Open `?ui-gallery=1` and use the Popout geometry cards. Each variant opens the actual shared component with a long scrolling body, fixed footer, and nested confirmation. `e2e/popout-contract.spec.ts` checks bounds, scaled insets, state retention, Escape, and focus restoration in dark/light themes at 1180×760 and 900×480 with increased text size.

Final signed capture run [`33926469724`](https://github.com/BradGroux/veritas-kanban/actions/runs/33926469724) passed all 144 packaged macOS states and detected all six seeded defects from exact build commit `ed5094c6a5f9dd6958ceb952d8d018a40135bf33`. The matrix records computed overlay padding, route geometry, compact-shell behavior, Workbench chat, task drawer/expanded/chat presentations, Preview, confirmations, and functional controls in both themes at 1700×760 and 1180×760. The 14 maintained screenshots and GIFs were captured from that candidate and published in commit `6befd39cbc1264b18fa272d25bc64642f2b60383`. Browser evidence and native evidence remain distinct; both passed their declared scopes.

The separate Homebrew-installed check passed after explicit operator approval
of macOS's first-launch confirmation. At 1180×760 in both themes, Board Chat,
Squad Chat, the compact Squad actions popover, sender selection, and composers
remained contained. Opening a rail closed Workbench, and opening Workbench
collapsed both rails. A non-sent Squad Chat draft survived channel switching
and wide-to-compact resizing; the resize did not send the draft or recreate the
three-panel squeeze. Fullscreen exit and a quit/relaunch at the saved minimum
size restored the compact state with Workbench and both rails closed. This
installed-app evidence completes #1383 and the umbrella #1389; it supplements
rather than replaces the commit-bound packaged-candidate matrix above.

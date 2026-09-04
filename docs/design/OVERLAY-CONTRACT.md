# Shared popout contract

Tracking: #1383; foundation and Template family slice #1401. This is an implementation inventory, not a completion claim. Native acceptance and remaining consumer migrations are still required.

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

Line numbers identify the audited opening and may move during migration. A shared primitive alone does not prove the feature's inner scroll, spacing, or keyboard behavior. Each row remains subject to rendered acceptance.

| Consumer                                                                                          | Opening line | Intended variant | Status                                                |
| ------------------------------------------------------------------------------------------------- | -----------: | ---------------- | ----------------------------------------------------- |
| [TemplateEditorDialog.tsx](../../web/src/components/templates/TemplateEditorDialog.tsx)           |          188 | authoring        | Shared primitive adopted; runtime acceptance pending  |
| [TemplatesPage.tsx](../../web/src/components/templates/TemplatesPage.tsx)                         |          274 | confirm          | Shared primitive adopted; runtime acceptance pending  |
| [TemplatesPage.tsx](../../web/src/components/templates/TemplatesPage.tsx)                         |          298 | form             | Shared primitive adopted; runtime acceptance pending  |
| [SearchDialog.tsx](../../web/src/components/search/SearchDialog.tsx)                              |          282 | authoring        | Migration pending; migrate with nested consumers      |
| [AdmissionQueuePanel.tsx](../../web/src/components/digest/AdmissionQueuePanel.tsx)                |          315 | form             | Migration pending                                     |
| [WorkflowStartDialog.tsx](../../web/src/components/workflows/WorkflowStartDialog.tsx)             |           71 | form             | Migration pending; migrate with nested consumers      |
| [CreateTaskDialog.tsx](../../web/src/components/task/CreateTaskDialog.tsx)                        |          267 | form             | Migration pending; migrate with nested consumers      |
| [PolicyManager.tsx](../../web/src/components/policies/PolicyManager.tsx)                          |          552 | authoring        | Shared modal; runtime acceptance pending in #1423     |
| [PolicyManager.tsx](../../web/src/components/policies/PolicyManager.tsx)                          |          906 | form             | Shared modal; runtime acceptance pending in #1423     |
| [TimeTrackingSection.tsx](../../web/src/components/task/TimeTrackingSection.tsx)                  |          243 | form             | Migration pending                                     |
| [BulkActionsBar.tsx](../../web/src/components/board/BulkActionsBar.tsx)                           |          366 | confirm          | Migration pending                                     |
| [ArchiveSuggestionBanner.tsx](../../web/src/components/board/ArchiveSuggestionBanner.tsx)         |           92 | confirm          | Migration pending                                     |
| [ConflictResolver.tsx](../../web/src/components/task/ConflictResolver.tsx)                        |          124 | utility          | Migration pending                                     |
| [ConflictResolver.tsx](../../web/src/components/task/ConflictResolver.tsx)                        |          383 | confirm          | Migration pending                                     |
| [FilterBar.tsx](../../web/src/components/board/FilterBar.tsx)                                     |          349 | form             | Migration pending                                     |
| [FilterBar.tsx](../../web/src/components/board/FilterBar.tsx)                                     |          374 | confirm          | Migration pending                                     |
| [ChatPanel.tsx](../../web/src/components/chat/ChatPanel.tsx)                                      |          279 | chat             | Migration pending; migrate with nested consumers      |
| [ChatPanel.tsx](../../web/src/components/chat/ChatPanel.tsx)                                      |          297 | confirm          | Migration pending; migrate with nested consumers      |
| [TaskWorkView.tsx](../../web/src/components/task/TaskWorkView.tsx)                                |         1055 | confirm          | Migration pending                                     |
| [ObservationsSection.tsx](../../web/src/components/task/ObservationsSection.tsx)                  |          118 | confirm          | Migration pending                                     |
| [SquadChatPanel.tsx](../../web/src/components/chat/SquadChatPanel.tsx)                            |          522 | chat             | Migration pending; migrate with nested consumers      |
| [ReviewPanel.tsx](../../web/src/components/task/ReviewPanel.tsx)                                  |          212 | form             | Migration pending                                     |
| [ArtifactPreviewModal.tsx](../../web/src/components/task/ArtifactPreviewModal.tsx)                |          112 | authoring        | Migration pending                                     |
| [CommandPalette.tsx](../../web/src/components/layout/CommandPalette.tsx)                          |          293 | form             | Migration pending; migrate with nested consumers      |
| [SettingsDialog.tsx](../../web/src/components/settings/SettingsDialog.tsx)                        |          529 | authoring        | Shared geometry; browser passed; native pending #1436 |
| [SettingsDialog.tsx](../../web/src/components/settings/SettingsDialog.tsx)                        |          739 | confirm          | Shared geometry; browser passed; native pending #1436 |
| [PRDialog.tsx](../../web/src/components/task/git/PRDialog.tsx)                                    |           36 | authoring        | Migration pending                                     |
| [ActivitySidebar.tsx](../../web/src/components/layout/ActivitySidebar.tsx)                        |          244 | utility          | Migration pending                                     |
| [SortableListItem.tsx](../../web/src/components/settings/SortableListItem.tsx)                    |          171 | confirm          | Shared geometry; browser passed; native pending #1436 |
| [WorktreeStatus.tsx](../../web/src/components/task/git/WorktreeStatus.tsx)                        |          374 | form             | Migration pending                                     |
| [WorktreeStatus.tsx](../../web/src/components/task/git/WorktreeStatus.tsx)                        |          404 | confirm          | Migration pending                                     |
| [TaskDetailsTab.tsx](../../web/src/components/task/detail/TaskDetailsTab.tsx)                     |          254 | confirm          | Migration pending                                     |
| [KeyboardShortcutsDialog.tsx](../../web/src/components/layout/KeyboardShortcutsDialog.tsx)        |           49 | form             | Migration pending                                     |
| [ArchiveSidebar.tsx](../../web/src/components/layout/ArchiveSidebar.tsx)                          |          240 | utility          | Migration pending                                     |
| [MobileShell.tsx](../../web/src/components/layout/MobileShell.tsx)                                |          129 | utility          | Migration pending                                     |
| [ApplyTemplateDialog.tsx](../../web/src/components/task/ApplyTemplateDialog.tsx)                  |          305 | authoring        | Migration pending                                     |
| [PreviewPanel.tsx](../../web/src/components/task/PreviewPanel.tsx)                                |           71 | utility          | Migration pending; migrate with nested consumers      |
| [AttachmentsSection.tsx](../../web/src/components/task/AttachmentsSection.tsx)                    |          172 | confirm          | Migration pending                                     |
| [SectionHeader.tsx](../../web/src/components/settings/shared/SectionHeader.tsx)                   |           66 | confirm          | Shared geometry; browser passed; native pending #1436 |
| [DesktopOnboarding.tsx](../../web/src/components/auth/DesktopOnboarding.tsx)                      |          711 | authoring        | Migration pending                                     |
| [AgentRunTimelinePanel.tsx](../../web/src/components/task/AgentRunTimelinePanel.tsx)              |         1373 | form             | Migration pending                                     |
| [DeliverablesSection.tsx](../../web/src/components/task/DeliverablesSection.tsx)                  |          272 | confirm          | Migration pending                                     |
| [DrillDownPanel.tsx](../../web/src/components/dashboard/DrillDownPanel.tsx)                       |           14 | utility          | Migration pending                                     |
| [WorkflowSection.tsx](../../web/src/components/task/WorkflowSection.tsx)                          |          266 | authoring        | Migration pending                                     |
| [CommentsSection.tsx](../../web/src/components/task/CommentsSection.tsx)                          |          190 | confirm          | Migration pending                                     |
| [TaskDetailPanel.tsx](../../web/src/components/task/TaskDetailPanel.tsx)                          |          271 | task             | Migration pending                                     |
| [sheet.tsx](../../web/src/components/ui/sheet.tsx)                                                |          147 | utility          | Migration pending                                     |
| [alert-dialog.tsx](../../web/src/components/ui/alert-dialog.tsx)                                  |          136 | form             | Migration pending                                     |
| [WorkProductsSection.tsx](../../web/src/components/task/WorkProductsSection.tsx)                  |          504 | authoring        | Migration pending                                     |
| [WorkProductsSection.tsx](../../web/src/components/task/WorkProductsSection.tsx)                  |          551 | authoring        | Migration pending                                     |
| [AgentPanel.tsx](../../web/src/components/task/AgentPanel.tsx)                                    |          630 | confirm          | Migration pending                                     |
| [AgentPanel.tsx](../../web/src/components/task/AgentPanel.tsx)                                    |          661 | form             | Migration pending                                     |
| [dialog.tsx](../../web/src/components/ui/dialog.tsx)                                              |          157 | form             | Migration pending                                     |
| [ExportDialog.tsx](../../web/src/components/dashboard/ExportDialog.tsx)                           |          106 | form             | Migration pending                                     |
| [SkillRiskDashboardPanel.tsx](../../web/src/components/settings/tabs/SkillRiskDashboardPanel.tsx) |          339 | form             | Shared geometry; browser passed; native pending #1436 |
| [ToolPoliciesTab.tsx](../../web/src/components/settings/tabs/ToolPoliciesTab.tsx)                 |          269 | authoring        | Shared geometry; browser passed; native pending #1436 |
| [GeneralTab.tsx](../../web/src/components/settings/tabs/GeneralTab.tsx)                           |          404 | confirm          | Shared geometry; browser passed; native pending #1436 |
| [TemplateComponents.tsx](../../web/src/components/settings/tabs/TemplateComponents.tsx)           |          252 | confirm          | Shared geometry; browser passed; native pending #1436 |
| [SecurityTab.tsx](../../web/src/components/settings/tabs/SecurityTab.tsx)                         |          174 | confirm          | Shared geometry; browser passed; native pending #1436 |
| [AgentsTab.tsx](../../web/src/components/settings/tabs/AgentsTab.tsx)                             |         2331 | confirm          | Shared geometry; browser passed; native pending #1436 |
| [MaintenanceTab.tsx](../../web/src/components/settings/tabs/MaintenanceTab.tsx)                   |          590 | form             | Shared geometry; browser passed; native pending #1436 |

The mobile notification drawer is a deliberate bottom-sheet exception; it still needs matching spacing and keyboard checks. Compatibility wrappers in `ui/dialog.tsx`, `ui/alert-dialog.tsx`, and `ui/sheet.tsx` remain inventoried above where they instantiate roots; their public call sites must not be silently treated as migrated. Docked Workbench chat is not a modal and must keep its non-modal focus model while adopting the same header/composer spacing.

## Acceptance surface

Open `?ui-gallery=1` and use the Popout geometry cards. Each variant opens the actual shared component with a long scrolling body, fixed footer, and nested confirmation. `e2e/popout-contract.spec.ts` checks bounds, scaled insets, state retention, Escape, and focus restoration in dark/light themes at 1180×760 and 900×480 with increased text size. Browser checks do not replace rebuilt packaged macOS captures. Those captures, every production-consumer check, and the final documentation media refresh remain pending.

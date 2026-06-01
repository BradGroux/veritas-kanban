# v5 Mantine Migration Plan

## Status

Planned for v5.0. This document is the migration contract for moving the web,
desktop, mobile/PWA, workflow, governance, and admin surfaces onto Mantine UI.

The goal is not a cosmetic rewrite. The goal is one coherent UI foundation for
new v5 surfaces while keeping Veritas-specific experiences where generic
component primitives are not the right abstraction.

## Current Inventory

The current web app uses React, Vite, Tailwind, Mantine-backed compatibility
wrappers, lucide icons, custom CSS tokens in `web/src/globals.css`, and
product-specific feature components.

Current shared primitive usage:

| Primitive                         | Current state                                            | Observed use |
| --------------------------------- | -------------------------------------------------------- | ------------ |
| `button`                          | Mantine Button/ActionIcon wrapper with local Slot helper | 73 imports   |
| `input`                           | Mantine Input compatibility wrapper                      | 41 imports   |
| `select`                          | Mantine Select compatibility wrapper                     | 39 imports   |
| `label`                           | Mantine Box label compatibility wrapper                  | 36 imports   |
| `badge`                           | Mantine Badge wrapper with local Slot helper             | 36 imports   |
| `textarea`                        | Mantine Textarea compatibility wrapper                   | 20 imports   |
| `skeleton`                        | Mantine Skeleton compatibility wrapper                   | 18 imports   |
| `alert-dialog`                    | Mantine Modal compatibility wrapper                      | 18 imports   |
| `scroll-area`                     | Mantine ScrollArea compatibility wrapper                 | 13 imports   |
| `dialog`                          | Mantine Modal compatibility wrapper                      | 13 imports   |
| `tabs`                            | Mantine Tabs compatibility wrapper                       | 9 imports    |
| `checkbox`                        | Mantine Checkbox compatibility wrapper                   | 9 imports    |
| `switch`                          | Mantine Switch compatibility wrapper                     | 8 imports    |
| `sheet`                           | Mantine Drawer compatibility wrapper                     | 8 imports    |
| `tooltip`                         | Mantine Tooltip compatibility wrapper                    | 4 imports    |
| `popover`                         | Mantine Popover compatibility wrapper                    | 3 imports    |
| `MarkdownEditor/MarkdownRenderer` | Custom markdown surfaces                                 | 2 imports    |
| `toast`/`toaster`                 | Mantine Notifications bridge                             | 1 import     |
| `data-table`                      | Custom table wrapper                                     | 1 import     |

Shared primitive migration progress:

- Mantine-backed compatibility wrappers are now active for `button`, `badge`,
  `input`, `textarea`, `checkbox`, `switch`, `label`, `skeleton`,
  `scroll-area`, `number-input`, `dialog`, `sheet`, `alert-dialog`, `popover`,
  `tooltip`, `tabs`, `select`, and the app-level `toaster` delivery path.
- No shared `components/ui` primitive wrapper remains backed by a Radix
  interaction primitive. A local Slot helper now preserves `asChild`
  composition while migrated feature surfaces still depend on that contract.
- The old direct Radix primitive package dependencies, `@radix-ui/react-slot`,
  and the shadcn package have been removed.
- Feature surfaces still need visual and keyboard/focus checks before the final
  cleanup gate. New v5 surfaces should prefer Mantine primitives directly unless
  they need one of the compatibility wrappers above.

High-traffic feature surfaces:

| Area                 | Representative files                                                                 | Migration class      |
| -------------------- | ------------------------------------------------------------------------------------ | -------------------- |
| App shell/navigation | `App.tsx`, `Header.tsx`, `CommandPalette.tsx`, `UserMenu.tsx`, sidebars              | Mantine shell        |
| Board                | `KanbanBoard.tsx`, `KanbanColumn.tsx`, `TaskCard.tsx`, `FilterBar.tsx`, bulk actions | Hybrid               |
| Task work/detail     | `TaskDetailPanel.tsx`, create/apply template dialogs, comments, deliverables, review | Mantine forms        |
| Settings/admin       | `SettingsDialog.tsx`, settings tabs, managed lists, policy/config panels             | Mantine forms        |
| Dashboard/telemetry  | dashboard pages, drilldowns, grid widgets, Recharts views                            | Hybrid               |
| Workflows/governance | workflow pages, policy manager, scoring, drift, decisions                            | Mantine shell        |
| Templates            | template list, editor dialog, preview panel                                          | Mantine forms        |
| Auth/setup           | `LoginScreen.tsx`, `SetupScreen.tsx`                                                 | Mantine forms        |
| Chat/activity        | chat sheets, floating chat, activity feed                                            | Mantine overlays     |
| Archive/backlog      | archive and backlog list/filter pages                                                | Mantine tables/forms |

Legacy helper dependencies still tied to compatibility wrappers:

- `class-variance-authority`
- `tailwind-merge`
- Tailwind animation helpers used by shadcn-style primitives

Remaining removals should happen only after import counts reach zero for the
covered helper group.

## Target Foundation

Mantine becomes the primary component system for v5.0:

| Current concept      | Mantine target                                                                                         | Notes                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| App frame            | `AppShell`, `NavLink`, `Burger`, `ScrollArea`, `Group`                                                 | Needed for desktop/mobile shell parity                                          |
| Buttons/icon buttons | `Button`, `ActionIcon`, `Menu`, `Tooltip`                                                              | Preserve lucide icons unless a component already supplies a better affordance   |
| Forms                | `TextInput`, `Textarea`, `Select`, `MultiSelect`, `Checkbox`, `Switch`, `NumberInput`, `PasswordInput` | Use Mantine validation/error states before custom form chrome                   |
| Dialogs/sheets       | `Modal`, `Drawer`, `Alert`, `Popover`, `HoverCard`                                                     | Replace sheet-like task panels with drawers only where layout remains efficient |
| Tabs/segmented modes | `Tabs`, `SegmentedControl`, `PillsInput`                                                               | Use compact density for operational surfaces                                    |
| Tables/lists         | `Table`, `DataTable` wrapper if retained, `Pagination`, `ScrollArea`                                   | Product tables can retain custom data logic                                     |
| Notifications        | `Notifications`, `Alert`, `Loader`, `Progress`                                                         | Replace current toast wrapper after app provider lands                          |
| Theme                | `MantineProvider`, CSS variables, color scheme manager                                                 | Keep Veritas tokens as the source of product color decisions                    |
| Layout primitives    | `Stack`, `Group`, `Grid`, `SimpleGrid`, `Flex`, `Box`                                                  | Reduce repeated Tailwind layout strings in migrated surfaces                    |

Foundation files:

- `web/src/theme/MantineRoot.tsx` owns `MantineProvider`, `ModalsProvider`,
  notifications, and the Veritas color-scheme bridge.
- `web/src/theme/mantine-theme.ts` owns the Veritas Mantine theme, status
  colors, density settings, breakpoints, focus behavior, radius, shadows, and
  component defaults.
- `web/src/theme/color-scheme.ts` keeps Mantine color scheme state and the
  existing `.dark` class in sync while shadcn/Tailwind surfaces still exist.
- `web/src/components/layout/mantine-shell.tsx` contains the first Mantine app
  shell primitives for future desktop/mobile surfaces.

Retained custom surfaces:

- Kanban board column/card drag and drop built on `@dnd-kit`
- Task card metadata density and domain-specific status chips
- Diff viewer and review comment anchoring
- Recharts-based dashboard visualizations
- Workflow run timelines and replay views
- Work product previews and markdown rendering, including the retained custom
  markdown renderer
- Prompt/template markdown editing behavior, including the retained custom
  markdown editor toolbar and preview flow
- Git worktree/PR conflict-resolution logic

## Tailwind Strategy

Tailwind should stay available during v5.0, but its role changes:

1. Mantine controls core primitives, overlays, form controls, spacing in migrated
   screens, responsive app shell behavior, and color-scheme behavior.
2. Tailwind remains acceptable for product-specific layouts, chart wrappers,
   kanban board density, diff views, markdown content, and one-off utility
   styling while a surface is being migrated.
3. New v5 surfaces should not add new shadcn/Radix wrapper usage.
4. Once a primitive group has a Mantine replacement and no remaining imports,
   remove the old wrapper and related dependency.

Do not attempt a Tailwind removal in v5.0 unless the migrated app has already
settled and bundle/regression evidence says it is worth the churn.

## Theme, Density, and Icons

Theme requirements:

- Dark mode remains first-class.
- Preserve the Veritas operational feel: dense, quiet, and work-focused.
- Use Mantine radius `sm` or `md` for operational controls; avoid oversized
  marketing-style cards.
- Map existing CSS variables to a Mantine theme file before broad migrations.
- Keep Roboto-compatible fallback through the existing system font stack unless
  a desktop packaging decision provides bundled font handling.
- Maintain visible focus states and reduced-motion behavior.

Icon strategy:

- Keep `lucide-react` for product actions and navigation.
- Use `ActionIcon` for icon-only commands with accessible labels/tooltips.
- Do not replace domain icons solely for library consistency.

Breakpoints:

- Define Mantine breakpoints once in the Veritas theme.
- Treat desktop app, browser, and mobile/PWA as supported layout modes.
- Avoid viewport-scaled font sizes; use responsive layout changes instead.

## Mantine Usage Conventions

- New v5 surfaces should import Mantine components directly or use Veritas
  Mantine wrappers from `web/src/components/layout/mantine-shell.tsx` when the
  wrapper encodes a product layout convention.
- Do not add new shadcn/Radix wrapper usage for new v5 surfaces unless a
  migration PR explicitly needs a compatibility bridge.
- Use Mantine `Stack`, `Group`, `Grid`, `SimpleGrid`, `Flex`, and `Box` for
  new layout code before adding long Tailwind layout strings.
- Use Mantine `ActionIcon` for icon-only commands and keep lucide icons inside
  the control.
- Use Mantine form controls and built-in error/description props for new forms.
- Use Mantine `Modal`/`Drawer`/`Popover` for new overlays. Keep existing
  shadcn overlays only until their containing surface is migrated.
- Keep Veritas-specific board, diff, workflow timeline, chart, markdown, and
  work product components custom.
- Read status colors from `theme.other.statusColors` or from
  `veritasStatusColors`; do not scatter new one-off status hex values.
- Keep the app dark-mode first. Validate light mode, but do not let light-mode
  defaults drive density or spacing decisions.
- When adding a new Mantine dependency beyond core/hooks/forms/notifications/
  modals, document why the package is needed in the PR.

Foundation verification currently covers:

- default dark color-scheme bridge to the existing `.dark` class
- Mantine provider availability in the web app and test utility wrapper
- required v5 status semantics: blocked, needs review, running, done, failed,
  warning, policy denied, and destructive
- reduced-motion, focus ring, auto contrast, and breakpoint defaults
- Mantine-backed shared primitives for buttons, badges, text fields,
  checkbox/switch controls, labels, skeletons, scroll areas, and notifications
- Mantine-backed shared primitives for number inputs, popovers, and tabs with
  legacy compatibility coverage
- Mantine-backed tooltip compatibility wrapper with provider/trigger/content
  coverage
- Mantine-backed dialog compatibility wrapper with trigger/content/title/
  description/close coverage and Modal focus/scroll/Escape behavior
- Mantine-backed sheet compatibility wrapper with trigger/content/title/
  description/close coverage and Drawer position/focus/scroll/Escape behavior
- Mantine-backed alert dialog compatibility wrapper with trigger/content/title/
  description/action/cancel coverage and modal focus/scroll/Escape behavior
- Mantine-backed select compatibility wrapper with trigger/value/content/item
  coverage and legacy `onValueChange` behavior
- direct Radix dependency cleanup, with only the scoped Slot helper retained for
  compatibility `asChild` paths

## Migration Order

### Phase 0: Inventory and Guardrails

- Land this plan.
- Add a migration tracker issue checklist and link dependent v5 UI issues.
- Decide bundle reporting command and baseline before adding Mantine.
- Add a no-new-shadcn guidance note to frontend contribution docs when broad
  migration starts.

### Phase 1: Mantine Foundation

Target issue: `v5.0 UI: Add Mantine foundation, theme, and app shell`

- Add Mantine packages and provider wiring.
- Add `web/src/theme/mantine-theme.ts`.
- Bridge current Veritas CSS variables into Mantine colors where practical.
- Add app-level color scheme manager that respects current dark/light behavior.
- Keep existing shadcn primitives working during this phase.
- Add visual smoke coverage for app boot, auth/setup, board shell, and one modal.

### Phase 2: Shared Primitives

Target issue: `v5.0 UI: Migrate shared primitives, forms, and overlays to Mantine`

Migration batches:

1. Basic controls: button, badge, input, label, textarea, skeleton. Completed
   for the compatibility layer; feature surfaces can now use these wrappers
   while preserving current imports.
2. Form controls: checkbox and switch completed for the compatibility layer;
   number-like settings inputs now route through Mantine `NumberInput`; select
   now routes through Mantine `Select` while preserving the legacy value API.
3. Feedback: toast delivery now routes through Mantine notifications.
4. Overlays: dialog/modal, sheet/drawer, alert dialog, popover, and tooltip now
   use Mantine-backed compatibility wrappers. Destructive confirmation visual QA
   moves to the Phase 4 cleanup gate.
5. Navigation modes: tabs now use a Mantine-backed compatibility wrapper.
   Segmented controls and command/search shell remain surface-level work.

Use compatibility wrappers only when they reduce churn. Each wrapper must have a
removal target and should not hide incompatible behavior.

### Phase 3: Core Surfaces

Target issue: `v5.0 UI: Migrate core app surfaces to Mantine`

Recommended order:

1. Auth/setup screens
2. App shell/header/user menu/command palette
3. Settings dialog and settings tabs
4. Create task/apply template/task metadata forms
5. Task detail panel tabs and side surfaces
6. Templates, archive, backlog
7. Workflow, governance, scoring, drift, policy pages
8. Dashboard shell and drilldowns
9. Chat/activity overlays
10. Board filter/bulk action chrome while preserving custom board internals

Phase 3 progress:

- Auth/setup screens and the app shell/header/command palette have direct
  Mantine surface slices.
- Archive and backlog list/filter pages now use direct Mantine layout and form
  controls while preserving custom task card/list behavior.
- Create-task dialog form controls now use direct Mantine text, textarea,
  select, tabs, alert, and list primitives while preserving duplicate detection,
  template, project, sprint, agent, and subtask behavior.
- Settings dialog shell navigation, mobile section selector, loading skeleton,
  scroll area, and import/export/reset controls now use direct Mantine
  primitives while keeping lazy tab content and destructive confirmation behavior
  stable.
- Shared settings row, toggle, and section header primitives now use direct
  Mantine layout, text, switch, and button components while preserving existing
  tab APIs.
- Board, Tasks, Notifications, and Enforcement settings tab controls now use
  direct Mantine select and text input primitives where tab-specific controls
  are not covered by shared rows.
- General settings now uses direct Mantine switch, text input, select, button,
  badge, and icon action primitives for theme, profile, repository, and default
  agent controls.
- Security settings and the settings error fallback now use direct Mantine
  password input and button primitives while preserving password-change,
  visibility, reset, and retry behavior.
- Delegation settings now uses direct Mantine select, switch, badge, and button
  primitives while preserving delegation enable, revoke, scope, duration, and
  critical-priority exclusion behavior.
- Shared managed-list settings controls now use direct Mantine text input,
  button, and action icon primitives while preserving create, inline edit,
  keyboard save/cancel, drag handles, and explicit move/delete actions.
- Manage settings extra fields and template controls now use direct Mantine
  text input, textarea, select, button, badge, and action icon primitives while
  preserving managed-list metadata edits, template import/export/help, template
  create, and template delete behavior.
- Tool Policies and Shared Resources settings now use direct Mantine alert,
  modal, text input, textarea, checkbox, number input, badge, button, and action
  icon primitives while preserving policy list/edit/create/delete affordances
  and shared-resource allowed-type/max-resource controls.
- Multi-user settings now use direct Mantine select, text input, checkbox, badge,
  button, and action icon primitives while preserving workspace switching,
  member role management, invitations, scoped API token creation, rotation, and
  revocation behavior.
- Agents settings now use direct Mantine switch, select, text input, badge,
  button, action icon, and modal primitives while preserving installed-agent
  add/edit/remove/toggle behavior, Codex health refresh, routing defaults, and
  routing-rule create/edit controls.
- Board filter and bulk-selection chrome now use direct Mantine text input,
  select, badge, button, action icon, and modal primitives while preserving
  search/filter URL behavior, selection groups, move, backlog, archive, and
  delete confirmation flows.
- Search dialog controls now use direct Mantine modal, text input, select,
  checkbox, badge, button, and scroll-area primitives while preserving task/doc
  search, collection filters, backend selection, fallback status, and task-open
  callbacks.
- Setup, login, recovery, and recovery-key confirmation controls now use direct
  Mantine password input, text input, checkbox, and button primitives while
  preserving password creation, remember-me login, recovery reset, key copy, and
  key-download behavior.
- Command palette and keyboard-shortcut help overlays now use direct Mantine
  modal, text input, scroll area, stack, text, and key badge primitives while
  preserving keyboard launch, command filtering, shortcut display, and nested
  search-dialog launch behavior.
- Header action chrome, workspace switching, session menu, and WebSocket status
  now use direct Mantine button, action icon, select, badge, popover, and key
  badge primitives while preserving navigation, theme switching, workspace
  switching, settings shortcuts, session actions, and status popover behavior.
- Task detail shell, core tabs, task title editing, metadata selectors,
  description fallback editing, progress notes, checkpoint status, archive, and
  delete confirmation now use direct Mantine drawer, tabs, text input, textarea,
  select, badge, button, paper, loader, and modal primitives while preserving
  task update, progress, archive, restore, and delete behavior.
- Task detail blocked reason, done criteria, and dependency subsections now use
  direct Mantine select, textarea, checkbox, progress, text input, badge,
  button, action icon, and paper primitives while preserving blocked-reason
  updates, verification-step mutations, dependency display, add/cancel, and
  remove behavior.
- Task detail subtask, deliverable, and lessons-learned subsections now use
  direct Mantine checkbox, switch, progress, text input, textarea, select,
  badge, button, action icon, paper, theme icon, and modal primitives while
  preserving subtask and criterion mutations, auto-complete toggling,
  deliverable add/edit/delete flows, and lessons-note/tag updates.
- Task detail comments, attachments, observations, and time tracking now use
  direct Mantine text input, textarea, select, slider, badge, button, action
  icon, alert, paper, scroll area, modal, stack, group, text, avatar, and theme
  icon primitives while preserving comment add/edit/delete, attachment upload,
  text preview, download and delete confirmation, observation add/delete, and
  manual time-entry add/delete behavior.
- Task detail Git selection, worktree status/actions, pull-request creation,
  workflow run modal, and run-mode/QA gate controls now use direct Mantine
  select, text input, checkbox, switch, badge, button, alert, code, paper,
  scroll area, modal, stack, group, and text primitives while preserving Git
  updates, worktree create/rebase/merge/delete actions, PR draft creation,
  workflow start behavior, run-mode changes, and QA gate toggles.
- Task detail review decisions, inline review comments, preview drawer, and
  conflict-resolution drawer now use direct Mantine drawer, modal, tabs,
  textarea, button, action icon, code, paper, scroll area, stack, group, text,
  loader, and theme icon primitives while preserving review decision summaries,
  merge confirmation, inline comment add/remove, preview output/external/stop
  controls, manual conflict resolution, and abort behavior.
- Task detail agent controls, apply-template flow, task metrics panel, create-task
  dialog shell, blueprint preview, and template variable helpers now use direct
  Mantine modal, tabs, select, switch, text input, badge, button, action icon,
  skeleton, paper, alert, code, stack, group, text, and theme icon primitives
  while preserving agent start/stop/message flows, template merge previews,
  force-overwrite/custom-variable application, metrics expansion/export, and
  blueprint/custom-variable rendering.
- Workflow browse, dashboard, run list, active/recent run cards, summary cards,
  health metrics, and run detail/timeline surfaces now use direct Mantine
  select, text input, badge, button, skeleton, paper, progress, stack, group,
  simple grid, alert, code, text, title, and theme icon primitives while
  preserving workflow search, run start, dashboard filters, run selection, live
  status rendering, health progress, resume action, and step output expansion.
- Dashboard telemetry filter, export, drawer, task, failure, token, and duration
  drilldown surfaces now use direct Mantine select, text input, modal, drawer,
  badge, skeleton, paper, progress, stack, group, simple grid, text, title,
  theme icon, and scroll area primitives while preserving period selection,
  custom ranges, export scope/format/date controls, drawer close behavior,
  task selection, failure summaries, token summaries, duration summaries, and
  per-agent breakdowns.
- Dashboard widget and chart shells now use direct Mantine paper, skeleton,
  tooltip, action icon, progress, stack, group, simple grid, text, and theme icon
  primitives for active dashboard cards, status timeline, agent comparison,
  trends, wall-time, activity clock, and the budget widget while preserving
  existing metric queries, chart rendering, sorting, help affordances, and
  toggle behavior.

### Phase 4: QA, Cleanup, and Dependency Removal

Target issue: `v5.0 QA: Mantine migration visual, accessibility, and cleanup gate`

- Run visual smoke checks against desktop and mobile viewports.
- Run keyboard/focus checks for dialog, drawer, tabs, select, command/search,
  task create/edit, and settings flows.
- Measure bundle size after each large surface migration.
- Remove unused Radix/shadcn dependencies only after import counts prove they
  are unused.
- Keep a cleanup ledger of removed wrappers and accepted retained custom
  components.

## Component Mapping

| Current file                     | Target                                                  | Priority |
| -------------------------------- | ------------------------------------------------------- | -------- |
| `components/ui/button.tsx`       | Mantine `Button`/`ActionIcon` wrapper or direct imports | High     |
| `components/ui/input.tsx`        | Mantine `TextInput`                                     | High     |
| `components/ui/textarea.tsx`     | Mantine `Textarea`                                      | High     |
| `components/ui/select.tsx`       | Mantine `Select` compatibility wrapper                  | High     |
| `components/ui/dialog.tsx`       | Mantine `Modal`                                         | High     |
| `components/ui/sheet.tsx`        | Mantine `Drawer` compatibility wrapper                  | High     |
| `components/ui/tabs.tsx`         | Mantine `Tabs`                                          | High     |
| `components/ui/alert-dialog.tsx` | Mantine `Modal` compatibility wrapper                   | High     |
| `components/ui/checkbox.tsx`     | Mantine `Checkbox`                                      | Medium   |
| `components/ui/switch.tsx`       | Mantine `Switch`                                        | Medium   |
| `components/ui/popover.tsx`      | Mantine `Popover`/`Menu`                                | Medium   |
| `components/ui/tooltip.tsx`      | Mantine `Tooltip`                                       | Medium   |
| `components/ui/scroll-area.tsx`  | Mantine `ScrollArea`                                    | Medium   |
| `components/ui/skeleton.tsx`     | Mantine `Skeleton`                                      | Medium   |
| `components/ui/toast.tsx`        | Mantine notifications                                   | Medium   |
| `components/ui/data-table.tsx`   | Retain custom or wrap Mantine `Table`                   | Low      |
| Markdown editor/renderer         | Retain custom                                           | Low      |

## Risk Areas

| Risk                         | Mitigation                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| Drag/drop regressions        | Keep `@dnd-kit` board internals stable until shell/forms are migrated                                  |
| Dialog/drawer behavior drift | Migrate one overlay family at a time and test keyboard escape/focus return                             |
| Command/search regressions   | Treat command center as its own surface with keyboard tests                                            |
| Settings form churn          | Batch settings tabs after shared form controls are stable                                              |
| Dashboard bundle growth      | Keep Recharts split and measure Mantine impact separately                                              |
| Mobile drawer overflow       | Test task detail, settings, create task, search, and chat on narrow widths                             |
| Accessibility gaps           | Verify focus, labels, reduced motion, contrast, and screen-reader names                                |
| Partial system inconsistency | Use route/surface migration PRs; avoid mixing Mantine and shadcn inside one compact form when possible |

## Rollback Strategy

- Land foundation work behind provider-level compatibility; do not remove old
  primitives in the same PR that adds Mantine.
- Migrate by primitive family or route-level surface, not by scattered one-off
  replacements.
- Keep compatibility wrappers until the migrated surface is verified.
- If a surface regresses, revert that surface PR without reverting the Mantine
  provider foundation.
- Keep dependency removals in the final cleanup phase so rollback does not
  require reinstalling packages mid-migration.

## Verification Gates

Minimum gates for foundation and shared primitive PRs:

- `pnpm --filter @veritas-kanban/web typecheck`
- `pnpm --filter @veritas-kanban/web test`
- `pnpm lint:budget`
- `pnpm build`
- visual smoke screenshots for app boot, board, task detail, create task,
  settings, command/search, and one mobile viewport once browser automation is
  added to the migration branch

Minimum gates for route-level migration PRs:

- targeted component/unit tests for touched surfaces
- keyboard smoke for overlays/forms
- desktop and mobile screenshot comparison
- bundle-size note when a lazy chunk changes materially

## Completion Criteria

Issue #414 is complete when:

- this plan is linked from the README documentation map
- each current shared UI primitive has a target state
- Mantine foundation work is sequenced before dependent v5 surfaces
- rollback and dependency-removal strategy are documented
- known risky areas have explicit migration/testing treatment

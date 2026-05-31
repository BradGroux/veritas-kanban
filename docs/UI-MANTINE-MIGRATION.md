# v5 Mantine Migration Plan

## Status

Planned for v5.0. This document is the migration contract for moving the web,
desktop, mobile/PWA, workflow, governance, and admin surfaces onto Mantine UI.

The goal is not a cosmetic rewrite. The goal is one coherent UI foundation for
new v5 surfaces while keeping Veritas-specific experiences where generic
component primitives are not the right abstraction.

## Current Inventory

The current web app uses React, Vite, Tailwind, shadcn/Radix primitives, lucide
icons, custom CSS tokens in `web/src/globals.css`, and product-specific feature
components.

Current shared primitive usage:

| Primitive                         | Current state                                          | Observed use |
| --------------------------------- | ------------------------------------------------------ | ------------ |
| `button`                          | shadcn wrapper around Radix Slot and Tailwind variants | 73 imports   |
| `input`                           | Tailwind input wrapper                                 | 41 imports   |
| `select`                          | Radix Select wrapper                                   | 39 imports   |
| `label`                           | Radix Label wrapper                                    | 36 imports   |
| `badge`                           | Tailwind/CVA badge wrapper                             | 36 imports   |
| `textarea`                        | Tailwind textarea wrapper                              | 20 imports   |
| `skeleton`                        | Tailwind loading primitive                             | 18 imports   |
| `alert-dialog`                    | Radix Alert Dialog wrapper                             | 18 imports   |
| `scroll-area`                     | Radix Scroll Area wrapper                              | 13 imports   |
| `dialog`                          | Radix Dialog wrapper                                   | 13 imports   |
| `tabs`                            | Radix Tabs wrapper                                     | 9 imports    |
| `checkbox`                        | Radix Checkbox wrapper                                 | 9 imports    |
| `switch`                          | Radix Switch wrapper                                   | 8 imports    |
| `sheet`                           | Radix Dialog based side panel wrapper                  | 8 imports    |
| `tooltip`                         | Radix Tooltip wrapper                                  | 4 imports    |
| `popover`                         | Radix Popover wrapper                                  | 3 imports    |
| `MarkdownEditor/MarkdownRenderer` | Custom markdown surfaces                               | 2 imports    |
| `toast`/`toaster`                 | Radix Toast wrapper and app-level notification surface | 1 import     |
| `data-table`                      | Custom table wrapper                                   | 1 import     |

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

Package dependencies currently tied to the old primitive layer:

- Radix packages: alert dialog, checkbox, dialog, dropdown menu, label, popover,
  scroll area, select, slot, switch, tabs, toast, tooltip
- shadcn CLI/package
- `class-variance-authority`
- `tailwind-merge`
- Tailwind animation helpers used by shadcn-style primitives

These should not be removed in one commit. Removal happens only after import
counts reach zero for the covered primitive group.

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

Retained custom surfaces:

- Kanban board column/card drag and drop built on `@dnd-kit`
- Task card metadata density and domain-specific status chips
- Diff viewer and review comment anchoring
- Recharts-based dashboard visualizations
- Workflow run timelines and replay views
- Work product previews and markdown rendering
- Prompt/template markdown editing behavior
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

1. Basic controls: button, badge, input, label, textarea, skeleton
2. Form controls: select, checkbox, switch, number-like inputs
3. Overlays: dialog, alert dialog, sheet/drawer, popover, tooltip
4. Navigation modes: tabs, segmented controls, command/search shell
5. Feedback: toast/notifications, loading/error banners

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
| `components/ui/select.tsx`       | Mantine `Select`/`MultiSelect`                          | High     |
| `components/ui/dialog.tsx`       | Mantine `Modal`                                         | High     |
| `components/ui/sheet.tsx`        | Mantine `Drawer` or custom split panel                  | High     |
| `components/ui/tabs.tsx`         | Mantine `Tabs`                                          | High     |
| `components/ui/alert-dialog.tsx` | Mantine `Modal` with danger action pattern              | High     |
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
- Keep shadcn/Radix wrappers until the migrated surface is verified.
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

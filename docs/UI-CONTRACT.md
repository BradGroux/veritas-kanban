# Desktop UI contract

The React/Electron UI uses Mantine with a small product vocabulary in `web/src/components/ui/UiVocabulary.tsx`. Inspect the actual production components at `/?ui-gallery=1` in either the desktop app or development server. This diagnostic gallery is read-only and uses the normal authentication boundary.

## Actions

| Role        | Component                                                | Use                                                 |
| ----------- | -------------------------------------------------------- | --------------------------------------------------- |
| Primary     | `<UiAction>Save profile</UiAction>`                      | The next intended action, filled brand treatment    |
| Secondary   | `<UiAction variant="secondary">Export</UiAction>`        | An alternative, neutral outlined treatment          |
| Quiet       | `<UiAction variant="quiet">Cancel</UiAction>`            | Navigation or dismissal, neutral subtle treatment   |
| Destructive | `<UiAction variant="destructive">Delete</UiAction>`      | Delete, stop, or cancel work, red filled treatment  |
| Icon        | `<UiIconAction aria-label="Close chat">…</UiIconAction>` | Quiet by default, always a specific accessible name |

Normal desktop actions share a 34px minimum height, 6px radius, 13px type, weight 650, 12px horizontal padding, and 6px icon spacing. Icon targets are at least 34px square. Text actions grow rather than clip at increased text sizes. These dimensions use rem in the rendered contract so user text scaling scales the controls. Do not add page-specific fixed heights, brand colors, or size variants. Mantine owns keyboard focus, hover, disabled, and loading behavior; the product layer adds a restrained pressed offset. Disabled controls never show that offset. Polymorphic link actions retain native anchor semantics and refs.

Avoid multiple competing primary actions within one action group. Save and create may appear in the same header only when create is secondary. Destructive controls identify the action in text or their accessible name; color alone is insufficient.

## Surfaces and hierarchy

| Level   | Component                               | Treatment                                                 |
| ------- | --------------------------------------- | --------------------------------------------------------- |
| Section | `<UiSurface level="section">`           | No new border or fill, for grouping                       |
| Card    | `<UiSurface>`                           | Neutral card surface, one border, subtle shadow           |
| Inset   | `<UiSurface level="inset">`             | Neutral inset detail, no shadow                           |
| Empty   | `<UiEmptyState title="No results" … />` | Dashed boundary, explanation and optional recovery action |

Use at most two nested bordered levels: card then inset. Further grouping is a borderless section, spacing, or a divider. Surface components own radius, border strength, and fill; callers own layout and content padding. Do not use arbitrary blue, slate, or purple panels to distinguish ordinary content. Semantic warnings belong in a labeled alert inside the surface. Shared dialog and drawer geometry is tracked separately in #1383.

Use `interactive` only on actionable surfaces to enable the shared neutral hover treatment. An explicitly labeled danger or warning section can use `accent="error"` or `accent="warning"`; do not override surface colors with utility classes.

Page titles and header geometry use `PrimaryPageShell`. Section titles use `UiHeading` or `UiSectionHeading` (16px, weight 650, 1.25 line height), with optional supporting text (13px, 1.45 line height). `UiHeading order={3}` provides a 13px subsection heading. Preserve heading order and sentence case; proper names and acronyms retain their spelling.

## Pills and semantic colors

`UiPill` supports `neutral`, `count`, `selected`, and `status`. Pills share a 22px minimum height, 6px radius, 11px type, weight 650, and 8px horizontal padding. Text can wrap. Never force uppercase or ellipsis into a pill. Use count for quantity, neutral for category/identifier metadata, selected only for actual selection, and status with an explicit tone for state.

| Tone      | Meaning                                                  |
| --------- | -------------------------------------------------------- |
| Neutral   | Metadata, count, idle, unknown                           |
| Info      | Running work, informational evidence, live snapshot      |
| Success   | Completed, approved, enabled                             |
| Warning   | Risk, stale/incomplete evidence, approaching a limit     |
| Error     | Failed operation or denied action                        |
| Blocked   | Work unable to proceed                                   |
| Selection | The user's current selection, never operational severity |

Example: `<UiPill kind="status" tone="blocked">Blocked</UiPill>`. Brand accent belongs to primary actions and selection, not every count or navigation link. Existing data-status helpers can pass through `semanticToneForLegacyColor` during migration; unsupported or decorative colors become neutral. New status helpers should return semantic tones directly.

The light/dark palette is specified in `web/src/theme/ui-contract.ts`; CSS custom properties render it. Automated tests require every foreground/background pair to meet WCAG AA 4.5:1 and check CSS parity. Status must also have a readable label or icon. Chart series, task classification stamps, and capacity bars may retain their documented data colors: those distinguish data, not unrelated page chrome. Activity titles remain neutral; its pills carry status.

## Adoption and verification

Activity, Templates, Workflows, Operations/Admission, Evidence, Time, Drift, Decisions, Scoring, Policies, Settings shared sections/actions, and task workspace actions adopt this vocabulary. Existing board classification styling remains governed by the board color contract in `globals.css`. Feature-specific forms and overlay layout are separate audit issues, not exemptions from this contract.

The gallery and focused tests cover action roles, disabled/keyboard behavior, anchor/ref compatibility, pill meanings, surface levels, and palette contrast. Browser checks measure rendered controls in light/dark themes at standard and increased text sizes. Release acceptance also requires representative packaged macOS screenshots and the final installed-app matrix; passing browser tests does not substitute for that evidence. Docs screenshots and GIFs are refreshed only from the final accepted UI (#1388).

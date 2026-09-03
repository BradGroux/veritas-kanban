# Board color system

This contract defines how the board uses color. Color is never the only signal: every identity and state also has a label, icon, shape, border, or focus treatment.

The 24-task comparison surface is [BOARD-COLOR-EXPLORATION-1301.html](./BOARD-COLOR-EXPLORATION-1301.html). It renders the same tasks and representative normal, selected, focused, dragged, running, blocked, failed, awaiting-review, verified, and drop-target states for all three concepts in dark and light themes.

## Concepts reviewed

1. **Status plates plus classification stamps.** A localized column plate combines status glyph, name, and count. Each card has a compact task-type stamp containing its icon and label. Active operational states may add a restrained tonal card surface. This was selected because status and identity remained fastest to locate at full-board scale, the shapes stayed legible in grayscale, and violet interaction states remained distinct from identity colors.
2. **Integrated metadata fields with quiet column framing.** Type and state became adjacent fields beneath each title. The geometry was consistent, but repeated field trays slowed title scanning and looked transferable to a generic administration dashboard. Rejected.
3. **Evidence seals plus identity keys.** A corner seal represented operational or verification state while a small keyed mark represented task identity. The evidence metaphor was distinctive, but the seal competed with blockers, active runs, and selection when several signals appeared together. Rejected.

The selected direction uses compact objects at the point where meaning is read. It does not use full-width status rails, card-side identity rails, glows, gradients, or broad decorative card tints.

## Token roles

| Role        | Source                                                          | Placement                                               | Emphasis                             |
| ----------- | --------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------ |
| Identity    | `--vk-identity-*`                                               | Task-type stamp and settings swatch                     | Controlled chroma; repeatable shape  |
| State       | `--vk-state-*`                                                  | Column status plate and labeled task signal             | Stronger than ordinary metadata      |
| Urgency     | `--vk-urgency-*`                                                | Blocked, failed, and readiness-warning signals          | Strongest active contrast            |
| Interaction | Existing `--primary` and `--ring`                               | Selection, keyboard focus, drag source, and drop target | Violet; never inferred from identity |
| Structure   | Existing background, card, muted, border, and foreground tokens | Board, columns, cards, and secondary metadata           | Neutral stage for semantic color     |

Identity tokens are `neutral`, `violet`, `cyan`, `orange`, `emerald`, `rose`, `amber`, `blue`, `red`, and `umber`. Light and dark values are calibrated as families in `web/src/globals.css`; surfaces and outlines are derived from the same mark with consistent mix ratios.

## Signal hierarchy

- Blocked and failed use the urgency-failure family and may tone the card surface because action is required.
- Running uses the active-state family and awaiting review uses the review-state family. Both include text and an icon.
- Verified uses the done-state family with a shield/check label. Incomplete readiness uses warning amber, never failure red by default.
- Project, sprint, priority, attachment, timing, and progress metadata remain labeled and visible but do not override operational state.
- Selected and focused states use violet ring geometry independent of the task-type color. Dragged cards use opacity and motion; drop targets use an inset violet boundary.

## Stored configuration migration

`TaskTypeConfig.colorToken` is the semantic contract for new and updated task types. The legacy `color` field remains readable so existing `border-l-*` values load without data loss. The web resolver maps every color previously offered by Settings to the closest semantic token and falls back to `neutral` for unknown values. Saving a color from Settings writes `colorToken`; no arbitrary CSS class is required.

## Responsive and accessibility behavior

The plate and stamp stay compact in both board densities. Columns retain the board's existing responsive layout, while card metadata continues to wrap on narrow surfaces. Status glyphs, labels, counts, signal text, focus rings, and border changes preserve meaning in grayscale and common color-vision-deficiency conditions. Essential text and controls continue to use the established foreground and focus tokens; semantic color is supplemental.

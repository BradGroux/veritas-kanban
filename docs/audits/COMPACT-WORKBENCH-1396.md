# Compact Workbench verification

Issue: [#1396](https://github.com/BradGroux/veritas-kanban/issues/1396). Source: `17706623`. Verified September 3, 2026.

## Behavior and cause

Below 1280 CSS px, reopening Workbench used a 420 px flex column and reduced the Board from 1132 to 712 px at the native 1180 × 760 minimum. It now overlays the right side without shrinking Board columns. Entering compact width still minimizes both sidebars and closes Workbench. Explicit sidebar reopening allows one auxiliary surface at a time; widening the window does not automatically reopen dismissed surfaces.

Squad controls now wrap instead of clipping their labels. Channel state survives switching and closure through React Activity. Successful-send completion uses mutation promises because per-call observer callbacks stop running when Activity hides their channel. Failed sends retain drafts; completion does not clear a newer draft. Escape dismisses a nested dropdown before dismissing Workbench.

## Verification

- Red-first browser evidence: Board width 1132 → 712; clipped Mark read/Hide System labels; channel switching erased the Squad draft. A focused state test also reproduced reopening multiple compact surfaces.
- 23 focused tests passed across desktop-shell-context, layout-chrome-mantine, SquadChatPanel, and activity-chat-mantine.
- `compact-workbench.spec.ts` passed in dark and light themes: native-minimum viewport, 320 px dock, 20 px text, dropdown bounds and keyboard selection, Escape/focus, channel/close/resize draft retention, and mocked sends completed while hidden. No real chat messages were dispatched.
- Existing populated desktop Board E2E passed, including real drag, rail toggles, resize, and viewport containment.
- Changed-file lint, web typecheck/build, server build, desktop build/artifact checks, and unsigned arm64 packaging passed.
- Independent review caught the hidden mutation-completion and nested-Escape defects. Both were fixed and independently rechecked, including retaining the new Board session for a subsequent mocked send.

## Packaged macOS evidence

The actual rebuilt Electron 44.1.1 arm64 application was launched with `app.isPackaged === true`, isolated user data and a fresh `compact-1396` test profile. No installed application or user board data was replaced. Native window transitions used BrowserWindow bounds and actual macOS fullscreen, not a browser viewport substitute.

Native checks passed in dark/light at 1360 × 900 → 1180 × 760, including automatic minimization, explicit compact chat reopening, sidebar mutual exclusion, two resize cycles per theme, preserved drafts, restored focus, both Squad selectors, dropdown Escape, and 20 px text with a 320 px dock. The Board remained 1132 px wide. Document height remained 760 px. Actual fullscreen entry/exit returned to the compact layout and retained the draft.

All ten captured screenshots were visually inspected. The empty Board is intentional isolated-profile data; populated Board behavior is covered by the separate E2E regression. [Machine-readable native matrix](evidence/compact-workbench-1396/native-matrix.json).

| State               | Dark                                                                     | Light                                                                     |
| ------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Auto-minimized      | [Image](evidence/compact-workbench-1396/auto-minimized-dark.png)         | [Image](evidence/compact-workbench-1396/auto-minimized-light.png)         |
| Enlarged Squad      | [Image](evidence/compact-workbench-1396/compact-squad-enlarged-dark.png) | [Image](evidence/compact-workbench-1396/compact-squad-enlarged-light.png) |
| Agent filter        | [Image](evidence/compact-workbench-1396/filter-menu-dark.png)            | [Image](evidence/compact-workbench-1396/filter-menu-light.png)            |
| Sender menu         | [Image](evidence/compact-workbench-1396/sender-menu-dark.png)            | [Image](evidence/compact-workbench-1396/sender-menu-light.png)            |
| Enlarged Board Chat | [Image](evidence/compact-workbench-1396/compact-board-enlarged-dark.png) | [Image](evidence/compact-workbench-1396/compact-board-enlarged-light.png) |

Built and packaged web index SHA-256 matched: `485a5710d5a1e517d860aeb514f0983cefd2bac0f49c0aff71e8369f24d113df`.

## Remaining scope

This is compact-layout acceptance, not complete visual/release acceptance. Shared modal/popout geometry remains [#1383](https://github.com/BradGroux/veritas-kanban/issues/1383), including remaining redundant chat headings/close controls and padding convergence. Task chat convergence remains #1386. The final documentation screenshot/GIF refresh and installed-app/release verification remain open. These native evidence images are not substitutes for the maintained documentation media refresh.

## Review summary

### Standards

The mutation lifecycle blocker was resolved. An optional existing rail-collapse duplication observation was not expanded into a refactor in this behavior fix.

### Spec

The hidden-send and nested-Escape findings were resolved and rechecked. No remaining blockers were found for this compact Workbench slice.

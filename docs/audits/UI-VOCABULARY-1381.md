# UI vocabulary verification, September 3, 2026

Issue #1381 establishes the shared action, surface, pill, heading, and semantic-color layer documented in [the UI contract](../UI-CONTRACT.md). It is not completion of the whole desktop audit.

## Packaged macOS evidence

The screenshots below come from the actual unsigned arm64 Electron application produced by `pnpm desktop:package:mac:dir`, followed by web rebuild and `pnpm --filter @veritas-kanban/desktop package:mac:dir` for the final corrections. Playwright launched the packaged executable, confirmed `app.isPackaged === true`, and operated its real window at 1360 × 900 logical pixels. No mocked desktop bridge was used. The isolated app ran on port 3002 with synthetic local data; the installed application and its data were not replaced.

| Surface           | Light                                                          | Dark                                                          | Checked                                                       |
| ----------------- | -------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| Component gallery | [Screenshot](evidence/ui-vocabulary-1381/gallery-light.png)    | [Screenshot](evidence/ui-vocabulary-1381/gallery-dark.png)    | Action hierarchy, pills, surface levels, empty state          |
| Operations Digest | [Screenshot](evidence/ui-vocabulary-1381/operations-light.png) | [Screenshot](evidence/ui-vocabulary-1381/operations-dark.png) | Neutral Admission surfaces and common page actions            |
| Scoring           | [Screenshot](evidence/ui-vocabulary-1381/scoring-light.png)    | [Screenshot](evidence/ui-vocabulary-1381/scoring-dark.png)    | Shared action height, readable metadata, subsection hierarchy |
| Settings General  | [Screenshot](evidence/ui-vocabulary-1381/settings-light.png)   | [Screenshot](evidence/ui-vocabulary-1381/settings-dark.png)   | Shared section headings and card hierarchy                    |
| Task Overview     | [Screenshot](evidence/ui-vocabulary-1381/task-light.png)       | [Screenshot](evidence/ui-vocabulary-1381/task-dark.png)       | Workspace actions, navigation labels, state pills             |

Native inspection caught and corrected faint secondary/destructive actions and wrapped workspace navigation labels. All five workspace navigation actions measure 34px high with intact labels at this window size.

## Automated checks

- Focused component suites cover vocabulary semantics, native anchor/ref behavior, disabled/focus behavior, task lifecycle tones, and the migrated page actions.
- Palette tests require 4.5:1 text contrast and parity between the documented palette and rendered CSS.
- `e2e/desktop-ui-vocabulary.spec.ts` measures controls and label clipping at 16px and 20px root text sizes in both themes; checks actual rendered action and pill contrast, keyboard focus, icon spacing, and page overflow.
- The primary-page-shell browser matrix covers the migrated routes. Web typecheck, changed-file lint, production build, and `pnpm qa:mantine` passed.

## Remaining acceptance boundaries

Settings navigation and feature forms (#1382), popout geometry (#1383), template editor (#1384), deeper task surfaces (#1385), and chat convergence (#1386) remain open. The screenshots intentionally show remaining legacy details such as Settings Advanced labels; this issue only provides the shared component layer and its adoption. The final packaged/installed conformance gate (#1387), documentation screenshot/GIF refresh (#1388), and release are not satisfied by this evidence.

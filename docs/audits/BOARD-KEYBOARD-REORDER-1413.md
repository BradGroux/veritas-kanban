# Keyboard reorder timing regression

Issue: [#1413](https://github.com/BradGroux/veritas-kanban/issues/1413).

## Cause

Full integration QA for #1398 failed the real-sensor cancel, empty-column move, and same-column keyboard reorder scenario: the second move request never arrived. The unchanged scenario reproduced locally twice against revision `3fcd9bedf8ef3de8cdeef5a395fb54df53bc13d1`.

Temporary sensor instrumentation showed that ArrowUp reached the keyboard coordinate getter and selected the correct preceding card. The subsequent drop read the previous render's `dragState`, before React committed the projected order. The unchanged-order guard then discarded the move. The instrumentation was removed after diagnosis.

A deterministic hook regression dispatching drag-over and drag-end in one React batch failed on the original implementation: zero move requests instead of one. This distinguishes a stale-state race from a missing key event, wrong collision target, or a need to delay the browser test.

## Change

Keep the latest drag projection in a synchronous ref alongside its rendered state. Start, drag-over, and clear update both; drop consumes the ref. Server commits remain authoritative, and the existing atomic move command, rollback announcements, and focus restoration are unchanged.

Regression cases cover same-column reorder and an empty destination before the next render. Cancellation coverage also checks that a queued drop cannot persist a canceled move and a later drag cannot inherit the canceled projection.

## Verification

- Focused hook file: 13 tests passed, including the baseline-failing batched regression.
- Original real-sensor scenario: passed in 4.7 seconds without editing the E2E test, adding waits, increasing timeouts, or enabling retries.
- Web typecheck, changed-file ESLint, and `git diff --check`: passed.
- Independent specification and standards reviews are recorded in the delivery task.

Browser reproduction used isolated API/Vite ports 3194/5194 and temporary test data, not the installed application's data. Full integration QA on the integrated revision is still required before closing #1413. This is not packaged macOS or release acceptance.

```sh
pnpm --filter @veritas-kanban/web exec vitest run src/__tests__/useBoardDragDrop.test.tsx
API_BASE_URL=http://127.0.0.1:3194 PLAYWRIGHT_API_PORT=3194 PLAYWRIGHT_WEB_PORT=5194 pnpm exec playwright test e2e/board-drag-atomic.spec.ts --grep 'handles cancel' --project chromium --reporter line
pnpm --filter @veritas-kanban/web typecheck
pnpm --filter @veritas-kanban/web exec eslint src/hooks/useBoardDragDrop.ts src/__tests__/useBoardDragDrop.test.tsx
```

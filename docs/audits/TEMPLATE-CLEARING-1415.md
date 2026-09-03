# Optional template field clearing

Issue: [#1415](https://github.com/BradGroux/veritas-kanban/issues/1415).

## Cause and contract

The editor represented an emptied optional field as `undefined`. JSON omitted it, and both storage implementations retained the existing value when merging the patch. A temporary real-service reproduction failed in both modes: clear, save, and reopen returned `old-project` instead of an absent project. This was not a UI-cache failure.

Update inputs now use explicit `null` to clear optional metadata and individual defaults. Omitted fields retain their previous values. A shared server helper applies the same rule before file or SQLite persistence, and no null marker is stored. The editor sends nulls only when updating; creation still omits blank optional fields. Optional dropdowns expose labeled clear actions now that the operation can persist.

## Evidence

- Original JSON/service reproduction: failed for both file and SQLite storage before the change; passed for both using the new explicit clearing representation. The temporary script was removed.
- Four real-router JSON tests passed: create, patch, GET/reopen, partial clearing with unrelated defaults preserved, clearing every default, setting a cleared field again, and rejecting null names/containers in both storage modes. Only the route service's data target is redirected; service logic and persistence are real.
- Three focused editor regressions passed: explicit null payloads when text fields and dropdowns are cleared, and Tab followed by Enter or Space to clear a dropdown and return focus to its input. The keyboard check first reproduced focus falling onto the page body; explicit input focus restoration corrected it. Clear actions are labeled and keyboard-focusable.
- Server and web typechecks passed. No production dependencies or storage migrations were added.
- Changed-file lint passed with four existing `any` warnings in the file service. Independent specification and standards reviews found no blockers; the standards review's keyboard-focus follow-up produced the regression and fix above.

The authoring-layout change remains separate in #1384. Final integrated browser/native acceptance and maintained documentation image/GIF replacement are not proven by these focused persistence checks.

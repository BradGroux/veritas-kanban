# Shared chat surface: implementation checkpoint

Issue: #1386. This implementation is stacked on the responsive task shell in #1421. Scoped packaged macOS checks are recorded below; full acceptance remains open and this checkpoint does not close #1386.

## Behavior

Board, Squad, and Task Chat now use the same header, transcript, empty state, message surface, composer spacing, and action vocabulary. The Workbench retains its channel selector but no longer repeats the chat title and close action in a second header. Squad filtering, search, mark-read, and system-message controls live in a bounded, portaled popover; sender selection stays with the composer. Horizontal chat remains removed.

Task Chat is an inline sidecar inside the task drawer. Below 64rem of task-shell width, it takes over the workspace body while the task header remains available. The task body stays mounted, preserving its selected mode, attempt, edit state, and scroll containers. Closing restores the invoking Chat control, or the header Chat control if the original control is no longer focusable. One focus trap encloses the combined task and chat workspace; nested confirmations temporarily own focus and Escape.

Chat transcripts scroll their own element. Appending a message or jumping to a Squad result no longer calls `scrollIntoView` on a descendant that can move an outer page. Task conversations are keyed by task identity and retain the deterministic task session contract. The change does not alter provider dispatch or send real messages during regression verification.

## Verification status

- Touched web package type check: passed.
- Changed web source and test-file lint: passed.
- Diff whitespace check: passed.
- Standards review: the initial chat-only focus-trap finding was corrected and rechecked.
- Spec review: all Chat entry points now capture the invoking element; failed focus on an inactive mode falls back to the header.
- Combined integration: the activity/chat, Squad, layout-chrome, and shared-overlay unit slices passed. Task Chat browser scenarios passed in light/dark, including non-header opener focus, draft retention, compact takeover, nested confirmation Escape, and exact task/session identity on mocked send.
- Compact Workbench browser scenarios passed in light/dark at minimum dock width and enlarged text. The first integration run targeted the Board's identically named filter before the Squad popover appeared; the locator now scopes the named Squad dialog. That exposed a real Escape-ordering defect: the parent Popover capture handler dismissed the filters before the Select, and Workbench ignored only modal dialogs. Filters now defer Escape to the nested Select, Workbench recognizes nonmodal dialogs, and Escape from the filters trigger also dismisses filters. Regression checks cover dropdown then popover dismissal, exact focus restoration, keyboard trigger open/close, menu bounds, draft retention, and resize cycles.
- Packaged macOS candidate `80e5bc6d`: Board/Squad filter and sender Escape/focus, channel draft retention, and responsive minimization passed in light/dark. Task Chat opener/fallback focus, Tab containment, nested confirmation Escape, draft/Results retention, transcript/composer bounds, and mocked task/session send identity also passed in light/dark. The actual native minimum is 1180×760: 16px text retains the task sidecar; 20px text activates body takeover. The unsigned arm64 candidate was built with the repository package command and verified as packaged in an isolated temporary profile; the installed app was not used.
- Installed-app replacement, final screenshots/GIFs, version bump, and release: pending.

These results cover the listed browser/native interactions, not a passing full CI gate or whole-app acceptance. No real chat was dispatched. Both review axes rechecked the Escape correction without remaining findings. Combined browser QA passed 63 tests and skipped one, but an older containment test matched both the toolbar's “Close Board Chat” and panel's “Close Board Chat panel”; its toolbar selector now requires an exact accessible name. The full focused containment-and-drag scenario passed after that correction.

## Acceptance still required

Complete the combined integration gate, stable final visual inspection, and remaining task-to-task isolation/pending-edit checks. Refresh maintained documentation media only from the final accepted UI under #1388, then verify the installed application. Keep #1386 open until that evidence exists.

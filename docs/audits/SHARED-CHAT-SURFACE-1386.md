# Shared chat surface: implementation checkpoint

Issue: #1386. This implementation is stacked on the responsive task shell in #1421. It is not packaged macOS acceptance and does not close #1386.

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
- Packaged macOS normal/minimum-window interaction: pending.
- Installed-app replacement, final screenshots/GIFs, version bump, and release: pending.

These local results are scoped integration evidence, not a passing full CI gate or native-app acceptance. No real chat was dispatched. Both review axes rechecked the Escape correction without remaining findings.

## Acceptance still required

Run the combined integration suite and inspect the native desktop at normal and minimum sizes with enlarged text. Verify Tab across task and chat, close and Escape ordering, filter/sender menu bounds, transcript scrolling, pending edits, Board/Squad switching, and task-to-task session isolation. Refresh maintained documentation media only from the final accepted UI under #1388. Keep #1386 open until that evidence exists.

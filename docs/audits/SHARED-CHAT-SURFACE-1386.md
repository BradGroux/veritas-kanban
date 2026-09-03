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
- Updated unit tests and new browser regression scenarios: authored, not executed at this implementation checkpoint. Execution belongs to the declared integration milestone under the repository cadence policy.
- Packaged macOS normal/minimum-window interaction: pending.
- Installed-app replacement, final screenshots/GIFs, version bump, and release: pending.

The browser scenarios cover Board/Squad draft retention and portaled selectors, plus Task Chat light/dark geometry, non-header invocation, focus fallback after changing task mode, nested confirmation Escape, compact takeover, and a mocked send that asserts the exact task/session pair. These are planned gates, not passing evidence.

## Acceptance still required

Run the combined integration suite and inspect the native desktop at normal and minimum sizes with enlarged text. Verify Tab across task and chat, close and Escape ordering, filter/sender menu bounds, transcript scrolling, pending edits, Board/Squad switching, and task-to-task session isolation. Refresh maintained documentation media only from the final accepted UI under #1388. Keep #1386 open until that evidence exists.

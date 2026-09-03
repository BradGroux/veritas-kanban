# Template authoring modal

Issue: [#1384](https://github.com/BradGroux/veritas-kanban/issues/1384).

## Implementation

Create and Edit now share one scrollable form with Basic Information and Task Defaults sections, using the shared authoring shell, section headings, actions, and fixed footer. Paired text inputs and selects occupy equal-width grid columns. The Markdown editor starts at six rows with a text-scaled minimum height and supports vertical resizing.

The name is the initial focus target and receives focus on validation failure. Save failures leave the draft intact and focus an inline error after pending state settles. A synchronous in-flight guard prevents repeated submissions or dismissal before React renders, and pending controls are disabled. Dirty close, Cancel, and Escape use the shared nested confirmation; Keep editing is its initial action, and the overlay stack restores focus on return.

The review identified that the existing patch API cannot persist clearing optional fields when the editor sends `undefined`. No new clear-default buttons are included in this layout change; deletion semantics require a separate persistence fix.

## Verification status

Web typecheck, changed-file lint, and diff checks passed. Independent specification and standards review found no remaining code blockers after the synchronous submit guard and removal of unsupported clear controls.

Interaction coverage is authored, not yet executed for this revision: create/edit with Enter, long Markdown, required-name focus, nested discard/keep editing, failed-save draft preservation, and duplicate submit/dismissal during a deferred mutation. The production-editor browser case now targets 900 by 480 with 20px text in both themes, checks equal field widths, submits from the scrolled bottom, and checks nested Escape and trigger focus restoration.

Acceptance is incomplete until these tests run at the integration milestone and the rebuilt packaged macOS application is visually compared in both themes with Create Task and another standard modal. Browser or typecheck evidence does not replace that native check. The installed app, its data, and maintained documentation images/GIFs have not been updated by this change.

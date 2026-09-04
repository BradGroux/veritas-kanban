# Template authoring modal

Issue: [#1384](https://github.com/BradGroux/veritas-kanban/issues/1384).

## Implementation

Create and Edit now share one scrollable form with Basic Information and Task Defaults sections, using the shared authoring shell, section headings, actions, and fixed footer. Paired text inputs and selects occupy equal-width grid columns. The Markdown editor starts at six rows with a text-scaled minimum height and supports vertical resizing.

The name is the initial focus target and receives focus on validation failure. Save failures leave the draft intact and focus an inline error after pending state settles. A synchronous in-flight guard prevents repeated submissions or dismissal before React renders, and pending controls are disabled. Dirty close, Cancel, and Escape use the shared nested confirmation; Keep editing is its initial action, and the overlay stack restores focus on return.

The review identified that the existing patch API cannot persist clearing optional fields when the editor sends `undefined`. No new clear-default buttons are included in this layout change; deletion semantics require a separate persistence fix.

## Verification status

Web typecheck, changed-file lint, and diff checks passed. Independent specification and standards review found no remaining code blockers after the synchronous submit guard and removal of unsupported clear controls.

The isolated Template integration combines this authoring change with #1415 clearing and #1417 priority alignment. It passed 31 server route/persistence tests and 11 editor tests, including create/edit with Enter, long Markdown, required-name focus, nested discard/keep editing, failed-save draft preservation, duplicate submit/dismissal, clearing, and Critical priority preservation. These results apply to the combined integration checkout, not an installed package.

The production-editor browser case targets 900 by 480 with 20px text in both themes, checks equal field widths, submits from the scrolled bottom, and checks nested Escape and trigger focus restoration. Both cases first failed because the duplicate validation toast covered Cancel and intercepted clicks. Validation now uses the focused inline field error; save failures use the focused inline Alert. Success notifications remain unchanged. The unchanged browser scenarios then both passed in 7.3 seconds; all 11 integrated editor tests also passed after the correction.

The unsigned packaged arm64 candidate `80e5bc6d` passed the Template scenario at the actual native minimum 1180×760 with 20px text in light and dark themes. Initial name focus, equal name/category widths, all four dropdowns, nested dropdown Escape, long-description scrolling, fixed-footer reachability, required-name focus, discard/keep-editing Escape, and final opener focus passed. Stable captures were compared with Create Task and the shared discard confirmation. Template and confirmation use the shared insets and title/action vocabulary; Create Task still uses the legacy modal, now tracked separately in #1426. The scenario used an isolated temporary application profile and discarded only its synthetic unsaved draft. No user template or task was modified.

The rebuilt combined candidate also passed native create/edit persistence in both themes. The scenario saved a Critical-priority template, reloaded, reopened Edit, verified its priority and Markdown, updated the Markdown, reloaded again, and verified the saved change. Successful Create and Update returned focus to their exact openers. Create Task then selected the saved template, inherited its Critical priority and edited description, created a real task, and found that task on the board. Two harness locators were corrected to use the input's accessible name and the template option's complete name plus description; no application changes were required. Only isolated synthetic records were created.

This closes the listed native Template checks, not full product acceptance. Final installed-app verification and maintained documentation images/GIFs remain outstanding. The installed app and its data have not been updated by this change.

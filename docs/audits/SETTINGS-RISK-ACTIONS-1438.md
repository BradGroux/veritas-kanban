# Settings skill-risk action layout

The skill-risk inventory uses a named, keyboard-focusable local scroll region. Its text-scaled minimum width keeps table columns readable without widening the Settings content area. Task and Exception actions retain their intrinsic widths and wrap between buttons, never within their labels.

## Verification contract

The browser regression in [settings-risk-actions.spec.ts](../../e2e/settings-risk-actions.spec.ts) exercises light and dark themes, normal and enlarged text, and constrained windows. It checks inner and outer containment, keyboard scrolling within the table, complete single-line action labels, Exception activation, and exact opener focus after dismissal. Fixture requests prevent real task creation or exception changes.

Packaged macOS verification must exercise the same visible behavior in the release candidate. A browser result does not establish native acceptance, and historical candidate checks do not establish a later build's correctness. Record candidate identities, results, and diagnostic artifacts with the relevant issue or release evidence rather than in this maintained layout contract.

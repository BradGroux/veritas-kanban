# Task workspace shell sizing

Scope: #1420, one presentation slice of #1385. This is not closure of the task-workspace audit or the desktop release gate.

## Behavior

The task drawer uses the shared task variant's 60rem width, bounded by the viewport. Expanding changes that same mounted drawer to viewport width; task state, active section, and scroll nodes are retained. Header actions wrap, and the header, navigation, section header, and scrolling body use one-rem insets. Mode headings use the shared heading component.

A named container query measures the task panel itself. At 48rem or less, labeled mode and section selectors replace the rail and tabs. This also accounts for increased root text size. Wider panels retain the rail and wrapping section tabs. The cosmetic numbered steps are removed because the five modes are destinations, not a required sequence.

Mantine owns Escape dismissal. The duplicate document listener is removed so dismissing a selector does not also dismiss the task. Existing nested-overlay guards remain.

## Acceptance and remaining work

Regression coverage exercises dark and light themes, 740px-wide panels, 900x480 with 20px root text, selector interaction and Escape, retained section selection, bounded controls, and the existing expanded-view scroll/focus path.

Verified locally:

- Shared build and web typecheck passed; changed web files passed ESLint and diff whitespace checks.
- Four distinct Chromium cases passed: expanded scroll/focus retention, dark and light responsive geometry with keyboard selector access, and an in-flight edit held through compact/expanded/restored presentations. The last case releases the real PATCH and verifies the edited title through a separate API GET.
- The first geometry run caught an implementation regression: the generic Drawer content class also reached its positioning wrapper. Moving the class to `classNames.content` corrected it; the same geometry checks then passed.
- Standards and spec reviews found no remaining implementation blockers. No workspace unit or coverage suite ran for this slice.

Browser checks used temporary test data and isolated API/web ports 3194/5194, then shut down. They do not constitute packaged macOS acceptance.

The existing Drawer primitive is deliberately retained in this slice. Shared overlay-stack migration, nested Template/Preview/Workflow surfaces, per-mode content convergence, and Task Chat remain under #1385/#1386. Packaged macOS acceptance (#1387) and all maintained documentation images/GIFs (#1388) remain pending. No installed application or release is updated by this change.

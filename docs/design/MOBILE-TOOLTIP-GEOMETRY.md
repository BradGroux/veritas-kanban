# Mobile tooltip geometry

Tracking: #1463 and #1467. Portaled tooltips must stay within the viewport without changing the document's layout width or displacing mobile navigation and Chat controls.

Use fixed positioning for tooltips, constrain their width to the viewport minus one rem, and wrap both ordinary text and unbroken references. Keep tooltip content and opening behavior intact. Do not hide overflowing content, shrink text, force clicks, or compensate with a higher navigation z-index.

The task-card hint has a delayed opening and an explicit width. At 320px with 20px root text, that width becomes 400px; its eight-pixel horizontal offset expanded the document to 408px. Fast interactions could finish before the hint appeared, while slower interactions displaced fixed controls. Limiting width alone did not pass the original Chat resize sequence; fixed positioning is also required.

`e2e/mobile-tooltip-viewport.spec.ts` waits for the delayed hint before opening a task status menu. It checks tooltip bounds and text overflow, samples viewport width every animation frame through status-menu and Chat open/close, and covers 320/430px screens with normal/enlarged text, including a long unbroken reference. The existing mobile Chat and viewport suites cover the original navigation and resize sequences.

Browser results do not replace integrated Linux QA, packaged native verification, refreshed documentation media, or release acceptance.

The geometry probe waits for the public Mobile navigation landmark before reading its surface. Navigation is independently lazy-loaded; a visible task status control does not prove navigation has mounted. A diagnostic gate on that module reproduced the previous null-element read before tooltip checks began. The maintained test uses the visible landmark as its prerequisite, without sleeps or module interception.

## Task status menus

Tracking: #1479. The task-card hint is suppressed while its status dropdown is open, regardless of pointer or keyboard entry. Dropdown lifecycle callbacks own this state; normal card hints remain available after the menu closes. This prevents a non-interactive hint from obscuring actionable option labels without changing tooltip stacking or status-change behavior.

`e2e/task-status-tooltip.spec.ts` opens the delayed hint, opens the status menu by pointer or keyboard, verifies the hint is absent, cancels with Escape, and returns to the hint on the same unchanged card. It then reopens the menu, changes status, and returns to the normal hint. Selecting an option must not open the task workspace.

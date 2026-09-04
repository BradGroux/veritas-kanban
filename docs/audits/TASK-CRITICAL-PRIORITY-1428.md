# Critical task priority API contract

The native Create Task check for #1426 selected Critical and received HTTP 400. Both task route schemas accepted only Low, Medium, and High even though the shared task type and UI already supported Critical. The POST and PATCH regressions failed with 400 before the fix.

Both schemas now consume the shared `TASK_PRIORITIES` tuple, and `TaskPriority` derives from the same tuple. This shared declaration matches the pending Template priority change in #1419. Medium remains the create default; unknown priorities remain invalid. No storage format or migration is changed.

The focused task-route integration suite passed all 56 tests, including Critical creation/update, unknown-priority rejection, and the omitted-priority default. Shared build, server typecheck, changed-file formatting, and lint passed; lint reported only existing warnings outside changed lines. Spec and standards reviews found no actionable issues.

The combined unsigned macOS candidate was rebuilt and the exact native Create Task scenario passed in light and dark themes at 1180×760 with 20px text. It created a Critical task through the real API in an isolated temporary profile and found the task again after reloading. A harness locator was corrected to match the task heading within the card, whose accessible name also includes type, priority, and readiness. The installed application and user data were not changed. This API fix does not complete the remaining UI audit or release acceptance.

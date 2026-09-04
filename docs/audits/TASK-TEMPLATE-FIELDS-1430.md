# Template task fields at creation

Issue #1430 was found during packaged macOS Create Task acceptance. A two-task blueprint previewed its subtasks and dependency correctly, but POST `/api/tasks` silently discarded both fields. The shared creation interface and task service already supported them; the route schema omitted them and stripped them during validation.

Creation now accepts optional `subtasks` and `blockedBy` using the same validation contracts as updates. The unchanged subtask schema is shared by POST and PATCH. There is no storage migration, priority change, or UI change in this slice.

Four new route regressions failed before the fix: valid fields never reached the service, and malformed subtasks, acceptance criteria, and dependency IDs were accepted instead of rejected. After the fix, all 60 tests in the combined candidate's exact task-route coverage file passed. Shared build, source server typecheck, changed-file formatting, and lint passed; lint retained five existing warnings. Separate specification and standards reviews found no actionable issues.

The unsigned packaged macOS candidate was rebuilt with this fix and the separate Critical-priority change in #1429. At the native minimum 1180×760, the light and dark checks selected a synthetic two-task blueprint, entered a custom variable, created real tasks through the API, and verified interpolated subtask titles, acceptance criteria, and the second task's dependency on the first task's actual ID. Reloading the app and inspecting its authenticated task-list response confirmed those same values persisted. Only template discovery was supplied by a test fixture; task creation and persistence were real in an isolated temporary application profile. An initial extra readback request lacked app authentication; the harness was corrected to observe the application's own reload response.

This native check is combined-candidate evidence, not standalone release or installed-app acceptance. The installed application and user data were unchanged. Full CI for the new combined revision, remaining UI consumers, maintained documentation media, and signed release acceptance remain separate work.

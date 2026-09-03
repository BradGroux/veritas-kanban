# Template priority contract

Issue: [#1417](https://github.com/BradGroux/veritas-kanban/issues/1417).

The shared task type allowed `critical`, but Template create, update, and blueprint validators accepted only `low`, `medium`, and `high`. The editor offered the unsupported value `urgent`. This made the highest-priority editor option unsavable and rejected otherwise valid critical templates.

`TASK_PRIORITIES` now supplies the existing four-value task contract to the type alias, Template validators, and editor options. No stored priorities are rewritten, and unsupported incoming values are still rejected rather than silently translated.

## Verification boundary

Shared build, server/web type checks, and changed-file lint passed. Independent specification and standards reviews found no blockers. Authored JSON route regressions cover create/update defaults and blueprints for all supported priorities and reject unsupported priorities in either location. An editor regression covers loading and saving the highest-priority value.

These tests are authored for the integration milestone, not claimed as executed in this implementation PR. The integrated Template form must combine the authoring work from #1384 and explicit optional-field clearing from #1415 before final browser and macOS acceptance. Documentation screenshots and GIFs remain part of the full UI audit closure.

When integrating #1415, retain nullable update-priority semantics; create and blueprint priorities remain non-nullable. When integrating #1384, remove obsolete tab navigation from the editor test because the authoring form becomes a single surface.

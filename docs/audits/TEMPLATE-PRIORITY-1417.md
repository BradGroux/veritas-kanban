# Template priority contract

Issue: [#1417](https://github.com/BradGroux/veritas-kanban/issues/1417).

The shared task type allowed `critical`, but Template create, update, and blueprint validators accepted only `low`, `medium`, and `high`. The editor offered the unsupported value `urgent`. This made the highest-priority editor option unsavable and rejected otherwise valid critical templates.

`TASK_PRIORITIES` now supplies the existing four-value task contract to the type alias, Template validators, and editor options. No stored priorities are rewritten, and unsupported incoming values are still rejected rather than silently translated.

## Verification boundary

Shared build, server/web type checks, and changed-file lint passed. Independent specification and standards reviews found no blockers. Authored JSON route regressions cover create/update defaults and blueprints for all supported priorities and reject unsupported priorities in either location. An editor regression covers loading and saving the highest-priority value.

The combined Template integration passed all 31 route/persistence tests and 11 editor tests, with the authoring work from #1384 and optional-field clearing from #1415 included. Production-editor browser scenarios passed in both themes. Combined candidate `a30e204b` subsequently passed full CI, critical coverage, browser QA, security gates, Docker contract, and all three unsigned desktop artifact jobs.

The rebuilt unsigned macOS candidate saved a Critical template, reloaded and reopened it, updated its Markdown, and verified the saved value again in both themes. Create Task inherited its Critical priority and updated description and created a real task with the separate task-priority API fix #1429 included. All records were synthetic in an isolated profile. Installed-app acceptance and maintained documentation screenshots/GIFs remain part of the full UI audit closure.

The main-branch integration retains nullable update-priority semantics; create and blueprint priorities remain non-nullable. The editor test uses the single-form authoring layout rather than obsolete tab navigation. Merge conflicts retained the shared priority import and the accepted parent audit evidence; no production behavior changed during that integration.

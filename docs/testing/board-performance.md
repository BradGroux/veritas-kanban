# Large-board performance

The board loads one compact card snapshot. Description previews are
limited to 400 characters. Checklist progress, artifact counts, attempt status and readiness
are calculated from the complete task on the server; transcripts, checklist text and
artifact bodies are loaded only when a task is opened. Search still matches the complete
description, title and ID. The full-task API and its existing summary view remain compatible.

Card projections have a separate query cache. A single snapshot preserves the complete
ordering context without combining pages fetched across concurrent updates. Task WebSocket
events and reconnection refresh the board. Moves use the revision in the card projection
and retain the complete filtered/unfiltered ordering context. Existing API pagination remains
available to other clients. The board avoids repeated full SQLite reads for each page.

Columns above 80 tasks use measured card heights and six rows of overscan on each side.
Focused and dragged cards stay mounted. Keyboard selection brings offscreen tasks into
view; Previous tasks and Next tasks controls make the remaining list available without
requiring a pointer. List items retain their position and total-count announcements.
Dependency lookups use one index for the complete task snapshot. Done metrics load for
mounted cards, not an entire large column.

## Baseline and candidate budgets

The retained 6.1.7 package (build `ed5094c6a5f9dd6958ceb952d8d018a40135bf33`, whole-app
SHA-256 `a23df6443940aff4d9b5013b97ab753b986a63f3bb15dc0d3a8c6aaace866f94`)
was measured on macOS arm64, with a 1360×900 content viewport and disposable SQLite
profiles. Fixtures use four columns, explicit positions, 4096-character descriptions,
and a dependency on the first To Do task for every fifth task. No operator data is used.

| Tasks | Load and render | Input p95 | Mounted cards | DOM elements | Decoded task bytes |
| ----: | --------------: | --------: | ------------: | -----------: | -----------------: |
|   100 |          191 ms |     25 ms |           100 |        2,446 |            433,029 |
| 1,000 |        1,634 ms |    238 ms |         1,000 |       19,370 |          4,330,119 |
| 5,000 |        5,682 ms |  1,068 ms |         5,000 |       94,566 |         21,654,519 |

These are single local samples, not statistical estimates. Input measures dispatch to two
animation frames for ten sequential selection operations. The 100/1,000 samples were
retained before that run was interrupted; the separate 5,000-task run completed. The
baseline package predates the audit's source-only commit; its package identity is explicit.

Candidate acceptance budgets, chosen before candidate measurements:

- Load and render: at most 1 second for 100, 2 seconds for 1,000, and 5 seconds for 5,000 tasks.
- Input p95: at most 100 ms for each dataset under the same two-frame method.
- At most 120 mounted cards at this viewport; scrolling or keyboard selection must not grow
  this count with total task count. Focus/drag retention is included in the budget.
- At most 6 MB decoded card data for 5,000 fixtures; no initial full-task list request.
- Full details, pointer/keyboard moves, filtered placement, distant keyboard selection,
  screen-reader list positions and realtime convergence must pass separately.

Run from the repository root with a clean build-bound candidate and a new output directory:

```bash
node --import tsx scripts/native-ui/board-performance.mjs /absolute/path/candidate.app /absolute/path/new-board-evidence
```

The runner uses only an isolated synthetic profile, stops its packaged server before seeding,
refuses to overwrite evidence, and asserts package identity and the budgets above. Report its exact revision,
version and package hash. Candidate measurements and native interaction acceptance remain
release evidence, separate from focused unit checks. A passing build is not a performance result.

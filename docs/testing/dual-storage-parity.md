# Dual-storage parity tests

The v5 SQLite rollout keeps file storage and SQLite behavior under the same test fixture until SQLite becomes the default backend.

## Fixture

- Versioned fixture: `server/src/__tests__/fixtures/dual-storage-parity/v5-rich-metadata.json`
- Current fixture version: `1`
- Covered data: rich task metadata, comments, subtasks, dependencies, settings, task templates, prompt registry usage, activity, status history, telemetry, task-scoped chat, and one workflow run.

## Test gate

Run the focused parity gate:

```sh
pnpm --filter @veritas-kanban/server test -- src/__tests__/storage/dual-storage-parity.test.ts
```

CI runs this gate explicitly after the workspace unit test suite. Add new v5 storage surfaces to the fixture and normalize only nondeterministic fields such as generated IDs, timestamps, and temp paths.

# QMD Search Foundation

Veritas Kanban v4.1 adds the first slice of QMD-backed retrieval: a server-side search abstraction and `POST /api/search` endpoint. QMD is optional; if it is unavailable, VK falls back to built-in keyword search across markdown files.

## Collections

The foundation searches these collections:

- `tasks-active` — `tasks/active/**/*.md`
- `tasks-archive` — `tasks/archive/**/*.md`
- `docs` — `docs/**/*.{md,mdx,txt}`

Raw telemetry is intentionally excluded.

## Backends

| Backend   | Behavior                                               |
| --------- | ------------------------------------------------------ |
| `keyword` | Built-in filename/content matching; no external binary |
| `qmd`     | Runs `qmd query --json` and falls back on failure      |
| `auto`    | Attempts QMD first, then keyword fallback              |

Default backend is `keyword`. Enable QMD globally with:

```bash
VERITAS_SEARCH_BACKEND=qmd
```

## Setup

Install QMD and create the initial collections:

```bash
npm install -g @tobilu/qmd
pnpm qmd:setup
```

Then start VK with QMD enabled:

```bash
VERITAS_SEARCH_BACKEND=qmd pnpm dev
```

Refresh the index after larger task/doc changes:

```bash
pnpm qmd:refresh
```

Set `VERITAS_QMD_SKIP_EMBED=true` to run `qmd update` without `qmd embed`.

## API

```bash
curl -X POST http://localhost:3001/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "semantic search duplicate detection",
    "limit": 10,
    "backend": "auto",
    "collections": ["tasks-active", "tasks-archive", "docs"]
  }'
```

The response includes `backend`, `degraded`, and optional `reason` fields so clients can show whether QMD or fallback search served the request.

## App UI

Open the search dialog from the header search icon or the command palette action named **Search Tasks and Docs**. The dialog can query active tasks, archived tasks, and docs, and it shows whether the response came from QMD or keyword fallback.

Task results open directly in the board detail panel when the result path maps to a task markdown file.

## Duplicate Detection

The create-task dialog checks active and archived task collections after the title has enough signal. Possible matches are shown inline and can be opened for inspection, but task creation remains available so intentional follow-up work is not blocked.

## VERITAS Context Injection

VERITAS chat sends retrieve compact supporting context from active tasks, archived tasks, and docs before calling the gateway. The original user message is still saved unchanged; retrieved context is appended only to the gateway prompt inside a `<veritas_context>` block with source paths.

Clients can opt out per chat send by passing `includeContext: false`.

## Index Maintenance

The authenticated API exposes `POST /api/search/index/refresh` for operators and automation. Send `{ "embed": false }` to update collections without recomputing embeddings.

## Next v4.1 PRs

- Add deployment-specific schedules as needed with `pnpm qmd:refresh` or `POST /api/search/index/refresh`.

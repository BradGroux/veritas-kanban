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
scripts/qmd/setup-veritas-qmd.sh
```

Then start VK with QMD enabled:

```bash
VERITAS_SEARCH_BACKEND=qmd pnpm dev
```

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

## Next v4.1 PRs

- Duplicate detection hints during task creation
- VERITAS context injection
- Scheduled QMD update/embed maintenance

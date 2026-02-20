# Tips & Tricks - Power User Features

Little things that keep Veritas Kanban fast when you live in it all day.

---

## CLI Shortcuts

| Command                     | What it does                                                     |
| --------------------------- | ---------------------------------------------------------------- |
| `vk setup`                  | Guided environment check + optional sample task creation.        |
| `vk begin <id>`             | Sets status → in-progress, starts timer, agent status → working. |
| `vk done <id> "summary"`    | Stops timer, sets done, posts summary, agent status → idle.      |
| `vk block <id> "reason"`    | Blocks task + leaves blocker comment.                            |
| `vk unblock <id>`           | Restarts timer and sets in-progress.                             |
| `vk time`                   | Shows today's breakdown (per task + total).                      |
| `vk summary standup --text` | Generates markdown standup summary.                              |

Pipe outputs to `jq` or `fzf` for custom dashboards.

---

## Keyboard Shortcuts (Web)

| Shortcut           | Action                                          |
| ------------------ | ----------------------------------------------- |
| `Cmd/Ctrl + K`     | Command palette (jump to projects/tasks/views). |
| Arrow keys + Enter | Navigate board cards → open detail panel.       |
| `Esc`              | Close modals/panels quickly.                    |
| `/`                | Focus global search (from palette).             |

> Command palette replaces the old shortcuts dialog - type to filter actions, tasks, or navigation targets.

---

## Command Palette Power Moves

- Type `create` to spawn new tasks anywhere.
- Type `filter` to jump between saved filters (Today, Blocked, etc.).
- Use `>` to execute actions (">start timer task_123").

---

## WebSocket Awareness

- Connection status indicator (header) shows live state.
- When offline, the app increases polling frequency; you can throttle it in Settings → Data.
- Use `/api/health` + WebSocket inspector to debug proxies.

---

## MCP Server & Claude Desktop

1. Build once: `cd mcp && pnpm build`
2. Configure Claude Desktop `settings.json`:
   ```json
   {
     "command": "node",
     "args": ["/path/to/veritas-kanban/mcp/dist/index.js"],
     "env": {
       "VK_API_URL": "http://localhost:3001",
       "VK_API_KEY": "<admin-key>"
     }
   }
   ```
3. Claude can now list tasks, create tasks, and update statuses via MCP.

Combine MCP + prompt registry to let Claude act as your PM.

---

## Git Worktree Integration

- Start a worktree from any task via the UI ("Create worktree").
- Branch naming follows `tasks/task_<id>` pattern - align commit messages with `[author: model]` tags.
- Use `scripts/git-sync.sh` (if configured) to push to multiple remotes.

---

## Obsidian / Knowledge Vault Integration

- Store deliverables under `Brain/dm-bg/...` (or your equivalent) using `scripts/brain-write.sh` to mirror workspace ↔ Brain.
- Link from tasks: `See Brain/dm-bg/projects/...` for quick retrieval.
- For bidirectional linking, mirror CLAUDE/AGENTS updates back into the vault after each sprint.

---

## Miscellaneous Quality-of-Life

- **Dev cleanup:** `pnpm dev:clean` frees hung ports/watchers.
- **Watchdog:** `pnpm dev:watchdog` auto-restarts when `/api/health` fails.
- **Archive page:** Use the full-page Archive (accessible from board navigation) instead of the sidebar for faster search and filtering.
- **Notifications:** Configure Teams/Slack/webhooks once; agents can trigger them via the API.

---

## v3.3.0 Features

| Feature                       | Quick Usage                                                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task dependencies**         | Set `depends_on`/`blocks` in task detail → Dependencies section. API: `GET /api/tasks/:id/dependencies` for the full graph.                  |
| **Crash-recovery checkpoint** | `POST /api/tasks/:id/checkpoint` to save state; `GET` to resume. Secrets auto-sanitized. 24h expiry.                                         |
| **Observational memory**      | `POST /api/observations` with type (decision/blocker/insight/context) + importance (1–10). Search: `GET /api/observations/search?query=...`. |
| **Agent filter**              | `GET /api/tasks?agent=codex` — filter tasks by assigned agent name.                                                                          |

---

## Workflow Engine (v3.0)

- Define pipelines as YAML in `.veritas-kanban/workflows/`.
- Start runs: `POST /api/workflows/:id/runs`.
- Monitor live in the **Workflows** tab or Dashboard.
- Use tool policies to restrict agent permissions per step.
- See [WORKFLOW-GUIDE.md](WORKFLOW-GUIDE.md) for full details.

Know a trick that belongs here? Add it and mirror to the knowledge base so agents learn it too.

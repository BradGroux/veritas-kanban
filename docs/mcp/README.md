# MCP Server — Veritas Kanban

> **26 tools · 6 categories · stdio transport · zero external dependencies**

The Veritas Kanban MCP server lets any [Model Context Protocol](https://modelcontextprotocol.io/) client — Claude Desktop, OpenClaw, Cursor, Cline, or your own tooling — manage tasks, sprints, agents, automation, notifications, and summaries through a single stdio process.

---

## Table of Contents

- [When to Use the MCP Server](#when-to-use-the-mcp-server)
- [Architecture](#architecture)
- [Quickstart](#quickstart)
  - [Local Development](#local-development)
  - [Production](#production)
- [Configuration Reference](#configuration-reference)
- [Tool Catalog](#tool-catalog)
  - [Task Management (6 tools)](#task-management-6-tools)
  - [Agent Control (2 tools)](#agent-control-2-tools)
  - [Automation (4 tools)](#automation-4-tools)
  - [Notifications (3 tools)](#notifications-3-tools)
  - [Summaries (2 tools)](#summaries-2-tools)
  - [Sprint Management (9 tools)](#sprint-management-9-tools)
- [Resources](#resources)
- [Security Model](#security-model)
- [Error Handling & Troubleshooting](#error-handling--troubleshooting)
- [Observability & Telemetry](#observability--telemetry)
- [Versioning & Compatibility](#versioning--compatibility)
- [FAQ](#faq)

---

## When to Use the MCP Server

Use the MCP server when:

- Your AI assistant (Claude Desktop, Cursor, etc.) needs **structured tool access** to VK — not raw HTTP calls.
- You want **one process** that exposes all 26 VK operations with typed inputs and validated outputs.
- You're building **agent orchestration** and need task/sprint/automation lifecycle management over MCP.

Don't use it when:

- You just need a quick REST call — use the [REST API](../API-WORKFLOWS.md) directly.
- You're building a web frontend — use the HTTP API with the TypeScript client.
- You need WebSocket streaming — the MCP server uses stdio, not SSE/WS.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  MCP Client (Claude Desktop / OpenClaw / etc.)  │
└──────────────────────┬──────────────────────────┘
                       │ stdio (JSON-RPC)
                       ▼
┌──────────────────────────────────────────────────┐
│  MCP Server Process  (mcp/dist/index.js)         │
│                                                  │
│  ┌────────────┐  ┌────────────┐  ┌───────────┐  │
│  │ Tool       │  │ Resource   │  │ Transport  │  │
│  │ Registry   │  │ Provider   │  │ (stdio)    │  │
│  │ (26 tools) │  │ (kanban:// │  │            │  │
│  │            │  │  URIs)     │  │            │  │
│  └──────┬─────┘  └──────┬─────┘  └───────────┘  │
│         │               │                        │
│         └───────┬───────┘                        │
│                 ▼                                 │
│         ┌──────────────┐                         │
│         │ HTTP Client  │                         │
│         │ → VK Server  │                         │
│         └──────┬───────┘                         │
└────────────────┼─────────────────────────────────┘
                 │ HTTP (localhost:3001)
                 ▼
┌──────────────────────────────────────────────────┐
│  Veritas Kanban Server (Express/Hono)            │
│  REST API · Task Store · Sprint Engine           │
└──────────────────────────────────────────────────┘
```

**Key design decisions:**

- **Stdio transport only** — the MCP server is a child process of the client. No network ports opened.
- **Stateless proxy** — every tool call translates to one or more HTTP requests to the VK server. The MCP process holds no state.
- **Zod validation** — all tool inputs are validated with Zod schemas before hitting the API.
- **@modelcontextprotocol/sdk v1.27** — uses the official TypeScript SDK.

---

## Quickstart

### Prerequisites

- Node.js ≥ 18
- The Veritas Kanban server running (`pnpm dev` or production)
- pnpm (for building from source)

### Local Development

```bash
# 1. Start the VK server
cd veritas-kanban
pnpm dev                          # Server on http://localhost:3001

# 2. Build the MCP server
cd mcp
pnpm build                        # Outputs to mcp/dist/

# 3. Configure your MCP client
```

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "veritas-kanban": {
      "command": "node",
      "args": ["/absolute/path/to/veritas-kanban/mcp/dist/index.js"],
      "env": {
        "VK_API_URL": "http://localhost:3001"
      }
    }
  }
}
```

For **Cursor**, add the same block to `.cursor/mcp.json` in your project root.

For **OpenClaw**, add to your OpenClaw MCP config:

```json
{
  "mcpServers": {
    "veritas-kanban": {
      "command": "node",
      "args": ["/absolute/path/to/veritas-kanban/mcp/dist/index.js"],
      "env": {
        "VK_API_URL": "http://localhost:3001"
      }
    }
  }
}
```

**Verify it works:**

```bash
# Quick smoke test — run the MCP server directly and send a tools/list request
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  VK_API_URL=http://localhost:3001 node mcp/dist/index.js 2>/dev/null | \
  head -1 | jq '.result.tools | length'
# Expected output: 26
```

### Production

When running VK behind a reverse proxy (nginx/Caddy):

```json
{
  "mcpServers": {
    "veritas-kanban": {
      "command": "node",
      "args": ["/opt/veritas-kanban/mcp/dist/index.js"],
      "env": {
        "VK_API_URL": "https://kanban.yourdomain.com",
        "VK_API_KEY": "your-agent-api-key"
      }
    }
  }
}
```

> **Important:** In production, always set `VK_API_KEY` so the MCP server authenticates with the VK API. Without it, requests rely on localhost bypass (which won't work remotely).

---

## Configuration Reference

The MCP server is configured via environment variables passed from the MCP client config.

| Variable     | Default                 | Description                                                         |
| ------------ | ----------------------- | ------------------------------------------------------------------- |
| `VK_API_URL` | `http://localhost:3001` | Base URL of the Veritas Kanban server                               |
| `VK_API_KEY` | _(none)_                | API key for authenticated requests. Required when not on localhost. |

### VK Server Environment Variables (relevant to MCP)

These are set in `server/.env`, not in the MCP client config:

| Variable                        | Default                     | Description                                                        |
| ------------------------------- | --------------------------- | ------------------------------------------------------------------ |
| `PORT`                          | `3001`                      | Server port                                                        |
| `VERITAS_AUTH_ENABLED`          | `true`                      | Enable/disable authentication                                      |
| `VERITAS_AUTH_LOCALHOST_BYPASS` | `true`                      | Allow unauthenticated localhost requests                           |
| `VERITAS_AUTH_LOCALHOST_ROLE`   | `read-only`                 | Role for unauthenticated localhost (`read-only`, `agent`, `admin`) |
| `VERITAS_ADMIN_KEY`             | _(required)_                | Admin API key (≥ 32 characters)                                    |
| `VERITAS_API_KEYS`              | _(none)_                    | Additional API keys. Format: `name:key:role,name2:key2:role2`      |
| `CORS_ORIGINS`                  | `http://localhost:3000,...` | Allowed CORS origins                                               |
| `TRUST_PROXY`                   | _(unset)_                   | Set when behind a reverse proxy                                    |

### Auth Modes

| Mode                 | Config                                                           | Use Case                                             |
| -------------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| **Localhost bypass** | `VERITAS_AUTH_LOCALHOST_BYPASS=true`                             | Local development. MCP server on same machine as VK. |
| **API key (agent)**  | `VK_API_KEY=<key>` + key in `VERITAS_API_KEYS` with `agent` role | Production. MCP server may be remote.                |
| **API key (admin)**  | `VK_API_KEY=<admin-key>`                                         | Full access. Use sparingly.                          |
| **Auth disabled**    | `VERITAS_AUTH_ENABLED=false`                                     | Testing only. Never in production.                   |

**Recommended default:** Localhost bypass for local dev, `agent`-role API key for production.

---

## Tool Catalog

### Task Management (6 tools)

| Tool           | Description                             | Required Inputs | Key Options                                                               |
| -------------- | --------------------------------------- | --------------- | ------------------------------------------------------------------------- |
| `list_tasks`   | List all tasks, optionally filtered     | _(none)_        | `status`, `type`, `project`, `sprint`                                     |
| `get_task`     | Get task by ID (supports partial match) | `id`            | —                                                                         |
| `create_task`  | Create a new task                       | `title`         | `type`, `priority`, `project`, `sprint`                                   |
| `update_task`  | Update task fields                      | `id`            | `title`, `description`, `status`, `type`, `priority`, `project`, `sprint` |
| `archive_task` | Archive a completed task                | `id`            | —                                                                         |
| `delete_task`  | Permanently delete a task               | `id`            | —                                                                         |

<details>
<summary><strong>Examples</strong></summary>

**List high-priority tasks:**

```json
{
  "name": "list_tasks",
  "arguments": { "status": "in-progress", "project": "rubicon" }
}
```

→ Returns JSON array of matching tasks.

**Create a task:**

```json
{
  "name": "create_task",
  "arguments": {
    "title": "Fix auth token refresh",
    "type": "code",
    "priority": "high",
    "project": "rubicon",
    "sprint": "sprint-1"
  }
}
```

→ Returns `Task created: task_20260302_abc123\n{...task JSON...}`

**Update task status:**

```json
{
  "name": "update_task",
  "arguments": { "id": "abc123", "status": "done" }
}
```

→ Partial IDs work — matches the last 6+ characters.

</details>

#### Input Enums

- **status:** `todo` · `in-progress` · `blocked` · `done`
- **type:** `code` · `research` · `content` · `automation`
- **priority:** `low` · `medium` · `high`

---

### Agent Control (2 tools)

| Tool          | Description                    | Required Inputs | Key Options                                         |
| ------------- | ------------------------------ | --------------- | --------------------------------------------------- |
| `start_agent` | Start a coding agent on a task | `id`            | `agent` (`claude-code`, `amp`, `copilot`, `gemini`) |
| `stop_agent`  | Stop a running agent           | `id`            | —                                                   |

> **Constraints:** Only works on tasks with `type: "code"` that already have a git worktree attached.

<details>
<summary><strong>Examples</strong></summary>

**Start Claude Code on a task:**

```json
{
  "name": "start_agent",
  "arguments": { "id": "abc123", "agent": "claude-code" }
}
```

→ Returns attempt ID and worktree path.

**Stop a running agent:**

```json
{
  "name": "stop_agent",
  "arguments": { "id": "abc123" }
}
```

</details>

---

### Automation (4 tools)

| Tool                      | Description                          | Required Inputs | Key Options        |
| ------------------------- | ------------------------------------ | --------------- | ------------------ |
| `list_pending_automation` | List tasks pending automation        | _(none)_        | —                  |
| `list_running_automation` | List currently executing automations | _(none)_        | —                  |
| `start_automation`        | Start automation for a task          | `id`            | `sessionKey`       |
| `complete_automation`     | Mark automation complete or failed   | `id`            | `result`, `failed` |

<details>
<summary><strong>Examples</strong></summary>

**Start automation:**

```json
{
  "name": "start_automation",
  "arguments": { "id": "abc123" }
}
```

→ Returns task title, attempt ID, and description.

**Mark as failed:**

```json
{
  "name": "complete_automation",
  "arguments": { "id": "abc123", "result": "Timeout after 30s", "failed": true }
}
```

</details>

---

### Notifications (3 tools)

| Tool                        | Description                            | Required Inputs            | Key Options |
| --------------------------- | -------------------------------------- | -------------------------- | ----------- |
| `create_notification`       | Create a notification (Teams delivery) | `type`, `title`, `message` | `taskId`    |
| `get_pending_notifications` | Get pending notifications              | _(none)_                   | —           |
| `check_notifications`       | Scan tasks and create notifications    | _(none)_                   | —           |

#### Notification Types

`info` · `error` · `milestone` · `high_priority` · `agent_complete` · `agent_failed` · `needs_review` · `task_done`

<details>
<summary><strong>Examples</strong></summary>

**Create a milestone notification:**

```json
{
  "name": "create_notification",
  "arguments": {
    "type": "milestone",
    "title": "Sprint 3 Complete",
    "message": "All 12 tasks archived. Velocity: 34 points.",
    "taskId": "abc123"
  }
}
```

</details>

---

### Summaries (2 tools)

| Tool                 | Description                                             | Required Inputs | Key Options           |
| -------------------- | ------------------------------------------------------- | --------------- | --------------------- |
| `get_summary`        | Board overview (status counts, projects, high-priority) | _(none)_        | —                     |
| `get_memory_summary` | Task summary formatted for agent memory files           | _(none)_        | `hours` (default: 24) |

<details>
<summary><strong>Examples</strong></summary>

**Get last 48 hours of activity:**

```json
{
  "name": "get_memory_summary",
  "arguments": { "hours": 48 }
}
```

→ Returns markdown-formatted summary (completed tasks, active high-priority, project progress).

</details>

---

### Sprint Management (9 tools)

| Tool                      | Description                           | Required Inputs | Key Options                        |
| ------------------------- | ------------------------------------- | --------------- | ---------------------------------- |
| `list_sprints`            | List all sprints                      | _(none)_        | `includeHidden`                    |
| `get_sprint`              | Get sprint by ID                      | `id`            | —                                  |
| `create_sprint`           | Create a new sprint                   | `label`         | `description`                      |
| `update_sprint`           | Update sprint fields                  | `id`            | `label`, `description`, `isHidden` |
| `delete_sprint`           | Delete a sprint                       | `id`            | `force`                            |
| `can_delete_sprint`       | Check if sprint can be deleted        | `id`            | —                                  |
| `reorder_sprints`         | Reorder sprints                       | `orderedIds`    | —                                  |
| `get_archive_suggestions` | Sprints ready to archive              | _(none)_        | —                                  |
| `close_sprint`            | Archive all completed tasks in sprint | `id`            | —                                  |

<details>
<summary><strong>Examples</strong></summary>

**Create a sprint:**

```json
{
  "name": "create_sprint",
  "arguments": { "label": "Sprint 4", "description": "Auth hardening & MCP docs" }
}
```

**Safe delete check:**

```json
{
  "name": "can_delete_sprint",
  "arguments": { "id": "sprint-3" }
}
```

→ Returns `{ "canDelete": true, "referenceCount": 0 }` or tells you how many tasks still reference it.

**Close a sprint (archive completed tasks):**

```json
{
  "name": "close_sprint",
  "arguments": { "id": "sprint-3" }
}
```

→ Returns count and IDs of archived tasks.

</details>

---

## Resources

The MCP server also exposes **MCP Resources** — read-only data accessible via `kanban://` URIs:

| URI                     | Description                                  |
| ----------------------- | -------------------------------------------- |
| `kanban://tasks`        | All tasks (JSON)                             |
| `kanban://tasks/active` | Tasks with status `in-progress` or `blocked` |
| `kanban://task/{id}`    | Individual task by ID                        |

Resources are useful for MCP clients that support resource browsing (e.g., Claude Desktop's resource panel).

---

## Security Model

### Principle of Least Privilege

1. **Use `agent` role, not `admin`.** The `agent` role can create/update/archive tasks and run automations. It cannot manage users or server config.
2. **One key per integration.** Create separate API keys for each MCP client:
   ```
   VERITAS_API_KEYS=cursor-mcp:vk_cur_abc:agent,claude-desktop:vk_cd_xyz:agent
   ```
3. **Localhost bypass is for dev only.** In production, disable it: `VERITAS_AUTH_LOCALHOST_BYPASS=false`.

### Token Boundaries

- API keys are passed via the `Authorization: Bearer <key>` header.
- The MCP server reads `VK_API_KEY` from its environment and includes it in every HTTP request to VK.
- Keys never appear in MCP tool inputs/outputs — they stay in the transport layer.

### What the MCP Server Cannot Do

- **No direct file access** — all operations go through the VK REST API.
- **No shell execution** — the `start_agent` tool tells VK to start an agent; it doesn't spawn processes itself.
- **No outbound network** — the MCP server only talks to `VK_API_URL`. It has no internet access.

---

## Error Handling & Troubleshooting

### Error Response Format

All tool errors return:

```json
{
  "content": [{ "type": "text", "text": "Error: <message>" }],
  "isError": true
}
```

### Common Errors

| Error                                 | Cause                                        | Fix                                                                      |
| ------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| `Task not found: abc123`              | ID doesn't match any task                    | Check the ID — partial match needs ≥ 6 characters                        |
| `Can only start agents on code tasks` | Tried `start_agent` on a non-code task       | Change task type to `code` first                                         |
| `Task needs a worktree first`         | `start_agent` on a task without git worktree | Create a worktree via the VK UI or API before starting an agent          |
| `fetch failed` / `ECONNREFUSED`       | VK server not running                        | Start the server: `pnpm dev`                                             |
| `401 Unauthorized`                    | Invalid or missing API key                   | Check `VK_API_KEY` in MCP config and `VERITAS_API_KEYS` in server `.env` |
| `Unknown tool: <name>`                | Typo in tool name                            | Check the [Tool Catalog](#tool-catalog) for exact names                  |

### Debugging

```bash
# Run MCP server with stderr visible (it logs to stderr)
VK_API_URL=http://localhost:3001 node mcp/dist/index.js

# Test a specific tool via stdin
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_tasks","arguments":{}}}' | \
  VK_API_URL=http://localhost:3001 node mcp/dist/index.js 2>/dev/null | jq .

# Check VK server health
curl -s http://localhost:3001/api/health | jq .
```

---

## Observability & Telemetry

The MCP server itself is stateless and does not emit telemetry. Observability comes from the VK server:

- **Telemetry events** — `run.started`, `run.completed`, `run.tokens` events via `/api/telemetry/events`.
- **Time tracking** — `/api/tasks/{id}/time/start` and `/api/tasks/{id}/time/stop`.
- **Agent status** — `/api/agent/status` shows active agents on the VK dashboard.
- **Squad chat** — `/api/chat/squad` for agent coordination messages.

Configure telemetry retention in `server/.env`:

| Variable                   | Default | Description                                  |
| -------------------------- | ------- | -------------------------------------------- |
| `TELEMETRY_RETENTION_DAYS` | `30`    | Days to keep event files                     |
| `TELEMETRY_COMPRESS_DAYS`  | `7`     | Days before NDJSON files are gzip-compressed |

---

## Versioning & Compatibility

| Component          | Version      | Notes                       |
| ------------------ | ------------ | --------------------------- |
| MCP server package | `3.3.3`      | Matches VK server version   |
| MCP SDK            | `1.27.1`     | `@modelcontextprotocol/sdk` |
| MCP protocol       | `2024-11-05` | Latest stable spec          |
| Node.js            | `≥ 18`       | ES modules required         |
| TypeScript         | `5.7+`       | Build dependency only       |

**Breaking change policy:**

- Tool names and required inputs are stable within a major version.
- New tools may be added in minor versions.
- Tool removal or input schema changes only happen in major versions.
- The MCP server version tracks the VK server version (`@veritas-kanban/mcp`).

---

## FAQ

**Q: Does the MCP server need its own port?**
No. It communicates via stdio (stdin/stdout). The MCP client spawns it as a child process. No ports needed.

**Q: Can I run multiple MCP server instances?**
Yes. Each MCP client spawns its own instance. They're stateless — no coordination needed.

**Q: What happens if the VK server is down?**
Tool calls will fail with connection errors (`ECONNREFUSED`). The MCP server stays alive and will work again once VK is reachable.

**Q: Can I use this with non-Claude MCP clients?**
Yes. Any MCP-compatible client works — Cursor, Cline, Continue, Zed, or custom implementations. The config format may differ slightly per client.

**Q: How do I add a new tool?**

1. Create or edit a file in `mcp/src/tools/`.
2. Define the tool schema and handler.
3. Export from the module and import in `mcp/src/index.ts`.
4. Rebuild: `cd mcp && pnpm build`.

**Q: Is there an SSE/HTTP transport option?**
Not currently. The server uses stdio only. If you need HTTP transport, use the VK REST API directly.

**Q: How do partial task IDs work?**
The `findTask` utility matches the last N characters of a task ID (minimum 6). If multiple tasks match, it returns the first match. Use more characters for precision.

---

_Last updated: 2026-03-02 · VK v3.3.3 · 26 tools / 6 categories_

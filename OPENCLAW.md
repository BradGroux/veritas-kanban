# OPENCLAW.md — Veritas Kanban Integration for Open Claw VM Agents

Instructions for AI agents running in an Open Claw macOS virtual machine that need to use the Veritas Kanban board hosted on the physical Mac, connected via Tailscale.

---

## Network Topology

```
Mac Host (physical)                     Open Claw VM (macOS)
┌────────────────────────────────┐     ┌──────────────────────────────┐
│ Veritas Kanban Server :3001    │     │ Claude / Agent               │
│ ├─ /api/*    REST API          │     │ ├─ CLI (vk)                  │
│ ├─ /ws       WebSocket         │◀────┤ ├─ MCP server (stdio)        │
│ └─ /*        SPA (web UI)      │ TS  │ └─ Direct HTTP (curl)        │
│                                │     └──────────────────────────────┘
│ Tailscale Serve                │
│ /kanban → localhost:3001       │     Both machines on the same
└────────────────────────────────┘     Tailscale tailnet
```

All communication is HTTPS over Tailscale. No shared filesystem required.

---

## Connection Details

| Setting          | Value                                       |
| ---------------- | ------------------------------------------- |
| **API base URL** | `https://<host>.ts.net/kanban/api`          |
| **WebSocket**    | `wss://<host>.ts.net/kanban/ws`             |
| **Web UI**       | `https://<host>.ts.net/kanban`              |
| **Auth header**  | `Authorization: Bearer <VERITAS_ADMIN_KEY>` |
| **Alt header**   | `X-API-Key: <VERITAS_ADMIN_KEY>`            |

Replace `<host>.ts.net` with the Mac's Tailscale hostname (e.g. `s-macbook-pro.tailb94fe6.ts.net`).

---

## Environment Variables

Set these in your shell profile (`~/.zshrc`) or agent config on the VM:

```bash
export VK_API_URL=https://<host>.ts.net/kanban/api
export VK_API_KEY=<admin-key-from-host-env>
```

The admin key is the `VERITAS_ADMIN_KEY` value from the host's `.env` file.

---

## Integration Methods

### Option 1: MCP Server (recommended for Claude agents)

Add to the agent's MCP configuration (`~/.claude/mcp.json` or project-level):

```json
{
  "mcpServers": {
    "veritas-kanban": {
      "command": "node",
      "args": ["/path/to/veritas-kanban/mcp/dist/index.js"],
      "env": {
        "VK_API_URL": "https://<host>.ts.net/kanban/api",
        "VK_API_KEY": "<admin-key>"
      }
    }
  }
}
```

The MCP server runs as a local stdio process on the VM and connects to the kanban API over HTTPS via Tailscale.

**Available tools:** `list_tasks`, `get_task`, `create_task`, `update_task`, `archive_task`, `delete_task`, `start_agent`, `stop_agent`, `get_summary`

**Available resources:** `kanban://tasks`, `kanban://tasks/active`, `kanban://task/{id}`

### Option 2: CLI

Install the CLI on the VM:

```bash
cd /path/to/veritas-kanban/cli && npm link
```

Then use composite workflow commands:

```bash
vk begin <id>              # Claim task: status→in-progress, start timer, agent→working
vk done <id> "summary"     # Complete: stop timer, status→done, add summary, agent→idle
vk block <id> "reason"     # Block with reason
vk unblock <id>            # Unblock and resume

vk list --status todo --json   # List available tasks
vk show <id> --json            # Get task details
```

### Option 3: Direct HTTP

```bash
HOST=https://<host>.ts.net/kanban/api
KEY=<admin-key>

# List tasks
curl -s -H "Authorization: Bearer $KEY" $HOST/tasks

# Update task status
curl -s -X PATCH -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "in-progress"}' \
  $HOST/tasks/<task-id>
```

---

## Agent Lifecycle

### 1. Register on startup

```bash
curl -X POST $VK_API_URL/agents/register \
  -H "Authorization: Bearer $VK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "openclaw-vm",
    "name": "OPENCLAW",
    "model": "anthropic/claude-opus-4-6",
    "provider": "anthropic",
    "capabilities": [
      {"name": "code", "description": "Write and review code"},
      {"name": "research", "description": "Deep research and analysis"}
    ],
    "version": "1.0.0"
  }'
```

### 2. Heartbeat every 2-3 minutes

```bash
curl -X POST $VK_API_URL/agents/register/openclaw-vm/heartbeat \
  -H "Authorization: Bearer $VK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "busy",
    "currentTaskId": "<task-id>",
    "currentTaskTitle": "Working on feature X"
  }'
```

If no heartbeat is received for 5 minutes, the agent is automatically marked `offline`.

| Status    | Meaning                        |
| --------- | ------------------------------ |
| `online`  | Available for work             |
| `busy`    | Actively working on a task     |
| `idle`    | Running but not doing anything |
| `offline` | No heartbeat for 5+ min (auto) |

### 3. Deregister on shutdown

```bash
curl -X DELETE $VK_API_URL/agents/register/openclaw-vm \
  -H "Authorization: Bearer $VK_API_KEY"
```

---

## Task Workflow

Full lifecycle for picking up and completing a task:

```
1. Pick task    vk list --status todo --json
2. Claim        vk begin <id>
3. Work         (do the actual work)
4. Update       vk update <id> --add-comment "progress note"
5. Complete     vk done <id> "what was done and why"
```

The `vk begin` command handles: status change, timer start, agent status update, and `run.started` telemetry.

The `vk done` command handles: timer stop, status change, completion summary, agent idle, and `run.completed` telemetry.

---

## Telemetry (required for dashboard)

The dashboard graphs (Success Rate, Token Usage, Run Duration) depend on `run.*` events that agents must emit manually. If you use `vk begin`/`vk done`, this is handled automatically. For direct HTTP integration:

```bash
# When starting work
curl -X POST $VK_API_URL/telemetry/events \
  -H "Authorization: Bearer $VK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"run.started","taskId":"<id>","agent":"openclaw-vm"}'

# When completing work
curl -X POST $VK_API_URL/telemetry/events \
  -H "Authorization: Bearer $VK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"run.completed","taskId":"<id>","agent":"openclaw-vm","durationMs":120000,"success":true}'

# Report token usage
curl -X POST $VK_API_URL/telemetry/events \
  -H "Authorization: Bearer $VK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"run.tokens","taskId":"<id>","agent":"openclaw-vm","model":"anthropic/claude-opus-4-6","inputTokens":5000,"outputTokens":2000,"cacheTokens":0,"cost":0.12}'
```

---

## Connectivity Check

Run from the VM to verify everything works:

```bash
# Test API access
curl -s -H "Authorization: Bearer $VK_API_KEY" \
  $VK_API_URL/tasks | python3 -m json.tool | head -20

# Test WebSocket (should print incoming messages)
wscat -c "wss://<host>.ts.net/kanban/ws?api_key=$VK_API_KEY"
```

---

## Troubleshooting

| Symptom                    | Cause                          | Fix                                                                |
| -------------------------- | ------------------------------ | ------------------------------------------------------------------ |
| `Connection refused`       | Server not running on host     | Start with `node server/dist/index.js` on Mac                      |
| `404` on API calls         | Tailscale Serve not configured | Run `tailscale serve --set-path /kanban -bg localhost:3001` on Mac |
| `401 Unauthorized`         | Wrong or missing API key       | Check `VK_API_KEY` matches `VERITAS_ADMIN_KEY` in host `.env`      |
| `403 CORS rejected`        | Origin not in allowed list     | Add the Tailscale hostname to `CORS_ORIGINS` in host `.env`        |
| Tailscale hostname unknown | VM not on same tailnet         | Run `tailscale status` on both machines to verify                  |
| WebSocket won't connect    | Wrong URL or missing auth      | Use `wss://<host>/kanban/ws?api_key=<key>`                         |

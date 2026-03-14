# Self-Hosting Veritas Kanban via Tailscale Serve

This guide covers hosting the kanban board on your Mac and connecting an AI agent (Open Claw) from a VM over Tailscale.

---

## Prerequisites

- Node.js 22+, pnpm 9+
- Tailscale installed and connected on both Mac and VM
- The kanban project built (`pnpm install && pnpm build`)

---

## Mac Host Setup

### 1. Build with Tailscale base path

```bash
cd /path/to/veritas-kanban
pnpm --filter shared build
VITE_BASE_PATH=/kanban/ pnpm --filter web build
pnpm --filter server build
```

The `VITE_BASE_PATH` ensures all asset, API, and WebSocket URLs are prefixed with `/kanban/` so they route correctly through Tailscale Serve.

### 2. Generate an admin API key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Save this key — you'll need it on both the Mac and the VM.

### 3. Configure environment

Create a `.env` file in the project root:

```bash
PORT=3001
NODE_ENV=production
TRUST_PROXY=1

VERITAS_ADMIN_KEY=<paste-your-generated-key>
VERITAS_AUTH_ENABLED=true
VERITAS_AUTH_LOCALHOST_BYPASS=true
VERITAS_AUTH_LOCALHOST_ROLE=admin

CORS_ORIGINS=https://<your-machine>.ts.net,http://localhost:3000

LOG_LEVEL=info
```

Replace `<your-machine>.ts.net` with your actual Tailscale hostname (e.g. `s-macbook-pro.tailb94fe6.ts.net`).

### 4. Start the server

```bash
node server/dist/index.js
```

Verify it's running:

```bash
curl http://localhost:3001/health
```

### 5. Register the Tailscale Serve route

```bash
# macOS path — adjust if Tailscale is installed elsewhere
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve \
  --set-path /kanban -bg localhost:3001
```

Verify the route:

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve status
```

Expected output:

```
https://<your-machine>.ts.net (tailnet only)
|-- /kanban  proxy http://localhost:3001
```

Open `https://<your-machine>.ts.net/kanban` in your browser — you should see the board.

---

## VM (Open Claw) Setup

The VM connects to the kanban API over Tailscale using either the CLI, HTTP API, or MCP server. All three methods work over the network — no shared filesystem required.

### Option A: CLI

Set these environment variables on the VM (add to `.bashrc` or `.zshrc`):

```bash
export VK_API_URL=https://<your-machine>.ts.net/kanban/api
export VK_API_KEY=<same-admin-key-from-step-2>
```

Usage:

```bash
# List all tasks
vk tasks list --json

# Create a task
vk tasks create --title "Refactor auth module" --type code --priority high

# Claim a task
vk status <task-id> in-progress

# Complete a task
vk done <task-id> "Implemented with tests"
```

### Option B: Direct HTTP API

Use `curl` or any HTTP client with the `Authorization: Bearer` header:

```bash
# List tasks
curl -s \
  -H "Authorization: Bearer <your-admin-key>" \
  https://<your-machine>.ts.net/kanban/api/v1/tasks

# Create a task
curl -s -X POST \
  -H "Authorization: Bearer <your-admin-key>" \
  -H "Content-Type: application/json" \
  -d '{"title": "Fix login bug", "type": "code", "priority": "high"}' \
  https://<your-machine>.ts.net/kanban/api/v1/tasks

# Update task status
curl -s -X PATCH \
  -H "Authorization: Bearer <your-admin-key>" \
  -H "Content-Type: application/json" \
  -d '{"status": "in-progress"}' \
  https://<your-machine>.ts.net/kanban/api/v1/tasks/<task-id>

# Mark task done
curl -s -X PATCH \
  -H "Authorization: Bearer <your-admin-key>" \
  -H "Content-Type: application/json" \
  -d '{"status": "done"}' \
  https://<your-machine>.ts.net/kanban/api/v1/tasks/<task-id>
```

### Option C: MCP Server (for Claude-compatible agents)

Add to your agent's MCP configuration:

```json
{
  "mcpServers": {
    "veritas-kanban": {
      "command": "node",
      "args": ["/path/to/veritas-kanban/mcp/dist/index.js"],
      "env": {
        "VK_API_URL": "https://<your-machine>.ts.net/kanban/api",
        "VK_API_KEY": "<your-admin-key>"
      }
    }
  }
}
```

The MCP server runs locally on the VM as a stdio child process of the agent, and connects to the kanban API over HTTP via Tailscale.

Available MCP tools: `list_tasks`, `get_task`, `create_task`, `update_task`, `archive_task`, `delete_task`, `start_agent`, `stop_agent`, `get_summary`, and more.

Available MCP resources: `kanban://tasks`, `kanban://tasks/active`, `kanban://task/{id}`.

---

## Verification

Run this from the VM to confirm end-to-end connectivity:

```bash
curl -s \
  -H "Authorization: Bearer <your-admin-key>" \
  https://<your-machine>.ts.net/kanban/api/v1/tasks | head -c 200
```

If you see a JSON response, everything is working. Changes made from the VM (via CLI, API, or MCP) will appear in real-time on the browser board via WebSocket.

---

## How It Works

```
Mac Host                                    VM
┌──────────────────────────────┐           ┌──────────────────────┐
│ Veritas Kanban Server :3001  │           │ Open Claw Agent      │
│ ├─ /api/v1/*  REST API       │◀─Tailscale─┤ └─ MCP / CLI / HTTP │
│ ├─ /ws        WebSocket      │           └──────────────────────┘
│ └─ /*         SPA (web/dist) │
│                              │           ┌──────────────────────┐
│ Tailscale Serve              │           │ Your Browser         │
│ /kanban → localhost:3001     │◀─Tailscale─┤ (any device)        │
└──────────────────────────────┘           └──────────────────────┘
```

- **Tailscale Serve** strips the `/kanban` prefix before forwarding, so the server receives requests at `/` as normal.
- **WebSocket** connections go through `wss://<host>/kanban/ws` and are stripped to `/ws`.
- **Authentication** uses `Authorization: Bearer <key>` for remote access. Localhost bypass only applies to requests originating from the Mac itself.

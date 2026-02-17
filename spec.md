# Spec: Veritas Kanban + Open Claw via Tailscale

> **Status:** Draft
> **Date:** 2026-02-16

---

## 1. Overview

Veritas Kanban runs on the **Mac host**, exposed over Tailscale Serve.
Open Claw runs inside a **VM on the same Mac**, connected to the kanban API via the MCP server over Tailscale.
A human adds tasks from any device on the tailnet; Open Claw picks them up and works autonomously.

```
┌─── Mac Host ────────────────────────────────────────────────────┐
│                                                                  │
│  Veritas Kanban Server (Express, port 3001)                     │
│  ├─ /api/v1/*    REST API                                       │
│  ├─ /ws          WebSocket (real-time task updates)              │
│  └─ /*           SPA (web/dist, production only)                 │
│         ▲                                                        │
│         │ Tailscale Serve                                        │
│         │ https://s-macbook-pro.tailb94fe6.ts.net/kanban         │
│         │ strips /kanban → forwards to localhost:3001            │
│                                                                  │
├─── VM (inside Mac) ─────────────────────────────────────────────┤
│                                                                  │
│  Open Claw Agent                                                │
│    └─ MCP Server (stdio)                                        │
│         └─ HTTP → https://s-macbook-pro.tailb94fe6.ts.net       │
│                   /kanban/api (via Tailscale)                    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘

        ┌──────────────┐
        │ Your Laptop  │  Browser → https://s-macbook-pro
        │ / Phone /    │           .tailb94fe6.ts.net/kanban
        │ Any Device   │
        └──────────────┘
```

---

## 2. Design Decisions

### Why host kanban on the Mac (not the VM)?

| Concern                | Mac host                       | VM                              |
| ---------------------- | ------------------------------ | ------------------------------- |
| Browser access         | Direct via Tailscale Serve     | Same (either works)             |
| Persistent storage     | Mac SSD, survives VM rebuilds  | Lost if VM is recreated         |
| Agent integration      | MCP connects over HTTP — works | Co-located but tied to VM       |
| Resource overhead      | Lightweight (Node.js + files)  | Competes with Open Claw for RAM |
| Operational simplicity | Always running with the Mac    | Depends on VM lifecycle         |

### Why MCP over CLI or raw HTTP?

- **MCP (stdio)** is the native integration for Claude-compatible agents
- It runs alongside Open Claw on the VM as a child process
- Connects to kanban via HTTP — no shared filesystem needed
- Provides structured tool/resource interfaces, not raw REST
- Falls back gracefully (agents can also use CLI or HTTP if needed)

### Why NOT the Clawdbot agent service?

The built-in Clawdbot integration uses file-based task queuing
(`.veritas-kanban/agent-requests/`) and hardcoded `localhost` callbacks.
It requires co-location. Since Open Claw is on a separate VM, we bypass
this and use the network-native MCP → HTTP API path instead.

---

## 3. Components

### 3.1 Kanban Server (Mac Host)

**Process:** `node server/dist/index.js`
**Port:** `3001`
**Serves:** API + WebSocket + SPA (single process, single port)

In production mode the server serves the built SPA from `web/dist`:

- `/assets/*` — hashed bundles, cached 365 days (immutable)
- `*.html` — no-cache (revalidate every request)
- SPA fallback — all non-API, non-WS routes return `index.html`

### 3.2 Tailscale Serve (Mac Host)

Single route, path-based:

```
https://s-macbook-pro.tailb94fe6.ts.net/kanban → localhost:3001
```

Tailscale strips the `/kanban` prefix before forwarding.
The backend receives requests at `/` — no sub-path mounting needed.

### 3.3 MCP Server (VM)

**Process:** Spawned by Open Claw via stdio
**Binary:** `node <path>/mcp/dist/index.js`
**Connects to:** `VK_API_URL` (Tailscale HTTPS endpoint)

#### Available MCP Tools

| Tool                        | Purpose                                      |
| --------------------------- | -------------------------------------------- |
| `list_tasks`                | List tasks with optional status/type filter  |
| `get_task`                  | Get task by ID (supports partial matching)   |
| `create_task`               | Create task with title, description, etc.    |
| `update_task`               | Update any task field                        |
| `archive_task`              | Archive a completed task                     |
| `delete_task`               | Delete permanently                           |
| `start_agent`               | Start AI agent on a code task                |
| `stop_agent`                | Stop running agent                           |
| `list_pending_automation`   | List tasks awaiting automation               |
| `list_running_automation`   | List currently executing tasks               |
| `start_automation`          | Start automation via sub-agent               |
| `complete_automation`       | Mark automation done or failed               |
| `create_notification`       | Create alert (info/error/milestone/etc.)     |
| `get_pending_notifications` | Get unread notifications                     |
| `check_notifications`       | Auto-create notifications for flagged tasks  |
| `get_summary`               | Board summary (counts, projects, priority)   |
| `get_memory_summary`        | Task summary for agent memory (last N hours) |

#### Available MCP Resources (read-only)

| URI                     | Returns                      |
| ----------------------- | ---------------------------- |
| `kanban://tasks`        | All tasks (JSON)             |
| `kanban://tasks/active` | In-progress or blocked tasks |
| `kanban://task/{id}`    | Single task detail           |

### 3.4 Open Claw Agent (VM)

Open Claw reads the board via MCP, claims tasks, does work, reports back:

```
1. Open Claw calls list_tasks(status: "todo")
2. Picks a task → calls update_task(id, status: "in-progress")
3. Does the work (code, tests, etc.)
4. Calls update_task(id, status: "done") or complete_automation(id)
5. Optionally calls create_notification(type: "task_done", ...)
```

The kanban server broadcasts status changes via WebSocket.
The human sees real-time updates in the browser.

---

## 4. Required Code Changes

### 4.1 Vite Base Path Support

**File:** `web/vite.config.ts`

Add a configurable base path so the SPA works behind Tailscale's
path-based routing. When `VITE_BASE_PATH` is unset, behavior is
unchanged (base = `/`).

```diff
  export default defineConfig({
+   base: process.env.VITE_BASE_PATH || '/',
    plugins: [react()],
    ...
    server: {
+     host: '0.0.0.0',
      port: 3000,
```

**Why `host: '0.0.0.0'`:** Required for the Vite dev server to be
reachable on the Tailscale interface during development. Not needed
for production (Express already binds 0.0.0.0).

### 4.2 API Client Base Path

**File:** `web/src/lib/config.ts`

The API base URL must include the Vite base path so fetch calls get
the `/kanban` prefix in the browser:

```diff
- export const API_BASE = import.meta.env.VITE_API_URL || '/api';
+ export const API_BASE = import.meta.env.VITE_API_URL
+   || `${import.meta.env.BASE_URL}api`;
```

`import.meta.env.BASE_URL` is provided by Vite at build time. When
`base` is `/kanban/`, `BASE_URL` is `/kanban/`, so API calls go to
`/kanban/api/...`. Tailscale strips `/kanban` and the server receives
`/api/...`.

### 4.3 WebSocket Path

**File:** `web/src/hooks/useWebSocket.ts`

The WebSocket URL must also carry the base path prefix:

```diff
  function getDefaultWsUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
-   return `${protocol}//${window.location.host}/ws`;
+   const base = import.meta.env.BASE_URL || '/';
+   return `${protocol}//${window.location.host}${base}ws`;
  }
```

### 4.4 CORS Configuration

**File:** `server/src/index.ts` (env-driven, no code change)

Add the Tailscale hostname to allowed origins via `CORS_ORIGINS` env var.
No code change required — the server already reads `CORS_ORIGINS`.

### 4.5 Reverse Proxy Trust

**File:** `server/src/index.ts` (env-driven, no code change)

Set `TRUST_PROXY=1` so Express trusts `X-Forwarded-*` headers from
Tailscale Serve. This ensures `req.ip`, `req.protocol`, and
`req.hostname` reflect the real client, not the proxy.

---

## 5. Configuration

### 5.1 Mac Host — Server Environment

```bash
# .env (on the Mac, in the veritas-kanban directory)

# Server
PORT=3001
NODE_ENV=production
TRUST_PROXY=1

# Security
VERITAS_ADMIN_KEY=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
VERITAS_AUTH_ENABLED=true
VERITAS_AUTH_LOCALHOST_BYPASS=true
VERITAS_AUTH_LOCALHOST_ROLE=admin

# CORS — include Tailscale hostname
CORS_ORIGINS=https://s-macbook-pro.tailb94fe6.ts.net,http://localhost:3000

# Logging
LOG_LEVEL=info
```

### 5.2 Mac Host — Build & Start

```bash
# Build with base path for Tailscale routing
cd /path/to/veritas-kanban
VITE_BASE_PATH=/kanban/ pnpm build

# Start server
node server/dist/index.js
# Or use the process manager of your choice (pm2, launchd, etc.)
```

### 5.3 Mac Host — Tailscale Serve

```bash
# Register the route
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve \
  --set-path /kanban -bg localhost:3001

# Verify
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve status
# Expected output:
# https://s-macbook-pro.tailb94fe6.ts.net (tailnet only)
# |-- /kanban proxy http://localhost:3001
```

### 5.4 Mac Host — Port Registry

Update `~/.services.md` to register the port:

```markdown
| veritas-kanban | 3001 | /kanban | Kanban board (Express, API + SPA + WS) |
```

### 5.5 VM — MCP Server Configuration

In Open Claw's MCP config (location depends on the agent):

```json
{
  "mcpServers": {
    "veritas-kanban": {
      "command": "node",
      "args": ["/path/to/veritas-kanban/mcp/dist/index.js"],
      "env": {
        "VK_API_URL": "https://s-macbook-pro.tailb94fe6.ts.net/kanban/api"
      }
    }
  }
}
```

**Auth:** The shared API client sends requests without auth headers by
default. To authenticate, the MCP server needs the admin key. Two options:

**Option A — API key via env var (simple):**

Add to the MCP env block:

```json
"env": {
  "VK_API_URL": "https://s-macbook-pro.tailb94fe6.ts.net/kanban/api",
  "VK_API_KEY": "<same key as VERITAS_ADMIN_KEY>"
}
```

This requires a small change to the shared API client to read `VK_API_KEY`
and attach it as `Authorization: Bearer <key>`. See section 6.

**Option B — Tailscale identity headers (zero-config auth):**

Tailscale Serve injects these headers on tailnet requests:

- `Tailscale-User-Login`
- `Tailscale-User-Name`
- `Tailscale-User-Profile-Pic`

Add server-side middleware to trust these headers as authentication.
More secure (no shared secrets) but requires custom auth middleware.

### 5.6 VM — CLI Fallback Configuration

If Open Claw uses the CLI instead of (or in addition to) MCP:

```bash
export VK_API_URL=https://s-macbook-pro.tailb94fe6.ts.net/kanban/api
export VK_API_KEY=<admin key>

vk tasks list --json
vk tasks create --title "Fix auth bug" --type code --priority high
vk status <id> in-progress
vk done <id> "Implemented fix with tests"
```

---

## 6. Optional Enhancements

### 6.1 Shared API Client Auth Header

**File:** `shared/src/utils/api-client.ts`

The shared API client (used by MCP and CLI) does not currently send
auth headers. For remote access, add automatic `Authorization` header
injection when `VK_API_KEY` is set:

```diff
  async request<T>(method: string, path: string, options?) {
+   const headers: Record<string, string> = {
+     'Content-Type': 'application/json',
+     ...options?.headers,
+   };
+   const apiKey = typeof process !== 'undefined'
+     ? process.env.VK_API_KEY
+     : undefined;
+   if (apiKey && !headers['Authorization']) {
+     headers['Authorization'] = `Bearer ${apiKey}`;
+   }
    ...
  }
```

### 6.2 Tailscale Identity Auth (server-side)

**File:** New middleware or addition to `server/src/middleware/auth.ts`

Trust Tailscale-injected headers as an auth source. Only apply when
the request comes through Tailscale (check via `TRUST_PROXY` or a
known header). Assign a role based on the Tailscale user login.

### 6.3 Docker Deployment (alternative to bare Node)

For a more isolated setup on the Mac host:

```bash
# Build
docker build -t veritas-kanban .

# Run
docker run -d \
  --name veritas-kanban \
  -p 3001:3001 \
  -v kanban-data:/app/data \
  -e NODE_ENV=production \
  -e VERITAS_ADMIN_KEY=<key> \
  -e CORS_ORIGINS=https://s-macbook-pro.tailb94fe6.ts.net \
  -e TRUST_PROXY=1 \
  veritas-kanban
```

Note: The Dockerfile currently does not support `VITE_BASE_PATH` at
build time. Add a build arg:

```dockerfile
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=$VITE_BASE_PATH
```

Then build with: `docker build --build-arg VITE_BASE_PATH=/kanban/ .`

---

## 7. Request Flow

### Human adds a task via browser

```
Browser POST /kanban/api/v1/tasks
  → Tailscale strips /kanban → POST /api/v1/tasks → Server
  → Auth: cookie (JWT) or Tailscale identity headers
  → Server creates task in .veritas-kanban/tasks/
  → Server broadcasts via WebSocket
  → Browser receives real-time update
```

### Open Claw picks up the task via MCP

```
Open Claw invokes MCP tool: list_tasks(status: "todo")
  → MCP server calls GET https://...ts.net/kanban/api/v1/tasks?status=todo
  → Tailscale strips /kanban → GET /api/v1/tasks?status=todo → Server
  → Auth: Authorization: Bearer <VK_API_KEY>
  → Server returns task list
  → MCP returns structured response to Open Claw

Open Claw invokes MCP tool: update_task(id, status: "in-progress")
  → MCP server calls PATCH https://...ts.net/kanban/api/v1/tasks/{id}
  → Server updates task, broadcasts via WebSocket
  → Browser shows task moved to "In Progress" column (real-time)

Open Claw does the work...

Open Claw invokes MCP tool: update_task(id, status: "done")
  → Server updates, broadcasts
  → Browser shows task moved to "Done" (real-time)
```

### WebSocket real-time flow

```
Browser connects: wss://...ts.net/kanban/ws
  → Tailscale strips /kanban → wss://localhost:3001/ws
  → Server accepts, starts heartbeat (ping every 30s)

Server broadcasts on task change:
  → { type: "task:changed", task: {...} }
  → All connected browsers receive the update
```

---

## 8. Security Considerations

| Concern                     | Mitigation                                               |
| --------------------------- | -------------------------------------------------------- |
| Tailscale-only access       | `tailscale serve` is tailnet-only (not Funnel)           |
| API key in VM env           | Stored in MCP config, not in code                        |
| CORS                        | Restricted to Tailscale hostname + localhost             |
| WebSocket origin validation | Server validates against `CORS_ORIGINS`                  |
| Rate limiting               | 300 req/min global, 60 write/min (localhost exempt)      |
| Auth on remote requests     | `Bearer` token required (localhost bypass doesn't apply) |
| CSP headers                 | Helmet enforces in production                            |

---

## 9. Checklist

### Code changes (required)

- [ ] `web/vite.config.ts` — add `base: process.env.VITE_BASE_PATH || '/'` and `host: '0.0.0.0'`
- [ ] `web/src/lib/config.ts` — use `import.meta.env.BASE_URL` for API prefix
- [ ] `web/src/hooks/useWebSocket.ts` — use `import.meta.env.BASE_URL` for WS prefix

### Code changes (recommended)

- [ ] `shared/src/utils/api-client.ts` — auto-attach `VK_API_KEY` as Bearer token

### Configuration (Mac host)

- [ ] Generate admin key
- [ ] Create `.env` with production config
- [ ] Build with `VITE_BASE_PATH=/kanban/`
- [ ] Start server
- [ ] Register Tailscale serve route (`/kanban → localhost:3001`)
- [ ] Update `~/.services.md` port registry

### Configuration (VM)

- [ ] Install MCP server dependencies (`pnpm install` in mcp/)
- [ ] Build MCP server (`pnpm build` in mcp/)
- [ ] Configure Open Claw's MCP settings with `VK_API_URL` and `VK_API_KEY`
- [ ] Test: `vk tasks list --json` via CLI to verify connectivity

### Verification

- [ ] Browser: open `https://s-macbook-pro.tailb94fe6.ts.net/kanban` — board loads
- [ ] Browser: create a task — appears on the board
- [ ] VM: `vk tasks list --json` — returns the task
- [ ] VM: MCP `list_tasks` tool — returns the task
- [ ] VM: MCP `update_task` — browser shows real-time update

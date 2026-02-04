# Troubleshooting

Common issues and solutions for Veritas Kanban. Can't find your issue? [Open a Discussion](https://github.com/BradGroux/veritas-kanban/discussions) or [file an issue](https://github.com/BradGroux/veritas-kanban/issues).

---

## Table of Contents

- [Installation & Build](#installation--build)
- [Authentication & Rate Limiting](#authentication--rate-limiting)
- [Networking & Proxies](#networking--proxies)
- [WebSocket Issues](#websocket-issues)
- [Docker](#docker)
- [Agent Integration](#agent-integration)
- [UI & Frontend](#ui--frontend)
- [Data & Storage](#data--storage)
- [Useful Commands](#useful-commands)
- [Dev Reliability (ports, hangs, and restarts)](#dev-reliability-ports-hangs-and-restarts)

---

## Dev Reliability (ports, hangs, and restarts)

### Agent note: planning is NOT a status

`planning` was removed entirely as a `TaskStatus` (process/UI heavy and overkill for an agent-first Kanban).

Valid statuses are:

- `todo`
- `in-progress`
- `blocked`
- `done`

If you need “planning”, put it in the task body/checklist or treat it as agent-internal planning — not a board column.

### Quick fix: clean restart

If the UI is acting hung or the API is returning unexpected 404s, run:

```bash
pnpm dev:clean
```

This:

- frees ports **3001** (server) and **3000** (web)
- kills stale dev watchers for this repo (`tsx watch`, `vite`, `concurrently`)
- restarts `pnpm dev`

### Check server health

VK provides a canonical health endpoint for tooling:

```bash
curl -s http://localhost:3001/api/health
```

Expected: HTTP 200 JSON like:

```json
{ "ok": true, "service": "veritas-kanban", "version": "1.x.x" }
```

### Optional: auto-restart watchdog (dev)

If you want VK to auto-restart when unhealthy during dev:

```bash
pnpm dev:watchdog
```

Environment variables:

- `WATCHDOG_INTERVAL_SECONDS` (default 30)
- `WATCHDOG_FAIL_THRESHOLD` (default 3)

> Note: watchdog is for local dev convenience. For production, prefer a real supervisor (pm2/docker) with health checks.

## Installation & Build

### TypeScript errors during build

TypeScript errors during initial `pnpm install` or `pnpm build` usually resolve on a second run. This happens when shared type packages aren't built yet.

```bash
# Clean build from scratch
pnpm clean        # if available
rm -rf node_modules
pnpm install
pnpm build
```

If errors persist, check your Node.js version — **Node 20+** is required:

```bash
node -v  # Should be v20.x or higher
```

### `pnpm` not found

Veritas Kanban uses pnpm workspaces. Install it first:

```bash
npm install -g pnpm
# or
corepack enable && corepack prepare pnpm@latest --activate
```

### Port already in use

```bash
# Check what's using port 3001 (API) or 3000 (Web)
lsof -i :3001
lsof -i :3000

# Change ports in server/.env
PORT=3002  # API port
```

Update `CORS_ORIGINS` in `.env` if you change the web port.

---

## Authentication & Rate Limiting

### "Too many authentication attempts"

**This is the most common issue for local development and SSH tunnel users.**

The auth rate limiter defaults to **10–15 requests per 15 minutes**. Normal UI usage (page loads, tab refreshes, WebSocket reconnections) can exhaust this quickly.

**Fix 1: Update to the latest version**

This was fixed — `authRateLimit` now exempts localhost requests automatically (same as `apiRateLimit`). Pull the latest and restart.

> **Note:** If you're behind an SSH tunnel or reverse proxy, `req.ip` may not resolve to `127.0.0.1`. See [SSH Tunnel / Proxy Issues](#ssh-tunnel--proxy-requests-not-recognized-as-localhost) below.

**Fix 2: Increase the auth rate limit**

In `server/src/middleware/rate-limit.ts`, increase `max` for the auth limiter:

```typescript
max: 100; // default is 10-15, increase for development
```

**Fix 3: Restart the server**

Rate limit counters are stored in-memory and reset on restart:

```bash
# Ctrl+C the running server, then:
pnpm dev
```

**Fix 4: Disable auth entirely (development only)**

In `server/.env`:

```bash
VERITAS_AUTH_ENABLED=false
```

⚠️ **Never disable auth in production.**

### Weak admin key warning

The server warns at startup if `VERITAS_ADMIN_KEY` is less than 32 characters. Generate a strong key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Authentication not working

Check the auth diagnostics endpoint:

```bash
curl -H "X-API-Key: your-admin-key" http://localhost:3001/api/auth/diagnostics
```

Verify your `.env` has the correct key format:

```bash
# API keys format: name:key:role,name2:key2:role2
VERITAS_API_KEYS=my-agent:my-secret-key:agent
```

### Three ways to authenticate

```bash
# 1. Authorization header (Bearer token)
curl -H "Authorization: Bearer your-api-key" http://localhost:3001/api/tasks

# 2. X-API-Key header
curl -H "X-API-Key: your-api-key" http://localhost:3001/api/tasks

# 3. Query parameter (useful for WebSocket connections)
ws://localhost:3001/ws?api_key=your-api-key
```

---

## Networking & Proxies

### SSH tunnel / proxy requests not recognized as localhost

When accessing Veritas Kanban through an SSH tunnel, your requests may appear as `::ffff:127.0.0.1` (IPv4-mapped IPv6) instead of `127.0.0.1`, causing localhost exemptions to fail.

**Fix 1: Force IPv4 binding**

```bash
# In your .env or when starting the server:
HOST=127.0.0.1 pnpm dev
```

**Fix 2: Verify your SSH tunnel binds to 127.0.0.1**

```bash
# Correct — binds to localhost explicitly
ssh -L 127.0.0.1:3001:127.0.0.1:3001 user@server

# May cause issues — binds to all interfaces
ssh -L 3001:localhost:3001 user@server
ssh -L 0.0.0.0:3001:127.0.0.1:3001 user@server
```

**Fix 3: Debug the detected IP**

Add a temporary log to see what IP the server receives:

```typescript
// In your rate limiter or middleware:
console.log('Client IP:', req.ip, req.connection.remoteAddress);
```

### CORS errors

If you see CORS errors in the browser console, update `CORS_ORIGINS` in `server/.env`:

```bash
# Add your frontend URL (comma-separated, no trailing slashes)
CORS_ORIGINS=http://localhost:3000,http://localhost:5173,http://your-ip:3000
```

### Accessing from another machine on the network

By default, the server binds to `localhost`. To access from other machines:

```bash
# In server/.env
HOST=0.0.0.0
```

Update `CORS_ORIGINS` to include the IP/hostname you'll access from.

---

## WebSocket Issues

### WebSocket connection refused

1. Verify `CORS_ORIGINS` includes your frontend URL
2. If behind a reverse proxy, ensure WebSocket upgrade headers are forwarded:

**nginx:**

```nginx
location /ws {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 86400;  # WebSocket connections are long-lived
}
```

**Caddy:**

```caddyfile
reverse_proxy /ws 127.0.0.1:3001
```

Caddy handles WebSocket upgrades automatically.

### WebSocket disconnects frequently

- Check proxy timeout settings (must be longer than the WebSocket heartbeat interval)
- The client automatically reconnects with exponential backoff
- TanStack Query polling increases when WebSocket is disconnected, decreases when reconnected

---

## Docker

### Container won't start

```bash
# Check logs
docker compose logs veritas-kanban

# Common causes:
# - Port 3001 already in use → change port mapping in docker-compose.yml
# - Permission denied on volume → check UID 1001 ownership
```

### Permission denied on data volume

The container runs as non-root (UID 1001). Fix volume permissions:

```bash
# On the host machine
sudo chown -R 1001:1001 ./data
```

### Rebuilding after code changes

```bash
docker compose build --no-cache
docker compose up -d
```

---

## Agent Integration

### Agent can't connect to the API

1. Verify the server is running: `curl http://localhost:3001/api/health`
2. Check your agent's API key has the `agent` role:
   ```bash
   VERITAS_API_KEYS=my-agent:my-secret-key:agent
   ```
3. For agents running in Docker/containers, use `host.docker.internal:3001` instead of `localhost:3001`

### Agent names/models — is it hardcoded?

**No.** The agent system is platform-agnostic. The board doesn't call LLMs directly — it provides a REST API that any agent can call. Whether you're using Claude, GPT, Kimi, Gemini, Llama, or a custom model, if your agent can make HTTP requests, it can drive the board.

The agent dropdown in the UI is for labeling/tracking purposes. It doesn't affect functionality.

### MCP server connection issues

Verify the MCP server config in your Claude Desktop settings:

```json
{
  "mcpServers": {
    "veritas-kanban": {
      "command": "node",
      "args": ["/path/to/veritas-kanban/mcp/dist/index.js"],
      "env": {
        "VK_API_URL": "http://localhost:3001",
        "VK_API_KEY": "your-admin-key"
      }
    }
  }
}
```

Build the MCP server first: `cd mcp && pnpm build`

---

## UI & Frontend

### Board not loading / blank page

1. Check the browser console for errors (F12 → Console)
2. Verify both services are running:
   - Web: http://localhost:3000
   - API: http://localhost:3001/api/health
3. Try a hard refresh: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)

### Drag and drop not working

- Tooltips can interfere with drag detection — they're automatically suppressed during drag operations
- If using a touch device, long-press to initiate drag
- Check browser console for JavaScript errors

### Dark mode / theme issues

The UI follows your system theme preference. To force a theme, check Settings → Appearance.

---

## Data & Storage

### Where are my tasks stored?

Tasks are Markdown files with YAML frontmatter stored in the `tasks/` directory:

```
tasks/
├── active/          # Current tasks (todo, in-progress, blocked)
├── archive/         # Archived/completed tasks
└── templates/       # Task templates
```

You can edit them directly with any text editor, grep them, or version them with git.

### How to back up

```bash
# Simple backup
cp -r tasks/ tasks-backup-$(date +%Y%m%d)/

# Or use git (recommended)
cd tasks && git init && git add -A && git commit -m "backup"
```

### Restoring from backup

Copy your backed-up task files back into `tasks/active/` and restart the server. The in-memory cache rebuilds from disk on startup.

### Reset to clean slate

```bash
# Remove all tasks
rm tasks/active/task_*.md

# Re-seed with examples (optional)
pnpm seed
```

---

## Useful Commands

```bash
# Development
pnpm dev              # Start both web and API in dev mode
pnpm build            # Production build
pnpm test             # Run all tests
pnpm test:e2e         # Run Playwright E2E tests

# CLI
pnpm cli list         # List tasks from terminal
pnpm cli create       # Create a task
pnpm cli update       # Update a task

# Health checks
curl http://localhost:3001/api/health          # Server health
curl http://localhost:3001/api/auth/diagnostics # Auth diagnostics (needs admin key)

# API docs
open http://localhost:3001/api-docs            # Swagger UI
```

---

## Still stuck?

- 💬 [GitHub Discussions](https://github.com/BradGroux/veritas-kanban/discussions) — ask the community
- 🐛 [GitHub Issues](https://github.com/BradGroux/veritas-kanban/issues) — report a bug
- 📖 [Deployment Guide](DEPLOYMENT.md) — production setup
- 📖 [Features Guide](FEATURES.md) — full feature documentation
- 🔒 [Security Guide](security.md) — auth, rate limiting, API keys

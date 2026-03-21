# Self-Hosting Veritas Kanban

This guide walks you through every self-hosting scenario — from running locally for personal use to a production deployment behind a reverse proxy or on Tailscale.

> **Credit:** This guide was originally contributed by [@xechehot](https://github.com/xechehot) in [PR #126](https://github.com/BradGroux/veritas-kanban/pull/126). It has been expanded here to cover additional deployment patterns.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Build Steps](#build-steps)
- [Local Hosting](#local-hosting)
- [LAN Access](#lan-access)
- [Tailscale Serve](#tailscale-serve)
- [Reverse Proxy](#reverse-proxy)
  - [nginx](#nginx)
  - [Caddy](#caddy)
- [Docker](#docker)
- [Security](#security)
- [Environment Variables Reference](#environment-variables-reference)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Requirement | Version  | Install                                   |
|-------------|----------|-------------------------------------------|
| Node.js     | 22.0.0+  | https://nodejs.org or `nvm install 22`    |
| pnpm        | 9.0.0+   | `corepack enable && corepack prepare pnpm@9.15.4 --activate` |
| Git         | any      | https://git-scm.com                       |

Verify:

```bash
node --version   # v22.x.x
pnpm --version   # 9.x.x
```

---

## Build Steps

```bash
# 1. Clone the repository
git clone https://github.com/BradGroux/veritas-kanban.git
cd veritas-kanban

# 2. Install all workspace dependencies
pnpm install --frozen-lockfile

# 3. Build all packages (shared → server + web)
pnpm build

# 4. Configure environment
cp server/.env.example server/.env
# Edit server/.env — at minimum set VERITAS_ADMIN_KEY
```

The build produces:

| Path              | Contents                              |
|-------------------|---------------------------------------|
| `shared/dist/`    | Shared TypeScript types and utilities |
| `server/dist/`    | Compiled Express API server           |
| `web/dist/`       | Static React frontend (served by Express in production) |

---

## Local Hosting

Run Veritas Kanban on your own machine for personal use.

```bash
# Start the production server
NODE_ENV=production node server/dist/index.js
```

The app is now available at **http://localhost:3001**.

- **API:** `http://localhost:3001/api`
- **UI:** `http://localhost:3001`
- **WebSocket:** `ws://localhost:3001/ws`
- **API Docs (Swagger):** `http://localhost:3001/api-docs`

By default, `VERITAS_AUTH_LOCALHOST_BYPASS=true` in `.env.example`, so unauthenticated requests from `localhost` are allowed with the `read-only` role. Set `VERITAS_AUTH_LOCALHOST_ROLE=admin` if you want full access without a key on your local machine.

### Development mode

For active development with hot-module replacement:

```bash
pnpm dev
# Vite dev server → http://localhost:3000 (proxies API to :3001)
# Express API server → http://localhost:3001
```

> **Note:** `NODE_ENV=development` is for local development only. Never use it in Docker — the Express server does not serve the frontend in development mode.

---

## LAN Access

Serve Veritas Kanban to other devices on your local network (phones, other laptops, tablets).

### 1. Bind to all interfaces

By default the server listens on `127.0.0.1`. To accept connections from other devices, set `HOST=0.0.0.0`:

```bash
HOST=0.0.0.0 NODE_ENV=production node server/dist/index.js
```

Or add to `server/.env`:

```env
HOST=0.0.0.0
```

### 2. Allow Vite dev server (development only)

If you're running the Vite dev server in development mode, set `VITE_ALLOWED_HOSTS` so Vite accepts requests from your LAN IP:

```env
# server/.env or export before running pnpm dev
VITE_ALLOWED_HOSTS=192.168.1.100,my-machine.local
# Or allow all hosts (development only — never in production):
VITE_ALLOWED_HOSTS=*
```

This controls `vite.config.ts`'s `server.allowedHosts` setting.

### 3. Update CORS

Add your LAN IP or hostname to `CORS_ORIGINS` in `server/.env`:

```env
CORS_ORIGINS=http://localhost:3000,http://localhost:5173,http://192.168.1.100:3001
```

### 4. Find your LAN IP

```bash
# macOS / Linux
ip route get 1 | awk '{print $7; exit}'
# or
hostname -I | awk '{print $1}'

# macOS
ipconfig getifaddr en0
```

Your LAN URL will be `http://<your-ip>:3001`.

---

## Tailscale Serve

Tailscale Serve lets you expose Veritas Kanban securely to your tailnet (all your devices) without opening firewall ports. This was the primary use case from [@xechehot's original PR #126](https://github.com/BradGroux/veritas-kanban/pull/126).

### Option A: Root path (simplest)

Expose the app at `https://<your-machine>.ts.net/`:

```bash
# Start Veritas Kanban
NODE_ENV=production node server/dist/index.js

# Expose via Tailscale Serve (proxies HTTPS → localhost:3001)
tailscale serve https / http://localhost:3001
```

Access from any tailnet device at `https://<your-machine>.ts.net`.

### Option B: Sub-path routing (`/kanban/`)

If you want to share port 443 with other services and serve Veritas Kanban under `/kanban/`:

#### Step 1 — Build the frontend with the base path

The frontend must be built with `VITE_BASE_PATH=/kanban/` so all asset URLs, API calls, and client-side routes use the correct prefix:

```bash
VITE_BASE_PATH=/kanban/ pnpm --filter @veritas-kanban/web build
# Then rebuild the server (if needed)
pnpm --filter @veritas-kanban/server build
```

Or with Docker:

```bash
docker build --build-arg VITE_BASE_PATH=/kanban/ -t veritas-kanban .
```

#### Step 2 — Start the server

```bash
NODE_ENV=production node server/dist/index.js
```

#### Step 3 — Configure Tailscale Serve

```bash
# Route /kanban/ traffic to localhost:3001
tailscale serve https /kanban/ http://localhost:3001

# Verify the serve config
tailscale serve status
```

#### Step 4 — Update CORS

```env
CORS_ORIGINS=https://<your-machine>.ts.net
```

Access the app at `https://<your-machine>.ts.net/kanban/`.

### Tailscale Funnel (public internet access)

To expose beyond your tailnet (public internet):

```bash
tailscale funnel 443 on
```

> **Security:** Funnel makes your instance publicly accessible. Ensure `VERITAS_AUTH_ENABLED=true` and use a strong `VERITAS_ADMIN_KEY` before enabling Funnel.

---

## Reverse Proxy

For production deployments with TLS, use a reverse proxy in front of Veritas Kanban. Always set `TRUST_PROXY` when behind a proxy.

### nginx

```env
# server/.env
TRUST_PROXY=1
CORS_ORIGINS=https://kanban.example.com
```

```nginx
upstream veritas {
    server 127.0.0.1:3001;
    keepalive 32;
}

server {
    listen 443 ssl http2;
    server_name kanban.example.com;

    ssl_certificate     /etc/letsencrypt/live/kanban.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/kanban.example.com/privkey.pem;

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

    # Proxy everything to Veritas Kanban
    location / {
        proxy_pass http://veritas;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket upgrade (real-time updates)
    location /ws {
        proxy_pass http://veritas;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Keep WebSocket connections alive
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}

# HTTP → HTTPS redirect
server {
    listen 80;
    server_name kanban.example.com;
    return 301 https://$server_name$request_uri;
}
```

Reload nginx after editing:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### Caddy

Caddy handles TLS automatically (no certificate config needed):

```caddyfile
kanban.example.com {
    reverse_proxy localhost:3001
}
```

```env
# server/.env
TRUST_PROXY=1
CORS_ORIGINS=https://kanban.example.com
```

Caddy handles WebSocket proxying and HTTP→HTTPS redirects automatically.

### Sub-path with nginx

To serve under `/kanban/` on a shared domain, build with `VITE_BASE_PATH` and strip the prefix in nginx:

```bash
VITE_BASE_PATH=/kanban/ pnpm --filter @veritas-kanban/web build
pnpm --filter @veritas-kanban/server build
```

```nginx
location /kanban/ {
    proxy_pass http://127.0.0.1:3001/;  # trailing slash strips the prefix
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /kanban/ws {
    proxy_pass http://127.0.0.1:3001/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400s;
}
```

---

## Docker

Docker is the recommended approach for production deployments.

### Quick start

```bash
# Clone and configure
git clone https://github.com/BradGroux/veritas-kanban.git
cd veritas-kanban
cp server/.env.example server/.env
# Edit server/.env — set VERITAS_ADMIN_KEY to a strong secret (≥ 32 chars)

# Build and start
docker compose up -d --build

# Verify
curl http://localhost:3001/health
# → {"status":"ok","timestamp":"..."}
```

The app is available at **http://localhost:3001**. Data persists in a named Docker volume (`kanban-data`).

### docker-compose.yml

```yaml
services:
  veritas-kanban:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: veritas-kanban
    ports:
      - '3001:3001'
    environment:
      - NODE_ENV=production
      - PORT=3001
      - DATA_DIR=/app/data
      - VERITAS_ADMIN_KEY=your-secure-admin-key-here  # ≥ 32 chars
      - VERITAS_JWT_SECRET=your-jwt-secret-here       # prevents session resets on restart
      # - CORS_ORIGINS=https://kanban.example.com
      # - TRUST_PROXY=1                               # if behind nginx/Caddy/Traefik
      # - VERITAS_API_KEYS=agent1:key1:agent,readonly:key2:read-only
    volumes:
      - kanban-data:/app/data
    restart: unless-stopped
    healthcheck:
      test: ['CMD', 'wget', '--no-verbose', '--tries=1', '--spider', 'http://localhost:3001/health']
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

volumes:
  kanban-data:
    driver: local
```

### Building with a sub-path

```bash
docker build --build-arg VITE_BASE_PATH=/kanban/ -t veritas-kanban .
```

### Common Docker commands

```bash
docker compose up -d --build     # Build and start in background
docker compose logs -f           # Follow logs
docker compose down              # Stop and remove containers
docker compose pull              # Pull latest image (if using a registry)

# Inspect health status
docker inspect --format='{{.State.Health.Status}}' veritas-kanban
```

### Data persistence

The `DATA_DIR=/app/data` volume holds all persistent data:

```
/app/data/
├── tasks/
│   ├── active/        # Active task markdown files
│   └── archive/       # Archived tasks
└── .veritas-kanban/
    ├── config.json    # App settings
    ├── security.json  # JWT secret (if VERITAS_JWT_SECRET not set)
    └── logs/          # Application logs
```

**Without a named volume, data is lost on every `docker compose down`.** Always use a volume or bind mount.

---

## Security

### Generate strong keys

```bash
# Admin key (≥ 32 chars)
openssl rand -hex 32

# JWT secret
openssl rand -hex 64
```

### Minimum production config

```env
VERITAS_AUTH_ENABLED=true
VERITAS_ADMIN_KEY=<output of openssl rand -hex 32>
VERITAS_JWT_SECRET=<output of openssl rand -hex 64>
VERITAS_AUTH_LOCALHOST_BYPASS=false
```

### API keys for agents

Grant agents scoped access without giving them the admin key:

```env
# Format: name:key:role,...
# Roles: admin | agent | read-only
VERITAS_API_KEYS=my-agent:vk_abc123:agent,dashboard:vk_xyz456:read-only
```

Role permissions:

| Role        | Access                                             |
|-------------|----------------------------------------------------|
| `admin`     | Full access to all endpoints                       |
| `agent`     | Read/write tasks, run agents, manage worktrees     |
| `read-only` | GET endpoints only (view tasks, read config)       |

### Authentication methods

```bash
# Bearer token
curl -H "Authorization: Bearer <api-key>" http://localhost:3001/api/tasks

# X-API-Key header
curl -H "X-API-Key: <api-key>" http://localhost:3001/api/tasks

# Query parameter (WebSocket)
wscat -c "ws://localhost:3001/ws?api_key=<api-key>"
```

### TRUST_PROXY

Always set `TRUST_PROXY=1` when running behind a reverse proxy. Without it, Express uses the proxy's IP for rate limiting instead of the real client IP, so all users share one rate limit bucket.

```env
TRUST_PROXY=1      # One proxy hop (nginx, Caddy directly in front)
TRUST_PROXY=2      # Two hops (CDN + reverse proxy)
TRUST_PROXY=loopback  # Only trust loopback (127.0.0.1, ::1)
```

> **Warning:** `TRUST_PROXY=true` is blocked by default — it trusts all proxies and is unsafe on the public internet. Use a hop count or subnet instead.

---

## Environment Variables Reference

All variables live in `server/.env` (copy from `server/.env.example`).

### Server

| Variable    | Default | Description                                              |
|-------------|---------|----------------------------------------------------------|
| `PORT`      | `3001`  | HTTP server port                                         |
| `HOST`      | `127.0.0.1` | Bind address. Set `0.0.0.0` for LAN/container access |
| `NODE_ENV`  | —       | `production` for production. **Never `development` in Docker** |
| `LOG_LEVEL` | `info`  | `trace` / `debug` / `info` / `warn` / `error` / `fatal` |

### Authentication

| Variable                        | Default     | Description                                                            |
|---------------------------------|-------------|------------------------------------------------------------------------|
| `VERITAS_AUTH_ENABLED`          | `true`      | Enable authentication. Set `false` only for trusted local use          |
| `VERITAS_ADMIN_KEY`             | —           | Admin API key. **Must be ≥ 32 chars.** Required for production         |
| `VERITAS_API_KEYS`              | —           | Additional keys. Format: `name:key:role,name2:key2:role2`              |
| `VERITAS_JWT_SECRET`            | auto-gen    | JWT signing secret. Unset = auto-generated (sessions reset on restart) |
| `VERITAS_AUTH_LOCALHOST_BYPASS` | `false`     | Allow unauthenticated localhost requests                               |
| `VERITAS_AUTH_LOCALHOST_ROLE`   | `read-only` | Role for localhost bypass: `read-only`, `agent`, or `admin`            |

### Networking

| Variable         | Default                         | Description                                                                 |
|------------------|---------------------------------|-----------------------------------------------------------------------------|
| `CORS_ORIGINS`   | `http://localhost:3000,...`     | Comma-separated allowed CORS origins                                        |
| `TRUST_PROXY`    | —                               | Express proxy trust. Use `1` for single-hop (nginx/Caddy). `true` is blocked |
| `RATE_LIMIT_MAX` | `300`                           | Max API requests/minute/IP (localhost exempt)                               |

### Data & Storage

| Variable                   | Default              | Description                                              |
|----------------------------|----------------------|----------------------------------------------------------|
| `VERITAS_DATA_DIR`         | `.veritas-kanban`    | Config, logs, internal state (relative to project root)  |
| `DATA_DIR`                 | `/app/data` (Docker) | Mapped data dir inside Docker container                  |
| `TELEMETRY_RETENTION_DAYS` | `30`                 | Days to keep telemetry event files                       |
| `TELEMETRY_COMPRESS_DAYS`  | `7`                  | Days after which telemetry files are gzip-compressed     |

### Frontend (build-time)

| Variable         | Default | Description                                                                          |
|------------------|---------|--------------------------------------------------------------------------------------|
| `VITE_BASE_PATH` | `/`     | Sub-path prefix for the frontend (e.g., `/kanban/`). Set at build time, not runtime |
| `VITE_ALLOWED_HOSTS` | —   | Comma-separated hostnames allowed by Vite dev server (dev only). `*` allows all      |

### Integration

| Variable                 | Default                      | Description                                      |
|--------------------------|------------------------------|--------------------------------------------------|
| `CLAWDBOT_GATEWAY`       | `http://127.0.0.1:18789`     | OpenClaw gateway URL for AI agent orchestration  |
| `VERITAS_WEBHOOK_URL`    | —                            | Push task/chat events to an external service     |
| `VERITAS_WEBHOOK_SECRET` | —                            | HMAC-SHA256 secret for webhook payload signing   |

---

## Troubleshooting

### Cannot GET / (UI not loading)

**Cause:** `NODE_ENV=development` is set in Docker. In dev mode, Express is API-only — it does not serve the frontend.

**Fix:** Remove `NODE_ENV=development` from your Docker environment. The Dockerfile defaults to `production`.

---

### CORS error in browser console

**Cause:** Your frontend origin is not in `CORS_ORIGINS`.

**Fix:** Add the exact origin (scheme + hostname + port) to `CORS_ORIGINS`:

```env
CORS_ORIGINS=https://kanban.example.com,http://192.168.1.100:3001
```

No trailing slashes. The origin must match exactly what the browser sends in the `Origin` header.

---

### WebSocket connection fails or disconnects immediately

1. Check that your reverse proxy forwards WebSocket upgrade headers:
   - **nginx:** Needs `proxy_set_header Upgrade $http_upgrade; Connection "upgrade";` in the `/ws` location block.
   - **Caddy:** Handles WebSocket automatically — no config needed.
2. Check proxy timeout: WebSocket connections are long-lived. Set `proxy_read_timeout 86400s` in nginx.
3. Verify `CORS_ORIGINS` includes the WebSocket origin.

---

### Assets 404 after sub-path deployment

**Cause:** Frontend was built without `VITE_BASE_PATH`.

**Fix:** Rebuild with the correct base path:

```bash
VITE_BASE_PATH=/kanban/ pnpm --filter @veritas-kanban/web build
```

Or with Docker:

```bash
docker build --build-arg VITE_BASE_PATH=/kanban/ -t veritas-kanban .
```

---

### Rate limiting errors (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR)

**Cause:** Your reverse proxy sends `X-Forwarded-For` but `TRUST_PROXY` is not set.

**Fix:**

```env
TRUST_PROXY=1
```

---

### Tailscale: "ERR_TOO_MANY_REDIRECTS" or assets not loading

**Cause:** `VITE_BASE_PATH` not set when using Tailscale Serve with sub-path routing.

**Fix:** Rebuild with `VITE_BASE_PATH=/kanban/` (see [Tailscale Serve](#tailscale-serve) above).

---

### Weak admin key warning at startup

The server rejects or warns on `VERITAS_ADMIN_KEY` shorter than 32 characters. Generate a proper key:

```bash
openssl rand -hex 32
```

---

### Sessions reset after container restart

**Cause:** `VERITAS_JWT_SECRET` is not set, so a new secret is generated each startup.

**Fix:** Set a persistent JWT secret:

```bash
openssl rand -hex 64
# Add to docker-compose.yml environment or server/.env
VERITAS_JWT_SECRET=<output>
```

---

### Check server health

```bash
curl http://localhost:3001/health
# → {"status":"ok","timestamp":"..."}
```

Auth diagnostics (requires admin key):

```bash
curl -H "X-API-Key: your-admin-key" http://localhost:3001/api/auth/diagnostics
```

---

*For general deployment (Docker, bare metal, systemd, reverse proxy) see also [docs/DEPLOYMENT.md](../DEPLOYMENT.md).*

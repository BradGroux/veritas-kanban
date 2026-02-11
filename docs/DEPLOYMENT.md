# Deployment Guide

This guide covers deploying Veritas Kanban in production using Docker (recommended) or bare metal.

---

## Table of Contents

- [Quick Start (Docker)](#quick-start-docker)
- [Docker Configuration](#docker-configuration)
- [Bare Metal Deployment](#bare-metal-deployment)
  - [Prerequisites](#prerequisites)
  - [Build Steps](#build-steps)
  - [Running](#running)
  - [Reverse Proxy (nginx)](#reverse-proxy-nginx)
  - [Reverse Proxy (Caddy)](#reverse-proxy-caddy)
  - [systemd Service](#systemd-service)
- [Environment Variables](#environment-variables)
- [Data & Backup](#data--backup)
- [Upgrading](#upgrading)
- [Health Check](#health-check)
- [Troubleshooting](#troubleshooting)

---

## Quick Start (Docker)

The fastest way to get Veritas Kanban running in production:

```bash
# Clone the repository
git clone https://github.com/BradGroux/veritas-kanban.git
cd veritas-kanban

# Copy and configure environment
cp server/.env.example server/.env
# Edit server/.env — at minimum, set VERITAS_ADMIN_KEY to a strong secret

# Build and start
docker compose up -d --build

# Verify it's running
curl http://localhost:3001/health
# → {"status":"ok","timestamp":"..."}
```

The app is now available at **http://localhost:3001**.

Data is persisted in a Docker named volume (`kanban-data`), so it survives container restarts.

---

## Docker Configuration

### Dockerfile Overview

The multi-stage Dockerfile produces a minimal production image (< 200 MB):

| Stage          | Purpose                                 |
| -------------- | --------------------------------------- |
| `deps`         | Install all pnpm workspace dependencies |
| `build-shared` | Compile the shared TypeScript package   |
| `build-web`    | Build the React frontend with Vite      |
| `build-server` | Compile the Express server TypeScript   |
| `production`   | Minimal Node.js 22 Alpine runtime       |

The production stage runs as a non-root user (`veritas`, UID 1001) for security.

**Path Resolution (v2.1.3):** All services use the shared `paths.ts` utility for consistent path resolution. The resolution priority is: `DATA_DIR` / `VERITAS_DATA_DIR` env var → auto-discovery of monorepo root (walks up from cwd looking for `pnpm-workspace.yaml`) → fallback to cwd. A filesystem root guard prevents silent `/` resolution, which previously caused `EACCES: permission denied` errors in Docker. The production image uses `WORKDIR /app/server` for backwards compatibility.

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
      - VERITAS_AUTH_ENABLED=true
      - VERITAS_ADMIN_KEY=your-secure-admin-key-here
      # - VERITAS_JWT_SECRET=your-jwt-secret-here
      # - CORS_ORIGINS=https://kanban.example.com
      # - VERITAS_API_KEYS=agent1:key1:agent,reader:key2:read-only
    volumes:
      - kanban-data:/app/data
    restart: unless-stopped

volumes:
  kanban-data:
    driver: local
```

### Exposed Ports

| Port | Protocol | Description                            |
| ---- | -------- | -------------------------------------- |
| 3001 | HTTP     | API server + static frontend           |
| 3001 | WS       | WebSocket (real-time updates) on `/ws` |

### Build Arguments

The Dockerfile does not use build arguments — all configuration is done via runtime environment variables.

### Using a Bind Mount Instead of a Named Volume

If you prefer direct filesystem access to data:

```yaml
volumes:
  - ./data:/app/data
```

Make sure the host directory exists and is writable by UID 1001:

```bash
mkdir -p ./data
chown 1001:1001 ./data
```

---

## Bare Metal Deployment

### Prerequisites

| Requirement | Version |
| ----------- | ------- |
| Node.js     | 22.0.0+ |
| pnpm        | 9.0.0+  |

Install pnpm if not present:

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
```

### Build Steps

```bash
# Clone
git clone https://github.com/BradGroux/veritas-kanban.git
cd veritas-kanban

# Install dependencies
pnpm install --frozen-lockfile

# Build all packages (shared → server + web)
pnpm build

# Set up environment
cp server/.env.example server/.env
# Edit server/.env — configure VERITAS_ADMIN_KEY and other settings
```

### Running

```bash
# Start the production server
NODE_ENV=production node server/dist/index.js
```

The server:

- Serves the API at `http://localhost:3001/api`
- Serves the built React frontend at `http://localhost:3001`
- Provides WebSocket updates at `ws://localhost:3001/ws`
- Exposes API docs at `http://localhost:3001/api-docs`

### Reverse Proxy (nginx)

When running behind nginx (or any reverse proxy), set the `TRUST_PROXY` environment
variable so Express can correctly detect the real client IP from `X-Forwarded-*`
headers. This is required for accurate rate limiting and security logging.

Common values:

- `TRUST_PROXY=1` — trust a single proxy hop (most common when nginx is directly in front)
- ~~`TRUST_PROXY=true`~~ — **blocked by default** (trusts all proxies, dangerous on public internet). Use a hop count or subnet instead
- `TRUST_PROXY=loopback` — only trust loopback addresses (`127.0.0.1`, `::1`)

See the Express docs for full options: https://expressjs.com/en/guide/behind-proxies.html

Place behind nginx for TLS termination and HTTP/2:

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

    # Security headers (Veritas sets its own via Helmet, but these add defense-in-depth)
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

    # Proxy API and frontend
    location / {
        proxy_pass http://veritas;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Request ID propagation
        proxy_set_header X-Request-ID $request_id;
    }

    # WebSocket upgrade
    location /ws {
        proxy_pass http://veritas;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Prevent proxy from closing idle WebSocket connections
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}

# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name kanban.example.com;
    return 301 https://$server_name$request_uri;
}
```

When using a reverse proxy, update `CORS_ORIGINS` to your public domain:

```env
CORS_ORIGINS=https://kanban.example.com
```

### Reverse Proxy (Caddy)

When using Caddy as a reverse proxy, also set `TRUST_PROXY` so Express trusts the
Caddy hop and uses the correct client IP for rate limiting and logging.

Examples:

```env
TRUST_PROXY=1       # Caddy directly in front of Veritas Kanban
TRUST_PROXY=2       # If an additional CDN sits in front of Caddy
```

Caddy handles TLS automatically:

```caddyfile
kanban.example.com {
    reverse_proxy localhost:3001
}
```

Caddy automatically provisions and renews Let's Encrypt certificates, handles HTTP→HTTPS redirects, and supports WebSocket proxying out of the box.

### systemd Service

Create `/etc/systemd/system/veritas-kanban.service`:

```ini
[Unit]
Description=Veritas Kanban
Documentation=https://github.com/BradGroux/veritas-kanban
After=network.target

[Service]
Type=simple
User=veritas
Group=veritas
WorkingDirectory=/opt/veritas-kanban
ExecStart=/usr/bin/node server/dist/index.js
Restart=on-failure
RestartSec=5
StartLimitBurst=5
StartLimitIntervalSec=60

# Environment
Environment=NODE_ENV=production
Environment=PORT=3001
EnvironmentFile=-/opt/veritas-kanban/server/.env

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/veritas-kanban/.veritas-kanban /opt/veritas-kanban/tasks
PrivateTmp=true

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=veritas-kanban

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
# Create service user
sudo useradd -r -s /bin/false veritas

# Set ownership
sudo chown -R veritas:veritas /opt/veritas-kanban

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable veritas-kanban
sudo systemctl start veritas-kanban

# Check status
sudo systemctl status veritas-kanban
sudo journalctl -u veritas-kanban -f
```

---

## Environment Variables

All variables are set in `server/.env` (or passed as environment variables in Docker).

### Server Configuration

| Variable    | Default | Description                                                       |
| ----------- | ------- | ----------------------------------------------------------------- |
| `PORT`      | `3001`  | HTTP server port                                                  |
| `NODE_ENV`  | —       | Set to `production` for production deployments                    |
| `LOG_LEVEL` | `info`  | Log verbosity: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |

### Authentication

| Variable                        | Default        | Description                                                                                                                                            |
| ------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VERITAS_AUTH_ENABLED`          | `true`         | Enable/disable authentication. Set `false` to disable (not recommended for production)                                                                 |
| `VERITAS_ADMIN_KEY`             | —              | Admin API key with full access. **Must be ≥ 32 characters.** Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `VERITAS_API_KEYS`              | —              | Additional API keys. Format: `name:key:role,name2:key2:role2`. Roles: `admin`, `agent`, `read-only`                                                    |
| `VERITAS_JWT_SECRET`            | auto-generated | JWT signing secret for user sessions. If unset, auto-generated (sessions won't survive restarts). Generate with: `openssl rand -hex 64`                |
| `VERITAS_AUTH_LOCALHOST_BYPASS` | `false`        | Allow unauthenticated requests from localhost                                                                                                          |
| `VERITAS_AUTH_LOCALHOST_ROLE`   | `read-only`    | Role for unauthenticated localhost connections: `read-only`, `agent`, or `admin`                                                                       |

### Networking & Security

| Variable          | Default                                           | Description                                                                                            |
| ----------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `CORS_ORIGINS`    | `http://localhost:3000,http://localhost:5173,...` | Comma-separated list of allowed CORS origins                                                           |
| `RATE_LIMIT_MAX`  | `300`                                             | Max API requests per minute per IP (localhost exempt). Auth endpoints have a stricter 15 req/min limit |
| `CSP_REPORT_ONLY` | `false`                                           | Use Content-Security-Policy-Report-Only instead of enforcing                                           |
| `CSP_REPORT_URI`  | —                                                 | URL to receive CSP violation reports                                                                   |

### Data & Storage

| Variable                   | Default                                      | Description                                                                |
| -------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| `VERITAS_DATA_DIR`         | `.veritas-kanban` (relative to project root) | Directory for config, logs, and internal data                              |
| `DATA_DIR`                 | `/app/data` (Docker only)                    | Mapped data directory inside the Docker container                          |
| `TELEMETRY_RETENTION_DAYS` | `30`                                         | Days to keep telemetry event files before deletion                         |
| `TELEMETRY_COMPRESS_DAYS`  | `7`                                          | Days after which NDJSON telemetry files are gzip-compressed (0 = disabled) |

### Integration

| Variable           | Default                  | Description                                     |
| ------------------ | ------------------------ | ----------------------------------------------- |
| `CLAWDBOT_GATEWAY` | `http://127.0.0.1:18789` | OpenClaw gateway URL for AI agent orchestration |

### Frontend (web/.env)

| Variable       | Default                         | Description                                                   |
| -------------- | ------------------------------- | ------------------------------------------------------------- |
| `VITE_API_URL` | `/api` (uses Vite proxy in dev) | API base URL. Set if the server runs on a different host/port |

### Authentication Methods

The API supports three authentication methods:

```bash
# 1. Authorization header (Bearer token)
curl -H "Authorization: Bearer <api-key>" http://localhost:3001/api/tasks

# 2. X-API-Key header
curl -H "X-API-Key: <api-key>" http://localhost:3001/api/tasks

# 3. Query parameter (for WebSocket connections)
wscat -c "ws://localhost:3001/ws?api_key=<api-key>"
```

### Role Permissions

| Role        | Access                                         |
| ----------- | ---------------------------------------------- |
| `admin`     | Full access to all endpoints                   |
| `agent`     | Read/write tasks, run agents, manage worktrees |
| `read-only` | GET endpoints only (view tasks, read config)   |

---

## Data & Backup

### Where Data Lives

| Path                              | Contents                                               |
| --------------------------------- | ------------------------------------------------------ |
| `tasks/active/`                   | Active task markdown files (YAML frontmatter + body)   |
| `tasks/archive/`                  | Archived task markdown files                           |
| `.veritas-kanban/`                | Internal config, logs, worktrees, agent requests       |
| `.veritas-kanban/config.json`     | Application settings                                   |
| `.veritas-kanban/security.json`   | JWT secret (if not using `VERITAS_JWT_SECRET` env var) |
| `.veritas-kanban/logs/`           | Application logs                                       |
| `.veritas-kanban/worktrees/`      | Git worktree metadata                                  |
| `.veritas-kanban/agent-requests/` | Pending AI agent requests                              |

In Docker, the `DATA_DIR` environment variable maps to `/app/data` by default inside the container.

**Auth state persistence fix (v3.1.1):** Runtime config/state files (including `security.json`) now always live under `${DATA_DIR}/.veritas-kanban`. On startup, Veritas Kanban will automatically migrate any legacy runtime files it finds in container-only paths (for example, `/app/.veritas-kanban` or `/app/server/.veritas-kanban`) into the Docker volume.

If you upgraded from an older image and already lost auth state, you can recover by copying `security.json` from a still-running/old container (if available) into the volume:

```bash
# Find the old container ID, then copy the file into your host
docker cp <old-container>:/app/server/.veritas-kanban/security.json ./security.json

# Or if it lived at /app/.veritas-kanban
docker cp <old-container>:/app/.veritas-kanban/security.json ./security.json

# Place it into the volume-backed data dir
mkdir -p ./data/.veritas-kanban
cp ./security.json ./data/.veritas-kanban/security.json
```

For older versions (pre-3.1.1), set `DATA_DIR` or `VERITAS_DATA_DIR` to `/app/data` in `docker-compose.yml` to ensure runtime state persists across rebuilds.

### Backup

#### Bare Metal

```bash
# Full backup
tar czf veritas-backup-$(date +%Y%m%d).tar.gz \
  tasks/ \
  .veritas-kanban/ \
  server/.env

# Tasks only
tar czf veritas-tasks-$(date +%Y%m%d).tar.gz tasks/
```

#### Docker

```bash
# Backup the named volume
docker run --rm \
  -v kanban-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/veritas-backup-$(date +%Y%m%d).tar.gz -C /data .

# Or copy from the running container
docker cp veritas-kanban:/app/data ./backup-data
```

### Restore

#### Bare Metal

```bash
# Stop the server first
sudo systemctl stop veritas-kanban

# Restore
tar xzf veritas-backup-20260129.tar.gz -C /opt/veritas-kanban/

# Restart
sudo systemctl start veritas-kanban
```

#### Docker

```bash
# Stop the container
docker compose down

# Restore into the volume
docker run --rm \
  -v kanban-data:/data \
  -v $(pwd):/backup \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/veritas-backup-20260129.tar.gz -C /data"

# Restart
docker compose up -d
```

---

## Upgrading

### Docker

```bash
cd veritas-kanban

# Pull latest changes
git pull

# Rebuild and restart (zero-downtime with health check)
docker compose up -d --build

# Verify
docker compose logs -f
curl http://localhost:3001/health
```

### Bare Metal

```bash
cd /opt/veritas-kanban

# Pull latest changes
git pull

# Install any new dependencies
pnpm install --frozen-lockfile

# Rebuild all packages
pnpm build

# Restart the service
sudo systemctl restart veritas-kanban

# Verify
curl http://localhost:3001/health
sudo journalctl -u veritas-kanban --since "1 min ago"
```

### Migration Notes

Veritas Kanban runs startup migrations automatically (`runStartupMigrations()` in `server/src/index.ts`). These are idempotent and safe to run on every startup — no manual migration steps are needed during upgrades.

---

## Health Check

The server exposes an unauthenticated health endpoint:

```bash
curl http://localhost:3001/health
# → {"status":"ok","timestamp":"2026-01-29T12:00:00.000Z"}
```

The Docker image includes a built-in health check:

- **Interval:** 30 seconds
- **Timeout:** 5 seconds
- **Start period:** 10 seconds
- **Retries:** 3

Check container health status:

```bash
docker inspect --format='{{.State.Health.Status}}' veritas-kanban
```

---

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose logs veritas-kanban

# Common issues:
# - Port 3001 already in use → change the port mapping
# - Permission denied on volume → check UID 1001 ownership
```

### Authentication not working

```bash
# Check auth diagnostics (requires admin key)
curl -H "X-API-Key: your-admin-key" http://localhost:3001/api/auth/diagnostics
```

### WebSocket connection refused

- Verify `CORS_ORIGINS` includes your frontend URL
- If behind a reverse proxy, ensure WebSocket upgrade headers are forwarded
- Check that the proxy timeout is long enough (WebSocket connections are long-lived)

### Weak admin key warning at startup

The server warns if `VERITAS_ADMIN_KEY` is less than 32 characters. Generate a strong key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### API documentation

The built-in Swagger UI is available at:

```
http://localhost:3001/api-docs
```

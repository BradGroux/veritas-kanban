# Veritas Kanban — Demo Environment

Spin up a fully populated VK instance with one command. Includes sample tasks, agents, sprints, squad chat, and telemetry data.

## Quick Start

```bash
# From the repo root:
npm run demo

# Or directly:
docker compose -f demo/docker-compose.demo.yml up --build
```

Then open **http://localhost:3099**

The demo binds to `127.0.0.1` and disables auth by default. Keep it local. For LAN, tunnel, VPS, or reverse-proxy access, set `VERITAS_AUTH_ENABLED=true`, replace `VERITAS_ADMIN_KEY`, and intentionally set `DEMO_BIND` to the required interface.

## What's Included

The demo seeds realistic data showcasing VK's features:

| Feature        | Sample Data                                                     |
| -------------- | --------------------------------------------------------------- |
| **Tasks**      | 10 tasks across all statuses (open, in-progress, done, blocked) |
| **Agents**     | 4 agents (VERITAS, TARS, CASE, Ava) with different statuses     |
| **Sprints**    | 2 sprints (1 active, 1 completed) with task assignments         |
| **Squad Chat** | 6 messages showing agent collaboration                          |
| **Telemetry**  | Run events, token usage, and duration tracking                  |

## Configuration

Copy `.env.example` to `.env` to customize:

```bash
cp demo/.env.example demo/.env
```

| Variable               | Default               | Description                                      |
| ---------------------- | --------------------- | ------------------------------------------------ |
| `DEMO_PORT`            | `3099`                | Host port for the UI                             |
| `DEMO_BIND`            | `127.0.0.1`           | Host interface for the published port            |
| `VERITAS_ADMIN_KEY`    | `demo-admin-key-2026` | Throwaway local demo key                         |
| `VERITAS_AUTH_ENABLED` | `false`               | Set `true` before any non-loopback demo exposure |

## Reset Demo Data

```bash
# Stop and remove volumes
docker compose -f demo/docker-compose.demo.yml down -v

# Start fresh
docker compose -f demo/docker-compose.demo.yml up --build
```

## How It Works

1. `docker-compose.demo.yml` builds VK from the repo Dockerfile
2. A lightweight `alpine` sidecar waits for the health check
3. `seed.sh` POSTs demo data via the VK API
4. The sidecar exits; VK keeps running with seeded data

Data persists in a Docker volume (`demo-data`) across restarts. The seed script is idempotent — it skips if tasks already exist.

## Validate Compose Output

Before changing bind/auth settings, inspect the generated config:

```bash
docker compose -f demo/docker-compose.demo.yml config
```

The default `ports` output should include `127.0.0.1:3099:3001`.

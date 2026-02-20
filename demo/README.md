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

| Variable               | Default               | Description                |
| ---------------------- | --------------------- | -------------------------- |
| `DEMO_PORT`            | `3099`                | Host port for the UI       |
| `VERITAS_ADMIN_KEY`    | `demo-admin-key-2026` | API admin key              |
| `VERITAS_AUTH_ENABLED` | `false`               | Set `true` to require auth |

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

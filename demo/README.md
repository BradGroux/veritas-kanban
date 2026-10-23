# Veritas Kanban — Demo Environment

Spin up a fully populated VK instance with one command. Includes sample tasks, agents, sprints, squad chat, and telemetry data.

## Quick Start

```bash
# From the repo root:
pnpm demo

# Or directly:
docker compose -f demo/docker-compose.demo.yml up --build
```

Then open **http://localhost:3099**

The demo binds to `127.0.0.1` and disables auth by default. Keep it local. For LAN, tunnel, VPS, or reverse-proxy access, set `VERITAS_AUTH_ENABLED=true`, replace `VERITAS_ADMIN_KEY`, and intentionally set `DEMO_BIND` to the required interface.

## What's Included

The demo seeds realistic data showcasing VK's features:

| Feature        | Sample Data                                          |
| -------------- | ---------------------------------------------------- |
| **Tasks**      | 10 tasks across todo, in-progress, done, and blocked |
| **Agents**     | 4 registry fixtures (VERITAS, TARS, CASE, Ava)       |
| **Sprints**    | 2 managed sprint groupings with 7 task assignments   |
| **Squad Chat** | 6 messages showing agent collaboration               |
| **Telemetry**  | 7 sample run events, plus normal task-created events |

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
2. A Node sidecar from the same application image waits for the API health check
3. `seed.mjs` uses the shared bounded API client and authenticates with the demo admin key
4. The sidecar verifies each returned record through fresh API reads, then exits; VK keeps running with seeded data

Data and the seed checkpoint (`demo-seed-state.json`) persist in the dedicated Docker volume (`demo-data`). Repeating the seed creates only missing fixtures. A rejected write, lost acknowledgement, or failed completion readback exits nonzero; restart the seed sidecar to resume. The checkpoint records server-assigned IDs and prevents a partial import from being mistaken for completion. Retained fixture edits are preserved.

Sprint labels are managed-list groupings, not active/completed sprint records. Their descriptions retain the sample dates and goals. Agent registrations are sample roster entries, not proof of a live provider session or runtime readiness. Task subtasks use the current completed/created fields; unsupported historical time-tracking fields are not submitted. Squad links and telemetry refer to the actual created task IDs.

An incompatible legacy fixture, ambiguous match, missing checkpointed record, corrupt checkpoint, or checkpoint for another API stops the seed without replacing retained data. Inspect the dedicated demo volume before retrying. The reset command above permanently removes that demo volume and its checkpoint; use it only when those fixtures may be discarded.

For a local contract check after building shared and server, run `node --test demo/seed.test.mjs`. It starts isolated, auth-enabled API processes with synthetic credentials and disposable data, checks repeat imports and interrupted-write recovery, and preserves failed fixture directories for inspection.

## Validate Compose Output

Before changing bind/auth settings, inspect the generated config:

```bash
docker compose -f demo/docker-compose.demo.yml config
```

The default `ports` output should include `127.0.0.1:3099:3001`.

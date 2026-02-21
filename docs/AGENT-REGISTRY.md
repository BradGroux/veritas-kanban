# Agent Registry

The Agent Registry is a service discovery and liveness tracking system for AI agents working with Veritas Kanban. It answers three questions: **who's available**, **what can they do**, and **are they still alive**.

## Overview

| Feature          | Description                                             |
| ---------------- | ------------------------------------------------------- |
| **Registration** | Agents register on startup with ID, model, capabilities |
| **Heartbeats**   | Periodic pings prove liveness; 5 min timeout → offline  |
| **Discovery**    | Query by status, capability, or ID                      |
| **Persistence**  | File-backed JSON survives server restarts               |
| **Dashboard**    | Live agent cards in the board sidebar                   |

**Storage:** `.veritas-kanban/agent-registry.json`

---

## Current Roster

| Agent        | Role         | Model             | Capabilities                                                      |
| ------------ | ------------ | ----------------- | ----------------------------------------------------------------- |
| **VERITAS**  | Orchestrator | claude-opus-4-6   | strategy, orchestration, research, code-review, writing, analysis |
| **TARS**     | Lead         | claude-opus-4-6   | code-review, architecture, security, refactoring                  |
| **CASE**     | Lead         | claude-opus-4-6   | research, analysis, documentation, writing                        |
| **Ava**      | Specialist   | claude-sonnet-4-5 | frontend, ui-design, css, react                                   |
| **R2-D2**    | Specialist   | claude-sonnet-4-5 | automation, scripting, devops, testing                            |
| **K-2SO**    | Specialist   | claude-sonnet-4-5 | security, audit, penetration-testing, compliance                  |
| **MAX**      | Specialist   | claude-sonnet-4-5 | data-analysis, visualization, metrics, reporting                  |
| **Johnny 5** | Intern       | claude-haiku-4-5  | documentation, formatting, file-organization                      |
| **Bishop**   | Specialist   | claude-sonnet-4-5 | backend, api-design, database, performance                        |
| **Marvin**   | Intern       | claude-haiku-4-5  | testing, qa, bug-reproduction, grunt-work                         |

### Role Hierarchy

- **Orchestrator** — Coordinates all work, spawns sub-agents, makes decisions
- **Lead** — Trusted with complex tasks, can work independently on architecture-level problems
- **Specialist** — Focused expertise, assigned to tasks matching their capabilities
- **Intern** — Lightweight tasks, documentation, grunt work (uses cheaper models)

---

## API Reference

Base URL: `/api/agents/register`

### Register an Agent

```
POST /api/agents/register
```

Registers a new agent or updates an existing one. Sets status to `online` automatically.

**Request Body:**

```json
{
  "id": "TARS",
  "name": "TARS",
  "model": "claude-opus-4-6",
  "provider": "anthropic",
  "capabilities": [
    { "name": "code-review", "description": "Reviews code for quality and security" },
    { "name": "architecture" },
    { "name": "security" },
    { "name": "refactoring" }
  ],
  "version": "2.0.0",
  "metadata": { "role": "lead", "reference": "Interstellar" },
  "sessionKey": "optional-openclaw-session-key"
}
```

| Field          | Type   | Required | Description                              |
| -------------- | ------ | -------- | ---------------------------------------- |
| `id`           | string | ✅       | Unique identifier (1-50 chars)           |
| `name`         | string | ✅       | Display name (1-100 chars)               |
| `model`        | string |          | Model identifier                         |
| `provider`     | string |          | Provider name                            |
| `capabilities` | array  |          | List of `{ name, description? }` objects |
| `version`      | string |          | Agent version or build info              |
| `metadata`     | object |          | Freeform key-value data                  |
| `sessionKey`   | string |          | OpenClaw session key for routing         |

**Response:** `201 Created`

```json
{
  "id": "TARS",
  "name": "TARS",
  "model": "claude-opus-4-6",
  "provider": "anthropic",
  "capabilities": [{ "name": "code-review" }, { "name": "architecture" }],
  "version": "2.0.0",
  "metadata": { "role": "lead" },
  "status": "online",
  "registeredAt": "2026-02-06T01:55:00.000Z",
  "lastHeartbeat": "2026-02-06T01:55:00.000Z"
}
```

---

### Send Heartbeat

```
POST /api/agents/register/:id/heartbeat
```

Updates the agent's last-seen timestamp and optionally changes status or task assignment. **Agents that don't heartbeat within 5 minutes are marked `offline`.**

**Request Body (all fields optional):**

```json
{
  "status": "busy",
  "currentTaskId": "task_20260206_abc123",
  "currentTaskTitle": "Implement authentication flow",
  "metadata": { "progress": 0.65 }
}
```

| Field              | Type           | Values                   | Description                             |
| ------------------ | -------------- | ------------------------ | --------------------------------------- |
| `status`           | string         | `online`, `busy`, `idle` | Agent's current state                   |
| `currentTaskId`    | string \| null |                          | Task ID being worked on (null to clear) |
| `currentTaskTitle` | string \| null |                          | Task title (null to clear)              |
| `metadata`         | object         |                          | Merge additional metadata               |

**Response:** `200 OK` — Returns updated agent object.

**Error:** `404` if agent not registered. Register first.

---

### List All Agents

```
GET /api/agents/register
GET /api/agents/register?status=online
GET /api/agents/register?capability=security
```

| Param        | Description                                           |
| ------------ | ----------------------------------------------------- |
| `status`     | Filter by status: `online`, `busy`, `idle`, `offline` |
| `capability` | Filter by capability name (case-insensitive)          |

**Response:** `200 OK` — Array of agent objects.

---

### Get Specific Agent

```
GET /api/agents/register/:id
```

**Response:** `200 OK` — Single agent object, or `404` if not found.

---

### Registry Statistics

```
GET /api/agents/register/stats
```

**Response:**

```json
{
  "total": 10,
  "online": 1,
  "busy": 0,
  "idle": 7,
  "offline": 2,
  "capabilities": ["analysis", "architecture", "automation", "backend", "code-review", "..."]
}
```

---

### Find by Capability

```
GET /api/agents/register/capabilities/:capability
```

Returns all non-offline agents that have the specified capability.

```
GET /api/agents/register/capabilities/security
```

**Response:** Array of agents with matching capability.

---

### Deregister an Agent

```
DELETE /api/agents/register/:id
```

Removes the agent from the registry entirely.

**Response:** `200 OK` — `{ "removed": true }`, or `404` if not found.

---

## Agent Lifecycle

```
┌─────────┐    register     ┌────────┐
│  (new)  │ ──────────────► │ online │
└─────────┘                 └───┬────┘
                                │
                    heartbeat   │   heartbeat
                  status=busy   │   status=idle
                       ┌────────┼────────┐
                       ▼        │        ▼
                  ┌────────┐    │   ┌────────┐
                  │  busy  │◄───┘──►│  idle  │
                  └────────┘        └────────┘
                       │                │
                       │  5 min timeout │
                       │  (no heartbeat)│
                       ▼                ▼
                  ┌─────────────────────────┐
                  │        offline          │
                  └─────────────────────────┘
                       │
                       │  re-register or heartbeat
                       ▼
                  ┌────────┐
                  │ online │
                  └────────┘
```

### Status Values

| Status    | Meaning                                      |
| --------- | -------------------------------------------- |
| `online`  | Agent is running and available for work      |
| `busy`    | Agent is actively working on a task          |
| `idle`    | Agent is running but not working on anything |
| `offline` | No heartbeat received in 5 minutes           |

---

## Instructions for Agents

### On Startup (MANDATORY)

Every agent must register itself when it starts working. This is the **first thing** you do.

```bash
curl -s -X POST http://localhost:3001/api/agents/register \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "YOUR_AGENT_NAME",
    "name": "YOUR_AGENT_NAME",
    "model": "anthropic/claude-sonnet-4-5",
    "provider": "anthropic",
    "capabilities": [{"name": "your-skill"}],
    "version": "2.0.0",
    "metadata": {"role": "specialist"}
  }'
```

### When Starting a Task

Update your status to `busy` with the task info:

```bash
curl -s -X POST http://localhost:3001/api/agents/register/YOUR_AGENT_NAME/heartbeat \
  -H 'Content-Type: application/json' \
  -d '{
    "status": "busy",
    "currentTaskId": "task_id_here",
    "currentTaskTitle": "What you are working on"
  }'
```

### While Working (every 2-3 minutes)

Send heartbeats to stay marked as online. If you skip this for 5 minutes, the registry marks you `offline`.

```bash
curl -s -X POST http://localhost:3001/api/agents/register/YOUR_AGENT_NAME/heartbeat \
  -H 'Content-Type: application/json' \
  -d '{"status": "busy"}'
```

### When Done with a Task

Clear the task assignment and go idle:

```bash
curl -s -X POST http://localhost:3001/api/agents/register/YOUR_AGENT_NAME/heartbeat \
  -H 'Content-Type: application/json' \
  -d '{
    "status": "idle",
    "currentTaskId": null,
    "currentTaskTitle": null
  }'
```

### Sub-Agent Spawn Template

When the orchestrator (VERITAS) spawns a sub-agent via `sessions_spawn`, include this block at the **top** of the task prompt:

```
FIRST ACTION (before any other work):
1. Register yourself with Veritas Kanban:
   curl -s -X POST http://localhost:3001/api/agents/register \
     -H 'Content-Type: application/json' \
     -d '{"id":"AGENT_NAME","name":"AGENT_NAME","model":"MODEL","provider":"anthropic","capabilities":[{"name":"SKILL"}],"version":"2.0.0","metadata":{"role":"ROLE"}}'

2. Set yourself as busy on the task:
   curl -s -X POST http://localhost:3001/api/agents/register/AGENT_NAME/heartbeat \
     -H 'Content-Type: application/json' \
     -d '{"status":"busy","currentTaskId":"TASK_ID","currentTaskTitle":"TASK_TITLE"}'

3. When finished, set idle:
   curl -s -X POST http://localhost:3001/api/agents/register/AGENT_NAME/heartbeat \
     -H 'Content-Type: application/json' \
     -d '{"status":"idle","currentTaskId":null,"currentTaskTitle":null}'
```

### Name Assignment

Sub-agents are assigned names sequentially from this roster:

| Order | Name         | Reference               |
| ----- | ------------ | ----------------------- |
| 1st   | **TARS**     | Interstellar            |
| 2nd   | **CASE**     | Interstellar            |
| 3rd   | **Ava**      | Ex Machina              |
| 4th   | **R2-D2**    | Star Wars               |
| 5th   | **K-2SO**    | Rogue One               |
| 6th   | **MAX**      | Flight of the Navigator |
| 7th   | **Johnny 5** | Short Circuit           |
| 8th   | **Bishop**   | Aliens                  |
| 9th   | **Marvin**   | Hitchhiker's Guide      |

Names reset each session. The orchestrator is always **VERITAS**.

---

## Dashboard Integration

The board sidebar shows a live **Multi-Agent Panel** with:

- Agent status cards (color-coded: green=online, amber=busy, gray=idle/offline)
- Current task assignment per agent
- Model and capability info
- Real-time updates via WebSocket

The panel reads from the registry API and updates every 30 seconds (plus WebSocket push on changes).

---

## Configuration

| Setting                   | Default            | Description                                  |
| ------------------------- | ------------------ | -------------------------------------------- |
| `HEARTBEAT_TIMEOUT_MS`    | 300,000 (5 min)    | Time before marking agent offline            |
| `STALE_CHECK_INTERVAL_MS` | 60,000 (1 min)     | How often the server checks for stale agents |
| `VERITAS_DATA_DIR`        | `.veritas-kanban/` | Directory for registry JSON file             |

---

## File Format

The registry is stored as JSON at `.veritas-kanban/agent-registry.json`:

```json
{
  "agents": {
    "VERITAS": {
      "id": "VERITAS",
      "name": "VERITAS",
      "model": "anthropic/claude-opus-4-6",
      "provider": "anthropic",
      "capabilities": [{ "name": "strategy" }, { "name": "orchestration" }],
      "version": "2.0.0",
      "metadata": { "role": "orchestrator" },
      "status": "online",
      "registeredAt": "2026-02-06T01:55:00.000Z",
      "lastHeartbeat": "2026-02-06T01:58:00.000Z",
      "currentTaskId": "task_20260206_abc123",
      "currentTaskTitle": "Dashboard metrics audit"
    }
  },
  "lastUpdated": "2026-02-06T01:58:00.000Z"
}
```

The service loads this file on startup and persists after every change. You can manually edit this file (with the server stopped) to seed or reset the registry.

---

## Troubleshooting

| Problem                  | Cause                      | Fix                                                                                    |
| ------------------------ | -------------------------- | -------------------------------------------------------------------------------------- |
| Agent shows offline      | No heartbeat in 5 min      | Send heartbeat or re-register                                                          |
| Registry returns empty   | File format mismatch       | Ensure `capabilities` are `{name}` objects, status is `online`/`busy`/`idle`/`offline` |
| API times out            | Route ordering conflict    | Ensure `/agents/register` is mounted before `/agents` catch-all in `v1/index.ts`       |
| Agent not in dashboard   | Dashboard caching          | Hard refresh (Cmd+Shift+R)                                                             |
| Sub-agent not registered | Missing spawn instructions | Add registration block to `sessions_spawn` task prompt                                 |

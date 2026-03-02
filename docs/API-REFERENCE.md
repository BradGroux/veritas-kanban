# Veritas Kanban — API Reference

**Version**: 3.3.3  
**Last Updated**: 2026-03-02  
**Base URL**: `http://localhost:3001/api`  
**Canonical prefix**: `/api/v1` (alias: `/api`)

> This is the source-of-truth companion to the Swagger/OpenAPI spec. For workflow-engine-specific endpoints, see [API-WORKFLOWS.md](API-WORKFLOWS.md).

---

## Table of Contents

1. [Authentication](#authentication)
2. [Base URLs & Environments](#base-urls--environments)
3. [Error Model](#error-model)
4. [Tasks](#tasks)
5. [Time Tracking](#time-tracking)
6. [Observations](#observations)
7. [Analytics](#analytics)
8. [Configuration](#configuration)
9. [Settings](#settings)
10. [Lifecycle Hooks](#lifecycle-hooks)
11. [Chat & Squad](#chat--squad)
12. [Agent Status](#agent-status)
13. [Auth & Diagnostics](#auth--diagnostics)
14. [Telemetry](#telemetry)
15. [Health](#health)
16. [WebSocket](#websocket)
17. [Common Workflows](#common-workflows)
18. [Versioning & Deprecation](#versioning--deprecation)
19. [Rate Limits](#rate-limits)
20. [Additional Endpoint Groups](#additional-endpoint-groups)

---

## Authentication

VK supports three authentication methods. All are optional when running locally with `VERITAS_AUTH_ENABLED=false`.

### Methods

| Method                 | Header / Param                  | Use Case                    |
| ---------------------- | ------------------------------- | --------------------------- |
| **Bearer Token** (JWT) | `Authorization: Bearer <token>` | Browser sessions, UI login  |
| **API Key**            | `X-API-Key: <key>`              | Agent integrations, scripts |
| **WS Query Param**     | `ws://host:port/ws?token=<key>` | WebSocket connections       |

### Roles

| Role        | Permissions                                                      |
| ----------- | ---------------------------------------------------------------- |
| `admin`     | Full access — all endpoints, destructive operations, deep health |
| `agent`     | Read/write tasks, time tracking, observations, chat, telemetry   |
| `read-only` | Read-only access to all GET endpoints                            |

### Localhost Bypass

When `VERITAS_AUTH_LOCALHOST_BYPASS=true`, requests from `127.0.0.1` / `::1` are authenticated automatically with the role set by `VERITAS_AUTH_LOCALHOST_ROLE` (default: `read-only`).

### API Key Configuration

Set via environment:

```bash
# Admin key
VERITAS_ADMIN_KEY=your-admin-key

# Additional keys (format: name:key:role, comma-separated)
VERITAS_API_KEYS=agent1:key123:agent,readonly:key456:read-only
```

---

## Base URLs & Environments

| Environment | Base URL                             | Notes                        |
| ----------- | ------------------------------------ | ---------------------------- |
| Local dev   | `http://localhost:3001/api`          | Default port                 |
| Production  | Deploy behind reverse proxy with TLS | Add rate limiting externally |

Both `/api/v1/...` and `/api/...` resolve to the same handlers. Use `/api` for brevity.

---

## Error Model

All errors return a consistent JSON envelope:

```json
{
  "error": "Human-readable message",
  "code": "OPTIONAL_ERROR_CODE",
  "details": {}
}
```

### Status Codes

| Code  | Meaning                                    |
| ----- | ------------------------------------------ |
| `200` | Success                                    |
| `201` | Created                                    |
| `400` | Bad request — invalid body, missing fields |
| `401` | Not authenticated                          |
| `403` | Forbidden — insufficient role              |
| `404` | Resource not found                         |
| `409` | Conflict — duplicate, state violation      |
| `429` | Rate limited                               |
| `503` | Service degraded (health checks)           |

---

## Tasks

All task routes are mounted at `/api/tasks`.

### List Tasks

```
GET /api/tasks
```

Returns all active tasks. Supports query filters.

**Response** `200`:

```json
{
  "tasks": [
    {
      "id": "TASK-001",
      "title": "Implement login",
      "status": "in-progress",
      "priority": "high",
      "project": "rubicon",
      "assignee": "agent-1",
      "createdAt": "2026-03-01T10:00:00Z"
    }
  ]
}
```

### Get Task Counts

```
GET /api/tasks/counts
```

Returns task counts grouped by status.

### Create Task

```
POST /api/tasks
```

**Body**:

```json
{
  "title": "Fix auth bug",
  "description": "Session tokens not refreshing",
  "priority": "high",
  "project": "rubicon",
  "type": "bug"
}
```

**Response** `201`: The created task object.

### Get Task

```
GET /api/tasks/:id
```

### Update Task

```
PATCH /api/tasks/:id
```

**Body**: Partial task fields to update (title, description, status, priority, assignee, etc.).

### Delete Task

```
DELETE /api/tasks/:id
```

### Reorder Tasks

```
POST /api/tasks/reorder
```

**Body**: `{ "taskIds": ["TASK-003", "TASK-001", "TASK-002"] }`

### Bulk Update

```
POST /api/tasks/bulk-update
```

**Body**: `{ "taskIds": ["TASK-001", "TASK-002"], "updates": { "status": "done" } }`

### Bulk Archive

```
POST /api/tasks/bulk-archive-by-ids
```

**Body**: `{ "taskIds": ["TASK-001", "TASK-002"] }`

### Blocking Status

```
GET /api/tasks/:id/blocking-status
```

Returns whether a task is blocked by unresolved dependencies.

### Dependencies

```
POST   /api/tasks/:id/dependencies          # Add dependency
DELETE /api/tasks/:id/dependencies/:targetId # Remove dependency
GET    /api/tasks/:id/dependencies           # List dependencies
GET    /api/tasks/:id/dependency-graph       # Full dependency graph
```

### Progress & Checkpointing

```
GET  /api/tasks/:id/progress         # Get progress
PUT  /api/tasks/:id/progress         # Set progress
POST /api/tasks/:id/progress/append  # Append progress entry

POST   /api/tasks/:id/checkpoint     # Save checkpoint
GET    /api/tasks/:id/checkpoint     # Get checkpoint
DELETE /api/tasks/:id/checkpoint     # Clear checkpoint
```

### Context

```
GET /api/tasks/:id/context
```

Returns enriched context for agent consumption (task + dependencies + observations).

### Worktree (Git)

```
POST   /api/tasks/:id/worktree        # Create worktree branch
GET    /api/tasks/:id/worktree         # Get worktree status
DELETE /api/tasks/:id/worktree         # Remove worktree
POST   /api/tasks/:id/worktree/rebase  # Rebase worktree
POST   /api/tasks/:id/worktree/merge   # Merge worktree
GET    /api/tasks/:id/worktree/open    # Open in editor
```

### Apply Template

```
POST /api/tasks/:id/apply-template
```

### Demote Task

```
POST /api/tasks/:id/demote
```

Moves a task back to backlog.

---

## Time Tracking

Mounted at `/api/tasks`.

### Summary

```
GET /api/tasks/time/summary
```

Returns aggregate time tracking data across all tasks.

### Start Timer

```
POST /api/tasks/:id/time/start
```

### Stop Timer

```
POST /api/tasks/:id/time/stop
```

### Add Manual Entry

```
POST /api/tasks/:id/time/entry
```

**Body**:

```json
{
  "durationMs": 3600000,
  "description": "Code review"
}
```

### Delete Entry

```
DELETE /api/tasks/:id/time/entry/:entryId
```

---

## Observations

Observational memory for tasks — agents record learnings, blockers, and notes.

### Add Observation

```
POST /api/tasks/:id/observations
```

**Body**:

```json
{
  "content": "Rate limiter needs Redis for distributed deployments",
  "type": "insight",
  "agent": "codex-1"
}
```

### List Observations

```
GET /api/tasks/:id/observations
```

### Delete Observation

```
DELETE /api/tasks/:id/observations/:obsId
```

### Search Observations (cross-task)

```
GET /api/observations?q=redis&type=insight
```

---

## Analytics

```
GET /api/analytics/timeline   # Task completion timeline
GET /api/analytics/metrics    # Throughput, cycle time, WIP
GET /api/analytics/health     # Board health indicators
```

---

## Configuration

Mounted at `/api/config`.

### Get Config

```
GET /api/config
```

### Repository Management

```
GET    /api/config/repos               # List repos
POST   /api/config/repos               # Add repo
PATCH  /api/config/repos/:name         # Update repo
DELETE /api/config/repos/:name         # Remove repo
POST   /api/config/repos/validate      # Validate repo config
GET    /api/config/repos/:name/branches # List branches
```

### Agent Configuration

```
GET /api/config/agents        # List configured agents
PUT /api/config/agents        # Update agent config
PUT /api/config/default-agent # Set default agent
```

---

## Settings

```
GET   /api/settings/features   # Get feature flags
PATCH /api/settings/features   # Toggle feature flags
```

**Body** (PATCH):

```json
{
  "darkMode": true,
  "squadChat": true,
  "analyticsEnabled": true
}
```

---

## Lifecycle Hooks

Event-driven hooks that fire on task state transitions.

```
GET    /api/hooks                # List hooks
GET    /api/hooks/executions     # List recent executions
POST   /api/hooks                # Create hook
PATCH  /api/hooks/:id            # Update hook
DELETE /api/hooks/:id            # Delete hook
POST   /api/hooks/fire           # Manually fire a hook
```

**Create Hook Body**:

```json
{
  "name": "notify-on-done",
  "event": "task.status.changed",
  "filter": { "newStatus": "done" },
  "action": {
    "type": "webhook",
    "url": "https://example.com/webhook"
  }
}
```

---

## Chat & Squad

### Squad Chat

Post messages to the squad chat channel (agent coordination).

```
POST /api/chat/squad
```

**Body**:

```json
{
  "agent": "VERITAS",
  "message": "Starting cleanup — 14 steps",
  "model": "claude-opus-4.6",
  "tags": ["cleanup"]
}
```

```
GET /api/chat/squad
```

Returns recent squad messages. Supports `?limit=N`.

### Chat Sessions

```
POST   /api/chat/send                 # Send message to a session
GET    /api/chat/sessions              # List sessions
GET    /api/chat/sessions/:id          # Get session
GET    /api/chat/sessions/:id/history  # Get session history
DELETE /api/chat/sessions/:id          # Delete session
```

---

## Agent Status

Real-time agent activity indicator for the board.

```
GET  /api/agent/status   # Current status
POST /api/agent/status   # Update status
```

**Update Body**:

```json
{
  "status": "working",
  "subAgentCount": 2,
  "activeAgents": [
    { "agent": "TARS", "status": "working", "taskTitle": "Fix auth" },
    { "agent": "CASE", "status": "working", "taskTitle": "Add tests" }
  ]
}
```

### Delegation Violation

```
POST /api/agent/status/delegation-violation
```

Reports when an agent violates delegation rules.

---

## Auth & Diagnostics

```
GET  /api/auth/status           # Check auth status & current role
POST /api/auth/setup            # Initial admin setup
POST /api/auth/login            # Login (returns JWT)
POST /api/auth/logout           # Logout / invalidate token
POST /api/auth/recover          # Account recovery
POST /api/auth/change-password  # Change password
POST /api/auth/rotate-secret    # Rotate JWT secret
GET  /api/auth/rotation-status  # JWT rotation status
```

### Login Example

```
POST /api/auth/login
```

**Body**: `{ "password": "admin-password" }`

**Response** `200`:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "role": "admin",
  "expiresIn": "24h"
}
```

---

## Telemetry

Run events, token usage, and metrics — powers the dashboard graphs.

### Post Event

```
POST /api/telemetry/events
```

**Body** (run started):

```json
{
  "type": "run.started",
  "taskId": "TASK-001",
  "agent": "veritas"
}
```

**Body** (run completed):

```json
{
  "type": "run.completed",
  "taskId": "TASK-001",
  "agent": "veritas",
  "durationMs": 45000,
  "success": true
}
```

**Body** (token usage):

```json
{
  "type": "run.tokens",
  "taskId": "TASK-001",
  "agent": "veritas",
  "model": "claude-opus-4.6",
  "inputTokens": 12000,
  "outputTokens": 3500,
  "cacheTokens": 8000,
  "cost": 0.15
}
```

### Bulk Events

```
POST /api/telemetry/events/bulk
```

**Body**: `{ "events": [ ... ] }`

### Query Events

```
GET /api/telemetry/events                  # All events (?type=, ?limit=, ?taskId=)
GET /api/telemetry/events/task/:taskId     # Events for a specific task
GET /api/telemetry/status                  # Telemetry subsystem status
GET /api/telemetry/count                   # Event counts
GET /api/telemetry/export                  # Export events (CSV/JSON)
```

---

## Health

Three-tier health check system for container orchestration.

| Endpoint               | Auth  | Purpose                                                |
| ---------------------- | ----- | ------------------------------------------------------ |
| `GET /health`          | None  | Alias for `/health/live`                               |
| `GET /health/live`     | None  | Liveness probe — process running                       |
| `GET /health/ready`    | None  | Readiness probe — storage, disk, memory                |
| `GET /health/deep`     | Admin | Full diagnostics — version, WS count, circuit breakers |
| `GET /api/health`      | None  | Lightweight API liveness signal                        |
| `GET /api/health/deep` | Admin | Same as `/health/deep`, under `/api`                   |

**Readiness Response**:

```json
{
  "status": "ok",
  "checks": { "storage": "ok", "memory": "ok", "disk": "ok" },
  "timestamp": "2026-03-02T07:00:00Z"
}
```

---

## WebSocket

**Endpoint**: `ws://localhost:3001/ws`

### Connection

```javascript
const ws = new WebSocket('ws://localhost:3001/ws?token=YOUR_API_KEY');
```

- Max connections: 50
- Heartbeat: server pings every 30s; clients must pong within 10s
- Origin validation enforced (CSWSH protection)

### Authentication

Pass API key as `token` query parameter, or rely on localhost bypass if enabled.

### Client → Server Messages

**Subscribe to task output**:

```json
{ "type": "subscribe", "taskId": "TASK-001" }
```

**Subscribe to chat session**:

```json
{ "type": "chat:subscribe", "sessionId": "session-abc" }
```

### Server → Client Messages

**Task change broadcast**:

```json
{ "type": "task:updated", "task": { "id": "TASK-001", "status": "done" } }
```

**Agent output**:

```json
{
  "type": "agent:output",
  "taskId": "TASK-001",
  "outputType": "stdout",
  "data": "Running tests..."
}
```

**Chat message**:

```json
{ "type": "chat:message", "sessionId": "session-abc", "message": { ... } }
```

**Agent status change**:

```json
{ "type": "agent:status", "status": "working", "activeAgents": [ ... ] }
```

---

## Common Workflows

### Agent Task Lifecycle

```bash
# 1. Create task
TASK=$(curl -s -X POST http://localhost:3001/api/tasks \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: YOUR_KEY' \
  -d '{"title":"Fix bug","priority":"high"}' | jq -r '.id')

# 2. Start time tracking
curl -s -X POST http://localhost:3001/api/tasks/$TASK/time/start

# 3. Emit telemetry
curl -s -X POST http://localhost:3001/api/telemetry/events \
  -H 'Content-Type: application/json' \
  -d "{\"type\":\"run.started\",\"taskId\":\"$TASK\",\"agent\":\"veritas\"}"

# 4. Update status to in-progress
curl -s -X PATCH http://localhost:3001/api/tasks/$TASK \
  -H 'Content-Type: application/json' \
  -d '{"status":"in-progress"}'

# 5. Save checkpoint mid-work
curl -s -X POST http://localhost:3001/api/tasks/$TASK/checkpoint \
  -H 'Content-Type: application/json' \
  -d '{"state":{"step":3,"context":"halfway done"}}'

# 6. Add observation
curl -s -X POST http://localhost:3001/api/tasks/$TASK/observations \
  -H 'Content-Type: application/json' \
  -d '{"content":"Found root cause in auth middleware","type":"insight","agent":"veritas"}'

# 7. Complete
curl -s -X PATCH http://localhost:3001/api/tasks/$TASK \
  -H 'Content-Type: application/json' \
  -d '{"status":"done"}'

# 8. Stop timer + emit completion telemetry
curl -s -X POST http://localhost:3001/api/tasks/$TASK/time/stop
curl -s -X POST http://localhost:3001/api/telemetry/events \
  -H 'Content-Type: application/json' \
  -d "{\"type\":\"run.completed\",\"taskId\":\"$TASK\",\"agent\":\"veritas\",\"durationMs\":45000,\"success\":true}"
```

### Agent Loop (Poll for Work)

```bash
# Get next available task
NEXT=$(curl -s http://localhost:3001/api/tasks?status=todo&limit=1 | jq -r '.tasks[0].id')
if [ "$NEXT" != "null" ]; then
  # Claim it
  curl -s -X PATCH http://localhost:3001/api/tasks/$NEXT \
    -H 'Content-Type: application/json' \
    -d '{"status":"in-progress","assignee":"agent-1"}'
fi
```

### Blocker Tracking

```bash
# Add a blocker observation
curl -s -X POST http://localhost:3001/api/tasks/TASK-001/observations \
  -H 'Content-Type: application/json' \
  -d '{"content":"Blocked: waiting on API key from vendor","type":"blocker","agent":"veritas"}'

# Add a dependency
curl -s -X POST http://localhost:3001/api/tasks/TASK-001/dependencies \
  -H 'Content-Type: application/json' \
  -d '{"targetId":"TASK-002","type":"blocked-by"}'
```

### Webhook Hook Setup

```bash
# Fire a webhook when any task moves to "done"
curl -s -X POST http://localhost:3001/api/hooks \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "done-notify",
    "event": "task.status.changed",
    "filter": {"newStatus":"done"},
    "action": {"type":"webhook","url":"https://example.com/hook"}
  }'
```

---

## Versioning & Deprecation

- **Current version**: v1 (mounted at `/api/v1`, aliased at `/api`)
- **No breaking changes** within a major version
- Deprecations will be announced via:
  - `Deprecation` response header
  - Changelog entry
  - Minimum 2 minor releases before removal
- When v2 ships, v1 will remain available for at least 6 months

---

## Rate Limits

| Tier   | Limit       | Applies To                       |
| ------ | ----------- | -------------------------------- |
| Global | 300 req/min | All endpoints (localhost exempt) |
| Read   | 300 req/min | GET endpoints                    |
| Write  | 60 req/min  | POST/PUT/PATCH/DELETE            |
| Upload | 20 req/min  | File upload endpoints            |

Rate limit headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

---

## Additional Endpoint Groups

These endpoints follow the same auth/error patterns documented above:

| Mount                            | Purpose                                       |
| -------------------------------- | --------------------------------------------- |
| `/api/projects`                  | Project CRUD                                  |
| `/api/sprints`                   | Sprint management                             |
| `/api/backlog`                   | Backlog operations                            |
| `/api/agents`                    | Agent CRUD, routing                           |
| `/api/agents/register`           | Agent self-registration                       |
| `/api/agents/permissions`        | Agent permission management                   |
| `/api/templates`                 | Task templates                                |
| `/api/task-types`                | Custom task type definitions                  |
| `/api/activity`                  | Activity feed                                 |
| `/api/notifications`             | User notifications                            |
| `/api/broadcasts`                | Broadcast messages                            |
| `/api/changes`                   | Efficient agent polling (change feed)         |
| `/api/diff`                      | Task diff comparisons                         |
| `/api/automation`                | Automation rules                              |
| `/api/summary`                   | Board summaries                               |
| `/api/github`                    | GitHub integration                            |
| `/api/conflicts`                 | Merge conflict detection                      |
| `/api/metrics`                   | Prometheus-style metrics                      |
| `/api/traces`                    | Distributed tracing                           |
| `/api/cost-prediction`           | Token cost forecasting                        |
| `/api/error-learning`            | Error pattern learning                        |
| `/api/reports`                   | Generated reports                             |
| `/api/deliverables`              | Scheduled deliverables                        |
| `/api/doc-freshness`             | Documentation freshness tracking              |
| `/api/docs`                      | Docs endpoint                                 |
| `/api/shared-resources`          | Shared resource management                    |
| `/api/status-history`            | Task status history                           |
| `/api/digest`                    | Digest generation                             |
| `/api/audit`                     | Audit log                                     |
| `/api/lessons`                   | Lessons learned                               |
| `/api/delegation`                | Task delegation                               |
| `/api/workflows`                 | Workflow engine ([details](API-WORKFLOWS.md)) |
| `/api/tool-policies`             | Tool access policies                          |
| `/api/integrations`              | External integrations                         |
| `/api/settings/transition-hooks` | Status transition hooks                       |

---

_For workflow engine endpoints, see [API-WORKFLOWS.md](API-WORKFLOWS.md)._  
_For MCP server tools, see [MCP Server Guide](mcp/README.md)._  
_For agent workflow SOPs, see [SOP-agent-task-workflow.md](SOP-agent-task-workflow.md)._

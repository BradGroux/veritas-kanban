# Veritas Kanban — API Reference

**Version**: 3.4.0  
**Last Updated**: 2026-03-08  
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
17. [Task Verification](#task-verification)
18. [Task Comments](#task-comments)
19. [Task Subtasks](#task-subtasks)
20. [Task Deliverables](#task-deliverables)
21. [Task Archive](#task-archive)
22. [Attachments](#attachments)
23. [Agent Permissions](#agent-permissions)
24. [Agent Routing](#agent-routing)
25. [Shared Resources](#shared-resources)
26. [Doc Freshness](#doc-freshness)
27. [Cost Prediction](#cost-prediction)
28. [Error Learning](#error-learning)
29. [Tool Policies](#tool-policies)
30. [Traces](#traces)
31. [Audit](#audit)
32. [Common Workflows](#common-workflows)
33. [Versioning & Deprecation](#versioning--deprecation)
34. [Rate Limits](#rate-limits)
35. [Additional Endpoint Groups](#additional-endpoint-groups)

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

## Task Verification

Verification step checklists for tasks — define acceptance criteria that must be checked off before a task is considered truly complete.

Mounted at `/api/tasks`.

### Add Verification Step

```
POST /api/tasks/:id/verification
```

**Body**:

```json
{
  "description": "All unit tests passing"
}
```

**Response** `201`: The updated task object with the new verification step added.

### Update Verification Step

```
PATCH /api/tasks/:id/verification/:stepId
```

**Body** (partial):

```json
{
  "checked": true
}
```

When `checked` changes, `checkedAt` is automatically set (or cleared).

**Response** `200`: The updated task object.

### Delete Verification Step

```
DELETE /api/tasks/:id/verification/:stepId
```

**Response** `200`: The updated task object with the step removed.

---

## Task Comments

Comment threads on tasks — supports adding, editing, and deleting comments. Comments auto-sync to linked GitHub issues.

Mounted at `/api/tasks`.

### Add Comment

```
POST /api/tasks/:id/comments
```

**Body**:

```json
{
  "author": "veritas",
  "text": "Root cause identified — auth middleware skips token refresh"
}
```

**Response** `201`: The updated task object with the new comment.

### Edit Comment

```
PATCH /api/tasks/:id/comments/:commentId
```

**Body**:

```json
{
  "text": "Updated analysis — the issue is in the session store"
}
```

### Delete Comment

```
DELETE /api/tasks/:id/comments/:commentId
```

---

## Task Subtasks

Break tasks into smaller work items with optional acceptance criteria per subtask.

Mounted at `/api/tasks`.

### Add Subtask

```
POST /api/tasks/:id/subtasks
```

**Body**:

```json
{
  "title": "Add input validation",
  "acceptanceCriteria": ["Rejects empty strings", "Returns 400 on invalid input"]
}
```

**Response** `201`: The updated task object.

### Update Subtask

```
PATCH /api/tasks/:id/subtasks/:subtaskId
```

**Body** (partial):

```json
{
  "completed": true
}
```

### Delete Subtask

```
DELETE /api/tasks/:id/subtasks/:subtaskId
```

### Toggle Acceptance Criterion

```
PATCH /api/tasks/:id/subtasks/:subtaskId/criteria
```

**Body**:

```json
{
  "criteriaIndex": 0
}
```

Toggles the checked state of a specific acceptance criterion on a subtask.

---

## Task Deliverables

Track deliverable artifacts (files, PRs, docs) produced by agents working on a task.

Mounted at `/api/tasks`.

### List Deliverables

```
GET /api/tasks/:id/deliverables
```

### Add Deliverable

```
POST /api/tasks/:id/deliverables
```

**Body**:

```json
{
  "title": "API endpoint implementation",
  "type": "code",
  "path": "server/src/routes/new-feature.ts",
  "agent": "codex-1",
  "description": "REST endpoints for the new feature"
}
```

**Response** `201`: The updated task object.

### Update Deliverable

```
PATCH /api/tasks/:id/deliverables/:deliverableId
```

**Body** (partial): Any of `title`, `type`, `path`, `status`, `description`.

### Delete Deliverable

```
DELETE /api/tasks/:id/deliverables/:deliverableId
```

---

## Task Archive

Archive completed tasks (by sprint or individually) and restore them. Archived tasks are removed from the active board.

Mounted at `/api/tasks`.

| Method | Path                                | Description                        |
| ------ | ----------------------------------- | ---------------------------------- |
| `GET`  | `/api/tasks/archived`               | List all archived tasks            |
| `GET`  | `/api/tasks/archive/suggestions`    | Get sprints ready for archival     |
| `POST` | `/api/tasks/archive/sprint/:sprint` | Archive all done tasks in a sprint |
| `POST` | `/api/tasks/bulk-archive`           | Archive by sprint name             |
| `POST` | `/api/tasks/bulk-archive-by-ids`    | Archive specific task IDs          |
| `POST` | `/api/tasks/:id/archive`            | Archive a single task              |
| `POST` | `/api/tasks/:id/restore`            | Restore a task from archive        |

### Archive by Sprint

```
POST /api/tasks/archive/sprint/:sprint
```

Archives all completed tasks in the given sprint.

**Response** `200`:

```json
{
  "archived": 5
}
```

### Archive Single Task

```
POST /api/tasks/:id/archive
```

**Auth**: Requires `admin` or `agent` role. Emits audit log entry.

### Restore Task

```
POST /api/tasks/:id/restore
```

Restores an archived task back to active status (`done`).

---

## Attachments

File upload/download for task attachments with automatic text extraction (PDF, DOCX, etc.).

Mounted at `/api/tasks`.

| Method   | Path                                         | Description                      |
| -------- | -------------------------------------------- | -------------------------------- |
| `POST`   | `/api/tasks/:id/attachments`                 | Upload files (multipart, max 20) |
| `GET`    | `/api/tasks/:id/attachments`                 | List all attachments             |
| `GET`    | `/api/tasks/:id/attachments/:attId`          | Get attachment metadata          |
| `GET`    | `/api/tasks/:id/attachments/:attId/download` | Download file                    |
| `GET`    | `/api/tasks/:id/attachments/:attId/text`     | Get extracted text               |
| `DELETE` | `/api/tasks/:id/attachments/:attId`          | Delete attachment                |

### Upload Attachments

```
POST /api/tasks/:id/attachments
Content-Type: multipart/form-data
```

**Field**: `files` — one or more files (max 20 per request).

Files undergo MIME validation via magic bytes. Text is automatically extracted from supported formats.

**Response** `200`:

```json
{
  "attachments": [
    {
      "id": "att_abc123",
      "filename": "design-spec.pdf",
      "originalName": "design-spec.pdf",
      "mimeType": "application/pdf",
      "size": 245000
    }
  ],
  "task": { "..." },
  "rejected": []
}
```

### Get Extracted Text

```
GET /api/tasks/:id/attachments/:attId/text
```

**Response** `200`:

```json
{
  "attachmentId": "att_abc123",
  "text": "Extracted document content...",
  "hasText": true
}
```

---

## Agent Permissions

Role-based permission levels for agents: `intern`, `specialist`, `lead`. Interns require approval for certain actions.

Mounted at `/api/agents/permissions`.

| Method  | Path                                    | Description                       |
| ------- | --------------------------------------- | --------------------------------- |
| `GET`   | `/api/agents/permissions`               | List all agent permissions        |
| `GET`   | `/api/agents/permissions/:id`           | Get agent permission config       |
| `PUT`   | `/api/agents/permissions/:id/level`     | Set permission level              |
| `PATCH` | `/api/agents/permissions/:id`           | Update permission fields          |
| `POST`  | `/api/agents/permissions/check`         | Check if agent can perform action |
| `POST`  | `/api/agents/permissions/approvals`     | Request approval (intern)         |
| `GET`   | `/api/agents/permissions/approvals`     | List pending approvals            |
| `POST`  | `/api/agents/permissions/approvals/:id` | Review approval request           |

### Set Permission Level

```
PUT /api/agents/permissions/:id/level
```

**Body**:

```json
{
  "level": "specialist"
}
```

Valid levels: `intern`, `specialist`, `lead`.

### Check Permission

```
POST /api/agents/permissions/check
```

**Body**:

```json
{
  "agentId": "codex-1",
  "action": "deploy"
}
```

**Response** `200`:

```json
{
  "allowed": true,
  "level": "specialist",
  "requiresApproval": false
}
```

### Update Permission Fields

```
PATCH /api/agents/permissions/:id
```

**Body** (partial):

```json
{
  "trustedDomains": ["github.com"],
  "canCreateTasks": true,
  "canDelegate": false,
  "canApprove": false,
  "restrictions": ["no-deploy"]
}
```

### Request Approval

```
POST /api/agents/permissions/approvals
```

Used by intern-level agents to request approval for restricted actions.

### Review Approval

```
POST /api/agents/permissions/approvals/:id
```

Approve or reject a pending approval request.

---

## Agent Routing

Automatic agent resolution — determines the best agent for a task based on configurable routing rules.

Mounted at `/api/agents`.

| Method | Path                  | Description                   |
| ------ | --------------------- | ----------------------------- |
| `POST` | `/api/agents/route`   | Resolve best agent for a task |
| `GET`  | `/api/agents/routing` | Get routing configuration     |
| `PUT`  | `/api/agents/routing` | Update routing configuration  |

### Resolve Agent

```
POST /api/agents/route
```

Accepts either a task ID or ad-hoc metadata:

**By task ID**:

```json
{
  "taskId": "TASK-001"
}
```

**By metadata**:

```json
{
  "type": "bug",
  "priority": "high",
  "project": "rubicon",
  "subtaskCount": 3
}
```

**Response** `200`:

```json
{
  "agent": "codex-1",
  "model": "claude-sonnet-4.5",
  "rule": "high-priority-bugs",
  "confidence": 0.95
}
```

### Get/Update Routing Configuration

```
GET /api/agents/routing
PUT /api/agents/routing
```

**PUT Body**:

```json
{
  "enabled": true,
  "rules": [
    {
      "id": "high-bugs",
      "name": "High priority bugs",
      "match": { "type": "bug", "priority": "high" },
      "agent": "codex-1",
      "model": "claude-sonnet-4.5",
      "enabled": true
    }
  ],
  "defaultAgent": "veritas",
  "fallbackOnFailure": true,
  "maxRetries": 2
}
```

---

## Shared Resources

Registry for shared resources (credentials, config files, API keys, docs) that can be mounted to projects.

Mounted at `/api/shared-resources`.

| Method   | Path                                | Description                                          |
| -------- | ----------------------------------- | ---------------------------------------------------- |
| `GET`    | `/api/shared-resources`             | List all (filters: `type`, `project`, `tag`, `name`) |
| `GET`    | `/api/shared-resources/:id`         | Get one resource                                     |
| `POST`   | `/api/shared-resources`             | Create resource                                      |
| `PATCH`  | `/api/shared-resources/:id`         | Update resource                                      |
| `DELETE` | `/api/shared-resources/:id`         | Delete resource                                      |
| `POST`   | `/api/shared-resources/:id/mount`   | Mount to project(s)                                  |
| `POST`   | `/api/shared-resources/:id/unmount` | Unmount from project(s)                              |

### Create Resource

```
POST /api/shared-resources
```

**Body**:

```json
{
  "name": "Production DB Config",
  "type": "config",
  "content": "host=db.example.com\nport=5432",
  "tags": ["database", "production"],
  "projectIds": ["rubicon"]
}
```

### Mount/Unmount

```
POST /api/shared-resources/:id/mount
POST /api/shared-resources/:id/unmount
```

**Body**:

```json
{
  "projectIds": ["rubicon", "brainmeld"]
}
```

---

## Doc Freshness

Track documentation freshness — monitor when docs were last reviewed and alert when they go stale.

Mounted at `/api/doc-freshness`.

| Method   | Path                                        | Description                                                  |
| -------- | ------------------------------------------- | ------------------------------------------------------------ |
| `GET`    | `/api/doc-freshness`                        | List tracked documents (filters: `project`, `type`, `stale`) |
| `GET`    | `/api/doc-freshness/:id`                    | Get one tracked document                                     |
| `POST`   | `/api/doc-freshness`                        | Track a new document                                         |
| `PATCH`  | `/api/doc-freshness/:id`                    | Update document metadata                                     |
| `DELETE` | `/api/doc-freshness/:id`                    | Stop tracking                                                |
| `POST`   | `/api/doc-freshness/:id/review`             | Mark as freshly reviewed                                     |
| `GET`    | `/api/doc-freshness/alerts`                 | List freshness alerts (filters: `severity`, `acknowledged`)  |
| `POST`   | `/api/doc-freshness/alerts/:id/acknowledge` | Acknowledge an alert                                         |
| `GET`    | `/api/doc-freshness/summary`                | Freshness health summary                                     |

### Track a Document

```
POST /api/doc-freshness
```

**Body**:

```json
{
  "path": "docs/API-REFERENCE.md",
  "type": "api-reference",
  "project": "veritas-kanban",
  "maxAgeDays": 30
}
```

### Mark as Reviewed

```
POST /api/doc-freshness/:id/review
```

**Body** (optional):

```json
{
  "reviewer": "brad",
  "reviewedAt": "2026-03-08T10:00:00Z"
}
```

### Get Freshness Summary

```
GET /api/doc-freshness/summary
```

**Response** `200`:

```json
{
  "total": 15,
  "fresh": 12,
  "stale": 2,
  "critical": 1,
  "alertCount": 3
}
```

---

## Cost Prediction

Predict token costs for tasks before execution — uses historical telemetry data to estimate.

Mounted at `/api/cost-prediction`.

| Method | Path                                  | Description                             |
| ------ | ------------------------------------- | --------------------------------------- |
| `POST` | `/api/cost-prediction/predict`        | Predict cost for a task                 |
| `GET`  | `/api/cost-prediction/accuracy`       | Prediction accuracy for completed tasks |
| `GET`  | `/api/cost-prediction/accuracy/stats` | Aggregate accuracy statistics           |

### Predict Cost

```
POST /api/cost-prediction/predict
```

**By task ID**:

```json
{
  "taskId": "TASK-001"
}
```

**By metadata**:

```json
{
  "type": "feature",
  "priority": "high",
  "project": "rubicon",
  "description": "Implement OAuth2 flow",
  "subtaskCount": 5
}
```

**Response** `200`:

```json
{
  "estimatedTokens": 45000,
  "estimatedCost": 0.85,
  "estimatedDurationMs": 120000,
  "confidence": 0.78,
  "basedOn": 12
}
```

### Get Accuracy Stats

```
GET /api/cost-prediction/accuracy/stats
```

Returns aggregate statistics on prediction accuracy across all completed tasks.

---

## Error Learning

Structured failure analysis — submit errors, record root causes, and search for similar past errors to avoid repeating mistakes.

Mounted at `/api/errors`.

| Method  | Path                 | Description                                                                  |
| ------- | -------------------- | ---------------------------------------------------------------------------- |
| `POST`  | `/api/errors/submit` | Submit an error for analysis                                                 |
| `GET`   | `/api/errors`        | List analyses (filters: `taskId`, `errorType`, `severity`, `agent`, `limit`) |
| `GET`   | `/api/errors/:id`    | Get specific analysis                                                        |
| `PATCH` | `/api/errors/:id`    | Update with root cause & fix                                                 |
| `GET`   | `/api/errors/stats`  | Aggregate error pattern stats                                                |
| `GET`   | `/api/errors/search` | Search similar past errors (`?q=<query>`)                                    |

### Submit Error

```
POST /api/errors/submit
```

**Body**:

```json
{
  "taskId": "TASK-001",
  "agent": "codex-1",
  "errorMessage": "ECONNREFUSED 127.0.0.1:5432",
  "errorType": "resource",
  "rawDetails": "Full stack trace...",
  "attemptDescription": "Trying to connect to PostgreSQL"
}
```

Valid error types: `runtime`, `api`, `validation`, `timeout`, `permission`, `resource`, `model`, `git`, `build`, `test`, `configuration`, `unknown`.

**Response** `201`: The created error analysis object.

### Update Analysis

```
PATCH /api/errors/:id
```

**Body** (partial):

```json
{
  "rootCause": "PostgreSQL service not running",
  "severity": "medium",
  "chosenFix": "Add health check before DB operations",
  "preventionSteps": ["Add connection retry logic", "Check service status on startup"],
  "tags": ["database", "connectivity"]
}
```

### Search Similar Errors

```
GET /api/errors/search?q=ECONNREFUSED&limit=5
```

Returns past errors similar to the query string — useful for avoiding repeated mistakes.

---

## Tool Policies

Role-based tool access restrictions — control which tools each agent role can use.

Mounted at `/api/tool-policies`.

| Method   | Path                                | Description                           |
| -------- | ----------------------------------- | ------------------------------------- |
| `GET`    | `/api/tool-policies`                | List all policies                     |
| `GET`    | `/api/tool-policies/:role`          | Get policy for a role                 |
| `POST`   | `/api/tool-policies`                | Create a new policy                   |
| `PUT`    | `/api/tool-policies/:role`          | Update an existing policy             |
| `DELETE` | `/api/tool-policies/:role`          | Delete a custom policy                |
| `POST`   | `/api/tool-policies/:role/validate` | Check if a tool is allowed for a role |

### Create Policy

```
POST /api/tool-policies
```

**Body**:

```json
{
  "role": "intern",
  "allowed": ["read", "search", "analyze"],
  "denied": ["deploy", "delete", "admin"],
  "description": "Restricted access for intern agents"
}
```

### Validate Tool Access

```
POST /api/tool-policies/:role/validate
```

**Body**:

```json
{
  "tool": "deploy"
}
```

**Response** `200`:

```json
{
  "role": "intern",
  "tool": "deploy",
  "allowed": false
}
```

---

## Traces

Distributed execution tracing — record and query traces for agent task attempts.

Mounted at `/api/traces`.

| Method | Path                       | Description                 |
| ------ | -------------------------- | --------------------------- |
| `GET`  | `/api/traces/status`       | Check if tracing is enabled |
| `POST` | `/api/traces/enable`       | Enable tracing              |
| `POST` | `/api/traces/disable`      | Disable tracing             |
| `GET`  | `/api/traces/:attemptId`   | Get a trace by attempt ID   |
| `GET`  | `/api/traces/task/:taskId` | List all traces for a task  |

### Check Tracing Status

```
GET /api/traces/status
```

**Response** `200`:

```json
{
  "enabled": true
}
```

### Get Task Traces

```
GET /api/traces/task/TASK-001
```

Returns all execution traces associated with the given task.

---

## Audit

Immutable, hash-chained audit log. **Admin only.**

Mounted at `/api/audit`.

| Method | Path                | Description                                              |
| ------ | ------------------- | -------------------------------------------------------- |
| `GET`  | `/api/audit`        | Recent audit entries (`?limit=N`, default 100, max 1000) |
| `GET`  | `/api/audit/verify` | Verify hash chain integrity of current month's log       |

**Auth**: Requires `admin` role.

### Query Audit Log

```
GET /api/audit?limit=50
```

**Response** `200`:

```json
{
  "entries": [
    {
      "timestamp": "2026-03-08T07:00:00Z",
      "action": "task.archive",
      "actor": "admin-key",
      "resource": "TASK-001",
      "details": { "title": "Fix auth bug" },
      "hash": "sha256:..."
    }
  ],
  "count": 50
}
```

### Verify Integrity

```
GET /api/audit/verify
```

Verifies the hash chain of the current month's audit log file. Returns chain validity and any broken links.

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

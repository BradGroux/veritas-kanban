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
14. [Identity & Workspaces](#identity--workspaces)
15. [Telemetry](#telemetry)
16. [Health](#health)
17. [WebSocket](#websocket)
18. [Task Verification](#task-verification)
19. [Task Comments](#task-comments)
20. [Task Subtasks](#task-subtasks)
21. [Task Deliverables](#task-deliverables)
22. [Task Archive](#task-archive)
23. [Attachments](#attachments)
24. [Agent Permissions](#agent-permissions)
25. [Agent Routing](#agent-routing)
26. [Shared Resources](#shared-resources)
27. [Skill Capability Profiles](#skill-capability-profiles-apiskillscapabilities)
28. [Skill Security Scanner](#skill-security-scanner-apiskillssecurity)
29. [Doc Freshness](#doc-freshness)
30. [Cost Prediction](#cost-prediction)
31. [Error Learning](#error-learning)
32. [Tool Policies](#tool-policies)
33. [Watcher Continuation Policies](#watcher-continuation-policies)
34. [Traces](#traces)
35. [Governance Decision Traces](#governance-decision-traces-apigovernancetraces)
36. [Audit](#audit)
37. [Maintenance Center](#maintenance-center-apiv1maintenance)
38. [Common Workflows](#common-workflows)
39. [Versioning & Deprecation](#versioning--deprecation)
40. [Rate Limits](#rate-limits)
41. [Additional Endpoint Groups](#additional-endpoint-groups)

---

## Authentication

VK supports three authentication methods. All are optional when running locally with `VERITAS_AUTH_ENABLED=false`.

### Methods

| Method                 | Header / Param                    | Use Case                          |
| ---------------------- | --------------------------------- | --------------------------------- |
| **Bearer Token** (JWT) | `Authorization: Bearer <token>`   | Browser sessions, UI login        |
| **API Key**            | `X-API-Key: <key>`                | Agent integrations, scripts       |
| **Device Session**     | `Authorization: Bearer vk_dev_…`  | Paired desktop/mobile/PWA clients |
| **WS Query Param**     | `ws://host:port/ws?api_key=<key>` | WebSocket connections             |

### Roles

| Role        | Permissions                                                      |
| ----------- | ---------------------------------------------------------------- |
| `admin`     | Full access — all endpoints, destructive operations, deep health |
| `agent`     | Read/write tasks, time tracking, observations, chat, telemetry   |
| `read-only` | Read-only access to all GET endpoints                            |

### v5 Permission Context

Protected REST handlers and WebSocket connections receive a shared auth context:
`role`, `userId`, `workspaceId`, `actorType`, `authMethod`, `tokenName`, and
role-derived `permissions`. Device sessions also include `deviceSessionId`,
`deviceId`, `clientId`, `clientMode`, `capabilities`, and `degradedReason` when
a current workspace role downgrade trimmed the approved scopes. Existing
endpoints still accept the compatibility roles above, but new v5 route work
should declare the specific permission it requires, such as `task:read`,
`task:write`, `workflow:execute`, or `admin:manage`.

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

| Code  | Meaning                                               |
| ----- | ----------------------------------------------------- |
| `200` | Success                                               |
| `201` | Created                                               |
| `400` | Bad request — invalid body, missing fields            |
| `401` | Not authenticated                                     |
| `403` | Forbidden — insufficient role                         |
| `404` | Resource not found                                    |
| `409` | Conflict — duplicate, state violation, stale revision |
| `429` | Rate limited                                          |
| `503` | Service degraded (health checks)                      |

---

## Tasks

All task routes are mounted at `/api/tasks`.

### Task Revisions and Conflict Handling

Task reads and writes include optimistic-concurrency metadata:

- `GET /api/tasks/:id`, `POST /api/tasks`, and successful task mutations return
  `ETag: "task:<taskId>:<revision>"`.
- The same revision is also returned as `X-Resource-Revision`.
- Clients that edit a loaded task should send `If-Match` with the last ETag, or
  `X-Resource-Revision` with the last numeric revision.
- Tasks include `revision`, `createdBy`, and `updatedBy`. Comments include
  `revision`, `createdBy`, and `updatedBy` when created or edited through the
  v5 routes.

When the supplied revision is stale, the API returns `409 CONFLICT` and includes
the latest resource so the client can reload or reapply the edit:

```json
{
  "code": "CONFLICT",
  "message": "task task_20260531_abcd has changed since it was loaded. Reload and retry with the latest revision.",
  "details": {
    "resourceType": "task",
    "resourceId": "task_20260531_abcd",
    "expectedRevision": 3,
    "currentRevision": 4,
    "current": {
      "id": "task_20260531_abcd",
      "title": "Latest task title",
      "revision": 4
    }
  }
}
```

### Duplicate Task Identity Diagnostics

File-backed boards validate task identity directly from markdown files so stale
cache entries cannot hide duplicate cards. The scanner detects:

- duplicate task `id` values across active, backlog, and archive task files
- duplicate GitHub issue identities such as `github:BradGroux/veritas-kanban#377`
- duplicate Git pull request identities such as `git-pr:BradGroux/veritas-kanban#123`

`GET /api/tasks` and `GET /api/backlog` keep their existing response data shape.
When conflicts exist, enveloped API responses include
`meta.taskIdentityDiagnostics`, and the response includes
`X-Veritas-Task-Identity-Conflicts` with the number of conflicts.

Mutating or moving a task with a duplicate identity fails with `409 CONFLICT`
instead of silently selecting one matching file. The error details include the
operation, target task ID, duplicate IDs, source paths, and destination path when
the operation moves a task:

```json
{
  "code": "CONFLICT",
  "message": "Duplicate task identity detected",
  "details": {
    "operation": "backlog.promote",
    "taskId": "task_20260603_dup",
    "destinationPath": "active",
    "duplicateIds": ["task_20260603_dup"],
    "conflicts": [
      {
        "kind": "task-id",
        "id": "task_20260603_dup",
        "sources": [
          { "location": "active", "path": "active/task_20260603_dup-active.md" },
          { "location": "backlog", "path": "backlog/task_20260603_dup-backlog.md" }
        ]
      }
    ]
  }
}
```

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

**Headers**:

```http
If-Match: "task:task_20260531_abcd:3"
```

If the task has been updated since revision `3`, the API returns `409 CONFLICT`
with the latest task in `details.current`.

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
POST /api/auth/device-pairing/exchange # Redeem a one-time pairing payload
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

## Identity & Workspaces

v5 adds SQLite-backed identity management for users, workspaces, memberships,
roles, and invitations. These endpoints are mounted at `/api/identity` and
`/api/v1/identity`.

| Method   | Path                                                               | Description                                           |
| -------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| `GET`    | `/api/identity/profile`                                            | Current user profile plus workspace memberships.      |
| `GET`    | `/api/identity/workspaces`                                         | Workspaces available to the current user.             |
| `POST`   | `/api/identity/workspaces/switch`                                  | Validate/select an active workspace membership.       |
| `GET`    | `/api/identity/workspaces/:workspaceId/members`                    | List active workspace members.                        |
| `GET`    | `/api/identity/workspaces/:workspaceId/invitations`                | List invitations. Requires admin.                     |
| `POST`   | `/api/identity/workspaces/:workspaceId/invitations`                | Create an invitation. Requires admin.                 |
| `POST`   | `/api/identity/invitations/accept`                                 | Accept an invitation.                                 |
| `POST`   | `/api/auth/invitations/accept`                                     | Accept an invitation before login.                    |
| `POST`   | `/api/identity/invitations/:id/revoke`                             | Revoke a pending invitation. Requires admin.          |
| `PATCH`  | `/api/identity/workspaces/:workspaceId/members/:id`                | Update a member role. Requires admin.                 |
| `DELETE` | `/api/identity/workspaces/:workspaceId/members/:id`                | Remove a member. Requires admin.                      |
| `GET`    | `/api/identity/workspaces/:workspaceId/device-sessions`            | List trusted device sessions. Requires admin.         |
| `POST`   | `/api/identity/workspaces/:workspaceId/device-pairing-codes`       | Create a short-lived pairing payload. Requires admin. |
| `POST`   | `/api/identity/workspaces/:workspaceId/device-sessions/:id/test`   | Test current device session state. Requires admin.    |
| `POST`   | `/api/identity/workspaces/:workspaceId/device-sessions/:id/revoke` | Revoke a trusted device session. Requires admin.      |

### Create Invitation

```http
POST /api/identity/workspaces/local/invitations
```

```json
{
  "email": "reviewer@example.com",
  "role": "reviewer"
}
```

The response includes the plaintext invitation token once. SQLite stores only
the token hash.

### Accept Invitation

```http
POST /api/auth/invitations/accept
```

```json
{
  "token": "plaintext-token-from-invite",
  "displayName": "Reviewer",
  "email": "reviewer@example.com"
}
```

Membership mutations are recorded in audit and activity history.

### Device Pairing

```http
POST /api/identity/workspaces/local/device-pairing-codes
```

```json
{
  "deviceName": "Brad phone",
  "clientMode": "mobile-pwa",
  "capabilities": ["workspace:read", "task:read"],
  "scopes": ["workspace:read", "task:read"],
  "role": "read-only"
}
```

The response returns a plaintext `code` and `veritas://pair?...` link once.
SQLite stores only hashes for pairing codes and device session secrets. Clients
redeem the returned payload through:

```http
POST /api/auth/device-pairing/exchange
```

Pairing payloads include client id, client mode, capabilities, device id,
scopes, role, workspace, nonce, signed timestamp, and signature. Codes expire
quickly, cannot be reused, and failed attempts are rate-limited and audited.

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
const ws = new WebSocket('ws://localhost:3001/ws?api_key=YOUR_API_KEY');
```

- Max connections: 50
- Heartbeat: server pings every 30s; clients must pong within 10s
- Origin validation enforced (CSWSH protection)

### Authentication

Pass API key as `api_key` query parameter only for WebSocket clients that cannot
send headers during the upgrade. HTTP requests must use `Authorization: Bearer`
or `X-API-Key`. In production, do not rely on localhost bypass.

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

Comment mutations use the parent task revision. Send the latest task `ETag` in
`If-Match` when adding, editing, or deleting comments. A stale comment edit
returns the same `409 CONFLICT` shape documented in [Tasks](#tasks), with the
latest task and comments in `details.current`.

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
  "requiresApproval": false,
  "traceId": "govtrace_1760000000000_ab12cd"
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
  "confidence": 0.95,
  "traceId": "govtrace_1760000000000_ab12cd"
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

## Skill Capability Profiles (`/api/skills/capabilities`)

Declared-vs-observed capability profiles for shared resources with `type:
"skill"`. Reads require `policy:read`. Creating remediation tasks requires
`policy:write` and `task:write`.

| Method | Path                                                 | Description                                 |
| ------ | ---------------------------------------------------- | ------------------------------------------- |
| `GET`  | `/api/skills/capabilities/taxonomy`                  | List canonical skill capability definitions |
| `GET`  | `/api/skills/capabilities`                           | List skill profiles with optional filters   |
| `GET`  | `/api/skills/capabilities/:skillId`                  | Get one skill capability profile            |
| `POST` | `/api/skills/capabilities/:skillId/remediation-task` | Create a task for capability mismatches     |

List filters:

- `status`: `aligned`, `mismatch`, or `missing-declaration`
- `severity`: minimum severity, one of `low`, `medium`, `high`, `critical`
- `capability`: a taxonomy id such as `network.egress`
- `q`: skill name, id, tag, or finding text search

### Skill Declaration Syntax

Skills declare capabilities in frontmatter:

```markdown
---
capabilities:
  - filesystem.read
  - network.egress
---
```

or in a Markdown section:

```markdown
## Declared Capabilities

- `filesystem.read`
- `browser.session`
```

Canonical capability ids:

| Capability          | Meaning                                      |
| ------------------- | -------------------------------------------- |
| `filesystem.read`   | Reads local files or repository content      |
| `filesystem.write`  | Writes, edits, moves, or deletes files       |
| `shell.execute`     | Runs shell commands or subprocesses          |
| `network.egress`    | Calls remote URLs, APIs, or webhooks         |
| `credential.access` | Reads secrets, tokens, env vars, or keychain |
| `external.message`  | Sends messages, comments, issues, or PRs     |
| `memory.write`      | Writes durable agent memory                  |
| `task.mutate`       | Creates or changes tasks, issues, or PRs     |
| `schedule.persist`  | Creates recurring or background execution    |
| `browser.session`   | Uses browser automation or sessions          |
| `mcp.tool`          | Invokes MCP/plugin/tool runtimes             |

### Profile Response

```json
{
  "skillId": "shared_123",
  "name": "Review Helper",
  "declaredCapabilities": ["filesystem.read"],
  "observedCapabilities": [
    {
      "capability": "filesystem.read",
      "confidence": 0.82,
      "evidence": [{ "source": "content-pattern", "label": "File read reference" }]
    },
    {
      "capability": "network.egress",
      "confidence": 0.86,
      "evidence": [{ "source": "content-pattern", "label": "Remote network call reference" }]
    }
  ],
  "undeclaredObservedCapabilities": ["network.egress"],
  "status": "mismatch",
  "severity": "high",
  "findings": [
    {
      "kind": "undeclared-observed",
      "capability": "network.egress",
      "severity": "high",
      "message": "network.egress is observed but not declared."
    }
  ]
}
```

Mismatch detection writes an audit event once per skill version and finding
signature. Evidence snippets are redacted before they are returned.

### Create Remediation Task

```http
POST /api/skills/capabilities/shared_123/remediation-task
```

**Body**:

```json
{
  "project": "Security",
  "priority": "high"
}
```

Returns the refreshed profile and created task.

---

## Skill Security Scanner (`/api/skills/security`)

Static security review for local skill directories or a single `SKILL.md`.
Reads require `policy:read`; scans require `admin:manage` because scan requests
read local filesystem paths. Scan evidence is redacted before it is returned or
persisted.

| Method | Path                                                       | Description                                 |
| ------ | ---------------------------------------------------------- | ------------------------------------------- |
| `GET`  | `/api/skills/security/patterns`                            | List scanner pattern definitions            |
| `GET`  | `/api/skills/security/inventory`                           | List shared skill risk inventory            |
| `POST` | `/api/skills/security/inventory/:skillId/remediation-task` | Create a task for a risky skill             |
| `POST` | `/api/skills/security/inventory/:skillId/exceptions`       | Add a reviewed temporary install exception  |
| `POST` | `/api/skills/security/scan`                                | Scan a skill path and optionally persist it |
| `GET`  | `/api/skills/security/scans`                               | List persisted scan summaries               |
| `GET`  | `/api/skills/security/scans/:id`                           | Get one persisted JSON report               |
| `POST` | `/api/maintenance/skill-security/scan`                     | Maintenance action alias for scan execution |

The scanner emits JSON plus a Markdown report when `persist` is not `false`.
Persisted artifacts are written under
`.veritas-kanban/skill-security-scans/`.

Detector families:

- Prompt injection: hidden instruction overrides, hidden comments, zero-width
  text.
- Credential access: environment, token, API key, keychain, password, and
  authorization references.
- Exfiltration: remote egress, remote script fetch/execute, and file-to-network
  paths.
- Unsafe execution: shell, subprocess, eval, dynamic code execution.
- Persistence: cron, launch agents, daemons, watchers, background jobs,
  self-modification, and durable memory writes.
- Trigger risk: broad activation language.
- Capability mismatch: observed behavior that exceeds declared skill
  capabilities.
- Dependency risk: unpinned or non-registry package references where statically
  detectable.

### Scan Request

```http
POST /api/skills/security/scan
```

**Body**:

```json
{
  "path": "/Users/example/.codex/skills/review-helper",
  "persist": true,
  "includeReferencedFiles": true
}
```

`path` can point at a directory containing `SKILL.md` or at a single
`SKILL.md`. Single-file scans include referenced `scripts/` and `assets/` files
by default.

### Scan Response

```json
{
  "id": "skillscan_1770000000000_ab12cd34",
  "targetType": "skill-directory",
  "skillName": "Review Helper",
  "severity": "critical",
  "riskScore": 90,
  "recommendation": "do-not-install",
  "findingCount": 3,
  "files": [{ "path": "SKILL.md", "role": "skill", "bytes": 420, "truncated": false }],
  "findings": [
    {
      "patternId": "credential.env-harvest",
      "severity": "critical",
      "category": "credential-access",
      "evidence": [{ "file": "SKILL.md", "line": 12, "excerpt": "[REDACTED_API_KEY]" }]
    }
  ],
  "persistedJsonPath": ".../skill-security-scans/skillscan_1770000000000_ab12cd34.json",
  "persistedMarkdownPath": ".../skill-security-scans/skillscan_1770000000000_ab12cd34.md"
}
```

Recommendation values are `safe`, `caution`, and `do-not-install`. A scan also
writes an audit event with scan id, severity, risk score, recommendation, and
finding count.

### Risk Inventory and Install Decisions

```http
GET /api/skills/security/inventory
```

Returns every shared resource with `type: "skill"` joined to its capability
profile, latest persisted scan, open remediation task, and active exception.
Each item includes `scanStatus`, `riskScore`, `severity`, `recommendation`,
`installDecision`, `declaredCapabilities`, `observedCapabilities`, `mismatches`,
`findingCount`, and `highOrCriticalFindingCount`.

`installDecision` values:

- `allow`: no blocking scanner or capability findings, or an active reviewed
  exception exists.
- `warn`: medium risk or caution findings require acknowledgement or reviewer
  approval.
- `block`: high, critical, or `do-not-install` risk blocks install and workflow
  use by default.

Reviewed exceptions are temporary and require an owner, reason, and future
expiration:

```http
POST /api/skills/security/inventory/shared_123/exceptions
```

```json
{
  "owner": "platform",
  "reason": "Reviewed for the current release candidate.",
  "expiresAt": "2026-06-10T18:00:00.000Z"
}
```

Risk remediation tasks can be created directly from the inventory:

```http
POST /api/skills/security/inventory/shared_123/remediation-task
```

```json
{
  "project": "Security",
  "sprint": "v5-ga",
  "priority": "high"
}
```

Both actions write audit events and return the refreshed inventory item.

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

## Search

QMD-ready retrieval across task markdown and docs. The endpoint uses the configured backend and gracefully falls back to keyword search when QMD is unavailable.

Mounted at `/api/search`.

| Method | Path                        | Description                                     |
| ------ | --------------------------- | ----------------------------------------------- |
| `POST` | `/api/search`               | Search task and docs collections with one query |
| `POST` | `/api/search/index/refresh` | Refresh QMD collections and embeddings          |

### Search Collections

```
POST /api/search
```

**Body**:

```json
{
  "query": "semantic search duplicate detection",
  "limit": 10,
  "collections": ["tasks-active", "tasks-archive", "docs"],
  "backend": "auto"
}
```

`backend` may be `keyword`, `qmd`, or `auto`. QMD is opt-in via `VERITAS_SEARCH_BACKEND=qmd` or per-request `backend: "qmd"`.

**Response** `200`:

```json
{
  "query": "semantic search duplicate detection",
  "backend": "keyword",
  "degraded": false,
  "elapsedMs": 12,
  "results": [
    {
      "id": "tasks/active/task_20260504_example.md",
      "title": "Add semantic search",
      "path": "tasks/active/task_20260504_example.md",
      "collection": "tasks-active",
      "snippet": "Wire QMD retrieval into Veritas.",
      "score": 4
    }
  ]
}
```

### QMD Setup

```bash
npm install -g @tobilu/qmd
pnpm qmd:setup
VERITAS_SEARCH_BACKEND=qmd pnpm dev
```

### QMD Index Refresh

```
POST /api/search/index/refresh
```

**Body**:

```json
{
  "embed": true
}
```

Set `embed` to `false` to run only `qmd update`.

**Response** `200`:

```json
{
  "backend": "qmd",
  "updated": true,
  "embedded": true,
  "elapsedMs": 982,
  "commands": ["update", "embed"]
}
```

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
  "allowed": false,
  "traceId": "govtrace_1760000000000_ab12cd"
}
```

---

## Watcher Continuation Policies

Deterministic guardrail endpoint for agent runners that want to continue a run.
The server decides before execution whether the continuation is allowed, needs
approval, or is blocked by the global kill switch, dispatch filters, risk
classes, continuation caps, or spend caps. Decisions are written to the
hash-chained audit log without storing prompt or command payloads.

Mounted at `/api/watcher-policies`.

| Method | Path                             | Description                                      |
| ------ | -------------------------------- | ------------------------------------------------ |
| `GET`  | `/api/watcher-policies`          | Return current watcher continuation settings     |
| `POST` | `/api/watcher-policies/evaluate` | Evaluate one proposed continuation before launch |

### Evaluate Continuation

```
POST /api/watcher-policies/evaluate
```

**Body**:

```json
{
  "runId": "run_123",
  "taskId": "task_456",
  "project": "core",
  "agent": "codex",
  "prompt": "Continue with the next test fix.",
  "continuationCount": 1,
  "monthlySpendUsd": 1.25,
  "hasRecentTestFailures": false,
  "recentProviderErrors": 0
}
```

**Response** `200`:

```json
{
  "decision": "allow",
  "mode": "auto",
  "riskLevel": "low",
  "riskClasses": [],
  "reasons": ["Continuation is within policy, dispatch, and cap limits."],
  "evidence": [],
  "caps": {
    "maxContinuations": 3,
    "spendCapUsd": 5
  },
  "auditLogged": true,
  "evaluatedAt": "2026-06-04T22:00:00.000Z"
}
```

Settings live under `features.watcherContinuations` and are updated through
`PATCH /api/settings/features`. Defaults preserve current behavior:
continuations are disabled and the global kill switch is active until explicitly
configured.

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
| `/api/watcher-policies`          | Agent continuation guardrail decisions        |
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

| `/api/feedback` | User feedback & sentiment analytics |
| `/api/decisions` | Decision audit trail |
| `/api/drift` | Behavioral drift detection |
| `/api/policies` | Agent policy & guard engine |
| `/api/scoring/profiles` | Output evaluation profiles |
| `/api/scoring/evaluate` | Run an output evaluation |
| `/api/scoring/history` | Evaluation history |
| `/api/prompt-registry` | Prompt template registry |
| `/api/v1/system/health` | Global system health |

---

## v4.0 API Reference

### User Feedback (`/api/feedback`)

Collect feedback on agent outputs and query aggregate sentiment analytics.

#### List Feedback

```
GET /api/feedback
```

Query params: `agent`, `taskId`, `sentiment` (`positive` | `neutral` | `negative`), `since` (ISO timestamp), `limit` (default 50), `offset`.

**Response:** Array of feedback objects.

```json
[
  {
    "id": "fb_abc123",
    "content": "The summary was concise and accurate.",
    "sentiment": "positive",
    "category": "output-quality",
    "agent": "TARS",
    "taskId": "task_20260321_abc",
    "createdAt": "2026-03-21T14:00:00.000Z"
  }
]
```

#### Submit Feedback

```
POST /api/feedback
```

```json
{
  "content": "The response missed the key point.",
  "sentiment": "negative",
  "category": "accuracy",
  "agent": "CASE",
  "taskId": "task_20260321_xyz"
}
```

**Response:** `201` with created feedback object.

#### Get Feedback Item

```
GET /api/feedback/:id
```

**Response:** Single feedback object.

#### Delete Feedback

```
DELETE /api/feedback/:id
```

**Response:** `204 No Content`.

#### Feedback Analytics

```
GET /api/feedback/analytics
```

Query params: `agent`, `since`, `until`.

**Response:**

```json
{
  "total": 42,
  "sentimentBreakdown": {
    "positive": 30,
    "neutral": 8,
    "negative": 4
  },
  "topCategories": [
    { "category": "output-quality", "count": 18 },
    { "category": "accuracy", "count": 12 }
  ],
  "trend": [{ "date": "2026-03-21", "positive": 5, "neutral": 1, "negative": 0 }]
}
```

---

### Decision Audit Trail (`/api/decisions`)

Log agent decisions with assumptions and record outcomes.

#### List Decisions

```
GET /api/decisions
```

Query params: `agent`, `taskId`, `minConfidence` (0–1), `maxConfidence` (0–1), `since`, `until`, `limit`, `offset`.

**Response:** Array of decision objects.

```json
[
  {
    "id": "dec_abc123",
    "decision": "Use Redis for session caching",
    "confidence": 0.85,
    "reasoning": "Redis has sub-ms latency and supports TTL natively.",
    "evidence": ["benchmark results", "existing infra"],
    "assumptions": ["Redis cluster is available", "TTL of 1h is sufficient"],
    "agent": "VERITAS",
    "taskId": "task_20260321_abc",
    "createdAt": "2026-03-21T14:00:00.000Z",
    "outcome": null
  }
]
```

#### Log a Decision

```
POST /api/decisions
```

```json
{
  "decision": "Refactor auth to use JWT instead of sessions",
  "confidence": 0.9,
  "reasoning": "Sessions require sticky routing; JWT is stateless.",
  "evidence": ["architecture review notes"],
  "assumptions": ["Clients will store tokens securely"],
  "agent": "VERITAS",
  "taskId": "task_20260321_abc"
}
```

**Response:** `201` with created decision object.

#### Get Decision

```
GET /api/decisions/:id
```

#### Update an Assumption

```
PATCH /api/decisions/:id/assumptions/:idx
```

Update a specific assumption by its zero-based index.

```json
{
  "text": "Clients will store tokens securely (confirmed via security review)",
  "held": true
}
```

**Response:** Updated decision object with the assumption patched.

---

### Governance Decision Traces (`/api/governance/traces`)

Inspect policy, tool-policy, agent-permission, routing, and workflow-gate decisions with evaluated rules, matched rules, remediation, and redacted raw detail.

#### List Governance Traces

```
GET /api/governance/traces
```

Query params: `kind`, `outcome`, `agent`, `taskId`, `actionType`, `startTime`, `endTime`, `limit`.

`kind` values: `policy`, `tool-policy`, `agent-permission`, `routing`, `workflow-gate`.

`outcome` values: `allowed`, `warned`, `blocked`, `approval-required`, `routed`, `fallback`, `skipped`.

**Response:** Array of trace records.

```json
[
  {
    "id": "govtrace_1760000000000_ab12cd",
    "kind": "policy",
    "outcome": "blocked",
    "title": "Policy evaluation: git.push",
    "summary": "Production deploy requires approval.",
    "remediation": "Request approval from a lead agent.",
    "subject": {
      "agentId": "codex",
      "taskId": "task_123",
      "actionType": "git.push"
    },
    "evaluatedRules": [
      {
        "id": "policy:prod-risk",
        "label": "Production risk gate",
        "type": "policy",
        "status": "matched",
        "outcome": "blocked",
        "message": "Risk score exceeded the blocking threshold."
      }
    ],
    "matchedRules": [],
    "steps": [],
    "redacted": true,
    "createdAt": "2026-06-01T12:00:00.000Z"
  }
]
```

#### Get Governance Trace

```
GET /api/governance/traces/:id
```

Returns one trace record including `raw` detail when present. All persisted trace values are redacted before write.

---

### Behavioral Drift Detection (`/api/drift`)

Track agent metric baselines and detect behavioral deviations.

#### List Drift Alerts

```
GET /api/drift/alerts
```

Query params: `agent`, `acknowledged` (boolean), `since`, `limit`.

**Response:** Array of drift alert objects.

```json
[
  {
    "id": "drift_abc123",
    "agent": "TARS",
    "metric": "task_completion_rate",
    "baseline": 0.92,
    "current": 0.71,
    "deviation": 0.21,
    "threshold": 0.1,
    "severity": "high",
    "acknowledged": false,
    "detectedAt": "2026-03-21T14:00:00.000Z"
  }
]
```

#### Acknowledge Drift Alert

```
POST /api/drift/alerts/:id/acknowledge
```

```json
{
  "notes": "Agent was rate-limited by upstream API — not a behavior change."
}
```

**Response:** Updated alert with `acknowledged: true`.

#### List Baselines

```
GET /api/drift/baselines
```

Query params: `agent`, `metric`.

**Response:** Array of baseline records showing current metric norms per agent.

#### Reset Baselines

```
POST /api/drift/baselines/reset
```

```json
{
  "agent": "TARS",
  "metric": "task_completion_rate"
}
```

**Response:** `200` with updated baseline record.

#### Run Drift Analysis

```
POST /api/drift/analyze
```

```json
{
  "agent": "TARS"
}
```

Compares current metrics against baselines and creates alerts for any out-of-threshold deviations.

**Response:** `200` with analysis summary including number of alerts created.

---

### Agent Policy Engine (`/api/policies`)

Define configurable guard rules for agent tool and action access.

#### List Policies

```
GET /api/policies
```

Query params: `agent`, `project`, `enabled` (boolean).

**Response:** Array of policy objects.

```json
[
  {
    "id": "pol_abc123",
    "name": "No web access for Intern agents",
    "description": "Intern-level agents cannot use browser or fetch tools.",
    "enabled": true,
    "scope": { "agentLevel": "intern" },
    "rules": [
      {
        "tool": "browser",
        "action": "*",
        "effect": "deny"
      }
    ],
    "precedence": "deny-first",
    "createdAt": "2026-03-21T14:00:00.000Z"
  }
]
```

#### Create Policy

```
POST /api/policies
```

```json
{
  "name": "Require approval for file deletion",
  "enabled": true,
  "scope": { "global": true },
  "rules": [
    {
      "tool": "exec",
      "action": "rm",
      "effect": "require-approval"
    }
  ],
  "precedence": "deny-first"
}
```

**Response:** `201` with created policy object.

#### Get Policy

```
GET /api/policies/:id
```

#### Update Policy

```
PUT /api/policies/:id
```

#### Delete Policy

```
DELETE /api/policies/:id
```

**Response:** `204 No Content`.

#### Evaluate Policy

```
POST /api/policies/evaluate
```

```json
{
  "agent": "TARS",
  "project": "core",
  "actionType": "tool.browser.navigate",
  "riskScore": 72,
  "metadata": { "url": "https://example.com" }
}
```

**Response:**

```json
{
  "decision": "require-approval",
  "matches": [
    {
      "policyId": "pol_abc123",
      "policyName": "Production risk gate",
      "policyType": "risk-threshold",
      "responseAction": "require-approval",
      "message": "Risk score requires approval."
    }
  ],
  "warnings": [],
  "blockedBy": [],
  "approvalRequiredBy": ["pol_abc123"],
  "traceId": "govtrace_1760000000000_ab12cd"
}
```

---

### Output Evaluation & Scoring (`/api/scoring`)

Create scoring profiles and evaluate agent outputs against weighted criteria.

#### List Scoring Profiles

```
GET /api/scoring/profiles
```

Query params: `limit`, `offset`.

**Response:** Array of scoring profile objects.

#### Create Scoring Profile

```
POST /api/scoring/profiles
```

```json
{
  "name": "Code Quality Baseline",
  "description": "Checks for common quality indicators in generated code.",
  "compositeMethod": "weightedAvg",
  "scorers": [
    {
      "id": "s1",
      "name": "No hardcoded secrets",
      "type": "RegexMatch",
      "pattern": "(password|secret|api_key)\\s*=\\s*['\"][^'\"]+['\"]",
      "flags": "i",
      "invert": true,
      "weight": 2,
      "scoreOnMatch": 0,
      "scoreOnMiss": 1
    },
    {
      "id": "s2",
      "name": "Has error handling",
      "type": "KeywordContains",
      "keywords": ["try", "catch", "error"],
      "matchMode": "any",
      "weight": 1
    }
  ]
}
```

**Response:** `201` with created profile.

#### Get Scoring Profile

```
GET /api/scoring/profiles/:id
```

#### Update Scoring Profile

```
PUT /api/scoring/profiles/:id
```

#### Delete Scoring Profile

```
DELETE /api/scoring/profiles/:id
```

**Response:** `204 No Content`.

#### Evaluate Output

```
POST /api/scoring/evaluate
```

```json
{
  "profileId": "prof_abc123",
  "output": "function getUser(id) {\n  try {\n    return db.find(id);\n  } catch (e) {\n    throw e;\n  }\n}",
  "action": "generate_function",
  "agent": "TARS",
  "taskId": "task_20260321_abc"
}
```

**Response:**

```json
{
  "id": "eval_xyz789",
  "profileId": "prof_abc123",
  "score": 0.88,
  "compositeMethod": "weightedAvg",
  "scorerResults": [
    { "id": "s1", "name": "No hardcoded secrets", "score": 1.0, "weight": 2 },
    { "id": "s2", "name": "Has error handling", "score": 1.0, "weight": 1 }
  ],
  "agent": "TARS",
  "taskId": "task_20260321_abc",
  "evaluatedAt": "2026-03-21T14:00:00.000Z"
}
```

#### Evaluation History

```
GET /api/scoring/history
```

Query params: `profileId`, `agent`, `taskId`, `since`, `limit`, `offset`.

**Response:** Array of past evaluation results.

---

### Prompt Template Registry (`/api/prompt-registry`)

Manage version-controlled prompt templates with variable extraction and usage tracking.

#### List Templates

```
GET /api/prompt-registry
```

Query params: `tag`, `search`, `limit`, `offset`.

**Response:** Array of template summaries (without full content for performance).

#### Create Template

```
POST /api/prompt-registry
```

```json
{
  "name": "Task Completion Summary",
  "description": "Generates a completion summary for a finished task.",
  "content": "You completed task {{task_title}}. Summarize what was done in 2-3 sentences, referencing the acceptance criteria: {{acceptance_criteria}}",
  "tags": ["completion", "summary"],
  "changelog": "Initial version"
}
```

**Response:** `201` with created template including auto-extracted variables (`task_title`, `acceptance_criteria`).

#### Get Template

```
GET /api/prompt-registry/:id
```

**Response:** Full template with current content, version number, variables list, and metadata.

#### Update Template

```
PATCH /api/prompt-registry/:id
```

Body: Partial template fields. Triggers automatic version creation.

```json
{
  "content": "You completed task {{task_title}} (ID: {{task_id}}). Summarize...",
  "changelog": "Added task_id variable"
}
```

#### Delete Template

```
DELETE /api/prompt-registry/:id
```

**Response:** `204 No Content`.

#### List Versions

```
GET /api/prompt-registry/:id/versions
```

**Response:** Array of version objects (id, versionNumber, changelog, createdAt). Does not include full content for performance.

#### Get Usage History

```
GET /api/prompt-registry/:id/usage
```

Query params: `limit`, `offset`.

**Response:** Array of usage records with model, token counts, and timestamps.

#### Template Stats

```
GET /api/prompt-registry/:id/stats
```

**Response:**

```json
{
  "totalUses": 42,
  "averageInputTokens": 312,
  "averageOutputTokens": 128,
  "lastUsedAt": "2026-03-21T14:00:00.000Z"
}
```

#### Aggregate Stats (All Templates)

```
GET /api/prompt-registry/stats/all
```

**Response:** Aggregate usage stats across all templates.

#### Preview Template

```
POST /api/prompt-registry/:id/render-preview
```

```json
{
  "variables": {
    "task_title": "Add OAuth login",
    "acceptance_criteria": "Users can log in with Google."
  }
}
```

**Response:** `{ "rendered": "You completed task Add OAuth login. Summarize..." }`

#### Record Usage

```
POST /api/prompt-registry/:id/record-usage
```

```json
{
  "model": "anthropic/claude-sonnet-4-6",
  "inputTokens": 320,
  "outputTokens": 145,
  "renderedOutput": "You completed task Add OAuth login...",
  "variables": { "task_title": "Add OAuth login" }
}
```

**Response:** `201` with logged usage record.

---

## SQLite Portability (`/api/v1/sqlite`)

Admin-only endpoints for v5 file-to-SQLite migration and backup portability.

#### Dry-Run File Migration

```
POST /api/v1/sqlite/migration/dry-run
```

```json
{
  "sourceRoot": "/path/to/project",
  "sqlitePath": "/path/to/.veritas-kanban/veritas.db",
  "journalPath": "/path/to/.veritas-kanban/sqlite-migration-journal.json"
}
```

Returns entity counts and warnings without creating or mutating the database.

#### Run File Migration

```
POST /api/v1/sqlite/migration/run
```

```json
{
  "sourceRoot": "/path/to/project",
  "sqlitePath": "/path/to/.veritas-kanban/veritas.db",
  "backupDir": "/path/to/pre-migration-backup",
  "journalPath": "/path/to/.veritas-kanban/sqlite-migration-journal.json"
}
```

Creates a timestamped source backup, imports supported file-backed data into
SQLite, and returns a migration report.

#### Migration Recovery State

```
GET /api/v1/sqlite/migration/recovery?sourceRoot=/path/to/project&sqlitePath=/path/to/.veritas-kanban/veritas.db
```

Returns the latest migration journal, safe-mode recommendation, backup
restore availability, source-file availability, SQLite readability, next
actions, and artifacts to preserve for support.

#### Restore Pre-Migration Backup

```
POST /api/v1/sqlite/migration/restore-backup
```

```json
{
  "backupPath": "/path/to/pre-migration-backup",
  "targetRoot": "/path/to/project",
  "journalPath": "/path/to/.veritas-kanban/sqlite-migration-journal.json",
  "replaceExisting": true,
  "dryRun": false
}
```

Restores the file-backed `tasks/` and `.veritas-kanban/` content from the
pre-migration backup. Non-empty targets require `replaceExisting: true`; use
`dryRun: true` to verify the paths and file count before overwriting.

#### Export Backup Bundle

```
POST /api/v1/sqlite/export
```

```json
{
  "sqlitePath": "/path/to/.veritas-kanban/veritas.db",
  "outputDir": "/path/to/backup-bundle",
  "workspaceId": "local"
}
```

Writes raw SQLite table snapshots plus human-readable Markdown/JSON/YAML files.
Omit `workspaceId` for a full database export. When `workspaceId` is supplied,
the export includes only rows scoped to that workspace plus member user records;
global app configuration tables are exported as empty arrays. Derived task
Markdown and workflow YAML files use the same workspace boundary, and unscoped
derived files such as global settings JSON are omitted.

The generated `manifest.json` includes table row counts, data lifecycle classes,
retention/export/delete behavior, sensitivity flags, scope, and redaction state.

#### Data Lifecycle Policy

```
GET /api/v1/sqlite/lifecycle-policy
```

Returns the machine-readable v5 lifecycle policy used by backup manifests and
future Maintenance Center cleanup previews.

#### Import Backup Bundle

```
POST /api/v1/sqlite/import
```

```json
{
  "sqlitePath": "/path/to/fresh.db",
  "bundleDir": "/path/to/backup-bundle",
  "replaceExisting": true
}
```

Restores the bundle into SQLite and rebuilds derived search indexes.

---

## Maintenance Center (`/api/v1/maintenance`)

Admin/backup endpoints that power Settings -> Maintenance. The full contract is
documented in [v5.0 Maintenance Center](MAINTENANCE-CENTER.md).

#### Summary

```
GET /api/v1/maintenance/summary
```

Returns health checks, storage categories, lifecycle policy metadata, work
product maintenance preview data, safe cleanup preview items, and allowlisted
log sources with redacted local paths. Cleanup is preview-only; the endpoint
does not delete data.

#### Redacted Log Tail

```
GET /api/v1/maintenance/logs?source=server&tail=200
```

Returns redacted lines and redacted source metadata from an allowlisted source.
`tail` is capped at 500.

#### Debug Bundle

```
POST /api/v1/maintenance/debug-bundle
```

Creates a redacted debug bundle under the runtime debug-bundles directory and
returns the output path plus a manifest of included categories, excluded
sensitive categories, redaction rules, and redacted file metadata.

#### SQLite Export and Import

```
POST /api/v1/maintenance/sqlite/export
POST /api/v1/maintenance/sqlite/import
```

Wrappers around the SQLite portability export/import handlers. They return the
same portability report used by `/api/v1/sqlite`.

---

### System Health (`/api/v1/system/health`)

Get a real-time snapshot of system health across resources, agents, and operations.

```
GET /api/v1/system/health
```

No query params required.

**Response:**

```json
{
  "status": "stable",
  "level": 0,
  "signals": {
    "system": {
      "status": "stable",
      "storageUsedPercent": 42,
      "diskFreeGb": 120,
      "memoryUsedPercent": 58
    },
    "agents": {
      "status": "stable",
      "online": 3,
      "offline": 0,
      "total": 3
    },
    "operations": {
      "status": "stable",
      "successRate": 0.97,
      "recentRuns": 50,
      "recentFailures": 1
    }
  },
  "timestamp": "2026-03-21T14:00:00.000Z"
}
```

**Health levels:** `stable` (0) · `reviewing` (1) · `drifting` (2) · `elevated` (3) · `alert` (4)

---

_For workflow engine endpoints, see [API-WORKFLOWS.md](API-WORKFLOWS.md)._  
_For MCP server tools, see [MCP Server Guide](mcp/README.md)._  
_For agent workflow SOPs, see [SOP-agent-task-workflow.md](SOP-agent-task-workflow.md)._

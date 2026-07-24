# Veritas Kanban — API Reference

**Version**: 5.2.5
**Last Updated**: 2026-07-23
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
18. [Shared Run Sessions](#shared-run-sessions)
19. [Task Verification](#task-verification)
20. [Task Comments](#task-comments)
21. [Task Subtasks](#task-subtasks)
22. [Task Deliverables](#task-deliverables)
23. [Recurring Work Scheduler](#recurring-work-scheduler)
24. [Queue Intake Monitors](#queue-intake-monitors)
25. [Task Archive](#task-archive)
26. [Attachments](#attachments)
27. [Agent Permissions](#agent-permissions)
28. [Agent Routing](#agent-routing)
29. [Sandbox Policies](#sandbox-policies)
30. [Shared Resources](#shared-resources)
31. [Skill Capability Profiles](#skill-capability-profiles-apiskillscapabilities)
32. [Skill Security Scanner](#skill-security-scanner-apiskillssecurity)
33. [Doc Freshness](#doc-freshness)
34. [Cost Prediction](#cost-prediction)
35. [Error Learning](#error-learning)
36. [Reflection-to-Memory Promotion](#reflection-to-memory-promotion)
37. [External Tracker Introspection](#external-tracker-introspection)
38. [Tool Policies](#tool-policies)
39. [Watcher Continuation Policies](#watcher-continuation-policies)
40. [Traces](#traces)
41. [Ceremony Requirements](#ceremony-requirements-apiceremonies)
42. [Governance Decision Traces](#governance-decision-traces-apigovernancetraces)
43. [Audit](#audit)
44. [Maintenance Center](#maintenance-center-apiv1maintenance)
45. [Common Workflows](#common-workflows)
46. [Versioning & Deprecation](#versioning--deprecation)
47. [Rate Limits](#rate-limits)
48. [Additional Endpoint Groups](#additional-endpoint-groups)

---

## Authentication

VK supports three authentication methods. All are optional when running locally with `VERITAS_AUTH_ENABLED=false`.

### Methods

| Method             | Header / Param                    | Use Case                          |
| ------------------ | --------------------------------- | --------------------------------- |
| **Session Cookie** | `veritas_session` cookie          | Local-owner browser UI login      |
| **API Key**        | `X-API-Key: <key>`                | Agent integrations, scripts       |
| **Device Session** | `Authorization: Bearer vk_dev_…`  | Paired desktop/mobile/PWA clients |
| **WS Query Param** | `ws://host:port/ws?api_key=<key>` | WebSocket connections             |

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

Production keeps unauthenticated localhost bypass disabled. A password session
that passes the local-owner loopback `Host`/`Origin`/`Referer` checks receives
only the explicit `local-agent:run` client capability needed by packaged desktop
agent controls. Remote password-session cookies remain invalid.

Password sessions are intentionally local-owner only for v5 GA. Remote,
server-mode, PWA, CLI, MCP, and multi-user clients must use device sessions or
scoped API tokens; those credentials are revalidated against workspace
membership and revocation state.

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

**Response** `200` (abridged manifest assessments):

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
GET    /api/tasks/worktrees/cleanup-preview     # Preview expired cleanup candidates
POST   /api/tasks/:id/worktree                  # Resolve base and create worktree
POST   /api/tasks/:id/worktree/adopt            # Admin: validate and adopt a legacy worktree
GET    /api/tasks/:id/worktree                   # Get status and manifest evidence
GET    /api/tasks/:id/worktree/cleanup-preview   # Preview destructive-operation safety
DELETE /api/tasks/:id/worktree                   # Remove worktree when safe
POST   /api/tasks/:id/worktree/rebase            # Fetch and rebase onto an exact commit
POST   /api/tasks/:id/worktree/merge             # Integrate without changing primary checkout
GET    /api/tasks/:id/worktree/open              # Open in editor
```

Creation fetches the configured base from `origin`, resolves the exact commit,
and persists `worktree-manifest/v1` before Git mutates the repository. A fetch
failure returns `409`. Offline creation requires an explicit acknowledgement:

```json
{
  "allowStaleBase": true,
  "staleBaseAcknowledgement": {
    "reason": "Operator confirmed the repository is intentionally offline."
  }
}
```

The response includes the manifest ID, ownership lease, exact base commit and
source, lifecycle state, remote freshness, ahead/behind counts, and cleanup
preview. Agent launch claims the same lease for the exact attempt; the task
envelope and run launch manifest retain the manifest, lease, attempt, and base
commit references.

Deletion is preview-first. Active attempts cannot be overridden. Dirty,
untracked, unpushed, unmerged, or externally held worktrees require
`force=true` plus a reason, which is persisted in the manifest:

```text
DELETE /api/tasks/:id/worktree?force=true&reason=Operator%20accepted%20the%20risk
```

Safe cleanup remains available with `task:write`, but a forced cleanup requires
`admin:manage`. An unavailable external-process inspection is incomplete
evidence and therefore also requires an admin override. An unexpired attempt
lease, active run, branch mismatch, or manifest mismatch cannot be overridden.

Pre-6.0 tasks that have a `git.worktreePath` but no manifest are not silently
trusted. An admin can call `POST /api/tasks/:id/worktree/adopt`; Veritas requires
an exact registered path and branch, matching common Git directory and remote
fingerprint, a unique cross-task allocation, and a freshly resolved remote base
that is proven to be an ancestor of the legacy HEAD before creating the
manifest. The baseline source is recorded as `legacy-adopted`, not as original
creation provenance. Local tracked and untracked changes are preserved and
appear in cleanup preview.

Merge creates a detached integration worktree from the latest exact remote
base, merges the task branch there, and pushes `HEAD` to the base without
force. It never checks out, pulls, stages, commits, or otherwise changes the
configured primary checkout. Interrupted create, rebase, push, and cleanup
states remain recorded with a recoverable error and path. Restart recovery
reconciles persisted preparing, merging, pushing, integrated, rebasing, and
cleanup states against Git and the fetched remote before resuming.

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
GET /api/config/agent-support # Redacted live harness support tiers and remediation
PUT /api/config/agents        # Update agent config
PUT /api/config/default-agent # Set default agent
```

`GET /api/config/agent-support` is the canonical operator projection used by
Settings and `vk doctor`. Each row identifies the agent type, support profile,
explicit adapter and transport, enabled state, tier, redacted reason/failure
class, executable/authentication posture, version/build evidence, manifest
digest, safe diagnostic commands, and remediation. It never returns credential
values.

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
  "analyticsEnabled": true,
  "enforcement": {
    "ceremonyDesignReview": "block",
    "ceremonyFailureRetrospective": "warn"
  }
}
```

Ceremony enforcement modes are `off`, `warn`, or `block`. `block` prevents task
completion until the matching ceremony is completed; `warn` records a pending
ceremony and governance trace without blocking completion.

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
  "message": "Starting cleanup - 14 steps",
  "model": "claude-opus-4.6",
  "tags": ["cleanup"],
  "replyToId": "msg_parent",
  "mentions": [{ "target": "case", "kind": "agent" }],
  "taskId": "task-123",
  "runId": "run-456",
  "pinned": false,
  "decision": false
}
```

```
GET /api/chat/squad
```

Returns recent squad messages. Supports `?limit=N`, `?agent=AGENT`, `?since=ISO`, and `?includeSystem=false`.

```
GET  /api/chat/squad/search?q=review&limit=20
GET  /api/chat/squad/unread?actor=case
POST /api/chat/squad/read
GET  /api/chat/squad/:messageId/thread
POST /api/chat/squad/:messageId/pin
POST /api/chat/squad/:messageId/react
```

**Read body**:

```json
{
  "actor": "case",
  "messageId": "msg_latest"
}
```

**Pin/decision body**:

```json
{
  "pinned": true,
  "decision": true
}
```

**Reaction body**:

```json
{
  "actor": "case",
  "reaction": "ack"
}
```

Search returns redacted snippets only. Mention notifications link back to the squad message and do not include raw secrets beyond the existing redaction rules.

### Communication Adapters

Bidirectional human reply adapters live under integrations. The first adapter
contract is provider-neutral with Microsoft Teams posture fields and a local
ingest API. It stores external thread mappings separately from message content.

```
GET  /api/integrations/communication/adapters
PUT  /api/integrations/communication/adapters/:adapterId
GET  /api/integrations/communication/adapters/:adapterId/health
POST /api/integrations/communication/adapters/:adapterId/test
POST /api/integrations/communication/adapters/:adapterId/send
POST /api/integrations/communication/adapters/:adapterId/replies
POST /api/integrations/communication/adapters/:adapterId/poll
POST /api/integrations/communication/adapters/:adapterId/disconnect
GET  /api/integrations/communication/mappings
GET  /api/integrations/communication/deliveries
```

Adapter setup uses `settings:write`. External reply ingestion uses
`comment:write`; approval-targeted replies also require `workflow:execute`,
`task:write`, or admin authority. Reply ingestion sanitizes the body, redacts
secret-like text, dedupes `externalReplyId`, creates a Squad Chat reply through
the normal chat service, and broadcasts it to connected clients.

**Configure body**:

```json
{
  "kind": "msteams",
  "displayName": "Microsoft Teams",
  "enabled": true,
  "deliveryMode": "webhook",
  "destinationType": "channel",
  "tenantId": "tenant-id",
  "teamId": "team-id",
  "channelId": "channel-id",
  "webhookUrl": "https://example.com/teams-adapter",
  "credential": "write-only-token"
}
```

Responses never return credentials or raw webhook query strings. Redacted
posture appears as `webhookUrlConfigured`, `webhookUrlRedacted`, and
`hasCredential`.

**Reply ingest body**:

```json
{
  "externalThreadId": "teams-thread-1",
  "externalReplyId": "reply-42",
  "actor": "alice@example.com",
  "displayName": "Alice",
  "message": "Looks good. Please ship it.",
  "target": {
    "kind": "squad",
    "squadMessageId": "msg_parent",
    "taskId": "task-123"
  }
}
```

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

Authenticated deep-health responses include an optional top-level `sqlite`
object after SQLite initializes successfully. The same redacted
`sqlite-storage/v1` contract is returned by the Maintenance summary:

| Field                               | Meaning                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `schemaVersion`                     | Always `sqlite-storage/v1`                                                             |
| `databaseLocation`                  | `memory`, `configured`, or `runtime-default`; never a raw path                         |
| `platform`                          | Runtime platform used for classification                                               |
| `filesystemType`                    | Normalized filesystem type or conservative sentinel                                    |
| `filesystemPosture`                 | `supported-local`, `known-unsafe`, `unknown`, or `not-applicable`                      |
| `detectionSource` / `reasonCode`    | Redacted evidence and decision reason                                                  |
| `journalMode`                       | `wal`, `delete`, `memory`, `refused`, or `unknown`                                     |
| `decisionSource` / `overrideSource` | Automatic, memory, compatibility, or expert-override decision provenance               |
| `healthPosture` / `lockingPosture`  | Healthy/degraded/refused posture and WAL or single-host ownership-lock state           |
| `override`                          | Optional redacted policy ID, source, status, expiry, host binding, and restart posture |
| `lastIntegrityCheck`                | Optional timestamp, `ok`/`failed` status, and bounded result from `PRAGMA quick_check` |

Raw database paths, mount points, and mount sources are intentionally omitted.
Unsafe or unknown startup posture cannot be queried through health because the
server refuses to bind; use the redacted startup/supervisor log instead.

### SQLite Journal Maintenance

Journal-mode changes are staged through the authenticated API and execute only
during the next server bootstrap, before route modules or SQLite-backed services
load. Requests always target the configured authoritative database; clients
cannot submit an arbitrary filesystem path.

| Endpoint                                               | Permission     | Purpose                                                        |
| ------------------------------------------------------ | -------------- | -------------------------------------------------------------- |
| `POST /api/maintenance/sqlite/journal/preview`         | `backup:write` | Preview posture, sidecars, ownership, backup class, and risks  |
| `POST /api/maintenance/sqlite/journal/apply`           | `admin:manage` | Schedule a confirmed preview for the next restart              |
| `GET /api/maintenance/sqlite/journal/status`           | `backup:read`  | Read the scheduled operation and active override summary       |
| `GET /api/maintenance/sqlite/journal/operations/:id`   | `backup:read`  | Read one redacted operation result                             |
| `POST /api/maintenance/sqlite/journal/override/revoke` | `admin:manage` | Revoke compatibility/override policy; restart remains required |

Preview body:

```json
{
  "targetMode": "delete",
  "singleHost": true,
  "overrideReason": "Temporary single-host compatibility",
  "expiresAt": "2026-07-16T00:00:00.000Z"
}
```

`delete` mode and any expert override require an explicit single-host
acknowledgement, a reason, a bounded future expiry,
`VERITAS_SQLITE_TOPOLOGY=single-host`, and a stable
`VERITAS_SQLITE_HOST_ID`. Known-unsafe filesystems cannot be overridden.

Apply body:

```json
{
  "previewId": "98af3a58-1b8b-41b3-8162-dfdb1f257740",
  "previewToken": "<one-time token from preview>",
  "confirm": "98af3a58-1b8b-41b3-8162-dfdb1f257740",
  "acknowledgeRisks": true
}
```

Apply returns `202` with `state: "scheduled"`. Restart the server once; the
bootstrap takes an ownership lock, creates and verifies a local backup,
checkpoints WAL, closes and reopens the source across the mode change, verifies
the effective mode and full integrity, then commits policy. A pre-close failure
reverts journal mode in place while exclusivity is still held. After the first
close, recovery only completes a verified current mode; it never replaces the
database with an older backup. A `recovery-required` result fails startup
closed. Auth-disabled and
localhost-bypass requests cannot schedule or revoke maintenance even when their
implicit role is admin.

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

**Subscribe to shared run session events**:

```json
{ "type": "run-session:subscribe" }
```

The server confirms with `run-session:subscribed` after the connection has
`task:read` access in the current workspace.

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

**Shared run session event**:

```json
{
  "type": "run-session:event",
  "event": {
    "id": "run_event_abc",
    "shareId": "run_share_abc",
    "taskId": "TASK-001",
    "attemptId": "attempt_001",
    "type": "message.sent",
    "actor": { "id": "editor-1", "label": "Pair Editor" },
    "message": "Run the focused verification gate",
    "createdAt": "2026-06-18T10:00:00.000Z"
  },
  "workspaceId": "local",
  "sequence": 42,
  "timestamp": "2026-06-18T10:00:00.000Z"
}
```

---

## Shared Run Sessions

Workspace-scoped live sharing for active task agent runs.

Mounted at `/api/run-sessions`.

| Method  | Path                              | Description                                               | Permissions  |
| ------- | --------------------------------- | --------------------------------------------------------- | ------------ |
| `GET`   | `/api/run-sessions`               | List shares in the current workspace. Supports filters.   | `task:read`  |
| `POST`  | `/api/run-sessions`               | Create a view, edit, or fork share for a task run.        | `task:write` |
| `GET`   | `/api/run-sessions/:id`           | Read an active share snapshot.                            | `task:read`  |
| `GET`   | `/api/run-sessions/:id/events`    | Read share lifecycle, message, approval, and fork events. | `task:read`  |
| `PATCH` | `/api/run-sessions/:id`           | Update permission, expiry, label, or mobile-safe classes. | `task:write` |
| `POST`  | `/api/run-sessions/:id/revoke`    | Revoke a share.                                           | `task:write` |
| `POST`  | `/api/run-sessions/:id/messages`  | Send an attributed co-drive message into the run.         | `task:write` |
| `POST`  | `/api/run-sessions/:id/approvals` | Record an approval response.                              | `task:write` |
| `POST`  | `/api/run-sessions/:id/fork`      | Create a linked fork task without mutating the parent.    | `task:write` |

### Create Share

```http
POST /api/run-sessions
```

```json
{
  "taskId": "TASK-001",
  "permission": "view",
  "expiresAt": "2026-06-19T10:00:00.000Z",
  "actorLabel": "Release reviewer",
  "mobileSafeApprovalClasses": ["human-review", "task-comment", "low-risk"]
}
```

`permission` is one of `view`, `edit`, or `fork`.

The response includes `stablePath`, `snapshot`, `mobileSafeApprovalClasses`,
`status`, and `forkedTaskIds`. The share path is not anonymous public access; it
still requires workspace authentication and task read/write permissions.

### Co-drive Message

```http
POST /api/run-sessions/run_share_abc/messages
```

```json
{
  "message": "Run the focused verification gate before release."
}
```

The server records the request actor on the resulting `message.sent` event and
forwards the message to the active run when the backing provider exposes an
interactive stream. If interactive stdin is unavailable, the message is still
recorded and streamed as session history.

### Mobile-safe Approval

```http
POST /api/run-sessions/run_share_abc/approvals
```

```json
{
  "actionClass": "human-review",
  "response": "approved",
  "note": "Diff and focused tests look safe from mobile."
}
```

Mobile/PWA clients can respond only to approval classes listed on the share.
Unsafe approval classes fail closed with `403`.

### Fork Session

```http
POST /api/run-sessions/run_share_abc/fork
```

```json
{
  "title": "Investigate forked run",
  "priority": "high",
  "reason": "Continue independently without changing the parent run."
}
```

Forking creates a new task linked to the parent task and attempt. The fork
description includes redacted parent context and a redacted run excerpt when
available, but it does not inherit worktrees, thread IDs, credentials, or
local-only handles.

Revoked and expired shares fail closed for reads, messages, approvals, and
forks. Share lists are scoped to the current workspace.

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

## Recurring Work Scheduler

Inspect and control recurring work across scheduled deliverables and scheduled workflow definitions.

Mounted at `/api/scheduler`.

### List Scheduler Items

```
GET /api/scheduler
```

Returns scheduler summary counts, scheduler items, retry state, health, and recent events.

### Read Item

```
GET /api/scheduler/items/:id
```

Item IDs use the source prefix:

- `scheduled-deliverable:<deliverableId>`
- `workflow:<workflowId>`
- `queue-monitor:<monitorId>`

### Run Item Now

```
POST /api/scheduler/items/:id/run
```

Runs one scheduler item immediately. Deliverables execute through the scheduled deliverables runner. Workflows start a normal workflow run and return the started run ID.

### Pause Item

```
POST /api/scheduler/items/:id/pause
```

Pauses the underlying scheduled deliverable or workflow schedule.

### Resume Item

```
POST /api/scheduler/items/:id/resume
```

Re-enables the underlying scheduled deliverable or workflow schedule and clears scheduler retry delay.

### Validate Item

```
POST /api/scheduler/items/:id/validate
```

Returns validation issues. Custom cron schedules are visible and manually runnable, but automatic due-run execution is not enabled until a cron adapter is configured.

### Run Due Items

```
POST /api/scheduler/due/run
```

Runs all due standard schedules and refuses overlapping due-run passes.

---

## Queue Intake Monitors

Scan bounded GitHub issue and PR queues, build candidate packets, and gate assign/execute actions through policy, budget, sandbox, auth, and workflow preflight checks.

Mounted at `/api/queue-monitors`.

| Method | Path                              | Description                                                |
| ------ | --------------------------------- | ---------------------------------------------------------- |
| `GET`  | `/api/queue-monitors`             | List monitors, health, candidate packet state, and events  |
| `GET`  | `/api/queue-monitors/:id`         | Read one monitor                                           |
| `PUT`  | `/api/queue-monitors/:id`         | Update mode, runner, labels, caps, workflow, and guardrail |
| `GET`  | `/api/queue-monitors/:id/health`  | Read health and visible action item state                  |
| `GET`  | `/api/queue-monitors/:id/explain` | Build a fresh packet and planned action without mutation   |
| `POST` | `/api/queue-monitors/:id/run`     | Run one monitor now                                        |
| `POST` | `/api/queue-monitors/:id/pause`   | Pause one monitor                                          |
| `POST` | `/api/queue-monitors/:id/resume`  | Resume one monitor                                         |

### Monitor Modes

- `dry-run` records the selected candidate and skipped reasons without assigning or starting work.
- `assign-only` can assign the selected GitHub issue/PR only after watcher policy, budget, sandbox, and stop-condition checks pass.
- `draft-plan` records a local plan intent without GitHub mutation or workflow launch.
- `execute` can start `workflowId` only after watcher policy, budget, sandbox, workflow dry-run, auth, and stop-condition checks pass.

`runner: "local"` is executable in this version. `runner: "github-actions"` is persisted for monitor definitions but launch is blocked until a workflow-dispatch adapter is configured.

Local queue sandbox preflight probes the configured Codex runtime and evaluates
the preset against that exact manifest. If no valid manifest can be resolved,
capability-dependent presets fail closed instead of using provider-name
assumptions.

### Candidate Packet

Each run stores a bounded packet with:

- `candidates`: issue/PR records with labels, assignees, CI state, score, reasons, and blockers
- `selected`: first unblocked candidate after deterministic scoring
- `skipped`: candidate IDs and skipped-work reasons
- `checks`: GitHub scan, watcher policy, sandbox, budget, and workflow gate checks

Repeated `failed` or `blocked` runs increment `failureStreak`. When the monitor reaches `stopConditions.maxFailureStreak`, health becomes `blocked` and `actionItem` explains what must be fixed before resuming.

Queue monitor events are included in the operations digest when they fall inside the selected digest window.

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
  "taskId": "TASK-001",
  "requiredRuntimeCapabilities": ["run.resume", "tool.mcp"]
}
```

**By metadata**:

```json
{
  "type": "bug",
  "priority": "high",
  "project": "rubicon",
  "subtaskCount": 3,
  "requiredRuntimeCapabilities": ["run.resume", "tool.mcp"]
}
```

**Response** `200`:

```json
{
  "agent": "codex-1",
  "model": "gpt-5.5",
  "rule": "high-priority-bugs",
  "reason": "Matched rule: High priority bugs. Selected manifest sha256:... with supported capability evidence.",
  "runtimeSelection": {
    "requiredCapabilities": ["run.resume", "tool.mcp"],
    "compatible": true,
    "selectedManifest": {
      "manifestDigest": "sha256:...",
      "provider": "codex-cli",
      "compatible": true
    },
    "candidates": [
      {
        "manifestDigest": "sha256:...",
        "provider": "codex-cli",
        "compatible": true
      }
    ]
  },
  "runtimeCandidates": [
    {
      "agent": "codex-1",
      "available": true,
      "selected": true,
      "reason": "Agent is healthy",
      "selection": {
        "requiredCapabilities": ["run.resume", "tool.mcp"],
        "compatible": true,
        "selectedManifest": {
          "manifestDigest": "sha256:...",
          "provider": "codex-cli",
          "compatible": true
        },
        "candidates": [
          {
            "manifestDigest": "sha256:...",
            "provider": "codex-cli",
            "compatible": true
          }
        ]
      }
    }
  ],
  "traceId": "govtrace_1760000000000_ab12cd"
}
```

When an enabled team roster exists, `/api/agents/route` evaluates the roster
before legacy routing rules. Roster-selected responses use a `team-roster:`
rule prefix.
When runtime requirements are present, `runtimeCandidates` preserves every
agent manifest evaluation attempted by the rule/fallback chain. Exactly one
entry is marked `selected` on success; terminal `409 Conflict` details preserve
all rejected entries and their structured manifest assessments.

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

### Start Agent And Require Runtime Capabilities

```
POST /api/agents/:taskId/launch-preview
POST /api/agents/:taskId/start
```

The preview and start endpoints accept the same request. Preview compiles the
effective `run-launch-manifest/v1` without creating an attempt or dispatching a
provider. Callers can select an agent or portable profile package, require
additional runtime capabilities, and compare against a parent attempt:

```json
{
  "profileId": "docs-reviewer",
  "sandboxPresetId": "codex-repo-contained",
  "requiredRuntimeCapabilities": ["tool.mcp", "output.structured"],
  "commitPolicy": "allowed",
  "parentAttemptId": "attempt_parent"
}
```

The launch path resolves the package runtime against configured provider
profiles, applies package model/sandbox/budget posture, and renders bounded
package instructions in an attributed section of the provider-owned transport.
It also records the profile ID and version. Baseline launch
capabilities plus caller, profile, sandbox, and budget requirements must be
`supported` or `advisory` in one valid manifest before attempt state is
mutated. Failure returns `409 Conflict` with `requiredCapabilities`, reasons,
manifest identity, and remediation.

The preview response contains `manifest`, plus optional `parentAttemptId` and
`drift`. The manifest contains redacted effective runtime inputs, instruction
fingerprints, per-field origins, and an `enforcement` object. Prompt content,
readiness override text, credential values, and raw local output paths are
excluded. Preview and start apply the same readiness gate; an accepted operator
override is represented by its digest and run-level origin. Start records the
same contract in the active attempt, history, run log, and a policy governance
trace before provider dispatch. Named tool/MCP/permission restrictions and
required profile health checks block launch when the adapter cannot enforce
them explicitly.

Current task adapters reject every non-empty named-tool or MCP catalog. The
run-scoped tool-server control plane tracked in #857 owns positive catalog
injection; prompt text is never accepted as equivalent enforcement.

`commitPolicy` accepts `forbidden`, `allowed`, or `required`. A run value
overrides `task.executionPolicy.commitPolicy`, then the legacy
`features.agents.autoCommitOnComplete` setting. Legacy `true` maps to
`required`; `false` or an absent value maps to the compatible `allowed`
default. Unknown policy fields or values return `400 Validation failed`.

`GET /api/agents/:taskId/status` returns the active manifest and its derived
controls:

```json
{
  "running": true,
  "attemptId": "attempt_123",
  "provider": "codex-cli",
  "providerRuntimeManifest": { "digest": "sha256:..." },
  "runLaunchManifest": {
    "schemaVersion": "run-launch-manifest/v1",
    "digest": "sha256:...",
    "providerRuntime": {
      "digest": "sha256:...",
      "provider": "codex-cli",
      "probeRevision": 3
    },
    "runtime": {
      "command": "codex",
      "model": "gpt-5.5"
    },
    "enforcement": {
      "enforceable": true,
      "blockers": [],
      "warnings": []
    }
  },
  "taskEnvelope": {
    "schemaVersion": "task-envelope/v1",
    "digest": "sha256:...",
    "commitPolicy": "allowed",
    "workspace": {
      "baseline": {
        "headSha": "0123456789abcdef0123456789abcdef01234567",
        "dirty": false,
        "files": []
      }
    }
  },
  "controls": {
    "manifestDigest": "sha256:...",
    "probeState": "ready",
    "controls": [
      {
        "action": "stop",
        "label": "Stop run",
        "capabilityId": "run.stop",
        "state": "supported",
        "available": true,
        "advisory": false,
        "reason": "The adapter terminates the supervised provider process."
      }
    ]
  }
}
```

Stop, message, completion, token-reporting, and attempt-log endpoints re-check
both persisted snapshots. Invalid or active/persisted provider or run-launch
digest mismatches return `409 Conflict`; unsupported capability states return
the same structured control evidence.

Stop and message requests must carry the `attemptId` returned by status so a
delayed control cannot affect a replacement run:

```json
{ "attemptId": "attempt_123" }
```

`POST /api/agents/:taskId/message` adds the attributed `message` (and optional
`actor`) to that body. `POST /api/agents/:taskId/tokens` also requires the exact
`attemptId`; the server never falls back to the task's current attempt.

OpenClaw completion callbacks must identify the exact run that produced them:

```json
{
  "attemptId": "attempt_123",
  "providerRuntimeManifestDigest": "sha256:<64 lowercase hex characters>",
  "success": true,
  "summary": "Implemented and verified the requested change"
}
```

`POST /api/agents/:taskId/complete` rejects OpenClaw callbacks whose attempt or
manifest digest does not match the active run. The bounded legacy body above
remains supported. A callback can instead send an explicit `status`
(`success`, `blocked`, `failed`, `interrupted`, or `partial`) plus bounded
`blockers`, provider `evidence`, `artifacts`, `verification`, and
`continuation`. The route fixes the terminal source to `callback`; clients
cannot spoof process, stream, or operator ownership. Only OpenClaw attempts
accept callback or remote-session completion; process and SDK providers return
`409 Conflict` for that transport.

Every terminal path persists one digest-bound `completion-result/v1` on the
current attempt and attempt history. It includes `digest`, `idempotencyKey`,
`completedAt`, `terminalSource`, envelope/runtime bindings, normalized status,
bounded redacted claims, harness evidence, attributable files and artifacts,
verification, side effects, and continuation. Exact duplicate callbacks
return success without mutating the task again, including after restart.
Conflicting terminal claims return `409 Conflict`.
Startup reconciliation also persists `interrupted` completion results for
harness-owned process or stream attempts that were still running when the
server restarted. OpenClaw attempts remain eligible for their authoritative
callback after restart.

Codex CLI, Codex SDK, and Hermes do not call this endpoint; Veritas captures
their terminal process or stream output and owns completion normalization.
Claimed success becomes `partial` when required harness evidence is absent,
commit policy is violated, a required output is missing, or an unauthorized
side effect is observed. `success` maps the task to `done`, `blocked` maps it
to `blocked`, and `failed`, `interrupted`, or `partial` leaves it in
`in-progress` recovery. Token reports likewise bind
telemetry and budget mutation to their required `attemptId`, so a late event
from a prior attempt cannot charge or stop a replacement run.

### Provider Runtime Manifest On Attempts

Every executable task adapter is probed before the attempt mutates task state.
Task and trace responses can therefore include the immutable
`providerRuntimeManifest` used at launch:

```json
{
  "schemaVersion": "provider-runtime-manifest/v1",
  "probeRevision": 3,
  "provider": "codex-cli",
  "adapter": "codex-cli",
  "protocolVersion": "codex-exec-json/v1",
  "providerVersion": "codex-cli 0.144.0",
  "models": ["gpt-5.5"],
  "capabilities": [
    {
      "id": "run.streaming",
      "state": "supported",
      "source": "contract-test",
      "reason": "Codex JSONL output is streamed into run events."
    }
  ],
  "probe": {
    "state": "ready",
    "probedAt": "2026-07-16T01:30:00.000Z",
    "source": "codex --version",
    "diagnostics": []
  },
  "digest": "sha256:<64 lowercase hex characters>"
}
```

### Task Envelope On Attempts

The start API builds the immutable envelope only after readiness, runtime
manifest, and sandbox decisions succeed, but before provider execution. The
same `taskEnvelope` is returned by start/status and persisted on the current
attempt and attempt history. Its digest covers the provider-neutral task,
workspace baseline, policy, expected outputs, gates, and launch-manifest
reference. Dirty baseline entries include `indexBlobHash` and
`worktreeSha256`, allowing completion attribution to distinguish staged and
unstaged pre-launch content. Baseline capture is sequential, retries up to
three times when HEAD, status, or fingerprints move, and fails closed if the
worktree never stabilizes. Existing attempt records without an envelope remain
readable.

Task create/update payloads may set reusable defaults under
`executionPolicy`:

```json
{
  "executionPolicy": {
    "commitPolicy": "forbidden",
    "allowedSideEffects": [{ "kind": "filesystem-write", "scope": "." }]
  }
}
```

Run-time allowed side effects are intersected with the effective sandbox and
manifest posture; a task policy cannot grant a capability that launch policy
does not authorize. Path scopes wider than the assigned worktree are clamped to
the worktree, while disjoint path scopes are dropped. Generic task PATCH calls
cannot set `attempt.taskEnvelope` or `attempt.completionResult`; only the
launch and finalization services may persist those authoritative contracts.

Before dispatch, the selected adapter renders the envelope through an immutable
`provider-task-envelope-transport/v1` request. Built-in renderers exist for
OpenClaw, Codex CLI, Codex SDK, and Hermes. Every rendered request includes the
envelope and runtime identity, objective and bounded context, workspace
baseline, explicit commit policy, allowed side effects, outputs, verification
gates, and completion evidence contract. Profile instructions and task
checkpoint state are separate attributed sections capped at 20,000 characters
each. The exact rendered content is fingerprinted in the run launch manifest
as `instructions.effective-task-request`.

OpenClaw's transport includes the attempt-bound completion callback. Codex CLI,
Codex SDK, and Hermes transports explicitly forbid calling that callback and
return terminal output through harness-owned process or stream capture.
Provider and adapter identity must match the envelope before dispatch. Veritas
does not infer native structured-output support from prompt rendering and owns
completion validation and normalization.

The full manifest contains one entry for every known runtime and sandbox
capability. A provider version/build change invalidates cached conformance
evidence. Failed probes and unknown versions are not positively cached.
Explicitly configured providers without a task execution adapter fail with
`409 Conflict` instead of falling back to OpenClaw.

### Runtime Manifest Registration And Routing

`POST /api/agents/register` and
`POST /api/agents/register/:id/heartbeat` accept an optional
`providerRuntimeManifest` object using the contract above. The server validates
the complete capability inventory and recomputes the canonical digest before
storing it. Secret-like evidence and unknown request fields are rejected rather
than silently stored or stripped. Invalid persisted manifests are ignored on
restart so capability routing fails closed. An agent may write its own manifest
when its authenticated key/token identity matches the registry ID; otherwise
`agent:write` is required in addition to registry write access. Every later
mutation of that authoritative record remains identity-bound. Changing the
registered provider, model, or version without replacement evidence invalidates
the prior manifest.

`POST /api/agents/route` and `POST /api/agents/hosts/preview` accept:

```json
{
  "requiredRuntimeCapabilities": ["run.resume", "tool.mcp"]
}
```

Host provider, model, `tool.*`, and sandbox posture is aggregated from validated
manifests. Legacy registry fields are returned as display-only posture and
cannot satisfy these requirements. A single manifest must match the requested
provider and model and satisfy every required capability. `supported` evidence
qualifies; `advisory` qualifies with a warning; `unsupported`, `unknown`,
missing, or failed-probe evidence rejects the candidate with structured reasons.
Custom provider identifiers use the same schema and selection path without a
central provider branch. Registration enables discovery and routing only; an
execution adapter is still required before launch.

Only live registrations with a heartbeat no older than five minutes contribute
runtime evidence. `requiredTools` values using `tool.*` are evaluated through
the same single-manifest path; legacy named tools cannot qualify a host.
Launch-time sandbox preset rules and active run controls use the exact manifest
persisted on the attempt. Provider events, status, logs, completion, stop,
steer, token usage, and artifacts reject missing, invalid, failed-probe, or
active/persisted digest-mismatched snapshots.

---

## Team Roster Manifests

Team rosters define the workspace coordinator, enabled agent members, roles,
capabilities, routing rules, fallbacks, and reviewers. The manifest is stored in
app config as `teamRoster`.

Mounted at `/api/config/team-roster`.

| Method | Path                                         | Description                                   | Permissions      |
| ------ | -------------------------------------------- | --------------------------------------------- | ---------------- |
| `GET`  | `/api/config/team-roster`                    | Return the stored roster or `null`            | `settings:read`  |
| `PUT`  | `/api/config/team-roster`                    | Replace the roster manifest                   | `settings:write` |
| `POST` | `/api/config/team-roster/validate`           | Validate a roster object or YAML/JSON content | `settings:read`  |
| `POST` | `/api/config/team-roster/import`             | Import and store YAML/JSON roster content     | `settings:write` |
| `GET`  | `/api/config/team-roster/export?format=yaml` | Export the stored roster as YAML or JSON      | `settings:read`  |
| `POST` | `/api/config/team-roster/preview-route`      | Preview the selected member for task metadata | `settings:read`  |

### Preview Route

```json
{
  "type": "docs",
  "priority": "medium",
  "project": "docs",
  "path": "docs/API-REFERENCE.md",
  "capabilities": ["docs"],
  "subtaskCount": 2
}
```

Preview responses include the matched member, fallback member when used,
reviewer members, selected agent/profile, reason, and validation issues.
Invalid rosters never route agent launches.

---

## Workspace Capability Discovery

Workspace capability manifests let a board publish what work it accepts and
register trusted peer manifests for delegated intake. Manifest data is stored in
app config as `workspaceCapability`, `trustedWorkspaceCapabilities`, and
`workspaceDelegations`.

Mounted at `/api/workspace-capabilities`.

| Method   | Path                                                  | Description                                      | Permissions      |
| -------- | ----------------------------------------------------- | ------------------------------------------------ | ---------------- |
| `GET`    | `/api/workspace-capabilities/manifest`                | Return the local published manifest or `null`    | `workspace:read` |
| `PUT`    | `/api/workspace-capabilities/manifest`                | Replace the local published manifest             | `settings:write` |
| `POST`   | `/api/workspace-capabilities/manifest/validate`       | Validate a manifest object or YAML/JSON content  | `workspace:read` |
| `POST`   | `/api/workspace-capabilities/manifest/import`         | Import and store the local manifest              | `settings:write` |
| `GET`    | `/api/workspace-capabilities/manifest/export`         | Export the local manifest as YAML or JSON        | `workspace:read` |
| `GET`    | `/api/workspace-capabilities/trusted`                 | List trusted peer manifests                      | `workspace:read` |
| `POST`   | `/api/workspace-capabilities/trusted`                 | Register or replace a trusted peer manifest      | `settings:write` |
| `DELETE` | `/api/workspace-capabilities/trusted/:workspaceId`    | Remove a trusted peer manifest                   | `settings:write` |
| `GET`    | `/api/workspace-capabilities/discover`                | Return local plus trusted manifests for browsing | `workspace:read` |
| `POST`   | `/api/workspace-capabilities/intake`                  | Create delegated task intake from a trusted peer | `task:write`     |
| `GET`    | `/api/workspace-capabilities/delegations`             | List stored delegation records                   | `task:read`      |
| `POST`   | `/api/workspace-capabilities/delegations/:id/refresh` | Refresh latest target state                      | `task:write`     |

### Manifest Shape

```json
{
  "id": "local-board",
  "schemaVersion": "workspace-capability/v1",
  "workspaceId": "local",
  "name": "Local Board",
  "enabled": true,
  "boardUrl": "https://veritas.example",
  "capabilities": [
    {
      "id": "docs",
      "name": "Documentation",
      "acceptedTaskTypes": ["docs"],
      "defaultLabels": ["docs"],
      "defaultProject": "handbook",
      "defaultPriority": "medium",
      "requiredContextFields": ["acceptance"],
      "intakeTargets": ["task"]
    }
  ]
}
```

Validation rejects duplicate capability IDs and secret-like manifest fields such
as `token`, `password`, `apiKey`, or `privateKey`. Discovery responses redact
manifest import source metadata.

### Delegated Intake

```json
{
  "source": {
    "workspaceId": "source",
    "workspaceName": "Source Board",
    "taskId": "task_20260626_source",
    "taskUrl": "https://source.example/tasks/task_20260626_source"
  },
  "capabilityId": "docs",
  "title": "Write operator handoff docs",
  "context": "Document the delegated queue handoff.",
  "contextFields": {
    "acceptance": "Includes handoff and rollback steps"
  },
  "type": "docs",
  "labels": ["handoff"],
  "requestedBy": "user:brad"
}
```

Intake fails closed unless the source workspace is trusted by the local manifest
or registered as a trusted peer manifest. Successful task intake stores a
delegation record and, when the source task exists locally, appends a
`delegatedWork` status link to that originating task.

CLI support is available under `vk workspaces`:

```bash
vk workspaces discover
vk workspaces validate ./workspace-capability.yaml
vk workspaces trust ./peer-workspace.yaml
vk workspaces intake --source-workspace source --capability docs --title "Write docs" --context "Document handoff" --context-field acceptance="Includes rollback steps"
```

---

## Agent Profile Packages

Reusable YAML/JSON packages for agent role, runtime, prompt, tools, permissions, policy posture, workflow entrypoint, and health metadata.

Mounted at `/api/config/agent-profiles`.

| Method   | Path                                                | Description                                       | Permissions      |
| -------- | --------------------------------------------------- | ------------------------------------------------- | ---------------- |
| `GET`    | `/api/config/agent-profiles`                        | List imported profile package summaries           | `settings:read`  |
| `POST`   | `/api/config/agent-profiles/validate`               | Validate YAML/JSON content with field-path errors | `settings:read`  |
| `POST`   | `/api/config/agent-profiles/import`                 | Import or replace a profile package               | `settings:write` |
| `GET`    | `/api/config/agent-profiles/:id`                    | Get one stored profile package                    | `settings:read`  |
| `GET`    | `/api/config/agent-profiles/:id/export?format=yaml` | Export a package as YAML or JSON                  | `settings:read`  |
| `PATCH`  | `/api/config/agent-profiles/:id`                    | Edit metadata and enablement                      | `settings:write` |
| `DELETE` | `/api/config/agent-profiles/:id`                    | Remove a package                                  | `settings:write` |

### Import Package

```json
{
  "format": "yaml",
  "source": "settings",
  "content": "id: docs-reviewer\nschemaVersion: agent-profile-package/v1\nversion: 1.0.0\n..."
}
```

Invalid packages return `valid: false` from `/validate` with issues like `$.runtime.agent: Required`. Import rejects invalid packages and never installs third-party binaries, tools, credentials, or MCP servers.

---

## Sandbox Policies

Reusable filesystem, network, environment, and credential presets for agent
and workflow launch guardrails.

Mounted at `/api/sandbox-policies`.

| Method   | Path                             | Description                                    | Permissions                 |
| -------- | -------------------------------- | ---------------------------------------------- | --------------------------- |
| `GET`    | `/api/sandbox-policies`          | List built-in and custom presets               | `policy:read`               |
| `GET`    | `/api/sandbox-policies/:id`      | Get one preset                                 | `policy:read`               |
| `POST`   | `/api/sandbox-policies`          | Create a custom preset                         | `policy:write` + admin role |
| `PUT`    | `/api/sandbox-policies/:id`      | Update a custom preset                         | `policy:write` + admin role |
| `DELETE` | `/api/sandbox-policies/:id`      | Delete a custom preset                         | `policy:write` + admin role |
| `POST`   | `/api/sandbox-policies/validate` | Dry-run a preset against provider capabilities | `policy:read`, `agent:read` |

Built-in presets are immutable. Custom presets live in the shared app config.
Agent profiles, workflow agents, and one-off agent starts can reference a preset
with `sandboxPresetId`.

### Create Preset

```
POST /api/sandbox-policies
```

**Body**:

```json
{
  "id": "repo-contained-no-network",
  "name": "Repo contained, no network",
  "enabled": true,
  "enforcement": "required",
  "requiredCapabilities": ["filesystem.write"],
  "filesystem": {
    "readPaths": ["."],
    "writePaths": ["."],
    "deniedPaths": ["~/.ssh", "~/.aws", "~/.config/gh"],
    "dotfileMasking": true,
    "localOnlyHandles": true
  },
  "network": {
    "defaultEgress": "deny",
    "allowedHosts": [],
    "allowedMethods": [],
    "allowedPathPrefixes": [],
    "blockPrivateNetwork": true,
    "blockMetadataEndpoints": true,
    "blockLoopback": false
  },
  "environment": {
    "passthrough": ["CODEX_HOME", "OPENAI_API_KEY"],
    "redactDisplay": true
  },
  "credentials": {
    "mode": "brokered",
    "brokerRefs": ["openai-api-key"]
  }
}
```

**Response** `201`: Created preset with `createdAt` and `updatedAt`.

### Validate Preset

```
POST /api/sandbox-policies/validate
```

**Body**:

```json
{
  "presetId": "repo-contained-no-network",
  "provider": "codex-sdk",
  "providerRuntimeManifestDigest": "sha256:<64 lowercase hex characters>",
  "workspacePath": "/workspace/veritas-kanban",
  "requiredCapabilities": ["filesystem.write"]
}
```

The digest must belong to a manifest currently registered by a live agent host
and must match `provider`. The API rejects caller-supplied manifest objects,
unknown or expired digests, and provider mismatches. Internal launch checks use
the immutable manifest already selected and persisted for the attempt.

**Response** `200`:

```json
{
  "decision": "allow",
  "provider": "codex-sdk",
  "effective": {
    "sandboxMode": "workspace-write",
    "networkAccessEnabled": false,
    "envPassthrough": ["CODEX_HOME", "OPENAI_API_KEY"],
    "credentialRefs": ["openai-api-key"]
  },
  "unsupportedRules": [],
  "warnings": [],
  "traceId": "govtrace_1760000000000_ab12cd"
}
```

`decision` is `allow`, `warn`, or `block`. Required unsupported controls block
launches before execution. Advisory unsupported controls continue with warnings.
Credential references and environment-style `name=value` values are redacted in
responses and governance traces.

---

## Credential Broker Definitions

Admin-only registry for metadata-only credential definitions. The API never
accepts or returns a raw credential value.

Mounted at `/api/credential-broker`.

| Method   | Path                         | Description                                  | Permissions    |
| -------- | ---------------------------- | -------------------------------------------- | -------------- |
| `GET`    | `/api/credential-broker`     | List credential definition metadata          | `admin:manage` |
| `GET`    | `/api/credential-broker/:id` | Get one credential definition                | `admin:manage` |
| `POST`   | `/api/credential-broker`     | Create a metadata-only credential definition | `admin:manage` |
| `PUT`    | `/api/credential-broker/:id` | Replace a credential definition              | `admin:manage` |
| `DELETE` | `/api/credential-broker/:id` | Delete a definition with no active leases    | `admin:manage` |

### Create Definition

```http
POST /api/credential-broker
Content-Type: application/json
```

```json
{
  "id": "github-token",
  "name": "GitHub token",
  "description": "Read-only repository metadata",
  "enabled": true,
  "source": {
    "kind": "environment",
    "reference": "VK_GITHUB_TOKEN"
  },
  "scope": {
    "dispatchTypes": ["http"],
    "hosts": ["api.github.com"],
    "tools": [],
    "destinations": ["https://api.github.com"],
    "methods": ["GET"],
    "actions": ["issues.read"],
    "pathPrefixes": ["/repos/"]
  },
  "lease": {
    "ttlSeconds": 60,
    "maxUses": 1,
    "renewable": false
  },
  "approval": "not-required"
}
```

**Response** `201`: the definition plus
`schemaVersion: "credential-definition/v1"`, a canonical SHA-256 digest, and
creation/update timestamps. Environment key names and external manager paths
are references, not values. Metadata containing credential-looking values is
rejected.

The server exposes no public lease-issue, lease-use, or secret-resolution
endpoint. Internal controlled boundaries use `credential-lease/v1` records
whose persisted form contains a handle hash, definition and scope digests,
task/attempt/launch-manifest binding, exact action fingerprint, expiry, use
count, SHA-256 fingerprints of unique caller operation IDs, approval reference,
and terminal state. Raw operation IDs are not persisted. Duplicate operation
IDs fail closed instead of replaying use or refresh. Raw values exist only
inside the controlled callback; the server returns a constrained structured
clone and rejects results that cannot be safely cloned or that contain
credential material. Binary views and buffers are not valid callback results.

The initial local source resolves an environment key at use time. This is a
compatibility source, not a replacement for a production secret manager.
Definitions using an unavailable external source remain metadata-only and
leases fail closed. Required brokered sandbox presets remain blocked until a
provider and controlled network or tool boundary report supported,
non-bypassable evidence.

Run completion retries revocation on duplicate terminal delivery. Startup and
one-minute periodic reconciliation expire, block, or revoke invalid leases.
Manifest declarations and sandbox `brokerRefs` must be exact definition IDs;
credential-like `name=value` strings are rejected.

See [Credential Broker](CREDENTIAL-BROKER.md) for lifecycle, limitations, and
rollback behavior.

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

## Reflection-to-Memory Promotion

Reviewed queue for turning corrections, repeated mistakes, and failure lessons into durable Veritas records.

Mounted at `/api/reflections`. Requires `workflow:read` for reads and `workflow:write` for writes.

| Method   | Path                          | Description                                                             |
| -------- | ----------------------------- | ----------------------------------------------------------------------- |
| `GET`    | `/api/reflections`            | List candidates with filters for status, category, source kind, task ID |
| `POST`   | `/api/reflections`            | Create a reflection candidate from a linked source                      |
| `POST`   | `/api/reflections/:id/accept` | Accept a pending candidate and apply its reviewed promotion             |
| `POST`   | `/api/reflections/:id/reject` | Reject a pending candidate without affecting future context             |
| `POST`   | `/api/reflections/:id/merge`  | Soft-merge a duplicate into its representative candidate                |
| `DELETE` | `/api/reflections/:id`        | Soft-delete a candidate while preserving audit history                  |

Candidates support `session`, `agent`, `team`, `policy`, and `template` categories. Sources can link to `task-run`, `chat-message`, `error`, `user-correction`, `review-feedback`, or `task-observation`.

### Create Candidate

```
POST /api/reflections
```

**Body**:

```json
{
  "category": "team",
  "promotionTarget": "task-lesson",
  "confidence": 0.86,
  "source": {
    "kind": "user-correction",
    "taskId": "task_20260626_reflect",
    "messageId": "msg_123"
  },
  "summary": "The agent guessed a config field instead of reading the schema.",
  "previousApproach": "Used a remembered field name.",
  "correction": "Read the live schema and nearby route tests first.",
  "nextAttempt": "Inspect the current schema before changing config behavior.",
  "evidence": [
    {
      "kind": "note",
      "title": "Correction",
      "content": "Reviewer corrected the route field during active work."
    }
  ],
  "tags": ["schema", "workflow"]
}
```

**Response** `201`: Created pending candidate. Tokens, credential-looking values, and `/Users/...` private paths are redacted before storage.

### Accept Candidate

```
POST /api/reflections/:id/accept
```

**Body**:

```json
{
  "reviewedBy": "brad",
  "promotionTarget": "task-lesson",
  "reviewerNote": "Reusable correction for future agent work."
}
```

For `task-lesson`, the candidate must have a linked `source.taskId`; acceptance appends a reviewed reflection lesson to that task and adds `reflection` lesson tags. Other promotion targets are recorded as manual-review targets and do not mutate policy, profile, template, or memory stores automatically.

### Reject or Merge

```
POST /api/reflections/:id/reject
POST /api/reflections/:id/merge
DELETE /api/reflections/:id
```

Rejected, merged, and deleted candidates remain in the audit trail and do not affect future prompts or policies.

---

## External Tracker Introspection

Configurable external work item schema introspection and mapping lives under `/api/integrations/trackers`. Reads require `settings:read`; writes require `settings:write` through the parent integrations permission guard. External creates also require an explicit `approvedBy` field in the request body.

| Method | Path                                                            | Description                                                   |
| ------ | --------------------------------------------------------------- | ------------------------------------------------------------- |
| `GET`  | `/api/integrations/trackers/connection`                         | Return redacted connection posture                            |
| `PUT`  | `/api/integrations/trackers/connection`                         | Save redacted connection metadata; credential values omitted  |
| `GET`  | `/api/integrations/trackers/schema`                             | Return the latest normalized tracker schema                   |
| `POST` | `/api/integrations/trackers/introspect`                         | Run adapter introspection and refresh the schema              |
| `GET`  | `/api/integrations/trackers/profiles`                           | List mapping profiles                                         |
| `PUT`  | `/api/integrations/trackers/profiles/:profileId`                | Save a mapping profile after schema validation                |
| `POST` | `/api/integrations/trackers/profiles/:profileId/validate`       | Validate a saved profile                                      |
| `POST` | `/api/integrations/trackers/profiles/:profileId/dry-run-create` | Build and validate a create payload without an external write |
| `POST` | `/api/integrations/trackers/profiles/:profileId/create`         | Create a work item after explicit approval                    |
| `GET`  | `/api/integrations/trackers/audits`                             | List metadata-only sync audit events                          |

### Introspect Schema

```
POST /api/integrations/trackers/introspect
```

**Body**:

```json
{
  "provider": "mock",
  "project": "Veritas Kanban"
}
```

**Response** `200`: `ExternalTrackerSchema` with work item types, fields, planning paths, priorities, states, tags, assignees, capabilities, and redacted connection posture.

### Save Mapping Profile

```
PUT /api/integrations/trackers/profiles/default-mock-profile
```

**Body**:

```json
{
  "id": "default-mock-profile",
  "name": "Default Mock Tracker Mapping",
  "provider": "mock",
  "enabled": true,
  "defaultWorkItemType": "Task",
  "defaultProjectPath": "Veritas Kanban",
  "defaultAreaPath": "Veritas Kanban\\Platform",
  "defaultIterationPath": "Veritas Kanban\\Next",
  "fieldMappings": [
    { "trackerFieldId": "System.Title", "source": "title", "required": true },
    { "trackerFieldId": "System.Description", "source": "description" },
    { "trackerFieldId": "Microsoft.VSTS.Common.Priority", "source": "priority" },
    { "trackerFieldId": "System.State", "source": "status" },
    { "trackerFieldId": "System.Tags", "source": "literal", "literalValue": "veritas" }
  ],
  "backlinkFieldId": "Custom.VeritasBacklink"
}
```

Invalid work item types, planning paths, tracker field ids, and required-field gaps return `400 VALIDATION_ERROR`.

### Dry-run Create

```
POST /api/integrations/trackers/profiles/default-mock-profile/dry-run-create
```

**Body**:

```json
{
  "taskId": "task_20260626_tracker"
}
```

**Response** `200`: `ExternalTrackerDryRunCreateResult` with `externalWrite: false`, the mapped payload, and validation errors/warnings.

### Approved Create

```
POST /api/integrations/trackers/profiles/default-mock-profile/create
```

**Body**:

```json
{
  "taskId": "task_20260626_tracker",
  "approvedBy": "brad"
}
```

Successful creates return `201`, append an `externalWorkItems` backlink to the task, and write metadata-only audit/activity events. Credential values and private payload content are not logged.

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

| Mount                            | Purpose                                                                  |
| -------------------------------- | ------------------------------------------------------------------------ |
| `/api/projects`                  | Project CRUD                                                             |
| `/api/sprints`                   | Sprint management                                                        |
| `/api/backlog`                   | Backlog operations                                                       |
| `/api/agents`                    | Agent CRUD, routing                                                      |
| `/api/agents/register`           | Agent self-registration                                                  |
| `/api/agents/permissions`        | Agent permission management                                              |
| `/api/templates`                 | Task templates                                                           |
| `/api/task-types`                | Custom task type definitions                                             |
| `/api/activity`                  | Activity feed                                                            |
| `/api/notifications`             | User notifications                                                       |
| `/api/broadcasts`                | Broadcast messages                                                       |
| `/api/changes`                   | Efficient agent polling (change feed)                                    |
| `/api/diff`                      | Task diff comparisons                                                    |
| `/api/automation`                | Automation rules                                                         |
| `/api/summary`                   | Board summaries                                                          |
| `/api/github`                    | GitHub integration                                                       |
| `/api/integrations/trackers`     | External tracker schema introspection and mapping profiles               |
| `/api/conflicts`                 | Merge conflict detection                                                 |
| `/api/watcher-policies`          | Agent continuation guardrail decisions                                   |
| `/api/metrics`                   | Prometheus-style metrics                                                 |
| `/api/traces`                    | Distributed tracing                                                      |
| `/api/cost-prediction`           | Token cost forecasting                                                   |
| `/api/errors`                    | Error pattern learning                                                   |
| `/api/reflections`               | Reviewed reflection-to-memory promotion                                  |
| `/api/reports`                   | Generated reports                                                        |
| `/api/deliverables`              | Scheduled deliverables                                                   |
| `/api/doc-freshness`             | Documentation freshness tracking                                         |
| `/api/docs`                      | Docs endpoint                                                            |
| `/api/shared-resources`          | Shared resource management                                               |
| `/api/status-history`            | Task status history                                                      |
| `/api/digest`                    | Digest generation                                                        |
| `/api/audit`                     | Audit log                                                                |
| `/api/lessons`                   | Lessons learned                                                          |
| `/api/delegation`                | Task delegation                                                          |
| `/api/workflows`                 | Workflow engine ([details](API-WORKFLOWS.md))                            |
| `/api/ceremonies`                | Design-review and failure-retrospective requirements                     |
| `/api/tool-policies`             | Tool access policies                                                     |
| `/api/sandbox-policies`          | Agent sandbox policy presets                                             |
| `/api/integrations`              | External integrations, outbound delivery audit, and human reply adapters |
| `/api/settings/transition-hooks` | Status transition hooks                                                  |

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

Query params: `agent`, `taskId`, `minConfidence` (0–100), `maxConfidence` (0–100), `minRisk` (0–100), `maxRisk` (0–100), `startTime`, `endTime`.

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

#### Decision Review Sessions

Task-launched review sessions capture independent participant responses, ordered critique rounds, and a final packet linked to a versioned work product plus a decision audit record.

| Method | Path                                   | Description                                           |
| ------ | -------------------------------------- | ----------------------------------------------------- |
| `GET`  | `/api/decisions/reviews?taskId=<id>`   | List decision review sessions                         |
| `POST` | `/api/decisions/reviews`               | Start a review session with at least two participants |
| `GET`  | `/api/decisions/reviews/:id`           | Get a review session                                  |
| `POST` | `/api/decisions/reviews/:id/responses` | Record an independent initial response                |
| `POST` | `/api/decisions/reviews/:id/critiques` | Record a participant critique round                   |
| `POST` | `/api/decisions/reviews/:id/finalize`  | Create the final packet, work product, and decision   |
| `POST` | `/api/decisions/reviews/:id/cancel`    | Cancel a review session                               |
| `GET`  | `/api/decisions/reviews/:id/export`    | Export the session packet as Markdown                 |

```json
{
  "taskId": "task_20260618_abc",
  "title": "Release readiness approach",
  "prompt": "Should we cut v5.1 after the remaining PRs merge?",
  "context": "Open issues require docs, packaging, and tap validation.",
  "rounds": 1,
  "participants": [
    { "id": "architect", "label": "Architect", "model": "gpt-5" },
    { "id": "qa-reviewer", "label": "QA Reviewer", "profileId": "qa-reviewer" }
  ]
}
```

---

### Ceremony Requirements (`/api/ceremonies`)

Ceremony requirements are durable review records created by enforcement gates or
operators. They link back to tasks, runs, workflows, pull requests, or CI runs.

| Method | Path                           | Description                             | Permissions      |
| ------ | ------------------------------ | --------------------------------------- | ---------------- |
| `GET`  | `/api/ceremonies`              | List ceremony requirements              | `workflow:read`  |
| `POST` | `/api/ceremonies`              | Create a ceremony requirement           | `workflow:write` |
| `POST` | `/api/ceremonies/:id/complete` | Complete a pending ceremony requirement | `workflow:write` |

#### List Ceremony Requirements

```
GET /api/ceremonies?status=pending&kind=design_review&taskId=task_123&limit=20
```

Query params: `status`, `kind`, `taskId`, `limit`.

#### Create Ceremony Requirement

```json
{
  "kind": "design_review",
  "enforcementMode": "block",
  "reason": "Task coordinates multiple agents.",
  "target": { "taskId": "task_20260626_review" },
  "trigger": "manual",
  "requiredArtifacts": ["decision-packet", "risk-list", "action-items"]
}
```

#### Complete Ceremony Requirement

```json
{
  "completedBy": "brad",
  "artifacts": [
    {
      "kind": "decision-packet",
      "title": "Design review notes",
      "body": "Reviewed scope, risks, rollback, and follow-up actions."
    }
  ],
  "actionItems": [
    {
      "title": "Track hardening follow-up",
      "priority": "high",
      "issueUrl": "https://github.com/BradGroux/veritas-kanban/issues/123"
    }
  ]
}
```

`completedBy` defaults to the authenticated actor when omitted. Completion keeps
the record for audit and satisfies future blocking evaluations for the same task
and ceremony kind.

---

### Governance Decision Traces (`/api/governance/traces`)

Inspect policy, tool-policy, sandbox-policy, budget-policy, agent-permission,
routing, workflow-gate, and ceremony decisions with evaluated rules, matched
rules, remediation, and redacted raw detail.

#### List Governance Traces

```
GET /api/governance/traces
```

Query params: `kind`, `outcome`, `agent`, `taskId`, `actionType`, `startTime`, `endTime`, `limit`.

`kind` values: `policy`, `tool-policy`, `sandbox-policy`, `budget-policy`, `agent-permission`, `routing`, `workflow-gate`, `ceremony`.

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
does not delete data. When SQLite is active, the response also includes the
optional `sqlite` posture object documented under [Health](#health).

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

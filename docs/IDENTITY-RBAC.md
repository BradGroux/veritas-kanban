# v5 Identity, Workspace, and RBAC Model

Status: planned for v5.0-alpha.1
Issue: [#334](https://github.com/BradGroux/veritas-kanban/issues/334)

## Purpose

Veritas Kanban v5 needs a multi-user identity and authorization model that works
in three operating modes:

- local single-user desktop mode
- LAN or self-hosted server mode
- mobile or remote clients paired to a trusted server

The model must keep first-run local use simple while giving remote/server mode
real user accounts, workspaces, memberships, scoped API keys, agent identities,
auditable actor attribution, and route-level plus entity-level permissions.

## Design Principles

1. Local-first stays frictionless. A fresh local install seeds `local` and
   `local-user`, and the owner can continue using password auth or an admin key.
2. Remote/server mode never relies on localhost bypass. Every request is tied to
   a human session, device session, service token, or agent token.
3. Human sessions and agent API keys are separate principals. Agents cannot use
   browser session endpoints and humans cannot inherit agent tool scopes.
4. Authorization is workspace-scoped by default. Cross-workspace reads and writes
   require explicit owner/admin permission.
5. Every state change records an actor, auth method, workspace, and request id.
6. Existing v4/v5 local auth continues to boot. Migration tightens defaults
   without invalidating local boards.

## Identity Model

### Actors

| Actor type         | Principal id          | Auth method                                         | Typical use                                           |
| ------------------ | --------------------- | --------------------------------------------------- | ----------------------------------------------------- |
| `user`             | `users.id`            | password session, future SSO subject, recovery flow | Browser, desktop, or mobile human user.               |
| `agent`            | `agent_identities.id` | scoped agent API token                              | OpenClaw, local Codex, workflow workers, MCP clients. |
| `service`          | `api_tokens.id`       | scoped service API token                            | Dashboards, webhooks, import/export jobs.             |
| `system`           | `system`              | internal                                            | Migrations, retention jobs, scheduled cleanup.        |
| `localhost-bypass` | `localhost-bypass`    | development bypass only                             | Local development compatibility, never remote/server. |

`req.auth` should evolve from a role-only object into an actor context:

```ts
interface AuthContext {
  actorType: 'user' | 'agent' | 'service' | 'system' | 'localhost-bypass';
  actorId: string;
  displayName: string;
  workspaceId: string;
  role: WorkspaceRole;
  permissions: Permission[];
  authMethod: 'session' | 'api-token' | 'recovery' | 'localhost-bypass' | 'system';
  sessionId?: string;
  tokenId?: string;
  isLocalhost: boolean;
}
```

### Core Tables

The existing SQLite foundation already seeds `workspaces`, `users`, and
`workspace_memberships`. The v5 multi-user migration should extend that
foundation instead of replacing it.

```sql
ALTER TABLE users ADD COLUMN handle TEXT;
ALTER TABLE users ADD COLUMN auth_subject TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN disabled_at TEXT;
ALTER TABLE users ADD COLUMN last_seen_at TEXT;

ALTER TABLE workspaces ADD COLUMN mode TEXT NOT NULL DEFAULT 'local';
ALTER TABLE workspaces ADD COLUMN created_by TEXT;
ALTER TABLE workspaces ADD COLUMN archived_at TEXT;

ALTER TABLE workspace_memberships ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE workspace_memberships ADD COLUMN invited_by TEXT;
ALTER TABLE workspace_memberships ADD COLUMN joined_at TEXT;
ALTER TABLE workspace_memberships ADD COLUMN disabled_at TEXT;
```

Role values must expand from the current `owner/admin/member/viewer` seed check
to the v5 set:

```text
owner, admin, member, reviewer, read-only, agent
```

`viewer` is a legacy synonym and must be migrated to `read-only`.

Additional tables:

```sql
CREATE TABLE workspace_invitations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT,
  role TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_by TEXT REFERENCES users(id),
  accepted_at TEXT,
  revoked_at TEXT
);

CREATE TABLE device_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  device_name TEXT,
  device_type TEXT NOT NULL DEFAULT 'browser',
  session_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE agent_identities (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  default_role TEXT NOT NULL DEFAULT 'agent',
  description TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled_at TEXT,
  UNIQUE (workspace_id, slug)
);

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('agent', 'service')),
  actor_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  allowed_routes_json TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT
);

CREATE TABLE permission_overrides (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'agent', 'service')),
  subject_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  permission TEXT NOT NULL,
  effect TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
  reason TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT
);
```

Indexes:

```sql
CREATE INDEX idx_workspace_memberships_user_status
  ON workspace_memberships(user_id, status);

CREATE INDEX idx_workspace_invitations_workspace_email
  ON workspace_invitations(workspace_id, email, revoked_at, accepted_at);

CREATE INDEX idx_device_sessions_user_workspace
  ON device_sessions(user_id, workspace_id, revoked_at, expires_at);

CREATE INDEX idx_agent_identities_workspace_enabled
  ON agent_identities(workspace_id, disabled_at);

CREATE INDEX idx_api_tokens_workspace_actor
  ON api_tokens(workspace_id, actor_type, actor_id, revoked_at);

CREATE INDEX idx_permission_overrides_subject
  ON permission_overrides(workspace_id, subject_type, subject_id, resource_type);
```

## Roles

| Role        | Human session | Agent token           | Scope                                                                                                                                          |
| ----------- | ------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `owner`     | Yes           | No                    | Full workspace control, ownership transfer, recovery, billing/release settings, destructive admin operations.                                  |
| `admin`     | Yes           | No                    | Workspace administration, user invites, settings, integrations, agents, workflows, policies, import/export. Cannot remove last owner.          |
| `member`    | Yes           | No                    | Board work: create/update tasks, comments, work products, workflow runs, and non-admin automation.                                             |
| `reviewer`  | Yes           | No                    | Review work: read board, comment, approve gates, QA tasks, generate reports. No broad task mutation except review fields.                      |
| `read-only` | Yes           | Service token allowed | Read board, reports, metrics, activity, and docs. No writes.                                                                                   |
| `agent`     | No            | Yes                   | Scoped automation writes. Can mutate assigned tasks, run allowed workflows, post chat/status, and upload allowed artifacts. No admin settings. |

`admin` is not a synonym for `owner`. Operations that can permanently lock out a
workspace require `owner`.

## Permission Vocabulary

Permissions are expressed as `resource:action`.

Resources:

```text
workspace, user, membership, invitation, session, token,
board, task, comment, work_product, workflow, workflow_run,
agent, git, policy, setting, integration, report, telemetry,
audit, backup, maintenance, admin
```

Actions:

```text
read, create, update, delete, execute, approve, export, import, manage
```

Examples:

```text
task:update
workflow_run:execute
token:manage
backup:export
policy:manage
```

### Role Permission Baseline

| Permission group                     | owner | admin | member | reviewer           | read-only | agent  |
| ------------------------------------ | ----- | ----- | ------ | ------------------ | --------- | ------ |
| Workspace read                       | yes   | yes   | yes    | yes                | yes       | scoped |
| Workspace settings manage            | yes   | yes   | no     | no                 | no        | no     |
| Users/memberships/invitations manage | yes   | yes   | no     | no                 | no        | no     |
| Device sessions revoke               | yes   | yes   | own    | own                | own       | no     |
| API tokens create/revoke             | yes   | yes   | no     | no                 | no        | no     |
| Board/tasks read                     | yes   | yes   | yes    | yes                | yes       | scoped |
| Tasks create/update/delete           | yes   | yes   | yes    | review-only        | no        | scoped |
| Comments/chat create                 | yes   | yes   | yes    | yes                | no        | scoped |
| Work products create/update/export   | yes   | yes   | yes    | review/export only | no        | scoped |
| Workflow definitions manage          | yes   | yes   | no     | no                 | no        | no     |
| Workflow runs execute/control        | yes   | yes   | yes    | approve only       | no        | scoped |
| Gate approvals/QA                    | yes   | yes   | yes    | yes                | no        | scoped |
| Agent registry/routing manage        | yes   | yes   | no     | no                 | no        | no     |
| Git operations                       | yes   | yes   | yes    | no                 | no        | scoped |
| Policies/tool policies manage        | yes   | yes   | no     | no                 | no        | no     |
| Reports/metrics read                 | yes   | yes   | yes    | yes                | yes       | scoped |
| Audit read/export                    | yes   | yes   | no     | no                 | no        | no     |
| Backup/import/export                 | yes   | yes   | no     | no                 | no        | no     |
| Maintenance cleanup                  | yes   | yes   | no     | no                 | no        | no     |
| Ownership transfer/delete workspace  | yes   | no    | no     | no                 | no        | no     |

## Route Permission Matrix

The current API has coarse global auth and `authorizeWrite`. v5 should move to
route metadata that declares the required permission, then a shared authorization
middleware should enforce it against the actor context.

| Route family                                                                                             | Read permission                  | Write/control permission                                                                   | Notes                                                                             |
| -------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `/api/auth/status`, `/api/auth/setup`, `/api/auth/login`, `/api/auth/recover`                            | public with rate limits          | public with rate limits                                                                    | Setup only when no owner exists. Recover requires recovery key.                   |
| `/api/auth/logout`, `/api/auth/change-password`, `/api/auth/sessions`                                    | `session:read`                   | `session:manage`                                                                           | Users manage their own sessions; admins can revoke workspace sessions.            |
| `/api/tasks`, `/api/backlog`, `/api/tasks/:id/*`                                                         | `task:read`                      | `task:create`, `task:update`, `task:delete`                                                | Entity checks apply for assigned agents and review-only mutation.                 |
| `/api/tasks/:id/comments`, `/api/chat`, `/api/squad`                                                     | `comment:read`                   | `comment:create`, `comment:delete`                                                         | Agent tokens can post only as their agent identity.                               |
| `/api/tasks/:id/work-products`, `/api/work-products`                                                     | `work_product:read`              | `work_product:create`, `work_product:update`, `work_product:delete`, `work_product:export` | Export defaults must apply redaction by role.                                     |
| `/api/workflows`                                                                                         | `workflow:read`                  | `workflow:create`, `workflow:update`, `workflow:delete`                                    | Definition writes are admin by default unless explicitly delegated.               |
| `/api/workflows/runs`, `/api/automation`, `/api/deliverables`                                            | `workflow_run:read`              | `workflow_run:execute`, `workflow_run:update`, `workflow_run:delete`                       | Agents require token scopes for specific workflow IDs or task IDs.                |
| `/api/agents`, `/api/agents/register`, `/api/agents/permissions`, `/api/agents/routing`                  | `agent:read`                     | `agent:manage`                                                                             | Agent self-heartbeat is allowed only for matching agent token.                    |
| `/api/github`, `/api/diff`, `/api/preview`                                                               | `git:read`                       | `git:execute`                                                                              | Diff/preview reads are allowed to members; branch/PR mutation needs scoped write. |
| `/api/settings`, `/api/config`, `/api/integrations`, `/api/hooks`                                        | `setting:read`                   | `setting:manage`, `integration:manage`                                                     | Secrets remain redacted unless owner/admin requests a reveal workflow.            |
| `/api/policies`, `/api/tool-policies`, `/api/delegation`                                                 | `policy:read`                    | `policy:manage`                                                                            | Policy writes are admin-only.                                                     |
| `/api/metrics`, `/api/analytics`, `/api/reports`, `/api/summary`, `/api/activity`, `/api/status-history` | `report:read`                    | `report:export` or `maintenance:manage`                                                    | Deletes and retention controls are admin-only.                                    |
| `/api/telemetry`, `/api/traces`, `/api/audit`                                                            | `telemetry:read` or `audit:read` | `telemetry:create`, `audit:export`                                                         | Agent telemetry writes require token scope. Audit records are append-only.        |
| `/api/sqlite/*`                                                                                          | `backup:read`                    | `backup:export`, `backup:import`, `admin:manage`                                           | Migration/import are owner/admin only and must emit audit entries.                |
| `/api/search`, `/api/docs`, `/api/doc-freshness`                                                         | `board:read`                     | `setting:manage` or `maintenance:manage`                                                   | Search results are filtered by entity permissions.                                |
| `/api/health`, `/api/health/live`, `/api/health/ready`                                                   | public                           | none                                                                                       | Deep diagnostics require `admin:manage`.                                          |
| `/api/webhooks/*`                                                                                        | token-specific                   | token-specific                                                                             | Webhooks use signed/shared secrets and map to service actors.                     |

## Entity-Level Rules

Route authorization is necessary but not sufficient. Repository and service
methods should enforce entity-level checks before returning rows or mutating
state.

| Entity                 | Rule                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Workspace              | Actor must have an active membership or token for the workspace.                                                                           |
| Task                   | Humans can access workspace tasks by role. Agent tokens can access assigned tasks, workflow task context, or tasks allowed by token scope. |
| Backlog/archive        | Same as task rules. Archive restore/delete require `task:update` or `task:delete`.                                                         |
| Comment/chat message   | Inherits task/session access. Delete requires author, admin, or owner.                                                                     |
| Work product           | Inherits source task/run access. Redaction level depends on role and export permission.                                                    |
| Workflow definition    | Read requires workspace access. Mutation requires `workflow:*` admin permission unless owner/admin grants an override.                     |
| Workflow run           | Inherits workflow plus source task access. Agents can control only runs they own or are assigned to.                                       |
| Attachment/deliverable | Inherits task access. Delete requires uploader, task write permission, admin, or retention cleanup.                                        |
| Settings/integration   | Read is redacted by default. Secret reveal is owner-only and should be avoided where possible.                                             |
| Audit/telemetry        | Raw records are owner/admin only. Aggregates may be visible to read/report roles after redaction.                                          |

Repository methods should accept `AuthContext` or a narrowed
`AuthorizationSubject` instead of relying on global `local` filters once #335 and
#336 begin implementation.

## Localhost Bypass

Current behavior:

- `VERITAS_AUTH_LOCALHOST_BYPASS=true` can allow localhost requests outside
  production.
- `VERITAS_AUTH_LOCALHOST_ROLE` defaults to `read-only`.
- Production disables bypass in code.

v5 behavior:

| Mode                  | Localhost bypass                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| Local development     | Allowed only when explicitly enabled. Default role remains `read-only`.                         |
| Desktop local app     | Avoid bypass by default. The desktop shell should use a local session or keychain-backed token. |
| LAN/server            | Disabled. Startup should warn if bypass env vars are present.                                   |
| Mobile/remote pairing | Disabled. Pairing creates device sessions, not bypass grants.                                   |
| Production            | Disabled unconditionally.                                                                       |

Remote/server mode should expose an auth diagnostic that reports bypass as
`disabled_by_mode` rather than merely echoing environment values.

## Agent API Keys

Agent keys are not human sessions.

Rules:

- Stored only as hashes in `api_tokens.token_hash`.
- Bound to `actor_type = 'agent'` and an `agent_identities.id`.
- Include `workspace_id`, `scopes_json`, optional `allowed_routes_json`, expiry,
  and revocation timestamps.
- Cannot call password, recovery, invitation, session, or membership endpoints.
- Cannot create new API tokens.
- Cannot change settings, integrations, policies, or role assignments.
- Can write telemetry, status, chat, task updates, work products, and workflow
  progress only when the token scope allows the target task/workflow.
- Must record `tokenId` and `actorId` on audit, activity, status history, task
  history, workflow runs, work products, and telemetry.

Example scopes:

```json
{
  "tasks": ["read", "update", "comment"],
  "workflowRuns": ["read", "execute", "update"],
  "workProducts": ["create", "update", "export-redacted"],
  "telemetry": ["create"],
  "constraints": {
    "taskIds": ["VK-123"],
    "workflowIds": ["qa-review"],
    "expiresAt": "2026-06-30T00:00:00.000Z"
  }
}
```

## Actor Attribution

Every write path must emit enough actor data to reconstruct who or what changed
the system. Store normalized IDs for joins and denormalized display values for
durable history.

Required fields for new audit/activity/task-history/workflow records:

| Field                | Description                                                          |
| -------------------- | -------------------------------------------------------------------- |
| `workspace_id`       | Workspace where the action occurred.                                 |
| `actor_type`         | `user`, `agent`, `service`, `system`, or `localhost-bypass`.         |
| `actor_id`           | Stable user, agent, service token, or system id.                     |
| `actor_display_name` | Display value at write time.                                         |
| `actor_role`         | Effective role at write time.                                        |
| `auth_method`        | `session`, `api-token`, `recovery`, `localhost-bypass`, or `system`. |
| `session_id`         | Device/session id for human sessions.                                |
| `token_id`           | API token id for agent/service tokens.                               |
| `request_id`         | Correlates API logs, audit entries, and telemetry.                   |
| `target_type`        | Entity type, such as task, workflow, policy, setting.                |
| `target_id`          | Entity id.                                                           |
| `redaction_level`    | `none`, `standard`, `sensitive`, or `secret-ref-only`.               |

For backward compatibility, old records without actor columns should render as:

```text
actor_type: system
actor_id: legacy-migration
actor_display_name: Legacy Migration
```

## Migration Plan

1. Keep the current `local` workspace and `local-user` seed records.
2. Expand role constraints and migrate `viewer` memberships to `read-only`.
3. Add invitation, device session, agent identity, scoped API token, and
   permission override tables.
4. Convert `VERITAS_ADMIN_KEY` into an owner-capable service token at runtime.
   Do not persist plaintext env keys. If imported into SQLite, store only a
   token hash and mark `source = env`.
5. Convert `VERITAS_API_KEYS=name:key:role` entries into scoped `api_tokens`.
   Role mapping:
   - `admin` -> service token with admin permissions
   - `agent` -> agent identity plus scoped agent token
   - `read-only` -> service token with read/report scopes
6. Preserve password auth and recovery key behavior for the initial owner.
7. Add `AuthContext` to HTTP and WebSocket authentication.
8. Add route permission metadata and enforce role permissions.
9. Add entity-level repository checks for workspace, task, workflow, and work
   product access.
10. Emit actor attribution for all new writes. Keep legacy rows readable.
11. Add admin diagnostics that flag unsafe remote/server auth configuration.

Rollback expectation:

- New tables can remain unused if remote/server mode is disabled.
- Existing local password and env-key auth must still work after rollback to
  single-user behavior.
- Token imports from env are repeatable because token hashes are unique and env
  source records can be upserted.

## UX Flows

### First-Run Local Mode

1. User opens the desktop or local web app.
2. App seeds `local` workspace and `local-user` owner if missing.
3. If no password exists, setup asks for an owner password and shows the recovery
   key once.
4. The user lands on the board without choosing a workspace.
5. Settings shows "Local workspace" and a path to enable server mode later.

### Upgrade Local Board to Server Mode

1. Owner opens Settings -> Access.
2. App shows current auth risks: localhost bypass, weak admin key, missing HTTPS,
   unrotated env API keys.
3. Owner chooses "Enable server mode".
4. App disables bypass, requires an owner password, creates a server workspace
   mode flag, and prompts for HTTPS/reverse-proxy guidance.
5. App offers to migrate env API keys into hashed scoped tokens.
6. Audit records the mode change and token migration.

### Invite a Human User

1. Owner/admin enters email or local username and selects a role.
2. App creates `workspace_invitations` with a hashed token and expiry.
3. Invitee accepts, sets password if needed, and joins as an active membership.
4. Audit records invitation created, accepted, and role assigned.

### Create an Agent Token

1. Owner/admin creates or selects an agent identity.
2. Owner/admin chooses task/workflow scopes and expiry.
3. App shows the plaintext token once.
4. Token hash, scopes, creator, and expiry are stored.
5. Agent requests include the token and resolve to `actor_type = agent`.

### Mobile or Remote Device Pairing

1. Owner/admin enables remote pairing for a workspace.
2. Device completes login or pairing challenge.
3. App creates a `device_sessions` row with device metadata and expiry.
4. Session can be revoked by the user, admin, or owner.
5. Remote requests are never treated as localhost bypass.

### Lost Admin Recovery

1. User chooses recovery.
2. Recovery key verifies against the stored recovery hash.
3. App rotates the password and invalidates device sessions.
4. Owner membership is preserved; recovery cannot create a second owner unless
   no active owner exists.
5. Audit records recovery without storing the recovery key.

## Implementation Checklist

- [ ] Add schema migration for role expansion, invitations, device sessions,
      agent identities, API tokens, and permission overrides.
- [ ] Replace role-only auth with `AuthContext` for HTTP and WebSocket requests.
- [ ] Add route permission metadata and a shared permission middleware.
- [ ] Add entity-level permission checks in storage/service layers.
- [ ] Add actor attribution to write paths and audit/activity records.
- [ ] Add user/workspace/member/token management APIs.
- [ ] Add UX for first-run owner setup, workspace access, invitations, sessions,
      and agent tokens.
- [ ] Add tests for local compatibility, remote bypass rejection, role matrix,
      agent token scope enforcement, and audit attribution.

## Out of Scope

- External SSO provider implementation.
- Billing or organization hierarchy.
- Per-field permissions beyond redaction and secret reference rules.
- Public unauthenticated boards.

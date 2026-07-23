# Veritas Kanban Server - Security Guide

## Overview

The Veritas Kanban server includes a flexible authentication and authorization system to protect API endpoints and WebSocket connections from unauthorized access.

## Quick Start

### Development (Localhost Bypass)

For local development, enable localhost bypass:

```bash
# .env
VERITAS_AUTH_ENABLED=true
VERITAS_AUTH_LOCALHOST_BYPASS=true
```

This allows unauthenticated requests from `localhost`/`127.0.0.1` while still requiring auth for remote connections during development.
In `NODE_ENV=production`, localhost bypass is not honored for HTTP or WebSocket
auth, even if an old `.env` file still enables it.

### Production

For production, configure API keys:

```bash
# .env
VERITAS_AUTH_ENABLED=true
VERITAS_AUTH_LOCALHOST_BYPASS=false
VERITAS_ADMIN_KEY=your-secure-admin-key
VERITAS_API_KEYS=agent1:key1:agent,dashboard:key2:read-only
```

### Remote/Server Mode

Remote access must follow the v5 remote security posture in
[ADR 0002](architecture/ADR-0002-v5-remote-server-security-posture.md). In
short: prefer one trusted origin for the web client, `/api`, and `/ws`; keep
auth enabled; disable localhost bypass outside loopback; use HTTPS, VPN, or a
trusted tunnel for browser/mobile sessions; and use exact origins instead of
wildcard CORS.

## Authentication Methods

Clients can authenticate using any of these methods:

### 1. Authorization Header (Recommended)

```bash
curl -H "Authorization: Bearer your-api-key" \
  http://localhost:3001/api/tasks
```

### 2. X-API-Key Header

```bash
curl -H "X-API-Key: your-api-key" \
  http://localhost:3001/api/tasks
```

### 3. Query Parameter (WebSocket)

```javascript
const ws = new WebSocket('ws://localhost:3001/ws?api_key=your-api-key');
```

HTTP requests do not accept API keys in query strings. Use headers for HTTP and
reserve the WebSocket `api_key` query fallback for clients that cannot send auth
headers during the upgrade.

## Roles and Permissions

> v5 planning note: the current role model is intentionally small. The planned
> multi-user model expands this into workspace-scoped `owner`, `admin`,
> `member`, `reviewer`, `read-only`, and `agent` roles with scoped agent tokens.
> See [v5 Identity, Workspace, and RBAC Model](IDENTITY-RBAC.md).

| Role        | Read | Write | Admin Actions |
| ----------- | ---- | ----- | ------------- |
| `admin`     | ✅   | ✅    | ✅            |
| `agent`     | ✅   | ✅    | ❌            |
| `read-only` | ✅   | ❌    | ❌            |

### Role Details

- **admin**: Full access to all endpoints including sensitive operations
- **agent**: Can read/write tasks, run agents, manage worktrees. Intended for AI agents like [OpenClaw](https://github.com/openclaw/openclaw)
- **read-only**: Can perform read endpoints, including documented read-like POST
  checks. Suitable for dashboards and monitoring

Agent self-service routes are still permission-scoped. Read-like checks such as
agent routing and permission checks require `agent:read`; approval requests
require `task:write`; approval review, routing configuration, and permission
elevation require `admin:manage`.

### v5 Auth Context

Authenticated REST requests and WebSocket connections now carry a shared auth
context for the v5 RBAC migration:

| Field         | Description                                                               |
| ------------- | ------------------------------------------------------------------------- |
| `role`        | Current compatibility role: `admin`, `agent`, `read-only`                 |
| `userId`      | Local fallback user ID until persisted users are enforced                 |
| `workspaceId` | Local fallback workspace ID until workspace scoping lands                 |
| `actorType`   | `user`, `agent`, `service`, or `localhost-bypass`                         |
| `authMethod`  | `disabled`, `session`, `api-key`, `device-session`, or `localhost-bypass` |
| `tokenName`   | API key name when authenticated with a configured key                     |
| `permissions` | Role-derived permission list used by new route guards                     |

New v5 endpoints should prefer explicit permission guards over broad role
checks. Legacy role guards remain supported while route coverage is migrated.

Browser password sessions are local-owner only in v5 GA. The server accepts the
session cookie only on loopback requests with loopback `Host`/`Origin`/`Referer`
metadata. A verified loopback owner session receives the narrow
`local-agent:run` capability so the packaged desktop can start and control local
agents; this does not enable unauthenticated localhost bypass, which remains
disabled in production. Remote, server, PWA, and multi-user clients must
authenticate with a trusted device session or scoped API token so active
workspace membership, role, revocation, and downgraded scopes are revalidated.

The v5 authority surface is tracked in
[`docs/security/permission-coverage.json`](security/permission-coverage.json).
Run `node scripts/check-permission-coverage.mjs` to fail when a REST route
prefix, WebSocket event, CLI command, MCP tool, workflow step/action type,
command palette action, or tracked background job is added without a permission
classification.

The v5.0 hardening review is recorded in
[`docs/security/v5-security-review.md`](security/v5-security-review.md),
including fixed high/critical findings, accepted hardening risks, and the
password-session local-owner boundary.

Release compatibility, stale-client behavior, update channels, and rollback
limits are tracked in
[`docs/V5-COMPATIBILITY-AND-RELEASE-POLICY.md`](V5-COMPATIBILITY-AND-RELEASE-POLICY.md).
Compatibility errors and debug bundles must redact tokens, cookies, private
keys, local private paths, raw chat content, and task body text.

## Provider Runtime Capability Enforcement

Provider runtime manifests are authorization evidence, not display metadata.
The server validates their complete capability inventory, canonical SHA-256
digest, probe state, and secret redaction before use. Launch requirements and
run controls qualify only with `supported` or `advisory` evidence;
`unsupported`, `unknown`, missing, failed-probe, malformed, or invalid-digest
evidence fails closed.

The selected manifest is persisted on the attempt before provider execution.
Status, logs, completion, stop, message/steer, token reporting, tool events, and
artifact ingestion compare the active snapshot with the persisted digest before
acting. A mismatch stops provider event ingestion and requires the operator to
terminate the detached provider through its host supervisor, reconcile attempt
state, and launch a fresh run. Veritas does not offer a UI force-stop that
bypasses runtime evidence.

Public sandbox dry-runs accept a live registered manifest digest, not a
caller-supplied manifest body. The server resolves the digest from current host
registrations and rejects unknown, expired, or provider-mismatched evidence.
Human Veritas approval gates remain separate from provider-native
`run.approvals`; one does not imply the other. Shared co-drive links are pinned
to their source attempt. Message and approval actions require that exact attempt
to remain active and require current `run.steer` or `run.approvals` evidence, so
an old link cannot control a replacement run on the same task.

## Agent Sandbox Policies

Agent sandbox policy presets live in the shared app config and are managed from
**Settings -> Agents -> Sandbox Policies** or `/api/sandbox-policies`.

Use them to constrain:

- Filesystem read/write paths, denied paths, dotfile masking, and local-only handles.
- Network egress defaults, allowlisted hosts and path prefixes, and private network or metadata endpoint blocks.
- Environment variable passthrough.
- Credential access mode: none, brokered references, or explicit environment passthrough.

Launch-time validation resolves every preset rule from the persisted provider
runtime manifest. Required unsupported controls block the agent or workflow
step before execution. Advisory unsupported controls continue with warnings.
Every dry-run and launch-time decision writes a governance trace with raw
detail redacted; credential references and environment-style `name=value`
strings are shown as `[redacted]`.

### Credential broker core

Credential definitions are stored separately from secret values. An admin can
register a source reference and bounded host/tool/destination/action policy at
`/api/credential-broker`; the stored `credential-definition/v1` record contains
only metadata and a canonical digest.

Internal consumers can issue an opaque `credential-lease/v1` handle only when
the referenced definition appears in the active attempt's immutable launch
manifest. The lease is bound to that task, attempt, manifest digest, definition
digest, scope digest, and exact action fingerprint. Handles are persisted only
as SHA-256 hashes. Uses are claimed atomically before source resolution and
enforce TTL, maximum uses, approval posture, and current run binding.

The resolved value is passed only to a controlled in-process callback. The
broker rejects callbacks that return the value and replaces callback/source
errors with credential-free failures. Definitions, leases, audit events, logs,
manifests, completion packets, and API responses never contain the resolved
value. Terminal run paths revoke matching leases, and startup reconciliation
expires stale leases or blocks leases whose source is unavailable.

This is a foundation, not a claim that provider traffic is controlled.
Required brokered presets fail closed when runtime evidence is advisory,
external, missing, or bypassable. Provider handle migration requires the
controlled network or tool boundaries documented in
[Credential Broker](CREDENTIAL-BROKER.md). Raw `env-passthrough` remains an
explicit compatibility mode and is not brokered.

Agent budget policies are enforced through the same governance path. Workspace,
agent, workflow, workflow-agent, and per-run budgets can cap tokens,
provider-reported cost, tool-call counts, runtime, retry count, and workflow
fan-out. Soft thresholds write `budget-policy` warning traces. Hard thresholds
pause or block for approval, downgrade to a configured model route, or cancel
the run with recorded trace and completion-packet evidence.

For untrusted or externally sourced work, prefer a required preset with
repository-scoped writes, default-deny network egress, metadata endpoint
blocking, and brokered credentials. Keep the legacy permissive preset only for
existing local Codex CLI workflows that still need broad compatibility.

## Configuration Reference

### Environment Variables

| Variable                        | Default | Description                                             |
| ------------------------------- | ------- | ------------------------------------------------------- |
| `VERITAS_AUTH_ENABLED`          | `true`  | Enable/disable authentication                           |
| `VERITAS_AUTH_LOCALHOST_BYPASS` | `false` | Allow unauthenticated localhost requests in development |
| `VERITAS_ADMIN_KEY`             | (none)  | Admin API key with full access                          |
| `VERITAS_API_KEYS`              | (none)  | Comma-separated API keys (format: `name:key:role`)      |

### API Key Format

```
name:key:role,name2:key2:role2
```

Example:

```
veritas:vk_abc123xyz:agent,dashboard:vk_def456uvw:read-only
```

## Generating API Keys

### Using OpenSSL

```bash
# Generate a random 32-character key
openssl rand -base64 32
```

### Using the Built-in Function

```typescript
import { generateApiKey } from './middleware/auth.js';
const key = generateApiKey('vk'); // e.g., vk_AbCdEf123...
```

## API Endpoints

### Auth Status (Unauthenticated)

Check the current authentication configuration:

```bash
curl http://localhost:3001/api/auth/status
```

Response:

```json
{
  "enabled": true,
  "localhostBypass": false,
  "configuredKeys": 2,
  "hasAdminKey": true
}
```

### Health Check (Unauthenticated)

```bash
curl http://localhost:3001/health
```

## WebSocket Authentication

WebSocket connections are authenticated on connect:

```javascript
// With API key
const ws = new WebSocket('ws://localhost:3001/ws?api_key=your-key');

ws.onclose = (event) => {
  if (event.code === 4001) {
    console.error('Authentication failed:', event.reason);
  }
};
```

### WebSocket Close Codes

| Code   | Meaning                        |
| ------ | ------------------------------ |
| `1000` | Normal close                   |
| `4001` | Authentication required/failed |

## Error Responses

### 401 Unauthorized

```json
{
  "error": "Authentication required",
  "code": "AUTH_REQUIRED",
  "hint": "Provide API key via Authorization header (Bearer <key>), X-API-Key header, or api_key query parameter"
}
```

### 403 Forbidden

```json
{
  "error": "Write access denied",
  "code": "WRITE_FORBIDDEN",
  "hint": "Your API key has read-only access"
}
```

## Security Best Practices

1. **Never commit API keys** - Use environment variables or `.env` files (add to `.gitignore`)

2. **Rotate keys regularly** - Update API keys periodically, especially if compromised

3. **Use HTTPS in production** - API keys are transmitted in headers/URLs

4. **Principle of least privilege** - Use `read-only` for dashboards, `agent` for automation

5. **Monitor access** - The server logs connection attempts with role information

6. **Constrain agent launches** - Assign sandbox policy presets and run budgets
   before running untrusted or expensive work. Default-deny network egress,
   broker credentials, and cap token, spend, tool-call, runtime, retry, and
   fan-out exposure when a workflow does not need broad access.

7. **Keep remote mode explicit** - Binding outside loopback, reverse proxying,
   tunneling, or serving mobile/PWA clients requires auth enabled, localhost
   bypass disabled, exact CORS/WebSocket origins, and redacted diagnostics. See
   [ADR 0002](architecture/ADR-0002-v5-remote-server-security-posture.md).

## Migrating from No Auth

If you're upgrading from an earlier version without authentication:

1. **Before upgrading**: Document all clients that access the API

2. **During upgrade**:
   - Start with `VERITAS_AUTH_LOCALHOST_BYPASS=true` for smooth transition
   - Generate API keys for each client
   - Update clients to include authentication headers

3. **After testing**: Disable localhost bypass for production

## Troubleshooting

### "Authentication required" for localhost

Check that `VERITAS_AUTH_LOCALHOST_BYPASS=true` is set, or provide an API key.

### "Invalid API key"

- Verify the key matches exactly (no extra spaces)
- Check that the key is in the `VERITAS_API_KEYS` or `VERITAS_ADMIN_KEY` variable
- Ensure the format is correct: `name:key:role`

### WebSocket immediately closes

- Check browser console for the close reason
- Ensure the API key is passed as a query parameter: `?api_key=...`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Request Flow                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Client Request                                             │
│       │                                                     │
│       ▼                                                     │
│  ┌──────────────┐                                          │
│  │ CORS/JSON    │ (express middleware)                     │
│  └──────────────┘                                          │
│       │                                                     │
│       ▼                                                     │
│  ┌──────────────┐   ┌───────────────────────┐              │
│  │ /health      │──▶│ Bypass auth           │              │
│  │ /api/auth/*  │   │ (unauthenticated)     │              │
│  └──────────────┘   └───────────────────────┘              │
│       │                                                     │
│       ▼                                                     │
│  ┌──────────────┐                                          │
│  │ authenticate │ (middleware/auth.ts)                     │
│  │              │                                          │
│  │ - Check auth │                                          │
│  │   enabled    │                                          │
│  │ - Localhost  │                                          │
│  │   bypass?    │                                          │
│  │ - Validate   │                                          │
│  │   API key    │                                          │
│  └──────────────┘                                          │
│       │                                                     │
│       ▼                                                     │
│  ┌──────────────┐                                          │
│  │ Route Handler│ (req.auth available)                     │
│  └──────────────┘                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Changelog

- **v3.3.0** (2026-02-15): Task intelligence security hardening
  - Crash-recovery checkpointing with auto-sanitization of 20+ secret patterns plus regex value detection
  - XSS prevention in observational memory via `sanitizeCommentText()`
  - DFS cycle detection in task dependencies prevents infinite loop attacks
  - Input sanitization on agent filter (trim + 100 char cap)
  - Zod validation on all dependency and checkpoint routes
- **v3.0.0** (2026-02-09): Workflow engine security
  - ReDoS protection on regex acceptance criteria
  - Expression injection prevention in template evaluator
  - Parallel DoS limits (max 50 concurrent sub-steps)
  - Gate approval authentication and permission checks
  - RBAC with ACL files for workflow access control
  - Audit logging of all workflow changes
- **v2.0.0** (2026-02-06): Multi-agent security
  - Agent permission levels (Intern/Specialist/Lead) with enforcement
  - Agent registry with heartbeat-based liveness tracking
  - MCP SDK patched to ^1.26.0 (GHSA-345p-7cg4-v4c7)
  - Rate limiting documentation (reverse proxy recommended for public deployments)
- **v1.0.0** (2026-01-29): Initial authentication implementation
  - API key authentication for HTTP and WebSocket
  - Role-based authorization (admin, agent, read-only)
  - Localhost bypass for development
  - Configuration via environment variables

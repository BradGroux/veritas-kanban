# SOP: Delegation Management

<!-- doc-freshness: 2026-03-21 | v4.0.0 | @tars -->

## Purpose

Configure and manage task delegation — temporarily routing new task assignments to a designated delegate agent when the primary agent is unavailable, overloaded, or explicitly stepping back. Delegation includes scope, exclusions, and automatic expiry.

## Prerequisites

- Veritas Kanban server running with admin API key configured
- Admin-level authentication (required for setting and revoking delegation)
- The delegate agent must be active and capable of handling delegated scope

## Concepts

| Term | Definition |
|------|------------|
| **Delegate agent** | The agent that receives tasks during the delegation period |
| **Expires** | ISO timestamp when delegation automatically ends (must be in the future) |
| **Scope** | Which task categories are delegated: `all`, `unassigned`, or `matching` (specific criteria) |
| **Exclude priorities** | Task priorities that are NOT delegated (e.g., don't delegate `critical` tasks) |
| **Exclude tags** | Task tags that are NOT delegated |

## Step-by-Step: Set Up Delegation

### 1. Check current delegation status

```bash
curl -s http://localhost:3001/api/delegation
```

Returns `{ "delegation": null }` if no delegation is active, or the current delegation object.

### 2. Configure delegation

> **Requires admin auth.** Include your admin API key in the `Authorization` header.

```bash
curl -s -X POST http://localhost:3001/api/delegation \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <your-admin-key>' \
  -d '{
    "delegateAgent": "CASE",
    "expires": "2026-03-22T09:00:00Z",
    "scope": "all",
    "excludePriorities": ["critical"],
    "excludeTags": ["security", "production"],
    "createdBy": "brad"
  }'
```

**Response:**
```json
{
  "delegation": {
    "id": "deleg_abc123",
    "delegateAgent": "CASE",
    "expires": "2026-03-22T09:00:00Z",
    "scope": "all",
    "excludePriorities": ["critical"],
    "excludeTags": ["security", "production"],
    "createdBy": "brad",
    "createdAt": "2026-03-21T17:00:00Z",
    "active": true
  }
}
```

**Validation:** If `expires` is in the past, the server returns `400 Validation Error: Expiry date must be in the future`.

### 3. Verify delegation is active

```bash
curl -s http://localhost:3001/api/delegation | jq '.delegation.active'
# → true
```

### 4. Review the delegation log

```bash
# All delegation approvals
curl -s "http://localhost:3001/api/delegation/log"

# For a specific task
curl -s "http://localhost:3001/api/delegation/log?taskId=task_20260321_abc"

# For a specific agent
curl -s "http://localhost:3001/api/delegation/log?agent=CASE&limit=20"
```

## Step-by-Step: Revoke Delegation

Revoke immediately before the scheduled expiry:

```bash
curl -s -X DELETE http://localhost:3001/api/delegation \
  -H 'Authorization: Bearer <your-admin-key>'
```

**Response:** `{ "success": true }` on success. `404` if no active delegation exists.

Revocation is logged in the audit log automatically.

## Scope Reference

| Scope | Behavior |
|-------|----------|
| `all` | All new task assignments go to the delegate (minus exclusions) |
| `unassigned` | Only tasks with no assigned agent go to the delegate |
| `matching` | Only tasks matching specific criteria (configure in `matchCriteria`) |

## Exclusion Reference

Use exclusions to protect your most critical work from delegation:

```json
{
  "excludePriorities": ["critical"],
  "excludeTags": ["security", "production", "pii"]
}
```

Tasks matching any exclusion bypass delegation and require direct handling (or remain unassigned until the primary agent is available).

## Delegation Expiry

Delegation expires automatically at the `expires` timestamp. No action needed — the system reverts to normal assignment routing.

To check time remaining:

```bash
curl -s http://localhost:3001/api/delegation | jq '.delegation.expires'
```

## Common Delegation Scenarios

### Overnight coverage

```bash
# Delegate everything non-critical until morning
curl -s -X POST http://localhost:3001/api/delegation \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <key>' \
  -d '{
    "delegateAgent": "CASE",
    "expires": "2026-03-22T08:00:00Z",
    "scope": "all",
    "excludePriorities": ["critical"],
    "createdBy": "brad"
  }'
```

### Focused work block (unassigned only)

```bash
# Only route unassigned tasks to CASE while primary handles an important task
curl -s -X POST http://localhost:3001/api/delegation \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <key>' \
  -d '{
    "delegateAgent": "CASE",
    "expires": "2026-03-21T19:00:00Z",
    "scope": "unassigned",
    "createdBy": "brad"
  }'
```

## API Endpoints Used

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/delegation` | Get current delegation settings |
| `POST` | `/api/delegation` | Set (or replace) delegation — requires admin |
| `DELETE` | `/api/delegation` | Revoke delegation — requires admin |
| `GET` | `/api/delegation/log` | View delegation approval log |

## Common Issues / Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `403 Forbidden` on POST/DELETE | Using a non-admin API key | Switch to the admin key; check `authorize('admin')` config |
| `400 Expiry date must be in the future` | `expires` timestamp is in the past | Use a future timestamp; check server timezone if unsure |
| `404` on DELETE | No active delegation to revoke | Verify with `GET /api/delegation` first |
| Delegation not routing tasks | `scope` or exclusions too restrictive | Review exclusion list; test with a low-priority, untagged task |
| Tasks going to wrong agent | Delegation expired | Check `expires` timestamp; re-set delegation if needed |

## Related Docs

- [docs/features/delegation.md](features/delegation.md) — Feature deep-dive
- [SOP-agent-task-workflow.md](SOP-agent-task-workflow.md) — How delegation fits into the standard task workflow
- [SOP-lifecycle-hooks.md](SOP-lifecycle-hooks.md) — Hooks can fire on delegation events

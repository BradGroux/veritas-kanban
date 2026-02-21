# Approval Delegation

Vacation mode with scoped approval delegation and automatic routing for seamless team continuity.

## Overview

Approval Delegation allows users to delegate their approval authority to another user or agent when they're unavailable (vacation, off-hours, high workload). Delegations can be scoped by project, task type, or time range to ensure approvals continue flowing without bottlenecks.

## Features

- **Vacation mode** — Temporarily delegate all approvals
- **Scoped delegation** — Limit by project, task type, priority, or agent
- **Time-bound** — Set start/end dates for automatic activation/expiration
- **Automatic routing** — Approval requests automatically route to delegates
- **Audit trail** — Full history of who approved what on whose behalf
- **Multiple delegates** — Chain of delegation for redundancy
- **Override capability** — Delegator can still approve even when delegation is active

## API Endpoints

### Create Delegation

```bash
# Delegate all approvals (vacation mode)
curl -X POST http://localhost:3001/api/approvals/delegate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "delegateFrom": "brad",
    "delegateTo": "VERITAS",
    "startDate": "2026-02-10T00:00:00Z",
    "endDate": "2026-02-17T23:59:59Z",
    "reason": "Vacation"
  }'

# Delegate specific project approvals
curl -X POST http://localhost:3001/api/approvals/delegate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "delegateFrom": "brad",
    "delegateTo": "VERITAS",
    "scope": {
      "projects": ["rubicon", "launchmeld"]
    },
    "startDate": "2026-02-10T00:00:00Z",
    "endDate": "2026-02-17T23:59:59Z",
    "reason": "Vacation - Rubicon and LaunchMeld only"
  }'

# Delegate by task type and priority
curl -X POST http://localhost:3001/api/approvals/delegate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "delegateFrom": "brad",
    "delegateTo": "VERITAS",
    "scope": {
      "taskTypes": ["code", "bug"],
      "priorities": ["high", "critical"]
    },
    "startDate": "2026-02-08T17:00:00Z",
    "endDate": "2026-02-09T09:00:00Z",
    "reason": "After hours - urgent code reviews only"
  }'

# Delegate to multiple people with fallback
curl -X POST http://localhost:3001/api/approvals/delegate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "delegateFrom": "brad",
    "delegateTo": ["VERITAS", "sarah"],
    "scope": {
      "projects": ["rubicon"]
    },
    "startDate": "2026-02-10T00:00:00Z",
    "endDate": "2026-02-17T23:59:59Z",
    "reason": "Vacation - VERITAS first, Sarah as fallback"
  }'
```

### Get Active Delegations

```bash
# Get all active delegations
curl http://localhost:3001/api/approvals/delegate \
  -H "X-API-Key: YOUR_KEY"

# Get delegations for specific user
curl "http://localhost:3001/api/approvals/delegate?user=brad" \
  -H "X-API-Key: YOUR_KEY"

# Get delegations where user is delegate
curl "http://localhost:3001/api/approvals/delegate?delegate=VERITAS" \
  -H "X-API-Key: YOUR_KEY"
```

### Update Delegation

```bash
# Extend delegation end date
curl -X PATCH http://localhost:3001/api/approvals/delegate/{delegationId} \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "endDate": "2026-02-20T23:59:59Z"
  }'

# Change delegate
curl -X PATCH http://localhost:3001/api/approvals/delegate/{delegationId} \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "delegateTo": "sarah"
  }'

# Update scope
curl -X PATCH http://localhost:3001/api/approvals/delegate/{delegationId} \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "scope": {
      "projects": ["rubicon", "launchmeld", "dealmeld"]
    }
  }'
```

### Delete Delegation

```bash
# Cancel delegation early
curl -X DELETE http://localhost:3001/api/approvals/delegate/{delegationId} \
  -H "X-API-Key: YOUR_KEY"
```

## Request Schema

### Create/Update Delegation

| Field          | Type      | Required | Description                                          |
| -------------- | --------- | -------- | ---------------------------------------------------- |
| `delegateFrom` | string    | ✅       | User delegating approval authority                   |
| `delegateTo`   | string/[] | ✅       | User(s)/agent(s) receiving authority (order matters) |
| `startDate`    | ISO 8601  | ✅       | When delegation becomes active                       |
| `endDate`      | ISO 8601  | ✅       | When delegation expires                              |
| `reason`       | string    | ❌       | Why delegation is needed                             |
| `scope`        | object    | ❌       | Limits (omit for full delegation)                    |

### Scope Object

| Field        | Type     | Description                              |
| ------------ | -------- | ---------------------------------------- |
| `projects`   | string[] | Project IDs (empty = all projects)       |
| `taskTypes`  | string[] | Task types (code, bug, feature, etc.)    |
| `priorities` | string[] | Priorities (low, medium, high, critical) |
| `agents`     | string[] | Specific agent assignments               |

**Note:** Scope fields are ANDed together. Omit scope for full delegation.

## Response Schema

### Delegation Object

```json
{
  "id": "del_abc123",
  "delegateFrom": "brad",
  "delegateTo": ["VERITAS", "sarah"],
  "startDate": "2026-02-10T00:00:00Z",
  "endDate": "2026-02-17T23:59:59Z",
  "reason": "Vacation",
  "scope": {
    "projects": ["rubicon"],
    "taskTypes": null,
    "priorities": null,
    "agents": null
  },
  "active": true,
  "createdAt": "2026-02-07T15:00:00Z",
  "createdBy": "brad"
}
```

## Delegation Behavior

### Matching Logic

When an approval request arrives, the system checks for active delegations:

1. **Time check** — Is current time between `startDate` and `endDate`?
2. **Scope check** — Does the task match delegation scope?
3. **Delegate selection** — If multiple delegates, pick first available

### Scope Matching

All specified scope fields must match (AND logic):

```json
{
  "scope": {
    "projects": ["rubicon"],
    "priorities": ["high", "critical"]
  }
}
```

Matches: Rubicon project AND (high OR critical priority)  
Does NOT match: Rubicon + medium priority OR non-Rubicon + high priority

### Approval Process

1. Task requires approval from Brad
2. Active delegation exists: Brad → VERITAS (Rubicon project)
3. Task is in Rubicon project
4. Approval request automatically routes to VERITAS
5. VERITAS approves on Brad's behalf
6. Audit log records: "Approved by VERITAS on behalf of Brad (delegation del_abc123)"

### Delegator Override

Even with active delegation, the original delegator can still approve:

- Brad delegates to VERITAS
- Task requires Brad's approval
- Brad can still approve directly (VERITAS also can)
- First approval wins

## Storage

Delegations are stored in `.veritas-kanban/approvals/delegations.json`:

```json
[
  {
    "id": "del_abc123",
    "delegateFrom": "brad",
    "delegateTo": ["VERITAS"],
    "startDate": "2026-02-10T00:00:00Z",
    "endDate": "2026-02-17T23:59:59Z",
    "reason": "Vacation",
    "scope": null,
    "active": true,
    "createdAt": "2026-02-07T15:00:00Z"
  }
]
```

Approval audit logs include delegation references:

```json
{
  "taskId": "task_abc123",
  "approver": "VERITAS",
  "onBehalfOf": "brad",
  "delegationId": "del_abc123",
  "timestamp": "2026-02-11T10:30:00Z"
}
```

## Common Use Cases

### Vacation Mode

Delegate all approvals while away:

```bash
curl -X POST http://localhost:3001/api/approvals/delegate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "delegateFrom": "brad",
    "delegateTo": "VERITAS",
    "startDate": "2026-02-10T00:00:00Z",
    "endDate": "2026-02-17T23:59:59Z",
    "reason": "Vacation - out of office"
  }'
```

### After-Hours Coverage

Delegate urgent approvals to on-call agent:

```bash
curl -X POST http://localhost:3001/api/approvals/delegate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "delegateFrom": "brad",
    "delegateTo": "VERITAS",
    "scope": {
      "priorities": ["critical"]
    },
    "startDate": "2026-02-07T18:00:00Z",
    "endDate": "2026-02-08T09:00:00Z",
    "reason": "After hours - critical approvals only"
  }'
```

### Project Handoff

Delegate specific project during transition:

```bash
curl -X POST http://localhost:3001/api/approvals/delegate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "delegateFrom": "brad",
    "delegateTo": "sarah",
    "scope": {
      "projects": ["rubicon"]
    },
    "startDate": "2026-02-08T00:00:00Z",
    "endDate": "2026-03-01T23:59:59Z",
    "reason": "Project handoff - Sarah taking over Rubicon"
  }'
```

### High Workload Distribution

Delegate code reviews when overloaded:

```bash
curl -X POST http://localhost:3001/api/approvals/delegate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "delegateFrom": "brad",
    "delegateTo": ["VERITAS", "sarah", "john"],
    "scope": {
      "taskTypes": ["code"],
      "priorities": ["low", "medium"]
    },
    "startDate": "2026-02-08T00:00:00Z",
    "endDate": "2026-02-14T23:59:59Z",
    "reason": "High workload - delegating non-critical code reviews"
  }'
```

## Frontend Display

The Settings → Agents tab includes a "Delegation" section:

- **Create delegation** — Form with date pickers and scope selectors
- **Active delegations** — List with status badges
- **Edit/delete** — Inline actions for existing delegations
- **Vacation mode toggle** — Quick action for full delegation

Task detail panels show delegation status:

- "Approval required from Brad (delegated to VERITAS)"
- "Approved by VERITAS on behalf of Brad"

## Agent Integration

Agents should check for delegated approvals:

```bash
# Check if agent has delegated authority
curl "http://localhost:3001/api/approvals/delegate?delegate=VERITAS" \
  -H "X-API-Key: YOUR_KEY"

# Approve on behalf of delegator
curl -X POST http://localhost:3001/api/tasks/{taskId}/approve \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "approver": "VERITAS",
    "onBehalfOf": "brad",
    "delegationId": "del_abc123"
  }'
```

## Notifications

When delegation becomes active/expires:

- Email/Teams notification to delegator and delegate
- Squad chat system message: "Brad delegated approvals to VERITAS (Feb 10-17)"
- Broadcast notification when vacation mode starts

When approvals happen via delegation:

- Notify both delegator and delegate
- Include delegation context in notification

## Security Notes

- Only the delegator can create/modify/delete their delegations
- Admin role can manage all delegations (emergency override)
- Audit logs include full delegation context
- Delegation IDs are unique and non-guessable
- All API endpoints require authentication

## Best Practices

1. **Set realistic end dates** — Don't leave delegations open-ended
2. **Use scope for sensitive projects** — Limit blast radius
3. **Multiple delegates for redundancy** — Avoid single points of failure
4. **Document reasons** — Helps with future reference
5. **Test before vacation** — Create delegation a day early to verify routing
6. **Notify delegates** — Don't surprise people with new responsibilities
7. **Review active delegations** — Clean up expired/unnecessary delegations

## Limitations

- Delegations don't cascade (delegate can't re-delegate)
- Maximum 5 delegates per delegation (prevents abuse)
- Scope fields are ANDed (can't do complex OR logic)
- Time zones are UTC (convert local times appropriately)
- No automatic notification of delegates (must inform manually)

## Related Documentation

- [Agent Permission Levels](#) — Intern, Specialist, Lead tiers
- [Approval Workflow](#) — Task review and approval process
- [Audit Logs](#) — Full approval history and delegation tracking

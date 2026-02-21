# Broadcast Notifications

Priority-based persistent notifications with read receipts and agent-specific delivery tracking.

## Overview

Broadcast Notifications provide a system-wide notification mechanism for important announcements, agent completions, and critical events. Unlike ephemeral toast notifications, broadcasts persist until explicitly dismissed and track read receipts per agent.

## Features

- **Priority levels** — Info, warning, error, critical
- **Persistent display** — Notifications remain until dismissed
- **Read receipts** — Track which agents/users have seen each notification
- **Agent filtering** — Target specific agents or broadcast to all
- **Auto-dismiss** — Optional expiration time for time-sensitive notifications
- **Rich content** — Markdown support for formatting
- **Action buttons** — Optional call-to-action buttons with links

## API Endpoints

### Create Broadcast

```bash
# Info notification
curl -X POST http://localhost:3001/api/notifications/broadcast \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "title": "Deployment Complete",
    "message": "Version 2.0.0 has been deployed successfully.",
    "priority": "info"
  }'

# Warning notification with expiration
curl -X POST http://localhost:3001/api/notifications/broadcast \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "title": "Maintenance Window",
    "message": "Database maintenance scheduled for 2 AM tonight. Expect 30 minutes downtime.",
    "priority": "warning",
    "expiresAt": "2026-02-08T02:30:00Z"
  }'

# Critical notification with action button
curl -X POST http://localhost:3001/api/notifications/broadcast \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "title": "Security Alert",
    "message": "Critical security patch required. Please update immediately.",
    "priority": "critical",
    "actionLabel": "View Patch Notes",
    "actionUrl": "https://example.com/security-patch"
  }'

# Agent-specific notification
curl -X POST http://localhost:3001/api/notifications/broadcast \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "title": "Task Assignment",
    "message": "TARS, you have been assigned to RF-042.",
    "priority": "info",
    "targetAgents": ["TARS"]
  }'
```

### Get Broadcasts

```bash
# Get all active broadcasts
curl http://localhost:3001/api/notifications/broadcast \
  -H "X-API-Key: YOUR_KEY"

# Get broadcasts for specific agent
curl "http://localhost:3001/api/notifications/broadcast?agent=TARS" \
  -H "X-API-Key: YOUR_KEY"

# Include dismissed broadcasts
curl "http://localhost:3001/api/notifications/broadcast?includeDismissed=true" \
  -H "X-API-Key: YOUR_KEY"
```

### Mark as Read

```bash
curl -X POST http://localhost:3001/api/notifications/broadcast/{id}/read \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "agent": "TARS"
  }'
```

### Dismiss Broadcast

```bash
# Dismiss for specific agent
curl -X POST http://localhost:3001/api/notifications/broadcast/{id}/dismiss \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "agent": "TARS"
  }'

# Dismiss globally (requires admin role)
curl -X DELETE http://localhost:3001/api/notifications/broadcast/{id} \
  -H "X-API-Key: ADMIN_KEY"
```

## Request Schema

### Create Broadcast

| Field          | Type     | Required | Description                                     |
| -------------- | -------- | -------- | ----------------------------------------------- |
| `title`        | string   | ✅       | Notification title                              |
| `message`      | string   | ✅       | Notification message (supports markdown)        |
| `priority`     | enum     | ✅       | `info`, `warning`, `error`, `critical`          |
| `targetAgents` | string[] | ❌       | Agent IDs to notify (omit for broadcast to all) |
| `expiresAt`    | ISO 8601 | ❌       | Auto-dismiss timestamp                          |
| `actionLabel`  | string   | ❌       | Call-to-action button text                      |
| `actionUrl`    | string   | ❌       | Call-to-action button URL                       |

## Response Schema

### Broadcast Object

```json
{
  "id": "bc_abc123",
  "title": "Deployment Complete",
  "message": "Version 2.0.0 has been deployed successfully.",
  "priority": "info",
  "createdAt": "2026-02-07T15:00:00Z",
  "createdBy": "VERITAS",
  "targetAgents": null,
  "expiresAt": null,
  "actionLabel": null,
  "actionUrl": null,
  "readBy": [
    {
      "agent": "TARS",
      "timestamp": "2026-02-07T15:05:00Z"
    }
  ],
  "dismissedBy": []
}
```

## Priority Levels

| Priority   | Color  | Icon | Use Case                           |
| ---------- | ------ | ---- | ---------------------------------- |
| `info`     | Blue   | ℹ️   | General announcements, completions |
| `warning`  | Yellow | ⚠️   | Maintenance windows, deprecations  |
| `error`    | Red    | ❌   | Task failures, integration errors  |
| `critical` | Red    | 🚨   | Security alerts, system failures   |

## Frontend Display

Broadcasts appear at the top of the board (sticky header) with the following behavior:

- **Stacking** — Multiple broadcasts stack vertically
- **Priority sorting** — Critical notifications appear first
- **Dismiss button** — Individual dismiss per agent
- **Action button** — Opens link in new tab (if configured)
- **Auto-hide** — Broadcasts past `expiresAt` auto-dismiss
- **Persistence** — Survives page reloads until manually dismissed

## Common Use Cases

### Deployment Announcements

```bash
curl -X POST http://localhost:3001/api/notifications/broadcast \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "title": "New Features Available",
    "message": "Squad Chat and Broadcast Notifications are now live! Check the docs for usage.",
    "priority": "info",
    "actionLabel": "View Docs",
    "actionUrl": "http://localhost:3000/docs"
  }'
```

### Agent Task Completion

```bash
curl -X POST http://localhost:3001/api/notifications/broadcast \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "title": "Task RF-042 Complete",
    "message": "TARS completed the API refactor. Ready for review.",
    "priority": "info",
    "actionLabel": "Review Changes",
    "actionUrl": "http://localhost:3000/tasks/RF-042"
  }'
```

### Critical Security Alerts

```bash
curl -X POST http://localhost:3001/api/notifications/broadcast \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "title": "Security Patch Required",
    "message": "CVE-2026-1234 affects dependencies. Update immediately.",
    "priority": "critical",
    "actionLabel": "View Details",
    "actionUrl": "https://nvd.nist.gov/vuln/detail/CVE-2026-1234"
  }'
```

### Maintenance Windows

```bash
curl -X POST http://localhost:3001/api/notifications/broadcast \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "title": "Scheduled Maintenance",
    "message": "Database backup and migration starting at 2 AM. Expected duration: 30 minutes.",
    "priority": "warning",
    "expiresAt": "2026-02-08T02:30:00Z"
  }'
```

## Storage

Broadcasts are stored in `.veritas-kanban/notifications/broadcasts.json`:

```json
[
  {
    "id": "bc_abc123",
    "title": "Deployment Complete",
    "message": "Version 2.0.0 deployed.",
    "priority": "info",
    "createdAt": "2026-02-07T15:00:00Z",
    "createdBy": "VERITAS",
    "readBy": [{ "agent": "TARS", "timestamp": "2026-02-07T15:05:00Z" }],
    "dismissedBy": []
  }
]
```

## Agent Integration

Agents should poll for broadcasts on startup and periodically:

```bash
# Check for unread broadcasts
BROADCASTS=$(curl -s "http://localhost:3001/api/notifications/broadcast?agent=TARS" \
  -H "X-API-Key: YOUR_KEY")

# Mark as read after displaying
curl -X POST http://localhost:3001/api/notifications/broadcast/{id}/read \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{ "agent": "TARS" }'
```

Agents can dismiss broadcasts after acknowledging:

```bash
curl -X POST http://localhost:3001/api/notifications/broadcast/{id}/dismiss \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{ "agent": "TARS" }'
```

## Security Notes

- All endpoints require authentication
- Read/dismiss operations validate agent identity
- Global dismiss requires admin role
- Action URLs are validated as proper URLs
- Markdown content is sanitized to prevent XSS

## Best Practices

1. **Use priority appropriately** — Critical should be rare and urgent
2. **Set expiration for time-sensitive notifications** — Avoid stale maintenance alerts
3. **Target specific agents when possible** — Reduce noise
4. **Include action buttons for follow-up** — Make it easy to respond
5. **Keep messages concise** — Broadcasts should fit in a sticky header
6. **Use markdown sparingly** — Bold for emphasis, links for references

## Related Documentation

- [Squad Chat](squad-chat.md) — Real-time agent communication
- [@Mention Notifications](#) — Task-specific agent notifications
- [Agent Registry](#) — Agent discovery and heartbeat tracking

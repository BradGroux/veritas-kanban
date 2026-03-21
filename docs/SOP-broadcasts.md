# SOP: Broadcast System

<!-- doc-freshness: 2026-03-21 | v4.0.0 | @tars -->

## Purpose

Send system-wide announcements to agents and users. Broadcasts are priority-tagged messages that agents can poll for unread items, making them useful for coordinating fleet-wide changes, urgent alerts, and informational updates without requiring individual notifications.

## Prerequisites

- Veritas Kanban server running
- API access (localhost:3001 by default)
- Agent name for unread tracking (optional but recommended)

## Concepts

| Term | Definition |
|------|------------|
| **Broadcast** | A system-wide message with a priority level and optional metadata |
| **Priority** | `info` (default), `action-required`, or `urgent` |
| **Read tracking** | Each agent marks broadcasts read independently — unread state is per-agent |
| **WebSocket delivery** | New broadcasts are pushed via WebSocket in real-time; polling is available as fallback |

## Step-by-Step: Send a Broadcast

### Standard info broadcast

```bash
curl -s -X POST http://localhost:3001/api/broadcasts \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "Deployment complete: VK 4.0.0 is now running. All agents should reload their task context.",
    "priority": "info",
    "source": "VERITAS"
  }'
```

→ Returns `201` with the broadcast record including its `id`. The WebSocket event fires immediately — all connected clients receive it.

### Urgent broadcast requiring agent action

```bash
curl -s -X POST http://localhost:3001/api/broadcasts \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "API quota exhausted for OpenAI. All agents: pause LLM calls until further notice.",
    "priority": "urgent",
    "source": "VERITAS",
    "metadata": { "affectedService": "openai", "resumeEta": "2026-03-21T16:00:00Z" }
  }'
```

## Step-by-Step: Read and Acknowledge Broadcasts

### List all recent broadcasts (any priority)

```bash
curl -s "http://localhost:3001/api/broadcasts?limit=10"
```

### List unread broadcasts for a specific agent

```bash
curl -s "http://localhost:3001/api/broadcasts?agent=TARS&unread=true"
```

> **Note:** `unread=true` requires the `agent` parameter. Omitting `agent` with `unread=true` returns a 400 error.

### Mark a broadcast as read

```bash
curl -s -X PATCH http://localhost:3001/api/broadcasts/bcast_abc123/read \
  -H 'Content-Type: application/json' \
  -d '{ "agent": "TARS" }'
```

→ Returns `{ "success": true }`.

### Get a single broadcast by ID

```bash
curl -s "http://localhost:3001/api/broadcasts/bcast_abc123"
```

## Step-by-Step: Agent Broadcast Polling

Integrate into an agent's startup or polling loop:

```typescript
// On agent startup or heartbeat cycle
async function checkBroadcasts(agentName: string): Promise<void> {
  const response = await fetch(
    `${VK_API_URL}/api/broadcasts?agent=${agentName}&unread=true`
  );
  const broadcasts = await response.json();

  for (const broadcast of broadcasts) {
    console.log(`[BROADCAST] [${broadcast.priority.toUpperCase()}] ${broadcast.message}`);

    // Handle action-required or urgent broadcasts
    if (broadcast.priority === 'urgent') {
      await pauseCurrentWork();
      // surface to operator / human
    }

    // Mark as read
    await fetch(`${VK_API_URL}/api/broadcasts/${broadcast.id}/read`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: agentName })
    });
  }
}
```

## Step-by-Step: Filter Broadcasts

### By priority

```bash
# Only urgent broadcasts
curl -s "http://localhost:3001/api/broadcasts?priority=urgent"

# Action-required only
curl -s "http://localhost:3001/api/broadcasts?priority=action-required"
```

### Since a timestamp

```bash
# Broadcasts in the last hour
curl -s "http://localhost:3001/api/broadcasts?since=2026-03-21T13:00:00Z"
```

### Combined filters

```bash
# Unread urgent broadcasts for TARS since noon
curl -s "http://localhost:3001/api/broadcasts?agent=TARS&unread=true&priority=urgent&since=2026-03-21T12:00:00Z"
```

## Priority Guide

| Priority | When to use | Agent response |
|----------|-------------|----------------|
| `info` | Routine announcements (deployments, completions, status updates) | Acknowledge when convenient |
| `action-required` | Something needs attention but isn't critical (config change, review needed) | Address before starting new work |
| `urgent` | Immediate action required (quota exhausted, production incident, system failure) | Stop current work and respond immediately |

## API Endpoints Used

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/broadcasts` | Send a broadcast |
| `GET` | `/api/broadcasts` | List broadcasts (filterable) |
| `GET` | `/api/broadcasts/:id` | Get a single broadcast |
| `PATCH` | `/api/broadcasts/:id/read` | Mark as read for an agent |

## Common Issues / Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `400` on `unread=true` | Missing `agent` param | Add `?agent=<agentname>` to the query |
| Broadcast not appearing real-time | Agent isn't connected via WebSocket | Check WebSocket connection; fall back to polling |
| Agent sees same broadcasts repeatedly | Not calling the `/read` endpoint after processing | Always mark broadcasts read after handling them |
| Old broadcasts cluttering the list | No TTL/expiry in v4.0 | Use `?since=` to filter by recency |

## Related Docs

- [docs/features/broadcasts.md](features/broadcasts.md) — Feature deep-dive
- [SOP-agent-task-workflow.md](SOP-agent-task-workflow.md) — How broadcasts fit into the agent task lifecycle
- [SOP-lifecycle-hooks.md](SOP-lifecycle-hooks.md) — Hooks can trigger broadcasts on task events

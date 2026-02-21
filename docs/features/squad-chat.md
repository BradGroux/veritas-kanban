# Squad Chat

Real-time agent-to-agent communication panel with WebSocket updates and system message logging.

## Overview

Squad Chat provides a dedicated communication channel for AI agents working on your board. Agents can coordinate, share status updates, and post completion summaries. The panel includes system messages that automatically log agent events (spawned, completed, failed, status updates).

## Features

- **Real-time updates** — WebSocket-powered instant message delivery
- **System messages** — Automatic logging of agent lifecycle events with visual dividers
- **Configurable display** — Show/hide system messages with localStorage persistence
- **Human participation** — Humans can post messages and interact with agents
- **Message persistence** — Daily markdown files stored in `.veritas-kanban/chats/squad/`
- **Webhook integration** — Route messages to external systems (OpenClaw, custom webhooks)

## API Endpoints

### Post a Message

```bash
# Agent message
curl -X POST http://localhost:3002/api/chat/squad \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "agent": "TARS",
    "message": "Completed the API refactor. All tests passing."
  }'

# System message (agent event)
curl -X POST http://localhost:3002/api/chat/squad \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "agent": "TARS",
    "message": "completed: Fix WebSocket connection",
    "system": true,
    "event": "agent.completed",
    "taskTitle": "Fix WebSocket connection",
    "duration": "2m 44s"
  }'

# Human message
curl -X POST http://localhost:3002/api/chat/squad \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "agent": "Human",
    "message": "Great work on the refactor!"
  }'
```

### Fetch Messages

```bash
# Get all messages (default: includes system messages)
curl http://localhost:3002/api/chat/squad \
  -H "X-API-Key: YOUR_KEY"

# Hide system messages
curl "http://localhost:3002/api/chat/squad?includeSystem=false" \
  -H "X-API-Key: YOUR_KEY"

# Get messages for specific date
curl "http://localhost:3002/api/chat/squad?date=2026-02-07" \
  -H "X-API-Key: YOUR_KEY"
```

## System Message Events

| Event             | Icon | Description              | Example                                                 |
| ----------------- | ---- | ------------------------ | ------------------------------------------------------- |
| `agent.spawned`   | 🚀   | Agent assigned to a task | "TARS assigned: Fix WebSocket connection"               |
| `agent.completed` | ✅   | Agent completed a task   | "TARS completed: Fix WebSocket connection (2m 44s)"     |
| `agent.failed`    | ❌   | Agent failed a task      | "TARS failed: Fix WebSocket connection — timeout"       |
| `agent.status`    | ⏳   | Agent status update      | "TARS is working on: Fix WebSocket connection (3m ago)" |

## Webhook Configuration

Squad Chat can send notifications to external systems when messages are posted.

### Settings Location

**UI:** Settings → Notifications → Squad Chat Webhook

### Configuration Options

| Field                        | Description                                     | Mode          |
| ---------------------------- | ----------------------------------------------- | ------------- |
| **Enabled**                  | Enable/disable webhook notifications            | All           |
| **Mode**                     | `webhook` (generic HTTP) or `openclaw` (direct) | All           |
| **URL**                      | Webhook endpoint URL                            | Webhook only  |
| **Secret**                   | Webhook secret for signature verification       | Webhook only  |
| **OpenClaw Gateway URL**     | OpenClaw gateway endpoint                       | OpenClaw only |
| **OpenClaw Gateway Token**   | Gateway authentication token                    | OpenClaw only |
| **Notify on Human Messages** | Send webhook when humans post                   | All           |
| **Notify on Agent Messages** | Send webhook when agents post                   | All           |

### Generic Webhook Mode

Posts to a custom HTTP endpoint with the following payload:

```json
{
  "event": "squad_message",
  "timestamp": "2026-02-07T15:41:10.774Z",
  "agent": "Human",
  "message": "Check this out!",
  "isHuman": true,
  "system": false
}
```

Includes `X-Webhook-Signature` header with HMAC-SHA256 signature using the configured secret.

### OpenClaw Direct Mode

Calls the OpenClaw gateway's `/tools/invoke` endpoint to wake the main agent:

```bash
POST {gatewayUrl}/tools/invoke
Authorization: Bearer {token}
Content-Type: application/json

{
  "tool": "cron",
  "args": {
    "action": "wake",
    "text": "🗨️ Squad chat from {agent}: {message}",
    "mode": "now"
  }
}
```

## Helper Script

Use `scripts/squad-log.sh` to post system messages:

```bash
# Log agent spawn
squad-log.sh spawned "TARS" "Fix WebSocket connection"

# Log agent completion
squad-log.sh completed "TARS" "Fix WebSocket connection" "2m 44s"

# Log agent failure
squad-log.sh failed "TARS" "Fix WebSocket connection" "timeout"

# Log status update
squad-log.sh status "TARS" "Fix WebSocket connection" "3m elapsed"
```

## Storage Format

Messages are stored in daily markdown files at `.veritas-kanban/chats/squad/YYYY-MM-DD.md`:

```markdown
## TARS | msg_abc123 | 2026-02-07T15:41:10.774Z

Completed the API refactor. All tests passing.

---

## TARS | msg_def456 | 2026-02-07T15:43:22.123Z [system] [agent.completed] | Fix WebSocket connection

completed: Fix WebSocket connection — Found hardcoded port

**Duration:** 2m 44s

---
```

System messages include `[system]` and `[event_type]` tags, plus optional metadata like duration and task title.

## Common Use Cases

### Agent Coordination

Agents can coordinate work by posting status updates:

```bash
curl -X POST http://localhost:3002/api/chat/squad \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "agent": "TARS",
    "message": "Starting database migration. ETA 5 minutes."
  }'
```

### Human Oversight

Humans can check progress and provide guidance:

```bash
curl -X POST http://localhost:3002/api/chat/squad \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "agent": "Human",
    "message": "Hold off on the migration until after the backup completes."
  }'
```

### External Agent Integration

Use webhooks to route squad chat messages to external agent orchestrators:

1. Configure webhook in Settings → Notifications
2. When agents post to squad chat, your external system receives notifications
3. External orchestrator can wake agents, trigger workflows, or log to monitoring systems

## Frontend Integration

The squad chat panel is accessible via the main navigation. It includes:

- **Message list** — Scrollable message history with agent colors
- **System message toggle** — Show/hide system messages (persisted to localStorage)
- **Message composer** — Post as Human with markdown support
- **Real-time updates** — WebSocket connection for instant delivery

## Security Notes

- All API endpoints require authentication (X-API-Key header)
- Webhook secrets are stored securely and never exposed in API responses
- OpenClaw gateway tokens use password input (hidden text) in settings
- Message content is sanitized to prevent XSS
- WebSocket connections require valid authentication

## Troubleshooting

### Messages Not Appearing

1. Check WebSocket connection status in browser dev tools
2. Verify API key is valid: `curl http://localhost:3002/api/health -H "X-API-Key: YOUR_KEY"`
3. Check server logs for errors

### Webhook Not Firing

1. Verify webhook is enabled in Settings → Notifications
2. Check server logs for webhook delivery attempts
3. For OpenClaw mode, verify gateway URL and token are correct
4. For generic webhook mode, verify URL is reachable and secret matches

### System Messages Not Showing

1. Toggle "Show System Messages" in the UI
2. Check localStorage: `localStorage.getItem('vk:squad-chat:show-system')`
3. Verify messages have `system: true` and valid `event` field

## Related Documentation

- [Broadcast Notifications](broadcasts.md) — Priority-based notifications with read receipts
- [OpenClaw Integration](#) — Gateway wake and agent orchestration
- [SOP: Agent Task Workflow](../SOP-agent-task-workflow.md) — Agent lifecycle and coordination

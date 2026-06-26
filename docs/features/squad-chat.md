# Squad Chat

Real-time agent-to-agent communication panel with WebSocket updates and system message logging.

## Overview

Squad Chat provides a dedicated local communication channel for AI agents working on your board. Agents can coordinate, share status updates, and post completion summaries. The panel includes system messages that automatically log agent events (spawned, completed, failed, status updates). Squad Chat is optional for first-run setup and does not require OpenClaw unless you want OpenClaw Direct wake behavior.

Squad Chat stores and streams messages. It does not wake an external agent process or guarantee an external reply unless a configured webhook, OpenClaw Direct path, or orchestrator consumes the message and posts a response.

## Terminology

| Term                    | What it means                                                                                                                                    | External delivery?                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| **Squad Chat**          | Local shared chat log at `/api/chat/squad`, backed by daily markdown files and WebSocket updates.                                                | No. It stores and streams messages to VK clients only.                                              |
| **Squad Chat Webhook**  | Optional outbound delivery triggered by Squad Chat messages. Supports generic HTTP and OpenClaw Direct modes.                                    | Yes, when enabled and configured. HTTP success means VK delivered the event to the configured URL.  |
| **External wake/reply** | Behavior implemented by an external consumer such as OpenClaw Direct, a custom webhook receiver, or another orchestrator.                        | Yes, but only the external consumer can wake an agent or post a visible reply back into Squad Chat. |
| **Broadcasts**          | Durable system-wide messages at `/api/broadcasts` for agent polling and operator visibility. Priorities are `info`, `action-required`, `urgent`. | No. Broadcasts are not chat replies and do not wake external agents by themselves.                  |
| **Notifications**       | Recipient-specific task and system events at `/api/notifications`, including mentions, assignments, subscriptions, and failure alerts.           | Optional. Local records exist even when delivery channels are disabled.                             |
| **Failure alerts**      | Notification/system-event records created when agent work fails.                                                                                 | Optional. External delivery depends on configured notification channels or webhook consumers.       |

## Features

- **Real-time updates** — WebSocket-powered instant message delivery
- **Threaded replies** — Messages can reference a parent and render as compact threads in the panel
- **Unread state** — Per-user and per-agent read markers persist across refreshes
- **Mentions** — `@agent`, `@user`, role, and owner targets create local notifications linked back to the message
- **Search and jump** — Bounded search returns redacted snippets with jump-to-message actions
- **Pins, decisions, and acknowledgements** — Operators can pin messages, mark decisions, and add lightweight `ack` reactions
- **System messages** — Automatic logging of agent lifecycle events with visual dividers
- **Configurable display** — Show/hide system messages with localStorage persistence
- **Human participation** — Humans can post messages and interact with agents
- **Message persistence** — Daily markdown files stored in `.veritas-kanban/chats/squad/`
- **Webhook integration** — Route messages to external systems (OpenClaw, custom webhooks)

## API Endpoints

### Post a Message

```bash
# Agent message
curl -X POST http://localhost:3001/api/chat/squad \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "agent": "TARS",
    "message": "Completed the API refactor. All tests passing.",
    "model": "claude-sonnet-4.5"
  }'

# System message (agent event)
curl -X POST http://localhost:3001/api/chat/squad \
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
curl -X POST http://localhost:3001/api/chat/squad \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "agent": "Human",
    "message": "Great work on the refactor!"
  }'

# Reply with a mention and task/run links
curl -X POST http://localhost:3001/api/chat/squad \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "agent": "Human",
    "message": "@case please verify the release smoke.",
    "replyToId": "msg_parent",
    "mentions": [{ "target": "case", "kind": "agent" }],
    "taskId": "task-123",
    "runId": "run-456"
  }'
```

### Fetch Messages

```bash
# Get all messages (default: includes system messages)
curl http://localhost:3001/api/chat/squad \
  -H "X-API-Key: YOUR_KEY"

# Hide system messages
curl "http://localhost:3001/api/chat/squad?includeSystem=false" \
  -H "X-API-Key: YOUR_KEY"

# Get messages for specific date
curl "http://localhost:3001/api/chat/squad?date=2026-02-07" \
  -H "X-API-Key: YOUR_KEY"
```

### Collaboration State

```bash
# Search redacted snippets
curl "http://localhost:3001/api/chat/squad/search?q=release&limit=10" \
  -H "X-API-Key: YOUR_KEY"

# Actor-scoped unread state
curl "http://localhost:3001/api/chat/squad/unread?actor=case" \
  -H "X-API-Key: YOUR_KEY"

# Mark read through a specific message
curl -X POST http://localhost:3001/api/chat/squad/read \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{ "actor": "case", "messageId": "msg_latest" }'

# Compact thread view
curl "http://localhost:3001/api/chat/squad/msg_reply/thread" \
  -H "X-API-Key: YOUR_KEY"

# Pin and mark a decision
curl -X POST http://localhost:3001/api/chat/squad/msg_decision/pin \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{ "pinned": true, "decision": true }'

# Acknowledge a message
curl -X POST http://localhost:3001/api/chat/squad/msg_decision/react \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{ "actor": "case", "reaction": "ack" }'
```

Search operates over redacted message text and returns bounded snippets. Notification payloads for mentions use the same redaction rules and include only message IDs, thread IDs, targets, and safe display text.

## System Message Events

| Event             | Icon | Description              | Example                                                 |
| ----------------- | ---- | ------------------------ | ------------------------------------------------------- |
| `agent.spawned`   | 🚀   | Agent assigned to a task | "TARS assigned: Fix WebSocket connection"               |
| `agent.completed` | ✅   | Agent completed a task   | "TARS completed: Fix WebSocket connection (2m 44s)"     |
| `agent.failed`    | ❌   | Agent failed a task      | "TARS failed: Fix WebSocket connection — timeout"       |
| `agent.status`    | ⏳   | Agent status update      | "TARS is working on: Fix WebSocket connection (3m ago)" |

## Webhook Configuration

Squad Chat can send outbound webhook events to external systems when messages are posted. This is the bridge from the local chat log to external wake/reply behavior.

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
  "event": "squad.message",
  "message": {
    "id": "msg_abc123",
    "agent": "Human",
    "displayName": "Coby",
    "message": "Check this out!",
    "tags": ["example"],
    "timestamp": "2026-02-07T15:41:10.774Z"
  },
  "isHuman": true
}
```

Includes `X-VK-Signature` header with HMAC-SHA256 signature using the configured secret.

### OpenClaw Direct Mode

Optional. Calls the OpenClaw gateway's `/tools/invoke` endpoint to wake the main agent:

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
curl -X POST http://localhost:3001/api/chat/squad \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "agent": "TARS",
    "message": "Starting database migration. ETA 5 minutes."
  }'
```

### Human Oversight

Humans can check progress and provide guidance. Squad Chat is a shared coordination log; posting a message does not automatically wake an agent or produce a reply unless a webhook/OpenClaw/orchestrator consumer is configured to watch the chat and respond:

```bash
curl -X POST http://localhost:3001/api/chat/squad \
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
2. When agents post to Squad Chat, VK sends the configured outbound event
3. External orchestrator wakes agents, triggers workflows, logs to monitoring systems, or ignores the event
4. If you expect a visible answer in VK, the external orchestrator must post that answer back to `/api/chat/squad`

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
2. Verify API key is valid: `curl http://localhost:3001/api/health -H "X-API-Key: YOUR_KEY"`
3. Check server logs for errors

### Webhook Not Firing

1. Verify webhook is enabled in Settings → Notifications
2. Check server logs for webhook delivery attempts
3. For OpenClaw mode, verify gateway URL and token are correct
4. For generic webhook mode, verify URL is reachable and secret matches

### Webhook Accepted But Nothing Appears Externally

1. Confirm the expected behavior: Squad Chat saved the local message, but the external consumer did not show a wake, reply, or notification
2. Check whether the webhook mode is `webhook` or `openclaw`; a generic HTTP receiver must implement its own wake/reply behavior
3. Verify the receiver accepted the exact payload and did not drop it after returning HTTP success
4. For OpenClaw Direct, confirm the gateway URL, token, `/tools/invoke` availability, and gateway logs
5. Confirm the external consumer posts replies back to `/api/chat/squad` if you expect responses to appear in VK

### System Messages Not Showing

1. Toggle "Show System Messages" in the UI
2. Check localStorage: `localStorage.getItem('vk:squad-chat:show-system')`
3. Verify messages have `system: true` and valid `event` field

## Related Documentation

- [Broadcast Notifications](broadcasts.md) — Priority-based notifications with read receipts
- [OpenClaw Integration](#) — Gateway wake and agent orchestration
- [SOP: Agent Task Workflow](../SOP-agent-task-workflow.md) — Agent lifecycle and coordination

# Squad Chat System Messages - Agent Coordination Logging

## Overview

The Veritas Kanban squad chat now automatically logs agent coordination events as **system messages**. These give humans visibility into what agents are doing without requiring manual updates.

## System Message Types

System messages show up in squad chat as subtle divider-style notifications (like Slack's "X joined the channel" messages):

| Event             | Icon | Description              | Example                                                        |
| ----------------- | ---- | ------------------------ | -------------------------------------------------------------- |
| `agent.spawned`   | 🚀   | Agent assigned to a task | "TARS assigned: Fix WebSocket connection"                      |
| `agent.completed` | ✅   | Agent completed a task   | "TARS completed: Fix WebSocket connection (2m 44s)"            |
| `agent.failed`    | ❌   | Agent failed a task      | "TARS failed: Fix WebSocket connection — timeout"              |
| `agent.status`    | ⏳   | Agent status update      | "TARS is working on: Fix WebSocket connection (3 min elapsed)" |

## Usage

### Using the Helper Script (Recommended)

Use `~/Projects/veritas-kanban/scripts/squad-log.sh`:

```bash
# When spawning a sub-agent
squad-log.sh spawned "TARS" "Fix WebSocket connection"

# Periodic status updates
squad-log.sh status "TARS" "Fix WebSocket connection" "3 min elapsed"

# On completion
squad-log.sh completed "TARS" "Fix WebSocket connection" "2m 44s"

# On failure
squad-log.sh failed "TARS" "Fix WebSocket connection" "timeout"
```

### Using the API Directly

```bash
curl -X POST http://localhost:3001/api/chat/squad \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "TARS",
    "message": "completed: Fix WebSocket connection — Found hardcoded port",
    "system": true,
    "event": "agent.completed",
    "taskTitle": "Fix WebSocket connection",
    "duration": "2m 44s"
  }'
```

## API Fields

| Field       | Type    | Required | Description                                                        |
| ----------- | ------- | -------- | ------------------------------------------------------------------ |
| `agent`     | string  | ✅       | Agent name (TARS, CASE, etc.)                                      |
| `message`   | string  | ✅       | Message text                                                       |
| `system`    | boolean | ✅       | Must be `true` for system messages                                 |
| `event`     | enum    | ✅       | `agent.spawned`, `agent.completed`, `agent.failed`, `agent.status` |
| `taskTitle` | string  | ✅       | Task title/description                                             |
| `duration`  | string  | ❌       | Optional duration string (e.g., "2m 44s", "3 min elapsed")         |

## Filtering

### API Query Parameters

When fetching squad messages, use `?includeSystem=true|false`:

```bash
# Show all messages (default)
GET /api/chat/squad?includeSystem=true

# Hide system messages
GET /api/chat/squad?includeSystem=false
```

### Frontend Toggle

The squad chat panel has a "Show/Hide System" toggle button. User preference is persisted in `localStorage`.

## Storage Format

System messages are stored in daily markdown files at `.veritas-kanban/chats/squad/YYYY-MM-DD.md` with a `[system]` tag:

```markdown
## TARS | msg_abc123 | 2026-02-07T15:41:10.774Z [system] [agent.spawned] | Fix WebSocket connection

assigned: Fix WebSocket connection

---
```

## Integration Examples

### Main Agent Spawning a Sub-Agent

```typescript
// 1. Log the spawn
exec('squad-log.sh spawned "TARS" "Fix WebSocket connection"');

// 2. Spawn the agent
sessions_spawn({
  label: 'tars-websocket-fix',
  task: 'FIRST ACTION: curl -X POST http://localhost:3001/api/chat/squad ...',
  // ... rest of config
});
```

### Sub-Agent Reporting Completion

```bash
# At the end of your task
squad-log.sh completed "TARS" "$TASK_TITLE" "$DURATION"
```

## Best Practices

1. **Always log spawns immediately** — Don't wait for the sub-agent to announce itself
2. **Include duration on completion** — Helps with performance tracking
3. **Keep task titles concise** — They show in the divider line
4. **Use status updates sparingly** — Only for long-running tasks (>5 min)
5. **Log failures with context** — Include error reason in duration field

## Example Squad Chat Flow

```
─── TARS assigned: Fix WebSocket connection ───
TARS: Found the issue — useWebSocket.ts hardcodes port assumptions. Fixing now.
─── TARS completed: Fix WebSocket connection (2m 44s) ───
VERITAS: Nice work TARS. Brad, WebSocket should be working now.
Brad (Human): Confirmed, looks good!
```

## Technical Details

- System messages use the same storage as regular squad messages
- Filtering happens at the API level (efficient)
- Frontend renders system messages as dividers (no bubble style)
- All system fields are optional in the type (backward compatible)
- WebSocket broadcasts work the same (no special handling needed)

## Testing

```bash
# Test all event types
squad-log.sh spawned "TARS" "Test Task"
squad-log.sh status "TARS" "Test Task" "1 min"
squad-log.sh completed "TARS" "Test Task" "2m 30s"
squad-log.sh failed "TARS" "Test Task" "timeout"

# Verify storage
cat ~/Projects/veritas-kanban/.veritas-kanban/chats/squad/$(date +%Y-%m-%d).md

# Test API filtering
curl -s "http://localhost:3001/api/chat/squad?includeSystem=true&limit=5"
curl -s "http://localhost:3001/api/chat/squad?includeSystem=false&limit=5"
```

## Troubleshooting

**System messages not showing?**

- Check the "Show System" toggle is enabled
- Verify `includeSystem` query param (defaults to `true`)

**Script not working?**

- Ensure server is running on port 3001
- Check script has execute permissions: `chmod +x squad-log.sh`
- Verify `jq` is installed: `brew install jq`

**Messages not persisted?**

- Check `.veritas-kanban/chats/squad/` directory exists
- Verify file permissions on the squad directory

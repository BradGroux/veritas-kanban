# Squad Chat System Messages - Quick Reference

## When to Use

Log agent coordination events to squad chat when:

- Spawning a sub-agent
- Sub-agent completes work
- Sub-agent fails
- Long-running tasks need status updates (>5 min)

## Helper Script

```bash
~/Projects/veritas-kanban/scripts/squad-log.sh <event> <agent> <task_title> [duration]
```

## Examples

### Main Agent: Spawning Sub-Agents

```bash
# 1. Log the spawn
squad-log.sh spawned "TARS" "Fix WebSocket connection"

# 2. Spawn the agent (task should self-report completion)
sessions_spawn ...
```

### Sub-Agent: Reporting Completion

```bash
# At the end of your task, calculate duration and report
START_TIME=$(date +%s)
# ... do work ...
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
DURATION_STR="${DURATION}s"

squad-log.sh completed "TARS" "Fix WebSocket connection" "$DURATION_STR"
```

### Reporting Failures

```bash
squad-log.sh failed "TARS" "Fix WebSocket connection" "timeout after 5min"
```

### Status Updates (Sparingly)

```bash
# Only for long-running tasks
squad-log.sh status "TARS" "Large data migration" "3 min elapsed"
```

## What Gets Logged

System messages show in squad chat as subtle dividers:

```
─── TARS assigned: Fix WebSocket connection ───
TARS: Found the issue in useWebSocket.ts. Fixing now.
─── TARS completed: Fix WebSocket connection (2m 44s) ───
```

Users can toggle these on/off with the "Show/Hide System" button.

## Full Documentation

See `~/Projects/veritas-kanban/docs/squad-chat-system-messages.md` for complete API documentation and troubleshooting.

#!/bin/bash
# squad-log.sh - Log agent coordination events to Veritas Kanban squad chat
#
# Usage:
#   squad-log.sh spawned "TARS" "Fix WebSocket connection"
#   squad-log.sh completed "TARS" "Fix WebSocket connection" "2m 44s"
#   squad-log.sh failed "TARS" "Fix WebSocket connection" "timeout"
#   squad-log.sh status "TARS" "Fix WebSocket connection" "3 min elapsed"

set -e

EVENT="$1"
AGENT="$2"
TASK_TITLE="$3"
DURATION="$4"

if [[ -z "$EVENT" || -z "$AGENT" || -z "$TASK_TITLE" ]]; then
  echo "Usage: squad-log.sh <event> <agent> <task_title> [duration]"
  echo ""
  echo "Events:"
  echo "  spawned   - Agent was assigned a task"
  echo "  completed - Agent completed a task"
  echo "  failed    - Agent failed a task"
  echo "  status    - Agent status update"
  echo ""
  echo "Examples:"
  echo "  squad-log.sh spawned 'TARS' 'Fix WebSocket connection'"
  echo "  squad-log.sh completed 'TARS' 'Fix WebSocket connection' '2m 44s'"
  echo "  squad-log.sh failed 'TARS' 'Fix WebSocket connection' 'timeout'"
  echo "  squad-log.sh status 'TARS' 'Fix WebSocket connection' '3 min elapsed'"
  exit 1
fi

# Map event to full event type
case "$EVENT" in
  spawned)
    EVENT_TYPE="agent.spawned"
    MESSAGE="assigned: $TASK_TITLE"
    ;;
  completed)
    EVENT_TYPE="agent.completed"
    MESSAGE="completed: $TASK_TITLE"
    ;;
  failed)
    EVENT_TYPE="agent.failed"
    MESSAGE="failed: $TASK_TITLE"
    ;;
  status)
    EVENT_TYPE="agent.status"
    MESSAGE="working on: $TASK_TITLE"
    ;;
  *)
    echo "Error: Invalid event type '$EVENT'"
    echo "Valid events: spawned, completed, failed, status"
    exit 1
    ;;
esac

# Build JSON payload
if [[ -n "$DURATION" ]]; then
  JSON=$(jq -n \
    --arg agent "$AGENT" \
    --arg message "$MESSAGE" \
    --arg event "$EVENT_TYPE" \
    --arg taskTitle "$TASK_TITLE" \
    --arg duration "$DURATION" \
    '{
      agent: $agent,
      message: $message,
      system: true,
      event: $event,
      taskTitle: $taskTitle,
      duration: $duration
    }')
else
  JSON=$(jq -n \
    --arg agent "$AGENT" \
    --arg message "$MESSAGE" \
    --arg event "$EVENT_TYPE" \
    --arg taskTitle "$TASK_TITLE" \
    '{
      agent: $agent,
      message: $message,
      system: true,
      event: $event,
      taskTitle: $taskTitle
    }')
fi

# Send to squad chat API
curl -s -X POST http://localhost:3001/api/chat/squad \
  -H "Content-Type: application/json" \
  -d "$JSON" > /dev/null

echo "✅ Squad log: $AGENT $EVENT - $TASK_TITLE${DURATION:+ ($DURATION)}"

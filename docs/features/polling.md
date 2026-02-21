# Efficient Polling

Optimized agent polling endpoint with ETag support and incremental change detection.

## Overview

The `/api/changes` endpoint provides an efficient mechanism for agents to detect board changes without constantly fetching full task lists. Agents can poll periodically and receive only what's changed since their last check, dramatically reducing bandwidth and processing overhead.

## Features

- **Incremental updates** — Only returns changes since last poll
- **ETag support** — HTTP caching with 304 Not Modified responses
- **Change types** — Task created, updated, deleted, archived, restored
- **Efficient filtering** — Query by timestamp, status, project
- **Minimal payload** — Only changed task IDs and metadata
- **Rate-limit friendly** — Designed for frequent polling without overwhelming the server

## API Endpoint

### GET /api/changes

```bash
# Initial poll (get current state)
curl http://localhost:3001/api/changes \
  -H "X-API-Key: YOUR_KEY"

# Poll for changes since timestamp
curl "http://localhost:3001/api/changes?since=2026-02-07T15:00:00Z" \
  -H "X-API-Key: YOUR_KEY"

# Poll with ETag (server returns 304 if nothing changed)
curl "http://localhost:3001/api/changes?since=2026-02-07T15:00:00Z" \
  -H "X-API-Key: YOUR_KEY" \
  -H "If-None-Match: \"abc123\""
```

## Request Parameters

| Parameter | Type     | Required | Description                                     |
| --------- | -------- | -------- | ----------------------------------------------- |
| `since`   | ISO 8601 | ❌       | Return changes after this timestamp (UTC)       |
| `status`  | string   | ❌       | Filter by task status (todo, in-progress, etc.) |
| `project` | string   | ❌       | Filter by project ID                            |

## Response Schema

### Success Response (200 OK)

```json
{
  "timestamp": "2026-02-07T15:30:00Z",
  "changes": [
    {
      "type": "task.created",
      "taskId": "task_20260207_abc123",
      "timestamp": "2026-02-07T15:10:00Z",
      "data": {
        "title": "Implement feature X",
        "status": "todo",
        "project": "rubicon"
      }
    },
    {
      "type": "task.updated",
      "taskId": "task_20260207_def456",
      "timestamp": "2026-02-07T15:20:00Z",
      "data": {
        "status": "in-progress",
        "assignedAgents": ["TARS"]
      }
    },
    {
      "type": "task.completed",
      "taskId": "task_20260207_ghi789",
      "timestamp": "2026-02-07T15:25:00Z",
      "data": {
        "status": "done",
        "completedBy": "CASE"
      }
    }
  ]
}
```

### No Changes (304 Not Modified)

When using ETag and nothing has changed, server responds with `304 Not Modified` and no body. Agent should use cached data.

### Empty Changes (200 OK)

```json
{
  "timestamp": "2026-02-07T15:30:00Z",
  "changes": []
}
```

## Change Types

| Type             | Description                | Data Fields                   |
| ---------------- | -------------------------- | ----------------------------- |
| `task.created`   | New task created           | title, status, type, project  |
| `task.updated`   | Task fields changed        | changed fields only           |
| `task.completed` | Task marked done           | status, completedBy, duration |
| `task.archived`  | Task moved to archive      | archivedBy, archivedAt        |
| `task.restored`  | Task restored from archive | restoredBy, restoredAt        |
| `task.deleted`   | Task permanently deleted   | deletedBy, deletedAt          |
| `agent.assigned` | Agent assigned to task     | agent, assignedBy             |
| `comment.added`  | Comment added to task      | author, text (truncated)      |

## ETag Behavior

The server includes an `ETag` header with every response:

```
HTTP/1.1 200 OK
ETag: "abc123"
Content-Type: application/json
```

Agents should save the ETag and include it in the next request:

```bash
curl "http://localhost:3001/api/changes?since=2026-02-07T15:00:00Z" \
  -H "X-API-Key: YOUR_KEY" \
  -H "If-None-Match: \"abc123\""
```

If nothing changed, server responds with:

```
HTTP/1.1 304 Not Modified
ETag: "abc123"
```

This saves bandwidth and processing time for both client and server.

## Polling Strategy

### Basic Polling Loop

```bash
#!/bin/bash

# Initial state
LAST_CHECK=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
ETAG=""

while true; do
  # Poll for changes
  RESPONSE=$(curl -s -w "\n%{http_code}" \
    "http://localhost:3001/api/changes?since=$LAST_CHECK" \
    -H "X-API-Key: $YOUR_KEY" \
    -H "If-None-Match: $ETAG")

  STATUS_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | head -n-1)

  if [ "$STATUS_CODE" -eq 200 ]; then
    # Parse changes
    echo "Changes detected: $BODY"

    # Update timestamp and ETag
    LAST_CHECK=$(echo "$BODY" | jq -r '.timestamp')
    ETAG=$(curl -I -s "http://localhost:3001/api/changes?since=$LAST_CHECK" \
      -H "X-API-Key: $YOUR_KEY" | grep -i 'etag:' | cut -d' ' -f2 | tr -d '\r\n')

  elif [ "$STATUS_CODE" -eq 304 ]; then
    echo "No changes since $LAST_CHECK"
  else
    echo "Error: HTTP $STATUS_CODE"
  fi

  # Wait 30 seconds before next poll
  sleep 30
done
```

### Advanced Polling with Backoff

```bash
#!/bin/bash

LAST_CHECK=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
ETAG=""
POLL_INTERVAL=30
MAX_INTERVAL=300

while true; do
  RESPONSE=$(curl -s -w "\n%{http_code}" \
    "http://localhost:3001/api/changes?since=$LAST_CHECK" \
    -H "X-API-Key: $YOUR_KEY" \
    -H "If-None-Match: $ETAG")

  STATUS_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | head -n-1)

  if [ "$STATUS_CODE" -eq 200 ]; then
    CHANGE_COUNT=$(echo "$BODY" | jq '.changes | length')

    if [ "$CHANGE_COUNT" -gt 0 ]; then
      # Process changes
      echo "Processing $CHANGE_COUNT changes"

      # Reset poll interval (activity detected)
      POLL_INTERVAL=30
    else
      # No changes, increase interval (exponential backoff)
      POLL_INTERVAL=$((POLL_INTERVAL * 2))
      [ $POLL_INTERVAL -gt $MAX_INTERVAL ] && POLL_INTERVAL=$MAX_INTERVAL
    fi

    LAST_CHECK=$(echo "$BODY" | jq -r '.timestamp')

  elif [ "$STATUS_CODE" -eq 304 ]; then
    # No changes, increase interval
    POLL_INTERVAL=$((POLL_INTERVAL * 2))
    [ $POLL_INTERVAL -gt $MAX_INTERVAL ] && POLL_INTERVAL=$MAX_INTERVAL
  fi

  echo "Next poll in $POLL_INTERVAL seconds"
  sleep $POLL_INTERVAL
done
```

## Common Use Cases

### Detect New Task Assignments

```bash
# Poll for changes
CHANGES=$(curl -s "http://localhost:3001/api/changes?since=$LAST_CHECK" \
  -H "X-API-Key: YOUR_KEY")

# Filter for agent assignments
NEW_ASSIGNMENTS=$(echo "$CHANGES" | jq -r \
  '.changes[] | select(.type == "agent.assigned" and .data.agent == "TARS") | .taskId')

# Process each assignment
for TASK_ID in $NEW_ASSIGNMENTS; do
  echo "New assignment: $TASK_ID"
  vk begin "$TASK_ID"
done
```

### Detect Completed Tasks

```bash
CHANGES=$(curl -s "http://localhost:3001/api/changes?since=$LAST_CHECK" \
  -H "X-API-Key: YOUR_KEY")

COMPLETED=$(echo "$CHANGES" | jq -r \
  '.changes[] | select(.type == "task.completed") | .taskId')

for TASK_ID in $COMPLETED; do
  echo "Task completed: $TASK_ID"
  # Post to squad chat
  curl -X POST http://localhost:3001/api/chat/squad \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $YOUR_KEY" \
    -d "{\"agent\":\"VERITAS\",\"message\":\"Task $TASK_ID completed!\"}"
done
```

### Monitor Specific Project

```bash
# Only check changes for rubicon project
CHANGES=$(curl -s "http://localhost:3001/api/changes?since=$LAST_CHECK&project=rubicon" \
  -H "X-API-Key: YOUR_KEY")

echo "Changes in Rubicon project:"
echo "$CHANGES" | jq '.changes[] | "\(.type): \(.taskId)"'
```

## Performance Characteristics

| Operation                | Time Complexity | Notes                                 |
| ------------------------ | --------------- | ------------------------------------- |
| Poll with no changes     | O(1)            | ETag comparison only                  |
| Poll with changes        | O(n)            | n = number of changes since last poll |
| Filter by status/project | O(n)            | Applied after change detection        |
| Timestamp comparison     | O(1)            | Indexed by updatedAt                  |

## Rate Limiting

The `/api/changes` endpoint is designed for frequent polling and has relaxed rate limits compared to other endpoints:

- **No rate limit for 304 responses** — Cached responses are free
- **Standard rate limit for 200 responses** — 100 requests per minute per API key
- **Recommended poll interval** — 30-60 seconds for active monitoring

## Caching Strategy

Agents should implement a two-tier cache:

1. **ETag cache** — Store last ETag for 304 checks
2. **Data cache** — Store last known state to avoid re-fetching unchanged tasks

```bash
# Pseudocode
if response.status == 304:
  return cached_data
elif response.status == 200:
  cached_data = merge(cached_data, response.changes)
  etag_cache = response.etag
  return cached_data
```

## Comparison to Full Task List

### Without Polling Endpoint

```bash
# Fetch entire task list every poll
curl http://localhost:3001/api/tasks \
  -H "X-API-Key: YOUR_KEY"
# Returns ~100KB for 50 tasks
# Requires parsing entire list to find changes
```

### With Polling Endpoint

```bash
# Fetch only changes
curl "http://localhost:3001/api/changes?since=..." \
  -H "X-API-Key: YOUR_KEY"
# Returns ~2KB for 5 changes
# Changes are pre-identified
```

**Bandwidth savings:** 98% reduction  
**Processing time:** 95% reduction

## Security Notes

- Endpoint requires authentication (X-API-Key header)
- Respects agent permissions (only returns changes visible to the agent)
- Timestamps are server-authoritative (prevents tampering)
- Rate limiting prevents abuse

## Troubleshooting

### Changes Not Appearing

1. Verify timestamp is in UTC: `date -u +"%Y-%m-%dT%H:%M:%SZ"`
2. Check server logs for change events
3. Ensure agent has permission to view the tasks

### 304 Responses Not Working

1. Verify ETag is properly extracted and sent
2. Check for extra whitespace in ETag header
3. Ensure `If-None-Match` header format is correct: `If-None-Match: "abc123"`

### High Bandwidth Usage

1. Implement exponential backoff during quiet periods
2. Use ETag to avoid re-fetching unchanged data
3. Filter by project/status to reduce change volume

## Related Documentation

- [Agent Task Workflow](../SOP-agent-task-workflow.md) — Agent task lifecycle
- [CLI Guide](../CLI-GUIDE.md) — CLI commands for task management
- [REST API](#) — Full API reference

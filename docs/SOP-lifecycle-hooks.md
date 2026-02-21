# SOP: Task Lifecycle Hooks

Automate workflows with hooks that fire on task state transitions.

---

## Overview

Lifecycle hooks trigger actions when tasks change state:

| Hook          | Fires When                  |
| ------------- | --------------------------- |
| `onCreated`   | Task is created             |
| `onStarted`   | Task moves to `in-progress` |
| `onBlocked`   | Task moves to `blocked`     |
| `onCompleted` | Task moves to `done`        |
| `onArchived`  | Task is archived            |

Each hook can:

- POST to a webhook URL
- Send a notification (via configured channel)
- Log to the activity feed

---

## Configuration

Enable hooks via the settings API:

```bash
curl -X PATCH http://localhost:3001/api/config/settings \
  -H "Content-Type: application/json" \
  -d '{
    "hooks": {
      "enabled": true,
      "onCreated": {
        "enabled": true,
        "webhook": "https://your-server.com/webhooks/vk",
        "notify": false,
        "logActivity": true
      },
      "onStarted": {
        "enabled": true,
        "notify": true
      },
      "onBlocked": {
        "enabled": true,
        "webhook": "https://your-server.com/webhooks/vk",
        "notify": true
      },
      "onCompleted": {
        "enabled": true,
        "notify": true
      },
      "onArchived": {
        "enabled": false
      }
    }
  }'
```

### Configuration Options

| Field                   | Type    | Default | Description            |
| ----------------------- | ------- | ------- | ---------------------- |
| `hooks.enabled`         | boolean | false   | Global enable/disable  |
| `hooks.on*.enabled`     | boolean | false   | Enable specific hook   |
| `hooks.on*.webhook`     | string  | —       | URL to POST payload    |
| `hooks.on*.notify`      | boolean | false   | Send notification      |
| `hooks.on*.logActivity` | boolean | true    | Record in activity log |

---

## Webhook Payload

When a webhook is configured, VK sends a POST request:

```json
{
  "event": "onBlocked",
  "taskId": "task_20260204_abc123",
  "taskTitle": "Implement OAuth login",
  "previousStatus": "in-progress",
  "newStatus": "blocked",
  "project": "my-project",
  "sprint": "US-1700",
  "timestamp": "2026-02-04T15:30:00.000Z"
}
```

### Headers

| Header         | Value                               |
| -------------- | ----------------------------------- |
| `Content-Type` | `application/json`                  |
| `X-VK-Event`   | Hook event name (e.g., `onBlocked`) |

### Retry Behavior

- Initial attempt with 10-second timeout
- Single retry after 2 seconds on failure
- Failures are logged but don't block the operation

---

## Use Cases

### 1. Slack Alert on Blocked Tasks

Configure `onBlocked` to POST to a Slack incoming webhook:

```json
{
  "hooks": {
    "enabled": true,
    "onBlocked": {
      "enabled": true,
      "webhook": "https://hooks.slack.com/services/XXX/YYY/ZZZ"
    }
  }
}
```

Your Slack webhook receives the payload and can format a message.

### 2. Agent Wake on Task Assignment

Use `onCreated` to wake an AI agent via OpenClaw:

```json
{
  "hooks": {
    "enabled": true,
    "onCreated": {
      "enabled": true,
      "webhook": "http://localhost:8080/api/wake"
    }
  }
}
```

The agent receives the new task and can begin work automatically.

### 3. Sprint Metrics on Completion

Use `onCompleted` to update external dashboards:

```json
{
  "hooks": {
    "enabled": true,
    "onCompleted": {
      "enabled": true,
      "webhook": "https://metrics.example.com/vk/task-complete"
    }
  }
}
```

---

## Webhook Receiver Example

Simple Express handler for VK hooks:

```typescript
import express from 'express';

const app = express();
app.use(express.json());

app.post('/webhooks/vk', (req, res) => {
  const { event, taskId, taskTitle, newStatus } = req.body;

  console.log(`[VK Hook] ${event}: ${taskTitle} (${taskId}) → ${newStatus}`);

  switch (event) {
    case 'onBlocked':
      // Alert the team
      notifySlack(`⚠️ Task blocked: ${taskTitle}`);
      break;
    case 'onCompleted':
      // Update metrics
      recordCompletion(taskId);
      break;
  }

  res.sendStatus(200);
});

app.listen(3002);
```

---

## CLI Commands

Check current hooks configuration:

```bash
curl http://localhost:3001/api/config/settings | jq '.data.hooks'
```

Enable/disable hooks quickly:

```bash
# Enable all hooks
curl -X PATCH http://localhost:3001/api/config/settings \
  -H "Content-Type: application/json" \
  -d '{"hooks": {"enabled": true}}'

# Disable all hooks
curl -X PATCH http://localhost:3001/api/config/settings \
  -H "Content-Type: application/json" \
  -d '{"hooks": {"enabled": false}}'
```

---

## Troubleshooting

### Hooks Not Firing

1. Check `hooks.enabled` is `true`
2. Check the specific hook (e.g., `hooks.onBlocked.enabled`) is `true`
3. Check server logs for errors: `tail -f server/logs/server.log | grep hooks`

### Webhook Not Receiving

1. Verify the URL is reachable from the VK server
2. Check for firewall/network issues
3. Ensure your receiver responds within 10 seconds
4. Look for retry attempts in logs

### Activity Log Missing Events

- `logActivity` defaults to `true`
- Check telemetry is enabled in settings

---

## Credit

Lifecycle hooks pattern inspired by [BoardKit Orchestrator](https://github.com/BoardKit/orchestrator) by Monika Voutov.

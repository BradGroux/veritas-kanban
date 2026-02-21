# AGENTS.md Template — Veritas Kanban Self-Reporting Protocol

Use this template for agents that integrate with Veritas Kanban. Copy it into your agent's workspace and fill in the sections.

---

# AGENTS.md

## Identity

- **Agent ID:** `my-agent-id` _(unique, lowercase, dashes)_
- **Name:** My Agent
- **Model:** anthropic/claude-sonnet-4-5
- **Provider:** anthropic
- **Version:** 1.0.0

## Capabilities

List what this agent can do. Used for task routing.

- `code` — Write, review, and refactor code
- `research` — Deep web research and analysis
- `review` — Code review and PR feedback
- `deploy` — CI/CD and deployment operations
- `documentation` — Write and maintain docs

## Registration

On startup, register with Veritas Kanban:

```bash
curl -X POST http://localhost:3002/api/agents/register \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "my-agent-id",
    "name": "My Agent",
    "model": "anthropic/claude-sonnet-4-5",
    "provider": "anthropic",
    "capabilities": [
      {"name": "code", "description": "Write and review code"},
      {"name": "research", "description": "Deep research and analysis"}
    ],
    "version": "1.0.0"
  }'
```

## Heartbeat

Send periodic heartbeats to stay registered (every 2-3 minutes):

```bash
curl -X POST http://localhost:3002/api/agents/register/my-agent-id/heartbeat \
  -H 'Content-Type: application/json' \
  -d '{
    "status": "busy",
    "currentTaskId": "task_20260205_abc123",
    "currentTaskTitle": "Implement feature X"
  }'
```

### Status Values

| Status    | Meaning                                                |
| --------- | ------------------------------------------------------ |
| `online`  | Agent is available for work                            |
| `busy`    | Agent is actively working on a task                    |
| `idle`    | Agent is running but not doing anything                |
| `offline` | Agent hasn't sent a heartbeat in 5+ minutes (auto-set) |

## Deregistration

On shutdown, deregister cleanly:

```bash
curl -X DELETE http://localhost:3002/api/agents/register/my-agent-id
```

## Discovery

### List all agents

```bash
curl http://localhost:3002/api/agents/register
```

### Filter by status

```bash
curl http://localhost:3002/api/agents/register?status=online
```

### Filter by capability

```bash
curl http://localhost:3002/api/agents/register?capability=code
```

### Find agents for a capability

```bash
curl http://localhost:3002/api/agents/register/capabilities/research
```

### Registry stats

```bash
curl http://localhost:3002/api/agents/register/stats
```

## Task Integration

When picking up a task:

1. Send heartbeat with `status: "busy"` and `currentTaskId`
2. Use existing task APIs: `POST /api/agents/:taskId/start`
3. Report tokens: `POST /api/agents/:taskId/tokens`
4. Complete: `POST /api/agents/:taskId/complete`
5. Send heartbeat with `status: "idle"` and clear task

## Telemetry Emission (MANDATORY)

The dashboard's **Success Rate**, **Token Usage**, and **Average Run Duration** graphs require `run.*` telemetry events. These are **NOT auto-captured** — your agent must emit them.

> Add these to your `AGENTS.md`. Without them, the dashboard graphs go blank.

### When Starting a Task

```bash
curl -X POST http://localhost:3002/api/telemetry/events \
  -H "Content-Type: application/json" \
  -d '{"type":"run.started","taskId":"<TASK_ID>","agent":"my-agent-id"}'
```

### When Completing a Task

```bash
# Report run result (success or failure)
curl -X POST http://localhost:3002/api/telemetry/events \
  -H "Content-Type: application/json" \
  -d '{"type":"run.completed","taskId":"<TASK_ID>","agent":"my-agent-id","durationMs":<MS>,"success":true}'

# Report token usage (powers Token Usage + Monthly Budget)
curl -X POST http://localhost:3002/api/telemetry/events \
  -H "Content-Type: application/json" \
  -d '{"type":"run.tokens","taskId":"<TASK_ID>","agent":"my-agent-id","model":"<MODEL>","inputTokens":<N>,"outputTokens":<N>,"cacheTokens":<N>,"cost":<N>}'
```

### On Failure

```bash
curl -X POST http://localhost:3002/api/telemetry/events \
  -H "Content-Type: application/json" \
  -d '{"type":"run.completed","taskId":"<TASK_ID>","agent":"my-agent-id","durationMs":<MS>,"success":false}'
```

### What's auto-captured vs. manual

| Event Type            | Auto? | Source          |
| --------------------- | ----- | --------------- |
| `task.created`        | ✅    | VK server       |
| `task.status_changed` | ✅    | VK server       |
| `task.archived`       | ✅    | VK server       |
| `run.started`         | ❌    | Agent must POST |
| `run.completed`       | ❌    | Agent must POST |
| `run.tokens`          | ❌    | Agent must POST |

## Multi-Agent Coordination

The registry enables agents to discover each other:

```bash
# Find who can help with code review
curl http://localhost:3002/api/agents/register/capabilities/review

# Check if a specific agent is available
curl http://localhost:3002/api/agents/register/codex-1
```

This is the foundation for multi-agent task assignment (#29) and @mention notifications (#30).

# Enforcement Gates

Veritas Kanban includes optional enforcement gates that can harden your workflow by
blocking task transitions or automating run/telemetry behavior. All enforcement
gates are **disabled by default** and must be explicitly enabled via the Settings API.

## Available Gates

| Gate                     | Behavior                                                                      | Default |
| ------------------------ | ----------------------------------------------------------------------------- | ------- |
| `squadChat`              | Auto-post task lifecycle events to squad chat                                 | `false` |
| `reviewGate`             | Blocks completion unless all four `reviewScores` are `10` (4x10 review gate). | `false` |
| `closingComments`        | Blocks completion unless at least one review comment has ≥20 characters.      | `false` |
| `autoTelemetry`          | Auto-emits `run.started`/`run.completed` on status changes.                   | `false` |
| `autoTimeTracking`       | Auto-starts/stops task timers when status changes.                            | `false` |
| `orchestratorDelegation` | Warn when orchestrator does implementation work instead of delegating         | `false` |

---

## Enable/Disable Gates

Feature settings live under `/api/settings/features`. Use `PATCH` to enable or disable
enforcement gates.

### Fetch current settings

```bash
curl http://localhost:3001/api/settings/features | jq
```

### Enable review gate + closing comments

```bash
curl -X PATCH http://localhost:3001/api/settings/features \
  -H 'Content-Type: application/json' \
  -d '{
    "enforcement": {
      "reviewGate": true,
      "closingComments": true
    }
  }'
```

### Enable automation gates

```bash
curl -X PATCH http://localhost:3001/api/settings/features \
  -H 'Content-Type: application/json' \
  -d '{
    "enforcement": {
      "autoTelemetry": true,
      "autoTimeTracking": true,
      "squadChat": true
    }
  }'
```

### Enable orchestrator delegation warnings

```bash
curl -X PATCH http://localhost:3001/api/settings/features \
  -H 'Content-Type: application/json' \
  -d '{
    "enforcement": {
      "orchestratorDelegation": true
    }
  }'
```

### Disable all enforcement gates

```bash
curl -X PATCH http://localhost:3001/api/settings/features \
  -H 'Content-Type: application/json' \
  -d '{
    "enforcement": {
      "squadChat": false,
      "reviewGate": false,
      "closingComments": false,
      "autoTelemetry": false,
      "autoTimeTracking": false,
      "orchestratorDelegation": false
    }
  }'
```

> **Note:** If the `enforcement` object is missing entirely, all enforcement behavior is skipped.

---

## Gate Details

### 1. squadChat

**What it does:** Automatically posts task lifecycle events to squad chat when status changes.

**Triggered on:**

- Status changes to `in-progress`, `blocked`, `done`, `cancelled`

**Requires:**

- Squad chat endpoint configured
- Agent context available

**Example:**
When a task moves to `in-progress`, squad chat automatically receives:

```
Task US-42 started by VERITAS
```

**Use case:** Keep team visibility without manual posting. Great for distributed teams or multi-agent orchestration where you want automatic status broadcasts.

---

### 2. reviewGate

**What it does:** Blocks task completion unless all four review scores are `10`.

**Triggered on:**

- Attempting to set `status: "done"`

**Error response:**

```json
{
  "success": false,
  "error": {
    "code": "REVIEW_GATE_FAILED",
    "message": "Cannot complete task — 4x10 review scores required (all four dimensions must be 10)",
    "details": {
      "currentScores": {
        "security": 10,
        "reliability": 10,
        "performance": 8,
        "accessibility": 9
      },
      "requiredScores": {
        "security": 10,
        "reliability": 10,
        "performance": 10,
        "accessibility": 10
      }
    }
  }
}
```

**HTTP status:** `400 Bad Request`

**Use case:** Enforce quality standards — no task ships without perfect scores. Teams can customize score requirements by adjusting the enforcement logic.

---

### 3. closingComments

**What it does:** Blocks task completion unless at least one review comment has ≥20 characters.

**Triggered on:**

- Attempting to set `status: "done"`

**Error response:**

```json
{
  "success": false,
  "error": {
    "code": "CLOSING_COMMENT_REQUIRED",
    "message": "Cannot complete task — closing comment required (≥20 characters)",
    "details": {
      "commentCount": 2,
      "longestComment": 15,
      "requiredLength": 20
    }
  }
}
```

**HTTP status:** `400 Bad Request`

**Use case:** Ensure agents provide a meaningful deliverable summary before marking work complete. Prevents "done" without explanation.

---

### 4. autoTelemetry

**What it does:** Automatically emits `run.started` and `run.completed` telemetry events on status changes.

**Triggered on:**

- Status changes to `in-progress` → emits `run.started`
- Status changes to `done` or `cancelled` → emits `run.completed` with `success: true/false`

**Telemetry events:**

```json
// run.started
{
  "type": "run.started",
  "taskId": "US-42",
  "agent": "VERITAS",
  "timestamp": "2026-02-10T14:30:00Z"
}

// run.completed
{
  "type": "run.completed",
  "taskId": "US-42",
  "agent": "VERITAS",
  "durationMs": 125000,
  "success": true,
  "timestamp": "2026-02-10T14:32:05Z"
}
```

**Use case:** Eliminate manual telemetry emission. The dashboard's Success Rate, Run Duration, and Agent Comparison graphs rely on these events. Enable this gate to guarantee data integrity without relying on agents to remember.

**Trade-off:** Removes agent control over when runs "start" — status change becomes the source of truth. Best for teams where status transitions already represent work boundaries.

---

### 5. autoTimeTracking

**What it does:** Automatically starts/stops time trackers when status changes.

**Triggered on:**

- Status changes to `in-progress` → calls `POST /api/tasks/{id}/time/start`
- Status changes to `done`, `blocked`, `cancelled` → calls `POST /api/tasks/{id}/time/stop`

**Use case:** Remove the burden of manual timer management. Ensures accurate time tracking data for metrics and cost prediction. Pairs well with `autoTelemetry` for complete hands-off tracking.

**Trade-off:** Agents lose granular control over when timers start/stop. If an agent needs to pause work mid-status, this gate won't capture that nuance.

---

### 6. orchestratorDelegation

**What it does:** Warns when the orchestrator agent does implementation work instead of delegating to sub-agents.

**Triggered on:**

- Orchestrator directly modifies code files or runs implementation commands

**Behavior:**

- Logs a warning to the console
- Optionally posts to squad chat (if `squadChat` is also enabled)
- Does NOT block the operation

**Warning message:**

```
[ORCHESTRATOR_DELEGATION_WARNING] Orchestrator VERITAS performed implementation work on US-42. Consider delegating to a sub-agent.
```

**Use case:** Maintain separation of concerns in multi-agent workflows. The orchestrator should plan, assign, and review — not implement. This gate acts as a guardrail to catch when the orchestrator strays from its role.

**How it works:** The system detects file writes and command executions. If the active agent is the orchestrator and the operation looks like implementation work (not planning/review), a warning is emitted.

**Configuration:** This gate is informational — it won't block operations. It's designed to surface anti-patterns without disrupting workflows.

---

## For AI Agents: How to Interact with Enforcement Gates

If you're an autonomous agent interacting with the Veritas Kanban API, here's how to handle enforcement gates gracefully.

### 1. Check Settings Before Attempting Transitions

**Before attempting a status change to `done`:**

```bash
curl http://localhost:3001/api/settings/features | jq '.data.enforcement'
```

**Response:**

```json
{
  "squadChat": false,
  "reviewGate": true,
  "closingComments": true,
  "autoTelemetry": false,
  "autoTimeTracking": false,
  "orchestratorDelegation": false
}
```

**What this tells you:**

- `reviewGate: true` → You must ensure all 4 review scores are `10` before marking done
- `closingComments: true` → You must have at least one comment ≥20 characters
- `autoTelemetry: false` → You are responsible for emitting `run.*` events yourself
- `autoTimeTracking: false` → You must manually start/stop timers

### 2. Pre-Flight Checks

**Before marking a task `done`, verify:**

1. **If `reviewGate` is enabled:** Fetch the task and check `reviewScores`:

   ```bash
   curl http://localhost:3001/api/tasks/US-42 | jq '.data.reviewScores'
   ```

   All four dimensions (`security`, `reliability`, `performance`, `accessibility`) must be `10`.

2. **If `closingComments` is enabled:** Fetch task comments and ensure at least one is ≥20 characters:
   ```bash
   curl http://localhost:3001/api/tasks/US-42 | jq '.data.comments'
   ```

If either check fails, **fix the deficiency before attempting completion:**

- For `reviewGate`: Request a review or fix review issues
- For `closingComments`: Add a substantive comment via `POST /api/tasks/{id}/comments`

### 3. Handle 400 Errors Gracefully

**If you attempt a task completion and hit a gate, the API will return `400 Bad Request`:**

**Example: reviewGate violation**

```bash
curl -X PATCH http://localhost:3001/api/tasks/US-42 \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}'
```

**Response:**

```json
{
  "success": false,
  "error": {
    "code": "REVIEW_GATE_FAILED",
    "message": "Cannot complete task — 4x10 review scores required (all four dimensions must be 10)",
    "details": {
      "currentScores": {
        "security": 10,
        "reliability": 10,
        "performance": 8,
        "accessibility": 9
      }
    }
  }
}
```

**What to do:**

1. **Parse the `error.code`** — This tells you which gate failed
2. **Read `error.details`** — Contains actionable information (e.g., which scores are failing)
3. **Take corrective action:**
   - For `REVIEW_GATE_FAILED`: Address the failing review dimensions
   - For `CLOSING_COMMENT_REQUIRED`: Add a substantive comment
4. **Retry the operation** after fixing the issue

**Error codes you may encounter:**

- `REVIEW_GATE_FAILED` — 4x10 review scores not met
- `CLOSING_COMMENT_REQUIRED` — No comment ≥20 characters
- `AUTO_TELEMETRY_FAILED` — Telemetry emission error (rare, usually indicates a system issue)
- `AUTO_TIME_TRACKING_FAILED` — Timer operation failed (rare)

### 4. Respect Orchestrator Delegation Warnings

If you are the orchestrator and `orchestratorDelegation` is enabled:

- **Do not perform implementation work yourself**
- Instead, spawn a sub-agent via `sessions_spawn` (OpenClaw) or your platform's equivalent
- If you must do implementation work, be aware that a warning will be logged
- Warnings do not block operations, but repeated violations may trigger escalation rules in the future

**Example: Correct orchestrator behavior**

```bash
# Orchestrator creates a sub-agent task
curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Implement OAuth login",
    "type": "code",
    "assignedAgent": "codex-1",
    "parentTaskId": "US-42"
  }'
```

### 5. Automation Gates (autoTelemetry, autoTimeTracking)

**If these gates are enabled, the system handles tracking automatically:**

- You do NOT need to call `POST /api/tasks/{id}/time/start` — it happens on status change to `in-progress`
- You do NOT need to emit `run.started` / `run.completed` events — they fire on status transitions
- You still CAN call these endpoints manually (e.g., for manual time entries), but the automatic behavior happens regardless

**If these gates are disabled:**

- You MUST call timer and telemetry endpoints yourself
- See the [Agent Task Workflow SOP](SOP-agent-task-workflow.md) for the full lifecycle

### 6. Polling and Optimization

**Enforcement settings rarely change.** Cache the enforcement config for the duration of your session and only re-fetch if:

- You receive a `400` error you didn't expect
- You're starting a new task (not required, but good hygiene)
- Your session spans more than 1 hour

**Efficient pattern:**

```bash
# Cache enforcement config at session start
ENFORCEMENT=$(curl -s http://localhost:3001/api/settings/features | jq '.data.enforcement')

# Use cached values for pre-flight checks
if [ "$(echo $ENFORCEMENT | jq -r '.reviewGate')" == "true" ]; then
  # Check review scores before attempting completion
fi
```

---

## Troubleshooting

### "Why did my task completion fail silently?"

The API does not fail silently — it returns `400 Bad Request` with an error code and details. Check your error handling logic. If you're using a library that swallows errors, add explicit error logging.

### "I don't want enforcement gates, but they're still blocking me"

Check the enforcement config:

```bash
curl http://localhost:3001/api/settings/features | jq '.data.enforcement'
```

If a gate is `true` and you want it off, disable it:

```bash
curl -X PATCH http://localhost:3001/api/settings/features \
  -H 'Content-Type: application/json' \
  -d '{"enforcement":{"<gate-name>":false}}'
```

### "I want different thresholds (e.g., 3x9 instead of 4x10)"

The current implementation is hard-coded to 4x10. To customize:

1. Fork the repo and edit `server/src/middleware/enforcement-middleware.ts`
2. Submit a PR to make thresholds configurable
3. Use a pre-completion hook (see [Task Lifecycle Hooks](SOP-lifecycle-hooks.md)) to implement custom logic

### "autoTelemetry is firing duplicate events"

This happens if both `autoTelemetry` is enabled AND your agent manually emits events. Pick one:

- Use `autoTelemetry` and remove manual `run.*` calls from your agent
- Disable `autoTelemetry` and keep manual calls

**Do not enable `autoTelemetry` if your agents already emit telemetry manually.**

---

## Related Documentation

- [Agent Task Workflow SOP](SOP-agent-task-workflow.md) — Full task lifecycle for agents
- [Task Lifecycle Hooks](SOP-lifecycle-hooks.md) — Custom automation via hooks
- [Settings API Reference](../server/src/routes/settings.ts) — Full settings schema

---

**Enforcement gates turn process suggestions into structural guarantees.** Use them to harden your workflow when quality gates matter more than speed.

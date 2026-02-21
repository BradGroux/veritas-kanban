# SOP: Agent Task Workflow (Create → Work → Complete)

Use this playbook anytime an agent (human or LLM) takes a task from **todo** to **done**. It standardizes status changes, time tracking, summaries, and ensures telemetry stays usable.

---

## Roles

| Role               | Responsibilities                                                                        |
| ------------------ | --------------------------------------------------------------------------------------- |
| **Human / PM**     | Defines clear task + acceptance criteria, reviews results, enforces cross-model review. |
| **Worker Agent**   | Picks up a task, updates status/time, posts results, flags blockers.                    |
| **Reviewer Agent** | Opposite-model reviewer for code or high-risk work (see Cross-Model SOP).               |

---

## Lifecycle Overview

| Stage       | Action                                                                                            | Required?   |
| ----------- | ------------------------------------------------------------------------------------------------- | ----------- |
| 0. Intake   | Task created with clear title, description, acceptance criteria, type, project, sprint.           | ✅          |
| 1. Claim    | Agent sets status `in-progress`, starts timer, sets Agent Status → working.                       | ✅          |
| 2. Work     | Agent executes subtasks; marks subtasks complete as it goes.                                      | ✅          |
| 3. Update   | Post intermediate comment(s) or blockers; set status `blocked` if waiting on human.               | As needed   |
| 4. Complete | Stop timer, set status `done`, provide completion summary + attachments, capture lessons learned. | ✅          |
| 5. Review   | Trigger cross-model review if code touched or risk level ≥ medium.                                | ✅ for code |

---

## API Flow

```bash
# ── 1. Claim ──────────────────────────────────────────────
curl -X PATCH http://localhost:3002/api/tasks/<id> \
  -H "Content-Type: application/json" \
  -d '{"status":"in-progress"}'

curl -X POST http://localhost:3002/api/tasks/<id>/time/start

curl -X POST http://localhost:3002/api/agent/status \
  -H "Content-Type: application/json" \
  -d '{"status":"working","taskId":"<id>","taskTitle":"Fix CLI"}'

# ⚠️  Emit run.started telemetry (powers Success Rate + Run Duration graphs)
curl -X POST http://localhost:3002/api/telemetry/events \
  -H "Content-Type: application/json" \
  -d '{"type":"run.started","taskId":"<id>","agent":"<agent-name>"}'

# ── 2. Update (optional comment) ─────────────────────────
curl -X POST http://localhost:3002/api/tasks/<id>/comments \
  -H "Content-Type: application/json" \
  -d '{"text":"Blocked on dependency"}'

# ── 3. Complete ───────────────────────────────────────────
curl -X POST http://localhost:3002/api/tasks/<id>/time/stop

# ⚠️  Emit run.completed telemetry (durationMs = ms since run.started)
curl -X POST http://localhost:3002/api/telemetry/events \
  -H "Content-Type: application/json" \
  -d '{"type":"run.completed","taskId":"<id>","agent":"<agent-name>","durationMs":<DURATION_MS>,"success":true}'

# ⚠️  Report token usage (powers Token Usage + Monthly Budget graphs)
curl -X POST http://localhost:3002/api/telemetry/events \
  -H "Content-Type: application/json" \
  -d '{"type":"run.tokens","taskId":"<id>","agent":"<agent-name>","model":"<model>","inputTokens":<N>,"outputTokens":<N>,"cacheTokens":<N>,"cost":<N>}'

curl -X PATCH http://localhost:3002/api/tasks/<id> \
  -H "Content-Type: application/json" \
  -d '{
    "status":"done",
    "completionSummary":"Added OAuth + tests",
    "lessonsLearned":"Always stub the provider"
  }'

# ── On Failure ────────────────────────────────────────────
# Same as complete, but success=false:
curl -X POST http://localhost:3002/api/telemetry/events \
  -H "Content-Type: application/json" \
  -d '{"type":"run.completed","taskId":"<id>","agent":"<agent-name>","durationMs":<DURATION_MS>,"success":false}'
```

---

---

## ⚠️ Enforcement Gates (Optional)

Veritas Kanban supports **6 enforcement gates** that can harden your workflow by blocking or automating certain transitions. All gates are **disabled by default** and must be explicitly enabled.

**If enforcement gates are enabled, your workflow changes:**

| Gate                     | Impact on Agents                                                      |
| ------------------------ | --------------------------------------------------------------------- |
| `reviewGate`             | Cannot mark `done` unless all 4 review scores = 10                    |
| `closingComments`        | Cannot mark `done` without a comment ≥20 characters                   |
| `autoTelemetry`          | `run.*` events fire automatically — no need to POST manually          |
| `autoTimeTracking`       | Timers auto-start/stop on status change — no manual start/stop needed |
| `squadChat`              | Task status changes auto-post to squad chat                           |
| `orchestratorDelegation` | Warns if orchestrator does implementation work instead of delegating  |

**Check if enforcement is enabled before starting work:**

```bash
curl http://localhost:3002/api/settings/features | jq '.data.enforcement'
```

**Example response:**

```json
{
  "reviewGate": true,
  "closingComments": true,
  "autoTelemetry": false,
  "autoTimeTracking": false,
  "squadChat": false,
  "orchestratorDelegation": false
}
```

**If `reviewGate` or `closingComments` are enabled:**

- Check their requirements BEFORE attempting to mark a task `done`
- The API will return `400 Bad Request` with error code and details if you violate a gate
- See [docs/enforcement.md](enforcement.md) for full error codes and handling guide

**If `autoTelemetry` or `autoTimeTracking` are enabled:**

- You can SKIP manual `run.*` emission and timer start/stop calls
- The system handles it automatically on status changes

**Full enforcement documentation:** [docs/enforcement.md](enforcement.md)

---

## ⚠️ Telemetry Emission (MANDATORY)

The dashboard's **Success Rate**, **Token Usage**, and **Average Run Duration** graphs are powered by `run.*` telemetry events. These are **NOT auto-captured** — agents must emit them manually via `POST /api/telemetry/events`.

> **Exception:** If the `autoTelemetry` enforcement gate is enabled, `run.*` events fire automatically on status changes. Check enforcement settings before emitting manually.

> **This has broken multiple times** when agents lost their instructions. Add these steps to your `AGENTS.md` and treat them as non-negotiable.

| Event           | When                               | Required Fields                                           |
| --------------- | ---------------------------------- | --------------------------------------------------------- |
| `run.started`   | Task claimed / work begins         | `taskId`, `agent`                                         |
| `run.completed` | Task finished (success or failure) | `taskId`, `agent`, `durationMs`, `success`                |
| `run.tokens`    | After each run (token accounting)  | `taskId`, `agent`, `model`, `inputTokens`, `outputTokens` |

**What auto-captures vs. what doesn't:**

- ✅ Auto: `task.created`, `task.status_changed`, `task.archived` (emitted by the VK server)
- ❌ Manual: `run.started`, `run.completed`, `run.tokens` (must be POSTed by agents)

**Token reporting tips:**

- Use your runtime's session/status API to get actual token counts
- Use the real model name (`anthropic/claude-opus-4-6`, not a placeholder)
- Include `cacheTokens` and `cost` when available
- Sub-agents should report their own tokens independently

---

## CLI Flow (fast path)

```bash
vk begin <id>                         # sets in-progress, starts timer, agent status → working
# ...do the work...
vk done <id> "Added OAuth + regression test"
```

Optional helpers:

```bash
vk block <id> "Waiting on design"     # sets blocked + comment
vk unblock <id>                       # returns to in-progress, restarts timer
vk time show <id>                     # verify time entries before completing
```

---

## Prompt Template (Worker Agent)

```
Task: <ID> — <Title>
URL: http://localhost:3000/task/<ID>

1. Set status to in-progress and start the timer (vk begin <id>).
2. Work each subtask; add notes/comments as you go.
3. If blocked, set status blocked + explain why.
4. When finished:
   - Stop timer + set status done (vk done <id> "summary").
   - Attach deliverables / link to repo.
   - Fill the lessons learned field if anything should go into AGENTS/CLAUDE.
5. If you touched code, queue cross-model review task before marking done.
```

Store this under `prompt-registry/agent-task-workflow.md` so every agent run is consistent.

---

## Lessons Learned & Notifications

- Always populate the **Completion Summary**. This becomes the notification that humans skim.
- If the task produced a reusable insight, add it to the **Lessons Learned** field so it surfaces in the global lessons feed (future docs).
- Notify humans via CLI: `vk comment <id> "@channel shipped" --author Veritas`

---

## Squad Chat Integration

Every agent must post to squad chat throughout their work. This is the **glass box** — real-time visibility into what agents are doing.

### Regular Messages (agents post these)

```bash
# Include --model to show which AI model is behind the agent
./scripts/squad-post.sh --model claude-sonnet-4.5 AGENT_NAME "What you're working on" tag1 tag2
```

### System Events (orchestrator posts these)

```bash
# When spawning a sub-agent:
./scripts/squad-event.sh --model claude-sonnet-4.5 spawned AGENT_NAME "Task Title"

# When a sub-agent completes:
./scripts/squad-event.sh completed AGENT_NAME "Task Title" "2m35s"

# When a sub-agent fails:
./scripts/squad-event.sh failed AGENT_NAME "Task Title" "45s"
```

The `--model` flag is optional but recommended — it displays in the UI next to the agent name so humans can see which AI model generated each message.

System events render as divider lines in the UI — visually distinct from regular chat. See [SQUAD-CHAT-PROTOCOL.md](SQUAD-CHAT-PROTOCOL.md) for full details.

---

## Escalation

| Situation               | Action                                                                          |
| ----------------------- | ------------------------------------------------------------------------------- |
| Blocked > 15 minutes    | Set status `blocked`, leave blocker comment, ping PM.                           |
| Time tracking forgotten | Start timer immediately, add manual entry for elapsed time with reason.         |
| Reviewer disagrees      | Re-open task, create subtasks for fixes, keep cross-model reviewer in the loop. |

---

## Crash-Recovery Checkpointing (v3.3)

For long-running tasks, save agent state periodically so work can resume after crashes:

```bash
# Save checkpoint mid-work (secrets auto-sanitized)
curl -X POST http://localhost:3002/api/tasks/<id>/checkpoint \
  -H "Content-Type: application/json" \
  -d '{"state":{"current_step":3,"completed":["step1","step2"],"notes":"Working on step 3"}}'

# On restart, check for existing checkpoint
curl http://localhost:3002/api/tasks/<id>/checkpoint

# Clear after task completion
curl -X DELETE http://localhost:3002/api/tasks/<id>/checkpoint
```

**Rules:**

- Save checkpoints every 5–10 minutes on tasks expected to run >15 minutes.
- Always clear checkpoints after `vk done`.
- Checkpoint payloads are capped at 1MB with 24h auto-expiry.

## Observational Memory (v3.3)

Capture important decisions, blockers, and insights as task observations:

```bash
# Log a decision
curl -X POST http://localhost:3002/api/observations \
  -H "Content-Type: application/json" \
  -d '{"taskId":"<id>","type":"decision","content":"Chose approach X over Y because...","importance":8}'

# Search observations across all tasks
curl "http://localhost:3002/api/observations/search?query=approach+X"
```

**When to create observations:**

- Architectural or design decisions (type: `decision`, importance: 7–10)
- Blockers with workaround details (type: `blocker`)
- Surprising findings or gotchas (type: `insight`)
- Context needed for future work (type: `context`)

## Task Dependencies (v3.3)

Before starting a task, check its dependency status:

```bash
# Check dependencies
curl http://localhost:3002/api/tasks/<id>/dependencies

# If upstream blockers are incomplete, don't start — pick another task instead.
```

Follow this SOP and every task stays audit-friendly, searchable, and trustworthy.

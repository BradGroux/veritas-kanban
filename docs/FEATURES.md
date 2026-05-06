# Features

Complete feature reference for Veritas Kanban v4.0. Every feature, every API endpoint, every configuration option.

For a quick overview, see the [README](../README.md#-what-makes-veritas-kanban-different). For troubleshooting, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

---

## Table of Contents

### Core

- [Board & Task Management](#board--task-management)
- [Subtasks & Dependencies](#subtasks--dependencies)
- [Sprint Management](#sprint-management)
- [Task Templates](#task-templates)

### Development

- [Code Workflow](#code-workflow)
- [GitHub Issues Sync](#github-issues-sync)

### AI Agents

- [Agent Integration](#agent-integration)
- [OpenAI Codex Integration](#openai-codex-integration-v42)
- [Multi-Agent System](#multi-agent-system)
- [Squad Chat](#squad-chat)
- [Agent Registry & Dashboard](#agent-registry--dashboard)
- [PRD-Driven Development](#prd-driven-autonomous-development)
- [Task↔Agent State Sync](#taskagent-state-sync)

### Workflow Engine

- [YAML Pipelines](#workflow-engine)
- [Step Types](#step-types)
- [Run State & Monitoring](#run-state-management)
- [Tool Policies & Session Isolation](#tool-policies)

### Automation & Monitoring

- [Enforcement Gates](#enforcement-gates)
- [Broadcast Notifications](#broadcast-notifications)
- [Task Deliverables](#task-deliverables)
- [Efficient Polling](#efficient-polling)
- [Approval Delegation](#approval-delegation)
- [Lifecycle Hooks](#task-lifecycle-hooks)
- [Activity Feed](#activity-feed)
- [Daily Standup](#daily-standup)

### Dashboard & Analytics

- [Dashboard Widgets](#dashboard--analytics)
- [Telemetry & Metrics](#telemetry--metrics)

### Integration

- [CLI](#cli)
- [MCP Server](#mcp-server)
- [REST API](#api)
- [Notifications](#notifications)
- [Reverse Proxy](#reverse-proxy-ready)

### Platform

- [Security](#security)
- [Performance](#performance)
- [Storage & Architecture](#storage--architecture)
- [Settings & Customization](#settings--customization)
- [Infrastructure & DevOps](#infrastructure--devops)
- [Testing](#testing)
- [Accessibility](#accessibility)

---

## Board & Task Management

The Kanban board is the central interface — a drag-and-drop workspace that reflects your project's state in real time.

![Board overview](../assets/demo-overview.gif)

|                                                       |                                                        |
| ----------------------------------------------------- | ------------------------------------------------------ |
| ![Main board view](../assets/scr-main_overview_1.png) | ![Board with tasks](../assets/scr-main_overview_2.png) |
| ![Board columns](../assets/scr-main_overview_3.png)   | ![Board dark mode](../assets/scr-main_overview_4.png)  |

- **Kanban columns** — Four default columns: To Do, In Progress, Blocked, Done
- **Drag-and-drop** — Move tasks between columns with [@dnd-kit](https://dndkit.com/); reorder within columns; custom collision detection (pointerWithin + rectIntersection fallback) for reliable cross-column moves; tooltips suppressed during drag; local state management for real-time column updates

  ![Drag-and-drop demo](../assets/demo-drag_drop.gif)

- **Task CRUD** — Create, read, update, and delete tasks through the UI or API
- **Create task dialog** — Quick-create with title, type, priority, project, sprint, and description

  ![New task dialog](../assets/scr-new_task.png)

- **Task detail panel** — Slide-out sheet with tabbed sections: Details, Git, Agent, Diff, Review, Preview, Attachments, Metrics

  ![Task details panel](../assets/scr-task_details.png)

  ![Task details list view](../assets/scr-task_details_list.png)

- **Task types** — Configurable type system with icons and color-coded card borders (code, research, content, automation, and custom types)
- **Priority levels** — Low, medium, and high with visual indicators on cards
- **Markdown storage** — Tasks stored as human-readable `.md` files with YAML frontmatter (via [gray-matter](https://github.com/jonschlinkert/gray-matter))
- **Dark/light mode** — Ships dark by default with a toggle in Settings → General → Appearance; persists to localStorage; inline script in `index.html` prevents flash of wrong theme on load
- **Filter bar** — Search tasks by text, filter by project and task type; filters persist in URL query params
- **Bulk operations** — Select multiple tasks to move, archive, or delete in batch; select-all toggle
- **Keyboard shortcuts** — Navigate tasks (j/k, arrows), open (Enter), close (Esc), create (c), move to column (1-4), help (?)
- **Loading skeleton** — Shimmer placeholders while the board loads
- **Blocked column** — Dedicated column for blocked tasks with categorized reasons (waiting on feedback, technical snag, prerequisite, other)
- **Comments** — Add, edit, and delete comments on tasks with author attribution and relative timestamps
- **File attachments** — Upload files to tasks with MIME-type icons, file size display, and text extraction for documents

  ![Task attachments](../assets/scr-task_attachments.png)

- **Task templates** — Create reusable templates with variable interpolation; apply templates to new or existing tasks (v1 format with migration from v0)

  ![Apply task template](../assets/scr-apply_task_template.png)

- **Blueprint preview** — Preview template output before applying
- **Markdown editor** — Rich markdown editing for task descriptions and comments with formatting toolbar, live preview, keyboard shortcuts (Ctrl+B/I/K), syntax highlighting, and dark mode support. Configurable via Settings → Tasks. Added in v3.2.
- **Markdown preview** — Live preview panel for task descriptions
- **Activity log** — Full history of task events (created, updated, status changed, agent started/completed, archived, etc.)

  ![Activity log](../assets/scr-activity_log.png)

- **Archive sidebar** — Searchable archive with filters by project, sprint, and type; paginated (25 per page); one-click restore

  ![Archive sidebar](../assets/scr-archive.png)

- **Archive suggestion banner** — Prompts to archive completed sprint tasks

---

## Subtasks & Dependencies

Break down complex work and manage task ordering with bidirectional dependency graphs.

### Subtasks

- **Subtask creation** — Add subtasks inline with Enter-to-submit
- **Progress tracking** — Visual progress bar on task cards showing completion ratio (e.g., "3/5")
- **Toggle completion** — Check/uncheck subtasks with immediate save
- **Auto-complete** — Optional: automatically mark parent task as done when all subtasks complete
- **Delete subtasks** — Remove individual subtasks

### Task Dependencies

Added in v3.3.0.

- **Bidirectional dependency model** — Tasks can both depend_on other tasks and block other tasks
- **Cycle detection** — DFS algorithm traverses both directions to prevent circular dependency loops
- **Dependency graph API** — `GET /api/tasks/:id/dependencies` returns recursive tree with all upstream and downstream dependencies
- **DependenciesSection UI** — Add/remove dependencies for both directions (depends_on/blocks) with visual feedback
- **TaskCard dependency badges** — Shows count of dependencies and blocked tasks on each card
- **Zod validation** — Input validation on all dependency routes
- **Batch-loaded traversal** — Eliminated N+1 queries with efficient graph traversal
- **Full accessibility** — Keyboard navigation + ARIA labels throughout dependency UI
- **Block status detection** — Tasks with incomplete blockers show a blocked indicator on their card
- **Blocker status display** — See whether each blocker is done (green) or still pending (blocked icon)
- **Dependency removal** — Remove blockers individually from either direction

---

## Sprint Management

Organize work into time-boxed iterations.

### Board & UI

- **Sprint assignment** — Assign tasks to named sprints from the task detail panel
- **Sprint list management** — Create, rename, reorder, and archive sprints through the Manage settings tab
- **Sprint seed migration** — On first run, sprints are auto-discovered from existing task data
- **Reference counting** — See how many tasks are in each sprint
- **Archive suggestion** — Banner prompts to archive all "Done" tasks when a sprint is complete
- **Sprint filtering** — Filter the archive sidebar by sprint
- **Sprint labels** — Sprint names displayed on task cards

### CLI Commands

Added in v3.3.2.

| Command                 | Description                                |
| ----------------------- | ------------------------------------------ |
| `vk sprint list`        | List sprints (`--hidden` / `--json` flags) |
| `vk sprint create`      | Create a sprint with optional description  |
| `vk sprint update`      | Update label, description, or visibility   |
| `vk sprint delete`      | Delete a sprint (`--force` for non-empty)  |
| `vk sprint close`       | Archive completed tasks in a sprint        |
| `vk sprint suggestions` | Show sprints ready to archive              |

Task integration: `vk list -S <sprint>`, `vk create -S <sprint>`, `vk update -S <sprint>`

### MCP Tools

Added in v3.3.2.

| Tool                 | Description                         |
| -------------------- | ----------------------------------- |
| `list_sprints`       | List all sprints                    |
| `create_sprint`      | Create a new sprint                 |
| `update_sprint`      | Update sprint properties            |
| `delete_sprint`      | Delete a sprint                     |
| `close_sprint`       | Archive completed tasks in a sprint |
| `sprint_suggestions` | Get sprints ready to archive        |

Sprint field also surfaced on `list_tasks`, `create_task`, and `update_task` MCP tools.

---

## Task Templates

Create reusable templates for consistent task creation. Added in v1.6.

### Templates Page (`/templates`)

- **Grid view** — All templates displayed in a responsive grid with category grouping
- **Search & filter** — Search templates by name, filter by category
- **Quick actions** — Edit, Preview, Delete, Create Task from any template card
- **Empty state** — Helpful onboarding when no templates exist

### Template Editor

- **Task defaults** — Configure default type, priority, project, agent, description template
- **Subtask templates** — Define subtasks with title and order that auto-create with new tasks
- **Blueprint support** — Multi-task workflows with dependencies between blueprint tasks
- **Validation** — Form validation with clear error messages

### Template Preview

- **Read-only view** — See all template configuration at a glance
- **One-click creation** — Create a new task from the template immediately

### API Endpoints

| Endpoint                         | Method | Description                  |
| -------------------------------- | ------ | ---------------------------- |
| `/api/templates`                 | GET    | List all templates           |
| `/api/templates`                 | POST   | Create new template          |
| `/api/templates/:id`             | GET    | Get template by ID           |
| `/api/templates/:id`             | PUT    | Update template              |
| `/api/templates/:id`             | DELETE | Delete template              |
| `/api/templates/:id/instantiate` | POST   | Create task(s) from template |

---

## Code Workflow

Integrated git workflow from branch creation to merge.

- **Git worktree integration** — Create isolated worktrees per task, tied to dedicated branches
- **Worktree status** — See active worktree path, branch, and base branch in the Git tab
- **Git selection form** — Configure repository, branch name, and base branch when setting up a worktree
- **Diff viewer** — Unified diff view with file tree navigation, hunk-by-hunk display, and line numbers
- **File tree** — Collapsible file tree showing changed files with add/modify/delete indicators
- **Line-level review comments** — Click on diff lines to add inline review comments
- **Review panel** — Submit review decisions: Approve, Request Changes, or Reject — with summary text
- **Approval workflow** — Review state persisted on the task; visual status indicator
- **Merge flow** — One-click merge from the review panel after approval
- **Conflict resolution** — Visual conflict resolver with ours/theirs/manual resolution per file; abort or continue merge
- **GitHub PR creation** — Create pull requests directly from the task detail panel with title, body, and draft toggle
- **PR dialog** — Pre-populated from task title and description; opens the new PR in browser on success

---

## Agent Integration

First-class support for autonomous coding agents.

![Task workflow demo](../assets/demo-task.gif)

- **Agent orchestration** — Start, stop, and monitor AI agents on code tasks from the UI or API
- **Multi-agent support** — Ships with Claude Code, Amp, Copilot, Gemini, and Veritas agents; add completely custom agents via Settings → Agents
- **Agent CRUD management** — Full Add/Edit/Remove for agents in Settings → Agents; add agent form with name, type slug (auto-generated), command, and args; inline edit via pencil icon; remove via trash icon with confirmation (blocked for the default agent); `AgentType` accepts any string slug, not just built-in names
- **Agent request files** — Server writes structured requests to `.veritas-kanban/agent-requests/` for agent pickup
- **Completion callbacks** — Agents call the completion endpoint with success/failure status and summary
- **Multiple attempts** — Retry tasks with different agents; full attempt history preserved with status (pending, running, complete, failed)
- **Attempt history viewer** — Browse past attempts with agent name, status, and log output
- **Time tracking** — Start/stop timer or add manual time entries per task; running timer display with live elapsed counter
- **Time entry management** — View, add, and delete individual time entries with duration parsing (e.g., "1h 30m")
- **Agent status indicator** — Header-level indicator showing global agent state (idle, working, sub-agent mode with count)

  ![Agent activity](../assets/scr-menu_agent_activity.png)

- **Running indicator on cards** — Animated spinner on task cards when an agent is actively working
- **Agent output stream** — Real-time agent output via WebSocket with auto-scroll and clear
- **Send message to agent** — Send text messages to running agents
- **OpenClaw native support** — Built-in integration with [OpenClaw](https://github.com/openclaw/openclaw) (formerly Clawdbot/Moltbot) via gateway URL; sub-agent spawning via `sessions_spawn`
- **Platform-agnostic REST API** — Any platform that can make HTTP calls can drive the full agent lifecycle
- **Automation tasks** — Separate automation task type with pending/running/complete lifecycle, session key tracking, and sub-agent spawning
- **Failure alerts** — Dedicated failure alert service for agent run failures

---

## OpenAI Codex Integration (v4.2)

v4.2 adds first-class OpenAI Codex support: local `codex exec` attempts, SDK-backed Codex sessions, GitHub-native Codex Cloud delegation, Codex-backed workflow-engine steps, and Codex review actions through the existing Veritas task lifecycle.

Implemented:

- **Codex CLI provider** — Runs `codex exec --json` in the task worktree, maps JSONL/stdout/stderr into Veritas attempt logs, records final summaries, and emits run/token telemetry when available.
- **Codex agent defaults** — Adds a disabled-by-default OpenAI Codex agent profile with `codex exec --sandbox workspace-write --json`.
- **Codex SDK provider** — Uses `@openai/codex-sdk` to start durable local Codex threads, stream SDK events into attempt logs, persist `threadId` on attempts, and emit token telemetry from completed turns.
- **Codex Cloud delegation** — Creates scoped `@codex` GitHub issue/PR prompts, records cloud attempt metadata, and links the GitHub artifact back to the Veritas task.
- **Workflow Codex steps** — Executes workflow-engine agent steps through Codex SDK streaming, writes step outputs, and stores Codex thread IDs in workflow session context.
- **Codex review actions** — Reviews task branch diffs in read-only Codex SDK mode, maps structured findings to Veritas review comments, and stores review decisions.
- **Config migration** — Existing configs receive the missing built-in Codex agent without overwriting customized agents.

Still planned:

- **Richer Settings health checks** — Detects Codex install, auth, SDK availability, and profile readiness from Settings.

Planned documentation:

- [OpenAI Codex Integration Roadmap](CODEX-INTEGRATION.md)
- [SOP: OpenAI Codex Integration](SOP-codex-integration.md)
- [Codex Workflow Examples](EXAMPLES-codex-workflows.md)

---

## Multi-Agent System

Full multi-agent orchestration platform with service discovery, assignment, permissions, and communication. Shipped in v2.0.

### Agent Registry

Service discovery and liveness tracking for AI agents.

- **Self-registration** — Agents register via `POST /api/agents/register` with name, model, role, capabilities
- **Heartbeat tracking** — Agents send periodic heartbeats; marked offline after configurable timeout (default 5 min)
- **Status lifecycle** — Online → Busy → Idle → Offline with automatic transitions
- **Capabilities declaration** — Agents declare what they can do (code-review, research, testing, etc.)
- **Stats endpoint** — `GET /api/agents/register/stats` returns total, online, busy, idle, offline counts
- **File-based persistence** — Registry stored in `.veritas-kanban/agent-registry.json`

| Endpoint                                | Method | Description                 |
| --------------------------------------- | ------ | --------------------------- |
| `/api/agents/register`                  | POST   | Register or update an agent |
| `/api/agents/register`                  | GET    | List all registered agents  |
| `/api/agents/register/stats`            | GET    | Registry statistics         |
| `/api/agents/register/:id`              | DELETE | Deregister an agent         |
| `/api/agents/register/:id/heartbeat`    | POST   | Send heartbeat              |
| `/api/agents/register/:id/capabilities` | GET    | Get agent capabilities      |

### Multi-Agent Dashboard Sidebar

Real-time agent monitoring in the board sidebar.

- **Live status cards** — Expandable cards for each registered agent showing status, model, role, last heartbeat
- **Color-coded indicators** — Green (working), purple (sub-agent), gray (idle), red (error)
- **Stats summary bar** — Total, online, busy, idle, offline counts at a glance
- **Auto-refresh** — Polls registry for live updates

### Multi-Agent Task Assignment

Assign multiple agents to a single task.

- **`agents[]` field** — Tasks support an array of assigned agents
- **Color-coded chips** — Agent assignments displayed as colored chips in task detail and board cards
- **Shared helpers** — `@veritas-kanban/shared` utilities for agent color assignment and display

### @Mention Notifications

Directed agent communication in task comments.

- **@agent-name parsing** — Comments parsed for @mentions targeting registered agents
- **Thread subscriptions** — Agents auto-subscribed to tasks they're mentioned in
- **Delivery tracking** — Track which notifications have been delivered to which agents

### Agent Permission Levels

Role-based autonomy control for multi-agent teams.

- **Three tiers** — Intern (requires approval), Specialist (autonomous within scope), Lead (full autonomy)
- **Approval workflows** — Configurable approval requirements per permission level
- **API enforcement** — Permission checks on agent actions, not just UI display

### Error Learning

Structured failure analysis to prevent recurring issues.

- **Failure recording** — Agent failures stored with structured metadata (error type, context, resolution)
- **Similarity search** — Find similar past failures to suggest fixes
- **Stats API** — Aggregate error patterns and frequency analysis
- **Inspired by** @nateherk's Klouse dashboard concept ("spin up agents to analyze what broke")

### Shared Resources Registry

Reusable resources mountable across projects with full CRUD API and Settings tab management. Added in v3.2.

- **Resource types** — Prompts, guidelines, skills, configs, templates
- **Resource CRUD** — Define reusable resources via Settings → Shared Resources
- **Mount/unmount** — Mount resources across projects with full API support
- **API endpoints** — `/api/shared-resources/*` for create, read, update, delete, mount, and unmount operations
- **Version control** — Resources stored as files for git version control
- **Project scoping** — Resources can be global or project-specific
- **Consistency** — Single source of truth for agent behavior across all projects

### Documentation Freshness

Automated staleness detection for project documentation with real-time tracking and alerting. Added in v3.2.

- **Freshness tracking** — Track document staleness with freshness scores, alerts, and optional auto-review task creation
- **Freshness headers** — YAML frontmatter with `fresh-days`, `owner`, `last-verified` fields
- **Steward workflow** — Assigned doc owners responsible for periodic review
- **Staleness API** — Query which docs need review based on freshness thresholds at `/api/doc-freshness`
- **Configurable thresholds** — Set staleness thresholds via Settings → Doc Freshness
- **3-phase automation** — Manual → scheduled checks → CI integration
- **Inspired by** @mvoutov's BoardKit Orchestrator ("stale docs = hallucinating AI")

---

## Squad Chat

Real-time agent-to-agent communication channel for multi-agent collaboration. Shipped in v2.0.

- **WebSocket-powered chat** — Messages broadcast in real time to all connected clients
- **System lifecycle events** — Automatic events for agent spawned, completed, and failed transitions
- **Model attribution** — Each message tagged with the sending agent's model for provenance tracking
- **Configurable display names** — Agents set custom display names for chat identity
- **Squad Chat Webhook** — Configurable webhooks for external integration; supports generic HTTP and OpenClaw Direct modes
- **OpenClaw Direct gateway wake** — Real-time squad chat notifications pushed to OpenClaw gateway for agent orchestration
- **Searchable history** — Browse and search past squad chat messages

### API Endpoints

| Endpoint          | Method | Description                 |
| ----------------- | ------ | --------------------------- |
| `/api/chat/squad` | POST   | Send a squad chat message   |
| `/api/chat/squad` | GET    | Retrieve squad chat history |

---

## Agent Registry & Dashboard

See [Multi-Agent System → Agent Registry](#agent-registry) and [Multi-Agent System → Multi-Agent Dashboard Sidebar](#multi-agent-dashboard-sidebar) above.

---

## PRD-Driven Autonomous Development

Transform product requirements into working code through iterative, quality-gated autonomous execution. An AI agent reads a PRD, breaks it into implementable user stories, autonomously codes each story with quality gates, and iterates until complete—memory preserved through git history and progress files.

**Key capabilities:**

- **Quality-gated execution** — reviewGate (4×10 scoring), closingComments, autoTelemetry ensure deterministic checks
- **Fresh context per iteration** — Each story runs in clean context; no window bloat
- **Compound learning** — Progress files capture lessons; later iterations benefit from earlier ones
- **Real-time monitoring** — Squad Chat provides step-by-step narrative of agent progress
- **Full audit trail** — Git commits + telemetry + time tracking = complete execution record
- **Parallel execution** — Multiple agents can work on different features simultaneously

**Quick start:** Create PRD template with user stories as subtasks → `vk automation:start <task-id>` → monitor Squad Chat → review and merge

**Use when:** Clear requirements, independent stories, measurable quality (tests/linters), small iterations (≤30 min/story), reproducible execution

**Avoid for:** Vague requirements, exploratory work, complex architectural decisions, high-risk changes (migrations, auth), research tasks

→ [Full guide](features/prd-driven-development.md) — setup, agent execution workflow, complete OAuth2 example walkthrough, configuration tips, troubleshooting

---

## Task↔Agent State Sync

Bi-directional sync engine keeping task state consistent with agent execution state, with reconciliation to resolve diverged records. Added in v3.3.2.

- **Bi-directional sync** — Task status changes propagate to agent state, and agent state transitions update task status
- **Reconciliation pass** — Automatic reconciliation detects and resolves diverged task/agent records (e.g., agent marked complete but task still in-progress)
- **Auth boundary hardening** — Tightened authentication checks on sync routes to prevent unauthorized state manipulation (v3.3.2 fix)
- **Consistency guarantees** — Prevents orphaned states where a task says "running" but no agent is active, or an agent is "complete" but the task is still in-progress

---

## Crash-Recovery Checkpointing

Save and resume agent state across crashes and restarts with automatic secret sanitization. Added in v3.3.0.

- **Save/resume/clear API** — `POST /api/tasks/:id/checkpoint` (save), `GET /api/tasks/:id/checkpoint` (resume), `DELETE /api/tasks/:id/checkpoint` (clear)
- **Auto-sanitization of secrets** — Detects and sanitizes 20+ key patterns (API keys, tokens, passwords, etc.) plus regex value detection
- **1MB size limit** — Prevents checkpoint bloat; server rejects payloads exceeding 1MB
- **24h expiry** — Automatic cleanup of stale checkpoints after 24 hours
- **Resume counter** — Tracks restart attempts to prevent infinite loops
- **Sub-agent context injection** — Checkpoint state automatically injected into sub-agent prompts on resume
- **Array sanitization** — Handles nested objects and primitive strings within arrays
- **NaN timestamp handling** — Converts NaN timestamps to null for proper serialization
- **ARIA-accessible UI** — Checkpoint controls in TaskCard and TaskDetailPanel with full keyboard navigation

**Use cases:**

- Agent crashes mid-execution → resume from last checkpoint
- Server restart during long-running task → restore agent context
- Iterative workflows → preserve state between steps

**Example:**

```bash
# Save checkpoint
curl -X POST http://localhost:3001/api/tasks/US-42/checkpoint \
  -H "Content-Type: application/json" \
  -d '{"state":{"current_step":3,"completed":["step1","step2"],"api_key":"sk-1234"}}'

# Resume checkpoint (secrets sanitized in response)
curl http://localhost:3001/api/tasks/US-42/checkpoint
# Returns: {"state":{"current_step":3,"completed":["step1","step2"],"api_key":"[REDACTED]"},...}

# Clear checkpoint
curl -X DELETE http://localhost:3001/api/tasks/US-42/checkpoint
```

---

## Observational Memory

Capture and search critical insights, decisions, blockers, and context across agent workflows. Added in v3.3.0.

- **Add/view/delete observations** — `POST /api/observations`, `GET /api/tasks/:id/observations`, `DELETE /api/observations/:id`
- **Four observation types** — decision, blocker, insight, context with color-coded badges
- **Importance scoring** — Rate observations 1-10 with visual badges (1-3: low, 4-7: medium, 8-10: high)
- **Full-text search** — `GET /api/observations/search?query=...` searches across all observations for all tasks
- **Paginated results** — Search supports limit/offset with max 200 results per page
- **Timeline view** — Chronological display with type-colored badges and importance indicators
- **Activity logging** — All observation changes logged to activity feed for audit trail
- **XSS prevention** — `sanitizeCommentText()` strips script tags and dangerous attributes
- **ARIA-accessible UI** — Range slider for importance, decorative icons properly labeled

**Use cases:**

- Agent makes architectural decision → log as "decision" observation
- Blocked by external dependency → log as "blocker" observation
- Learns better approach → log as "insight" observation
- Needs context for future work → log as "context" observation

**Example:**

```bash
# Add observation
curl -X POST http://localhost:3001/api/observations \
  -H "Content-Type: application/json" \
  -d '{"taskId":"US-42","type":"decision","content":"Chose React Query over Redux for simpler data fetching","importance":8}'

# Search across all tasks
curl "http://localhost:3001/api/observations/search?query=react+query&limit=10"

# Get observations for task
curl http://localhost:3001/api/tasks/US-42/observations
```

---

## Agent Filter

Query tasks by agent name for precise agent workload tracking. Added in v3.3.0.

- **Query parameter** — `GET /api/tasks?agent=name` filters tasks assigned to specific agent
- **Input sanitization** — Agent name trimmed and capped at 100 characters
- **Pagination compatible** — Works with existing `limit`, `offset`, `status` filters
- **JSDoc/OpenAPI documented** — Full API documentation in server code

**Example:**

```bash
# Get all tasks for agent "codex"
curl "http://localhost:3001/api/tasks?agent=codex"

# Get blocked tasks for agent "veritas"
curl "http://localhost:3001/api/tasks?agent=veritas&status=blocked"
```

---

## Workflow Engine

A deterministic multi-step agent orchestration system for repeatable, observable, and reliable agent execution. Think GitHub Actions for AI agents. Shipped in v3.0.

### Overview

The workflow engine transforms Veritas Kanban from an ad-hoc task board into a full-featured agent orchestration platform. Define multi-step pipelines as version-controlled YAML files, execute them with loops, gates, and parallel steps, and monitor everything in real time through the dashboard.

**What it does:**

- Coordinates multiple agents across sequential or parallel steps
- Manages state persistence, retries, and human escalation
- Provides real-time visibility into workflow execution
- Enforces tool policies and session isolation for security

**What it is NOT:**

- Not a general-purpose workflow engine (Temporal, Airflow) — optimized for AI agents
- Not a replacement for OpenClaw — workflows invoke OpenClaw sessions
- Not a programming language — declarative YAML, not imperative scripts

### Core Principles

1. **Deterministic Execution** — Same workflow + same inputs = same execution path (modulo agent non-determinism)
2. **Agent-Agnostic** — Workflows don't care which LLM/agent runs steps (OpenClaw handles that)
3. **YAML-First** — Workflows are version-controlled YAML files, not database records
4. **Observable** — Every step logs outputs, status broadcasts via WebSocket
5. **Fail-Safe** — Explicit retry/escalation policies, no silent failures
6. **Fresh Context by Default** — Each step spawns a fresh OpenClaw session (prevents context bleed)

### Workflow Definitions

Workflows are defined as YAML files stored in `.veritas-kanban/workflows/`:

```yaml
id: feature-dev-simple
name: Feature Development Workflow
version: 1
description: |
  Plan → Implement → Verify pipeline for feature development.

config:
  timeout: 7200 # Max workflow duration (seconds)
  fresh_session_default: true
  progress_file: progress.md
  telemetry_tags: ['workflow', 'feature-dev']

agents:
  - id: planner
    name: Planner
    role: analysis # Maps to tool policy
    model: github-copilot/claude-opus-4.6
    description: Task decomposition specialist

  - id: developer
    name: Developer
    role: coding
    model: github-copilot/claude-sonnet-4.5
    description: Feature implementation

steps:
  - id: plan
    name: 'Plan: Decompose task'
    agent: planner
    type: agent
    fresh_session: true
    input: |
      Decompose this task into implementable stories.

      TASK: {{task.title}}
      {{task.description}}

      Output YAML:
      stories:
        - id: story-1
          title: ...
    output:
      file: plan.yml
    acceptance_criteria:
      - 'Output contains valid YAML'
      - 'At least 3 stories defined'
    on_fail:
      retry: 2
      escalate_to: human
    timeout: 600

  - id: implement
    name: 'Implement: Code stories'
    agent: developer
    type: agent
    input: |
      Implement these stories:
      {{plan.output}}
    output:
      file: implementation.md
    on_fail:
      retry: 1
```

### Step Types

#### 1. Agent Steps

Execute a single agent prompt with configurable retries.

**Configuration:**

```yaml
- id: review
  name: 'Review: Code quality check'
  agent: reviewer
  type: agent
  session:
    mode: fresh # fresh | reuse
    context: minimal # minimal | full | custom
    cleanup: delete # delete | keep
    timeout: 300 # seconds
  input: |
    Review this code:
    {{implement.output}}
  output:
    file: review.md
  acceptance_criteria:
    - 'DECISION: approved'
  on_fail:
    retry: 2
    escalate_to: human
```

**Features:**

- Template rendering with `{{variable}}` and `{{nested.path}}` substitution
- Acceptance criteria validation (substring, regex, JSON path)
- Retry routing: retry same step, retry different step, escalate

#### 2. Loop Steps

Iterate over collections with progress tracking.

**Configuration:**

```yaml
- id: process-stories
  name: 'Process: Implement stories'
  type: loop
  agent: developer
  loop:
    over: '{{plan.stories}}' # Expression returning array
    item_var: story # Variable name for current item
    index_var: index # Loop index variable
    completion: all_done # all_done | any_done | first_success
    fresh_session_per_iteration: true # Spawn new session per iteration
    max_iterations: 20 # Safety limit
    continue_on_error: false # Skip failed iterations
  input: |
    Implement story {{loop.index + 1}}/{{loop.total}}:

    STORY: {{story.title}}
    {{story.description}}

    COMPLETED: {{loop.completed | join(", ")}}
  output:
    file: 'implement-{{loop.index}}.md'
```

**Features:**

- Loop state tracking: `totalIterations`, `currentIteration`, `completedIterations`, `failedIterations`
- Completion policies:
  - `all_done` — All iterations must complete successfully
  - `any_done` — Stop after first successful iteration
  - `first_success` — Stop immediately when one succeeds
- Loop variables in templates: `{{loop.index}}`, `{{loop.total}}`, `{{loop.completed}}`
- Max 1000 iterations safety limit

#### 3. Gate Steps

Conditional blocking with human approval workflow.

**Configuration:**

```yaml
- id: quality-gate
  name: 'Gate: Quality Check'
  type: gate
  condition: '{{test.status == "passed" and verify.decision == "approved"}}'
  on_false:
    escalate_to: human
    escalate_message: 'Quality gate failed — manual review required'
```

**Features:**

- Boolean expressions: `==`, `and`, `or` operators with variable access
- Blocking behavior: run status changes to `blocked` if condition fails
- Approval API: `POST /api/workflow-runs/:runId/steps/:stepId/approve` and `/reject`
- Timeout support (planned)

#### 4. Parallel Steps

Fan-out/fan-in execution with multiple sub-steps running concurrently.

**Configuration:**

```yaml
- id: parallel-tests
  name: 'Parallel: Run test suites'
  type: parallel
  parallel:
    completion: all # all | any | N (number)
    fail_fast: true # Abort others when one fails
    timeout: 1800 # Max wait time (seconds)
    steps:
      - id: unit-tests
        agent: tester
        input: 'Run unit tests'
      - id: integration-tests
        agent: tester
        input: 'Run integration tests'
      - id: e2e-tests
        agent: tester
        input: 'Run E2E tests'
```

**Features:**

- Completion criteria:
  - `all` — All sub-steps must succeed
  - `any` — At least one sub-step must succeed
  - `N` — At least N sub-steps must succeed
- Fail-fast mode aborts remaining sub-steps on first failure
- Aggregated JSON output with per-sub-step status and errors
- Max 50 concurrent sub-steps (soft limit)

### Acceptance Criteria

Step outputs can be validated against acceptance criteria using three formats:

| Format    | Syntax                   | Example                         |
| --------- | ------------------------ | ------------------------------- |
| Substring | Plain text               | `'DECISION: approved'`          |
| Regex     | `/pattern/flags`         | `/^STATUS:\s*done$/i`           |
| JSON Path | `output.path == "value"` | `output.decision == "approved"` |

All three types are backward-compatible — substring matching was the original format.

### Run State Management

Every workflow run persists its state to disk, enabling:

- **Server restart recovery** — Runs can resume from last checkpoint
- **Retry with exponential backoff** — Configurable `retry_delay_ms` prevents rapid retry loops
- **Progress file tracking** — Shared `progress.md` per run for context passing:
  - Each step appends its output with timestamp
  - Templates can access `{{progress}}` for previous step context
  - Templates can access `{{steps.step-id.output}}` for specific step outputs
- **Session tracking** — Session keys stored in `run.context._sessions` per agent

**Run lifecycle:**

```
pending → running → completed
                 ↘ failed
                 ↘ blocked (gate failure, escalation)
```

### Tool Policies

Role-based tool restrictions for least-privilege security.

**Default roles:**

| Role        | Allowed Tools                                            | Denied Tools               | Use Case                                        |
| ----------- | -------------------------------------------------------- | -------------------------- | ----------------------------------------------- |
| `planner`   | Read, web_search, web_fetch, browser, image, nodes       | Write, Edit, exec, message | Analysis and planning — read-only access        |
| `developer` | `*` (all tools)                                          | none                       | Feature implementation — full access            |
| `reviewer`  | Read, exec, web_search, web_fetch, browser, image, nodes | Write, Edit, message       | Code review — can run tests but not modify code |
| `tester`    | Read, exec, browser, web_search, web_fetch, image, nodes | Write, Edit, message       | Testing — can interact with UIs and run tests   |
| `deployer`  | `*` (all tools)                                          | none                       | Deployment operations — full access             |

**Custom policies:**

- Create custom roles via `POST /api/tool-policies`
- Edit existing policies via `PUT /api/tool-policies/:role`
- Delete custom policies (default roles are immutable)
- Settings UI tab for visual management

**Enforcement:**

- Tool filter passed to OpenClaw `sessions_spawn` (ready for integration)
- Denied list takes precedence over allowed list

### Session Isolation

Each workflow step can run in an isolated OpenClaw session.

**Session configuration:**

```yaml
session:
  mode: fresh # fresh | reuse
  context: minimal # minimal | full | custom
  cleanup: delete # delete | keep
  timeout: 300 # seconds
  includeOutputsFrom: [step-1, step-2] # for context: custom
```

**Session modes:**

- **`fresh`** (default) — Spawn a new session for each step
  - Prevents context window bloat
  - Isolates steps from each other
  - Enables agent specialization

- **`reuse`** — Continue the existing session for this agent
  - Preserves conversation history
  - Useful for multi-turn interactions

**Context injection modes:**

- **`minimal`** — Only task metadata and workflow context (smallest context window, best for independent steps)
- **`full`** — All previous step outputs + workflow variables (maximum context, for steps needing comprehensive history)
- **`custom`** — Explicitly list which previous steps' outputs to include (surgical context control)

**Cleanup policies:**

- **`delete`** — Terminate session after step completes (recommended for production)
- **`keep`** — Leave session running for debugging

### Workflow Dashboard

Real-time monitoring for workflow execution.

**Summary cards:**

- Total workflows defined
- Active runs (currently executing)
- Completed runs (period-filtered: 24h/7d/30d)
- Failed runs (period-filtered)
- Average run duration
- Success rate (%)

**Active runs table:**

- Live-updating list of currently executing runs
- Workflow ID, status badge, started time, duration, current step, progress (step X/Y)
- Click to open WorkflowRunView
- Real-time updates via WebSocket
- Visual progress bars

**Recent runs history:**

- Last 50 workflow runs (filterable by status)
- Run ID, status badge, start time, duration, steps completed
- Click to open WorkflowRunView

**Workflow health metrics:**

- Per-workflow success rate
- Per-workflow average duration
- Run counts (total, completed, failed)
- Visual health indicators (green/yellow/red based on success rate)

### Real-Time Updates

**WebSocket-primary architecture:**

- All hooks now WebSocket-primary, polling is safety net only
- When connected: 120s polling intervals (safety net)
- When disconnected: aggressive polling resumes (10-30s)
- Events: `workflow:status` with full run state
- ~75% reduction in API calls when WebSocket connected

**Broadcast service:**

- Centralized `broadcastWorkflowStatus()` sends full run state
- No extra HTTP fetches needed
- Multiple clients can watch the same run (collaborative viewing)

### Workflow API Endpoints

| Endpoint                                       | Method | Description                                       |
| ---------------------------------------------- | ------ | ------------------------------------------------- |
| `/api/workflows`                               | GET    | List all workflows (metadata only)                |
| `/api/workflows/:id`                           | GET    | Get full workflow definition                      |
| `/api/workflows`                               | POST   | Create new workflow                               |
| `/api/workflows/:id`                           | PUT    | Update workflow (auto-increment version)          |
| `/api/workflows/:id`                           | DELETE | Delete workflow                                   |
| `/api/workflows/:id/runs`                      | POST   | Start a workflow run                              |
| `/api/workflow-runs`                           | GET    | List runs (filterable by workflow, task, status)  |
| `/api/workflow-runs/:id`                       | GET    | Get full run state                                |
| `/api/workflow-runs/:id/resume`                | POST   | Resume a blocked run                              |
| `/api/workflow-runs/:id/steps/:stepId/approve` | POST   | Approve a gate step                               |
| `/api/workflow-runs/:id/steps/:stepId/reject`  | POST   | Reject a gate step                                |
| `/api/workflow-runs/active`                    | GET    | List currently running workflows                  |
| `/api/workflow-runs/stats?period=7d`           | GET    | Aggregated statistics (dashboard)                 |
| `/api/tool-policies`                           | GET    | List all tool policies                            |
| `/api/tool-policies/:role`                     | GET    | Get policy for role                               |
| `/api/tool-policies`                           | POST   | Create custom policy                              |
| `/api/tool-policies/:role`                     | PUT    | Update policy                                     |
| `/api/tool-policies/:role`                     | DELETE | Delete custom policy (default policies immutable) |
| `/api/tool-policies/:role/validate`            | POST   | Validate tool access                              |

### Workflow Security

- **ReDoS protection** — Regex patterns validated with size/complexity limits
- **Expression injection prevention** — Template evaluator only supports safe variable access and boolean operators
- **Parallel DoS limits** — Max 50 concurrent sub-steps
- **Gate approval validation** — Authentication and permission checks on approval endpoints
- **Path traversal protection** — `sanitizeFilename` on all file writes
- **RBAC** — Role-based access control with ACL files (`.acl.json`)
- **Audit logging** — All workflow changes logged to `.audit.jsonl`

### Known Limitations

1. **OpenClaw integration placeholder** — Step executors have integration points for OpenClaw sessions API but don't yet call `sessions_spawn` (tracked in #110, #111)
2. **Loop verify step not wired** — `loop.verify_step` is parsed but not executed by workflow engine (tracked for Phase 5)
3. **No schema validation** — Step outputs are not validated against JSON Schema (planned for Phase 5)
4. **Parallel timeouts not enforced** — Parallel steps don't have a global timeout, only sub-step timeouts (planned for Phase 5)

### Reference

- **Architecture doc:** `docs/WORKFLOW_ENGINE_ARCHITECTURE.md`
- **Implementation notes:**
  - Phase 1: `docs/internal/PHASE1_IMPLEMENTATION_NOTES.md`
  - Phase 2: `docs/internal/PHASE2_IMPLEMENTATION_NOTES.md`
  - Phase 3: `docs/internal/PHASE3_IMPLEMENTATION_NOTES.md`
  - Phase 4: `docs/internal/PHASE4_IMPLEMENTATION_NOTES.md`
  - Dashboard: `docs/internal/DASHBOARD_IMPLEMENTATION_NOTES.md`
  - Policies & Sessions: `docs/internal/POLICIES_SESSIONS_IMPLEMENTATION_NOTES.md`

---

## Enforcement Gates

Structural quality gates that prevent workflow violations. Six gates shipped in v3.1, all disabled by default.

### Available Gates

| Gate                     | What It Enforces                                                        |
| ------------------------ | ----------------------------------------------------------------------- |
| `squadChat`              | Agents must post to squad chat at every major step                      |
| `reviewGate`             | Code tasks must pass 4×10 review scoring before completion              |
| `closingComments`        | Tasks require a deliverable summary (≥20 chars) before moving to Done   |
| `autoTelemetry`          | Automatic telemetry event emission on task transitions                  |
| `autoTimeTracking`       | Automatic time tracking start/stop on status changes                    |
| `orchestratorDelegation` | Orchestrator agent must delegate work to sub-agents, not do it directly |

### Orchestrator Delegation Enforcement

Added in v3.3.3. Prevents the orchestrator agent from directly editing files or writing code — it must delegate to sub-agents.

- **Orchestrator agent selector** — Dropdown in Settings → Enforcement to select which agent is the orchestrator (populated from enabled agents list)
- **Active/Inactive badge** — Visual status showing whether delegation enforcement is currently active
- **Warning banner** — Displays when delegation is enabled but no orchestrator agent is selected
- **Section auto-disable** — The orchestrator selector section auto-disables when the delegation toggle is off
- **Zod-validated config** — `orchestratorAgent` field validated as string, max 50 characters
- **Delegation violation endpoint** — `POST /api/agent/delegation-violation` for reporting violations
- **Squad chat auto-posting** — Violations automatically posted to squad chat when squad chat enforcement is enabled

### Toast Notifications

Added in v3.3.3. Enhanced error feedback when enforcement gates block an action.

- **Gate-specific titles** — Each gate type shows a distinct title (e.g., "Review Gate", "Closing Comments Required", "Orchestrator Delegation")
- **Actionable guidance** — Toast messages explain what's needed to satisfy the gate
- **10-second duration** — Enforcement toasts display for 10 seconds (up from the default 5s) to give users time to read
- **BulkActionsBar support** — Gate-specific error details surface when bulk move operations are blocked by enforcement

### Dashboard Enforcement Indicator

Added in v3.3.3. At-a-glance enforcement status visible on the dashboard.

- **Shield icon** — Color-coded shield showing active/total gate count (green when all active, amber when partial, gray when none)
- **Individual gate dots** — Each gate represented as a dot (green = active, gray = off) for quick scanning
- **Dashboard status bar** — Renders alongside the refresh timestamp in the dashboard header

---

## Broadcast Notifications

Priority-based persistent notification system with agent-specific delivery and read receipts. Shipped in v2.0.

- **Priority levels** — Notifications carry priority (low, normal, high, urgent) for triage
- **Agent-specific delivery** — Target notifications to specific agents or broadcast to all
- **Read receipts** — Track which agents have acknowledged notifications
- **Persistent storage** — Notifications persisted to disk, survive server restarts
- **Notification queue** — Unsent notifications queued for batch delivery
- **Per-event toggles** — Enable/disable notification types in Settings → Notifications

### API Endpoints

| Endpoint                      | Method | Description                             |
| ----------------------------- | ------ | --------------------------------------- |
| `/api/notifications`          | POST   | Create a notification                   |
| `/api/notifications`          | GET    | List notifications (filterable)         |
| `/api/notifications/:id/read` | POST   | Mark notification as read               |
| `/api/notifications/pending`  | GET    | Get unsent notifications (Teams format) |

---

## Task Deliverables

First-class deliverable objects attached to tasks with type and status tracking. Shipped in v2.0.

- **Deliverable types** — Code, documentation, data, config, test, and custom types
- **Status tracking** — Pending, in-progress, complete, and rejected lifecycle
- **Task association** — Deliverables linked to parent tasks for traceability
- **Structured metadata** — Each deliverable carries type, status, description, and optional file references
- **Enforcement gate** — `closingComments` gate can require deliverable summary (≥20 chars) before task completion

### API Endpoints

| Endpoint                           | Method | Description                  |
| ---------------------------------- | ------ | ---------------------------- |
| `/api/tasks/:id/deliverables`      | GET    | List deliverables for a task |
| `/api/tasks/:id/deliverables`      | POST   | Add a deliverable to a task  |
| `/api/tasks/:id/deliverables/:did` | PUT    | Update a deliverable         |
| `/api/tasks/:id/deliverables/:did` | DELETE | Remove a deliverable         |
| `/api/scheduled-deliverables`      | GET    | View scheduled deliverables  |

---

## Efficient Polling

Optimized change-detection endpoint for agents that poll instead of using WebSocket. Shipped in v2.0.

- **Change feed** — `GET /api/changes?since=<ISO timestamp>` returns only tasks modified after the given timestamp
- **ETag support** — Responses include `ETag` headers; clients send `If-None-Match` to receive `304 Not Modified` when nothing changed
- **Minimal payload** — Returns only changed task IDs and their new status, reducing bandwidth
- **Agent-friendly** — Designed for headless agents that cannot maintain WebSocket connections
- **Complements WebSocket** — Use WebSocket for real-time UI updates; use `/api/changes` for lightweight agent polling

### API Endpoints

| Endpoint                   | Method | Description                                    |
| -------------------------- | ------ | ---------------------------------------------- |
| `/api/changes?since=<ISO>` | GET    | Get tasks changed since timestamp (ETag aware) |

---

## Approval Delegation

Vacation mode with scoped approval delegation and automatic routing. Shipped in v2.0.

- **Delegation rules** — Delegate approval authority to another agent or user for a defined period
- **Scoped delegation** — Restrict delegation to specific projects, task types, or priority levels
- **Automatic routing** — Approval requests automatically routed to the delegate when the primary approver is unavailable
- **Vacation mode** — Mark yourself as unavailable; all approvals reroute to your configured delegate
- **Audit trail** — All delegated approvals logged with both original approver and delegate for accountability

---

## Task Lifecycle Hooks

Event-driven automation for task status changes. Shipped in v2.0.

- **7 built-in hooks** — subtask-gate, assignee-required, blocked-reason, done-checklist, auto-archive, time-tracking, notification
- **8 lifecycle events** — created, status-changed, assigned, commented, time-started, time-stopped, subtask-completed, archived
- **Custom hooks API** — Register custom hooks that fire on lifecycle events
- **Hook configuration** — Enable/disable hooks, set parameters, define conditions

| Endpoint            | Method | Description                     |
| ------------------- | ------ | ------------------------------- |
| `/api/hooks`        | GET    | List all hooks                  |
| `/api/hooks`        | POST   | Register custom hook            |
| `/api/hooks/:id`    | PUT    | Update hook configuration       |
| `/api/hooks/:id`    | DELETE | Remove hook                     |
| `/api/hooks/events` | GET    | List available lifecycle events |

---

## GitHub Issues Sync

Bidirectional sync between GitHub Issues and your Kanban board.

- **Inbound sync** — Issues with the `kanban` label are automatically imported as tasks
- **Outbound sync** — Status changes push back to GitHub: done → close issue, reopen on todo/in-progress/blocked
- **Comment sync** — Comments are synced between GitHub Issues and task comments
- **Label mapping** — GitHub labels map to task fields: `priority:high` → priority, `type:story` → type
- **Circuit breaker** — Automatic failure detection and backoff for GitHub API calls (18 unit tests covering open/half-open/closed transitions, timeout behaviour, and error thresholds — added in v3.3.2)
- **Polling** — Configurable polling interval for checking new/updated issues
- **Configuration** — Stored in `.veritas-kanban/integrations.json`; sync state in `.veritas-kanban/github-sync.json`
- **`TaskGitHub` interface** — Shared type with `{issueNumber, repo, syncedAt?}` fields on synced tasks
- **API endpoints:**
  - `POST /api/github/sync` — Trigger manual sync
  - `GET /api/github/sync/status` — Last sync info (timestamp, counts, errors)
  - `GET /api/github/sync/config` — Get sync configuration
  - `PUT /api/github/sync/config` — Update sync configuration
  - `GET /api/github/sync/mappings` — List issue↔task mappings
- **CLI commands:** `vk github sync`, `vk github status`, `vk github config`, `vk github mappings`

---

## Activity Feed

Streamlined activity page focused on status history with real-time updates.

### Activity Page

Redesigned in v1.6.

- **Full-width status history** — Redesigned layout removes activity feed column, status history spans full width
- **Clickable task navigation** — Click any status history entry to open the task detail panel
- **Color-coded status badges:**
  - Agent statuses: `working`/`thinking` (green), `sub-agent` (purple), `idle` (gray), `error` (red)
  - Task statuses: `todo` (slate), `in-progress` (amber), `blocked` (red), `done` (blue)
- **Task title colors** — Title text colored to match the new status
- **Unified timeline** — Shows both agent status changes AND task status changes
- **Daily summary panel** — Retained above status history with utilization metrics
- **Keyboard accessible** — Enter/Space to activate clickable entries

### Core Features

- **Dedicated page** — Accessible from header nav via `ViewContext` for board ↔ activity navigation
- **Day grouping** — Status changes grouped by day with clear date headers
- **Real-time updates** — New status changes appear live via WebSocket
- **Agent field** — Entries include the `agent` field for attribution
- **Capacity** — MAX_ACTIVITIES increased from 1,000 to 5,000

---

## Daily Standup

Generate daily standup summary reports via API or CLI.

- **Standup endpoint** — `GET /api/summary/standup?date=YYYY-MM-DD&format=json|markdown|text`
- **Report sections:** Completed (tasks done that day), In-Progress (active work), Blocked (with reasons), Upcoming (next priorities), Stats (counts and velocity)
- **Multiple formats:**
  - `json` — Structured data for programmatic consumption
  - `markdown` — Formatted markdown via `generateStandupMarkdown()`
  - `text` — Plain text via `generateStandupText()`
- **CLI:** `vk summary standup` with flags:
  - `--yesterday` — Generate for previous day
  - `--date YYYY-MM-DD` — Generate for a specific date
  - `--json` — JSON output
  - `--text` — Plain text output

---

## Dashboard & Analytics

Real-time project metrics and telemetry.

|                                                       |                                                       |
| ----------------------------------------------------- | ----------------------------------------------------- |
| ![Metrics overview](../assets/scr-metrics_.png)       | ![Token usage](../assets/scr-metrics_token_usage.png) |
| ![Failed runs](../assets/scr-metrics_failed_runs.png) | ![Export metrics](../assets/scr-export_metrics.png)   |

### Dashboard Widgets

Shipped in v2.0.

- **Widget toggles** — Show/hide individual widgets via settings gear; preferences persisted in localStorage
- **Where Time Went** — Time breakdown by project, sourced from task-cost telemetry with color-coded bars
- **Activity Clock** — 24-hour donut chart showing agent work distribution, sourced from status-history transitions
- **Hourly Activity Chart** — Bar chart with per-hour event counts from status-history
- **Wall Time Toggle** — Total Agent Time + Average Run Duration with explanatory info tooltips
- **Session Metrics** — Session count, success rate, completed/failed/abandoned tracking
- **Markdown rendering** — Rich markdown in task descriptions and comments via MarkdownText component
- **Cost prediction** — Multi-factor cost estimation model (tokens, compute, overhead) for task budgeting
- **Timezone-aware metrics** — Server reports timezone in response `meta`; clients send `?tz=<offset>` for cross-region display

### Dashboard Enforcement Indicator

Added in v3.3.3. At-a-glance enforcement gate status on the dashboard.

- **Shield icon with gate count** — Color-coded: green (all active), amber (partial), gray (none)
- **Individual gate dots** — Green = active, gray = off for each enforcement gate
- **Dashboard status bar** — Renders alongside refresh timestamp

### Filter Bar

- **Time preset pills** — Today, 3 Days, 1 Week, 1 Month, WTD, MTD, YTD, All
- **Custom date range** — From/To date picker for precise filtering
- **Project filter** — Dropdown to filter by project
- **Export button** — Quick access to data export

### Analytics API

New endpoints for advanced metrics and visualization (v1.6):

| Endpoint                      | Description                                                         |
| ----------------------------- | ------------------------------------------------------------------- |
| `GET /api/analytics/timeline` | Task execution timeline with parallelism snapshots                  |
| `GET /api/analytics/metrics`  | Aggregate metrics (parallelism, throughput, lead time, utilization) |

**Timeline endpoint returns:**

- Start/end times from time tracking
- Task assignments and status history
- Parallelism snapshots (concurrent tasks over time)

**Metrics endpoint returns:**

- Parallelism factor (average concurrent tasks)
- Throughput (tasks completed per period)
- Lead time (creation to completion)
- Agent utilization (working time per agent)
- Efficiency metrics (tracked vs total time)

### Core Features

- **Task status overview** — Counts for each column with color-coded metric cards
- **Trend indicators** — Up/down/flat trends with percentage change compared to previous period
- **Blocked task breakdown** — Blocked task counts by category (feedback, technical snag, prerequisite, other)
- **Sprint velocity** — Track task completion rate over time
- **Cost budget tracking** — Token usage and cost metrics with budget cards
- **Agent comparison** — Side-by-side performance metrics across different AI agents (uses `apiFetch()` to properly unwrap the API envelope)
- **Drill-down panels** — Click any metric card to drill into tasks, errors, tokens, or duration details; focus rings use `ring-inset` to prevent clipping
  - **Tasks drill-down** — List of tasks matching the selected metric; clicking a task opens its detail panel (with API fallback for deleted tasks via `open-task` event)
  - **Errors drill-down** — Failed agent runs with error details
  - **Tokens drill-down** — Token usage breakdown by agent and task
  - **Duration drill-down** — Time distribution analysis
- **Trends charts** — Time-series charts for key metrics; rolling average line in vibrant cyan-teal for contrast with the purple theme; bar chart hover uses subtle muted fill instead of white flash
- **Status timeline** — Daily Activity (75%) + Recent Status Changes (25%) side-by-side layout
- **Section collapsing** — Dashboard sections apply `overflow-hidden` only when collapsed
- **Daily digest** — Summary of the day's activity: tasks completed/created, agent runs, token usage, failures and issues
- **Task-level metrics** — Per-task panel showing attempt history, token counts, duration, cost, and status timeline

  ![Task metrics](../assets/scr-task_metrics.png)

- **Export dialog** — Export dashboard data for external analysis

  ![Export metrics](../assets/scr-export_metrics.png)

---

## Telemetry & Metrics

Event-based telemetry system powering dashboard analytics.

- **Event types** — `run.started`, `run.completed`, `run.tokens` for tracking agent execution lifecycle
- **Token tracking** — Input tokens, output tokens, cache tokens, and cost per run
- **Duration tracking** — Millisecond-precision run duration with 7-day cap validation (604,800,000 ms)
- **Retention policy** — Configurable retention period (default: 30 days) with automatic cleanup of old events
- **Compression** — NDJSON event files gzip-compressed after configurable threshold (default: 7 days)
- **Streaming reads** — Large telemetry files streamed instead of loaded into memory
- **Per-task metrics** — `GET /api/metrics/:taskId` returns attempt history, token counts, duration, and cost for a specific task
- **Aggregate metrics** — `GET /api/metrics` returns dashboard-level metrics with time-range filtering

---

## CLI

The `vk` command-line tool for terminal-first workflows. Manage your entire task lifecycle from the terminal.

> 📖 **Full CLI guide:** [CLI-GUIDE.md](CLI-GUIDE.md) — installation, every command, scripting examples, and tips.

### Workflow Commands

Composite commands that orchestrate multiple API calls into a single action.

| Command                  | Description                                                        |
| ------------------------ | ------------------------------------------------------------------ |
| `vk begin <id>`          | Sets in-progress + starts timer + updates agent status to working  |
| `vk done <id> "summary"` | Stops timer + sets done + adds comment + sets agent status to idle |
| `vk block <id> "reason"` | Sets blocked + adds comment with the block reason                  |
| `vk unblock <id>`        | Sets in-progress + restarts timer                                  |

**Under the hood**, `vk begin` orchestrates three API calls (PATCH status, POST time/start, POST agent/status) and `vk done` orchestrates four (POST time/stop, PATCH status, POST comments, POST agent/status). What previously required 6+ curl commands now takes 2.

### Task Commands

| Command             | Alias | Description                                                        |
| ------------------- | ----- | ------------------------------------------------------------------ |
| `vk list`           | `ls`  | List tasks with optional `--status`, `--type`, `--project` filters |
| `vk show <id>`      |       | Show task details (supports partial ID matching)                   |
| `vk create <title>` |       | Create a new task with `--type`, `--priority`, `--project` options |
| `vk update <id>`    |       | Update task fields (`--status`, `--title`, `--priority`, etc.)     |

### Sprint Commands

Added in v3.3.2.

| Command                 | Description                                |
| ----------------------- | ------------------------------------------ |
| `vk sprint list`        | List sprints (`--hidden` / `--json` flags) |
| `vk sprint create`      | Create a sprint with optional description  |
| `vk sprint update`      | Update label, description, or visibility   |
| `vk sprint delete`      | Delete a sprint (`--force` for non-empty)  |
| `vk sprint close`       | Archive completed tasks in a sprint        |
| `vk sprint suggestions` | Show sprints ready to archive              |

### Time Tracking Commands

| Command                                      | Description                                                    |
| -------------------------------------------- | -------------------------------------------------------------- |
| `vk time start <id>`                         | Start the time tracker for a task                              |
| `vk time stop <id>`                          | Stop the time tracker                                          |
| `vk time entry <id> <seconds> "description"` | Add a manual time entry (duration in seconds)                  |
| `vk time show <id>`                          | Display time tracking summary (total, running status, entries) |

### Comment Commands

| Command                               | Description                                    |
| ------------------------------------- | ---------------------------------------------- |
| `vk comment <id> "text"`              | Add a comment to a task                        |
| `vk comment <id> "text" --author Bot` | Add a comment with a custom author attribution |

### Agent Status Commands

| Command                      | Description                                             |
| ---------------------------- | ------------------------------------------------------- |
| `vk agent status`            | Show current agent status (idle, working, sub-agent)    |
| `vk agent working <id>`      | Set to working on a task (auto-fetches task title)      |
| `vk agent idle`              | Set agent status to idle                                |
| `vk agent sub-agent <count>` | Set sub-agent mode with the number of active sub-agents |

### Project Commands

| Command                                                        | Description                                              |
| -------------------------------------------------------------- | -------------------------------------------------------- |
| `vk project list`                                              | List all projects                                        |
| `vk project create "name" --color "#hex" --description "desc"` | Create a new project with optional color and description |

### Agent Commands

| Command                   | Description                                              |
| ------------------------- | -------------------------------------------------------- |
| `vk start <id>`           | Start an agent on a code task (`--agent` to choose)      |
| `vk stop <id>`            | Stop a running agent                                     |
| `vk agents:pending`       | List pending agent requests                              |
| `vk agents:status <id>`   | Check agent running status                               |
| `vk agents:complete <id>` | Mark agent complete (`-s` for success, `-f` for failure) |

### Automation Commands

| Command                       | Alias | Description                        |
| ----------------------------- | ----- | ---------------------------------- |
| `vk automation:pending`       | `ap`  | List pending automation tasks      |
| `vk automation:running`       | `ar`  | List running automation tasks      |
| `vk automation:start <id>`    | `as`  | Start an automation task           |
| `vk automation:complete <id>` | `ac`  | Mark automation complete or failed |

### GitHub Sync Commands

| Command              | Description                                       |
| -------------------- | ------------------------------------------------- |
| `vk github sync`     | Trigger a manual GitHub Issues sync               |
| `vk github status`   | Show last sync status (timestamp, counts, errors) |
| `vk github config`   | View or update GitHub sync configuration          |
| `vk github mappings` | List issue↔task mappings                          |

### Utility Commands

| Command               | Description                                                                    |
| --------------------- | ------------------------------------------------------------------------------ |
| `vk summary`          | Project stats: status counts, project progress, high-priority items            |
| `vk summary standup`  | Daily standup summary (`--yesterday`, `--date YYYY-MM-DD`, `--json`, `--text`) |
| `vk notify <message>` | Create a notification (`--type`, `--title`, `--task` options)                  |
| `vk notify:check`     | Check for tasks that need notifications                                        |
| `vk notify:pending`   | Get pending notifications formatted for Teams                                  |

All commands support `--json` output for machine consumption.

### Workflow Example

A complete task lifecycle from the terminal:

```bash
# Create a new task
vk create "Implement OAuth" --type code --project my-app

# Start working — sets in-progress, starts timer, marks agent working
vk begin <id>

# Work happens...

# Complete with summary — stops timer, sets done, adds comment, marks agent idle
vk done <id> "Added OAuth2 with Google and GitHub providers"
```

---

## MCP Server

Model Context Protocol server for AI assistant integration (Claude Desktop, etc.). 26 tools across task management, agent orchestration, sprint management, and notifications.

### Tools

| Tool                        | Description                                                 |
| --------------------------- | ----------------------------------------------------------- |
| `list_tasks`                | List tasks with optional status/type/project/sprint filters |
| `get_task`                  | Get task by ID (supports partial matching)                  |
| `create_task`               | Create a new task (supports sprint field)                   |
| `update_task`               | Update task fields (supports sprint field)                  |
| `archive_task`              | Archive a task                                              |
| `start_agent`               | Start an AI agent on a code task                            |
| `stop_agent`                | Stop a running agent                                        |
| `list_pending_automation`   | List automation tasks awaiting execution                    |
| `list_running_automation`   | List currently running automation tasks                     |
| `start_automation`          | Start an automation task via sub-agent                      |
| `complete_automation`       | Mark automation complete or failed                          |
| `create_notification`       | Create a notification for Teams delivery                    |
| `get_pending_notifications` | Get unsent notifications formatted for Teams                |
| `check_notifications`       | Check for tasks needing notification                        |
| `get_summary`               | Overall kanban summary (status counts, projects)            |
| `get_memory_summary`        | Task summary formatted for AI memory files                  |
| `list_sprints`              | List all sprints                                            |
| `create_sprint`             | Create a new sprint                                         |
| `update_sprint`             | Update sprint properties                                    |
| `delete_sprint`             | Delete a sprint                                             |
| `close_sprint`              | Archive completed tasks in a sprint                         |
| `sprint_suggestions`        | Get sprints ready to archive                                |

### Resources

| URI                     | Description                  |
| ----------------------- | ---------------------------- |
| `kanban://tasks`        | All tasks                    |
| `kanban://tasks/active` | In-progress and review tasks |
| `kanban://task/{id}`    | Single task by ID            |

### Integration

```json
{
  "mcpServers": {
    "veritas-kanban": {
      "command": "node",
      "args": ["/path/to/veritas-kanban/mcp/dist/index.js"],
      "env": { "VK_API_URL": "http://localhost:3001" }
    }
  }
}
```

---

## Security

Defense-in-depth security model with multiple authentication methods and hardened defaults.

![Security menu](../assets/scr-menu_security.png)

### Authentication

- **JWT authentication** — Password-based user login with JWT session tokens
- **JWT secret rotation** — Secrets can be rotated; previous secrets remain valid during a grace period for seamless session continuity
- **Environment-based JWT secret** — `VERITAS_JWT_SECRET` env var overrides on-disk storage (never written to security.json)
- **Admin key** — Full-access API key via `VERITAS_ADMIN_KEY` (minimum 32 characters enforced)
- **Named API keys** — Multiple API keys with role assignment via `VERITAS_API_KEYS` (format: `name:key:role`)
- **Role-based access control** — Three roles: `admin` (full access), `agent` (read/write tasks and agents), `read-only` (GET only)
- **Localhost bypass** — Configurable unauthenticated localhost access with role assignment (`VERITAS_AUTH_LOCALHOST_ROLE`)
- **Multiple auth methods** — `Authorization: Bearer`, `X-API-Key` header, or `?api_key=` query param (for WebSocket)
- **Weak key detection** — Startup warnings for known weak defaults or keys under 32 characters
- **Password strength indicator** — Visual strength meter in the Security settings tab (weak/fair/good/strong/very strong)
- **Password change** — Change password from the Security settings tab with current password verification

### Network & Headers

- **CSP headers** — Content Security Policy via [Helmet](https://helmetjs.github.io/) with nonce-based script allowlisting
- **CSP nonce middleware** — Per-request nonce generation for inline scripts
- **Rate limiting** — 300 requests/minute per IP (configurable via `RATE_LIMIT_MAX`); sensitive endpoints (auth, settings) limited to 15/min; localhost exempt
- **CORS origin validation** — Configurable allowed origins via `CORS_ORIGINS` env var
- **WebSocket origin validation** — Origin checking on WebSocket upgrade requests

### SSRF Protection

Added in v3.3.3. Server-side request forgery safeguards for all outbound webhook destinations.

- **URL validation** — All webhook URLs validated before outbound requests
- **Private IP blocking** — Prevents webhooks from targeting internal/private IP ranges (10.x, 172.16-31.x, 192.168.x, localhost, link-local)
- **DNS rebinding protection** — Resolved hostnames checked against private IP ranges after DNS resolution
- **Protocol restriction** — Only `http://` and `https://` protocols allowed for webhook targets

### Data Protection

- **MIME type validation** — Server-side file type validation for uploads via [multer](https://github.com/expressjs/multer)
- **Markdown sanitization** — XSS prevention via `sanitizeText()` on all user-generated content
- **Timing-safe comparison** — Credential comparison uses `crypto.timingSafeEqual` to prevent timing attacks
- **Credential redaction** — Sensitive fields stripped from task data in API responses
- **Path traversal protection** — Input validation to prevent directory traversal in file operations
- **Prototype pollution protection** — Settings validation prevents `__proto__` and constructor injection
- **Zod schema validation** — All API inputs validated with [Zod](https://zod.dev/) schemas (fully migrated to Zod 4 in v3.3.3)

---

## Performance

Optimizations spanning server, frontend, and data lifecycle.

### Server

- **In-memory task caching** — Tasks cached in memory with file-system watchers for invalidation
- **Config caching** — Configuration cached with write-through invalidation
- **Gzip compression** — Response compression via [compression](https://github.com/expressjs/compression) middleware
- **Pagination** — Archive and list endpoints support paginated responses
- **Summary mode** — Lightweight task summaries (fewer fields) for list views
- **WebSocket-aware polling** — Frontend reduces polling frequency when WebSocket is connected
- **Telemetry retention** — Configurable retention period (default: 30 days) with automatic cleanup of old events
- **Telemetry compression** — NDJSON event files gzip-compressed after configurable threshold (default: 7 days)
- **Cache-control headers** — `Last-Modified` and conditional response support
- **WebSocket broadcast batching** — Batch broadcasts to prevent event loop blocking under high-frequency update load (added in v3.3.3)

### Frontend

- **Lazy-loaded dashboard** — Dashboard with recharts + d3 (~800KB) split into a separate chunk, loaded on demand
- **Vendor chunk splitting** — 69% bundle size reduction via Vite code splitting
- **Lazy-loaded settings tabs** — Each of the 8 settings tabs loaded on demand with skeleton placeholders
- **Memoized task cards** — Custom `React.memo` comparison function avoids unnecessary re-renders from React Query refetches
- **Debounced saves** — Task edits debounced to reduce API calls
- **Loading skeletons** — Board, settings tabs, and dashboard show shimmer placeholders during load

---

## Settings & Customization

Modular settings system with 8 focused tabs.

|                                                           |                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| ![General settings](../assets/scr-settings_general.png)   | ![Board settings](../assets/scr-settings_board.png)                |
| ![Task settings](../assets/scr-settings_tasks.png)        | ![Agent settings](../assets/scr-settings_agents.png)               |
| ![Data settings](../assets/scr-settings_data.png)         | ![Notification settings](../assets/scr-settings_notifications.png) |
| ![Security settings](../assets/scr-settings_security.png) | ![Manage settings](../assets/scr-settings_manage.png)              |

| Tab               | What It Controls                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| **General**       | Application-wide preferences, appearance (dark/light mode toggle with moon/sun icon)                           |
| **Board**         | Column visibility and board layout                                                                             |
| **Tasks**         | Default values, auto-complete behavior                                                                         |
| **Agents**        | Agent CRUD (add/edit/remove), default agent selection, custom agent types with any string slug                 |
| **Data**          | Storage, telemetry retention settings                                                                          |
| **Notifications** | Per-event notification toggles (task complete, agent failed, review ready, etc.)                               |
| **Security**      | Password change with strength indicator, API key display                                                       |
| **Manage**        | Managed lists: projects, sprints, and task types with drag-to-reorder, rename, archive, and reference counting |

### Architecture

- **Lazy-loaded tabs** — Each tab loaded on demand with Suspense fallback skeletons
- **Error boundaries per tab** — Crash in one tab doesn't take down the dialog; recovery button to retry
- **Debounced auto-save** — Settings changes saved automatically with visual save indicator
- **Import/Export** — Backup all settings to JSON; restore with validation
- **Reset to defaults** — Per-section reset with confirmation
- **Managed list manager** — Reusable sortable list component with drag-and-drop reordering (used for projects, sprints, task types)

---

## API

RESTful API designed for both human and AI agent consumption.

### Versioning

- **Versioned paths** — `/api/v1/tasks` (canonical) and `/api/tasks` (backwards-compatible alias)
- **Version header** — Every response includes `X-API-Version: v1`
- **Client version request** — Clients may send `X-API-Version` header
- **Deprecation policy** — Breaking changes introduce a new version; previous version remains available during deprecation

### Endpoints

| Route Prefix                         | Description                                                   |
| ------------------------------------ | ------------------------------------------------------------- |
| `/api/v1/tasks`                      | Task CRUD, listing, reordering                                |
| `/api/v1/tasks/archived`             | Archive listing, restore                                      |
| `/api/v1/tasks/:id/time`             | Time tracking (start, stop, entries)                          |
| `/api/v1/tasks/:id/comments`         | Comments (add, edit, delete)                                  |
| `/api/v1/tasks/:id/subtasks`         | Subtask management                                            |
| `/api/v1/tasks/:id/attachments`      | File attachments (upload, download, delete)                   |
| `/api/v1/tasks/:id/checkpoint`       | Crash-recovery checkpointing (save, resume, clear)            |
| `/api/v1/tasks/:id/dependencies`     | Dependency graph (add, remove, traverse)                      |
| `/api/v1/tasks/:id/observations`     | Observational memory (add, view, delete)                      |
| `/api/v1/config`                     | Board configuration                                           |
| `/api/v1/settings`                   | Feature settings                                              |
| `/api/v1/agents`                     | Agent start, stop, status, attempts, completion               |
| `/api/v1/agent/status`               | Global agent status indicator                                 |
| `/api/v1/agent/delegation-violation` | Orchestrator delegation violation reporting                   |
| `/api/v1/automation`                 | Automation task lifecycle                                     |
| `/api/v1/diff`                       | Diff summaries and file diffs                                 |
| `/api/v1/conflicts`                  | Merge conflict status and resolution                          |
| `/api/v1/github`                     | GitHub PR creation and Issues sync                            |
| `/api/v1/github/sync`                | GitHub Issues sync (trigger, status, config, mappings)        |
| `/api/v1/summary`                    | Project summary, memory-formatted summary, and standup        |
| `/api/v1/summary/standup`            | Daily standup summary (json, markdown, text)                  |
| `/api/v1/notifications`              | Notification CRUD and Teams-formatted pending                 |
| `/api/v1/templates`                  | Task template management                                      |
| `/api/v1/task-types`                 | Custom task type management                                   |
| `/api/v1/projects`                   | Project list management                                       |
| `/api/v1/sprints`                    | Sprint list management                                        |
| `/api/v1/observations`               | Observation search across all tasks                           |
| `/api/v1/activity`                   | Activity log with filtering (agent, type, taskId, date range) |
| `/api/v1/activity/filters`           | Distinct agents and types for activity filter dropdowns       |
| `/api/v1/status-history`             | Task status history and daily summary                         |
| `/api/v1/preview`                    | Markdown preview rendering                                    |
| `/api/v1/telemetry`                  | Telemetry event recording and querying                        |
| `/api/v1/metrics`                    | Dashboard metrics and task-level metrics                      |
| `/api/v1/traces`                     | Request traces                                                |
| `/api/v1/digest`                     | Daily digest generation                                       |
| `/api/v1/changes`                    | Efficient polling change feed                                 |
| `/api/v1/agents/register`            | Agent registry (register, list, heartbeat, stats, deregister) |
| `/api/v1/agents/permissions`         | Agent permission levels and approval workflows                |
| `/api/v1/hooks`                      | Task lifecycle hooks (list, create, update, delete, events)   |
| `/api/v1/errors`                     | Error learning (record, search, stats)                        |
| `/api/v1/docs`                       | Documentation freshness (list, staleness, verify)             |
| `/api/v1/reports`                    | PDF report generation                                         |
| `/api/v1/scheduled-deliverables`     | Scheduled deliverables view                                   |
| `/api/v1/shared-resources`           | Shared resources CRUD and mount/unmount                       |
| `/api/v1/doc-freshness`              | Documentation freshness tracking                              |
| `/api/v1/workflows`                  | Workflow CRUD and run management                              |
| `/api/v1/workflow-runs`              | Workflow run state, stats, and approval                       |
| `/api/v1/tool-policies`              | Tool policy CRUD and validation                               |
| `/api/v1/analytics`                  | Timeline and aggregate metrics                                |
| `/api/v1/chat/squad`                 | Squad chat messages                                           |

### Authentication Methods

1. `Authorization: Bearer <token>` header (JWT or API key)
2. `X-API-Key: <key>` header
3. `?api_key=<key>` query parameter (for WebSocket connections)

### Real-Time Updates

- **WebSocket server** — Real-time task change broadcasts on `ws://localhost:3001`
- **WebSocket connection indicator** — UI shows connected/disconnected status

  ![WebSocket activity](../assets/scr-menu_websocket_activity.png)

- **Agent output streaming** — Live agent output over WebSocket
- **Broadcast service** — Centralized WebSocket message dispatch for task changes
- **Broadcast batching** — Batched broadcasts prevent event loop blocking under high-frequency updates (v3.3.3)

### Response Format

All responses use a standardized envelope format:

**Success:**

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2026-02-01T00:00:00.000Z",
    "requestId": "uuid-v4",
    "timezone": "UTC-06:00",
    "utcOffset": -6
  }
}
```

**Error:**

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Task not found",
    "details": { ... }
  },
  "meta": {
    "timestamp": "2026-02-01T00:00:00.000Z",
    "requestId": "uuid-v4"
  }
}
```

**Pagination** (on paginated endpoints via `sendPaginated` helper):

```json
{
  "success": true,
  "data": [ ... ],
  "meta": {
    "timestamp": "...",
    "requestId": "...",
    "page": 1,
    "limit": 25,
    "total": 142,
    "totalPages": 6
  }
}
```

- 4 typed error classes: `UnauthorizedError`, `ForbiddenError`, `BadRequestError`, `InternalError`
- `X-API-Version` header on all responses
- `X-Request-Id` header for request tracing
- `Last-Modified` headers for cache validation

---

## Notifications

Event-driven notifications with Teams integration.

- **Microsoft Teams integration** — Notifications formatted for Teams delivery with type-specific emoji icons
- **Notification types** — Agent complete (✅), agent failed (❌), needs review (👀), task done (🎉), high priority (🔴), error (⚠️), milestone (🏆), info (ℹ️)
- **Pending notifications queue** — Unsent notifications queued for batch delivery
- **Mark-sent tracking** — Track which notifications have been delivered
- **Auto-detection** — `notify:check` scans for tasks needing notification (review-ready, agent failures, etc.)
- **Per-event toggles** — Enable/disable notifications per event type in the Notifications settings tab
- **Notification enrichment** — Task title and project automatically attached when task ID provided

---

## Reverse Proxy Ready

Deploy Veritas Kanban behind nginx, Caddy, Traefik, or any reverse proxy. Added in v2.1.1.

- **`TRUST_PROXY` environment variable** — Set to `true`, `1`, or a comma-separated list of trusted proxy IPs/CIDRs
- **Correct client IP resolution** — With `TRUST_PROXY` enabled, Express reads the real client IP from `X-Forwarded-For` headers
- **Secure cookies** — When behind a TLS-terminating proxy, session cookies respect `X-Forwarded-Proto`
- **Rate limiting accuracy** — Rate limits apply to the real client IP, not the proxy's IP
- **WebSocket passthrough** — WebSocket connections work through reverse proxies with standard `Upgrade` header forwarding

### Example Configurations

**nginx:**

```nginx
location / {
    proxy_pass http://localhost:3001;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

**Environment:**

```bash
TRUST_PROXY=true
```

---

## Storage & Architecture

Abstract storage layer that decouples business logic from the filesystem.

- **Repository pattern** — 5 repository interfaces abstract data access: `ActivityRepository`, `TemplateRepository`, `StatusHistoryRepository`, `ManagedListRepository`, `TelemetryRepository`
- **StorageProvider** — Central provider extended with all repository implementations; services depend on interfaces, not filesystem calls
- **`fs-helpers.ts`** — Centralized filesystem access module; the only file in the codebase that imports `fs` directly
- **Service migration** — All 10 services migrated off direct `fs` imports to use the repository interfaces
- **Extensibility** — Repository interfaces enable future storage backends (database, cloud storage) without changing service logic

---

## Infrastructure & DevOps

Production-ready deployment and development tooling.

### Docker

- **Multi-stage build** — 5-stage Dockerfile (deps → build-shared → build-web → build-server → production)
- **Non-root execution** — Production image runs as non-root user
- **Alpine-based** — Minimal `node:22-alpine` base image
- **Layer caching** — Workspace config and lockfile copied first for optimal Docker layer caching
- **Frozen lockfile** — `pnpm install --frozen-lockfile` for reproducible builds
- **Path standardization** — Shared `paths.ts` utility ensures correct path resolution in containerized environments (v2.1.3)
- **Runtime state persistence** — Auth/config state routed through `getRuntimeDir()` and migrated on startup (v3.2)

### CI/CD

- **GitHub Actions** — CI pipeline on push to `main` and pull requests
- **Concurrency control** — In-progress runs cancelled when new commits push
- **Pipeline jobs** — Lint & type check, workspace unit tests, production build, and security audit
- **pnpm caching** — Dependency cache for faster CI runs

### Development

- **Pre-commit hooks** — [Husky](https://typicode.github.io/husky/) triggers lint-staged on commit
- **lint-staged** — Runs ESLint on staged files
- **Gitleaks** — Pre-commit secret scanning via [gitleaks](https://gitleaks.io/) (`.pre-commit-config.yaml`)
- **Concurrent dev servers** — `pnpm dev` starts both web and API servers simultaneously
- **ESLint** — Linting across all packages
- **TypeScript strict mode** — Full strict checking across the monorepo

### Observability

- **Structured logging** — [Pino](https://getpino.io/) for JSON-structured server logs with pretty-printing in development
- **Request ID middleware** — Unique ID assigned to every request for distributed tracing
- **Request traces** — Full request trace service for debugging
- **Graceful shutdown** — Clean service disposal on SIGTERM/SIGINT
- **Unhandled error handlers** — Catches unhandled rejections and exceptions at the process level

---

## Testing

Multi-layer testing strategy.

### Unit Tests (Vitest)

- **61 test files** · **1,143 tests passing** across server and frontend
- **Server (51 files, 1,033 tests):**
  - All middleware (auth, rate limiting, request ID, API versioning, cache control, validation, response envelope, request timeout)
  - Core services (task, template, telemetry, notification, activity, sprint, diff, conflict, summary, status history, digest, attachment, text extraction, migration, managed list, broadcast, automation, blocking, failure alert, metrics, settings, JWT rotation, MIME validation, preview, trace, circuit breaker)
  - Route handlers (tasks, task archive, task comments, task subtasks, task time, auth, agent status, automation, config, notifications, templates, health, misc routes)
  - Schema validation (common, task mutation, auth, config, telemetry, metrics, time, archive, agent, feature settings, conflict, diff, preview)
  - WebSocket origin validation
  - Prometheus metrics (counters, gauges, histograms, registry, collector middleware)
  - Environment variable validation
  - Circuit breaker transitions (18 tests covering open/half-open/closed states — added in v3.3.2)
- **Frontend (10 files, 110 tests):**
  - API client helpers and task operations
  - Custom hooks: useWebSocket, useKeyboard (keyboard shortcuts)
  - Components: KanbanBoard, TaskCard, ErrorBoundary, AgentStatusIndicator, WebSocketIndicator
  - Shared test utilities with mock factories and providers
  - HTML/XSS sanitization (sanitizeHtml, sanitizeText)

### End-to-End Tests (Playwright)

- **7 spec files** covering critical user flows
- **19/19 tests passing**
- **Test suites:**
  - Health check
  - Settings management
  - Task creation
  - Task detail panel
  - Task list/board
  - Task status transitions
- **Helpers module** for shared test utilities

---

## Accessibility

Working toward WCAG 2.1 AA compliance.

- **ARIA labels** — Applied to interactive elements: buttons, dialogs, form controls, navigation
- **Keyboard navigation** — Full keyboard support: j/k navigation, Enter to open, Esc to close, number keys for column moves
- **Keyboard shortcuts dialog** — Discoverable via `?` key with grouped shortcut reference

  ![Keyboard shortcuts](../assets/scr-menu_keyboard.png)

- **Focus management** — Focus trapped in dialogs and sheets; restored on close
- **Screen reader support** — Semantic HTML, ARIA roles, and descriptive labels throughout
- **Color contrast** — Dark and light mode palettes designed for readability; purple primary (`270° 50% 40%`) buttons with white text in dark mode
- **Skip navigation** — Keyboard users can navigate efficiently between sections
- **Sortable list accessibility** — Drag-and-drop lists in settings include keyboard-accessible reordering
- **Interactive cards** — Task cards, metric cards, and stat cards support keyboard activation (Enter/Space)
- **Error boundaries** — Crash recovery UI accessible via keyboard

---

---

## v4.0 Features

### Agent Policy & Guard Engine

Define what agents are allowed to do. The Policy Engine lets you create configurable tool/action policies with guard rules, evaluated at runtime before any agent executes a tool or action. Every evaluation decision is logged for audit.

**Key capabilities:**

- Define policies scoped to a specific agent, project, or globally
- Guard rule actions: `allow`, `deny`, `require-approval`
- Configurable precedence: `deny-first` (default) or `allow-first`
- Policy conditions: match by tool name, action type, agent, project, or arbitrary metadata
- Every policy evaluation is logged in the built-in audit log
- `POST /api/policies/:id/evaluate` for programmatic pre-flight checks

**API endpoints:**

| Method   | Path                         | Description                         |
| -------- | ---------------------------- | ----------------------------------- |
| `GET`    | `/api/policies`              | List all policies                   |
| `POST`   | `/api/policies`              | Create a policy                     |
| `GET`    | `/api/policies/:id`          | Get a single policy                 |
| `PUT`    | `/api/policies/:id`          | Update a policy                     |
| `DELETE` | `/api/policies/:id`          | Delete a policy                     |
| `POST`   | `/api/policies/:id/evaluate` | Evaluate a policy against an action |

**Related:** `server/src/routes/policies.ts` · `shared/src/types/policy.types.ts` · `docs/SOP-agent-policy-engine.md`

---

### Decision Audit Trail with Assumption Tracking

Log structured decision records for every significant agent choice. Each decision captures the rationale, confidence score, supporting evidence, and stated assumptions. After execution, record the outcome to see whether the decision was sound and whether assumptions held.

**Key capabilities:**

- Structured records: decision text, confidence (0–1), evidence array, assumptions array
- Outcome recording: what happened, whether assumptions held, a retrospective rating
- Full-text search and filtering by agent, task, confidence range, and date range
- Queryable from MCP for agent self-review
- Aggregate analysis: frequency, confidence trends, assumption hit rate

**API endpoints:**

| Method  | Path                                  | Description                                            |
| ------- | ------------------------------------- | ------------------------------------------------------ |
| `GET`   | `/api/decisions`                      | List decisions (filterable by agent, task, confidence) |
| `POST`  | `/api/decisions`                      | Log a new decision                                     |
| `GET`   | `/api/decisions/:id`                  | Get a single decision                                  |
| `PATCH` | `/api/decisions/:id/assumptions/:idx` | Update an assumption by index                          |

**Related:** `server/src/routes/decisions.ts` · `shared/src/types/decision.types.ts` · `docs/SOP-decision-audit-trail.md`

---

### Agent Output Evaluation & Scoring Framework

Define scoring profiles with weighted criteria and evaluate agent outputs against them. Get a composite score, per-scorer breakdown, and per-dimension explanations that make quality regressions auditable.

**Key capabilities:**

- Four scorer types: `RegexMatch`, `KeywordContains`, `NumericRange`, `CustomExpression`
- Weighted scorers with optional `target`: `action`, `output`, or `combined`
- Composite scoring methods: `weightedAvg`, `minimum`, `geometricMean`
- Per-evaluation history with scorer-level breakdowns
- Attach evaluations to a task (`taskId`) or agent (`agent`) for trend analysis

**API endpoints:**

| Method   | Path                        | Description                          |
| -------- | --------------------------- | ------------------------------------ |
| `GET`    | `/api/scoring/profiles`     | List scoring profiles                |
| `POST`   | `/api/scoring/profiles`     | Create a profile                     |
| `GET`    | `/api/scoring/profiles/:id` | Get a profile                        |
| `PUT`    | `/api/scoring/profiles/:id` | Update a profile                     |
| `DELETE` | `/api/scoring/profiles/:id` | Delete a profile                     |
| `POST`   | `/api/scoring/evaluate`     | Evaluate an output against a profile |
| `GET`    | `/api/scoring/history`      | Get evaluation history               |

**Related:** `server/src/routes/scoring.ts` · `docs/SOP-output-evaluation.md`

---

### Behavioral Drift Detection & Alerting

Define metric baselines for agents and get alerted when behavior deviates beyond configured thresholds. Drift records track status lifecycle (`ok` → `warning` → `alert` → `resolved`) and timestamps for detection and resolution events.

**Key capabilities:**

- Track any numeric metric with a name, baseline, current value, and threshold
- Alert types: `z-score`, `percentage-change`, `absolute-deviation`
- Drift status lifecycle with automatic timestamp tracking
- Manual or programmatic resolution with notes
- Queryable by agent, status, and date range

**API endpoints:**

| Method | Path                                | Description                         |
| ------ | ----------------------------------- | ----------------------------------- |
| `GET`  | `/api/drift/alerts`                 | List drift alerts                   |
| `POST` | `/api/drift/alerts/:id/acknowledge` | Acknowledge a drift alert           |
| `GET`  | `/api/drift/baselines`              | List agent metric baselines         |
| `POST` | `/api/drift/baselines/reset`        | Reset baselines for an agent/metric |
| `POST` | `/api/drift/analyze`                | Trigger drift analysis for an agent |

**Related:** `server/src/routes/drift.ts` · `shared/src/types/drift.types.ts` · `docs/SOP-behavioral-drift-detection.md`

---

### User Feedback Loop with Sentiment Analytics

Collect feedback on agent outputs from users, tag it with sentiment and categories, and query aggregate analytics to identify patterns and improvement areas.

**Key capabilities:**

- Feedback items: content text, sentiment (`positive`/`neutral`/`negative`), category tags
- Link feedback to a task (`taskId`) and/or agent (`agent`)
- Analytics endpoint: sentiment breakdowns, trends over time, top categories
- Filter by agent, task, sentiment, date range
- Soft-delete support (feedback can be removed without breaking analytics history)

**API endpoints:**

| Method   | Path                      | Description                       |
| -------- | ------------------------- | --------------------------------- |
| `GET`    | `/api/feedback`           | List feedback items               |
| `POST`   | `/api/feedback`           | Submit feedback                   |
| `GET`    | `/api/feedback/:id`       | Get a single item                 |
| `DELETE` | `/api/feedback/:id`       | Delete a feedback item            |
| `GET`    | `/api/feedback/analytics` | Get aggregate sentiment analytics |

**Related:** `server/src/routes/feedback.ts` · `shared/src/types/feedback.types.ts` · `docs/SOP-user-feedback.md`

---

### Draggable & Resizable Dashboard Widget Grid

The dashboard is now fully customizable. Widgets can be repositioned via drag-and-drop and resized to fit your workflow. Layouts persist to `settings.json` so your arrangement survives page reloads and server restarts.

**Key capabilities:**

- Drag widgets to any grid position; snap-to-grid keeps layouts clean
- Resize handles on every widget; minimum and maximum size constraints per widget type
- Layout persistence via the settings API — no extra config needed
- Widget library: add/remove widgets from a catalog panel
- All existing widgets (task metrics, agent status, recent activity, squad chat) supported

**Related:** `web/src/components/DraggableWidgetGrid` · `docs/FEATURES.md` (this file)

---

### Prompt Template Registry with Version Control

A centralized library for managing prompt templates used across your agent fleet. Templates are versioned, variable-extracted, and usage-tracked. Roll back to any previous version with a single API call.

**Key capabilities:**

- Template CRUD with variable extraction: `{{variable_name}}` syntax auto-detected
- Full version history — every save creates an immutable version entry with optional changelog
- Rollback: promote any historical version to current
- Preview rendering: POST sample variable values and get the rendered prompt back
- Usage tracking: log which model, how many tokens, and the rendered output (optional)
- Stats endpoint: total uses, average tokens, most recent use

**API endpoints:**

| Method   | Path                                       | Description                              |
| -------- | ------------------------------------------ | ---------------------------------------- |
| `GET`    | `/api/prompt-registry`                     | List all templates                       |
| `POST`   | `/api/prompt-registry`                     | Create a new template                    |
| `GET`    | `/api/prompt-registry/:id`                 | Get a template                           |
| `PATCH`  | `/api/prompt-registry/:id`                 | Update a template (auto-versions)        |
| `DELETE` | `/api/prompt-registry/:id`                 | Delete a template                        |
| `GET`    | `/api/prompt-registry/:id/versions`        | List all versions of a template          |
| `GET`    | `/api/prompt-registry/:id/usage`           | Get usage history                        |
| `GET`    | `/api/prompt-registry/:id/stats`           | Get usage statistics                     |
| `GET`    | `/api/prompt-registry/stats/all`           | Aggregate stats across all templates     |
| `POST`   | `/api/prompt-registry/:id/render-preview`  | Render a preview with variable injection |
| `POST`   | `/api/prompt-registry/:id/record-usage`    | Record a usage event                     |
| `POST`   | `/api/prompt-registry/templates/:id/usage` | Log a template usage                     |

**Related:** `server/src/routes/prompt-registry.ts` · `shared/src/types/prompt-registry.types.ts` · `docs/SOP-prompt-registry.md`

---

### Global System Health Status Bar

A persistent header status bar that gives you a real-time overview of system health across three signal categories: system resources, agent availability, and operation success rate. Five health levels from `stable` to `alert` tell you at a glance when something needs attention.

**Key capabilities:**

- Five health levels: `stable` · `reviewing` · `drifting` · `elevated` · `alert`
- Three signal categories:
  - **System:** storage usage, disk space, memory
  - **Agents:** online vs offline agent counts
  - **Operations:** success rate, recent run counts
- Expand/collapse detail panel inline in the header
- Configurable thresholds via settings
- REST API for programmatic polling or external monitoring

**API endpoints:**

| Method | Path                    | Description                        |
| ------ | ----------------------- | ---------------------------------- |
| `GET`  | `/api/v1/system/health` | Get current system health snapshot |

**Related:** `server/src/routes/system-health.ts` · `shared/src/types/system-health.types.ts` · `web/src/components/SystemHealthBar` · `docs/SOP-system-health-monitoring.md`

---

_Last updated: 2026-03-21 · [Back to README](../README.md)_

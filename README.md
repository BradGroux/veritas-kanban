<div align="center">

# ⚖️ Veritas Kanban

_Veritas in actis — Truth in action._

**Local-first task management and AI agent orchestration platform.**

Built for developers who want a visual Kanban board that works with autonomous coding agents.

[![CI](https://github.com/BradGroux/veritas-kanban/actions/workflows/ci.yml/badge.svg)](https://github.com/BradGroux/veritas-kanban/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-3.3.0-blue.svg)](CHANGELOG.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

![Veritas Kanban — Board Overview](assets/demo-overview.gif)

> 🎬 [Watch the full demo video (MP4)](assets/demo-overview.mp4)

⭐ **If you find this useful, star the repo — it helps others discover it!**

> **⚠️ Notice:** Repo history was rewritten (backlog purge). If you cloned recently and see weird git behavior, read: https://github.com/BradGroux/veritas-kanban/discussions/85

[Quickstart](#-quickstart) · [Features](#-feature-highlights) · [All Features](docs/FEATURES.md) · [Docs](docs/) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [API](#-api-versioning) · [Agent Integration](#-agent-integration) · [MCP Server](#-mcp-server) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

</div>

---

Created by **Brad Groux** — CEO of [Digital Meld](https://digitalmeld.io), and host of the [Start Small, Think Big](https://podcasts.apple.com/us/podcast/start-small-think-big-a-podcast-and-newsletter/id1802232903) podcast · [LinkedIn](https://www.linkedin.com/in/bradgroux/) · [Twitter](https://twitter.com/BradGroux) · [YouTube](https://www.youtube.com/bradgroux)

---

## ⚡ Quickstart

Want to take the easy way out? Ask your agent (like [OpenClaw](https://github.com/openclaw/openclaw)):

```
Clone and set up veritas-kanban locally. Install dependencies with pnpm, copy the .env.example, and start the dev server. Verify it's running at localhost:3000.
```

Want to do it yourself? Get up and running in under 5 minutes:

```bash
git clone https://github.com/BradGroux/veritas-kanban.git
cd veritas-kanban
pnpm install
cp server/.env.example server/.env   # Edit to change VERITAS_ADMIN_KEY
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) — that's it. The board auto-seeds with example tasks on first run so you can explore right away.

> **Want a clean slate?** Delete the example tasks: `rm tasks/active/task_example_*.md` and refresh.
> **Want to re-seed?** Run `pnpm seed` to restore the example tasks (only works when the board is empty).

> **Note:** Never commit `.env` files. Use `.env.example` as a template — it contains safe placeholder values and documentation for every variable.

---

## 📚 Documentation Map

- [Getting Started Guide](docs/GETTING-STARTED.md) — zero ➝ agent-ready in 5 minutes, plus sanity checks and prompt registry tips.
- [Agent Task Workflow SOP](docs/SOP-agent-task-workflow.md) — lifecycle, API/CLI snippets, prompts.
- [Squad Chat Protocol](docs/SQUAD-CHAT-PROTOCOL.md) — agent messaging, system events (spawned/completed/failed), model attribution, and helper scripts.
- [Sprint Planning SOP](docs/SOP-sprint-planning.md) — epic → sprint → task breakdown.
- [Multi-Agent Orchestration](docs/SOP-multi-agent-orchestration.md) — PM + worker handoffs.
- [Cross-Model Code Review](docs/SOP-cross-model-code-review.md) — enforce Claude ↔ GPT reviews.
- [Best Practices](docs/BEST-PRACTICES.md) & [Tips + Tricks](docs/TIPS-AND-TRICKS.md) — patterns, shortcuts, integrations.
- [Real-World Examples](docs/EXAMPLES-agent-workflows.md) — copy/pasteable agent recipes.
- [Troubleshooting](docs/TROUBLESHOOTING.md) — deeper diagnostics when things wobble.

## ⚠️ Agentic AI Safety

> [!CAUTION]
> **AI agents can write code, execute commands, and modify your system.** While tools like Veritas Kanban make agentic workflows powerful, they can also cause real damage without proper guardrails. Read this before giving any AI agent access to your environment.

### Best Practices for Agentic AI

1. **Run locally first.** Keep your board and agents on your own machine until you fully understand the behavior. Never expose an unauthenticated instance to the internet. **Veritas Kanban does not include rate limiting** — if you deploy publicly, add a reverse proxy (nginx, Caddy, Cloudflare) with rate limiting in front of it.

2. **Never trigger agents from uncontrolled inputs.** Don't let inbound emails, webhooks from third parties, or public form submissions automatically spawn agent work. An attacker who can craft an input can control your agent.

3. **Principle of least privilege.** Give agents the minimum permissions they need. Use the `agent` role (not `admin`) for API keys. Restrict file system access. Don't run agents as root.

4. **Review before merge.** Agents can write code — that doesn't mean the code is correct or safe. Always review agent-generated code before merging to production branches. Use the built-in code review workflow.

5. **Set boundaries on destructive actions.** Agents should not have unsupervised access to `rm`, `git push --force`, database drops, or production deployments. Require human approval for irreversible operations.

6. **Monitor and audit.** Use time tracking and activity logs to understand what agents are doing. Review agent-completed tasks. Check git diffs before pushing.

7. **Rotate credentials regularly.** If an agent has access to API keys, tokens, or secrets, rotate them on a schedule. Don't embed real credentials in task descriptions or prompts.

8. **Isolate environments.** Run agents in containers, VMs, or sandboxed environments when possible. Keep agent workspaces separate from sensitive data.

**The bottom line:** Agentic AI is transformational, but it amplifies both your capabilities and your mistakes. Plan accordingly, start small, and add autonomy gradually as you build confidence in your guardrails.

---

## ✨ Feature Highlights

> 📋 **Full feature reference:** [docs/FEATURES.md](docs/FEATURES.md)

### 📋 Core Board

![Drag-and-drop Kanban demo](assets/demo-drag_drop.gif)

- **Drag-and-drop Kanban** — Move tasks across To Do, In Progress, Blocked, Done
- **Markdown storage** — Human-readable task files with YAML frontmatter
- **Dark/light mode** — Toggle between dark and light themes in Settings

### 🔀 Code Workflow

- **Git worktrees** — Isolated branches per task, automatic cleanup
- **Code review** — Unified diff viewer with inline comments
- **Approval workflow** — Approve, request changes, or reject
- **Merge conflicts** — Visual conflict resolution UI
- **GitHub PRs** — Create pull requests directly from task detail

### 🤖 AI Agents (v2.0)

- **Reverse Proxy Ready** — Deploy behind nginx, Caddy, Traefik, or any reverse proxy with the `TRUST_PROXY` environment variable (v2.1.1)
- **Squad Chat** — Real-time agent-to-agent communication with WebSocket updates, system lifecycle events (spawned/completed/failed), model attribution per message, and configurable display names (NEW — v2.0)
- **Broadcast Notifications** — Priority-based persistent notifications with read receipts and agent-specific delivery (NEW — v2.0)
- **Task Deliverables** — First-class deliverable objects with type/status tracking (code, documentation, data, etc.) (NEW — v2.0)
- **Efficient Polling** — `/api/changes?since=...` endpoint with ETag support for optimized agent polling (NEW — v2.0)
- **Approval Delegation** — Vacation mode with scoped approval delegation and automatic routing (NEW — v2.0)
- **OpenClaw Integration** — Direct gateway wake for real-time squad chat notifications and agent orchestration (NEW — v2.0)
- **Squad Chat Webhook** — Configurable webhooks (generic HTTP or OpenClaw Direct) for external agent integration (NEW — v2.0)
- **Agent registry** — Service discovery with heartbeat tracking, capabilities, and live status (NEW — v2.0)
- **Multi-agent dashboard** — Real-time sidebar with expandable agent cards, status indicators (NEW — v2.0)
- **Multi-agent task assignment** — Assign multiple agents per task with color-coded chips (NEW — v2.0)
- **@Mention notifications** — @agent-name parsing in comments, thread subscriptions (NEW — v2.0)
- **Permission levels** — Intern / Specialist / Lead tiers with approval workflows (NEW — v2.0)
- **Error learning** — Structured failure analysis with similarity search (NEW — v2.0)
- **Task lifecycle hooks** — 7 built-in hooks, 8 events, custom hooks API (NEW — v2.0)
- **Agent orchestration** — Spawn autonomous coding agents on tasks
- **Custom agents** — Add your own agents with any name and command; not limited to built-in types
- **Platform-agnostic API** — REST endpoints work with any agentic platform
- **Built-in OpenClaw support** — Native integration with [OpenClaw](https://github.com/openclaw/openclaw) (formerly Clawdbot/Moltbot)
- **Multiple attempts** — Retry with different agents, preserve history
- **Running indicator** — Visual feedback when agents are working

### 🔄 Workflow Engine (v3.0)

- **YAML workflow definitions** — Define multi-step agent orchestration pipelines as version-controlled YAML files
- **Visual execution** — Live run view with step-by-step progress, status indicators, and output preview
- **Sequential & advanced step types** — Agent steps, loop iteration, gate approval, parallel fan-out/fan-in
- **Loop steps** — Iterate over collections (subtasks, test cases, stories) with configurable completion policies (all_done, any_done, first_success)
- **Gate steps** — Conditional blocking with human approval, timeout escalation, and expression-based conditions
- **Parallel steps** — Execute multiple sub-steps concurrently with completion criteria (all, any, N-of-M)
- **Run state management** — Persistent run state survives server restarts, retry with exponential backoff, resume blocked runs
- **Tool policies** — Role-based tool restrictions (5 default roles: planner, developer, reviewer, tester, deployer) with custom role CRUD
- **Session isolation** — Each workflow step can run in a fresh OpenClaw session with configurable context injection (minimal/full/custom)
- **Monitoring dashboard** — Summary cards (total, active, completed, failed, success rate, avg duration), live active runs table, recent history, per-workflow health metrics
- **Real-time updates** — WebSocket-primary with polling fallback; 75% reduction in API calls when connected
- **Workflow API** — 9 CRUD endpoints for workflow definitions, runs, and control (start, resume, approve gates)
- **Enhanced acceptance criteria** — Regex patterns, JSON path equality checks, substring matching for step validation
- **Security hardening** — ReDoS protection, expression injection prevention, parallel DoS limits, gate approval validation
- **Progress file tracking** — Shared `progress.md` per run for context passing between steps
- **Audit logging** — Every workflow change (create/edit/delete) logged to `.veritas-kanban/workflows/.audit.jsonl`
- **RBAC** — Role-based access control for workflow execution, editing, and viewing

### 🛡️ Enforcement Gates

**Optional structural enforcement to harden your workflow** — all gates are disabled by default.

- **squadChat** — Auto-post task lifecycle events to squad chat
- **reviewGate** — Require 4x10 review scores before task completion
- **closingComments** — Require deliverable summary (≥20 chars) before completion
- **autoTelemetry** — Auto-emit `run.started`/`run.completed` on status changes
- **autoTimeTracking** — Auto-start/stop timers on status changes
- **orchestratorDelegation** — Warn when orchestrator does implementation work instead of delegating

All gates are toggleable via `PATCH /api/settings/features` under the `enforcement` key. See [docs/enforcement.md](docs/enforcement.md) for full details, error codes, and agent integration guide.

### 🔄 Visibility & Automation

- **GitHub Issues sync** — Bidirectional sync between GitHub Issues and your board (inbound import, outbound status/comment push)
- **Activity page** — Status history with clickable task navigation, color-coded badges, and daily summary
- **Daily standup summary** — Generate standup reports via API or CLI (`vk summary standup`) with completed, in-progress, blocked, and upcoming sections
- **Task Templates** — Create reusable templates with defaults, subtasks, and multi-task blueprints
- **Documentation freshness** — Steward workflow with freshness headers and automated staleness detection (NEW — v2.0)
- **Cost prediction** — Multi-factor cost estimation for tasks (NEW — v2.0)

### 📊 Dashboard (v2.0)

- **Where Time Went** — Time breakdown by project from telemetry data (NEW — v2.0)
- **Activity Clock** — 24-hour donut chart showing agent work patterns (NEW — v2.0)
- **Hourly Activity** — Bar chart with event counts per hour (NEW — v2.0)
- **Wall Time Toggle** — Total agent time + average run duration (NEW — v2.0)
- **Session Metrics** — Session count, success rate, completion tracking (NEW — v2.0)
- **Markdown rendering** — Rich markdown in task descriptions and comments (NEW — v2.0)
- **Timezone-aware metrics** — Server reports local timezone; clients can request metrics in any timezone via `?tz=` (NEW — v2.0)
- **Analytics API** — Timeline visualization and aggregate metrics (parallelism, throughput, lead time)

### 🗂️ Organization

![Task detail features demo](assets/demo-task.gif)

> 🎬 [Watch the task workflow demo (MP4)](assets/demo-task.mp4)

- **Subtasks** — Break down complex work with progress tracking
- **Task dependencies** — Bidirectional dependency graph (depends_on/blocks) with cycle detection, recursive tree API, and visual badges (NEW — v3.3)
- **Crash-recovery checkpointing** — Save/resume/clear agent state with auto-sanitization of secrets, 1MB limit, 24h expiry, and sub-agent context injection (NEW — v3.3)
- **Observational memory** — Per-task observations with importance scoring (1-10), full-text search, timeline view, and activity logging (NEW — v3.3)
- **Agent filter** — Query tasks by agent name with `?agent=name` parameter (NEW — v3.3)
- **Archive** — Searchable archive with one-click restore
- **Time tracking** — Start/stop timer or manual entry
- **Activity log** — Full history of task events

### ⚙️ Settings & Customization

- **Modular settings** — 8 focused tabs (General, Board, Tasks, Agents, Data, Notifications, Security, Manage)
- **Security hardened** — XSS prevention, path traversal blocking, prototype pollution protection
- **WCAG 2.1 AA** — Full accessibility with ARIA labels, keyboard navigation
- **Error boundaries** — Crash isolation per tab with recovery options
- **Performance** — Lazy-loaded tabs, memoized components, debounced saves
- **Import/Export** — Backup and restore all settings with validation

### 🔌 Integration

- **CLI** — `vk` command for terminal workflows
- **MCP Server** — Model Context Protocol for AI assistants
- **Notifications** — Teams integration for task updates

---

## 🛠️ Tech Stack

| Layer               | Technology                           | Version                        |
| ------------------- | ------------------------------------ | ------------------------------ |
| **Frontend**        | React, Vite, Tailwind CSS, Shadcn UI | React 19, Vite 6, Tailwind 3.4 |
| **Backend**         | Express, WebSocket                   | Express 4.21                   |
| **Language**        | TypeScript (strict mode)             | 5.7                            |
| **Storage**         | Markdown files with YAML frontmatter | gray-matter                    |
| **Git**             | simple-git, worktree management      | —                              |
| **Testing**         | Playwright (E2E), Vitest (unit)      | Playwright 1.58, Vitest 4      |
| **Runtime**         | Node.js                              | 22+                            |
| **Package Manager** | pnpm                                 | 9+                             |

---

## 🏆 Why Veritas Kanban?

| Feature                      | Veritas Kanban |   Jira   | Linear |    Plane     |    Planka    |
| ---------------------------- | :------------: | :------: | :----: | :----------: | :----------: |
| **Open source**              |     ✅ MIT     |    ❌    |   ❌   |   ✅ AGPL    | ✅ Fair Use  |
| **Local-first**              |       ✅       |    ❌    |   ❌   | ⚠️ Self-host | ⚠️ Self-host |
| **AI agent orchestration**   |   ✅ Native    |    ❌    |   ❌   |      ❌      |      ❌      |
| **MCP server**               |       ✅       |    ❌    |   ❌   |      ❌      |      ❌      |
| **CLI**                      |       ✅       |    ❌    |   ✅   |      ❌      |      ❌      |
| **Git worktree integration** |       ✅       |    ❌    |   ❌   |      ❌      |      ❌      |
| **Code review built-in**     |       ✅       |    ❌    |   ❌   |      ❌      |      ❌      |
| **Markdown file storage**    |       ✅       |    ❌    |   ❌   |      ❌      |      ❌      |
| **No database required**     |       ✅       |    ❌    |   ❌   |      ❌      |      ❌      |
| **Time tracking**            |       ✅       | ✅ Addon |   ❌   |      ✅      |      ❌      |
| **Real-time WebSocket**      |       ✅       |    ✅    |   ✅   |      ✅      |      ✅      |
| **REST API**                 |       ✅       |    ✅    |   ✅   |      ✅      |      ✅      |
| **Free forever**             |       ✅       |    ❌    |   ❌   |  ⚠️ Limits   |      ✅      |

**Veritas Kanban is built for developers and AI agents.** If your workflow involves autonomous coding agents, git-integrated task management, or you just want a board that stores data as plain files you can `grep` — this is it.

---

## 🔄 How It Works

```
  Any AI Agent / CLI / MCP Client
           │
           ▼
┌──────────────────────────────┐
│      REST API + WebSocket    │
│    http://localhost:3001     │
│                              │
│  ┌───────┐  ┌───────────┐    │
│  │ Tasks │  │ Workflows │    │
│  │  API  │  │   Engine  │    │
│  └───┬───┘  └─────┬─────┘    │
│      │            │          │
│      ▼            ▼          │
│   Markdown    YAML Workflows │
│    Files       + Run State   │
└──────────────────────────────┘
           │
           ▼
   React 19 + Vite Frontend
   http://localhost:3000
```

The board is the source of truth. Agents interact via the REST API — create tasks, start workflows, update status, track time, submit completions. Workflows orchestrate multi-step agent pipelines with loops, gates, and parallel execution. The frontend reflects everything in real time over WebSocket. No vendor lock-in: if it can make HTTP calls, it can drive the board.

---

## 🏗️ Architecture

```
veritas-kanban/                  ← pnpm monorepo
│
├── web/                         ← React 19 + Vite frontend
│   └── src/
│       ├── components/          ← UI components (Shadcn + custom)
│       ├── hooks/               ← React Query hooks, WebSocket
│       └── lib/                 ← Utilities, API client
│
├── server/                      ← Express + WebSocket API
│   └── src/
│       ├── routes/              ← REST endpoints (/api/v1/*)
│       ├── services/            ← Business logic
│       └── middleware/          ← Auth, rate limiting, security
│
├── shared/                      ← TypeScript types & contracts
│   └── src/types/               ← Shared between web & server
│
├── cli/                         ← `vk` CLI tool
├── mcp/                         ← MCP server for AI assistants
├── docs/                        ← Sprint & audit documentation
│
├── tasks/                       ← Task storage (Markdown files)
│   ├── active/                  ← Current tasks (.gitignored)
│   ├── archive/                 ← Archived tasks (.gitignored)
│   └── examples/                ← Seed tasks for first-run
│
└── .veritas-kanban/             ← Runtime config & data
    ├── config.json
    ├── workflows/               ← YAML workflow definitions
    ├── workflow-runs/           ← Run state & step outputs
    ├── tool-policies/           ← Role-based tool restrictions
    ├── worktrees/
    ├── logs/
    └── agent-requests/
```

**Data flow:** Web ↔ REST API / WebSocket ↔ Server ↔ Markdown/YAML files on disk

---

## 📖 API Versioning

All API endpoints support versioned paths. The current (and default) version is **v1**.

| Path            | Description                             |
| --------------- | --------------------------------------- |
| `/api/v1/tasks` | Canonical versioned endpoint            |
| `/api/tasks`    | Backwards-compatible alias (same as v1) |

Every response includes an `X-API-Version: v1` header. Clients may optionally request a specific version:

```bash
curl -H "X-API-Version: v1" http://localhost:3001/api/tasks
```

- **Non-breaking changes** (new fields, new endpoints) are added to the current version.
- **Breaking changes** will introduce a new version (`v2`). The previous version remains available during a deprecation period.
- The unversioned `/api/...` alias always points to the latest stable version.

---

## 💻 CLI

> 📖 **Comprehensive CLI guide:** [docs/CLI-GUIDE.md](docs/CLI-GUIDE.md) — installation, every command, scripting examples, and tips.

Manage your entire task lifecycle with two commands.

```bash
# Install globally
cd cli && npm link
```

### Setup & Onboarding

```bash
vk setup                         # Guided environment check + sample task
vk setup --skip-task             # Check only, no sample task
vk setup --json                  # Machine-readable output
```

Validates Node version, server health, API auth, and optionally creates a welcome task to get you started.

### Workflow Commands

The `vk begin` and `vk done` commands replace multi-step API workflows with single commands. Inspired by Boris Cherny's (Claude Code creator) philosophy: _"automate everything you do twice."_

**Before (6 separate curl calls):**

```bash
curl -X PATCH http://localhost:3001/api/tasks/<id> -H "Content-Type: application/json" -d '{"status":"in-progress"}'
curl -X POST http://localhost:3001/api/tasks/<id>/time/start
curl -X POST http://localhost:3001/api/agent/status -H "Content-Type: application/json" -d '{"status":"working","taskId":"<id>","taskTitle":"Title"}'
# ... work happens ...
curl -X POST http://localhost:3001/api/tasks/<id>/time/stop
curl -X PATCH http://localhost:3001/api/tasks/<id> -H "Content-Type: application/json" -d '{"status":"done"}'
curl -X POST http://localhost:3001/api/tasks/<id>/comments -H "Content-Type: application/json" -d '{"author":"agent","text":"summary"}'
```

**After (2 commands):**

```bash
vk begin <id>                    # → in-progress + timer + agent working
vk done <id> "Added OAuth"       # → timer stop + done + comment + agent idle
```

| Command                  | What It Does                                                 |
| ------------------------ | ------------------------------------------------------------ |
| `vk begin <id>`          | Sets in-progress + starts timer + agent status → working     |
| `vk done <id> "summary"` | Stops timer + sets done + adds comment + agent status → idle |
| `vk block <id> "reason"` | Sets blocked + adds comment with reason                      |
| `vk unblock <id>`        | Sets in-progress + restarts timer                            |

### Basic Task Management

```bash
vk list                          # List all tasks
vk list --status in-progress     # Filter by status
vk show <id>                     # Task details
vk create "Title" --type code    # Create task
vk update <id> --status review   # Update task
```

### Time Tracking

```bash
vk time start <id>               # Start time tracker
vk time stop <id>                # Stop time tracker
vk time entry <id> 3600 "desc"   # Add manual entry (seconds)
vk time show <id>                # Display time summary
```

### Comments

```bash
vk comment <id> "Fixed the bug"           # Add comment
vk comment <id> "Done" --author Veritas    # With author
```

### Agent Status

```bash
vk agent status                  # Show current agent status
vk agent working <id>            # Set to working (auto-fetches title)
vk agent idle                    # Set to idle
vk agent sub-agent 3             # Set sub-agent mode with count
```

### Project Management

```bash
vk project list                  # List all projects
vk project create "my-app" --color "#7c3aed" --description "Main app"
```

### GitHub Sync

```bash
vk github sync                   # Trigger manual sync
vk github status                 # Show sync status
vk github config                 # View/update configuration
vk github mappings               # List issue↔task mappings
```

### Agent Commands

```bash
vk agents:pending                # List pending agent requests
vk agents:status <id>            # Check if agent running
vk agents:complete <id> -s       # Mark agent complete
```

### Utilities

```bash
vk summary                       # Project stats
vk summary standup               # Daily standup summary
vk notify:pending                # Check notifications
```

All commands support `--json` for scripting and machine consumption.

---

## 🤖 Agent Integration

Veritas Kanban works with any agentic platform that can make HTTP calls. The REST API covers the full task lifecycle — create, update, track time, complete.

Built and tested with [OpenClaw](https://github.com/openclaw/openclaw) (formerly Clawdbot/Moltbot), which provides native orchestration via `sessions_spawn`. The built-in agent service targets OpenClaw — PRs welcome for adapters to other platforms.

### How It Works

1. **Start Agent** — Click "Start Agent" in the UI on a code task (or hit the API directly)
2. **Request Created** — Server writes to `.veritas-kanban/agent-requests/`
3. **Agent Picks Up** — Your agent reads the request and begins work
4. **Work Happens** — Agent updates task status, tracks time, commits code
5. **Completion** — Agent calls the completion endpoint with results
6. **Task Updates** — Status moves to Review, notifications sent

### Any Platform (REST API)

> 💡 **Using the CLI?** Skip the curl commands — `vk begin <id>` and `vk done <id> "summary"` handle the full lifecycle in one shot. See the [CLI Guide](docs/CLI-GUIDE.md) for details.

```bash
# Create a task
curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $YOUR_KEY" \
  -d '{"title": "Implement feature X", "type": "code", "status": "in-progress"}'

# Start time tracking
curl -X POST http://localhost:3001/api/tasks/<id>/time/start \
  -H "X-API-Key: $YOUR_KEY"

# Mark complete
curl -X POST http://localhost:3001/api/agents/<id>/complete \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $YOUR_KEY" \
  -d '{"success": true, "summary": "What was done"}'
```

### GitHub Issues Sync

```bash
# Trigger a manual sync
curl -X POST http://localhost:3001/api/github/sync \
  -H "X-API-Key: $YOUR_KEY"

# Check sync status
curl http://localhost:3001/api/github/sync/status \
  -H "X-API-Key: $YOUR_KEY"
```

Issues with the `kanban` label are imported as tasks. Status changes push back (done → close, reopen on todo/in-progress/blocked). Labels like `priority:high` and `type:story` map to task fields. Configure in `.veritas-kanban/integrations.json`.

### OpenClaw (Native)

```bash
# Check for pending agent requests
vk agents:pending

# OpenClaw sub-agents use sessions_spawn to execute work,
# then call the completion endpoint automatically.
```

---

## 🔗 MCP Server

For AI assistants (Claude Desktop, etc.):

```json
{
  "mcpServers": {
    "veritas-kanban": {
      "command": "node",
      "args": ["/path/to/veritas-kanban/mcp/dist/index.js"],
      "env": {
        "VK_API_URL": "http://localhost:3001"
      }
    }
  }
}
```

### Available Tools

| Tool           | Description       |
| -------------- | ----------------- |
| `list_tasks`   | List with filters |
| `get_task`     | Get task by ID    |
| `create_task`  | Create new task   |
| `update_task`  | Update fields     |
| `archive_task` | Archive task      |

### Resources

| URI                     | Description          |
| ----------------------- | -------------------- |
| `kanban://tasks`        | All tasks            |
| `kanban://tasks/active` | In-progress + review |
| `kanban://task/{id}`    | Single task          |

---

## 📄 Task Format

Tasks are markdown files with YAML frontmatter:

```markdown
---
id: 'task_20260126_abc123'
title: 'Implement feature X'
type: 'code'
status: 'in-progress'
priority: 'high'
project: 'rubicon'
git:
  repo: 'my-project'
  branch: 'feature/task_abc123'
  baseBranch: 'main'
---

## Description

Task details here...
```

---

## 🧑‍💻 Development

```bash
pnpm dev        # Start dev servers (web + API concurrently)
pnpm build      # Production build
pnpm typecheck  # TypeScript strict check
pnpm lint       # ESLint
pnpm test       # Unit tests (Vitest)
pnpm test:e2e   # E2E tests (Playwright)
```

---

## 📚 Documentation

| Document                                   | Description                      |
| ------------------------------------------ | -------------------------------- |
| [Features](docs/FEATURES.md)               | Complete feature reference       |
| [CLI Guide](docs/CLI-GUIDE.md)             | Comprehensive CLI usage guide    |
| [Deployment](docs/DEPLOYMENT.md)           | Docker, bare metal, env config   |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Common issues & solutions        |
| [Contributing](CONTRIBUTING.md)            | How to contribute, PR guidelines |
| [Security Policy](SECURITY.md)             | Vulnerability reporting          |
| [Code of Conduct](CODE_OF_CONDUCT.md)      | Community guidelines             |
| [Changelog](CHANGELOG.md)                  | Release history                  |
| [Sprint Docs](docs/)                       | Sprint planning & audit reports  |

---

## 📸 Screenshots

<details>
<summary><strong>Click to expand screenshots</strong></summary>

### Board Overview

|                                                    |                                                     |
| -------------------------------------------------- | --------------------------------------------------- |
| ![Main board view](assets/scr-main_overview_1.png) | ![Board with tasks](assets/scr-main_overview_2.png) |
| ![Board columns](assets/scr-main_overview_3.png)   | ![Board dark mode](assets/scr-main_overview_4.png)  |

### Task Management

|                                                             |                                                            |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| ![New task dialog](assets/scr-new_task.png)                 | ![Task details panel](assets/scr-task_details.png)         |
| ![Task details list view](assets/scr-task_details_list.png) | ![Apply task template](assets/scr-apply_task_template.png) |

### Task Extras

|                                              |                                                      |
| -------------------------------------------- | ---------------------------------------------------- |
| ![Task metrics](assets/scr-task_metrics.png) | ![Task attachments](assets/scr-task_attachments.png) |
| ![Activity log](assets/scr-activity_log.png) | ![Archive](assets/scr-archive.png)                   |

### Metrics & Dashboard

|                                                    |                                                    |
| -------------------------------------------------- | -------------------------------------------------- |
| ![Metrics overview](assets/scr-metrics_.png)       | ![Token usage](assets/scr-metrics_token_usage.png) |
| ![Failed runs](assets/scr-metrics_failed_runs.png) | ![Export metrics](assets/scr-export_metrics.png)   |

### Settings

|                                                        |                                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| ![General settings](assets/scr-settings_general.png)   | ![Board settings](assets/scr-settings_board.png)                |
| ![Task settings](assets/scr-settings_tasks.png)        | ![Agent settings](assets/scr-settings_agents.png)               |
| ![Data settings](assets/scr-settings_data.png)         | ![Notification settings](assets/scr-settings_notifications.png) |
| ![Security settings](assets/scr-settings_security.png) | ![Manage settings](assets/scr-settings_manage.png)              |

### Menus & Activity

|                                                       |                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| ![Agent activity](assets/scr-menu_agent_activity.png) | ![WebSocket activity](assets/scr-menu_websocket_activity.png) |
| ![Keyboard shortcuts](assets/scr-menu_keyboard.png)   | ![Security menu](assets/scr-menu_security.png)                |

</details>

---

## 🗺️ Roadmap

See the [open issues](https://github.com/BradGroux/veritas-kanban/issues) for what's next. Community contributions welcome!

### Backlog

- [WCAG 2.1 AA accessibility](https://github.com/BradGroux/veritas-kanban/issues/1) — Full keyboard navigation, screen reader support, color contrast
- [Example video](https://github.com/BradGroux/veritas-kanban/issues/68) — Hosted walkthrough video on YouTube or Vimeo

### Shipped in v3.2.0

- ~~[Markdown Editor](https://github.com/BradGroux/veritas-kanban/pull/118)~~ — Rich editing toolbar, live preview, keyboard shortcuts (Ctrl+B/I/K) for task descriptions and comments
- ~~[Shared Resources Registry](https://github.com/BradGroux/veritas-kanban/pull/119)~~ — Reusable resources (prompts, guidelines, templates) mountable across projects
- ~~[Documentation Freshness](https://github.com/BradGroux/veritas-kanban/pull/120)~~ — Staleness tracking with freshness scores, alerts, and auto-review task creation
- ~~[Docker Auth Persistence](https://github.com/BradGroux/veritas-kanban/issues/116)~~ — Fixed auth state wiped on container rebuild; added automatic migration

### Shipped in v2.1.2

- ~~[Docker Path Resolution](https://github.com/BradGroux/veritas-kanban/issues/102)~~ — Fixed WORKDIR resolution for `.veritas-kanban` directory in containerized deployments

### Shipped in v2.1.1

- ~~[Reverse Proxy Support](https://github.com/BradGroux/veritas-kanban/issues/100)~~ — Added `TRUST_PROXY` environment variable for nginx, Caddy, Traefik, and other reverse proxies
- ~~[Prompts Registry](https://github.com/BradGroux/veritas-kanban/issues/101)~~ — Centralized prompt templates with versioning and agent-specific customization

### Shipped in v2.0.0

- ~~[Dashboard widget toggles](https://github.com/BradGroux/veritas-kanban/issues/92)~~ · ~~[Multi-agent dashboard](https://github.com/BradGroux/veritas-kanban/issues/28)~~ · ~~[Multi-agent task assignment](https://github.com/BradGroux/veritas-kanban/issues/29)~~ · ~~[@Mention notifications](https://github.com/BradGroux/veritas-kanban/issues/30)~~ · ~~[Agent permission levels](https://github.com/BradGroux/veritas-kanban/issues/31)~~ · ~~[Agent self-reporting](https://github.com/BradGroux/veritas-kanban/issues/52)~~ · ~~[CLI usage reporting](https://github.com/BradGroux/veritas-kanban/issues/50)~~ · ~~[Markdown rendering](https://github.com/BradGroux/veritas-kanban/issues/63)~~ · ~~[Cost prediction](https://github.com/BradGroux/veritas-kanban/issues/54)~~ · ~~[Error learning](https://github.com/BradGroux/veritas-kanban/issues/91)~~ · ~~[Task lifecycle hooks](https://github.com/BradGroux/veritas-kanban/issues/72)~~ · ~~[Documentation freshness](https://github.com/BradGroux/veritas-kanban/issues/74)~~ · ~~[Where Time Went](https://github.com/BradGroux/veritas-kanban/issues/57)~~ · ~~[Activity Clock](https://github.com/BradGroux/veritas-kanban/issues/58)~~ · ~~[Hourly Activity](https://github.com/BradGroux/veritas-kanban/issues/59)~~ · ~~[Wall Time Toggle](https://github.com/BradGroux/veritas-kanban/issues/60)~~ · ~~[Session Metrics](https://github.com/BradGroux/veritas-kanban/issues/61)~~ · ~~[Production binding](https://github.com/BradGroux/veritas-kanban/issues/55)~~

### Shipped in v1.6.0

- ~~[Model Usage schema & API](https://github.com/BradGroux/veritas-kanban/issues/47)~~ · ~~[Global usage aggregation](https://github.com/BradGroux/veritas-kanban/issues/48)~~ · ~~[Dashboard Model Usage](https://github.com/BradGroux/veritas-kanban/issues/49)~~ · ~~[Standup with cost](https://github.com/BradGroux/veritas-kanban/issues/51)~~ · ~~[Per-model cost tables](https://github.com/BradGroux/veritas-kanban/issues/53)~~ · ~~[Dashboard filter bar](https://github.com/BradGroux/veritas-kanban/issues/56)~~ · ~~[Health endpoints](https://github.com/BradGroux/veritas-kanban/issues/82)~~

### Shipped in v1.1.0–v1.3.0

- ~~[API response envelope](https://github.com/BradGroux/veritas-kanban/issues/2)~~ · ~~[Circuit breaker](https://github.com/BradGroux/veritas-kanban/issues/3)~~ · ~~[Load testing (k6)](https://github.com/BradGroux/veritas-kanban/issues/4)~~ · ~~[Prometheus/OTel](https://github.com/BradGroux/veritas-kanban/issues/5)~~ · ~~[Storage abstraction](https://github.com/BradGroux/veritas-kanban/issues/6)~~ · ~~[GitHub Issues sync](https://github.com/BradGroux/veritas-kanban/issues/21)~~ · ~~[Activity feed](https://github.com/BradGroux/veritas-kanban/issues/33)~~ · ~~[Daily standup](https://github.com/BradGroux/veritas-kanban/issues/34)~~

---

## 💬 Support

All support and feature requests go through GitHub:

- **🐛 Bug reports** — [Open an issue](https://github.com/BradGroux/veritas-kanban/issues/new?template=bug_report.md)
- **💡 Feature requests** — [Open an issue](https://github.com/BradGroux/veritas-kanban/issues/new?template=feature_request.md)
- **❓ Questions & discussion** — [GitHub Discussions](https://github.com/BradGroux/veritas-kanban/discussions)

> **Note:** Support is not provided via email or social media. GitHub is the single source of truth for all project communication.

---

## 🙏 Acknowledgments

Special thanks to [Peter Steinberger](https://github.com/steipete) and [OpenClaw](https://github.com/openclaw/openclaw) (formerly Clawdbot/Moltbot) — the platform that inspired this project and made autonomous agent orchestration feel like magic.

---

## 📜 License

[MIT](LICENSE) © 2026 [Digital Meld](https://digitalmeld.io)

---

<div align="center">

Made in Texas with 💜

Originally built for [OpenClaw](https://github.com/openclaw/openclaw). Works with any agentic platform.

</div>

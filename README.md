<div align="center">

# ⚖️ Veritas Kanban

_Veritas in actis — Truth in action._

**Local-first task management and AI agent orchestration platform.**

Built for developers who want a visual Kanban board that works with autonomous coding agents.

[![CI](https://github.com/BradGroux/veritas-kanban/actions/workflows/ci.yml/badge.svg)](https://github.com/BradGroux/veritas-kanban/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-4.2.5-blue.svg)](CHANGELOG.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue.svg)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

![Veritas Kanban — Board Overview](assets/demo-overview.gif)

> 🎬 [Watch the full demo video (MP4)](assets/demo-overview.mp4)

⭐ **If you find this useful, star the repo — it helps others discover it!**

[Quickstart](#-quickstart) · [Features](#-feature-highlights) · [Why VK](#-why-veritas-kanban) · [All Features](docs/FEATURES.md) · [Docs](docs/) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [API](#-api-versioning) · [Agent Integration](#-agent-integration) · [MCP Server](#-mcp-server) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

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

- [MCP Server Guide](docs/mcp/README.md) — 33+ tools, architecture, quickstart, tool catalog, security model, troubleshooting.
- [OpenAI Codex Integration Roadmap](docs/CODEX-INTEGRATION.md) — v4.2 plan for local Codex execution, SDK sessions, cloud delegation, MCP setup, workflows, telemetry, and release QA.
- [Codex Integration SOP](docs/SOP-codex-integration.md) & [Codex Workflow Examples](docs/EXAMPLES-codex-workflows.md) — operational playbooks for using Codex as a first-class Veritas agent.
- [API Reference](docs/API-REFERENCE.md) — Auth, endpoints, request/response examples, WebSocket, common workflows.
- [Self-Hosting Guide](docs/guides/SELF_HOST.md) — production deployment, reverse proxy, auth hardening, Docker, and backups.
- [Getting Started Guide](docs/GETTING-STARTED.md) — zero ➝ agent-ready in 5 minutes, plus sanity checks and prompt registry tips.
- [Agent Task Workflow SOP](docs/SOP-agent-task-workflow.md) — lifecycle, API/CLI snippets, prompts.
- [Squad Chat Protocol](docs/SQUAD-CHAT-PROTOCOL.md) — agent messaging, system events (spawned/completed/failed), model attribution, and helper scripts.
- [Sprint Planning SOP](docs/SOP-sprint-planning.md) — epic → sprint → task breakdown.
- [Multi-Agent Orchestration](docs/SOP-multi-agent-orchestration.md) — PM + worker handoffs.
- [Cross-Model Code Review](docs/SOP-cross-model-code-review.md) — enforce Claude ↔ GPT reviews.
- [Agent Governance SOPs](docs/) — [Policy engine](docs/SOP-agent-policy-engine.md), [drift detection](docs/SOP-behavioral-drift-detection.md), [decision audit](docs/SOP-decision-audit-trail.md), [output evaluation](docs/SOP-output-evaluation.md), [user feedback](docs/SOP-user-feedback.md).
- [Operational SOPs](docs/) — [Broadcasts](docs/SOP-broadcasts.md), [delegation](docs/SOP-delegation.md), [deliverables](docs/SOP-deliverables.md), [prompt registry](docs/SOP-prompt-registry.md), [squad chat](docs/SOP-squad-chat.md), [system health](docs/SOP-system-health-monitoring.md).
- [Best Practices](docs/BEST-PRACTICES.md) & [Tips + Tricks](docs/TIPS-AND-TRICKS.md) — patterns, shortcuts, integrations.
- [Real-World Examples](docs/EXAMPLES-agent-workflows.md) — copy/pasteable agent recipes.
- [Troubleshooting](docs/TROUBLESHOOTING.md) — deeper diagnostics when things wobble.

## ⚠️ Agentic AI Safety

> [!CAUTION]
> **AI agents can write code, execute commands, and modify your system.** While tools like Veritas Kanban make agentic workflows powerful, they can also cause real damage without proper guardrails. Read this before giving any AI agent access to your environment.

### Best Practices for Agentic AI

1. **Run locally first.** Keep your board and agents on your own machine until you fully understand the behavior. Never expose an unauthenticated instance to the internet. Veritas Kanban includes built-in API rate limiting, but if you deploy publicly, still add a reverse proxy (nginx, Caddy, Cloudflare) with edge-level rate limiting in front of it.

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

### 🛡️ Agent Governance (New in v4.0)

**Policy Engine** — Define what agents can and can't do. Configurable tool/action policies with `allow`, `deny`, and `require-approval` guard rules. Every policy decision is logged. **Decision Audit Trail** — Log agent decisions with confidence scores, supporting evidence, and stated assumptions. Record outcomes afterward to see whether assumptions held. **Behavioral Drift Detection** — Set metric baselines and thresholds; get alerted when an agent's behavior deviates. **User Feedback Loop** — Collect feedback on agent outputs with sentiment tagging and category analytics. **Output Evaluation** — Score agent outputs against weighted criteria profiles (regex, keyword, numeric range, custom expressions).

### 🤖 Agent Orchestration

Spawn autonomous coding agents on tasks. Track them in real-time with the multi-agent dashboard — status indicators, expandable agent cards, model attribution. Squad Chat gives agents a shared communication channel with system lifecycle events (spawned, completed, failed). Assign multiple agents per task, set permission levels (Intern/Specialist/Lead), and let them coordinate.

![Agent orchestration](assets/demo-overview.gif)

### 📊 Customizable Dashboard (New in v4.0)

**Draggable & Resizable Widget Grid** — Rearrange and resize dashboard widgets via drag-and-drop. Layouts persist across sessions. Add widgets from the library or remove ones you don't need. **Global System Health Bar** — Persistent header status bar with five health levels (stable → alert) across three signal categories: system resources, agent availability, and operation success rate.

### 📝 Prompt Template Registry (New in v4.0)

Version-controlled prompt templates with variable extraction, full version history with rollback, usage tracking, and preview rendering with sample variable injection. Manage your prompt library the same way you manage code.

### ⚡ Workflow Engine

Define multi-step agent pipelines as version-controlled YAML. Sequential steps, parallel fan-out/fan-in, loop iteration over collections, gate approvals with human-in-the-loop, and retry routing. Think GitHub Actions — but for AI agents. Live execution view with step-by-step progress. Monitoring dashboard with success rates, active runs, and per-workflow health metrics.

### 📋 Task Intelligence

Not just cards on a board. Tasks have dependency graphs with cycle detection, crash-recovery checkpointing (auto-sanitizes secrets), observational memory with importance scoring, time tracking, and full activity logs. Enforcement gates (review gates, delegation enforcement, auto-telemetry) add production guardrails — all optional, all toggleable.

![Task detail features demo](assets/demo-task.gif)

### 🔀 Git-Native Development

Isolated worktrees per task — no branch switching, no conflicts. Built-in code review with unified diff viewer and inline comments. Approval workflows (approve, request changes, reject). Visual merge conflict resolution. Create GitHub PRs directly from the task detail panel. Bidirectional GitHub Issues sync with label mapping.

### 📁 Zero Infrastructure

Tasks are markdown files. Settings are JSON. Workflows are YAML. No database, no Redis, and no Docker required for local use. Clone, `pnpm install`, `pnpm dev` — done. Everything is `grep`-friendly, version-controllable, and human-readable. Back up your entire board with `git push`.

### 🔌 Three Integration Surfaces

- **MCP Server** — 33+ tools across 7 categories via Model Context Protocol (v4.0 adds project management and comment CRUD)
- **CLI** — `vk begin <id>` / `vk done <id> "summary"` replaces 6 API calls with 2 commands
- **REST API** — Full lifecycle management. If it can make HTTP calls, it can drive the board.

> 📋 **Full feature reference with every config option:** [docs/FEATURES.md](docs/FEATURES.md)

<details>
<summary><strong>📋 Complete Feature List</strong></summary>

#### Core Board

- **Drag-and-drop Kanban** — Move tasks across To Do, In Progress, Blocked, Done
- **Markdown storage** — Human-readable task files with YAML frontmatter
- **Dark/light mode** — Toggle between dark and light themes in Settings

#### Code Workflow

- **Git worktrees** — Isolated branches per task, automatic cleanup
- **Code review** — Unified diff viewer with inline comments
- **Approval workflow** — Approve, request changes, or reject
- **Merge conflicts** — Visual conflict resolution UI
- **GitHub PRs** — Create pull requests directly from task detail

#### AI Agents

- **Agent orchestration** — Spawn autonomous coding agents on tasks
- **Custom agents** — Add your own agents with any name and command; not limited to built-in types
- **Platform-agnostic API** — REST endpoints work with any agentic platform
- **Built-in OpenClaw support** — Native integration with [OpenClaw](https://github.com/openclaw/openclaw)
- **Squad Chat** — Real-time agent-to-agent communication with WebSocket updates, system lifecycle events, model attribution per message, and configurable display names
- **@Mention notifications** — @agent-name parsing in comments, thread subscriptions
- **Broadcast Notifications** — Priority-based persistent notifications with read receipts and agent-specific delivery
- **Squad Chat Webhook** — Configurable webhooks (generic HTTP or OpenClaw Direct) for external agent integration
- **Agent registry** — Service discovery with heartbeat tracking, capabilities, and live status
- **Multi-agent dashboard** — Real-time sidebar with expandable agent cards, status indicators
- **Multi-agent task assignment** — Assign multiple agents per task with color-coded chips
- **Permission levels** — Intern / Specialist / Lead tiers with approval workflows
- **Error learning** — Structured failure analysis with similarity search
- **Task lifecycle hooks** — 7 built-in hooks, 8 events, custom hooks API
- **Task Deliverables** — First-class deliverable objects with type/status tracking (code, documentation, data, etc.)
- **Efficient Polling** — `/api/changes?since=...` endpoint with ETag support for optimized agent polling
- **Approval Delegation** — Vacation mode with scoped approval delegation and automatic routing
- **OpenClaw Integration** — Direct gateway wake for real-time squad chat notifications and agent orchestration
- **Reverse Proxy Ready** — Deploy behind nginx, Caddy, Traefik, or any reverse proxy with `TRUST_PROXY`
- **Multiple attempts** — Retry with different agents, preserve history
- **Running indicator** — Visual feedback when agents are working

#### Workflow Engine

- **YAML workflow definitions** — Define multi-step agent orchestration pipelines as version-controlled YAML files
- **Visual execution** — Live run view with step-by-step progress, status indicators, and output preview
- **Sequential & advanced step types** — Agent steps, loop iteration, gate approval, parallel fan-out/fan-in
- **Loop steps** — Iterate over collections with configurable completion policies (all_done, any_done, first_success)
- **Gate steps** — Conditional blocking with human approval, timeout escalation, and expression-based conditions
- **Parallel steps** — Execute multiple sub-steps concurrently with completion criteria (all, any, N-of-M)
- **Run state management** — Persistent run state survives server restarts, retry with exponential backoff, resume blocked runs
- **Tool policies** — Role-based tool restrictions (5 default roles: planner, developer, reviewer, tester, deployer) with custom role CRUD
- **Session isolation** — Each workflow step runs in a fresh OpenClaw session with configurable context injection
- **Monitoring dashboard** — Summary cards, live active runs table, recent history, per-workflow health metrics
- **Real-time updates** — WebSocket-primary with polling fallback; 75% reduction in API calls when connected
- **Workflow API** — 9 CRUD endpoints for workflow definitions, runs, and control
- **Enhanced acceptance criteria** — Regex patterns, JSON path equality checks, substring matching for step validation
- **Security hardening** — ReDoS protection, expression injection prevention, parallel DoS limits, gate approval validation
- **Progress file tracking** — Shared `progress.md` per run for context passing between steps
- **Audit logging** — Every workflow change logged to `.veritas-kanban/workflows/.audit.jsonl`
- **RBAC** — Role-based access control for workflow execution, editing, and viewing

#### Enforcement Gates

- **squadChat** — Auto-post task lifecycle events to squad chat
- **reviewGate** — Require 4x10 review scores before task completion
- **closingComments** — Require deliverable summary (≥20 chars) before completion
- **autoTelemetry** — Auto-emit `run.started`/`run.completed` on status changes
- **autoTimeTracking** — Auto-start/stop timers on status changes
- **orchestratorDelegation** — Warn when orchestrator does implementation work instead of delegating

#### Visibility & Automation

- **GitHub Issues sync** — Bidirectional sync between GitHub Issues and your board
- **Activity page** — Status history with clickable task navigation, color-coded badges, and daily summary
- **Daily standup summary** — Generate standup reports via API or CLI (`vk summary standup`)
- **Task Templates** — Create reusable templates with defaults, subtasks, and multi-task blueprints
- **Documentation freshness** — Steward workflow with freshness headers and automated staleness detection
- **Cost prediction** — Multi-factor cost estimation for tasks

#### Dashboard

- **Where Time Went** — Time breakdown by project from telemetry data
- **Activity Clock** — 24-hour donut chart showing agent work patterns
- **Hourly Activity** — Bar chart with event counts per hour
- **Wall Time Toggle** — Total agent time + average run duration
- **Session Metrics** — Session count, success rate, completion tracking
- **Markdown rendering** — Rich markdown in task descriptions and comments
- **Timezone-aware metrics** — Server reports local timezone; clients can request metrics in any timezone via `?tz=`
- **Analytics API** — Timeline visualization and aggregate metrics (parallelism, throughput, lead time)

#### Organization

- **Subtasks** — Break down complex work with progress tracking
- **Task dependencies** — Bidirectional dependency graph with cycle detection, recursive tree API, and visual badges
- **Crash-recovery checkpointing** — Save/resume/clear agent state with auto-sanitization of secrets
- **Observational memory** — Per-task observations with importance scoring, full-text search, timeline view
- **Sprint management** — Full sprint CRUD from CLI and MCP with suggestions engine
- **Archive** — Searchable archive with one-click restore
- **Time tracking** — Start/stop timer or manual entry
- **Activity log** — Full history of task events

#### Settings & Customization

- **Modular settings** — 8 focused tabs (General, Board, Tasks, Agents, Data, Notifications, Security, Manage)
- **Security hardened** — XSS prevention, path traversal blocking, prototype pollution protection
- **WCAG 2.1 AA** — Full accessibility with ARIA labels, keyboard navigation
- **Error boundaries** — Crash isolation per tab with recovery options
- **Performance** — Lazy-loaded tabs, memoized components, debounced saves
- **Import/Export** — Backup and restore all settings with validation

#### Integration

- **CLI** — `vk` command for terminal workflows
- **MCP Server** — 33+ tools across 7 categories via Model Context Protocol
- **Notifications** — Teams integration for task updates

</details>

---

## 🛠️ Tech Stack

| Layer               | Technology                           | Version                          |
| ------------------- | ------------------------------------ | -------------------------------- |
| **Frontend**        | React, Vite, Tailwind CSS, Shadcn UI | React 19, Vite 7.3, Tailwind 4.2 |
| **Backend**         | Express, WebSocket                   | Express 5.2                      |
| **Language**        | TypeScript (strict mode)             | 6.0                              |
| **Storage**         | Markdown files with YAML frontmatter | gray-matter                      |
| **Git**             | simple-git, worktree management      | —                                |
| **Testing**         | Playwright (E2E), Vitest (unit)      | Playwright 1.58, Vitest 4        |
| **Runtime**         | Node.js                              | 22+                              |
| **Package Manager** | pnpm                                 | 9+                               |

---

## 🏆 Why Veritas Kanban?

Most agentic AI tools fall into one of two camps: **orchestration frameworks** that are powerful but invisible (CrewAI, AutoGen, LangGraph) — or **project boards** that look nice but have zero agent awareness (Jira, Linear, Notion).

Veritas Kanban is neither. It's the **visual command center for agentic work** — where you can see what your agents are doing, what they've done, and what they're about to do, with full audit trails and production guardrails.

### What makes VK different

|                                 |           Veritas Kanban            | CrewAI / AutoGen / LangGraph | Jira / Linear / Plane |
| ------------------------------- | :---------------------------------: | :--------------------------: | :-------------------: |
| **Visual task board**           |       ✅ Drag-and-drop Kanban       |     ❌ Code-only, no UI      |      ✅ Board UI      |
| **AI agent orchestration**      |       ✅ Native, multi-model        |       ✅ Core purpose        |   ❌ No agent story   |
| **YAML workflow pipelines**     |      ✅ Loops, gates, parallel      |     ⚠️ Code-defined only     |          ❌           |
| **Real-time agent dashboard**   |    ✅ Status, model attribution     |              ❌              |          ❌           |
| **Agent communication**         | ✅ Squad Chat with lifecycle events |       ⚠️ Internal only       |          ❌           |
| **MCP server**                  |            ✅ 33+ tools             |              ❌              |          ❌           |
| **CLI**                         |          ✅ Full lifecycle          |              ❌              |      ⚠️ Limited       |
| **Git worktrees + code review** |             ✅ Built-in             |              ❌              |          ❌           |
| **Task persistence**            |          ✅ Markdown files          |         ❌ In-memory         |      ✅ Database      |
| **Enforcement gates**           |       ✅ 6 configurable gates       |              ❌              |          ❌           |
| **Time + cost tracking**        |       ✅ Per-task, per-model        |              ❌              |       ⚠️ Basic        |
| **No database required**        |          ✅ Files on disk           |              ✅              |    ❌ Requires DB     |
| **Open source**                 |               ✅ MIT                |          ⚠️ Varies           |       ⚠️ Varies       |
| **Platform-agnostic**           |       ✅ Any agent, any model       |     ⚠️ Framework-locked      |          N/A          |

**The bottom line:** Orchestration frameworks give you agent execution without visibility. Project boards give you visibility without agent execution. Veritas Kanban gives you both — plus the guardrails, telemetry, and audit trails that production agentic work demands.

Built and battle-tested with [OpenClaw](https://github.com/openclaw/openclaw). Works with any platform that can make HTTP calls.

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

33+ tools across 7 categories (tasks, agents, automation, notifications, summaries, sprints, projects) via [Model Context Protocol](https://modelcontextprotocol.io/).

**→ [Full MCP documentation](docs/mcp/README.md)** — architecture, quickstart, tool catalog with examples, security model, and troubleshooting.

**Quick config** (Claude Desktop / Cursor / OpenClaw):

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

**After adding the config, restart OpenClaw:**

```bash
openclaw gateway restart
```

Verify discovery with `openclaw mcp list`. See [Troubleshooting](docs/TROUBLESHOOTING.md#mcp-server-connection-issues) if the server doesn't appear.

**Troubleshooting MCP connection issues:**

- **Always restart OpenClaw after MCP config changes** — MCP servers are discovered at startup
- **Verify tools are available:** Run `openclaw mcp list` to confirm 26 Veritas Kanban tools appear
- **When reporting issues, provide:**
  - OpenClaw version (`openclaw --version`)
  - VK version and health (`curl http://localhost:3001/api/health`)
  - MCP logs (`~/.openclaw/logs/mcp.log` on macOS/Linux)
  - API accessibility test (`curl -H "X-API-Key: your-key" http://localhost:3001/api/tasks`)

See [full MCP troubleshooting guide](docs/TROUBLESHOOTING.md#mcp-server-connection-issues) for details.

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

| Document                                       | Description                                  |
| ---------------------------------------------- | -------------------------------------------- |
| [Features](docs/FEATURES.md)                   | Complete feature reference                   |
| [API Reference](docs/API-REFERENCE.md)         | Auth, endpoints, WebSocket docs              |
| [CLI Guide](docs/CLI-GUIDE.md)                 | Comprehensive CLI usage guide                |
| [Self-Hosting Guide](docs/guides/SELF_HOST.md) | Production deployment, reverse proxy, Docker |
| [Deployment](docs/DEPLOYMENT.md)               | Docker, bare metal, env config               |
| [Troubleshooting](docs/TROUBLESHOOTING.md)     | Common issues & solutions                    |
| [Contributing](CONTRIBUTING.md)                | How to contribute, PR guidelines             |
| [Security Policy](SECURITY.md)                 | Vulnerability reporting                      |
| [Code of Conduct](CODE_OF_CONDUCT.md)          | Community guidelines                         |
| [Changelog](CHANGELOG.md)                      | Release history                              |
| [Sprint Docs](docs/)                           | Sprint planning & audit reports              |

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

### Shipped in v4.0.0

- ~~[#178](https://github.com/BradGroux/veritas-kanban/issues/178) — Agent Policy & Guard Engine~~ — Configurable tool/action policies with allow/deny/require-approval guard rules
- ~~[#179](https://github.com/BradGroux/veritas-kanban/issues/179) — Decision Audit Trail with Assumption Tracking~~ — Log decisions with confidence scores, evidence, and outcome tracking
- ~~[#180](https://github.com/BradGroux/veritas-kanban/issues/180) — Agent Output Evaluation & Scoring Framework~~ — Weighted criteria profiles with composite scoring
- ~~[#181](https://github.com/BradGroux/veritas-kanban/issues/181) — Behavioral Drift Detection & Alerting~~ — Metric baselines with configurable alert thresholds
- ~~[#182](https://github.com/BradGroux/veritas-kanban/issues/182) — User Feedback Loop with Sentiment Analytics~~ — Feedback collection with sentiment tagging and aggregate analytics
- ~~[#183](https://github.com/BradGroux/veritas-kanban/issues/183) — Draggable & Resizable Dashboard Widget Grid~~ — Drag-and-drop layout with persistence
- ~~[#184](https://github.com/BradGroux/veritas-kanban/issues/184) — Prompt Template Registry with Version Control~~ — Versioned templates with rollback and usage tracking
- ~~[#185](https://github.com/BradGroux/veritas-kanban/issues/185) — Global System Health Status Bar~~ — Five health levels across system, agents, and operations signals
- ~~[#186](https://github.com/BradGroux/veritas-kanban/issues/186) — Upgrade to shadcn/ui CLI v4.0~~ — All components updated with Tailwind v4 integration

### Backlog

- [WCAG 2.1 AA accessibility](https://github.com/BradGroux/veritas-kanban/issues/1) — Full keyboard navigation, screen reader support, color contrast
- [Example video](https://github.com/BradGroux/veritas-kanban/issues/68) — Hosted walkthrough video on YouTube or Vimeo

### Shipped in v3.3.x

- ~~[Task Dependencies Graph](https://github.com/BradGroux/veritas-kanban/issues/122)~~ — Bidirectional dependency model with cycle detection, recursive tree API, visual badges
- ~~[Crash-Recovery Checkpointing](https://github.com/BradGroux/veritas-kanban/issues/123)~~ — Save/resume/clear agent state with auto-sanitization of secrets, 1MB limit, 24h expiry
- ~~[Observational Memory](https://github.com/BradGroux/veritas-kanban/issues/124)~~ — Per-task observations with importance scoring (1-10), full-text search, timeline view
- ~~[Agent Filter](https://github.com/BradGroux/veritas-kanban/issues/125)~~ — Query tasks by agent name with `?agent=name` parameter
- ~~[Sprint Management CLI + MCP](https://github.com/BradGroux/veritas-kanban/issues/161)~~ — Full sprint CRUD from command line and MCP (list, create, update, delete, close, suggestions)
- ~~[Task↔Agent State Sync](https://github.com/BradGroux/veritas-kanban/issues/155)~~ — Bi-directional sync engine keeping task state consistent with agent execution
- ~~Orchestrator Delegation Enforcement~~ — Full enforcement gate with delegation violation reporting
- ~~Express 5 + Vite 7 + Tailwind 4 + Zod 4 migration~~ — Major dependency upgrades
- ~~[SSRF Webhook Protection](https://github.com/BradGroux/veritas-kanban/issues/165)~~ — Server-side request forgery safeguards
- ~~[WebSocket Broadcast Batching](https://github.com/BradGroux/veritas-kanban/issues/167)~~ — Prevents event loop blocking under high-frequency updates

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

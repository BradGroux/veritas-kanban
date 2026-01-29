<div align="center">

# Veritas Kanban

**Local-first task management and AI agent orchestration platform.**

Built for developers who want a visual Kanban board that integrates with AI coding agents.

[![CI (Work)](https://github.com/dm-bradgroux/veritas-kanban/actions/workflows/ci.yml/badge.svg)](https://github.com/dm-bradgroux/veritas-kanban/actions/workflows/ci.yml)
[![CI (Personal)](https://github.com/BradGroux/veritas-kanban/actions/workflows/ci.yml/badge.svg)](https://github.com/BradGroux/veritas-kanban/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)

<!-- TODO: Add hero screenshot -->

</div>

---

## ⚡ Quickstart

Get up and running in under 5 minutes:

```bash
git clone https://github.com/dm-bradgroux/veritas-kanban.git
cd veritas-kanban
pnpm install
cp server/.env.example server/.env   # Edit to change VERITAS_ADMIN_KEY
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) — that's it.

> **Note:** Never commit `.env` files. Use `.env.example` as a template — it contains safe placeholder values and documentation for every variable.

---

## ✨ Features

### 📋 Core Board

- **Drag-and-drop Kanban** — Move tasks across To Do, In Progress, Review, Done
- **Markdown storage** — Human-readable task files with YAML frontmatter
- **Dark mode** — Easy on the eyes, always

### 🔀 Code Workflow

- **Git worktrees** — Isolated branches per task, automatic cleanup
- **Code review** — Unified diff viewer with inline comments
- **Approval workflow** — Approve, request changes, or reject
- **Merge conflicts** — Visual conflict resolution UI
- **GitHub PRs** — Create pull requests directly from task detail

### 🤖 AI Agents

- **Clawdbot integration** — Spawns sub-agents via `sessions_spawn`
- **Multiple attempts** — Retry with different agents, preserve history
- **Running indicator** — Visual feedback when agents are working

### 🗂️ Organization

- **Subtasks** — Break down complex work with progress tracking
- **Dependencies** — Block tasks until prerequisites complete
- **Archive** — Searchable archive with one-click restore
- **Time tracking** — Start/stop timer or manual entry
- **Activity log** — Full history of task events

### ⚙️ Settings & Customization

- **Modular settings** — 7 focused tabs (General, Board, Tasks, Agents, Data, Notifications, Manage)
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
│   ├── active/                  ← Current tasks
│   └── archive/                 ← Archived tasks
│
└── .veritas-kanban/             ← Runtime config & data
    ├── config.json
    ├── worktrees/
    ├── logs/
    └── agent-requests/
```

**Data flow:** Web ↔ REST API / WebSocket ↔ Server ↔ Markdown files on disk

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

```bash
# Install globally
cd cli && npm link

# Task management
vk list                          # List all tasks
vk list --status in-progress     # Filter by status
vk show <id>                     # Task details
vk create "Title" --type code    # Create task
vk update <id> --status review   # Update task

# Agent commands
vk agents:pending                # List pending agent requests
vk agents:status <id>            # Check if agent running
vk agents:complete <id> -s       # Mark agent complete

# Utilities
vk summary                       # Project stats
vk notify:pending                # Check notifications
```

---

## 🤖 Agent Integration

Veritas Kanban integrates with [Clawdbot](https://github.com/clawdbot/clawdbot) for AI agent orchestration.

### How It Works

1. **Start Agent** — Click "Start Agent" in the UI on a code task
2. **Request Created** — Server writes to `.veritas-kanban/agent-requests/`
3. **Veritas Picks Up** — Tell Veritas "I started an agent on task X"
4. **Sub-agent Spawns** — Clawdbot's `sessions_spawn` handles PTY and execution
5. **Work Complete** — Agent commits changes and calls completion endpoint
6. **Task Updates** — Status moves to Review, notifications sent

### Manual Trigger

```bash
# Check for pending requests
vk agents:pending

# If you're Veritas, spawn the sub-agent and call:
curl -X POST http://localhost:3001/api/agents/<task-id>/complete \
  -H "Content-Type: application/json" \
  -d '{"success": true, "summary": "What was done"}'
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

| Document                              | Description                      |
| ------------------------------------- | -------------------------------- |
| [Contributing](CONTRIBUTING.md)       | How to contribute, PR guidelines |
| [Security Policy](SECURITY.md)        | Vulnerability reporting          |
| [Code of Conduct](CODE_OF_CONDUCT.md) | Community guidelines             |
| [Changelog](CHANGELOG.md)             | Release history                  |
| [Sprint Docs](docs/)                  | Sprint planning & audit reports  |

---

## 🔗 Repositories

| Repository   | URL                                            |
| ------------ | ---------------------------------------------- |
| **Work**     | https://github.com/dm-bradgroux/veritas-kanban |
| **Personal** | https://github.com/BradGroux/veritas-kanban    |

---

## 📜 License

[MIT](LICENSE) © 2026 [Digital Meld](https://digitalmeld.io)

# Veritas Kanban

[![CI](https://github.com/dm-bradgroux/veritas-kanban/actions/workflows/ci.yml/badge.svg)](https://github.com/dm-bradgroux/veritas-kanban/actions/workflows/ci.yml)
[![CI](https://github.com/BradGroux/veritas-kanban/actions/workflows/ci.yml/badge.svg)](https://github.com/BradGroux/veritas-kanban/actions/workflows/ci.yml)

A local-first task management and AI agent orchestration platform. Built for developers who want a visual Kanban board that integrates with AI coding agents.

## Features

### Core
- 📋 **Kanban Board** — Drag-and-drop task management across To Do, In Progress, Review, Done
- 📝 **Markdown Storage** — Human-readable task files with YAML frontmatter
- 🌙 **Dark Mode** — Easy on the eyes, always

### Code Workflow
- 🌳 **Git Worktrees** — Isolated branches per task, automatic cleanup
- 🔍 **Code Review** — Unified diff viewer with inline comments
- ✅ **Approval Workflow** — Approve, request changes, or reject
- 🔀 **Merge Conflicts** — Visual conflict resolution UI
- 🔗 **GitHub PRs** — Create PRs directly from task detail

### AI Agents
- 🤖 **Clawdbot Integration** — Spawns sub-agents via `sessions_spawn`
- 🔄 **Multiple Attempts** — Retry with different agents, preserve history
- 📊 **Running Indicator** — Visual feedback when agents are working

### Organization
- 📁 **Subtasks** — Break down complex work with progress tracking
- 🔗 **Dependencies** — Block tasks until prerequisites complete
- 📦 **Archive** — Searchable archive with one-click restore
- ⏱️ **Time Tracking** — Start/stop timer or manual entry
- 📋 **Activity Log** — Full history of task events

### Settings & Customization (Sprint 1150)
- ⚙️ **Modular Settings** — 7 focused tabs (General, Board, Tasks, Agents, Data, Notifications, Manage)
- 🔒 **Security Hardened** — XSS prevention, path traversal blocking, prototype pollution protection
- ♿ **WCAG 2.1 AA** — Full accessibility with descriptive ARIA labels, keyboard navigation
- 🛡️ **Error Boundaries** — Crash isolation per tab with recovery options
- 🚀 **Performance** — Lazy-loaded tabs, memoized components, debounced saves
- 📦 **Import/Export** — Backup and restore all settings with validation

### Integration
- 🖥️ **CLI** — `vk` command for terminal workflows
- 🔌 **MCP Server** — Model Context Protocol for AI assistants
- 🔔 **Notifications** — Teams integration for task updates

## Quick Start

```bash
# Clone
git clone https://github.com/dm-bradgroux/veritas-kanban.git
cd veritas-kanban

# Set up environment variables
cp server/.env.example server/.env
# Edit server/.env — at minimum, change VERITAS_ADMIN_KEY

# (Optional) Set up web env if you need a custom API URL
# cp web/.env.example web/.env

# Install
pnpm install

# Run
pnpm dev
```

Open http://localhost:3000

> **Note:** Never commit `.env` files. Use `.env.example` as a template — it contains safe placeholder values and documentation for every variable.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 22+ |
| Language | TypeScript (strict) |
| Server | Express + WebSocket |
| Frontend | React 19 + Vite + shadcn/ui |
| Storage | Markdown files (gray-matter) |
| Git | simple-git |

## Project Structure

```
veritas-kanban/
├── server/            # Express API + WebSocket
├── web/               # React frontend  
├── shared/            # TypeScript types
├── cli/               # vk CLI tool
├── mcp/               # MCP server for AI assistants
├── docs/              # Sprint documentation
├── tasks/             # Task storage (markdown)
│   ├── active/
│   └── archive/
└── .veritas-kanban/   # Config, logs, worktrees
    ├── config.json
    ├── worktrees/
    ├── logs/
    └── agent-requests/
```

## API Versioning

All API endpoints support versioned paths. The current (and default) version is **v1**.

### URL Patterns

| Path | Description |
|------|-------------|
| `/api/v1/tasks` | Canonical versioned endpoint |
| `/api/tasks` | Backwards-compatible alias (same as v1) |

Both paths return identical responses. Existing clients using `/api/...` will continue to work without changes.

### Version Header

Every API response includes an `X-API-Version: v1` header. Clients may optionally send an `X-API-Version` request header to explicitly request a version:

```bash
# Explicit version request
curl -H "X-API-Version: v1" http://localhost:3001/api/tasks

# Requesting an unsupported version returns 400
curl -H "X-API-Version: v99" http://localhost:3001/api/tasks
# → {"error":"Unsupported API version","supported":["v1"]}
```

### Versioning Strategy

- **Non-breaking changes** (new fields, new endpoints) are added to the current version.
- **Breaking changes** will introduce a new version (`v2`). The previous version will remain available during a deprecation period.
- The unversioned `/api/...` alias always points to the latest stable version.

## CLI

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

## Agent Integration

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

## MCP Server

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

| Tool | Description |
|------|-------------|
| `list_tasks` | List with filters |
| `get_task` | Get task by ID |
| `create_task` | Create new task |
| `update_task` | Update fields |
| `archive_task` | Archive task |

### Resources

| URI | Description |
|-----|-------------|
| `kanban://tasks` | All tasks |
| `kanban://tasks/active` | In-progress + review |
| `kanban://task/{id}` | Single task |

## Task Format

Tasks are markdown files with YAML frontmatter:

```markdown
---
id: "task_20260126_abc123"
title: "Implement feature X"
type: "code"
status: "in-progress"
priority: "high"
project: "rubicon"
git:
  repo: "my-project"
  branch: "feature/task_abc123"
  baseBranch: "main"
---

## Description

Task details here...
```

## Development

```bash
pnpm dev        # Start dev servers
pnpm build      # Production build
pnpm typecheck  # TypeScript check
```

## Repositories

- **Work**: https://github.com/dm-bradgroux/veritas-kanban
- **Personal**: https://github.com/BradGroux/veritas-kanban

## License

MIT

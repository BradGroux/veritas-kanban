# CLI Guide

Comprehensive guide to the `vk` command-line tool for Veritas Kanban.

> 📋 Back to [README](../README.md) · [Features](FEATURES.md) · [Changelog](../CHANGELOG.md)

---

## Table of Contents

- [Introduction](#introduction)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Command Reference](#command-reference)
  - [Workflow Commands](#workflow-commands)
  - [Task Commands](#task-commands)
  - [Time Tracking](#time-tracking)
  - [Comments](#comments)
  - [Agent Status](#agent-status)
  - [Project Management](#project-management)
  - [Agent Commands](#agent-commands)
  - [Automation Commands](#automation-commands)
  - [GitHub Sync](#github-sync)
  - [Utilities](#utilities)
- [Workflow Commands Deep Dive](#workflow-commands-deep-dive)
- [Scripting & Automation](#scripting--automation)
- [Configuration](#configuration)
- [Tips & Tricks](#tips--tricks)

---

## Introduction

`vk` is the command-line interface for [Veritas Kanban](../README.md) — a local-first task management and AI agent orchestration platform. It lets you manage tasks, track time, coordinate agents, and run your entire project workflow without leaving the terminal.

> 💡 **Philosophy:** _"Automate everything you do twice."_
>
> This principle — championed by Boris Cherny, creator of Claude Code — is at the heart of the v1.4 CLI additions. If you're doing the same multi-step workflow every time you start or finish a task, that workflow should be a single command. That's exactly what `vk begin` and `vk done` deliver.

The CLI talks to the Veritas Kanban server over its REST API, so any command you run in the terminal has the same effect as clicking through the web UI or calling the API directly with curl.

---

## Installation

```bash
# Clone the repository (if you haven't already)
git clone https://github.com/BradGroux/veritas-kanban.git
cd veritas-kanban

# Install dependencies
pnpm install

# Link the CLI globally
cd cli && npm link
```

After linking, the `vk` command is available globally in your terminal.

```bash
vk --help
```

> **Prerequisite:** The Veritas Kanban server must be running for CLI commands to work.
> Start it with `pnpm dev` from the repository root.

---

## Quick Start

The complete task lifecycle in three commands:

```bash
# 1. Create a task
vk create "Implement OAuth login" --type code --project my-app

# 2. Start working — one command handles everything
vk begin task_20260201_abc123

# 3. Finish up — one command wraps it all
vk done task_20260201_abc123 "Added OAuth2 with Google and GitHub providers"
```

That's it. `vk begin` sets the task to in-progress, starts the time tracker, and marks the agent as working. `vk done` stops the timer, marks the task done, adds a closing comment, and sets the agent to idle. What used to require 6+ API calls now takes 2 commands.

---

## Command Reference

### Workflow Commands

Composite commands that orchestrate multiple API calls into a single action.

#### `vk begin <id>`

Start working on a task. Orchestrates three actions in one command.

```bash
vk begin task_20260201_abc123
```

**What it does:**

1. Sets task status to `in-progress`
2. Starts the time tracker
3. Updates agent status to `working` (auto-fetches task title)

**Flags:**
| Flag | Description |
| -------- | ------------------------- |
| `--json` | Output result as JSON |

---

#### `vk done <id> "summary"`

Complete a task with a summary. Orchestrates four actions in one command.

```bash
vk done task_20260201_abc123 "Added OAuth2 with Google and GitHub providers"
```

**What it does:**

1. Stops the time tracker
2. Sets task status to `done`
3. Adds a comment with the summary text
4. Updates agent status to `idle`

**Flags:**
| Flag | Description |
| -------- | ------------------------- |
| `--json` | Output result as JSON |

---

#### `vk block <id> "reason"`

Block a task with a reason.

```bash
vk block task_20260201_abc123 "Waiting on API credentials from client"
```

**What it does:**

1. Sets task status to `blocked`
2. Adds a comment with the block reason

**Flags:**
| Flag | Description |
| -------- | ------------------------- |
| `--json` | Output result as JSON |

---

#### `vk unblock <id>`

Unblock a task and resume work.

```bash
vk unblock task_20260201_abc123
```

**What it does:**

1. Sets task status to `in-progress`
2. Restarts the time tracker

**Flags:**
| Flag | Description |
| -------- | ------------------------- |
| `--json` | Output result as JSON |

---

### Task Commands

Core task management commands.

#### `vk list`

List tasks with optional filters.

```bash
vk list                           # All tasks
vk list --status in-progress      # Filter by status
vk list --type code               # Filter by type
vk list --project my-app          # Filter by project
vk list --status in-progress --type code  # Combine filters
vk list --json                    # JSON output
```

**Aliases:** `ls`

**Flags:**
| Flag | Description |
| ----------- | ---------------------------------------- |
| `--status` | Filter by status (todo, in-progress, blocked, done) |
| `--type` | Filter by task type |
| `--project` | Filter by project name |
| `--json` | Output as JSON |

---

#### `vk show <id>`

Show detailed information for a task.

```bash
vk show task_20260201_abc123
vk show abc123                    # Partial ID matching supported
vk show abc123 --json
```

**Flags:**
| Flag | Description |
| -------- | ------------------------- |
| `--json` | Output as JSON |

---

#### `vk create <title>`

Create a new task.

```bash
vk create "Implement OAuth login"
vk create "Fix button alignment" --type code --priority high --project my-app
```

**Flags:**
| Flag | Description |
| ------------ | -------------------------------------------- |
| `--type` | Task type (code, research, content, etc.) |
| `--priority` | Priority level (low, medium, high) |
| `--project` | Project name |
| `--json` | Output as JSON |

---

#### `vk update <id>`

Update task fields.

```bash
vk update abc123 --status review
vk update abc123 --title "New title" --priority high
```

**Flags:**
| Flag | Description |
| ------------ | ------------------------------ |
| `--status` | New status |
| `--title` | New title |
| `--priority` | New priority |
| `--type` | New type |
| `--project` | New project |
| `--json` | Output as JSON |

---

### Time Tracking

Full time management from the terminal.

#### `vk time start <id>`

Start the time tracker for a task.

```bash
vk time start task_20260201_abc123
```

---

#### `vk time stop <id>`

Stop the time tracker.

```bash
vk time stop task_20260201_abc123
```

---

#### `vk time entry <id> <seconds> "description"`

Add a manual time entry.

```bash
vk time entry task_20260201_abc123 3600 "Implemented login flow"
vk time entry abc123 1800 "Code review"
```

**Arguments:**
| Argument | Description |
| ------------- | ----------------------------------- |
| `<id>` | Task ID (supports partial matching) |
| `<seconds>` | Duration in seconds |
| `"description"` | Description of the work done |

---

#### `vk time show <id>`

Display time tracking summary for a task.

```bash
vk time show task_20260201_abc123
vk time show abc123 --json
```

**Output includes:** total time, whether a timer is currently running, and individual time entries with descriptions.

**Flags:**
| Flag | Description |
| -------- | ------------------------- |
| `--json` | Output as JSON |

---

### Comments

Add comments to tasks from the terminal.

#### `vk comment <id> "text"`

```bash
vk comment task_20260201_abc123 "Fixed the race condition in the auth flow"
vk comment abc123 "Completed OAuth integration" --author Veritas
```

**Flags:**
| Flag | Description |
| ---------- | --------------------------------------- |
| `--author` | Author name (default: CLI user) |
| `--json` | Output as JSON |

---

### Agent Status

Manage the global agent status indicator.

#### `vk agent status`

Show the current agent status.

```bash
vk agent status
vk agent status --json
```

---

#### `vk agent working <id>`

Set agent status to working on a specific task. Automatically fetches the task title.

```bash
vk agent working task_20260201_abc123
```

---

#### `vk agent idle`

Set agent status to idle.

```bash
vk agent idle
```

---

#### `vk agent sub-agent <count>`

Set agent status to sub-agent mode with a count of active sub-agents.

```bash
vk agent sub-agent 3
```

---

### Project Management

Manage projects from the terminal.

#### `vk project list`

List all projects.

```bash
vk project list
vk project list --json
```

---

#### `vk project create "name"`

Create a new project.

```bash
vk project create "my-app"
vk project create "rubicon" --color "#7c3aed" --description "Main product"
```

**Flags:**
| Flag | Description |
| --------------- | ------------------------ |
| `--color` | Project color (hex) |
| `--description` | Project description |
| `--json` | Output as JSON |

---

### Agent Commands

Manage AI agents on code tasks.

| Command                      | Description                                         |
| ---------------------------- | --------------------------------------------------- |
| `vk start <id>`              | Start an agent on a code task (`--agent` to choose) |
| `vk stop <id>`               | Stop a running agent                                |
| `vk agents:pending`          | List pending agent requests                         |
| `vk agents:status <id>`      | Check agent running status                          |
| `vk agents:complete <id> -s` | Mark agent complete (success)                       |
| `vk agents:complete <id> -f` | Mark agent complete (failure)                       |

---

### Automation Commands

Manage automation tasks.

| Command                       | Alias | Description                        |
| ----------------------------- | ----- | ---------------------------------- |
| `vk automation:pending`       | `ap`  | List pending automation tasks      |
| `vk automation:running`       | `ar`  | List running automation tasks      |
| `vk automation:start <id>`    | `as`  | Start an automation task           |
| `vk automation:complete <id>` | `ac`  | Mark automation complete or failed |

---

### GitHub Sync

Manage GitHub Issues bidirectional sync.

| Command              | Description                                       |
| -------------------- | ------------------------------------------------- |
| `vk github sync`     | Trigger a manual GitHub Issues sync               |
| `vk github status`   | Show last sync status (timestamp, counts, errors) |
| `vk github config`   | View or update GitHub sync configuration          |
| `vk github mappings` | List issue↔task mappings                          |

---

### Utilities

| Command               | Description                                                                    |
| --------------------- | ------------------------------------------------------------------------------ |
| `vk summary`          | Project stats: status counts, project progress, high-priority items            |
| `vk summary standup`  | Daily standup summary (`--yesterday`, `--date YYYY-MM-DD`, `--json`, `--text`) |
| `vk notify <message>` | Create a notification (`--type`, `--title`, `--task` options)                  |
| `vk notify:check`     | Check for tasks that need notifications                                        |
| `vk notify:pending`   | Get pending notifications formatted for Teams                                  |

---

## Workflow Commands Deep Dive

### The Problem

Before v1.4, starting or finishing a task required multiple separate API calls. A typical agent workflow looked like this:

```bash
# Starting a task (3 calls)
curl -X PATCH http://localhost:3002/api/tasks/<id> \
  -H "Content-Type: application/json" \
  -d '{"status":"in-progress"}'

curl -X POST http://localhost:3002/api/tasks/<id>/time/start

curl -X POST http://localhost:3002/api/agent/status \
  -H "Content-Type: application/json" \
  -d '{"status":"working","taskId":"<id>","taskTitle":"Implement OAuth"}'

# ... work happens ...

# Completing a task (4 calls)
curl -X POST http://localhost:3002/api/tasks/<id>/time/stop

curl -X PATCH http://localhost:3002/api/tasks/<id> \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}'

curl -X POST http://localhost:3002/api/tasks/<id>/comments \
  -H "Content-Type: application/json" \
  -d '{"author":"agent","text":"Added OAuth2 with Google and GitHub providers"}'

curl -X POST http://localhost:3002/api/agent/status \
  -H "Content-Type: application/json" \
  -d '{"status":"idle"}'
```

That's 7 curl commands across the lifecycle — easy to get wrong, tedious to type, and guaranteed to be inconsistent if you're doing it manually.

### The Solution

```bash
vk begin <id>
# ... work happens ...
vk done <id> "Added OAuth2 with Google and GitHub providers"
```

Two commands. Same result. Every step is orchestrated in the correct order, every time.

### What Each Command Orchestrates

| Command      | Step 1               | Step 2           | Step 3          | Step 4       |
| ------------ | -------------------- | ---------------- | --------------- | ------------ |
| `vk begin`   | Status → in-progress | Timer → start    | Agent → working | —            |
| `vk done`    | Timer → stop         | Status → done    | Comment → added | Agent → idle |
| `vk block`   | Status → blocked     | Comment → reason | —               | —            |
| `vk unblock` | Status → in-progress | Timer → restart  | —               | —            |

### Handling Blocked Tasks

Real-world tasks get blocked. The `vk block` and `vk unblock` commands handle this gracefully:

```bash
# Task hits a blocker
vk block abc123 "Waiting on API credentials from client"

# Blocker resolved — pick up where you left off
vk unblock abc123
```

The block reason is automatically recorded as a comment on the task, creating an audit trail of why work was paused.

---

## Scripting & Automation

Every command supports `--json` output for machine consumption, making `vk` a first-class tool for scripting and automation.

### Piping and JSON Processing

```bash
# Get all in-progress task IDs
vk list --status in-progress --json | jq -r '.[] | .id'

# Count tasks by status
vk list --json | jq 'group_by(.status) | map({status: .[0].status, count: length})'

# Get time spent on a task
vk time show abc123 --json | jq '.totalTime'
```

### Agent Automation

Use workflow commands in agent configurations (like `AGENTS.md`) to standardize task lifecycle management:

```bash
# In an agent's task handler
TASK_ID="$1"

# Start work
vk begin "$TASK_ID"

# ... perform the work ...

# Complete with summary
vk done "$TASK_ID" "Completed implementation of feature X"
```

### CI/CD Integration

```bash
# Create a task for each deployment
TASK_ID=$(vk create "Deploy v2.1.2 to staging" --type automation --project ops --json | jq -r '.id')

# Track the deployment
vk begin "$TASK_ID"

# ... deployment steps ...

if [ $? -eq 0 ]; then
  vk done "$TASK_ID" "Successfully deployed v2.1.2 to staging"
else
  vk block "$TASK_ID" "Deployment failed — check CI logs"
fi
```

### Batch Operations

```bash
# Block all tasks in a project
vk list --project legacy-app --status in-progress --json | \
  jq -r '.[].id' | \
  xargs -I {} vk block {} "Project on hold pending budget approval"
```

---

## Configuration

The CLI reads configuration from environment variables:

| Variable     | Default                 | Description                |
| ------------ | ----------------------- | -------------------------- |
| `VK_API_URL` | `http://localhost:3002` | Veritas Kanban server URL  |
| `VK_API_KEY` | _(none)_                | API key for authentication |

### Setting the API URL

```bash
# Default — local development
export VK_API_URL=http://localhost:3002

# Remote server
export VK_API_URL=https://kanban.example.com
```

### Setting the API Key

```bash
# Set your API key for authenticated endpoints
export VK_API_KEY=your-api-key-here
```

If you're running locally with localhost auth bypass enabled (the default), you may not need an API key for most operations.

---

## Tips & Tricks

### Shell Aliases

Add these to your `.bashrc` or `.zshrc` for even faster workflows:

```bash
# Quick task lifecycle
alias vkb='vk begin'
alias vkd='vk done'
alias vkl='vk list --status in-progress'

# Common filters
alias vktodo='vk list --status todo'
alias vkblocked='vk list --status blocked'
alias vkdone='vk list --status done'

# Agent status shortcuts
alias vka='vk agent status'
alias vkai='vk agent idle'
```

### Partial ID Matching

You don't need to type the full task ID. `vk show` and other commands support partial matching:

```bash
# Full ID
vk show task_20260201_abc123

# Partial — just the unique suffix
vk show abc123
```

### Quick Standup

Generate your daily standup in one command:

```bash
# Today's standup in the terminal
vk summary standup

# Yesterday's standup (for morning standups)
vk summary standup --yesterday

# Pipe to clipboard (macOS)
vk summary standup --text | pbcopy
```

### Combined Create + Begin

Create a task and immediately start working on it:

```bash
# Create and capture the ID
TASK_ID=$(vk create "Fix login bug" --type code --project my-app --json | jq -r '.id')

# Start working
vk begin "$TASK_ID"
```

### Monitoring Agent Status

Check what the agent is up to:

```bash
# Current agent status
vk agent status

# See all in-progress tasks (what's being worked on)
vk list --status in-progress
```

---

_Part of [Veritas Kanban](../README.md) · Built by [Digital Meld](https://digitalmeld.io)_

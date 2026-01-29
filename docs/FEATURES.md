# Features

Complete feature reference for Veritas Kanban. For a quick overview, see the [README](../README.md).

---

## Table of Contents

- [Board & Task Management](#board--task-management)
- [Subtasks & Dependencies](#subtasks--dependencies)
- [Sprint Management](#sprint-management)
- [Code Workflow](#code-workflow)
- [AI Agent Integration](#ai-agent-integration)
- [CLI](#cli)
- [MCP Server](#mcp-server)
- [Security](#security)
- [Performance](#performance)
- [Dashboard & Analytics](#dashboard--analytics)
- [Settings & Customization](#settings--customization)
- [API](#api)
- [Notifications](#notifications)
- [Infrastructure & DevOps](#infrastructure--devops)
- [Testing](#testing)
- [Accessibility](#accessibility)

---

## Board & Task Management

The Kanban board is the central interface — a drag-and-drop workspace that reflects your project's state in real time.

- **Kanban columns** — Four default columns: To Do, In Progress, Blocked, Done
- **Drag-and-drop** — Move tasks between columns with [@dnd-kit](https://dndkit.com/); reorder within columns
- **Task CRUD** — Create, read, update, and delete tasks through the UI or API
- **Create task dialog** — Quick-create with title, type, priority, project, sprint, and description
- **Task detail panel** — Slide-out sheet with tabbed sections: Details, Git, Agent, Diff, Review, Preview, Attachments, Metrics
- **Task types** — Configurable type system with icons and color-coded card borders (code, research, content, automation, and custom types)
- **Priority levels** — Low, medium, and high with visual indicators on cards
- **Markdown storage** — Tasks stored as human-readable `.md` files with YAML frontmatter (via [gray-matter](https://github.com/jonschlinkert/gray-matter))
- **Dark mode** — Ships dark by default; easy on the eyes
- **Filter bar** — Search tasks by text, filter by project and task type; filters persist in URL query params
- **Bulk operations** — Select multiple tasks to move, archive, or delete in batch; select-all toggle
- **Keyboard shortcuts** — Navigate tasks (j/k, arrows), open (Enter), close (Esc), create (c), move to column (1-4), help (?)
- **Loading skeleton** — Shimmer placeholders while the board loads
- **Blocked column** — Dedicated column for blocked tasks with categorized reasons (waiting on feedback, technical snag, prerequisite, other)
- **Comments** — Add, edit, and delete comments on tasks with author attribution and relative timestamps
- **File attachments** — Upload files to tasks with MIME-type icons, file size display, and text extraction for documents
- **Task templates** — Create reusable templates with variable interpolation; apply templates to new or existing tasks (v1 format with migration from v0)
- **Blueprint preview** — Preview template output before applying
- **Markdown preview** — Live preview panel for task descriptions
- **Activity log** — Full history of task events (created, updated, status changed, agent started/completed, archived, etc.)
- **Archive sidebar** — Searchable archive with filters by project, sprint, and type; paginated (25 per page); one-click restore
- **Archive suggestion banner** — Prompts to archive completed sprint tasks

---

## Subtasks & Dependencies

Break down complex work and manage task ordering.

- **Subtask creation** — Add subtasks inline with Enter-to-submit
- **Progress tracking** — Visual progress bar on task cards showing completion ratio (e.g., "3/5")
- **Toggle completion** — Check/uncheck subtasks with immediate save
- **Auto-complete** — Optional: automatically mark parent task as done when all subtasks complete
- **Delete subtasks** — Remove individual subtasks
- **Dependency blocking** — Add other tasks as blockers via a dependency picker
- **Block status detection** — Tasks with incomplete blockers show a blocked indicator on their card
- **Blocker status display** — See whether each blocker is done (green) or still pending (blocked icon)
- **Dependency removal** — Remove blockers individually

---

## Sprint Management

Organize work into time-boxed iterations.

- **Sprint assignment** — Assign tasks to named sprints from the task detail panel
- **Sprint list management** — Create, rename, reorder, and archive sprints through the Manage settings tab
- **Sprint seed migration** — On first run, sprints are auto-discovered from existing task data
- **Reference counting** — See how many tasks are in each sprint
- **Archive suggestion** — Banner prompts to archive all "Done" tasks when a sprint is complete
- **Sprint filtering** — Filter the archive sidebar by sprint
- **Sprint labels** — Sprint names displayed on task cards

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

## AI Agent Integration

First-class support for autonomous coding agents.

- **Agent orchestration** — Start, stop, and monitor AI agents on code tasks from the UI or API
- **Multi-agent support** — Choose from Claude Code, Amp, Copilot, Gemini, or Veritas agents
- **Agent request files** — Server writes structured requests to `.veritas-kanban/agent-requests/` for agent pickup
- **Completion callbacks** — Agents call the completion endpoint with success/failure status and summary
- **Multiple attempts** — Retry tasks with different agents; full attempt history preserved with status (pending, running, complete, failed)
- **Attempt history viewer** — Browse past attempts with agent name, status, and log output
- **Time tracking** — Start/stop timer or add manual time entries per task; running timer display with live elapsed counter
- **Time entry management** — View, add, and delete individual time entries with duration parsing (e.g., "1h 30m")
- **Agent status indicator** — Header-level indicator showing global agent state (idle, working, sub-agent mode with count)
- **Running indicator on cards** — Animated spinner on task cards when an agent is actively working
- **Agent output stream** — Real-time agent output via WebSocket with auto-scroll and clear
- **Send message to agent** — Send text messages to running agents
- **Moltbot native support** — Built-in integration with [Moltbot](https://github.com/moltbot/moltbot) (formerly Clawdbot) via gateway URL; sub-agent spawning via `sessions_spawn`
- **Platform-agnostic REST API** — Any platform that can make HTTP calls can drive the full agent lifecycle
- **Automation tasks** — Separate automation task type with pending/running/complete lifecycle, session key tracking, and sub-agent spawning
- **Failure alerts** — Dedicated failure alert service for agent run failures

---

## CLI

The `vk` command-line tool for terminal-first workflows.

### Task Commands

| Command             | Alias | Description                                                        |
| ------------------- | ----- | ------------------------------------------------------------------ |
| `vk list`           | `ls`  | List tasks with optional `--status`, `--type`, `--project` filters |
| `vk show <id>`      |       | Show task details (supports partial ID matching)                   |
| `vk create <title>` |       | Create a new task with `--type`, `--priority`, `--project` options |
| `vk update <id>`    |       | Update task fields (`--status`, `--title`, `--priority`, etc.)     |

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

### Utility Commands

| Command               | Description                                                         |
| --------------------- | ------------------------------------------------------------------- |
| `vk summary`          | Project stats: status counts, project progress, high-priority items |
| `vk notify <message>` | Create a notification (`--type`, `--title`, `--task` options)       |
| `vk notify:check`     | Check for tasks that need notifications                             |
| `vk notify:pending`   | Get pending notifications formatted for Teams                       |

All commands support `--json` output for machine consumption.

---

## MCP Server

Model Context Protocol server for AI assistant integration (Claude Desktop, etc.).

### Tools

| Tool                        | Description                                          |
| --------------------------- | ---------------------------------------------------- |
| `list_tasks`                | List tasks with optional status/type/project filters |
| `get_task`                  | Get task by ID (supports partial matching)           |
| `create_task`               | Create a new task                                    |
| `update_task`               | Update task fields                                   |
| `archive_task`              | Archive a task                                       |
| `start_agent`               | Start an AI agent on a code task                     |
| `stop_agent`                | Stop a running agent                                 |
| `list_pending_automation`   | List automation tasks awaiting execution             |
| `list_running_automation`   | List currently running automation tasks              |
| `start_automation`          | Start an automation task via sub-agent               |
| `complete_automation`       | Mark automation complete or failed                   |
| `create_notification`       | Create a notification for Teams delivery             |
| `get_pending_notifications` | Get unsent notifications formatted for Teams         |
| `check_notifications`       | Check for tasks needing notification                 |
| `get_summary`               | Overall kanban summary (status counts, projects)     |
| `get_memory_summary`        | Task summary formatted for AI memory files           |

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

### Data Protection

- **MIME type validation** — Server-side file type validation for uploads via [multer](https://github.com/expressjs/multer)
- **Markdown sanitization** — XSS prevention via `sanitizeText()` on all user-generated content
- **Timing-safe comparison** — Credential comparison uses `crypto.timingSafeEqual` to prevent timing attacks
- **Credential redaction** — Sensitive fields stripped from task data in API responses
- **Path traversal protection** — Input validation to prevent directory traversal in file operations
- **Prototype pollution protection** — Settings validation prevents `__proto__` and constructor injection
- **Zod schema validation** — All API inputs validated with [Zod](https://zod.dev/) schemas

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

### Frontend

- **Lazy-loaded dashboard** — Dashboard with recharts + d3 (~800KB) split into a separate chunk, loaded on demand
- **Vendor chunk splitting** — 69% bundle size reduction via Vite code splitting
- **Lazy-loaded settings tabs** — Each of the 8 settings tabs loaded on demand with skeleton placeholders
- **Memoized task cards** — Custom `React.memo` comparison function avoids unnecessary re-renders from React Query refetches
- **Debounced saves** — Task edits debounced to reduce API calls
- **Loading skeletons** — Board, settings tabs, and dashboard show shimmer placeholders during load

---

## Dashboard & Analytics

Real-time project metrics and telemetry.

- **Time period selector** — View metrics for 24h, 7d, 30d, or all-time periods
- **Project filter** — Drill into metrics for a specific project
- **Task status overview** — Counts for each column with color-coded metric cards
- **Trend indicators** — Up/down/flat trends with percentage change compared to previous period
- **Blocked task breakdown** — Blocked task counts by category (feedback, technical snag, prerequisite, other)
- **Sprint velocity** — Track task completion rate over time
- **Cost budget tracking** — Token usage and cost metrics with budget cards
- **Agent comparison** — Side-by-side performance metrics across different AI agents
- **Drill-down panels** — Click any metric card to drill into tasks, errors, tokens, or duration details
  - **Tasks drill-down** — List of tasks matching the selected metric
  - **Errors drill-down** — Failed agent runs with error details
  - **Tokens drill-down** — Token usage breakdown by agent and task
  - **Duration drill-down** — Time distribution analysis
- **Trends charts** — Time-series charts for key metrics
- **Status timeline** — Visual timeline of task status changes
- **Daily digest** — Summary of the day's activity: tasks completed/created, agent runs, token usage, failures and issues
- **Task-level metrics** — Per-task panel showing attempt history, token counts, duration, cost, and status timeline
- **Export dialog** — Export dashboard data for external analysis

---

## Settings & Customization

Modular settings system with 8 focused tabs.

| Tab               | What It Controls                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| **General**       | Application-wide preferences                                                                                   |
| **Board**         | Column visibility and board layout                                                                             |
| **Tasks**         | Default values, auto-complete behavior                                                                         |
| **Agents**        | Agent configuration, default agent selection                                                                   |
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

| Route Prefix                    | Description                                     |
| ------------------------------- | ----------------------------------------------- |
| `/api/v1/tasks`                 | Task CRUD, listing, reordering                  |
| `/api/v1/tasks/archived`        | Archive listing, restore                        |
| `/api/v1/tasks/:id/time`        | Time tracking (start, stop, entries)            |
| `/api/v1/tasks/:id/comments`    | Comments (add, edit, delete)                    |
| `/api/v1/tasks/:id/subtasks`    | Subtask management                              |
| `/api/v1/tasks/:id/attachments` | File attachments (upload, download, delete)     |
| `/api/v1/config`                | Board configuration                             |
| `/api/v1/settings`              | Feature settings                                |
| `/api/v1/agents`                | Agent start, stop, status, attempts, completion |
| `/api/v1/agent/status`          | Global agent status indicator                   |
| `/api/v1/automation`            | Automation task lifecycle                       |
| `/api/v1/diff`                  | Diff summaries and file diffs                   |
| `/api/v1/conflicts`             | Merge conflict status and resolution            |
| `/api/v1/github`                | GitHub PR creation                              |
| `/api/v1/summary`               | Project summary and memory-formatted summary    |
| `/api/v1/notifications`         | Notification CRUD and Teams-formatted pending   |
| `/api/v1/templates`             | Task template management                        |
| `/api/v1/task-types`            | Custom task type management                     |
| `/api/v1/projects`              | Project list management                         |
| `/api/v1/sprints`               | Sprint list management                          |
| `/api/v1/activity`              | Activity log                                    |
| `/api/v1/status-history`        | Task status history and daily summary           |
| `/api/v1/preview`               | Markdown preview rendering                      |
| `/api/v1/telemetry`             | Telemetry event recording and querying          |
| `/api/v1/metrics`               | Dashboard metrics and task-level metrics        |
| `/api/v1/traces`                | Request traces                                  |
| `/api/v1/digest`                | Daily digest generation                         |

### Authentication Methods

1. `Authorization: Bearer <token>` header (JWT or API key)
2. `X-API-Key: <key>` header
3. `?api_key=<key>` query parameter (for WebSocket connections)

### Real-Time Updates

- **WebSocket server** — Real-time task change broadcasts on `ws://localhost:3001`
- **WebSocket connection indicator** — UI shows connected/disconnected status
- **Agent output streaming** — Live agent output over WebSocket
- **Broadcast service** — Centralized WebSocket message dispatch for task changes

### Response Format

- JSON responses with consistent error format
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

## Infrastructure & DevOps

Production-ready deployment and development tooling.

### Docker

- **Multi-stage build** — 5-stage Dockerfile (deps → build-shared → build-web → build-server → production)
- **Non-root execution** — Production image runs as non-root user
- **Alpine-based** — Minimal `node:22-alpine` base image
- **Layer caching** — Workspace config and lockfile copied first for optimal Docker layer caching
- **Frozen lockfile** — `pnpm install --frozen-lockfile` for reproducible builds

### CI/CD

- **GitHub Actions** — CI pipeline on push to `main` and pull requests
- **Concurrency control** — In-progress runs cancelled when new commits push
- **Pipeline jobs** — Lint & type check, server unit tests, E2E tests (3 parallel jobs)
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
- **Focus management** — Focus trapped in dialogs and sheets; restored on close
- **Screen reader support** — Semantic HTML, ARIA roles, and descriptive labels throughout
- **Color contrast** — Dark mode palette designed for readability
- **Skip navigation** — Keyboard users can navigate efficiently between sections
- **Sortable list accessibility** — Drag-and-drop lists in settings include keyboard-accessible reordering
- **Interactive cards** — Task cards, metric cards, and stat cards support keyboard activation (Enter/Space)
- **Error boundaries** — Crash recovery UI accessible via keyboard

---

_Last updated: 2026-01-29 · [Back to README](../README.md)_

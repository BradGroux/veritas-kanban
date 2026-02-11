# Changelog

All notable changes to Veritas Kanban are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Persist runtime auth/config state to the Docker volume by routing `.veritas-kanban` paths through `getRuntimeDir()` and migrating legacy files on startup (`security.json`, agent registry, lifecycle hooks, error analyses, agent permissions).
- Added Docker migration guidance for recovering auth state after rebuilding containers.

## [3.1.0] - 2026-02-10

### Added

- **6 structural enforcement gates** (all disabled by default):
  - `squadChat`, `reviewGate`, `closingComments`, `autoTelemetry`, `autoTimeTracking`, `orchestratorDelegation`
- **Comprehensive enforcement documentation** with a dedicated "For AI Agents" section
- **Agent SOP enforcement awareness** updates

### Fixed

- Enforcement gate logic (correct `=== true` checks)
- TelemetryService supports backdated timestamps
- TelemetryService respects `DATA_DIR` in Docker environments
- Zod schema allows optional timestamp on telemetry events
- Template YAML serialization (recursive `cleanForYaml`)
- Case-insensitive agent color lookup in squad chat

**Issue:** #115

---

## [3.0.0] - 2026-02-09

### ✨ Highlights

**Veritas Kanban 3.0 ships the workflow engine** — a deterministic multi-step agent orchestration system that transforms VK from an ad-hoc task board into a repeatable, observable, and reliable agent execution platform. Think GitHub Actions for AI agents.

**14,079 lines of code shipped across 6 major phases:**

- Phase 1: Core workflow engine (~7,091 lines)
- Phase 2: Run state management (~1,409 lines)
- Phase 3: Frontend + real-time updates (~3,069 lines)
- Phase 4: Advanced orchestration (~2,255 lines)
- Dashboard: Monitoring & health metrics (~2,050 lines)
- Policies & Sessions: Tool policies + session isolation (~1,200 lines)

### Added

#### Core Workflow Engine (Phase 1 — #107)

- **YAML workflow definitions** — Define multi-step agent pipelines as version-controlled YAML files
- **Workflow CRUD API** — 9 REST endpoints for workflow management:
  - `GET /api/workflows` — List all workflows
  - `GET /api/workflows/:id` — Get workflow definition
  - `POST /api/workflows` — Create workflow
  - `PUT /api/workflows/:id` — Update workflow (auto-increment version)
  - `DELETE /api/workflows/:id` — Delete workflow
  - `POST /api/workflows/:id/runs` — Start a run
  - `GET /api/workflow-runs` — List runs (filterable by workflow, task, status)
  - `GET /api/workflow-runs/:id` — Get run details
  - `POST /api/workflow-runs/:id/resume` — Resume blocked run
- **Sequential step execution** — Execute workflow steps in order with retry routing
- **Step types: agent** — Agent steps spawn OpenClaw sessions with prompts (Phase 1 placeholder)
- **Template rendering** — Basic `{{variable}}` and `{{nested.path}}` substitution in step inputs
- **Acceptance criteria validation** — Simple substring matching for step completion checks
- **Retry routing** — Three strategies: retry same step, retry different step (`retry_step`), escalate to human
- **Workflow snapshot** — YAML saved in run directory for version immutability
- **RBAC** — Role-based access control with ACL files (`.acl.json`)
- **Audit logging** — All workflow changes logged to `.audit.jsonl`
- **Zod validation** — Schema validation for workflow definitions
- **Storage structure** — File-based persistence in `.veritas-kanban/workflows/` and `.veritas-kanban/workflow-runs/`

#### Run State Management (Phase 2 — #113, #110, #111, #108)

- **Persistent run state** — Run state survives server restarts via checkpoint timestamps
- **Progress file tracking** (#108) — Shared `progress.md` per run for context passing between steps
- **Step output resolution** — Template variables like `{{steps.plan.output}}` resolve from previous step outputs
- **Retry delays** — Configurable `retry_delay_ms` to prevent rapid retry loops
- **Tool policies** (#110) — Role-based tool restrictions:
  - 5 default roles: `planner`, `developer`, `reviewer`, `tester`, `deployer`
  - Each role has allowed/denied tool lists
  - Custom role CRUD via `/api/tool-policies` endpoints
  - Tool filter passed to OpenClaw sessions (ready for Phase 3 integration)
- **Fresh session per step** (#111) — Each workflow step can spawn a fresh OpenClaw session:
  - Session modes: `fresh` (new session) or `reuse` (continue existing)
  - Context injection: `minimal`, `full`, or `custom` (specify which steps to include)
  - Cleanup modes: `delete` (terminate after step) or `keep` (leave running for debugging)
  - Configurable timeout per step
- **Session tracking** — Session keys stored in `run.context._sessions` per agent
- **Backward compatible** — Legacy `fresh_session: false` maps to `session: reuse`

#### Frontend + Real-Time Updates (Phase 3 — #107 frontend)

- **WorkflowsPage** — Browse and start workflow runs:
  - Grid view of all workflows with metadata (name, version, agents, steps)
  - "Start Run" button → calls `POST /api/workflows/:id/run`
  - Active run count badges per workflow
  - Search filter
  - Lazy-loaded in App.tsx
- **WorkflowRunView** — Live step-by-step workflow run visualization:
  - Real-time step progress display
  - Each step shows status, agent, duration, retry count, output preview, errors
  - Color-coded step status (green=completed, blue=running, red=failed, yellow=skipped, gray=pending)
  - "Resume" button for blocked runs
  - Overall progress bar (step X of Y)
  - Auto-updates via WebSocket `workflow:status` events
- **WorkflowRunList** — Filter and browse runs:
  - Filter by status (all, running, completed, failed, blocked, pending)
  - Click to open WorkflowRunView
  - Progress bars, duration tracking
- **WorkflowSection** — Run workflows from TaskDetailPanel:
  - Shows available workflows
  - Displays active runs for current task
  - "Start" button with task context
  - Dialog modal
- **Navigation tab** — "Workflows" tab added to header with icon
- **WebSocket integration** — Real-time updates via `workflow:status` events
- **Polling fallback** — Aggressive polling (10-30s) when WebSocket disconnected, safety-net polling (120s) when connected
- **~75% reduction in API calls** when WebSocket connected

#### Advanced Orchestration (Phase 4 — #112, #113)

- **Loop steps** (#112) — Iterate over collections with progress tracking:
  - Configuration: `over`, `item_var`, `index_var`, `completion` policy, `fresh_session_per_iteration`
  - Completion policies: `all_done`, `any_done`, `first_success`
  - Loop state tracking: `totalIterations`, `currentIteration`, `completedIterations`, `failedIterations`
  - Output per iteration saved to `step-outputs/<step-id>-<iteration>.md`
  - Loop variables accessible in templates: `{{loop.index}}`, `{{loop.total}}`, `{{loop.completed}}`
  - Max 1000 iterations safety limit
  - `continue_on_error` flag to skip failed iterations
  - `verify_each` and `verify_step` for post-iteration validation (wired in types, executor pending)
- **Gate steps** — Conditional blocking with approval workflow:
  - Boolean expressions: `{{test.status == "passed" and verify.decision == "approved"}}`
  - Supports `==`, `and`, `or` operators with variable access
  - Blocking behavior: run status changes to `blocked` if condition fails
  - Approval API: `POST /api/workflow-runs/:runId/steps/:stepId/approve` and `/reject`
  - Escalation policies: `escalate_to: human` blocks, timeout support
- **Parallel steps** — Fan-out/fan-in execution:
  - Execute multiple sub-steps concurrently via `Promise.allSettled()`
  - Completion criteria: `all` (all must succeed), `any` (at least one), `N` (at least N sub-steps)
  - `fail_fast` flag aborts remaining sub-steps on first failure
  - Aggregated JSON output with per-sub-step status, outputs, errors
  - Max 50 concurrent sub-steps (soft limit)
- **Enhanced acceptance criteria** — Regex patterns and JSON path equality:
  - Regex: `/^STATUS:\s*done$/i`
  - JSON path: `output.decision == "approved"`
  - Backward compatible substring matching
- **Expression evaluator** — Safe variable access and boolean logic (no arbitrary code execution)

#### Workflow Dashboard (#114)

- **Summary cards** (6 metrics):
  - Total workflows defined
  - Active runs (currently executing)
  - Completed runs (period-filtered: 24h/7d/30d)
  - Failed runs (period-filtered)
  - Average run duration
  - Success rate (%)
- **Active runs table** — Live-updating list of currently executing runs:
  - Workflow ID, status badge, started time, duration, current step, progress (step X/Y)
  - Click to open WorkflowRunView
  - Real-time updates via WebSocket
  - Visual progress bars
- **Recent runs history** — Last 50 workflow runs:
  - Sortable by status (all/completed/failed/blocked/pending)
  - Run ID, status badge, start time, duration, steps completed
  - Click to open WorkflowRunView
- **Workflow health metrics** — Per-workflow stats:
  - Success rate
  - Average duration
  - Run counts (total, completed, failed)
  - Visual health indicators (green/yellow/red based on success rate)
- **Real-time updates** — WebSocket-driven with polling fallback (30s when disconnected, 120s when connected)
- **Backend endpoints**:
  - `GET /api/workflow-runs/active` — Currently running workflows
  - `GET /api/workflow-runs/stats?period=7d` — Aggregated statistics (total workflows, active, completed, failed, avg duration, success rate, per-workflow breakdown)
- **Navigation** — "Dashboard" button in WorkflowsPage header

### Changed

#### WebSocket Refactor (Phase 3)

- **All hooks now WebSocket-primary** — Polling is safety net only
- **Connected behavior** — 120s polling intervals (safety net)
- **Disconnected behavior** — Aggressive polling resumes (10-30s intervals)
- **Events** — `task:changed`, `agent:status`, `telemetry:event`, `workflow:status`
- **Broadcast service** — Centralized `broadcastWorkflowStatus()` function sends full run state (no extra HTTP fetches needed)
- **13 hooks/components refactored** — All polling intervals updated

### Security

- **ReDoS protection** — Regex patterns validated with size/complexity limits
- **Expression injection prevention** — Template evaluator only supports safe variable access and boolean operators
- **Parallel DoS limits** — Max 50 concurrent sub-steps in parallel execution
- **Gate approval validation** — Authentication and permission checks on approval endpoints
- **Path traversal protection** — `sanitizeFilename` on all file writes

### Performance

- **~75% reduction in API calls** — When WebSocket connected, polling drops to 120s safety-net intervals
- **Progress file size cap** — 10MB limit prevents unbounded growth
- **Lazy-loaded frontend** — WorkflowsPage, WorkflowDashboard only render when navigated to
- **Memoized filters** — `useMemo` for filtered workflows/runs
- **Skeleton loading states** — Shimmer placeholders during data fetch

---

## [2.1.4] - 2026-02-09

### Fixed

- **Status Counter Accuracy** (#104) — Sidebar task counts now use a dedicated `GET /api/tasks/counts` endpoint that returns total counts by status, independent of time-range filters applied to the board view
  - **New:** `server/src/routes/tasks.ts` — `/api/tasks/counts` endpoint returns `{ todo, in_progress, review, done, blocked, cancelled }`
  - **New:** `web/src/hooks/useTaskCounts.ts` — dedicated React hook for sidebar counts
  - **Updated:** `BoardSidebar.tsx` — uses `useTaskCounts()` instead of deriving from filtered task list
  - Cache invalidation wired to task mutations so counts stay in sync

- **Bulk Operation Timeouts** (#105) — Bulk archive, status update, and backlog demote operations now use single API calls instead of N individual requests
  - **New:** `POST /api/tasks/bulk-update` — update status for multiple tasks in one call
  - **New:** `POST /api/tasks/bulk-archive-by-ids` — archive multiple tasks by ID array
  - **New:** `POST /api/backlog/bulk-demote` — demote multiple tasks to backlog in one call
  - All bulk endpoints validate array size (max 100) to prevent abuse
  - Operations run in parallel via `Promise.allSettled()` (~26× faster for large batches)
  - **Updated:** `BulkActionsBar.tsx` — rewired to use bulk endpoints instead of sequential loops
  - **Updated:** `useTasks.ts`, `useBacklog.ts` — new mutation hooks for bulk operations

### Changed

- **Squad Chat Documentation** (#106) — Updated `SQUAD_CHAT_IMPLEMENTATION.md` to clarify that the `model` field is a structural JSON field in the API, not a text instruction

## [2.1.3] - 2026-02-07

### Fixed

- **Docker Path Standardization** (#102) — Comprehensive refactor: created shared `paths.ts` utility and migrated all 7 services to use it
  - **New:** `server/src/utils/paths.ts` — single source of truth for all path resolution
  - **Refactored:** task-service, activity-service, chat-service, audit-service, metrics/helpers, backlog-repository (7 files total)
  - **Resolution priority:** `DATA_DIR` / `VERITAS_DATA_DIR` env var → project root auto-discovery → fallback
  - **Safety:** Filesystem root guard prevents silent `/` resolution (the original EACCES bug)
  - **Backwards compatible:** Existing `DATA_DIR` configurations continue to work unchanged
  - **Cross-model reviewed:** 10/10/10/10 (GPT-5.1 authored, Claude Sonnet 4.5 reviewed)

## [2.1.2] - 2026-02-07

### Fixed

- **Docker Path Resolution** (#102) — Fixed WORKDIR resolution so services correctly find `.veritas-kanban` in containerized deployments
  - **Root cause:** Services use `process.cwd()/..` to locate project root; with `WORKDIR /app` this resolved to `/` (filesystem root), causing `EACCES: permission denied` on container startup
  - **Fix:** Changed production WORKDIR to `/app/server`, ensured `/app/tasks` and `/app/server` are writable
  - **Impact:** Resolves permission denied errors when starting VK in Docker containers
  - Related: Issue #102 (Docker: Standardize .veritas-kanban path resolution across services)

## [2.1.1] - 2026-02-07

### Fixed

- **Reverse Proxy Support** (#100) — Added `TRUST_PROXY` environment variable for deployments behind nginx, Caddy, Traefik, Synology DSM, and other reverse proxies. Fixes `express-rate-limit` ValidationError and WebSocket authentication loops caused by untrusted `X-Forwarded-For` headers.
  - Supports hop counts (`TRUST_PROXY=1`), named values (`loopback`, `linklocal`), and subnet strings
  - `TRUST_PROXY=true` is blocked by default (security hardening — logs warning, falls back to no trust)
  - Disabled by default — no behavior change for existing deployments
  - Documentation added for nginx, Caddy, and Docker Compose configurations

### Security

- Blocked `TRUST_PROXY=true` to prevent accidental trust-all-proxies misconfiguration on public-facing deployments

## [2.0.0] - 2026-02-06

### ✨ Highlights

**Veritas Kanban 2.0 is the multi-agent release.** 18 features shipped across agent orchestration, dashboard analytics, lifecycle automation, and developer experience. This release transforms VK from a single-agent task board into a full multi-agent orchestration platform.

### Added

#### Multi-Agent System (#28, #29, #30, #31)

- **Agent Registry** (#52) — Service discovery with heartbeat tracking, capabilities, live status, REST API for register/deregister/heartbeat/stats
- **Multi-Agent Dashboard Sidebar** (#28) — Real-time agent status cards in board sidebar, expandable details, color-coded status indicators (green=working, purple=sub-agent, gray=idle, red=error)
- **Multi-Agent Task Assignment** (#29) — Assign multiple agents to a single task, color-coded agent chips in task detail and board cards, shared helper utilities
- **@Mention Notifications** (#30) — @agent-name parsing in comments, thread subscriptions, delivery tracking, notification bell
- **Agent Permission Levels** (#31) — Intern / Specialist / Lead tiers with configurable approval workflows and autonomy boundaries

#### Dashboard Analytics (#57, #58, #59, #60, #61)

- **Where Time Went** (#57) — Time breakdown by project via telemetry data with color-coded project bars
- **Activity Clock** (#58) — 24-hour donut chart showing agent work distribution, sourced from status-history transitions
- **Hourly Activity Chart** (#59) — Bar chart with per-hour event counts, sourced from status-history
- **Wall Time Toggle** (#60) — Total Agent Time + Avg Run Duration with explanatory tooltips
- **Session Metrics** (#61) — Session count, success rate, completed/failed/abandoned tracking

#### Lifecycle & Automation

- **Task Lifecycle Hooks** (#72) — 7 built-in hooks (subtask-gate, assignee-required, blocked-reason, done-checklist, auto-archive, time-tracking, notification), 8 lifecycle events, custom hooks API
- **Documentation Freshness** (#74) — Steward workflow with freshness headers (`fresh-days`, `owner`, `last-verified`), 3-phase automation plan
- **Error Learning Workflow** (#91) — Structured failure analysis, similarity search for recurring issues, stats API. Inspired by @nateherk's Klouse dashboard concept.

#### Developer Experience

- **Markdown Rendering** (#63) — MarkdownText component for rich text in task descriptions and comments
- **Cost Prediction** (#54) — Multi-factor cost estimation model (tokens, compute, overhead) for task budgeting
- **CLI Usage Reporting** (#50) — `vk usage` command for token and cost reporting from the terminal
- **Dashboard Widget Toggles** (#92) — Show/hide individual dashboard widgets with settings gear and localStorage persistence
- **Production Binding** (#55) — `VK_HOST` and `VK_PORT` environment variables for flexible deployment
- **Custom favicon** — Purple scales-of-justice SVG icon replacing the default Vite favicon

### Changed

- **Timezone-aware metrics** — Server reports its timezone dynamically in all API response `meta`; clients can request metrics in their local timezone via `?tz=<offset>` query parameter
- **Activity data source** — Activity Clock and Hourly Activity Chart now pull from `status-history` (reliable state transitions) instead of `activity.json`
- **Cost-per-task clickability** — Enhanced hover states, border effects, and arrow indicator
- **Archive optimistic updates** — Archive mutations now remove tasks from cache immediately via `onMutate`, with rollback on error
- **Agent naming convention** — Agent names use ALL CAPS for acronyms (VERITAS, TARS, CASE, K-2SO, R2-D2, MAX)

### Fixed

- **Daily Activity 100% bug** — Utilization was calculated using UTC dates but displayed in local timezone, causing incorrect percentages
- **Feb 3 telemetry outlier** — 66-minute run normalized to 19min (p95 level)
- **Feb 2 telemetry outliers** — 3 runs (15-19min range) normalized to 10min
- **Registry stats interface mismatch** — Frontend expected `totalAgents`/`onlineAgents` but server sent `total`/`online`; interface updated to match server

### Security

- **MCP SDK vulnerability patched** — Updated `@modelcontextprotocol/sdk` from 1.25.3 to ^1.26.0 (GHSA-345p-7cg4-v4c7, cross-client data leak)
- **Rate limiting documented** — README now warns that VK does not include built-in rate limiting; reverse proxy recommended for public deployments

### Maintenance

- **21 stale feature branches cleaned** — Down to `main` only
- **README roadmap updated** — Reflects v2.0 shipped features, v1.6.0 and earlier history preserved
- **Version bumped** across all packages (root, server, web, shared, mcp)

### Credits

- [@nateherk](https://github.com/nateherk) — Error learning workflow inspired by Klouse dashboard concept
- [@mvoutov](https://github.com/mvoutov) — Documentation freshness inspired by BoardKit Orchestrator

---

## [1.6.0] - 2026-02-05

### ✨ Highlights

- **Activity Page Redesign** — Streamlined to focus on status history with full-width layout, clickable task navigation, and color-coded status badges
- **Task Templates UI (#39)** — Full management interface for creating, editing, and instantiating task templates with blueprints
- **Analytics API (#43)** — New endpoints for timeline visualization and aggregate metrics (parallelism, throughput, lead time)
- **Status Transition Hooks** — Quality gates and automated actions for task status changes
- **7 GitHub Issues Closed** — #47, #48, #49, #51, #53, #56, #82 verified complete and documented

### Added

#### Activity Page Improvements

**Full-Width Status History:**

- Removed activity feed column — status history now spans full width
- Removed redundant "Status History" header label
- Daily summary panel retained above status history
- Cleaner, more focused interface for monitoring agent activity

**Clickable Task Navigation:**

- Status history entries now clickable to open task detail panel
- Keyboard accessible (Enter/Space to activate)
- Hover state indicates interactivity

**Color-Coded Status Badges:**

- Agent status colors:
  - `working` / `thinking` — Green
  - `sub-agent` — Purple
  - `idle` — Gray
  - `error` — Red
- Task status colors (Kanban columns):
  - `todo` — Slate
  - `in-progress` — Amber
  - `blocked` — Red
  - `done` — Blue
- Task titles colored to match their new status
- Uniform badge width for visual consistency

**Task Status Changes:**

- Now shows both agent status changes AND task status changes
- Task status changes display with kanban column colors
- Unified timeline view of all activity

**Files:**

- `web/src/components/activity/ActivityFeed.tsx` — Redesigned component
- `web/src/hooks/useStatusHistory.ts` — Updated color functions

#### Task Templates UI (#39)

Full management interface for task templates:

**Templates Page (`/templates`):**

- Grid view of all templates with category grouping
- Search and filter by category
- Quick actions: Edit, Preview, Delete, Create Task
- Empty state with helpful onboarding

**Template Editor Dialog:**

- Create and edit templates
- Configure task defaults (type, priority, project, agent)
- Add subtask templates with ordering
- Blueprint support for multi-task workflows
- Validation and error handling

**Template Preview Panel:**

- Read-only preview of template configuration
- Shows all defaults and subtasks
- One-click task creation from template

**Files:**

- `web/src/components/templates/TemplatesPage.tsx`
- `web/src/components/templates/TemplateEditorDialog.tsx`
- `web/src/components/templates/TemplatePreviewPanel.tsx`
- `server/src/routes/templates.ts`
- `server/src/services/template-service.ts`

#### Analytics API (#43)

New endpoints for advanced metrics and visualization:

**Timeline Endpoint:**
`GET /api/analytics/timeline`

- Returns task execution timeline data
- Includes start/end times from time tracking
- Task assignments and status history
- Parallelism snapshots (concurrent tasks over time)
- Query params: `from`, `to`, `agent`, `project`, `sprint`

**Metrics Endpoint:**
`GET /api/analytics/metrics`

- Aggregate metrics for a time period:
  - Parallelism factor (average concurrent tasks)
  - Throughput (tasks completed per period)
  - Lead time (creation to completion)
  - Agent utilization (working time per agent)
  - Efficiency metrics (tracked vs total time)
- Query params: `sprint`, `from`, `to`, `project`

**Files:**

- `server/src/routes/analytics.ts`
- `server/src/services/analytics-service.ts`
- `server/src/schemas/analytics-schemas.ts`
- `docs/API-analytics.md` — Swagger-style documentation

#### Status Transition Hooks

Quality gates and automated actions for task status changes:

**Pre-Transition Gates:**

- Must pass before status change is allowed
- Examples: require description, require time logged, require code review

**Post-Transition Actions:**

- Fire after status change succeeds
- Examples: notify channel, update external system, trigger automation

**Configuration:**

- Stored in `.veritas-kanban/transition-hooks.json`
- Configurable per-transition (e.g., `in-progress` → `done`)
- Enable/disable globally or per-rule

**Files:**

- `server/src/services/transition-hooks-service.ts`
- `server/src/routes/transition-hooks.ts`
- `shared/src/types/transition-hooks.ts`

#### CLI Setup Wizard

Interactive onboarding for new users:

```bash
vk setup
```

- Guided configuration of API URL and auth
- Creates `.veritas-kanban/config.json`
- Tests connection and validates setup
- Shows next steps and helpful commands

**Files:**

- `cli/src/commands/setup.ts`

#### Prompt Registry

10 copy/paste prompt templates in `docs/prompt-registry/`:

1. **task-breakdown.md** — Epic → subtasks decomposition
2. **code-review.md** — Cross-model review prompt
3. **bug-fix.md** — Structured debugging approach
4. **documentation.md** — Doc writing guidelines
5. **security-audit.md** — Security review checklist
6. **research.md** — Research task structure
7. **content-creation.md** — Content production workflow
8. **sprint-planning.md** — Sprint setup prompt
9. **standup-report.md** — Daily standup generation
10. **lessons-learned.md** — Post-task reflection

### Fixed

#### Security

**SEC-001: Path Traversal Vulnerability**

- Added validation to trace and template services
- Prevents `../` path injection in file operations
- All file paths now resolved and validated against allowed directories

#### Performance

**Telemetry Streaming:**

- Large telemetry reads now streamed instead of loaded into memory
- Pagination pushed to service layer
- Optimized lookups for common queries

#### Quality

**React Strict Mode Compliance:**

- Replaced `Math.random()` with `crypto.randomUUID()` for keys
- Fixed type alignment issues
- Resolved React warning about duplicate keys

### Changed

#### Dashboard

- Sidebar task counts now show current state, not time-filtered counts
- Archive/delete/restore operations now correctly find files on disk
- Metrics cache invalidation on status changes

### Closed Issues

| Issue | Title                                         | Implementation                 |
| ----- | --------------------------------------------- | ------------------------------ |
| #82   | Dev reliability (health, dev:clean, watchdog) | Health endpoints + dev scripts |
| #56   | Dashboard filter bar with presets             | DashboardFilterBar component   |
| #53   | Per-model cost tables & calculation           | Cost tracking in telemetry     |
| #51   | Standup summary with model usage              | /api/summary/standup           |
| #49   | Dashboard Model Usage & Cost panel            | Tokens Card + Cost per Task    |
| #48   | Global usage aggregation service & API        | /api/metrics/\* endpoints      |
| #47   | Model Usage schema, types & API               | Full telemetry system          |

---

## [1.5.0] - 2026-02-04

### ✨ Highlights

- **Comprehensive SOP Documentation Suite** — 8 new guides covering agent workflows, sprint planning, multi-agent orchestration, code review, best practices, examples, and power user tips
- **Cross-Model Code Review Enforcement** — Claude ↔ GPT review gate now fully documented with RF-002 91% accuracy validation
- **Bulk Archive Error Handling** — Fixed silent failures in Done column archival with per-task error tracking and user feedback toasts
- **Sidebar Metrics Sync** — Fixed stale task counts in board sidebar by invalidating metrics cache on status changes

### Added

#### Documentation (#US-1600)

Complete SOP Sprint with 8 new markdown files in `docs/`:

- **GETTING-STARTED.md** — 5-minute quickstart from zero → agent-ready, includes:
  - Prerequisites, manual setup wizard, UI/CLI task creation
  - Agent pickup checklist with agent-requests folder flow
  - Sanity checks section (API health, UI health, agent pickup verification)
  - Prompt registry guidance (shared resources pattern from BoardKit)
  - Documentation freshness SOP (AGENTS.md, CLAUDE.md, BEST-PRACTICES.md)
  - Multi-repo/multi-agent notes with consistent naming conventions
  - OpenClaw Browser Relay integration notes for auth-required workflows
  - Credited Neal (@nealmummau) for asking the triggering question

- **SOP-agent-task-workflow.md** — Complete lifecycle (claim → work → complete):
  - Roles table (PM, Worker, Human Lead)
  - Lifecycle overview with 6 stages
  - API/CLI examples for each step (start timer, status change, completion)
  - Prompt template for consistent agent instructions
  - Lessons Learned expectations + notification patterns
  - Escalation paths for blocked tasks, tooling failures, reviewer disputes

- **SOP-sprint-planning.md** — Epic → Sprint → Task → Subtask hierarchy:
  - Hierarchy table with real examples (MessageMeld, US-1600)
  - Sprint planner agent prompt template
  - Bulk API payload for creating entire sprints at once
  - Estimation pattern (subtasks × 0.5d = effort)
  - Assignment workflow (leave unassigned for agent pickup)
  - Example sprint (US-1600 docs sprint + RF-002 bug fix sprint)
  - After-planning checklist (recap docs, GitHub milestones, standup scheduling)

- **SOP-multi-agent-orchestration.md** — PM + Worker roles:
  - PM checklist (plan, assign, track, review, report)
  - Worker handoff template with clear acceptance criteria
  - Status reporting cadence (daily updates, standup summaries)
  - Error escalation paths
  - Opus-as-PM / Codex-as-worker walkthrough example

- **SOP-cross-model-code-review.md** — Non-negotiable opposite-model gate:
  - Enforcement rule: If Claude wrote it, GPT reviews; if GPT wrote it, Claude reviews
  - When to trigger reviews (application code required, docs optional, research optional)
  - Review workflow (create task, opposite model audits, findings as subtasks, fixes tracked)
  - Reviewer checklist (Security, Reliability, Performance, Accessibility, Docs)
  - Prompt template for consistent audits
  - Escalation paths for disagreements
  - RF-002 reference (91% accuracy validates the approach)

- **BEST-PRACTICES.md** — Patterns that work + anti-patterns to avoid:
  - 10 "Do This" rules (time tracking, subtasks, acceptance criteria, atomic scope, SOP updates, etc.)
  - 10 "Don't Do This" anti-patterns (no acceptance, skipping timers, grab-bag tasks, etc.)
  - Based on real-world usage with agents

- **EXAMPLES-agent-workflows.md** — 6 copy/pasteable recipes:
  - Feature development (BrainMeld Lessons Learned)
  - Bug fix (GH-86 bulk archive)
  - Documentation update (sanity checks in Getting Started)
  - Security audit (RF-002 style)
  - Content production (podcast clip → LinkedIn post)
  - Research & report (Champions dossiers)
  - Each includes goal, task creation, prompt, workflow steps, and deliverables

- **TIPS-AND-TRICKS.md** — Power user features:
  - CLI shortcuts (vk begin/done/block/unblock/time/summary)
  - Keyboard shortcuts (Cmd+K palette, arrow nav, Esc)
  - Command palette power moves
  - WebSocket awareness and polling fallback
  - MCP server setup for Claude Desktop
  - Git worktree integration patterns
  - Obsidian/Brain mirroring with brain-write.sh
  - Dev helpers (dev:clean, dev:watchdog)

- **README.md** — Added "Documentation Map" section listing all new guides with descriptions

#### Fixes

##### GH-86: Bulk Archive Silent Failure (#86)

**Root Cause:** `BulkActionsBar.handleArchiveSelected()` used `Promise.all()` with no error handling. When any single archive failed, the entire batch would silently reject with zero user feedback.

**Fix:**

- Import `useToast` hook
- Replace `Promise.all()` with per-task error tracking loop
- Show success toast (e.g., "Archived 5 tasks")
- Show error toast on partial/full failure with counts
- Log individual failures to console for debugging
- Clear selection regardless of outcome
- **File:** `web/src/components/board/BulkActionsBar.tsx` (+38 lines)

##### GH-87: Sidebar Task Counts Out of Sync (#87)

**Root Cause:** The sidebar uses `useMetrics('24h')` which polls every 30 seconds with 10-second staleTime. Meanwhile, `useUpdateTask` mutations did NOT invalidate the metrics cache, causing up to 30 seconds of stale data after status changes.

**Fix:**

- Add metrics query invalidation to `useUpdateTask.onSuccess()`
- Only invalidate when task status changes (prevents over-invalidation)
- Preserves timer state handling (no aggressive blanket invalidation)
- **File:** `web/src/hooks/useTasks.ts` (+9 lines)

### Scripts

- **scripts/dev-clean.sh** — Added explicit `pnpm` path resolution for launchd sessions (fixes "command not found" in automated restarts)
- **scripts/dev-watchdog.sh** — Improved restart storm prevention with lock file + PID checking; fixed pnpm path resolution

### CLI

- **`vk setup`** — New guided onboarding wizard that validates environment and helps new users get started:
  - Checks Node version (requires ≥18)
  - Verifies server is running and reachable
  - Tests API authentication
  - Optionally creates a welcome task with next steps
  - Supports `--json` output for automation and `--skip-task` to skip sample task
  - Credit: BoardKit Orchestrator (Monika Voutov) for the wizard pattern inspiration

### Fixed

- **Archive/Delete/Restore** — Fixed "Archive failed" errors caused by filename mismatch when task titles changed after creation. Now uses `findTaskFile()` to locate actual file on disk by task ID prefix instead of computing filename from current title
- **Sidebar Task Counts** — Fixed metrics showing time-filtered counts (e.g., 33 todo) instead of current board state (e.g., 124 todo). `/api/metrics/all` now returns current task status counts regardless of period filter; period only applies to telemetry metrics (runs, tokens, duration)
- **Backlog Count API** — Fixed double-wrapped response (`{data: {success, data: {count}}}`) by letting `responseEnvelopeMiddleware` handle wrapping

### Security

- **SEC-001 Extended** — Added path traversal validation to `trace-service.ts` (attemptId, taskId, traceId) and `template-service.ts` (templateId) using `validatePathSegment()` + `ensureWithinBase()`

### Changed

- Version bumped from 1.4.1 → 1.5.0

---

## [1.4.1] - 2026-02-02

### Security

- **SEC-001 Path Traversal Prevention** — added strict path segment validation + base directory enforcement in server utilities; applied to file-based services that join paths from user-controlled ids
- **SEC-007 Admin Authorization** — enforced admin (or admin+agent where appropriate) on mutating settings/config/activity/status-history/notifications endpoints

### Fixed

- **Agent Status Panel** now uses real-time WebSocket updates (`useRealtimeAgentStatus`) and correctly handles `activeAgents` payloads
- Improved proxy/IP trust behavior for rate limiting (`X-Forwarded-For` only trusted when `trust proxy` is configured)

## [1.4.0] - 2026-02-01

### ✨ Highlights

- **CLI Workflow Commands** — Two-command task lifecycle (`vk begin` / `vk done`) plus time tracking, comments, agent status, and project management from the terminal
- Inspired by Boris Cherny's (Claude Code creator) "automate everything you do twice" philosophy

### Added

#### CLI Workflow Commands (#44)

- **Composite workflows** — Complete task lifecycle in single commands:
  - `vk begin <id>` — Sets in-progress + starts timer + updates agent status to working
  - `vk done <id> "summary"` — Stops timer + sets done + adds comment + sets agent idle
  - `vk block <id> "reason"` — Sets blocked + adds comment with reason
  - `vk unblock <id>` — Sets in-progress + restarts timer
- **Time tracking CLI** — Full time management from terminal:
  - `vk time start <id>` — Start time tracker
  - `vk time stop <id>` — Stop time tracker
  - `vk time entry <id> <seconds> "description"` — Add manual time entry
  - `vk time show <id>` — Display time tracking summary (total, running status, entries)
- **Comments CLI** — `vk comment <id> "text"` with optional `--author` flag
- **Agent status CLI** — Manage agent presence:
  - `vk agent status` — Show current agent status
  - `vk agent working <id>` — Set to working (auto-fetches task title)
  - `vk agent idle` — Set to idle
  - `vk agent sub-agent <count>` — Set sub-agent mode with count
- **Project management CLI** — `vk project list` and `vk project create "name"` with `--color` and `--description` flags
- All commands support `--json` for scripting and automation
- 5 new command modules, 18 subcommands, 651 lines added

---

---

## [1.3.0] - 2026-02-01

### ✨ Highlights

- **GitHub Issues Bidirectional Sync** — Import issues with the `kanban` label and push status changes back to GitHub
- **Activity Feed** — Full-page chronological activity feed with filtering, real-time updates, and compact/detailed toggle
- **Daily Standup Summary** — Generate standup reports via API or CLI with completed, in-progress, blocked, and upcoming sections

### Added

#### GitHub Issues Sync (#21)

- `GitHubSyncService` (464 lines) with polling, label-based field mapping, and circuit breaker
- Inbound: import issues with `kanban` label as tasks
- Outbound: push status changes (done → close issue, reopen on todo/in-progress/blocked) and comments
- Label mapping: `priority:high` → priority field, `type:story` → type field
- Config: `.veritas-kanban/integrations.json`, state: `.veritas-kanban/github-sync.json`
- `TaskGitHub` interface in shared types: `{issueNumber, repo, syncedAt?}`
- New API endpoints:
  - `POST /api/github/sync` — trigger manual sync
  - `GET /api/github/sync/status` — last sync info
  - `GET /api/github/sync/config` — get config
  - `PUT /api/github/sync/config` — update config
  - `GET /api/github/sync/mappings` — list issue↔task mappings
- New CLI commands: `vk github sync`, `vk github status`, `vk github config`, `vk github mappings`

#### Activity Feed (#33)

- Full-page chronological activity feed accessible from header nav (ListOrdered icon)
- `agent` field added to Activity interface
- `ActivityFilters` for combinable filtering (agent, type, taskId, since, until)
- `GET /api/activity` enhanced with query params: `?agent=X&type=Y&taskId=Z&since=ISO&until=ISO`
- `GET /api/activity/filters` — distinct agents and types for filter dropdowns
- `ActivityFeed.tsx` component with day grouping, 15 activity type icons, filter bar, compact/detailed toggle
- Infinite scroll via IntersectionObserver
- Real-time WebSocket updates
- `ViewContext` for board ↔ activity navigation

#### Daily Standup Summary (#34)

- `GET /api/summary/standup?date=YYYY-MM-DD&format=json|markdown|text`
- Sections: completed, in-progress, blocked, upcoming, stats
- `generateStandupMarkdown()` and `generateStandupText()` in SummaryService
- CLI: `vk summary standup` with `--yesterday`, `--date YYYY-MM-DD`, `--json`, `--text` flags
- 12 new tests

### Changed

- MAX_ACTIVITIES increased from 1,000 to 5,000

---

## [1.2.0] - 2026-02-01

### ✨ Highlights

- **Standardized API Response Envelope** — All endpoints return a consistent `{success, data, meta}` format with typed error classes
- **Abstract File Storage** — Repository pattern decouples services from the filesystem
- **Blocked Task Status** — Full support for blocked tasks across MCP, CLI, and board

### Added

#### Standardize API Response Envelope (#2)

- 4 new error classes: `UnauthorizedError`, `ForbiddenError`, `BadRequestError`, `InternalError` (in `middleware/error-handler.ts`)
- `sendPaginated(res, items, {page, limit, total})` helper for pagination metadata in envelope
- Response envelope format:
  - Success: `{success: true, data, meta: {timestamp, requestId}}`
  - Error: `{success: false, error: {code, message, details?}, meta}`
  - Pagination: `meta` includes `{page, limit, total, totalPages}` on paginated endpoints

#### Abstract File Storage (#6)

- 5 new repository interfaces: `ActivityRepository`, `TemplateRepository`, `StatusHistoryRepository`, `ManagedListRepository`, `TelemetryRepository`
- `StorageProvider` extended with new repositories
- `fs-helpers.ts` — centralized filesystem access (only file that imports `fs`)

#### Blocked Task Status (#32)

- MCP tools Zod/JSON schema definitions updated for blocked status
- MCP active tasks filter updated to include blocked
- CLI help text updated
- CLI status color: blocked = red

### Changed

- All 11 route files standardized — zero ad-hoc `{error: "..."}` patterns
- Auth middleware errors standardized to use typed error classes
- All 10 services migrated off direct `fs` imports to use `fs-helpers.ts`

---

## [1.1.0] - 2026-01-31

### ✨ Highlights

- **Built-in Chat Interface** — Talk to AI agents directly from the board or any task, with streaming responses and markdown rendering
- **Agent Routing Engine** — Tasks auto-route to the best available agent based on type, project, and capabilities
- **Agent Selection on Task Creation** — Choose which agent handles a task when you create it
- **Hardened Infrastructure** — Rate limiting, circuit breakers, file locking, request timeouts, data integrity checks, and more

### Added

#### Chat Interface (#18)

- Full chat panel accessible from any task or the board header
- Streaming AI responses with real-time WebSocket delivery
- Floating chat bubble with pulse indicator for new messages
- Chat sessions stored as markdown files with YAML frontmatter
- Gateway integration for AI responses via Clawdbot
- Chat export as markdown (download icon in header)
- Clear chat history with confirmation dialog
- Mode toggle: Ask (read-only queries) vs Build (changes, files, commands)
- Keyboard shortcut support
- Auto-focus input after sending messages
- Tool call display with expandable input/output sections

#### Agent Routing Engine (#16)

- Task-aware routing that matches tasks to agents by type, project, and capabilities
- Routing rules configurable per agent in Settings → Agents
- API endpoints for routing queries and rule management
- Full test coverage (17 tests)

#### Agent Selection on Task Creation (#17)

- Agent dropdown in the Create Task dialog
- Auto-routes to best agent based on task type, or allows manual override
- Agent field displayed in task metadata section

#### Agent CRUD Management

- Full Add/Edit/Remove for agents in Settings → Agents
- Add Agent form with name, type slug (auto-generated), command, and args
- Edit/Remove via inline icons (default agent protected from deletion)
- `AgentType` loosened from fixed enum to any string slug — fully custom agents

#### Board Filter: Agent

- Filter board by assigned agent in the FilterBar
- Agent indicator dots on task cards match filter state

#### Infrastructure & Security

- **Rate Limiting** — Per-route tiered thresholds (auth, API reads, writes, uploads)
- **Circuit Breaker** — Automatic failure detection for external service calls with configurable thresholds
- **File Locking** — FIFO queue prevents race conditions on concurrent file writes
- **Request Timeouts** — Middleware kills hung connections before they pile up
- **Data Integrity** — Hash-chain verification + automatic backup on startup with rotation
- **Audit Log** — Immutable hash-chain audit trail for sensitive operations
- **Health Endpoint** — Liveness, readiness, and deep checks (storage, disk, task file)
- **API Envelope** — Standardized `{ success, data, meta }` response format across all endpoints
- **Schema Validation** — Zod schemas on all mutating API routes
- **Metrics** — Prometheus-compatible `/metrics` endpoint for monitoring
- **WebSocket Heartbeat** — Connection keep-alive with automatic reconnection and connection limits
- **Error Boundaries** — React error boundaries with graceful fallback UI
- **Dependency Audit** — Automated vulnerability scanning in CI

#### Storage & Architecture

- Abstract file storage behind repository interface (prep for future database backends)
- Structured logging with pino (replaced all `console.*` calls)

#### First-Run Experience

- Example tasks auto-populate the board on first run (4 sample tasks)
- Manual seed script: `pnpm seed`
- Task data `.gitignore`d — your data stays private

#### Dark/Light Mode

- Settings → General → Appearance toggle (moon/sun icon)
- Persists to localStorage; default is dark mode
- Inline script prevents flash of wrong theme on load

#### UI Theme

- Primary color: purple (`270° 50% 40%`) with white text
- Focus rings, switches, and accents updated to match

#### Documentation

- TROUBLESHOOTING.md with common issues and solutions
- Comprehensive FEATURES.md reference
- Agentic AI Safety best practices guide
- Roadmap section linking to v1.1 milestone
- Competitive comparison table
- OpenClaw (formerly Moltbot/Clawdbot) attribution updated

#### Per-Status Selection (#24)

- Select All checkbox per column header
- Toolbar buttons for bulk operations scoped to selected status
- Column checkboxes for quick multi-select

### Fixed

- **Chat delete not clearing UI** — React Query kept stale cached data after session file was deleted; now uses `removeQueries` to nuke cache
- **Chat send broken after delete** — Server now recreates task-scoped sessions instead of throwing 404
- **Cross-column drag-and-drop** — Tasks reliably move between columns with local state management during drag
- **Dashboard agent comparison** — Fixed broken data fetch (raw `fetch` → `apiFetch` for envelope unwrapping)
- **Dashboard drill-down** — Removed duplicate X button, fixed focus ring clipping, wired up `open-task` event
- **Localhost auth rate limit** (#25) — Exempted localhost from rate limiting
- **Numeric inputs** — Clean inputs without browser spinners (#19)
- **Timer start/stop** — Optimistic UI toggle + cache patch for instant feedback
- **Task cache fragmentation** — All routes now use TaskService singleton
- **Sprint/Agent label alignment** — Fixed form layout in task detail panel
- **Sticky header** — Fixed positioning + matched indicator dot sizes
- **Keyboard test infinite loop** — Resolved render loop in `useKeyboard` + memoized context
- **Agent idle timeout** — Increased from 5 to 15 minutes to reduce false resets
- **File lock ordering** — Added in-process FIFO queue for deterministic write ordering
- **Search filters** — Added task ID to board and archive search

### Changed

- Agent status popover: moved idle description to bottom, added activity history link
- WebSocket indicator: click popover with connection status explanation
- Dashboard layout: Daily Activity (75%) + Recent Status Changes (25%) side-by-side
- Rolling average line: cyan-teal to contrast purple theme
- Bar chart hover: subtle muted fill instead of white flash
- All repo links updated to BradGroux (primary repo)
- All contact emails standardized to contact@digitalmeld.io
- Test suite: 72 files, **1,270 tests** (up from 61 files / 1,143 tests)

---

## [1.0.0] - 2026-01-29

### 🎉 Initial Public Release

Veritas Kanban is an AI-native project management board built for developers and autonomous coding agents.

### Features

#### Core Board

- Kanban board with drag-and-drop between columns (Backlog, To Do, In Progress, Review, Done)
- Task detail panel with full editing (title, description, priority, status, type, project, sprint)
- Subtasks with progress tracking on cards
- Task type system with icons and color-coded borders
- Sprint management with auto-archive
- Bulk operations and keyboard shortcuts

#### Code Workflow

- Git worktree integration for code tasks
- Diff viewer for code review
- Line-level review comments
- Approval workflow with review decisions
- Merge and close integration

#### AI Agent Integration

- Agent orchestration system for autonomous task execution
- Agent status tracking (idle, working, sub-agent mode)
- Time tracking per task with automatic and manual entries
- REST API designed for AI agent consumption
- MCP (Model Context Protocol) server for LLM tool integration
- CLI for headless task management

#### Dashboard & Analytics

- Sprint velocity tracking
- Cost budget tracking with daily digest
- Task-level metrics and telemetry
- Status history timeline

#### Security

- JWT authentication with secret rotation
- Admin key + API key authentication
- CSP headers with Helmet
- Rate limiting with express-rate-limit
- CORS origin validation
- WebSocket origin validation
- Server-side MIME type validation for uploads
- Markdown sanitization (XSS prevention)
- Timing-safe credential comparison
- Credential redaction from task data

#### Performance

- In-memory task caching with file watchers
- Config caching with write invalidation
- Gzip response compression
- Lazy-loaded dashboard with vendor chunk splitting (69% bundle reduction)
- Pagination and summary mode for large datasets
- Reduced polling when WebSocket connected
- Telemetry retention and automatic cleanup

#### Infrastructure

- Production Dockerfile with multi-stage build (runs as non-root)
- GitHub Actions CI pipeline
- Pre-commit hooks with husky + lint-staged
- Structured logging with pino
- Request ID middleware for tracing
- Graceful shutdown with service disposal
- Unhandled rejection and exception handlers

#### Documentation

- OpenAPI/Swagger API documentation
- Deployment guide (Docker, bare metal, nginx, Caddy, systemd)
- Security audit reports
- Contributing guide with conventional commits
- Code of Conduct (Contributor Covenant v2.1)

#### Testing

- 61 test files, 1,143 unit tests (server + frontend) with Vitest
- End-to-end tests with Playwright (19/19 passing)
- Gitleaks pre-commit hook for secret scanning

### Technical Details

- **Frontend:** React 19, Vite 6, TypeScript 5.7, Tailwind CSS 3.4, Shadcn UI
- **Backend:** Express 4.21, TypeScript, file-based storage
- **Testing:** Playwright 1.58, Vitest 4
- **Runtime:** Node.js 22+, pnpm 9+

---

_Built by [Digital Meld](https://digitalmeld.io) — AI-driven enterprise automation._

[unreleased]: https://github.com/BradGroux/veritas-kanban/compare/v1.4.1...HEAD
[1.4.1]: https://github.com/BradGroux/veritas-kanban/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/BradGroux/veritas-kanban/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/BradGroux/veritas-kanban/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/BradGroux/veritas-kanban/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/BradGroux/veritas-kanban/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/BradGroux/veritas-kanban/releases/tag/v1.0.0

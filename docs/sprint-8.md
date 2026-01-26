# Sprint 8: Dashboard & Observability

**Goal:** Add a metrics dashboard with task counts, error rates, token usage, and agent performance metrics. Keep telemetry lightweight and practical.

**Started:** 2026-01-26
**Status:** Planning

---

## Definitions

### What Counts as Success, Failure, and Error

| Term | Definition |
|------|------------|
| **Success** | Agent run completes with exit code 0 AND task moves to Review or Done |
| **Failure** | Agent run completes with non-zero exit code OR is stopped by user |
| **Error** | Unexpected exception during run (process spawn failure, crash, timeout) |
| **Retry** | A new attempt on a task that already has previous attempts |

**Note:** A "failure" is an expected bad outcome (agent couldn't complete the task). An "error" is an unexpected system-level problem. Both count against success rate, but errors indicate infrastructure issues.

### Total Completed Tasks

```
Total Completed = Done + Archived
```

Both Done and Archived represent finished work. The distinction is organizational (archive = out of active view), not semantic.

### Retry Handling

| Metric | Treatment |
|--------|-----------|
| **Error rate** | Each attempt counts independently. 3 attempts = 3 data points for success/failure |
| **Token totals** | Sum ALL attempts (retries consume real tokens) |
| **Run duration** | Each attempt tracked separately; stats computed per-attempt, not per-task |

---

## Minimal Telemetry Plan

### Events to Emit

| Event | When | Purpose |
|-------|------|---------|
| `task.created` | Task created | Count totals |
| `task.status_changed` | Status field changes | Track lifecycle, time-in-state |
| `task.archived` | Task moves to archive | Track completed work |
| `run.started` | Agent process spawns | Track runs |
| `run.completed` | Agent exits (any code) | Duration, success/failure |
| `run.error` | Exception during run | Error tracking |
| `run.tokens` | Token usage recorded | Cost tracking |

### Event Schema

All events share a base structure:

```typescript
interface TelemetryEvent {
  id: string;           // Unique event ID
  type: string;         // Event type (e.g., "run.completed")
  timestamp: string;    // ISO timestamp
  taskId?: string;      // Associated task
  project?: string;     // Project for aggregation
}
```

**Task events:**
```typescript
interface TaskEvent extends TelemetryEvent {
  taskId: string;
  project?: string;
  status?: TaskStatus;
  previousStatus?: TaskStatus;
}
```

**Run events:**
```typescript
interface RunEvent extends TelemetryEvent {
  taskId: string;
  attemptId: string;
  agent: AgentType;
  durationMs?: number;
  exitCode?: number;
  success?: boolean;
  error?: string;
}
```

**Token events:**
```typescript
interface TokenEvent extends TelemetryEvent {
  taskId: string;
  attemptId: string;
  agent: AgentType;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model?: string;       // If available
}
```

### Storage

Events stored as newline-delimited JSON (NDJSON) in `.veritas-kanban/telemetry/`:

```
.veritas-kanban/
  telemetry/
    events-2026-01-26.ndjson
    events-2026-01-27.ndjson
    ...
```

**Why NDJSON:**
- Append-only (no read-modify-write)
- Easy to query with standard tools (`grep`, `jq`)
- Can tail for real-time dashboard
- Rotates naturally by date
- Simple to archive/delete old data

### Retention

- Default: 30 days
- Config option to adjust
- Old files auto-deleted on startup

---

## Why Traces (and Why Keep Them Coarse)

### The Case for Coarse Traces

Traces connect related events into a coherent story. For agent runs, a trace answers: "What happened during this attempt?"

**Without traces:** You have isolated events. You know a run started and ended, but correlating them requires taskId+attemptId joins.

**With traces:** Events are grouped under a trace ID. Querying a single run is trivial.

### Recommended: Optional, Coarse Traces

Keep traces simple—just enough to group events, not to instrument every function call.

**Trace structure:**
```typescript
interface Trace {
  traceId: string;      // Unique trace ID (same as attemptId for runs)
  taskId: string;
  agent: AgentType;
  steps: TraceStep[];
}

type TraceStepType = 
  | 'init'          // Worktree setup, prompt building
  | 'execute'       // Agent running
  | 'complete'      // Agent finished, post-processing
  | 'error';        // Error occurred

interface TraceStep {
  type: TraceStepType;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}
```

**Why these 4 step types:**
- `init` — Catches slow worktree creation, prompt issues
- `execute` — The actual agent work (most of the duration)
- `complete` — Post-run processing (status updates, notifications)
- `error` — Captures where things went wrong

**Why NOT finer granularity:**
- More steps = more overhead
- Most problems are "agent was slow" or "agent crashed"
- Debug complex issues in agent logs, not traces

### Make Traces Optional

```typescript
// config.json
{
  "telemetry": {
    "enabled": true,
    "traces": false,      // Default: off
    "retention": 30       // Days
  }
}
```

Traces add complexity. For most users, run-level events (started, completed, tokens) are enough. Power users can opt into traces for debugging.

---

## Sprint Tasks

### US-801: Telemetry Service

**Goal:** Create a lightweight event logging service.

**Why it matters:** Foundation for all metrics. Without events, no dashboard.

**Scope:**
- IN: Event emission, NDJSON storage, retention cleanup, basic query API
- OUT: Real-time streaming (can add later), complex aggregations

**Acceptance Criteria:**
- [ ] TelemetryService class with `emit(event)` method
- [ ] Events written to date-partitioned NDJSON files
- [ ] Query method: `getEvents(type?, since?, until?, taskId?)`
- [ ] Retention cleanup runs on service init
- [ ] Config options: `enabled`, `retention` (days)

**Implementation Notes:**
- Single service, singleton pattern (like ConfigService)
- Async file append (don't block on writes)
- Index by date in filename for fast range queries
- No database needed—grep/filter is fast enough for 30 days

**Metrics Required:** None (this IS the metrics infrastructure)

---

### US-802: Emit Task Events

**Goal:** Emit telemetry events for task lifecycle changes.

**Why it matters:** Enables task counts, time-in-state metrics, completion tracking.

**Scope:**
- IN: `task.created`, `task.status_changed`, `task.archived`, `task.restored`
- OUT: Subtask events, time tracking events (keep it simple)

**Acceptance Criteria:**
- [ ] TaskService emits `task.created` on createTask
- [ ] TaskService emits `task.status_changed` on updateTask (when status changes)
- [ ] TaskService emits `task.archived` on archiveTask
- [ ] TaskService emits `task.restored` on restoreTask
- [ ] Events include taskId, project, status, previousStatus

**Implementation Notes:**
- Inject TelemetryService into TaskService
- Emit after successful DB write, not before
- Keep existing activity log—telemetry is separate

**Metrics Required:** Task lifecycle events

---

### US-803: Emit Run Events

**Goal:** Emit telemetry events for agent runs.

**Why it matters:** Enables error rate, duration metrics, agent comparison.

**Scope:**
- IN: `run.started`, `run.completed`, `run.error`
- OUT: Real-time progress events, stdin/stdout events

**Acceptance Criteria:**
- [ ] AgentService emits `run.started` when process spawns
- [ ] AgentService emits `run.completed` when process exits (with duration, exitCode, success)
- [ ] AgentService emits `run.error` on spawn failure or unexpected crash
- [ ] Events include taskId, attemptId, agent type, durationMs

**Implementation Notes:**
- Calculate duration from started timestamp to exit timestamp
- success = exitCode === 0
- Store attemptId in event for correlation

**Metrics Required:** Run events for success/failure/duration

---

### US-804: Token Usage Tracking

**Goal:** Capture token usage per agent run.

**Why it matters:** Cost visibility, efficiency metrics, budget tracking.

**Scope:**
- IN: `run.tokens` event, parse from agent output or accept via API
- OUT: Real-time token streaming, cost calculation (prices change)

**Acceptance Criteria:**
- [ ] API endpoint: POST /api/agents/:taskId/tokens `{ inputTokens, outputTokens, totalTokens, model? }`
- [ ] AgentService emits `run.tokens` event
- [ ] Endpoint can be called by agent completion hooks
- [ ] Dashboard can query total tokens per time window

**Implementation Notes:**
- Token tracking is opt-in (agents must report)
- Claude Code and other agents often print token usage at end
- Could parse from log, but API is cleaner
- Sub-agents can call the endpoint when they finish

**Token Reporting Strategy:**

For **Claude Code**, tokens are printed at session end:
```
Cost: $0.42 (12,345 input, 2,345 output)
```

Options:
1. **Parse from log** — Regex on agent output (brittle)
2. **Agent reports via API** — Agent calls endpoint (cleanest)
3. **Manual entry** — User enters after run (fallback)

Recommend: Start with API endpoint. Teach Veritas (the sub-agent) to call it.

**Metrics Required:** Token event with input/output/total

---

### US-805: Metrics API

**Goal:** Server-side aggregation endpoints for dashboard.

**Why it matters:** Frontend shouldn't process raw events. Pre-aggregated metrics are faster and cleaner.

**Scope:**
- IN: Task counts, error rate, token totals, duration stats
- OUT: Trend charts, historical comparisons (v1 is current state)

**Acceptance Criteria:**
- [ ] GET /api/metrics/tasks — Task counts by status, total, completed
- [ ] GET /api/metrics/runs?period=24h|7d — Error rate, success rate, run count
- [ ] GET /api/metrics/tokens?period=24h|7d — Total tokens, per-run average
- [ ] GET /api/metrics/duration?period=24h|7d — Avg, p50, p95 duration
- [ ] All endpoints support optional `project` filter

**Implementation Notes:**
```typescript
// Example response structure
interface TaskMetrics {
  byStatus: Record<TaskStatus, number>;
  total: number;
  completed: number;  // done + archived
  archived: number;
}

interface RunMetrics {
  period: '24h' | '7d';
  runs: number;
  successes: number;
  failures: number;
  errors: number;
  errorRate: number;   // (failures + errors) / runs
  successRate: number; // successes / runs
}

interface TokenMetrics {
  period: '24h' | '7d';
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  perSuccessfulRun: {
    avg: number;
    p50: number;
    p95: number;
  };
}

interface DurationMetrics {
  period: '24h' | '7d';
  runs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
}
```

**Metrics Required:** Aggregated views of all telemetry

---

### US-806: Dashboard Component

**Goal:** Visual dashboard with metrics cards and layout.

**Why it matters:** The user-facing payoff—see health at a glance.

**Scope:**
- IN: Task counts row, agent ops row, clean styling
- OUT: Charts (v1 is numbers only), drill-down views

**Acceptance Criteria:**
- [ ] Dashboard accessible from main UI
- [ ] Top row: Total tasks, To Do, In Progress, Review, Done, Archived, Total Completed
- [ ] Second row: Error rate (24h/7d), Total tokens (24h/7d), Tokens per run (p50/p95), Duration (avg/p95)
- [ ] Project filter dropdown
- [ ] Auto-refresh (configurable interval, default 30s)
- [ ] Responsive layout (stacks on mobile)

**Design Notes:**
- Cards with large numbers, small labels
- Status colors: To Do (gray), In Progress (blue), Review (yellow), Done (green), Archived (muted)
- Error rate red when > 20%, yellow when > 10%
- Tokens in K format (12.3K, 1.2M)
- Duration in human format (2m 34s)

**Metrics Required:** All of the above

---

### US-807: Dashboard Placement

**Goal:** Decide and implement where dashboard lives in the UI.

**Why it matters:** UX decision impacts discoverability and workflow.

**Scope:**
- IN: Pick placement, implement navigation
- OUT: Multiple dashboard pages (one is enough for v1)

**Options Analysis:**

| Option | Pros | Cons |
|--------|------|------|
| **Tab above board** | Always visible, easy to switch | Takes vertical space, may feel cluttered |
| **Collapsible section below board** | Doesn't compete with board, show on demand | Easy to forget it exists, scroll required |
| **Slide-out panel** | Consistent with Activity/Archive | Metrics aren't a "detail view" |
| **Header dropdown** | Minimal UI impact, on-demand | Hidden, requires click to see |
| **Separate page (/dashboard)** | Full screen for metrics, clear separation | Context switch, lose board view |

**My Recommendation: Collapsible section below board**

Rationale:
- Dashboard is a "glance" view, not a "work" view
- Kanban board is primary UI—don't compete
- Collapsed by default, expand when you want to check metrics
- Persists state (collapsed/expanded) in localStorage
- Could add keyboard shortcut (e.g., `D` for dashboard toggle)

Alternative if you want it more prominent: **Tab above board** with Kanban as default tab.

**Acceptance Criteria:**
- [ ] Dashboard section below Kanban board
- [ ] Collapsed by default with "📊 Dashboard" header bar
- [ ] Click header or chevron to expand/collapse
- [ ] State persisted in localStorage
- [ ] Keyboard shortcut `D` to toggle

**Implementation Notes:**
- Use Collapsible from shadcn/ui (or simple state + animation)
- `useLocalStorage` hook for persistence
- Add to KanbanBoard.tsx below the DndContext

---

### US-808: Optional Traces (Stretch Goal)

**Goal:** Add optional coarse traces for debugging runs.

**Why it matters:** Helps diagnose slow or failed runs without full log parsing.

**Scope:**
- IN: Trace creation, 4 step types (init/execute/complete/error), API endpoint
- OUT: Trace visualization (v1 is data only), detailed sub-steps

**Acceptance Criteria:**
- [ ] Config option `telemetry.traces` (default: false)
- [ ] When enabled, AgentService creates trace on run start
- [ ] TraceService records steps (init, execute, complete, error)
- [ ] GET /api/traces/:attemptId returns trace with steps
- [ ] Trace data stored alongside run events

**Implementation Notes:**
- Trace ID = Attempt ID (natural correlation)
- Init: from startAgent call to process.spawn
- Execute: from spawn to exit event
- Complete: from exit to status update finished
- Error: capture step + error message

**Why optional:** Most users won't need traces. Events are enough for metrics. Traces are for debugging specific problematic runs.

---

## Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 📊 Dashboard                                          [Project: All ▼] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────────┐ │
│  │   12    │ │    3    │ │    2    │ │    1    │ │    4    │ │    8   │ │
│  │  Total  │ │  To Do  │ │ In Prog │ │ Review  │ │  Done   │ │Archived│ │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └────────┘ │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  ✅ 12 Completed                                                    ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                         │
│  ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐     │
│  │ Error Rate        │ │ Tokens            │ │ Duration          │     │
│  │                   │ │                   │ │                   │     │
│  │  8.3%    12.1%   │ │  45.2K   312.4K  │ │  2m 14s   4m 32s │     │
│  │  24h      7d     │ │  24h       7d    │ │   avg      p95   │     │
│  │                   │ │                   │ │                   │     │
│  │ Tokens/Success    │ │ Runs: 24 (24h)   │ │ p50: 1m 48s      │     │
│  │  p50: 3.2K        │ │ Success: 22      │ │                   │     │
│  │  p95: 8.7K        │ │ Failed: 2        │ │                   │     │
│  └───────────────────┘ └───────────────────┘ └───────────────────┘     │
│                                                                         │
│                                        Last updated: 12:34:56 [🔄 30s] │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Order

1. **US-801: Telemetry Service** — Foundation, everything depends on this
2. **US-802: Task Events** — Quick win, enables task counts immediately
3. **US-803: Run Events** — Enables error rate and duration
4. **US-804: Token Tracking** — Enables token metrics (can parallelize with 803)
5. **US-805: Metrics API** — Aggregation layer
6. **US-806: Dashboard Component** — The visible result
7. **US-807: Dashboard Placement** — UX integration
8. **US-808: Optional Traces** — Stretch if time permits

---

## Progress Log

### 2026-01-26

**Planning complete.** Sprint document created with:
- Definitions for success/failure/error/retry handling
- Minimal telemetry plan (7 event types, NDJSON storage)
- Optional traces rationale (coarse, 4 step types)
- 8 user stories with acceptance criteria
- Dashboard layout spec
- Recommended placement: collapsible section below board

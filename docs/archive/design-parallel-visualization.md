# Design: Parallel Work Stream Visualization

**Status:** Design Draft
**GitHub Issue:** #43
**Priority:** Medium

## Overview

Add a timeline/swimlane view to visualize parallel task execution, showing which tasks ran concurrently, how long each took, and where bottlenecks occurred.

## Use Cases

1. **Multi-agent sprint review** — After spawning 12 parallel agents, see which completed first, where time was spent
2. **Bottleneck detection** — Identify tasks that blocked others or took unexpectedly long
3. **Capacity planning** — Understand actual parallelism achieved vs theoretical max
4. **Sprint retrospective** — Visualize sprint execution for process improvement

## Proposed Architecture

### Data Model

The timeline view will use existing data:

- `task.timeTracking.entries[]` — Start/end times per task
- `task.status` — Current state
- `task.agent` — Assigned agent
- `activity-log.json` — Status change timestamps

New fields (optional):

- `task.parallelismGroup` — Group related parallel tasks
- `task.dependsOn[]` — Explicit dependencies for visualization

### API Endpoints

```typescript
// Timeline data for a date range
GET /api/analytics/timeline
Query: { from: ISO, to: ISO, agent?: string, project?: string }
Response: {
  tasks: [{
    id: string,
    title: string,
    agent: string,
    segments: [{ start: ISO, end: ISO, status: string }]
  }],
  metrics: {
    parallelismFactor: number,
    throughput: number,
    avgLeadTime: number
  }
}

// Aggregate metrics for a sprint
GET /api/analytics/metrics
Query: { sprint?: string, from?: ISO, to?: ISO }
Response: {
  tasksCompleted: number,
  avgDuration: number,
  parallelismPeak: number,
  agentUtilization: Record<string, number>
}
```

### UI Components

```
┌─────────────────────────────────────────────────────────────┐
│ [Kanban] [Timeline] [Dashboard]            🔍 Filter  📅    │
├─────────────────────────────────────────────────────────────┤
│ 2026-02-05                      8:00   9:00   10:00   11:00 │
├─────────────────────────────────────────────────────────────┤
│ veritas    │███████████████████████│                        │
│            │  REL-001              │                        │
├─────────────────────────────────────────────────────────────┤
│ codex-1    │     │█████│                                    │
│            │     │REL-2│                                    │
├─────────────────────────────────────────────────────────────┤
│ codex-2    │       │████████│                               │
│            │       │  REL-3 │                               │
├─────────────────────────────────────────────────────────────┤
│ codex-3    │         │██████████████│                       │
│            │         │    REL-4     │                       │
└─────────────────────────────────────────────────────────────┘
```

**Components needed:**

1. `TimelinePage.tsx` — New page at `/timeline`
2. `TimelineChart.tsx` — Gantt-style visualization (use @nivo/gantt or custom)
3. `TimelineFilters.tsx` — Date range, agent, project filters
4. `ParallelismMetrics.tsx` — Key metrics cards

### Implementation Phases

**Phase 1: Data Layer (2-3 hours)**

- [ ] Add timeline API endpoint
- [ ] Aggregate time tracking data into segments
- [ ] Calculate parallelism metrics

**Phase 2: Basic UI (4-6 hours)**

- [ ] Create TimelinePage with navigation
- [ ] Implement basic Gantt chart (horizontal bars)
- [ ] Add date range picker

**Phase 3: Polish (2-4 hours)**

- [ ] Add swimlanes per agent
- [ ] Color-code by task type/status
- [ ] Zoom levels (hour/day/week)
- [ ] Hover tooltips with task details

**Phase 4: Integration (2 hours)**

- [ ] Link from task cards to timeline position
- [ ] Add to dashboard as widget option

## Technical Decisions

**Chart Library Options:**

1. `@nivo/gantt` — React-native, good for static Gantt charts
2. `react-gantt-schedule-timeline-calendar` — Feature-rich but heavy
3. Custom with D3 — Maximum flexibility, more work
4. CSS Grid + custom — Simplest, good for MVP

**Recommendation:** Start with CSS Grid + custom for MVP, migrate to @nivo if needed.

## Dependencies

- Existing time tracking data must be populated
- Status history service provides state change timestamps

## Risks

1. **Data gaps** — Tasks without time tracking won't appear
2. **Performance** — Large date ranges with many tasks may be slow
3. **Complexity** — Full Gantt features (drag, resize, dependencies) add significant scope

## Success Metrics

- Users can identify which tasks ran in parallel
- Average parallelism factor is visible
- Sprint retrospectives use the timeline view

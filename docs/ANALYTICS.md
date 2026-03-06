# Analytics API — Parallel Work Stream Visualization

## Overview

The Analytics API provides insights into parallel task execution, agent utilization, and performance metrics. It's designed to visualize the temporal dimension of work — showing which tasks ran in parallel, how long each took, and where bottlenecks occurred.

### Use Cases

1. **Parallelism Visualization**: See how many tasks ran concurrently over time (Gantt-style)
2. **Lead Time Analysis**: Measure average time from task creation to completion
3. **Agent Utilization**: Track working vs. idle time per agent
4. **Throughput Metrics**: Measure tasks completed per day/week/sprint
5. **Performance Bottleneck Detection**: Identify periods of high or low concurrency

## API Endpoints

### GET `/api/analytics/timeline`

Returns timeline data showing task execution periods and parallelism snapshots.

#### Query Parameters

| Parameter | Type              | Optional | Description                                             |
| --------- | ----------------- | -------- | ------------------------------------------------------- |
| `from`    | ISO 8601 datetime | Yes      | Start of time range (default: earliest task time entry) |
| `to`      | ISO 8601 datetime | Yes      | End of time range (default: latest task time entry)     |
| `agent`   | string            | Yes      | Filter by agent type (e.g., "claude-code", "amp")       |
| `project` | string            | Yes      | Filter by project ID/name                               |
| `sprint`  | string            | Yes      | Filter by sprint ID/name                                |

#### Example Request

```bash
curl -X GET "http://localhost:3001/api/analytics/timeline?from=2026-01-01T00:00:00Z&to=2026-02-01T23:59:59Z&project=veritas"
```

#### Response Schema

```json
{
  "success": true,
  "data": {
    "period": {
      "from": "2026-01-01T10:30:00Z",
      "to": "2026-01-01T15:45:00Z"
    },
    "tasks": [
      {
        "id": "task_20260101_abc123",
        "title": "Build analytics service",
        "project": "veritas",
        "sprint": "v1.5",
        "agent": "claude-code",
        "status": "done",
        "startTime": "2026-01-01T10:30:00Z",
        "endTime": "2026-01-01T11:45:00Z",
        "durationSeconds": 4500,
        "timeEntries": [
          {
            "id": "entry_1",
            "startTime": "2026-01-01T10:30:00Z",
            "endTime": "2026-01-01T10:45:00Z",
            "duration": 900,
            "description": "Initial setup"
          }
        ]
      }
    ],
    "parallelism": [
      {
        "timestamp": "2026-01-01T10:30:00Z",
        "concurrentTaskCount": 2,
        "taskIds": ["task_20260101_abc123", "task_20260101_def456"]
      },
      {
        "timestamp": "2026-01-01T11:00:00Z",
        "concurrentTaskCount": 1,
        "taskIds": ["task_20260101_abc123"]
      }
    ],
    "summary": {
      "totalTasks": 1,
      "maxConcurrency": 2,
      "averageConcurrency": 1.5,
      "timelineStartTime": "2026-01-01T10:30:00Z",
      "timelineEndTime": "2026-01-01T15:45:00Z"
    }
  }
}
```

### GET `/api/analytics/metrics`

Returns aggregate metrics for a time period or sprint.

#### Query Parameters

| Parameter | Type              | Optional | Description               |
| --------- | ----------------- | -------- | ------------------------- |
| `sprint`  | string            | Yes      | Filter by sprint ID/name  |
| `from`    | ISO 8601 datetime | Yes      | Start of time range       |
| `to`      | ISO 8601 datetime | Yes      | End of time range         |
| `project` | string            | Yes      | Filter by project ID/name |

**Note**: If neither `from` nor `to` are provided, defaults to the last 30 days.

#### Example Request

```bash
curl -X GET "http://localhost:3001/api/analytics/metrics?sprint=v1.5"
```

#### Response Schema

```json
{
  "success": true,
  "data": {
    "period": {
      "from": "2026-01-01T00:00:00Z",
      "to": "2026-02-01T00:00:00Z",
      "sprint": "v1.5"
    },
    "parallelism": {
      "averageConcurrency": 3.2,
      "maxConcurrency": 7,
      "minConcurrency": 0
    },
    "throughput": {
      "tasksCompleted": 42,
      "tasksCreated": 45,
      "averageCompletionTime": 86400
    },
    "leadTime": {
      "fromTodoToDone": 172800,
      "fromCreatedToStarted": 3600,
      "fromStartedToDone": 169200
    },
    "agentUtilization": [
      {
        "agent": "claude-code",
        "startTime": "2026-01-01T08:00:00Z",
        "endTime": "2026-01-31T22:00:00Z",
        "durationSeconds": 2592000,
        "tasksCompleted": 28,
        "totalTaskDurationSeconds": 2592000
      }
    ],
    "efficiency": {
      "totalTrackedTime": 3628800,
      "totalTaskCount": 42,
      "averageTimePerTask": 86400,
      "utilizationRate": 0.75
    }
  }
}
```

## Data Models

### TimelineResponse

Timeline visualization data with task execution periods and parallelism information.

```typescript
interface TimelineResponse {
  period: {
    from: string; // ISO 8601 start time
    to: string; // ISO 8601 end time
  };
  tasks: TaskTimeline[];
  parallelism: ParallelismSnapshot[];
  summary: {
    totalTasks: number;
    maxConcurrency: number;
    averageConcurrency: number;
    timelineStartTime?: string;
    timelineEndTime?: string;
  };
}
```

### TaskTimeline

Task execution data extracted from time tracking.

```typescript
interface TaskTimeline {
  id: string;
  title: string;
  project?: string;
  sprint?: string;
  agent?: string;
  status: string;
  startTime?: string; // ISO 8601 of first time entry
  endTime?: string; // ISO 8601 of last time entry
  durationSeconds: number; // Total tracked time
  timeEntries: {
    id: string;
    startTime: string; // ISO 8601
    endTime?: string; // ISO 8601 (undefined if timer running)
    duration?: number; // Seconds
    description?: string;
  }[];
}
```

### ParallelismSnapshot

Point-in-time snapshot of concurrent task execution.

```typescript
interface ParallelismSnapshot {
  timestamp: string; // ISO 8601 timestamp
  concurrentTaskCount: number; // Number of concurrent tasks
  taskIds: string[]; // IDs of active tasks
}
```

### MetricsResponse

Aggregate metrics for a time period.

```typescript
interface MetricsResponse {
  period: {
    from: string;
    to: string;
    sprint?: string;
  };
  parallelism: {
    averageConcurrency: number;
    maxConcurrency: number;
    minConcurrency: number;
  };
  throughput: {
    tasksCompleted: number;
    tasksCreated: number;
    averageCompletionTime: number; // seconds
  };
  leadTime: {
    fromTodoToDone: number; // seconds (average)
    fromCreatedToStarted: number; // seconds (average)
    fromStartedToDone: number; // seconds (average)
  };
  agentUtilization: AgentPeriod[];
  efficiency: {
    totalTrackedTime: number; // seconds
    totalTaskCount: number;
    averageTimePerTask: number; // seconds
    utilizationRate: number; // 0-1 ratio
  };
}
```

### AgentPeriod

Agent activity breakdown.

```typescript
interface AgentPeriod {
  agent: string;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  durationSeconds: number;
  tasksCompleted: number;
  totalTaskDurationSeconds: number;
}
```

## Key Metrics Explained

### Parallelism

- **Average Concurrency**: Mean number of tasks running simultaneously
- **Max Concurrency**: Peak number of concurrent tasks
- **Min Concurrency**: Minimum concurrent tasks (often 0 during idle periods)

**Use**: Identify if work is truly parallel or sequential. High parallelism suggests distributed execution; low parallelism suggests bottlenecks.

### Throughput

- **Tasks Completed**: Number of done tasks in the period
- **Tasks Created**: Number of new tasks created in the period
- **Average Completion Time**: Mean time from creation to done

**Use**: Track productivity and capacity over time.

### Lead Time

- **From Todo to Done**: Total time from creation to completion (includes all work states)
- **From Created to Started**: Time before work begins (waiting for resources/assignment)
- **From Started to Done**: Time spent actively working

**Use**: Understand where delays occur (waiting vs. execution).

### Agent Utilization

- **Working Time**: Total time tasks assigned to an agent were being tracked
- **Tasks Completed**: Number of time entries per agent
- **Idle Time**: (period duration - working time) — inferred from gaps

**Use**: Load balance across agents; identify over/under-utilized resources.

### Efficiency

- **Utilization Rate**: (Total tracked time) / (Period duration)
  - 0.75 = 75% of the period was active work
  - Complementary idle rate = 25%
- **Average Time Per Task**: (Total tracked time) / (Number of tasks)

**Use**: Assess productivity and identify tasks that take longer than expected.

## Technical Implementation

### Service Layer

**`AnalyticsService`** (`server/src/services/analytics-service.ts`)

Core service that aggregates data and computes metrics.

Key methods:

- `getTimeline(query)`: Returns timeline visualization data
- `getMetrics(query)`: Returns aggregate metrics
- `calculateParallelism()`: Detects overlapping task periods
- `calculateAgentUtilization()`: Breaks down working time by agent

### Data Sources

The service reads from:

1. **Task Time Tracking**: `Task.timeTracking.entries[]` — individual time entries with start/end times
2. **Task Metadata**: `Task.project`, `Task.sprint`, `Task.agent`, `Task.status`

**Note**: Status history transitions could be used in the future to compute more precise lead time metrics (e.g., "time spent in in-progress state").

### Performance Considerations

- **Parallelism Sampling**: Samples at 5-minute intervals for efficiency (avoids O(n²) time point analysis)
- **Time Window Defaults**: If no range provided, derives from earliest/latest time entries
- **Filtering**: Applied before metric calculation to reduce data volume
- **Caching**: None yet; consider caching results for historical periods

## Usage Examples

### Example 1: Visualize Last Week's Parallelism

```bash
FROM=$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ)
TO=$(date -u +%Y-%m-%dT%H:%M:%SZ)

curl -s "http://localhost:3001/api/analytics/timeline?from=$FROM&to=$TO" | \
  jq '.data.parallelism | max_by(.concurrentTaskCount)'
```

### Example 2: Get Sprint Metrics

```bash
curl -s "http://localhost:3001/api/analytics/metrics?sprint=v1.5" | \
  jq '.data.efficiency'
```

### Example 3: Agent Comparison

```bash
curl -s "http://localhost:3001/api/analytics/metrics?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z" | \
  jq '.data.agentUtilization | sort_by(.durationSeconds) | reverse'
```

## Future Enhancements

1. **Status History Integration**: Use status transitions for more precise lead time calculations
2. **Caching**: Cache historical metrics (periods that don't change)
3. **Comparison Reports**: Compare metrics across sprints/agents
4. **Anomaly Detection**: Flag unusual patterns (e.g., zero concurrency for extended periods)
5. **Cost Analysis**: Integrate with token/cost metrics for ROI calculations
6. **Predictive Analytics**: Estimate completion dates based on historical throughput
7. **Visualization UI**: Build a Gantt chart view in the web dashboard
8. **Real-time Updates**: WebSocket support for live metrics

## Troubleshooting

### Empty Timeline

- **Cause**: No time entries recorded for the period
- **Solution**: Ensure tasks have time tracking started/stopped
- Check `GET /api/tasks` for `timeTracking.entries[]`

### Zero Utilization Rate

- **Cause**: Period window contains no tracked time
- **Solution**: Expand the date range or check task statuses

### High Average Concurrency but Few Tasks

- **Cause**: Tasks have overlapping time entries (manual entries or long-running timers)
- **Solution**: Check individual `timeEntries` in timeline response to verify

## API Design Notes

### Why ISO 8601?

- Timezone-aware (always UTC with 'Z' suffix)
- Sortable as strings
- Standard web format (supported by all major languages)

### Why Sample Parallelism?

- Computing exact parallelism at every microsecond is inefficient
- 5-minute sampling provides sufficient granularity for visualization
- Can be made configurable in future versions

### Why Separate Timeline and Metrics Endpoints?

- Timeline is detail-oriented (suitable for visualization)
- Metrics are summary-oriented (suitable for dashboards)
- Different caching strategies (timeline: short-lived, metrics: long-lived)

---

**See Also:**

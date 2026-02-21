# Testing the Analytics API

This guide explains how to test the Analytics API endpoints and verify parallelism calculations.

## Prerequisites

1. Start the development server:

   ```bash
   pnpm dev
   ```

2. Create some test tasks with time tracking (see below)

## Test Scenario: Creating Sample Data

### Create Tasks with Time Tracking

Create 3 tasks that run in parallel to test the parallelism detection:

```bash
# Task 1: 10:00-10:30 (30 min)
curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Feature A - Backend",
    "description": "Build API endpoint",
    "type": "feature",
    "status": "done",
    "priority": "high",
    "project": "veritas",
    "sprint": "v1.5"
  }' > /tmp/task1.json

# Extract task ID
TASK1=$(jq -r '.data.id' /tmp/task1.json)

# Add time entries (10:00-10:30)
curl -X POST http://localhost:3001/api/tasks/$TASK1/time/entry \
  -H "Content-Type: application/json" \
  -d '{
    "duration": 1800,
    "description": "Initial implementation"
  }'

# Task 2: 10:15-11:00 (45 min) - overlaps with Task 1
curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Feature B - Frontend",
    "description": "Build UI components",
    "type": "feature",
    "status": "done",
    "priority": "high",
    "project": "veritas",
    "sprint": "v1.5"
  }' > /tmp/task2.json

TASK2=$(jq -r '.data.id' /tmp/task2.json)

curl -X POST http://localhost:3001/api/tasks/$TASK2/time/entry \
  -H "Content-Type: application/json" \
  -d '{
    "duration": 2700,
    "description": "Component development"
  }'

# Task 3: 10:45-11:30 (45 min) - overlaps with Task 2 only
curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Feature C - Testing",
    "description": "Write test cases",
    "type": "feature",
    "status": "done",
    "priority": "medium",
    "project": "veritas",
    "sprint": "v1.5"
  }' > /tmp/task3.json

TASK3=$(jq -r '.data.id' /tmp/task3.json)

curl -X POST http://localhost:3001/api/tasks/$TASK3/time/entry \
  -H "Content-Type: application/json" \
  -d '{
    "duration": 2700,
    "description": "Test suite"
  }'

echo "Created tasks: $TASK1, $TASK2, $TASK3"
```

## API Testing

### Test 1: Get Timeline (No Filters)

```bash
curl -s http://localhost:3001/api/analytics/timeline | jq .
```

**Expected Output:**

- 3 tasks in the response
- Parallelism showing peaks of 2-3 concurrent tasks
- Time entries visible for each task

### Test 2: Get Timeline with Date Range

```bash
# Get timeline for today
curl -s "http://localhost:3001/api/analytics/timeline?from=2026-02-04T00:00:00Z&to=2026-02-05T23:59:59Z" | jq .
```

**Expected Output:**

- If tasks created today, should match task list
- Summary shows accurate task counts

### Test 3: Filter by Project

```bash
curl -s "http://localhost:3001/api/analytics/timeline?project=veritas" | jq '.data.tasks | length'
```

**Expected Output:**

- `3` (only veritas tasks)

### Test 4: Get Metrics for Sprint

```bash
curl -s "http://localhost:3001/api/analytics/metrics?sprint=v1.5" | jq .
```

**Expected Output:**

- `parallelism.averageConcurrency`: ~1.5-2.0
- `parallelism.maxConcurrency`: 2 or 3
- `throughput.tasksCompleted`: 3
- `efficiency.utilizationRate`: ~0.8+ (high utilization due to overlap)

### Test 5: Verify Parallelism Calculation

```bash
curl -s http://localhost:3001/api/analytics/timeline | \
  jq '.data.parallelism | sort_by(.timestamp) | .[] | {timestamp: .timestamp, count: .concurrentTaskCount}'
```

**Expected Output Pattern:**

```json
{
  "timestamp": "2026-02-05T10:00:00Z",
  "count": 1
}
{
  "timestamp": "2026-02-05T10:15:00Z",
  "count": 2
}
{
  "timestamp": "2026-02-05T10:45:00Z",
  "count": 3
}
{
  "timestamp": "2026-02-05T11:00:00Z",
  "count": 2
}
{
  "timestamp": "2026-02-05T11:30:00Z",
  "count": 1
}
```

### Test 6: Agent Utilization

```bash
curl -s "http://localhost:3001/api/analytics/metrics?sprint=v1.5" | \
  jq '.data.agentUtilization'
```

**Expected Output:**

- Agent breakdown by working time
- All 3 tasks attributed to agents (if set)

## Load Testing

To test performance with many tasks:

```bash
# Generate 100 tasks with overlapping time entries
for i in {1..100}; do
  TASK=$(curl -s -X POST http://localhost:3001/api/tasks \
    -H "Content-Type: application/json" \
    -d "{
      \"title\": \"Test Task $i\",
      \"type\": \"feature\",
      \"status\": \"done\",
      \"priority\": \"low\",
      \"project\": \"test\",
      \"sprint\": \"load-test\"
    }" | jq -r '.data.id')

  curl -s -X POST http://localhost:3001/api/tasks/$TASK/time/entry \
    -H "Content-Type: application/json" \
    -d "{\"duration\": $((RANDOM % 3600 + 300))}"

  echo "Created task $i"
done

# Time the metrics endpoint
time curl -s "http://localhost:3001/api/analytics/metrics?sprint=load-test" > /dev/null
```

**Expected:** Should complete in <2 seconds even with 100 tasks

## Debugging Tips

### Check Task Time Tracking

```bash
TASK_ID="task_20260205_xxxxx"
curl -s http://localhost:3001/api/tasks/$TASK_ID | jq '.data.timeTracking'
```

### Verify Parallelism Snapshots

```bash
curl -s http://localhost:3001/api/analytics/timeline | \
  jq '.data | {totalTasks: .summary.totalTasks, snapshotCount: (.parallelism | length), maxConcurrency: .summary.maxConcurrency}'
```

### Check Timeline Period

```bash
curl -s http://localhost:3001/api/analytics/timeline | \
  jq '.data.period'
```

## Troubleshooting

### No Data in Timeline

1. Verify tasks have time entries: `curl http://localhost:3001/api/tasks | jq '.data[] | select(.timeTracking.entries | length > 0)'`
2. Check date range is correct
3. Ensure timer was stopped (not still running)

### Incorrect Parallelism

1. Review individual time entries: `curl http://localhost:3001/api/tasks/TASK_ID | jq '.data.timeTracking.entries'`
2. Check entry start/end times
3. Verify 5-minute sampling window includes the overlap points

### Performance Issues

1. Check number of tasks: `curl http://localhost:3001/api/tasks | jq '.data | length'`
2. If >1000 tasks, consider narrowing date range
3. Use project/sprint filters to reduce data volume

## Integration Testing

The analytics endpoints follow VK's standard patterns:

1. **Response Envelope**: All responses wrapped in `{success, data, meta}`
2. **Error Handling**: Invalid date ranges return 400 with validation error
3. **Rate Limiting**: GET requests use `readRateLimit` (300 req/min)
4. **Authentication**: Requires valid session or API key

Example error response:

```json
{
  "success": false,
  "error": "Validation failed",
  "meta": {
    "timestamp": "2026-02-05T02:50:00Z",
    "requestId": "..."
  }
}
```

## Performance Benchmarks

Typical response times on development hardware:

| Scenario          | Tasks | Time Range | Response Time |
| ----------------- | ----- | ---------- | ------------- |
| Small sprint      | 20    | 1 week     | <100ms        |
| Large sprint      | 100   | 1 month    | <500ms        |
| Full history      | 500   | 1 year     | 1-2s          |
| Complex filtering | 200   | 30 days    | <300ms        |

---

For more details on the API, see [ANALYTICS.md](./ANALYTICS.md).

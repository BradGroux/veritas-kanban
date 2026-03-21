# SOP: Behavioral Drift Detection & Alerting

Monitor agent metric baselines and respond to detected drift.

---

## Overview

Drift detection compares an agent's current performance metrics against established baselines. When a metric deviates beyond a configured threshold, an alert is created. Alerts move through a lifecycle:

| State          | Meaning                                       |
| -------------- | --------------------------------------------- |
| `detected`     | Deviation found, alert created                |
| `acknowledged` | A human or process has reviewed the alert     |

Metrics that drift detection monitors (examples):
- Task completion rate
- Average run duration
- Error rate
- Token usage per task
- Output quality score

---

## Prerequisites

- VK server running (v4.0+)
- Baselines populated (either from historical data or manually set)
- Thresholds configured per metric

---

## Step-by-Step Procedure

### 1. Check Current Baselines

Before responding to drift, understand what the system considers normal:

```bash
curl http://localhost:3001/api/drift/baselines
```

Filter by agent:

```bash
curl "http://localhost:3001/api/drift/baselines?agent=TARS"
```

**Response:** Array of baseline records showing `metric`, `baseline` value, `threshold`, and last updated timestamp.

### 2. Run Drift Analysis

Trigger an analysis to check if current metrics have drifted from baselines:

```bash
curl -X POST http://localhost:3001/api/drift/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "TARS"
  }'
```

**Response:**

```json
{
  "agent": "TARS",
  "alertsCreated": 2,
  "metricsChecked": 5,
  "summary": [
    { "metric": "task_completion_rate", "baseline": 0.92, "current": 0.71, "status": "alert" },
    { "metric": "error_rate", "baseline": 0.03, "current": 0.08, "status": "warning" },
    { "metric": "avg_run_duration_ms", "baseline": 4200, "current": 4350, "status": "ok" }
  ]
}
```

### 3. List Active Drift Alerts

```bash
# All unacknowledged alerts
curl "http://localhost:3001/api/drift/alerts?acknowledged=false"

# All alerts for a specific agent
curl "http://localhost:3001/api/drift/alerts?agent=TARS"
```

**Response:** Array of drift alert objects.

### 4. Acknowledge an Alert

When you've investigated an alert and it's been addressed:

```bash
curl -X POST http://localhost:3001/api/drift/alerts/drift_abc123/acknowledge \
  -H "Content-Type: application/json" \
  -d '{
    "notes": "TARS was rate-limited by upstream API from 14:00–15:30. Not a behavioral change. Resolved."
  }'
```

**Response:** Updated alert with `acknowledged: true` and your notes.

### 5. Reset Baselines

After intentional changes to an agent's behavior or workload, reset its baselines to reflect the new normal:

```bash
# Reset a specific metric for an agent
curl -X POST http://localhost:3001/api/drift/baselines/reset \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "TARS",
    "metric": "task_completion_rate"
  }'
```

**Response:** Updated baseline record with new `baseline` value.

---

## API Endpoints

| Method | Path                                     | Description                              |
| ------ | ---------------------------------------- | ---------------------------------------- |
| `GET`  | `/api/drift/alerts`                      | List drift alerts                        |
| `POST` | `/api/drift/alerts/:id/acknowledge`      | Acknowledge a drift alert                |
| `GET`  | `/api/drift/baselines`                   | List agent metric baselines              |
| `POST` | `/api/drift/baselines/reset`             | Reset baselines for an agent/metric      |
| `POST` | `/api/drift/analyze`                     | Trigger drift analysis for an agent      |

---

## Alert Object Schema

| Field            | Type    | Description                                         |
| ---------------- | ------- | --------------------------------------------------- |
| `id`             | string  | Alert ID                                            |
| `agent`          | string  | Agent the alert is for                              |
| `metric`         | string  | Metric that triggered the alert                     |
| `baseline`       | number  | Expected value                                      |
| `current`        | number  | Observed value                                      |
| `deviation`      | number  | Absolute difference (current − baseline)            |
| `threshold`      | number  | Deviation amount that triggers alerting             |
| `severity`       | string  | `low`, `medium`, `high`                             |
| `acknowledged`   | boolean | Whether the alert has been reviewed                 |
| `detectedAt`     | string  | ISO 8601 timestamp of detection                     |

---

## Common Issues

**Alerts immediately after a reset:** Resetting baselines sets the new normal from current data. If the agent is still in a degraded state when you reset, the new baseline will be low, making future detection harder.

**Too many low-severity alerts:** Increase thresholds for noisy metrics, or add a minimum severity filter to your alert queries.

**Analysis returns `alertsCreated: 0` but performance looks wrong:** Baselines may not be populated yet. Check `GET /api/drift/baselines` — if empty, the system has no baseline to compare against.

---

## Related Docs

- [FEATURES.md — Behavioral Drift Detection](./FEATURES.md#behavioral-drift-detection--alerting)
- [API-REFERENCE.md — Drift](./API-REFERENCE.md#behavioral-drift-detection-apidrift)
- [SOP: Output Evaluation](./SOP-output-evaluation.md)
- [SOP: System Health Monitoring](./SOP-system-health-monitoring.md)

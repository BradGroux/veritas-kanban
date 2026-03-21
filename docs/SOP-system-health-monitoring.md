# SOP: System Health Monitoring

Read system health indicators and respond to alerts.

---

## Overview

The Global System Health API aggregates three signal streams into a single status response, displayed in real-time by the health status bar in the VK dashboard:

| Signal       | What It Monitors                                     |
| ------------ | ---------------------------------------------------- |
| `system`     | Storage access, disk space (>100 MB free), memory    |
| `agents`     | Agent registry — online, offline, total counts       |
| `operations` | Run metrics — 24h success rate, failed runs          |

**Overall status values (ordered by severity):**

| Status      | Meaning                                                       |
| ----------- | ------------------------------------------------------------- |
| `stable`    | All signals OK                                                |
| `reviewing` | One warning signal detected                                   |
| `drifting`  | Two or more warnings, or at least one agent offline           |
| `elevated`  | Any signal is `critical`                                      |
| `alert`     | System storage failure, or operations success rate < 50%      |

---

## Prerequisites

- VK server running (v4.0+)
- No authentication required — this endpoint is public

---

## Step-by-Step Procedure

### 1. Check System Health

```bash
curl http://localhost:3001/api/system/health
```

**Response:**

```json
{
  "timestamp": "2026-03-21T14:00:00.000Z",
  "status": "stable",
  "signals": {
    "system": {
      "status": "ok",
      "storage": true,
      "disk": true,
      "memory": true
    },
    "agents": {
      "status": "ok",
      "total": 3,
      "online": 3,
      "offline": 0
    },
    "operations": {
      "status": "ok",
      "recentRuns": 47,
      "successRate": 96,
      "failedRuns": 2
    }
  }
}
```

### 2. Interpret the Status

**`stable`:** No action needed.

**`reviewing`:** Look at which signal is `warn`:
- `system.memory: false` → heap usage >90% — monitor for leaks or restart if persistent
- `operations.status: warn` → success rate 80–99% or >5 failed runs — check recent task failures

**`drifting`:** Two signals are warning or agents are offline:
- Check `agents.offline` count — confirm agents are expected to be offline
- Run `GET /api/agents` to see which agents are offline and their last heartbeat

**`elevated`:** A critical signal exists:
- `agents.status: critical` → all agents offline — check agent processes
- `operations.status: critical` → success rate <50% or massive failure count — check logs immediately

**`alert`:** Immediate action required:
- `system.storage: false` → data directory inaccessible — check filesystem permissions
- `system.disk: false` → <100 MB disk free — clean up disk space immediately
- `operations.successRate < 50` → more than half of recent runs failed — check server logs

### 3. Diagnosing Agent Issues

When `agents.status` is `warn` or `critical`:

```bash
# List all agents and their statuses
curl http://localhost:3001/api/agents

# Check the agent registry
curl http://localhost:3001/api/agent/status
```

Look for agents with `status: offline` and a stale `lastHeartbeat` timestamp.

### 4. Diagnosing Operations Issues

When `operations.status` is `warn` or `critical`:

```bash
# Check recent run telemetry
curl "http://localhost:3001/api/telemetry/events?type=run.completed&limit=20"

# Look for failed runs
curl "http://localhost:3001/api/telemetry/events?type=run.completed&success=false&limit=20"
```

Review the task IDs in failed runs to understand which work is failing.

### 5. Polling for Status Changes

For automated monitoring, poll the health endpoint and alert on status changes:

```bash
#!/bin/bash
PREV_STATUS=""
while true; do
  STATUS=$(curl -s http://localhost:3001/api/system/health | jq -r '.status')
  if [ "$STATUS" != "$PREV_STATUS" ] && [ "$STATUS" != "stable" ]; then
    echo "ALERT: System status changed to $STATUS"
    # trigger your notification here
  fi
  PREV_STATUS=$STATUS
  sleep 60
done
```

---

## API Endpoints

| Method | Path                  | Description                          |
| ------ | --------------------- | ------------------------------------ |
| `GET`  | `/api/system/health`  | Get aggregated system health status  |

---

## Status Escalation Logic

```
All OK → stable
1 warning → reviewing
2+ warnings OR any agent offline → drifting
Any critical signal → elevated
System storage fail OR successRate < 50% → alert
```

Thresholds (hardcoded in v4.0):
- **Memory warn:** heap used > 90%
- **Disk fail:** free space < 100 MB
- **Operations warn:** success rate 80–99%, or failedRuns > 5
- **Operations critical:** success rate < 50%

---

## Common Issues

**Status shows `elevated` with all agents appearing online:** Check the operations signal — `status: critical` also triggers `elevated`. The agent registry shows registered agents, not process health.

**`system.disk: false` immediately after startup:** The data directory path may be wrong. Check the `DATA_DIR` environment variable — it should point to the `.veritas-kanban` data directory.

**Health endpoint returns 500:** The metrics service or agent registry service failed to initialize. Check the server startup logs.

---

## Related Docs

- [FEATURES.md — System Health Status Bar](./FEATURES.md#global-system-health-status-bar)
- [API-REFERENCE.md — System Health](./API-REFERENCE.md#system-health-apisystemhealth)
- [SOP: Behavioral Drift Detection](./SOP-behavioral-drift-detection.md)
- [SOP: Output Evaluation](./SOP-output-evaluation.md)

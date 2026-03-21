# SOP: Decision Audit Trail

Log, track, and review agent decisions with assumptions.

---

## Overview

The Decision Audit Trail gives every agent-made decision a permanent, searchable record. Each decision includes:

- The decision text and the agent that made it
- A confidence score (0–1)
- Reasoning and supporting evidence
- A list of assumptions the decision depends on

Assumptions can be marked as held or not-held after the fact, providing a post-hoc quality signal for decision-making.

---

## Prerequisites

- VK server running (v4.0+)
- Agent identifier (e.g., `TARS`, `VERITAS`)

---

## Step-by-Step Procedure

### 1. Log a Decision

Call this immediately when an agent makes a significant decision:

```bash
curl -X POST http://localhost:3001/api/decisions \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "Use Redis for session caching",
    "confidence": 0.85,
    "reasoning": "Redis provides sub-ms latency and native TTL support — both required by the auth system SLA.",
    "evidence": ["benchmark results from ticket #204", "existing Redis cluster in infra"],
    "assumptions": [
      "Redis cluster remains available during peak hours",
      "1-hour TTL is sufficient for user sessions"
    ],
    "agent": "VERITAS",
    "taskId": "task_20260321_abc"
  }'
```

**Response:** `201` with decision object including `id`.

### 2. List Decisions

```bash
# All decisions
curl http://localhost:3001/api/decisions

# Filter by agent and confidence
curl "http://localhost:3001/api/decisions?agent=VERITAS&minConfidence=0.8"

# Filter by task
curl "http://localhost:3001/api/decisions?taskId=task_20260321_abc"
```

### 3. Retrieve a Single Decision

```bash
curl http://localhost:3001/api/decisions/dec_abc123
```

### 4. Update an Assumption

After the outcome is known, mark individual assumptions as held or not held:

```bash
# Update assumption at index 0 (zero-based)
curl -X PATCH http://localhost:3001/api/decisions/dec_abc123/assumptions/0 \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Redis cluster remains available during peak hours (confirmed — 99.9% uptime observed)",
    "held": true
  }'

# Mark assumption at index 1 as not held
curl -X PATCH http://localhost:3001/api/decisions/dec_abc123/assumptions/1 \
  -H "Content-Type: application/json" \
  -d '{
    "text": "1-hour TTL proved insufficient — users reported session drops after 45 minutes",
    "held": false
  }'
```

---

## API Endpoints

| Method  | Path                                       | Description                           |
| ------- | ------------------------------------------ | ------------------------------------- |
| `GET`   | `/api/decisions`                           | List decisions (filterable)           |
| `POST`  | `/api/decisions`                           | Log a new decision                    |
| `GET`   | `/api/decisions/:id`                       | Get a single decision                 |
| `PATCH` | `/api/decisions/:id/assumptions/:idx`      | Update a specific assumption by index |

---

## Decision Object Schema

| Field         | Type     | Required | Description                                         |
| ------------- | -------- | -------- | --------------------------------------------------- |
| `decision`    | string   | ✅       | The decision made                                   |
| `confidence`  | number   | ✅       | 0–1 confidence score                                |
| `reasoning`   | string   | ❌       | Why this decision was made                          |
| `evidence`    | string[] | ❌       | Supporting evidence references                      |
| `assumptions` | string[] | ❌       | Assumptions the decision depends on                 |
| `agent`       | string   | ✅       | Agent identifier                                    |
| `taskId`      | string   | ❌       | Associated task ID                                  |

---

## Query Parameters (List)

| Param           | Type   | Description                                  |
| --------------- | ------ | -------------------------------------------- |
| `agent`         | string | Filter by agent name                         |
| `taskId`        | string | Filter by task ID                            |
| `minConfidence` | number | Minimum confidence score (0–1)               |
| `maxConfidence` | number | Maximum confidence score (0–1)               |
| `since`         | string | ISO 8601 datetime — decisions after this     |
| `until`         | string | ISO 8601 datetime — decisions before this    |
| `limit`         | number | Max records to return (default: 50)          |
| `offset`        | number | Pagination offset                            |

---

## Common Issues

**Assumptions indexed incorrectly:** Assumptions are zero-indexed. The first assumption in the array is index `0`.

**Low-confidence decisions not surfacing:** Filter with `maxConfidence=0.5` to review decisions where the agent was uncertain.

**Decision not linked to a task:** If `taskId` was omitted on creation, the decision can't be patched to add it — log a new decision.

---

## Related Docs

- [FEATURES.md — Decision Audit Trail](./FEATURES.md#decision-audit-trail-with-assumption-tracking)
- [API-REFERENCE.md — Decisions](./API-REFERENCE.md#decision-audit-trail-apidecisions)
- [SOP: Agent Policy Engine](./SOP-agent-policy-engine.md)
- [SOP: Output Evaluation](./SOP-output-evaluation.md)

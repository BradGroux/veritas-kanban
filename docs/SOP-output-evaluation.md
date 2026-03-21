# SOP: Agent Output Evaluation & Scoring

Define scoring profiles and evaluate agent outputs for quality.

---

## Overview

The Scoring Framework lets you define profiles with weighted criteria that evaluate agent outputs. Each evaluation runs the output through all scorers, combines scores using a composite method, and returns a per-scorer breakdown for diagnostics.

**Scorer types:**

| Type                | What it checks                                               |
| ------------------- | ------------------------------------------------------------ |
| `RegexMatch`        | Whether the output matches a regular expression              |
| `KeywordContains`   | Whether the output contains required keywords                |
| `NumericRange`      | Whether a numeric field in the output falls within a range   |
| `CustomExpression`  | A custom evaluation expression                               |

**Composite methods:**

| Method          | Behavior                                              |
| --------------- | ----------------------------------------------------- |
| `weightedAvg`   | Weighted average of all scorer scores                 |
| `minimum`       | Score is the lowest individual scorer score           |
| `geometricMean` | Geometric mean — penalizes any single low scorer      |

---

## Prerequisites

- VK server running (v4.0+)
- Know what "good" looks like for the outputs you want to evaluate

---

## Step-by-Step Procedure

### 1. Create a Scoring Profile

```bash
curl -X POST http://localhost:3001/api/scoring/profiles \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Task Summary Quality",
    "description": "Evaluate quality of agent task completion summaries.",
    "compositeMethod": "weightedAvg",
    "scorers": [
      {
        "id": "has-action-items",
        "name": "Contains action items",
        "type": "KeywordContains",
        "weight": 0.4,
        "target": "output",
        "keywords": ["completed", "implemented", "fixed", "added"],
        "matchMode": "any",
        "caseSensitive": false
      },
      {
        "id": "length-check",
        "name": "Summary length",
        "type": "NumericRange",
        "weight": 0.3,
        "target": "output",
        "valuePath": "length",
        "min": 50,
        "max": 500
      },
      {
        "id": "no-apologies",
        "name": "No apology language",
        "type": "RegexMatch",
        "weight": 0.3,
        "target": "output",
        "pattern": "I apologize|I\\'m sorry|unfortunately|I cannot",
        "flags": "i",
        "scoreOnMatch": 0,
        "scoreOnMiss": 1,
        "invert": false
      }
    ]
  }'
```

**Response:** `201` with profile object including `id`.

### 2. List Available Profiles

```bash
curl http://localhost:3001/api/scoring/profiles
```

### 3. Evaluate an Output

```bash
curl -X POST http://localhost:3001/api/scoring/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "profileId": "prof_abc123",
    "output": "Implemented the OAuth login feature using Passport.js. Added Google and GitHub providers. Tests pass.",
    "action": "task-completion",
    "agent": "TARS",
    "taskId": "task_20260321_abc"
  }'
```

**Response:**

```json
{
  "id": "eval_xyz789",
  "profileId": "prof_abc123",
  "score": 0.87,
  "passed": true,
  "breakdown": [
    { "scorerId": "has-action-items", "score": 1.0, "weight": 0.4, "weighted": 0.4 },
    { "scorerId": "length-check", "score": 0.85, "weight": 0.3, "weighted": 0.255 },
    { "scorerId": "no-apologies", "score": 1.0, "weight": 0.3, "weighted": 0.3 }
  ],
  "agent": "TARS",
  "taskId": "task_20260321_abc",
  "createdAt": "2026-03-21T14:00:00.000Z"
}
```

### 4. Review Evaluation History

```bash
# All history
curl http://localhost:3001/api/scoring/history

# Filter by profile and agent
curl "http://localhost:3001/api/scoring/history?profileId=prof_abc123&agent=TARS&limit=20"
```

### 5. Update a Profile

```bash
curl -X PUT http://localhost:3001/api/scoring/profiles/prof_abc123 \
  -H "Content-Type: application/json" \
  -d '{
    "compositeMethod": "minimum"
  }'
```

### 6. Delete a Profile

Built-in profiles cannot be deleted.

```bash
curl -X DELETE http://localhost:3001/api/scoring/profiles/prof_abc123
```

**Response:** `204 No Content`.

---

## API Endpoints

| Method   | Path                        | Description                          |
| -------- | --------------------------- | ------------------------------------ |
| `GET`    | `/api/scoring/profiles`     | List all scoring profiles            |
| `POST`   | `/api/scoring/profiles`     | Create a scoring profile             |
| `GET`    | `/api/scoring/profiles/:id` | Get a specific profile               |
| `PUT`    | `/api/scoring/profiles/:id` | Update a profile                     |
| `DELETE` | `/api/scoring/profiles/:id` | Delete a profile (non-built-in only) |
| `POST`   | `/api/scoring/evaluate`     | Evaluate an output against a profile |
| `GET`    | `/api/scoring/history`      | List evaluation history              |

---

## Common Issues

**`Cannot delete built-in profile`:** Built-in profiles ship with VK and cannot be removed. Create a custom profile instead.

**Score unexpectedly low:** Check the breakdown field in the evaluation response — it shows which scorer penalized the score.

**`NumericRange` scorer always returns 0:** Ensure `valuePath` correctly addresses a numeric property of the output object. For string length, use `length`.

**`KeywordContains` with `matchMode: "all"` is too strict:** Switch to `"any"` if you want partial credit, or use `partialCredit: true` to award fractional scores.

---

## Related Docs

- [FEATURES.md — Output Evaluation](./FEATURES.md#agent-output-evaluation--scoring-framework)
- [API-REFERENCE.md — Scoring](./API-REFERENCE.md#output-evaluation--scoring-apisc)
- [SOP: Decision Audit Trail](./SOP-decision-audit-trail.md)
- [SOP: Behavioral Drift Detection](./SOP-behavioral-drift-detection.md)

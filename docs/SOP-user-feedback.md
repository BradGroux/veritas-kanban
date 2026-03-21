# SOP: User Feedback Loop with Sentiment Analytics

Collect agent output feedback, analyze sentiment, and act on results.

---

## Overview

The User Feedback system captures ratings and comments on agent work, automatically infers sentiment, and provides an analytics API for trend analysis. Feedback is categorized and can be marked resolved to track follow-up.

**Categories:** `quality` · `performance` · `accuracy` · `safety` · `ux`

**Sentiment (auto-inferred from rating):** `positive` (4–5) · `neutral` (3) · `negative` (1–2)

**Rating scale:** 1 (worst) → 5 (best)

---

## Prerequisites

- VK server running (v4.0+)
- Tasks exist in the system that feedback can be attached to

---

## Step-by-Step Procedure

### 1. Submit Feedback

Call this immediately after reviewing agent output:

```bash
curl -X POST http://localhost:3001/api/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "task_20260321_abc",
    "agent": "TARS",
    "rating": 4,
    "comment": "Output was accurate and well-structured. Could be more concise.",
    "categories": ["quality", "accuracy"]
  }'
```

**Response:** `201` with feedback object including `id` and auto-inferred `sentiment` (`positive`).

### 2. List Feedback

```bash
# All feedback
curl http://localhost:3001/api/feedback

# Filter by agent, category, and sentiment
curl "http://localhost:3001/api/feedback?agent=TARS&sentiment=negative&limit=20"

# Filter by task
curl "http://localhost:3001/api/feedback?taskId=task_20260321_abc"

# Unresolved only
curl "http://localhost:3001/api/feedback?resolved=false"
```

### 3. View the Unresolved Queue

The unresolved queue is your action backlog — feedback that needs follow-up:

```bash
curl http://localhost:3001/api/feedback/unresolved
```

**Response:** Array of feedback items sorted by age (oldest first), limited to 100 by default.

### 4. Get Analytics

Understand patterns across your feedback data:

```bash
# Overall analytics
curl http://localhost:3001/api/feedback/analytics

# Analytics for a specific agent
curl "http://localhost:3001/api/feedback/analytics?agent=TARS"

# Analytics for a specific time window
curl "http://localhost:3001/api/feedback/analytics?since=2026-03-01T00:00:00Z&until=2026-03-21T23:59:59Z"
```

**Response:**

```json
{
  "totalCount": 142,
  "averageRating": 3.8,
  "sentimentBreakdown": {
    "positive": 89,
    "neutral": 32,
    "negative": 21
  },
  "categoryBreakdown": {
    "quality": 67,
    "accuracy": 54,
    "performance": 21,
    "safety": 0,
    "ux": 0
  },
  "unresolvedCount": 8,
  "trend": "improving"
}
```

### 5. Mark Feedback Resolved

After acting on feedback, mark it resolved to remove it from the unresolved queue:

```bash
curl -X PUT http://localhost:3001/api/feedback/fb_abc123 \
  -H "Content-Type: application/json" \
  -d '{
    "resolved": true
  }'
```

### 6. Update Feedback

If feedback needs correction:

```bash
curl -X PUT http://localhost:3001/api/feedback/fb_abc123 \
  -H "Content-Type: application/json" \
  -d '{
    "rating": 3,
    "comment": "Updated after re-reviewing the output — conciseness was fine, accuracy was the issue.",
    "categories": ["accuracy"]
  }'
```

### 7. Delete Feedback

```bash
curl -X DELETE http://localhost:3001/api/feedback/fb_abc123
```

**Response:** `204 No Content`.

---

## API Endpoints

| Method   | Path                         | Description                                   |
| -------- | ---------------------------- | --------------------------------------------- |
| `GET`    | `/api/feedback`              | List feedback (filterable)                    |
| `POST`   | `/api/feedback`              | Submit new feedback                           |
| `GET`    | `/api/feedback/analytics`    | Get analytics and sentiment breakdown         |
| `GET`    | `/api/feedback/unresolved`   | List unresolved feedback items                |
| `GET`    | `/api/feedback/:id`          | Get a specific feedback item                  |
| `PUT`    | `/api/feedback/:id`          | Update feedback (rating, comment, resolved)   |
| `DELETE` | `/api/feedback/:id`          | Delete a feedback item                        |

---

## Query Parameters (List)

| Param       | Type    | Description                                       |
| ----------- | ------- | ------------------------------------------------- |
| `taskId`    | string  | Filter by task ID                                 |
| `agent`     | string  | Filter by agent name                              |
| `category`  | string  | `quality`, `performance`, `accuracy`, `safety`, `ux` |
| `sentiment` | string  | `positive`, `neutral`, `negative`                 |
| `resolved`  | boolean | Filter by resolved status                         |
| `since`     | string  | ISO 8601 — feedback submitted after this date     |
| `until`     | string  | ISO 8601 — feedback submitted before this date    |
| `limit`     | number  | Max records (default: 50)                         |

---

## Common Issues

**Sentiment looks wrong for a rating:** Sentiment is inferred from rating: 1–2 = `negative`, 3 = `neutral`, 4–5 = `positive`. Updating the rating will update the sentiment.

**Unresolved queue not clearing:** Feedback is resolved explicitly via `PUT /:id` with `{ "resolved": true }` — it doesn't auto-resolve.

**Analytics showing stale data:** Analytics are computed on-demand from the full dataset. If you recently deleted or updated feedback, re-query for fresh results.

---

## Related Docs

- [FEATURES.md — User Feedback Loop](./FEATURES.md#user-feedback-loop-with-sentiment-analytics)
- [API-REFERENCE.md — Feedback](./API-REFERENCE.md#user-feedback-apifeedback)
- [SOP: Output Evaluation](./SOP-output-evaluation.md)

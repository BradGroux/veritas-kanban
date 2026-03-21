# SOP: Task Deliverables

<!-- doc-freshness: 2026-03-21 | v4.0.0 | @tars -->

## Purpose

Attach structured deliverable records to tasks — tracking what artifacts an agent is expected to produce, their status, and their output paths. Deliverables give human reviewers and orchestrators a clear checklist of what a task produced and whether each output is ready for review.

## Prerequisites

- Veritas Kanban server running
- An existing task ID to attach deliverables to
- API access (localhost:3001 by default)

## Concepts

| Term | Definition |
|------|------------|
| **Deliverable** | A tracked output artifact associated with a task |
| **Type** | What kind of artifact: `file`, `url`, `text`, `pr`, `report`, or `other` |
| **Status** | Lifecycle state: `pending` → `in-progress` → `ready` → `approved` → `rejected` |
| **Path** | Optional file path or URL pointing to the artifact |
| **Agent** | Which agent is responsible for producing this deliverable |

## Step-by-Step: Add Deliverables to a Task

### At task start — declare expected outputs

Add deliverables when beginning a task so reviewers know what to expect:

```bash
curl -s -X POST http://localhost:3001/api/tasks/task_20260321_abc/deliverables \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Updated CHANGELOG.md",
    "type": "file",
    "path": "CHANGELOG.md",
    "agent": "TARS",
    "description": "v4.0.0 entry with all PRs and features documented"
  }'
```

→ Returns the updated task object. The new deliverable has `status: "pending"` by default.

### Add multiple deliverables

Call the endpoint once per deliverable. Each becomes a separate tracked item:

```bash
# Second deliverable — the PR
curl -s -X POST http://localhost:3001/api/tasks/task_20260321_abc/deliverables \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Pull Request #229",
    "type": "pr",
    "path": "https://github.com/BradGroux/veritas-kanban/pull/229",
    "agent": "TARS",
    "description": "PR with all doc changes and version bumps"
  }'
```

### List all deliverables for a task

```bash
curl -s "http://localhost:3001/api/tasks/task_20260321_abc/deliverables"
```

**Response:**
```json
[
  {
    "id": "deliverable_abc123",
    "title": "Updated CHANGELOG.md",
    "type": "file",
    "path": "CHANGELOG.md",
    "status": "pending",
    "agent": "TARS",
    "description": "v4.0.0 entry with all PRs and features documented",
    "created": "2026-03-21T14:00:00.000Z"
  }
]
```

## Step-by-Step: Update Deliverable Status

Update status as work progresses — this drives the task's completion checklist.

### Mark as in-progress

```bash
curl -s -X PATCH \
  "http://localhost:3001/api/tasks/task_20260321_abc/deliverables/deliverable_abc123" \
  -H 'Content-Type: application/json' \
  -d '{ "status": "in-progress" }'
```

### Mark as ready for review

```bash
curl -s -X PATCH \
  "http://localhost:3001/api/tasks/task_20260321_abc/deliverables/deliverable_abc123" \
  -H 'Content-Type: application/json' \
  -d '{
    "status": "ready",
    "path": "CHANGELOG.md"
  }'
```

### Mark as approved (by reviewer)

```bash
curl -s -X PATCH \
  "http://localhost:3001/api/tasks/task_20260321_abc/deliverables/deliverable_abc123" \
  -H 'Content-Type: application/json' \
  -d '{ "status": "approved" }'
```

### Mark as rejected (needs rework)

```bash
curl -s -X PATCH \
  "http://localhost:3001/api/tasks/task_20260321_abc/deliverables/deliverable_abc123" \
  -H 'Content-Type: application/json' \
  -d '{
    "status": "rejected",
    "description": "CHANGELOG entry missing Fixed section — needs all PR #225 details"
  }'
```

## Step-by-Step: Remove a Deliverable

```bash
curl -s -X DELETE \
  "http://localhost:3001/api/tasks/task_20260321_abc/deliverables/deliverable_abc123"
```

**Response:** `204 No Content`.

## Deliverable Status Lifecycle

```
pending → in-progress → ready → approved
                         ↓
                       rejected → (agent reworks) → ready → approved
```

Only `approved` deliverables count as "complete" for task checklist purposes.

## Deliverable Type Reference

| Type | Use For |
|------|---------|
| `file` | Files on disk (code, docs, config) — use `path` for filepath |
| `url` | Web resources (reports, dashboards, hosted docs) — use `path` for URL |
| `text` | Plain text output (summaries, analysis results) |
| `pr` | Pull requests — use `path` for the GitHub PR URL |
| `report` | Structured reports (HTML, PDF) |
| `other` | Anything else |

## Integrating into Agent Workflows

```typescript
// At task start: declare deliverables
const changelog = await vkClient.addDeliverable(taskId, {
  title: 'CHANGELOG.md entry',
  type: 'file',
  path: 'CHANGELOG.md',
  agent: agentName,
  description: 'v4.0.0 release notes'
});

// Mark in-progress when starting
await vkClient.updateDeliverable(taskId, changelog.id, { status: 'in-progress' });

// ... do the work ...

// Mark ready when done
await vkClient.updateDeliverable(taskId, changelog.id, {
  status: 'ready',
  path: 'CHANGELOG.md'
});
```

## API Endpoints Used

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/tasks/:id/deliverables` | List all deliverables for a task |
| `POST` | `/api/tasks/:id/deliverables` | Add a deliverable |
| `PATCH` | `/api/tasks/:id/deliverables/:deliverableId` | Update status, path, or description |
| `DELETE` | `/api/tasks/:id/deliverables/:deliverableId` | Remove a deliverable |

## Common Issues / Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `404 Task not found` | Task ID doesn't exist | Verify the task ID with `GET /api/tasks/:id` |
| `404 Deliverable not found` on PATCH | Deliverable ID doesn't exist on that task | `GET /api/tasks/:id/deliverables` to list valid IDs |
| Status not advancing | Calling PATCH with correct body but wrong deliverable ID | Double-check the `deliverableId` in the URL path |
| Deliverables not visible in UI | UI may filter by status | Check if the UI is filtering for `pending` or `ready` only |

## Related Docs

- [docs/features/deliverables.md](features/deliverables.md) — Feature deep-dive
- [SOP-agent-task-workflow.md](SOP-agent-task-workflow.md) — How deliverables fit into the standard task lifecycle
- [docs/mcp/README.md](mcp/README.md) — Deliverables are also accessible via MCP tools

# Task Deliverables

First-class deliverable objects with type/status tracking for code, documentation, data, and more.

## Overview

Task Deliverables provide structured tracking of work products created during task execution. Instead of burying deliverables in comments or descriptions, they're tracked as first-class objects with type, status, and metadata.

## Features

- **Structured tracking** — Type-safe deliverable objects with validation
- **Type system** — Code, documentation, data, design, test, deployment, other
- **Status tracking** — Draft, in-progress, complete, reviewed, approved
- **File references** — Link to files in the repository or file system
- **URL references** — Link to external resources (docs sites, design tools, dashboards)
- **Metadata** — Size, format, description, creation date
- **Validation** — Schema validation for file paths and URLs

## API Endpoints

### Add Deliverable

```bash
# Code deliverable
curl -X POST http://localhost:3002/api/tasks/{taskId}/deliverables \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "type": "code",
    "title": "API Refactor",
    "description": "Refactored authentication endpoints",
    "status": "complete",
    "path": "server/src/routes/auth.ts"
  }'

# Documentation deliverable with URL
curl -X POST http://localhost:3002/api/tasks/{taskId}/deliverables \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "type": "documentation",
    "title": "API Documentation",
    "description": "Updated authentication flow docs",
    "status": "reviewed",
    "url": "https://docs.example.com/auth"
  }'

# Data deliverable with metadata
curl -X POST http://localhost:3002/api/tasks/{taskId}/deliverables \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "type": "data",
    "title": "User Export",
    "description": "Exported user data for migration",
    "status": "complete",
    "path": "exports/users-2026-02-07.csv",
    "metadata": {
      "format": "CSV",
      "size": "2.4 MB",
      "recordCount": 50000
    }
  }'
```

### Get Deliverables

```bash
# Get all deliverables for a task
curl http://localhost:3002/api/tasks/{taskId}/deliverables \
  -H "X-API-Key: YOUR_KEY"

# Filter by type
curl "http://localhost:3002/api/tasks/{taskId}/deliverables?type=code" \
  -H "X-API-Key: YOUR_KEY"

# Filter by status
curl "http://localhost:3002/api/tasks/{taskId}/deliverables?status=complete" \
  -H "X-API-Key: YOUR_KEY"
```

### Update Deliverable

```bash
# Update status
curl -X PATCH http://localhost:3002/api/tasks/{taskId}/deliverables/{deliverableId} \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "status": "approved"
  }'

# Update description and metadata
curl -X PATCH http://localhost:3002/api/tasks/{taskId}/deliverables/{deliverableId} \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "description": "Updated with final revisions",
    "metadata": {
      "version": "2.0"
    }
  }'
```

### Delete Deliverable

```bash
curl -X DELETE http://localhost:3002/api/tasks/{taskId}/deliverables/{deliverableId} \
  -H "X-API-Key: YOUR_KEY"
```

## Request Schema

### Create/Update Deliverable

| Field         | Type   | Required | Description                             |
| ------------- | ------ | -------- | --------------------------------------- |
| `type`        | enum   | ✅       | Deliverable type (see Types below)      |
| `title`       | string | ✅       | Deliverable title                       |
| `description` | string | ❌       | Detailed description                    |
| `status`      | enum   | ✅       | Deliverable status (see Statuses below) |
| `path`        | string | ❌       | File path (relative to repo root)       |
| `url`         | string | ❌       | External URL                            |
| `metadata`    | object | ❌       | Custom metadata (format, size, etc.)    |

**Note:** Either `path` or `url` should be provided, but not both.

## Response Schema

### Deliverable Object

```json
{
  "id": "dlv_abc123",
  "type": "code",
  "title": "API Refactor",
  "description": "Refactored authentication endpoints",
  "status": "complete",
  "path": "server/src/routes/auth.ts",
  "url": null,
  "metadata": {
    "linesOfCode": 320,
    "complexity": "medium"
  },
  "createdAt": "2026-02-07T15:00:00Z",
  "updatedAt": "2026-02-07T15:30:00Z",
  "createdBy": "TARS"
}
```

## Deliverable Types

| Type            | Description                        | Common Paths/URLs                  |
| --------------- | ---------------------------------- | ---------------------------------- |
| `code`          | Source code files                  | `src/`, `lib/`, `components/`      |
| `documentation` | Docs, guides, specs                | `docs/`, `README.md`, docs sites   |
| `data`          | Data files, exports, seeds         | `data/`, `exports/`, `fixtures/`   |
| `design`        | Mockups, wireframes, assets        | Figma, Sketch, `assets/`           |
| `test`          | Test files, coverage reports       | `tests/`, `__tests__/`, CI reports |
| `deployment`    | Deploy configs, scripts, manifests | `deploy/`, `.github/`, K8s YAML    |
| `other`         | Anything else                      | Varies                             |

## Deliverable Statuses

| Status        | Description                        | Typical Use                         |
| ------------- | ---------------------------------- | ----------------------------------- |
| `draft`       | Initial work, not ready for review | Early prototypes, WIP docs          |
| `in-progress` | Actively being worked on           | Ongoing development                 |
| `complete`    | Work finished, ready for review    | Completed code, finished docs       |
| `reviewed`    | Reviewed but not yet approved      | Post-review, awaiting approval      |
| `approved`    | Approved and ready for merge/ship  | Final state before merge/deployment |

## Storage

Deliverables are stored in task markdown files as YAML frontmatter:

```yaml
---
id: 'task_20260207_abc123'
title: 'Refactor Authentication'
deliverables:
  - id: 'dlv_001'
    type: 'code'
    title: 'Auth Routes'
    status: 'complete'
    path: 'server/src/routes/auth.ts'
    createdAt: '2026-02-07T15:00:00Z'
    createdBy: 'TARS'
  - id: 'dlv_002'
    type: 'documentation'
    title: 'API Docs'
    status: 'reviewed'
    url: 'https://docs.example.com/auth'
    createdAt: '2026-02-07T15:30:00Z'
    createdBy: 'TARS'
---
```

## Common Use Cases

### Code Deliverables

Track specific files or modules created during development:

```bash
curl -X POST http://localhost:3002/api/tasks/{taskId}/deliverables \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "type": "code",
    "title": "WebSocket Service",
    "description": "Real-time message delivery service",
    "status": "complete",
    "path": "server/src/services/websocket-service.ts",
    "metadata": {
      "linesOfCode": 450,
      "complexity": "high",
      "testCoverage": "95%"
    }
  }'
```

### Documentation Deliverables

Link to generated docs or external documentation:

```bash
curl -X POST http://localhost:3002/api/tasks/{taskId}/deliverables \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "type": "documentation",
    "title": "Feature Guide",
    "description": "User-facing guide for squad chat feature",
    "status": "approved",
    "path": "docs/features/squad-chat.md"
  }'
```

### Design Deliverables

Reference design files or tools:

```bash
curl -X POST http://localhost:3002/api/tasks/{taskId}/deliverables \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "type": "design",
    "title": "UI Mockups",
    "description": "High-fidelity mockups for broadcast notification UI",
    "status": "approved",
    "url": "https://figma.com/file/abc123",
    "metadata": {
      "screens": 5,
      "variants": ["desktop", "mobile"]
    }
  }'
```

### Data Deliverables

Track data exports, migrations, or datasets:

```bash
curl -X POST http://localhost:3002/api/tasks/{taskId}/deliverables \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "type": "data",
    "title": "Migration Script",
    "description": "Database migration for new schema",
    "status": "complete",
    "path": "migrations/2026-02-07-add-deliverables.sql",
    "metadata": {
      "tables": ["tasks"],
      "type": "schema-change"
    }
  }'
```

### Test Deliverables

Track test files and coverage:

```bash
curl -X POST http://localhost:3002/api/tasks/{taskId}/deliverables \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "type": "test",
    "title": "E2E Test Suite",
    "description": "End-to-end tests for deliverables feature",
    "status": "complete",
    "path": "tests/e2e/deliverables.spec.ts",
    "metadata": {
      "testCount": 12,
      "coverage": "100%"
    }
  }'
```

## Frontend Display

Deliverables appear in the task detail panel with:

- **Type badges** — Color-coded by deliverable type
- **Status indicators** — Icon + status text
- **File links** — Clickable paths open in file viewer
- **URL links** — External links open in new tab
- **Metadata display** — Custom fields rendered as key-value pairs
- **Edit/delete actions** — Inline actions for task owners

## Agent Integration

Agents should create deliverables when completing work:

```bash
# After creating/modifying a file
curl -X POST http://localhost:3002/api/tasks/{taskId}/deliverables \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "type": "code",
    "title": "Feature Implementation",
    "status": "complete",
    "path": "'"$FILE_PATH"'"
  }'
```

Update deliverable status as work progresses:

```bash
# After code review
curl -X PATCH http://localhost:3002/api/tasks/{taskId}/deliverables/{deliverableId} \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "status": "reviewed"
  }'

# After approval
curl -X PATCH http://localhost:3002/api/tasks/{taskId}/deliverables/{deliverableId} \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "status": "approved"
  }'
```

## Validation

The API validates:

- **Type enum** — Must be one of the defined types
- **Status enum** — Must be one of the defined statuses
- **Path format** — Cannot start with `/`, must be relative
- **URL format** — Must be valid HTTP/HTTPS URL
- **Exclusivity** — Cannot provide both `path` and `url`
- **Required fields** — `type`, `title`, `status` are mandatory

## Best Practices

1. **Create deliverables as work completes** — Don't wait until task is done
2. **Use appropriate types** — Helps with filtering and reporting
3. **Update status as work progresses** — Track review/approval state
4. **Add metadata for searchability** — File size, format, test coverage, etc.
5. **Link to files when possible** — Makes it easy to find artifacts later
6. **Use URLs for external resources** — Figma, docs sites, dashboards
7. **Delete obsolete deliverables** — Keep the list clean and relevant

## Limitations

- Deliverables are task-scoped — cannot be shared across tasks
- File paths are not validated for existence (allows referencing future files)
- URLs are validated for format but not reachability
- Metadata is free-form JSON — no schema enforcement
- No built-in versioning — create multiple deliverables for versions

## Related Documentation

- [Task Lifecycle Hooks](#) — Trigger actions on deliverable events
- [Code Review Workflow](#) — Integrate deliverables with review process
- [CLI Guide](../CLI-GUIDE.md) — CLI commands for task management

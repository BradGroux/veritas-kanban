# SOP: Prompt Template Registry

Create, version, and manage prompt templates with variable injection.

---

## Overview

The Prompt Template Registry provides a centralized store for prompt templates used by agents. Key capabilities:

- Version history — every update creates a new version automatically
- Variable extraction — `{{variable_name}}` syntax for dynamic injection
- Usage tracking — record which model ran which template and with what token costs
- Preview rendering — test variable injection before using in production

**Template categories:** `system` · `agent` · `tool` · `evaluation`

---

## Prerequisites

- VK server running (v4.0+)
- Prompt content ready to store (use `{{variable}}` syntax for injection points)

---

## Step-by-Step Procedure

### 1. Create a Template

```bash
curl -X POST http://localhost:3001/api/prompt-registry \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Task Completion Summary",
    "description": "Generates a completion summary for a finished task.",
    "category": "agent",
    "content": "You completed task {{task_title}}. Write a 2-3 sentence summary of what was done. Acceptance criteria: {{acceptance_criteria}}. Agent: {{agent_name}}."
  }'
```

**Response:** `201` with template object including `id`, `version` (starts at 1), and extracted `variables` list.

### 2. List Templates

```bash
curl http://localhost:3001/api/prompt-registry
```

**Response:** Array of all templates with metadata but not full content (for performance).

### 3. Get a Template

```bash
curl http://localhost:3001/api/prompt-registry/tmpl_abc123
```

**Response:** Full template with current content, version number, variables list, and metadata.

### 4. Preview with Variables

Test variable injection before using the template in production:

```bash
curl -X POST http://localhost:3001/api/prompt-registry/tmpl_abc123/render-preview \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "tmpl_abc123",
    "sampleVariables": {
      "task_title": "Add OAuth login",
      "acceptance_criteria": "Users can log in with Google and GitHub.",
      "agent_name": "TARS"
    }
  }'
```

**Response:** `{ "rendered": "You completed task Add OAuth login. Write a 2-3 sentence summary..." }`

### 5. Update a Template

Every update automatically creates a new version:

```bash
curl -X PATCH http://localhost:3001/api/prompt-registry/tmpl_abc123 \
  -H "Content-Type: application/json" \
  -d '{
    "content": "You completed task {{task_title}} (Task ID: {{task_id}}). Write a 2-3 sentence summary. Acceptance criteria: {{acceptance_criteria}}. Agent: {{agent_name}}.",
    "changelog": "Added task_id variable for traceability"
  }'
```

**Response:** Updated template with incremented `version` number.

### 6. List Version History

```bash
curl http://localhost:3001/api/prompt-registry/tmpl_abc123/versions
```

**Response:** Array of version objects with `versionNumber`, `changelog`, and `createdAt`. Use this to identify which version to roll back to.

### 7. Roll Back (by Pinning an Old Version)

There's no automatic rollback endpoint — to use an older version, retrieve it from the versions list and create a new update with the old content:

```bash
# 1. Get the target version's content from the versions list
curl http://localhost:3001/api/prompt-registry/tmpl_abc123/versions

# 2. Update the template with the old content and note the rollback
curl -X PATCH http://localhost:3001/api/prompt-registry/tmpl_abc123 \
  -H "Content-Type: application/json" \
  -d '{
    "content": "<content from old version>",
    "changelog": "Rolled back to v2 — v3 introduced regression in output quality"
  }'
```

### 8. Record Usage

After using a template, record the usage for analytics:

```bash
curl -X POST http://localhost:3001/api/prompt-registry/tmpl_abc123/record-usage \
  -H "Content-Type: application/json" \
  -d '{
    "usedBy": "TARS",
    "model": "anthropic/claude-sonnet-4-6",
    "inputTokens": 320,
    "outputTokens": 145,
    "renderedPrompt": "You completed task Add OAuth login..."
  }'
```

**Response:** `201` with usage record.

### 9. View Usage History and Stats

```bash
# Usage history (last 50 uses)
curl http://localhost:3001/api/prompt-registry/tmpl_abc123/usage

# Stats summary
curl http://localhost:3001/api/prompt-registry/tmpl_abc123/stats

# Aggregate stats across all templates
curl http://localhost:3001/api/prompt-registry/stats/all
```

### 10. Delete a Template

```bash
curl -X DELETE http://localhost:3001/api/prompt-registry/tmpl_abc123
```

**Response:** `204 No Content`.

---

## API Endpoints

| Method   | Path                                         | Description                          |
| -------- | -------------------------------------------- | ------------------------------------ |
| `GET`    | `/api/prompt-registry`                       | List all templates                   |
| `POST`   | `/api/prompt-registry`                       | Create a new template                |
| `GET`    | `/api/prompt-registry/:id`                   | Get a template                       |
| `PATCH`  | `/api/prompt-registry/:id`                   | Update a template (auto-versions)    |
| `DELETE` | `/api/prompt-registry/:id`                   | Delete a template                    |
| `GET`    | `/api/prompt-registry/:id/versions`          | List all versions of a template      |
| `GET`    | `/api/prompt-registry/:id/usage`             | Get usage history                    |
| `GET`    | `/api/prompt-registry/:id/stats`             | Get usage statistics                 |
| `GET`    | `/api/prompt-registry/stats/all`             | Aggregate stats across all templates |
| `POST`   | `/api/prompt-registry/:id/render-preview`    | Render a preview with variables      |
| `POST`   | `/api/prompt-registry/:id/record-usage`      | Record a usage event                 |

---

## Template Schema

| Field         | Type   | Required | Description                                              |
| ------------- | ------ | -------- | -------------------------------------------------------- |
| `name`        | string | ✅       | Template name                                            |
| `description` | string | ❌       | What the template is for                                 |
| `category`    | enum   | ✅       | `system`, `agent`, `tool`, or `evaluation`               |
| `content`     | string | ✅       | Template body with `{{variable}}` placeholders           |
| `changelog`   | string | ❌       | Description of changes (for update operations)           |

---

## Common Issues

**Variables not being extracted:** Ensure you use `{{variable_name}}` double-brace syntax. Single braces or other formats won't be recognized.

**Stats endpoint returns empty:** Stats are only populated after `record-usage` calls. The system does not auto-track usage — you must call `record-usage` explicitly.

**Version history growing large:** Each `PATCH` creates a new version. This is by design — don't update for cosmetic reasons. Batch changes into single updates.

---

## Related Docs

- [FEATURES.md — Prompt Template Registry](./FEATURES.md#prompt-template-registry-with-version-control)
- [API-REFERENCE.md — Prompt Registry](./API-REFERENCE.md#prompt-template-registry-apiprompt-registry)
- [SOP: Output Evaluation](./SOP-output-evaluation.md)

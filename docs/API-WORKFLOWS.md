# Veritas Kanban Workflow Engine — API Reference

**Version**: v3.3  
**Last Updated**: 2026-02-15  
**Base URL**: `http://localhost:3001/api`

---

## Table of Contents

1. [Authentication](#authentication)
2. [Workflow CRUD](#workflow-crud)
3. [Workflow Runs](#workflow-runs)
4. [Gate Operations](#gate-operations)
5. [Tool Policies](#tool-policies)
6. [Sandbox Policies](#sandbox-policies)
7. [Task Dependencies](#task-dependencies) (NEW — v3.3)
8. [Crash-Recovery Checkpointing](#crash-recovery-checkpointing) (NEW — v3.3)
9. [Observational Memory](#observational-memory) (NEW — v3.3)
10. [Agent Filter](#agent-filter) (NEW — v3.3)
11. [WebSocket Events](#websocket-events)
12. [TypeScript Interfaces](#typescript-interfaces)
13. [Error Responses](#error-responses)

---

## Authentication

All API endpoints currently accept an optional authentication key via `x-api-key` header. RBAC permissions are enforced based on workflow ACLs (Access Control Lists).

**Header**:

```
x-api-key: <your-api-key>
```

**Permissions**:

- `view` — View workflow definitions and runs
- `create` — Create new workflows
- `edit` — Update workflow definitions
- `delete` — Delete workflows (owner only)
- `execute` — Start workflow runs, approve gates

---

## Workflow CRUD

### GET /api/workflows

List all workflows (metadata only, filtered by user permissions).

**Request**:

```bash
curl http://localhost:3001/api/workflows
```

**Response**:

```json
[
  {
    "id": "feature-dev",
    "name": "Feature Development Workflow",
    "version": 2,
    "description": "End-to-end feature development pipeline",
    "agentCount": 4,
    "stepCount": 7,
    "createdAt": "2026-02-09T12:00:00Z",
    "updatedAt": "2026-02-09T14:30:00Z"
  },
  {
    "id": "security-audit",
    "name": "Security Audit & Remediation",
    "version": 1,
    "description": "Scan, prioritize, and fix security issues",
    "agentCount": 3,
    "stepCount": 5,
    "createdAt": "2026-02-09T10:00:00Z",
    "updatedAt": "2026-02-09T10:00:00Z"
  }
]
```

**Status Codes**:

- `200 OK` — Success

**Permissions**: Any authenticated user can list workflows they have `view` permission for.

---

### GET /api/workflows/:id

Get a specific workflow definition (full YAML content).

**Request**:

```bash
curl http://localhost:3001/api/workflows/feature-dev
```

**Response**:

```json
{
  "id": "feature-dev",
  "name": "Feature Development Workflow",
  "version": 2,
  "description": "End-to-end feature development pipeline",
  "config": {
    "timeout": 7200,
    "fresh_session_default": true,
    "progress_file": "progress.md",
    "telemetry_tags": ["workflow", "feature-dev"]
  },
  "agents": [
    {
      "id": "planner",
      "name": "Planner",
      "role": "planner",
      "model": "github-copilot/claude-opus-4.6",
      "description": "Decomposes tasks into user stories"
    },
    {
      "id": "developer",
      "name": "Developer",
      "role": "developer",
      "model": "github-copilot/claude-sonnet-4.5",
      "description": "Implements features"
    }
  ],
  "steps": [
    {
      "id": "plan",
      "name": "Plan: Decompose into stories",
      "type": "agent",
      "agent": "planner",
      "input": "Decompose this task into stories...",
      "output": {
        "file": "plan.yml"
      },
      "acceptance_criteria": ["stories:"],
      "on_fail": {
        "retry": 2,
        "escalate_to": "human"
      },
      "timeout": 600
    }
  ],
  "variables": {
    "repo_path": "{{task.git.worktreePath}}",
    "test_command": "npm test"
  }
}
```

**Status Codes**:

- `200 OK` — Success
- `404 Not Found` — Workflow not found
- `403 Forbidden` — No view permission

**Headers**:

```http
ETag: "workflow:feature-dev:2"
X-Resource-Revision: 2
```

**Permissions**: Requires `view` permission.

---

### POST /api/workflows

Create a new workflow.

**Request**:

```bash
curl -X POST http://localhost:3001/api/workflows \
  -H "Content-Type: application/json" \
  -d '{
    "id": "hello-world",
    "name": "Hello World Workflow",
    "version": 1,
    "description": "A simple test workflow",
    "agents": [
      {
        "id": "writer",
        "name": "Writer",
        "role": "developer",
        "model": "github-copilot/claude-sonnet-4.5",
        "description": "Writes messages"
      }
    ],
    "steps": [
      {
        "id": "greet",
        "name": "Greet user",
        "type": "agent",
        "agent": "writer",
        "input": "Write a hello message",
        "output": {
          "file": "greeting.md"
        }
      }
    ]
  }'
```

**Response**:

```json
{
  "success": true,
  "workflowId": "hello-world"
}
```

**Status Codes**:

- `201 Created` — Workflow created successfully
- `400 Bad Request` — Validation error (missing required fields, invalid references)
- `409 Conflict` — Workflow ID already exists

**Permissions**: Any authenticated user can create workflows (becomes owner).

**Validation**:

- `id`: Required, alphanumeric + dashes, max 100 characters
- `name`: Required, max 200 characters
- `version`: Required, integer ≥ 0
- `description`: Required, max 2000 characters
- `agents`: Required, 1-20 agents
- `steps`: Required, 1-50 steps
- All `step.agent` references must match an `agents.id`
- All `on_fail.retry_step` references must match a `steps.id`

---

### PUT /api/workflows/:id

Update an existing workflow (auto-increments version).

**Request**:

```bash
curl -X PUT http://localhost:3001/api/workflows/hello-world \
  -H "Content-Type: application/json" \
  -H 'If-Match: "workflow:hello-world:1"' \
  -d '{
    "id": "hello-world",
    "name": "Hello World Workflow v2",
    "version": 1,
    "description": "Updated workflow with farewell step",
    "agents": [
      {
        "id": "writer",
        "name": "Writer",
        "role": "developer",
        "model": "github-copilot/claude-sonnet-4.5",
        "description": "Writes messages"
      }
    ],
    "steps": [
      {
        "id": "greet",
        "name": "Greet user",
        "type": "agent",
        "agent": "writer",
        "input": "Write a hello message",
        "output": {
          "file": "greeting.md"
        }
      },
      {
        "id": "farewell",
        "name": "Say goodbye",
        "type": "agent",
        "agent": "writer",
        "input": "Write a goodbye message",
        "output": {
          "file": "farewell.md"
        }
      }
    ]
  }'
```

**Response**:

```json
{
  "success": true,
  "version": 2
}
```

**Status Codes**:

- `200 OK` — Workflow updated successfully
- `400 Bad Request` — Validation error or ID mismatch
- `404 Not Found` — Workflow not found
- `403 Forbidden` — No edit permission
- `409 Conflict` — Workflow has changed since the supplied `If-Match` revision

**Permissions**: Requires `edit` permission.

**Notes**:

- Version is auto-incremented (ignore `version` in request body)
- Workflow `version` is also the optimistic-concurrency revision. Read the
  workflow ETag, then send it back with `If-Match` on update.
- Workflow definitions include `createdBy`, `updatedBy`, `createdAt`, and
  `updatedAt` when saved through the API.
- Active runs continue with their snapshotted version (no interruption)
- Changes are logged to `.veritas-kanban/workflows/.audit.jsonl`

**Conflict response**:

```json
{
  "code": "CONFLICT",
  "message": "workflow hello-world has changed since it was loaded. Reload and retry with the latest revision.",
  "details": {
    "resourceType": "workflow",
    "resourceId": "hello-world",
    "expectedRevision": 1,
    "currentRevision": 2,
    "current": {
      "id": "hello-world",
      "version": 2,
      "description": "Latest workflow body"
    }
  }
}
```

---

### DELETE /api/workflows/:id

Delete a workflow.

**Request**:

```bash
curl -X DELETE http://localhost:3001/api/workflows/hello-world
```

**Response**:

```
(Empty body, 204 status)
```

**Status Codes**:

- `204 No Content` — Workflow deleted successfully
- `404 Not Found` — Workflow not found
- `403 Forbidden` — Not owner (only owners can delete)

**Permissions**: Requires `delete` permission (owner only).

**Notes**:

- Deletes workflow YAML file
- Does NOT delete historical run data (runs remain accessible)
- Audit event logged

---

## Workflow Authoring

### POST /api/workflows/authoring/dry-run

Validate an unsaved workflow without starting a run. The response includes lint
messages, executable checks, and a skill audit for referenced shared skills.

**Request**:

```bash
curl -X POST http://localhost:3001/api/workflows/authoring/dry-run \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": {
      "id": "release-helper",
      "name": "Release Helper",
      "version": 1,
      "description": "Uses a shared release skill",
      "agents": [
        {
          "id": "runner",
          "name": "Runner",
          "role": "developer",
          "tools": ["Read", "skill:release-helper"]
        }
      ],
      "steps": [{ "id": "run", "name": "Run", "type": "agent", "agent": "runner" }]
    },
    "context": { "clientMode": "remote" }
  }'
```

**Response excerpt**:

```json
{
  "status": "blocked",
  "canRun": false,
  "checks": [{ "id": "skill", "label": "Skill audit", "status": "fail" }],
  "messages": [
    {
      "category": "skill",
      "severity": "error",
      "message": "Skill Release Helper has no persisted scan and cannot run in remote mode."
    }
  ],
  "skillAudit": {
    "status": "fail",
    "mode": "remote",
    "references": [
      {
        "reference": "release-helper",
        "skillId": "release-helper",
        "status": "blocked",
        "message": "Skill Release Helper has no persisted scan and cannot run in remote mode."
      }
    ]
  }
}
```

The skill audit recognizes `skill:<id>` and `skill/<id>` references in agents,
tools, steps, variables, inputs, and descriptions. Local mode warns on unscanned
skills. Remote and cloud modes fail missing, unscanned, or blocked skills unless
the skill has an active reviewed exception.

Dry-run responses may include `pipelineSummary` when a workflow declares
`pipeline`. Pipeline lint validates the parent agent, subagent role references,
deliverable contracts, verification steps, dependencies, and whether each role is
used by a workflow step or parallel substep.

### GET /api/workflows/recipes

Returns reusable workflow recipes. v5 recipes include `.openclaw Audit`, which
materializes an orchestrated pipeline with config, storage, security, docs, and
follow-up task subagent roles.

### POST /api/workflows/recipes/:recipeId/materialize

Materializes a recipe into workflow JSON/YAML and a preview. When a recipe has a
pipeline, `preview.pipeline` contains role, status, scope, deliverable,
dependency, verification, and telemetry-budget metadata for the authoring UI.

### POST /api/workflows/:id/dry-run

Dry-run a saved workflow definition with the same response shape and context
rules as `/api/workflows/authoring/dry-run`.

---

## Workflow Runs

### POST /api/workflows/:id/runs

Start a new workflow run.

**Request**:

```bash
curl -X POST http://localhost:3001/api/workflows/feature-dev/runs \
  -H "Content-Type: application/json" \
  -d '{
  "taskId": "US-42",
  "context": {
    "clientMode": "remote",
    "priority": "high",
    "deadline": "2026-02-15"
  }
}'
```

**Request Body**:

```typescript
{
  taskId?: string;           // Optional: VK task ID to associate with run
  context?: {
    clientMode?: "local" | "remote" | "cloud"; // Optional: workflow skill gate mode
    [key: string]: unknown;
  };
  budget?: {
    enabled?: boolean;
    limits?: {
      totalTokens?: number;
      costUsd?: number;
      toolCalls?: number;
      runtimeSeconds?: number;
      idleRuntimeSeconds?: number;
      retries?: number;
      fanOut?: number;
    };
    softThresholdPercent?: number;
    hardAction?: "pause" | "require-approval" | "downgrade" | "cancel";
    downgradeModel?: string;
  };
}
```

Before a run starts, the server dry-runs the saved workflow and blocks remote or
cloud execution when a referenced shared skill is missing, unscanned, or blocked.
The run context includes the resulting `skillAudit` summary when execution is
allowed. Workflows with `pipeline` metadata also include `context.pipeline`,
which rolls subagent role status and time/token telemetry into the run record.

Run budgets are merged with workspace, workflow, and workflow-agent defaults
using the strictest positive limit. Soft thresholds write `budget-policy`
governance traces. Hard thresholds pause/block, require approval, downgrade the
model route, or cancel according to the effective policy.

**Response**:

```json
{
  "id": "run_20260209_abc123",
  "workflowId": "feature-dev",
  "workflowVersion": 2,
  "taskId": "US-42",
  "status": "running",
  "currentStep": "plan",
  "context": {
    "task": {
      "id": "US-42",
      "title": "Implement user registration",
      "description": "Add registration endpoint with email validation"
    },
    "priority": "high",
    "deadline": "2026-02-15"
  },
  "startedAt": "2026-02-09T12:00:00Z",
  "steps": [
    {
      "stepId": "plan",
      "status": "running",
      "agent": "planner",
      "startedAt": "2026-02-09T12:00:00Z",
      "retries": 0
    },
    {
      "stepId": "implement",
      "status": "pending",
      "retries": 0
    }
  ]
}
```

**Status Codes**:

- `201 Created` — Run started successfully
- `400 Bad Request` — Validation error
- `404 Not Found` — Workflow not found
- `403 Forbidden` — No execute permission

**Permissions**: Requires `execute` permission.

**Notes**:

- Workflow execution begins immediately (asynchronous)
- Monitor progress via WebSocket or polling `/api/workflow-runs/:id`
- Run state persisted to `.veritas-kanban/workflow-runs/{runId}/run.json`

---

### GET /api/workflow-runs

List workflow runs with optional filters.

**Query Parameters**:

- `workflowId` (string, optional) — Filter by workflow ID
- `taskId` (string, optional) — Filter by task ID
- `status` (string, optional) — Filter by status: `pending`, `running`, `blocked`, `completed`, `failed`

**Request**:

```bash
# All runs
curl http://localhost:3001/api/workflow-runs

# Runs for a specific workflow
curl "http://localhost:3001/api/workflow-runs?workflowId=feature-dev"

# Runs for a specific task
curl "http://localhost:3001/api/workflow-runs?taskId=US-42"

# Failed runs only
curl "http://localhost:3001/api/workflow-runs?status=failed"
```

**Response**:

```json
[
  {
    "id": "run_20260209_abc123",
    "workflowId": "feature-dev",
    "workflowVersion": 2,
    "taskId": "US-42",
    "status": "completed",
    "startedAt": "2026-02-09T12:00:00Z",
    "completedAt": "2026-02-09T12:45:00Z",
    "duration": 2700,
    "stepsCompleted": 7,
    "stepsTotal": 7
  },
  {
    "id": "run_20260209_def456",
    "workflowId": "security-audit",
    "workflowVersion": 1,
    "status": "running",
    "currentStep": "fix",
    "startedAt": "2026-02-09T13:00:00Z",
    "stepsCompleted": 2,
    "stepsTotal": 5
  }
]
```

**Status Codes**:

- `200 OK` — Success

**Permissions**: Filtered by workflow `view` permissions.

---

### GET /api/workflow-runs/:id

Get full details of a specific workflow run.

**Request**:

```bash
curl http://localhost:3001/api/workflow-runs/run_20260209_abc123
```

**Response**:

```json
{
  "id": "run_20260209_abc123",
  "workflowId": "feature-dev",
  "workflowVersion": 2,
  "taskId": "US-42",
  "status": "completed",
  "currentStep": null,
  "context": {
    "task": { "id": "US-42", "title": "..." },
    "plan": { "stories": [...] },
    "implement": { "changes": "..." }
  },
  "startedAt": "2026-02-09T12:00:00Z",
  "completedAt": "2026-02-09T12:45:00Z",
  "lastCheckpoint": "2026-02-09T12:45:00Z",
  "steps": [
    {
      "stepId": "plan",
      "status": "completed",
      "agent": "planner",
      "sessionKey": "session_xyz",
      "startedAt": "2026-02-09T12:00:00Z",
      "completedAt": "2026-02-09T12:10:00Z",
      "duration": 600,
      "retries": 0,
      "output": ".veritas-kanban/workflow-runs/run_20260209_abc123/step-outputs/plan.yml"
    },
    {
      "stepId": "implement",
      "status": "completed",
      "agent": "developer",
      "startedAt": "2026-02-09T12:10:00Z",
      "completedAt": "2026-02-09T12:35:00Z",
      "duration": 1500,
      "retries": 1,
      "output": ".veritas-kanban/workflow-runs/run_20260209_abc123/step-outputs/implement-0.md",
      "loopState": {
        "totalIterations": 5,
        "currentIteration": 5,
        "completedIterations": 5,
        "failedIterations": 0
      }
    }
  ]
}
```

**Status Codes**:

- `200 OK` — Success
- `404 Not Found` — Run not found
- `403 Forbidden` — No view permission

**Permissions**: Requires `view` permission on the workflow.

---

### GET /api/workflow-runs/active

Get currently running workflow runs only.

**Request**:

```bash
curl http://localhost:3001/api/workflow-runs/active
```

**Response**:

```json
[
  {
    "id": "run_20260209_def456",
    "workflowId": "security-audit",
    "workflowVersion": 1,
    "status": "running",
    "currentStep": "fix",
    "startedAt": "2026-02-09T13:00:00Z",
    "stepsCompleted": 2,
    "stepsTotal": 5
  }
]
```

**Status Codes**:

- `200 OK` — Success

**Permissions**: Filtered by workflow `view` permissions.

**Notes**: Returns metadata only (not full run state).

---

### GET /api/workflow-runs/stats

Get aggregated workflow statistics for a given period.

**Query Parameters**:

- `period` (string, optional) — Period for stats: `24h`, `7d`, `30d` (default: `7d`)

**Request**:

```bash
curl "http://localhost:3001/api/workflow-runs/stats?period=7d"
```

**Response**:

```json
{
  "period": "7d",
  "totalWorkflows": 5,
  "activeRuns": 2,
  "completedRuns": 42,
  "failedRuns": 8,
  "avgDuration": 1800000,
  "successRate": 0.84,
  "perWorkflow": [
    {
      "workflowId": "feature-dev",
      "workflowName": "Feature Development Workflow",
      "runs": 25,
      "completed": 20,
      "failed": 5,
      "successRate": 0.8,
      "avgDuration": 1800000
    },
    {
      "workflowId": "security-audit",
      "workflowName": "Security Audit & Remediation",
      "runs": 17,
      "completed": 15,
      "failed": 2,
      "successRate": 0.88,
      "avgDuration": 900000
    }
  ]
}
```

**Field Descriptions**:

- `avgDuration` — Average duration in milliseconds
- `successRate` — Decimal (0.0 to 1.0) representing percentage
- `perWorkflow` — Per-workflow breakdown

**Status Codes**:

- `200 OK` — Success
- `400 Bad Request` — Invalid period value

**Permissions**: Filtered by workflow `view` permissions.

---

### POST /api/workflow-runs/:id/resume

Resume a blocked workflow run (after human approval or escalation).

**Request**:

```bash
curl -X POST http://localhost:3001/api/workflow-runs/run_20260209_abc123/resume \
  -H "Content-Type: application/json" \
  -d '{
    "context": {
      "reviewerComments": "Looks good, proceed"
    }
  }'
```

**Request Body**:

```typescript
{
  context?: Record<string, unknown>;  // Optional: Additional context for resume
}
```

**Response**:

```json
{
  "id": "run_20260209_abc123",
  "workflowId": "feature-dev",
  "status": "running",
  "currentStep": "deploy",
  ...
}
```

**Status Codes**:

- `200 OK` — Run resumed successfully
- `400 Bad Request` — Run not blocked (current status: running/completed/failed)
- `404 Not Found` — Run not found
- `403 Forbidden` — No execute permission

**Permissions**: Requires `execute` permission on the workflow.

**Notes**:

- Only runs with status `blocked` can be resumed
- Workflow execution continues from where it left off
- Context can be updated during resume

---

## Gate Operations

### POST /api/workflow-runs/:runId/steps/:stepId/approve

Approve a gate step (allows workflow to continue).

**Request**:

```bash
curl -X POST http://localhost:3001/api/workflow-runs/run_20260209_abc123/steps/quality-gate/approve
```

**Response**:

```json
{
  "id": "run_20260209_abc123",
  "workflowId": "feature-dev",
  "status": "running",
  "context": {
    "_gateApproval": {
      "stepId": "quality-gate",
      "approved": true,
      "approvedBy": "user-123",
      "approvedAt": "2026-02-09T14:00:00Z"
    }
  },
  ...
}
```

**Status Codes**:

- `200 OK` — Gate approved, run resumed
- `400 Bad Request` — Step not awaiting approval or not a gate step
- `404 Not Found` — Run or step not found
- `403 Forbidden` — No execute permission

**Permissions**: Requires `execute` permission on the workflow.

**Notes**:

- Only works for steps with `type: gate` and status `failed`
- Approval context is added to run context
- Workflow continues execution

---

### POST /api/workflow-runs/:runId/steps/:stepId/reject

Reject a gate step (marks workflow as failed).

**Request**:

```bash
curl -X POST http://localhost:3001/api/workflow-runs/run_20260209_abc123/steps/quality-gate/reject
```

**Response**:

```json
{
  "id": "run_20260209_abc123",
  "workflowId": "feature-dev",
  "status": "failed",
  "error": "Step quality-gate rejected by user-123",
  "completedAt": "2026-02-09T14:00:00Z",
  ...
}
```

**Status Codes**:

- `200 OK` — Gate rejected, run marked as failed
- `400 Bad Request` — Step not awaiting approval or not a gate step
- `404 Not Found` — Run or step not found
- `403 Forbidden` — No execute permission

**Permissions**: Requires `execute` permission on the workflow.

---

### GET /api/workflow-runs/:runId/steps/:stepId/status

Get detailed status of a specific step (useful for parallel sub-steps).

**Request**:

```bash
curl http://localhost:3001/api/workflow-runs/run_20260209_abc123/steps/implement/status
```

**Response**:

```json
{
  "stepId": "implement",
  "status": "completed",
  "agent": "developer",
  "sessionKey": "session_xyz",
  "startedAt": "2026-02-09T12:10:00Z",
  "completedAt": "2026-02-09T12:35:00Z",
  "duration": 1500,
  "retries": 1,
  "output": ".veritas-kanban/workflow-runs/run_20260209_abc123/step-outputs/implement-0.md",
  "loopState": {
    "totalIterations": 5,
    "currentIteration": 5,
    "completedIterations": 5,
    "failedIterations": 0
  }
}
```

**Status Codes**:

- `200 OK` — Success
- `404 Not Found` — Run or step not found
- `403 Forbidden` — No view permission

**Permissions**: Requires `view` permission on the workflow.

---

## Tool Policies

### GET /api/tool-policies

List all tool policies (default + custom).

**Request**:

```bash
curl http://localhost:3001/api/tool-policies
```

**Response**:

```json
[
  {
    "role": "planner",
    "allowed": ["read", "web_search", "web_fetch", "browser", "image", "nodes"],
    "denied": ["write", "edit", "exec", "message"],
    "description": "Analysis and planning — read-only access"
  },
  {
    "role": "developer",
    "allowed": ["*"],
    "denied": [],
    "description": "Feature implementation — full access"
  },
  {
    "role": "custom-auditor",
    "allowed": ["read", "web_search"],
    "denied": ["exec", "write", "edit"],
    "description": "Security auditor — read-only with web access"
  }
]
```

**Status Codes**:

- `200 OK` — Success

**Permissions**: Public (no authentication required).

---

### GET /api/tool-policies/:role

Get a specific tool policy by role.

**Request**:

```bash
curl http://localhost:3001/api/tool-policies/planner
```

**Response**:

```json
{
  "role": "planner",
  "allowed": ["read", "web_search", "web_fetch", "browser", "image", "nodes"],
  "denied": ["write", "edit", "exec", "message"],
  "description": "Analysis and planning — read-only access"
}
```

**Status Codes**:

- `200 OK` — Success
- `404 Not Found` — Policy not found

**Permissions**: Public.

---

### POST /api/tool-policies

Create a new custom tool policy.

**Request**:

```bash
curl -X POST http://localhost:3001/api/tool-policies \
  -H "Content-Type: application/json" \
  -d '{
    "role": "custom-auditor",
    "allowed": ["read", "web_search", "web_fetch", "browser"],
    "denied": ["exec", "write", "edit"],
    "description": "Security auditor — read-only with web access"
  }'
```

**Request Body**:

```typescript
{
  role: string;              // Required: role name (alphanumeric + dash/underscore, max 50 chars)
  allowed: string[];         // Required: tool names (use '*' for all tools)
  denied: string[];          // Required: tool names (takes precedence over allowed)
  description: string;       // Required: what this role does (max 500 chars)
}
```

**Response**:

```json
{
  "success": true,
  "role": "custom-auditor"
}
```

**Status Codes**:

- `201 Created` — Policy created successfully
- `400 Bad Request` — Validation error
- `409 Conflict` — Role already exists

**Permissions**: Any authenticated user can create custom policies.

**Validation**:

- `role`: Required, alphanumeric + dash/underscore, max 50 characters
- `allowed`: Required array, max 100 tools
- `denied`: Required array (can be empty), max 100 tools
- `description`: Required, max 500 characters
- Cannot use reserved role names (planner, developer, reviewer, tester, deployer)

---

### PUT /api/tool-policies/:role

Update an existing tool policy (including defaults).

**Request**:

```bash
curl -X PUT http://localhost:3001/api/tool-policies/custom-auditor \
  -H "Content-Type: application/json" \
  -d '{
    "role": "custom-auditor",
    "allowed": ["read", "web_search"],
    "denied": ["exec", "write", "edit", "message"],
    "description": "Updated auditor policy"
  }'
```

**Response**:

```json
{
  "success": true,
  "role": "custom-auditor"
}
```

**Status Codes**:

- `200 OK` — Policy updated successfully
- `400 Bad Request` — Validation error or role mismatch
- `404 Not Found` — Policy not found

**Permissions**: Any authenticated user can update policies.

**Notes**: Default policies can be edited but not deleted.

---

### DELETE /api/tool-policies/:role

Delete a custom tool policy.

**Request**:

```bash
curl -X DELETE http://localhost:3001/api/tool-policies/custom-auditor
```

**Response**:

```
(Empty body, 204 status)
```

**Status Codes**:

- `204 No Content` — Policy deleted successfully
- `400 Bad Request` — Cannot delete default policy
- `404 Not Found` — Policy not found

**Permissions**: Any authenticated user can delete custom policies.

**Notes**: Default policies (planner, developer, reviewer, tester, deployer) cannot be deleted.

---

### POST /api/tool-policies/:role/validate

Validate if a specific tool is allowed for a role.

**Request**:

```bash
curl -X POST http://localhost:3001/api/tool-policies/planner/validate \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "exec"
  }'
```

**Request Body**:

```typescript
{
  tool: string; // Required: tool name to validate
}
```

**Response**:

```json
{
  "role": "planner",
  "tool": "exec",
  "allowed": false,
  "reason": "Tool 'exec' is in the denied list"
}
```

**Status Codes**:

- `200 OK` — Success
- `404 Not Found` — Policy not found

**Permissions**: Public.

---

## Sandbox Policies

Workflow agents can set `sandboxPresetId` to select a sandbox policy preset for
that role. The workflow executor dry-runs the preset against the selected
provider before launching the step. Required unsupported controls block the
step before execution and write a `sandbox-policy` governance trace; advisory
unsupported controls continue with warnings.

Use `/api/sandbox-policies/validate` to preflight a workflow agent's preset in
the authoring UI or custom automation. Presets can also be assigned visually in
the workflow authoring panel.

Sandbox policies are complementary to tool policies:

- Tool policies decide which Veritas/OpenClaw tools a workflow role may use.
- Sandbox policies decide what the underlying provider process may access at
  launch time: filesystem paths, network egress, environment variables, and
  credentials.

---

## Budget Policies

Workflow definitions can set `config.budget` for workflow-wide defaults and
`agents[].budget` for stricter role-specific caps. Launch callers can also pass
a stricter `budget` override to `POST /api/workflows/:id/runs`.

Supported budget limits:

- `totalTokens`, `inputTokens`, and `outputTokens`
- `costUsd`
- `toolCalls`
- `runtimeSeconds` and `idleRuntimeSeconds`
- `retries`
- `fanOut`

Budget evaluation is policy enforcement, not dashboard-only analytics. Soft
thresholds create visible warnings and `budget-policy` governance traces. Hard
thresholds enforce the configured action:

- `pause` or `require-approval` blocks the workflow run for operator review.
- `downgrade` records a routed decision and applies `downgradeModel` to Codex
  workflow steps.
- `cancel` fails the run immediately.

The run record includes `budget.usage`, `budget.thresholdEvents`, `budget.traceIds`,
and `budget.modelOverride` so run detail, timelines, and completion packets can
show exactly what happened.

---

## Task Dependencies

### GET /api/tasks/:id/dependencies

Get the full dependency graph for a task (recursive tree traversal).

**Request**:

```bash
curl http://localhost:3001/api/tasks/US-42/dependencies
```

**Response**:

```json
{
  "task": "US-42",
  "depends_on": [
    {
      "id": "US-40",
      "title": "Create database schema",
      "status": "done",
      "depends_on": []
    },
    {
      "id": "US-41",
      "title": "Implement auth middleware",
      "status": "in-progress",
      "depends_on": [
        {
          "id": "US-39",
          "title": "Setup JWT library",
          "status": "done",
          "depends_on": []
        }
      ]
    }
  ],
  "blocks": [
    {
      "id": "US-43",
      "title": "Add user permissions",
      "status": "todo",
      "blocks": []
    }
  ]
}
```

**Status Codes**:

- `200 OK` — Success
- `404 Not Found` — Task not found
- `400 Bad Request` — Circular dependency detected

**Notes**:

- Returns recursive tree with all upstream (depends_on) and downstream (blocks) dependencies
- Cycle detection prevents infinite loops
- Batch-loaded for performance (no N+1 queries)

---

### POST /api/tasks/:id/dependencies

Add a dependency to a task.

**Request**:

```bash
curl -X POST http://localhost:3001/api/tasks/US-42/dependencies \
  -H "Content-Type: application/json" \
  -d '{
    "dependsOn": "US-40",
    "direction": "depends_on"
  }'
```

**Request Body**:

```typescript
{
  dependsOn: string; // Required: task ID of the dependency
  direction: 'depends_on' | 'blocks'; // Required: direction of dependency
}
```

**Status Codes**:

- `200 OK` — Dependency added
- `400 Bad Request` — Would create circular dependency
- `404 Not Found` — Task not found

**Notes**:

- `depends_on`: This task depends on the specified task
- `blocks`: This task blocks the specified task
- Validates for cycles before adding

---

### DELETE /api/tasks/:id/dependencies/:dependencyId

Remove a dependency from a task.

**Request**:

```bash
curl -X DELETE http://localhost:3001/api/tasks/US-42/dependencies/US-40?direction=depends_on
```

**Query Parameters**:

- `direction` (required): `depends_on` or `blocks`

**Status Codes**:

- `200 OK` — Dependency removed
- `404 Not Found` — Task or dependency not found

---

## Crash-Recovery Checkpointing

### POST /api/tasks/:id/checkpoint

Save checkpoint state for a task.

**Request**:

```bash
curl -X POST http://localhost:3001/api/tasks/US-42/checkpoint \
  -H "Content-Type: application/json" \
  -d '{
    "state": {
      "current_step": 3,
      "completed": ["step1", "step2"],
      "api_key": "sk-1234567890",
      "context": "Working on user authentication"
    }
  }'
```

**Request Body**:

```typescript
{
  state: any; // Required: checkpoint state (auto-sanitized for secrets)
}
```

**Response**:

```json
{
  "success": true,
  "checkpoint": {
    "taskId": "US-42",
    "state": {
      "current_step": 3,
      "completed": ["step1", "step2"],
      "api_key": "[REDACTED]",
      "context": "Working on user authentication"
    },
    "createdAt": "2026-02-15T12:00:00Z",
    "expiresAt": "2026-02-16T12:00:00Z",
    "resumeCount": 0
  }
}
```

**Status Codes**:

- `200 OK` — Checkpoint saved
- `400 Bad Request` — State exceeds 1MB limit
- `404 Not Found` — Task not found

**Notes**:

- Auto-sanitizes 20+ secret patterns (API keys, tokens, passwords, etc.)
- 1MB size limit enforced
- 24h expiry with automatic cleanup
- Secrets are sanitized in response but preserved in file for resume

---

### GET /api/tasks/:id/checkpoint

Resume checkpoint state for a task.

**Request**:

```bash
curl http://localhost:3001/api/tasks/US-42/checkpoint
```

**Response**:

```json
{
  "success": true,
  "checkpoint": {
    "taskId": "US-42",
    "state": {
      "current_step": 3,
      "completed": ["step1", "step2"],
      "api_key": "[REDACTED]",
      "context": "Working on user authentication"
    },
    "createdAt": "2026-02-15T12:00:00Z",
    "expiresAt": "2026-02-16T12:00:00Z",
    "resumeCount": 1
  }
}
```

**Status Codes**:

- `200 OK` — Checkpoint retrieved (increments resumeCount)
- `404 Not Found` — Task or checkpoint not found
- `410 Gone` — Checkpoint expired

**Notes**:

- Each GET increments the resumeCount
- Secrets are sanitized in response
- Use for sub-agent context injection

---

### DELETE /api/tasks/:id/checkpoint

Clear checkpoint state for a task.

**Request**:

```bash
curl -X DELETE http://localhost:3001/api/tasks/US-42/checkpoint
```

**Status Codes**:

- `200 OK` — Checkpoint cleared
- `404 Not Found` — Task or checkpoint not found

---

## Observational Memory

### POST /api/observations

Add an observation to a task.

**Request**:

```bash
curl -X POST http://localhost:3001/api/observations \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "US-42",
    "type": "decision",
    "content": "Chose React Query over Redux for simpler data fetching and better caching",
    "importance": 8
  }'
```

**Request Body**:

```typescript
{
  taskId: string; // Required: task ID
  type: 'decision' | 'blocker' | 'insight' | 'context'; // Required
  content: string; // Required: observation text (XSS-sanitized)
  importance: number; // Required: 1-10 (1-3: low, 4-7: medium, 8-10: high)
}
```

**Response**:

```json
{
  "success": true,
  "observation": {
    "id": "obs_abc123",
    "taskId": "US-42",
    "type": "decision",
    "content": "Chose React Query over Redux for simpler data fetching and better caching",
    "importance": 8,
    "createdAt": "2026-02-15T12:00:00Z",
    "createdBy": "veritas"
  }
}
```

**Status Codes**:

- `201 Created` — Observation added
- `400 Bad Request` — Invalid type or importance score
- `404 Not Found` — Task not found

**Notes**:

- Content is XSS-sanitized (strips script tags, dangerous attributes)
- Activity log entry created automatically

---

### GET /api/tasks/:id/observations

Get all observations for a task.

**Request**:

```bash
curl http://localhost:3001/api/tasks/US-42/observations
```

**Response**:

```json
{
  "success": true,
  "observations": [
    {
      "id": "obs_abc123",
      "taskId": "US-42",
      "type": "decision",
      "content": "Chose React Query over Redux",
      "importance": 8,
      "createdAt": "2026-02-15T12:00:00Z",
      "createdBy": "veritas"
    },
    {
      "id": "obs_def456",
      "taskId": "US-42",
      "type": "blocker",
      "content": "Waiting on API key from ops team",
      "importance": 6,
      "createdAt": "2026-02-15T13:00:00Z",
      "createdBy": "codex"
    }
  ]
}
```

**Status Codes**:

- `200 OK` — Success
- `404 Not Found` — Task not found

---

### GET /api/observations/search

Full-text search across all observations for all tasks.

**Request**:

```bash
curl "http://localhost:3001/api/observations/search?query=react+query&limit=10&offset=0"
```

**Query Parameters**:

- `query` (required): search terms (full-text search)
- `limit` (optional): max results per page (default: 50, max: 200)
- `offset` (optional): pagination offset (default: 0)

**Response**:

```json
{
  "success": true,
  "results": [
    {
      "id": "obs_abc123",
      "taskId": "US-42",
      "taskTitle": "Implement user authentication",
      "type": "decision",
      "content": "Chose React Query over Redux for simpler data fetching",
      "importance": 8,
      "createdAt": "2026-02-15T12:00:00Z",
      "createdBy": "veritas"
    }
  ],
  "total": 1,
  "limit": 10,
  "offset": 0
}
```

**Status Codes**:

- `200 OK` — Success
- `400 Bad Request` — Missing query or invalid limit/offset

**Notes**:

- Searches across all tasks
- Results include task title for context
- Max 200 results per page

---

### DELETE /api/observations/:id

Delete an observation.

**Request**:

```bash
curl -X DELETE http://localhost:3001/api/observations/obs_abc123
```

**Status Codes**:

- `200 OK` — Observation deleted
- `404 Not Found` — Observation not found

**Notes**:

- Activity log entry created automatically

---

## Agent Filter

### GET /api/tasks?agent=:name

Filter tasks by assigned agent name.

**Request**:

```bash
curl "http://localhost:3001/api/tasks?agent=codex"
```

**Query Parameters**:

- `agent` (optional): agent name (trimmed, max 100 chars)
- `status` (optional): filter by status (todo, in-progress, blocked, done)
- `limit` (optional): max results (default: 100)
- `offset` (optional): pagination offset (default: 0)

**Response**:

```json
{
  "success": true,
  "tasks": [
    {
      "id": "US-42",
      "title": "Implement user authentication",
      "status": "in-progress",
      "agents": ["codex"],
      "priority": "high",
      "type": "feature"
    },
    {
      "id": "US-45",
      "title": "Add input validation",
      "status": "todo",
      "agents": ["codex", "veritas"],
      "priority": "medium",
      "type": "code"
    }
  ],
  "total": 2
}
```

**Status Codes**:

- `200 OK` — Success

**Notes**:

- Agent name is case-insensitive and trimmed
- Works with existing pagination and filters
- Returns tasks where the agent is in the `agents[]` array

---

## WebSocket Events

All workflow state changes are broadcast via WebSocket for real-time UI updates.

**Connection**:

```javascript
const ws = new WebSocket('ws://localhost:3001/ws');

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Event:', message.type, message.data);
};
```

### workflow:started

Emitted when a workflow run starts.

**Payload**:

```json
{
  "type": "workflow:started",
  "data": {
    "id": "run_20260209_abc123",
    "workflowId": "feature-dev",
    "status": "running",
    "startedAt": "2026-02-09T12:00:00Z",
    ...
  }
}
```

### workflow:step:started

Emitted when a step begins execution.

**Payload**:

```json
{
  "type": "workflow:step:started",
  "data": {
    "runId": "run_20260209_abc123",
    "stepId": "plan",
    "status": "running",
    "startedAt": "2026-02-09T12:00:00Z"
  }
}
```

### workflow:step:completed

Emitted when a step completes successfully.

**Payload**:

```json
{
  "type": "workflow:step:completed",
  "data": {
    "runId": "run_20260209_abc123",
    "stepId": "plan",
    "status": "completed",
    "completedAt": "2026-02-09T12:10:00Z",
    "duration": 600
  }
}
```

### workflow:step:failed

Emitted when a step fails.

**Payload**:

```json
{
  "type": "workflow:step:failed",
  "data": {
    "runId": "run_20260209_abc123",
    "stepId": "plan",
    "status": "failed",
    "error": "Acceptance criteria not met",
    "completedAt": "2026-02-09T12:10:00Z"
  }
}
```

### workflow:completed

Emitted when a workflow run completes (all steps succeeded).

**Payload**:

```json
{
  "type": "workflow:completed",
  "data": {
    "id": "run_20260209_abc123",
    "workflowId": "feature-dev",
    "status": "completed",
    "completedAt": "2026-02-09T12:45:00Z",
    "duration": 2700
  }
}
```

### workflow:failed

Emitted when a workflow run fails (step failed with no retry policy).

**Payload**:

```json
{
  "type": "workflow:failed",
  "data": {
    "id": "run_20260209_abc123",
    "workflowId": "feature-dev",
    "status": "failed",
    "error": "Step 'test' failed after 2 retries",
    "completedAt": "2026-02-09T12:30:00Z"
  }
}
```

### workflow:blocked

Emitted when a workflow run is blocked (waiting for human approval or gate).

**Payload**:

```json
{
  "type": "workflow:blocked",
  "data": {
    "id": "run_20260209_abc123",
    "workflowId": "feature-dev",
    "status": "blocked",
    "currentStep": "quality-gate",
    "error": "Quality gate failed — manual review required"
  }
}
```

### task:changed

Emitted when a task associated with a workflow run is updated (triggers counter/metrics refresh).

**Payload**:

```json
{
  "type": "task:changed",
  "data": {
    "taskId": "US-42",
    "status": "done",
    "workflowRunId": "run_20260209_abc123"
  }
}
```

### agent:status

Emitted when an agent's status changes (for multi-agent coordination).

**Payload**:

```json
{
  "type": "agent:status",
  "data": {
    "agent": "developer",
    "status": "working",
    "taskTitle": "Implement feature X",
    "workflowRunId": "run_20260209_abc123"
  }
}
```

---

## TypeScript Interfaces

### WorkflowDefinition

```typescript
export interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  description: string;
  config?: WorkflowConfig;
  agents: WorkflowAgent[];
  steps: WorkflowStep[];
  variables?: Record<string, unknown>;
  schemas?: Record<string, unknown>;
}
```

### WorkflowConfig

```typescript
export interface WorkflowConfig {
  timeout?: number; // seconds
  fresh_session_default?: boolean;
  progress_file?: string;
  telemetry_tags?: string[];
  budget?: AgentBudgetPolicy;
}
```

### WorkflowAgent

```typescript
export interface WorkflowAgent {
  id: string;
  name: string;
  role: string; // maps to tool policy
  sandboxPresetId?: string; // maps to a sandbox policy preset
  budget?: AgentBudgetPolicy; // stricter workflow-agent budget
  model?: string; // default model for this agent
  description: string;
  tools?: string[]; // tool restrictions (overrides role policy)
}
```

### WorkflowStep

```typescript
export type StepType = 'agent' | 'loop' | 'gate' | 'parallel';

export interface WorkflowStep {
  id: string;
  name: string;
  agent?: string; // agent ID (required for agent/loop steps)
  type: StepType;
  fresh_session?: boolean; // legacy: use session config instead
  session?: StepSessionConfig;
  input?: string; // template for agent prompt
  output?: StepOutput;
  acceptance_criteria?: string[];
  on_fail?: FailurePolicy;
  timeout?: number;

  // Loop-specific config
  loop?: LoopConfig;

  // Gate-specific config
  condition?: string; // expression evaluating to boolean
  on_false?: EscalationPolicy;

  // Parallel-specific config
  parallel?: ParallelConfig;
}
```

### StepOutput

```typescript
export interface StepOutput {
  file: string; // filename in step-outputs/
  schema?: string; // schema ID for validation
}
```

### FailurePolicy

```typescript
export interface FailurePolicy {
  retry?: number;
  retry_delay_ms?: number; // delay between retries
  retry_step?: string; // retry a different step ID
  escalate_to?: 'human' | `agent:${string}` | 'skip';
  escalate_message?: string;
  on_exhausted?: EscalationPolicy;
}
```

### EscalationPolicy

```typescript
export interface EscalationPolicy {
  escalate_to: 'human' | `agent:${string}` | 'skip';
  escalate_message?: string;
}
```

### LoopConfig

```typescript
export interface LoopConfig {
  over: string; // expression returning array
  item_var?: string; // variable name for current item
  index_var?: string; // variable name for loop index
  completion: 'all_done' | 'any_done' | 'first_success';
  fresh_session_per_iteration?: boolean;
  verify_each?: boolean;
  verify_step?: string; // step ID to run after each iteration
  max_iterations?: number;
  continue_on_error?: boolean; // if true, failed iterations don't fail the loop
}
```

### GateStepConfig

```typescript
export interface GateStepConfig {
  condition: string; // expression evaluating to boolean
  on_false: EscalationPolicy;
}
```

### ParallelConfig

```typescript
export interface ParallelConfig {
  steps: ParallelSubStep[]; // sub-steps to execute in parallel
  completion: 'all' | 'any' | number; // wait for all, any, or N sub-steps
  fail_fast?: boolean; // if true, abort others when one fails
  timeout?: number; // max time to wait (seconds)
}

export interface ParallelSubStep {
  id: string;
  agent: string;
  input: string; // template for sub-step input
  output?: StepOutput;
  timeout?: number;
}
```

### WorkflowRun

```typescript
export type WorkflowRunStatus = 'pending' | 'running' | 'blocked' | 'completed' | 'failed';

export interface WorkflowRun {
  id: string; // run_<timestamp>_<nanoid>
  workflowId: string;
  workflowVersion: number;
  taskId?: string; // optional task association
  status: WorkflowRunStatus;
  currentStep?: string; // current step ID
  context: Record<string, unknown>; // shared context across steps
  budget?: AgentBudgetState; // effective budget, usage, threshold events, traces
  startedAt: string;
  completedAt?: string;
  lastCheckpoint?: string; // last state persistence timestamp
  error?: string;
  steps: StepRun[];
}
```

### StepRun

```typescript
export type StepRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface StepRun {
  stepId: string;
  status: StepRunStatus;
  agent?: string;
  sessionKey?: string; // OpenClaw session key
  startedAt?: string;
  completedAt?: string;
  duration?: number; // seconds
  retries: number;
  output?: string; // path to output file
  error?: string;

  // Loop-specific state
  loopState?: {
    totalIterations: number;
    currentIteration: number;
    completedIterations: number;
    failedIterations: number;
  };
}
```

### ToolPolicy

```typescript
export interface ToolPolicy {
  role: string;
  allowed: string[]; // tool names (use '*' for all)
  denied: string[]; // tool names (takes precedence)
  description: string;
}
```

### StepSessionConfig

```typescript
export interface StepSessionConfig {
  mode: 'fresh' | 'reuse'; // fresh = new session, reuse = continue existing
  context: 'minimal' | 'full' | 'custom'; // how much context to pass
  cleanup: 'delete' | 'keep'; // delete session after step or keep
  timeout: number; // session timeout in seconds
  includeOutputsFrom?: string[]; // step names for 'custom' context
}
```

### WorkflowACL

```typescript
export type WorkflowPermission = 'view' | 'create' | 'edit' | 'delete' | 'execute';

export interface WorkflowACL {
  workflowId: string;
  owner: string; // user ID or 'system'
  editors: string[]; // users who can edit
  viewers: string[]; // users who can view
  executors: string[]; // users who can trigger runs
  isPublic: boolean; // anyone can view/execute
}
```

### WorkflowAuditEvent

```typescript
export interface WorkflowAuditEvent {
  timestamp: string;
  userId: string;
  action: 'create' | 'edit' | 'delete' | 'run';
  workflowId: string;
  workflowVersion?: number;
  changes?: Array<{ field: string; oldValue: unknown; newValue: unknown }>;
  runId?: string;
}
```

---

## Error Responses

All errors follow this structure:

```json
{
  "error": {
    "message": "Human-readable error message",
    "code": "ERROR_CODE",
    "details": {}
  }
}
```

### Status Codes

| Code  | Name                  | Description                                              |
| ----- | --------------------- | -------------------------------------------------------- |
| `400` | Bad Request           | Validation error, missing required fields, invalid input |
| `401` | Unauthorized          | Missing or invalid authentication                        |
| `403` | Forbidden             | No permission to perform action                          |
| `404` | Not Found             | Resource not found                                       |
| `409` | Conflict              | Resource already exists (e.g., workflow ID collision)    |
| `500` | Internal Server Error | Unexpected server error                                  |

### Common Errors

#### Validation Error

```json
{
  "error": {
    "message": "Workflow must define at least one agent",
    "code": "VALIDATION_ERROR",
    "details": {
      "field": "agents"
    }
  }
}
```

#### Not Found

```json
{
  "error": {
    "message": "Workflow feature-dev not found",
    "code": "NOT_FOUND",
    "details": {
      "workflowId": "feature-dev"
    }
  }
}
```

#### Permission Denied

```json
{
  "error": {
    "message": "No edit permission for workflow feature-dev",
    "code": "PERMISSION_DENIED",
    "details": {
      "workflowId": "feature-dev",
      "requiredPermission": "edit",
      "userId": "user-123"
    }
  }
}
```

#### Conflict

```json
{
  "error": {
    "message": "Workflow hello-world already exists",
    "code": "CONFLICT",
    "details": {
      "workflowId": "hello-world"
    }
  }
}
```

---

**End of API Reference**

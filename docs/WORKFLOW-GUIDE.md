# Veritas Kanban Workflow Engine — User Guide

**Version**: v3.0  
**Last Updated**: 2026-02-09  
**Status**: Production Ready

---

## Table of Contents

1. [Introduction](#introduction)
2. [Quick Start](#quick-start)
3. [Workflow YAML Format](#workflow-yaml-format)
4. [Step Configuration](#step-configuration)
5. [Tool Policies](#tool-policies)
6. [Session Management](#session-management)
7. [Monitoring & Dashboard](#monitoring--dashboard)
8. [Example Workflows](#example-workflows)
9. [API Quick Reference](#api-quick-reference)
10. [Troubleshooting](#troubleshooting)

---

## Introduction

### What is the Workflow Engine?

The Veritas Kanban workflow engine is a **deterministic multi-step agent orchestration system** that transforms VK from an ad-hoc task board into a **repeatable, observable, and reliable agent execution platform**.

Think of it as **GitHub Actions for AI agents** — YAML-defined pipelines that coordinate multiple agents, manage state, handle failures, and provide real-time observability.

### Why Use Workflows?

**Before workflows:**

- Ad-hoc agent execution with no repeatability
- No multi-agent coordination
- Agents repeat the same mistakes
- No visibility into progress
- Hard to debug failures

**With workflows:**

- Version-controlled YAML pipelines
- Coordinated agent handoffs with context passing
- Retry and escalation policies
- Real-time WebSocket status updates
- Step-by-step execution logs
- Reusable workflow library

### Key Capabilities

- ✅ **Sequential Execution** — Steps run in order with context passing
- ✅ **Loop Steps** — Iterate over collections (stories, subtasks, test cases)
- ✅ **Gate Steps** — Block execution until conditions are met or approval granted
- ✅ **Parallel Steps** — Execute multiple sub-steps concurrently
- ✅ **Retry Policies** — Automatic retries with configurable delays
- ✅ **Tool Restrictions** — Limit which tools each agent can use
- ✅ **Session Isolation** — Fresh context per step to prevent context bleed
- ✅ **Real-Time Updates** — WebSocket broadcasts for live progress
- ✅ **Dashboard** — Monitor active runs, success rates, and historical trends

### Prerequisites

- Veritas Kanban v3.0+ installed and running
- OpenClaw configured with agent models
- Basic understanding of YAML syntax
- Familiarity with VK task management

---

## Quick Start

### Step 1: Create Your First Workflow

Create a file `.veritas-kanban/workflows/hello-world.yml`:

```yaml
id: hello-world
name: Hello World Workflow
version: 1
description: A simple 2-step workflow to test the engine.

agents:
  - id: writer
    name: Writer
    role: developer
    model: github-copilot/claude-sonnet-4.5
    description: Writes hello world messages

steps:
  - id: greet
    name: 'Step 1: Greet user'
    type: agent
    agent: writer
    input: |
      Write a friendly hello world message.
      Reply with:
      MESSAGE: <your greeting>
    output:
      file: greeting.md
    acceptance_criteria:
      - 'MESSAGE:'
    on_fail:
      retry: 2
      escalate_to: human

  - id: farewell
    name: 'Step 2: Say goodbye'
    type: agent
    agent: writer
    input: |
      Write a farewell message.
      Previous greeting: {{steps.greet.output}}
      Reply with:
      MESSAGE: <your goodbye>
    output:
      file: farewell.md
    acceptance_criteria:
      - 'MESSAGE:'
```

### Step 2: Run the Workflow via API

```bash
# Start a workflow run
curl -X POST http://localhost:3001/api/workflows/hello-world/runs \
  -H "Content-Type: application/json" \
  -d '{}'

# Response:
# {
#   "id": "run_20260209_abc123",
#   "workflowId": "hello-world",
#   "status": "running",
#   "startedAt": "2026-02-09T12:00:00Z",
#   ...
# }
```

### Step 3: View Progress in the UI

1. Open Veritas Kanban in your browser
2. Navigate to **Workflows** tab (header navigation)
3. Click on "Hello World Workflow"
4. You'll see your active run with real-time step progress

---

## Workflow YAML Format

### Schema Overview

Every workflow YAML file has this structure:

```yaml
# ==================== Metadata ====================
id: <unique-workflow-id> # Required: alphanumeric + dashes
name: <human-readable-name> # Required: display name
version: <integer> # Required: starts at 1, auto-incremented on edit
description: | # Required: multi-line description
  What this workflow does and when to use it.

# ==================== Global Configuration ====================
config:
  timeout: 7200 # Max workflow duration (seconds, default: 2 hours)
  fresh_session_default: true # All steps spawn fresh sessions unless overridden
  progress_file: progress.md # Shared progress file (default: progress.md)
  telemetry_tags: ['workflow', 'feature-dev'] # Tags for telemetry events

# ==================== Agent Definitions ====================
agents:
  - id: <agent-id> # Required: unique within workflow
    name: <agent-name> # Required: display name
    role: <role-slug> # Required: maps to tool policy
    model: <model-identifier> # Optional: default model for this agent
    tools: [read, write, exec] # Optional: tool restrictions (overrides role policy)
    description: <agent-purpose> # Required: what this agent does

# ==================== Sequential Steps ====================
steps:
  - id: <step-id> # Required: unique within workflow
    name: <step-name> # Required: display name
    type: agent # Required: agent | loop | gate | parallel
    agent: <agent-id> # Required for agent/loop steps

    # Step execution
    input: | # Template for agent prompt (supports {{variables}})
      Task description here...

    output:
      file: <filename>.md # Output filename (saved in step-outputs/)
      schema: <schema-id> # Optional: JSON schema for validation

    # Validation
    acceptance_criteria:
      - 'Required string in output'
      - '/regex pattern/i'
      - 'json.path == "value"'

    # Error handling
    on_fail:
      retry: 2 # Max retries for this step
      retry_delay_ms: 5000 # Delay between retries (ms)
      retry_step: <other-step-id> # Jump back to another step
      escalate_to: human # human | agent:<id> | skip
      escalate_message: '...' # Message shown on escalation

    # Advanced configuration
    timeout: 600 # Step timeout (seconds, overrides global)
    session: # Session management (see Session Management section)
      mode: fresh
      context: minimal
      cleanup: delete
      timeout: 300

# ==================== Variables (Optional) ====================
variables:
  repo_path: '/path/to/repo'
  base_branch: 'main'

# ==================== Output Schemas (Optional) ====================
schemas:
  plan_output:
    type: object
    required: [stories]
    properties:
      stories:
        type: array
```

### Metadata Fields

| Field         | Type    | Required | Description                                                       |
| ------------- | ------- | -------- | ----------------------------------------------------------------- |
| `id`          | string  | ✅       | Unique workflow identifier (alphanumeric + dashes, max 100 chars) |
| `name`        | string  | ✅       | Human-readable name (max 200 chars)                               |
| `version`     | integer | ✅       | Version number (starts at 1, auto-incremented on edit)            |
| `description` | string  | ✅       | What the workflow does (max 2000 chars, supports multi-line)      |

### Config Fields

| Field                   | Type    | Default       | Description                                          |
| ----------------------- | ------- | ------------- | ---------------------------------------------------- |
| `timeout`               | integer | 7200          | Max workflow duration in seconds (2 hours default)   |
| `fresh_session_default` | boolean | true          | Spawn fresh sessions for all steps unless overridden |
| `progress_file`         | string  | `progress.md` | Shared progress file name                            |
| `telemetry_tags`        | array   | `[]`          | Tags for telemetry events (for analytics)            |

### Agent Fields

| Field         | Type   | Required | Description                                            |
| ------------- | ------ | -------- | ------------------------------------------------------ |
| `id`          | string | ✅       | Unique agent ID within workflow                        |
| `name`        | string | ✅       | Display name for the agent                             |
| `role`        | string | ✅       | Role slug (maps to tool policy)                        |
| `model`       | string | ❌       | Default model (e.g., `github-copilot/claude-opus-4.6`) |
| `tools`       | array  | ❌       | Tool restrictions (overrides role policy)              |
| `description` | string | ✅       | What this agent does                                   |

### Step Types

#### Agent Step

Run a single AI agent to complete a task.

```yaml
- id: implement
  name: 'Implement feature'
  type: agent
  agent: developer
  input: |
    Implement {{task.title}}
    Requirements: {{task.description}}
  output:
    file: implementation.md
  acceptance_criteria:
    - 'STATUS: done'
  on_fail:
    retry: 2
```

#### Loop Step

Iterate over a collection and execute an action for each item.

```yaml
- id: process-stories
  name: 'Process each story'
  type: loop
  agent: developer
  loop:
    over: '{{plan.stories}}' # Array to iterate over
    item_var: story # Variable name for current item
    index_var: index # Variable name for loop index
    completion: all_done # all_done | any_done | first_success
    fresh_session_per_iteration: true # New session per iteration
    verify_each: true # Run verify step after each iteration
    verify_step: verify # Step ID to run for verification
    max_iterations: 20 # Safety limit
    continue_on_error: false # If true, skip failed iterations
  input: |
    Implement story {{loop.index + 1}}/{{loop.total}}:
    {{story.title}}
```

**Loop Completion Modes:**

- `all_done` — All iterations must complete successfully
- `any_done` — Stop after first successful iteration
- `first_success` — Stop immediately when one succeeds

#### Gate Step

Block execution until a condition is met or manual approval granted.

```yaml
- id: quality-gate
  name: 'Quality Check'
  type: gate
  condition: '{{test.status == "passed" and verify.decision == "approved"}}'
  on_false:
    escalate_to: human
    escalate_message: 'Quality gate failed — manual review required'
```

**Condition Syntax:**

- Variable access: `{{variable}}`
- Equality: `{{a == "value"}}`
- Boolean AND: `{{a == "x" and b == "y"}}`
- Boolean OR: `{{a == "x" or b == "y"}}`

#### Parallel Step

Execute multiple sub-steps concurrently.

```yaml
- id: parallel-tests
  name: 'Run all test suites'
  type: parallel
  parallel:
    completion: all # all | any | N (number)
    fail_fast: true # Abort others when one fails
    timeout: 1800 # Max wait time (seconds)
    steps:
      - id: unit
        agent: tester
        input: 'Run unit tests'
      - id: integration
        agent: tester
        input: 'Run integration tests'
      - id: e2e
        agent: tester
        input: 'Run E2E tests'
```

---

## Step Configuration

### Acceptance Criteria

Acceptance criteria validate step outputs before marking the step as complete.

**Types of Criteria:**

1. **Substring Match** (default):

   ```yaml
   acceptance_criteria:
     - 'STATUS: done'
     - 'RESULT: success'
   ```

2. **Regex Pattern**:

   ```yaml
   acceptance_criteria:
     - '/^STATUS:\s*done$/i'
     - '/ERROR: \d+/'
   ```

3. **JSON Path Equality**:
   ```yaml
   acceptance_criteria:
     - 'output.decision == "approved"'
     - 'test.passed > 0'
   ```

> **📝 Note**: All criteria must pass for the step to succeed. If any criterion fails, the step is marked as failed.

### Session Management

Each step can control its OpenClaw session behavior:

```yaml
session:
  mode: fresh # fresh | reuse
  context: minimal # minimal | full | custom
  cleanup: delete # delete | keep
  timeout: 300 # seconds
  includeOutputsFrom: [step-1, step-2] # for context: custom
```

**Session Modes:**

| Mode    | Behavior                  | Use Case                                |
| ------- | ------------------------- | --------------------------------------- |
| `fresh` | New session per step      | Prevents context bleed (default)        |
| `reuse` | Continue existing session | Multi-turn conversation with same agent |

**Context Injection:**

| Mode      | What's Included                  | Use Case                   |
| --------- | -------------------------------- | -------------------------- |
| `minimal` | Task metadata + workflow context | Independent steps          |
| `full`    | All previous step outputs        | Steps needing full history |
| `custom`  | Explicit list of step outputs    | Surgical context control   |

**Cleanup Policies:**

| Mode     | Behavior                     | Use Case                     |
| -------- | ---------------------------- | ---------------------------- |
| `delete` | Terminate session after step | Production (saves resources) |
| `keep`   | Leave session running        | Development/debugging        |

**Example — Fresh Session with Minimal Context:**

```yaml
- id: review
  type: agent
  agent: reviewer
  session:
    mode: fresh
    context: minimal
    cleanup: delete
    timeout: 600
  input: |
    Review this code for security issues.
```

**Example — Reuse Session with Custom Context:**

```yaml
- id: fix
  type: agent
  agent: developer
  session:
    mode: reuse # Continue from previous developer session
    context: custom
    includeOutputsFrom: [plan, test] # Only include plan and test outputs
    cleanup: delete
  input: |
    Fix the issues found in testing.
```

### Error Handling

Configure retry and escalation behavior:

```yaml
on_fail:
  retry: 3 # Max retries
  retry_delay_ms: 10000 # 10 second delay between retries
  retry_step: implement # Jump back to implement step
  escalate_to: human # human | agent:<id> | skip
  escalate_message: 'Manual intervention required'
  on_exhausted:
    escalate_to: human
```

**Retry Strategies:**

1. **Same Step Retry** — Re-execute the failed step:

   ```yaml
   on_fail:
     retry: 3
     retry_delay_ms: 5000
   ```

2. **Different Step Retry** — Jump back to an earlier step:

   ```yaml
   on_fail:
     retry_step: implement
     max_retries: 2
   ```

3. **Escalation** — Delegate to another agent or human:

   ```yaml
   on_fail:
     escalate_to: human
     escalate_message: 'Step failed after 3 retries'
   ```

4. **Skip** — Continue with next step:
   ```yaml
   on_fail:
     escalate_to: skip
   ```

---

## Tool Policies

Tool policies define which tools each agent role can access, enabling least-privilege security.

### Default Policies

| Role        | Allowed Tools                                            | Denied Tools               | Use Case                             |
| ----------- | -------------------------------------------------------- | -------------------------- | ------------------------------------ |
| `planner`   | read, web_search, web_fetch, browser, image, nodes       | write, edit, exec, message | Analysis and planning — read-only    |
| `developer` | `*` (all tools)                                          | none                       | Feature implementation — full access |
| `reviewer`  | read, exec, web_search, web_fetch, browser, image, nodes | write, edit, message       | Code review — can run tests          |
| `tester`    | read, exec, browser, web_search, web_fetch, image, nodes | write, edit, message       | Testing — can interact with UIs      |
| `deployer`  | `*` (all tools)                                          | none                       | Deployment — full access             |

### Creating Custom Policies

**Via API:**

```bash
curl -X POST http://localhost:3001/api/tool-policies \
  -H "Content-Type: application/json" \
  -d '{
    "role": "auditor",
    "allowed": ["read", "web_search", "web_fetch", "browser"],
    "denied": ["exec", "write", "edit"],
    "description": "Security auditor — read-only with web access"
  }'
```

**Via UI:**

1. Open Settings → Tool Policies tab
2. Click "New Policy"
3. Fill in role name, allowed/denied tools, and description
4. Click "Create"

### Assigning Policies to Workflow Steps

Tool policies are assigned via the agent's `role` field:

```yaml
agents:
  - id: reviewer
    name: Code Reviewer
    role: reviewer # Maps to reviewer tool policy
    model: github-copilop/claude-opus-4.6
    description: Reviews code for quality and security

steps:
  - id: review
    agent: reviewer # Inherits tool policy from role
    input: |
      Review this pull request.
```

**Override Policy with Explicit Tools:**

```yaml
agents:
  - id: auditor
    name: Security Auditor
    role: reviewer # Base policy
    tools: [read, web_search] # Override: only these tools allowed
    description: Security-focused reviewer
```

> **⚠️ Security Note**: Denied tools always take precedence over allowed tools. Even if `*` is allowed, explicitly denied tools are blocked.

---

## Session Management

### Why Fresh Sessions Matter

**Problem**: Context window bloat. When agents reuse the same session across multiple steps, the conversation history grows unbounded, leading to:

- Slower response times
- Higher token costs
- Context window overflow errors
- Agents confusing outputs from different steps

**Solution**: Fresh sessions per step. Each step spawns a new isolated session with only the context it needs.

### Context Modes

#### Minimal Context

**What's included:**

- Task metadata (title, description, ID)
- Workflow-level variables
- Current step configuration

**When to use:**

- Independent steps that don't need history
- Steps early in the workflow (no previous outputs yet)
- Steps with large inputs (avoid context bloat)

**Example:**

```yaml
- id: scan
  session:
    context: minimal
  input: |
    Scan the codebase for security vulnerabilities.
```

#### Full Context

**What's included:**

- Task metadata
- Workflow-level variables
- All previous step outputs
- Progress file content

**When to use:**

- Steps that need comprehensive history
- Final steps that synthesize all previous work
- Debugging workflows (see everything)

**Example:**

```yaml
- id: summary
  session:
    context: full
  input: |
    Summarize all the work done in this workflow.
```

#### Custom Context

**What's included:**

- Task metadata
- Workflow-level variables
- Explicit list of step outputs

**When to use:**

- Surgical context control (only specific previous steps)
- Balance between minimal and full
- Avoid including irrelevant step outputs

**Example:**

```yaml
- id: deploy
  session:
    context: custom
    includeOutputsFrom: [build, test] # Only build and test outputs
  input: |
    Deploy the application based on build and test results.
```

### Cleanup Policies

#### Delete (Production)

Session is terminated immediately after step completes.

**Pros:**

- Saves resources (memory, token costs)
- Prevents orphaned sessions
- Production-ready default

**Cons:**

- Can't inspect session after step completes

```yaml
session:
  cleanup: delete
```

#### Keep (Development)

Session remains open after step completes for manual inspection.

**Pros:**

- Useful for debugging
- Can inspect agent's conversation history
- Can manually continue the session

**Cons:**

- Wastes resources if sessions accumulate
- Requires manual cleanup

```yaml
session:
  cleanup: keep
```

> **💡 Tip**: Use `cleanup: delete` in production workflows, `cleanup: keep` only during development.

### Timeout Configuration

Each step can override the global session timeout:

```yaml
config:
  timeout: 7200 # Global: 2 hours

steps:
  - id: quick-task
    session:
      timeout: 300 # Override: 5 minutes for this step
```

---

## Monitoring & Dashboard

### Accessing the Dashboard

1. Navigate to **Workflows** tab (header navigation)
2. Click **Dashboard** button

### Summary Cards

The dashboard displays six key metrics:

| Metric              | Description                                                   |
| ------------------- | ------------------------------------------------------------- |
| **Total Workflows** | Number of workflow definitions                                |
| **Active Runs**     | Currently executing workflow runs                             |
| **Completed Runs**  | Successfully finished runs (filterable by period: 24h/7d/30d) |
| **Failed Runs**     | Failed runs (filterable by period)                            |
| **Avg Duration**    | Average workflow run time                                     |
| **Success Rate**    | Completed / (Completed + Failed) × 100%                       |

### Active Runs Table

Real-time list of currently executing workflow runs:

- **Workflow ID** — Which workflow is running
- **Status Badge** — Running (blue)
- **Started** — When the run started
- **Duration** — Elapsed time (live updating)
- **Current Step** — Which step is executing
- **Progress** — Step X/Y with visual progress bar

**Click any run** to open detailed WorkflowRunView.

### Recent Runs History

Last 50 workflow runs with filters:

- **All** — Show all runs
- **Completed** — Only successful runs
- **Failed** — Only failed runs
- **Blocked** — Runs awaiting approval
- **Pending** — Runs not started yet

### Per-Workflow Health Metrics

Success rate and average duration for each workflow:

| Workflow       | Runs | Completed | Failed | Success Rate | Avg Duration |
| -------------- | ---- | --------- | ------ | ------------ | ------------ |
| feature-dev    | 25   | 20        | 5      | 80%          | 30m          |
| security-audit | 10   | 9         | 1      | 90%          | 15m          |

**Visual Indicators:**

- 🟢 Green: Success rate ≥ 80%
- 🟡 Yellow: Success rate 50-79%
- 🔴 Red: Success rate < 50%

### Real-Time Updates

The dashboard receives live updates via WebSocket:

- New runs appear instantly when started
- Step progress updates in real-time
- Summary metrics refresh on run completion
- Active runs table updates every 30 seconds

---

## Example Workflows

### Feature Development

Complete feature development pipeline: plan → implement → test → review → deploy.

````yaml
id: feature-dev
name: Feature Development Workflow
version: 1
description: End-to-end feature development pipeline.

config:
  timeout: 7200
  telemetry_tags: ['workflow', 'feature-dev']

agents:
  - id: planner
    name: Planner
    role: planner
    model: github-copilot/claude-opus-4.6
    description: Decomposes tasks into user stories

  - id: developer
    name: Developer
    role: developer
    model: github-copilot/claude-sonnet-4.5
    description: Implements features

  - id: tester
    name: Tester
    role: tester
    model: github-copilot/claude-sonnet-4.5
    description: Validates implementation

variables:
  repo_path: '{{task.git.worktreePath}}'
  base_branch: '{{task.git.baseBranch}}'
  test_command: 'npm test'

steps:
  - id: plan
    name: 'Plan: Decompose into stories'
    type: agent
    agent: planner
    input: |
      Decompose this task into 5-10 implementable user stories.

      TASK: {{task.title}}
      {{task.description}}

      Output YAML format:
      ```yaml
      stories:
        - id: story-1
          title: "..."
          acceptance_criteria: [...]
      ```
    output:
      file: plan.yml
    acceptance_criteria:
      - 'stories:'
      - 'acceptance_criteria'
    on_fail:
      retry: 2
      escalate_to: human
    timeout: 600

  - id: implement
    name: 'Implement: Execute stories'
    type: loop
    agent: developer
    loop:
      over: '{{plan.stories}}'
      item_var: story
      completion: all_done
      fresh_session_per_iteration: true
      max_iterations: 20
    input: |
      Implement this user story.

      STORY {{loop.index + 1}}/{{loop.total}}: {{story.title}}
      {{story.description}}

      ACCEPTANCE CRITERIA:
      {{story.acceptance_criteria}}

      REPO: {{repo_path}}
      TEST_CMD: {{test_command}}

      Instructions:
      1. Implement the feature
      2. Write tests
      3. Run {{test_command}} — tests must pass
      4. Commit changes

      Reply with:
      STATUS: done
      CHANGES: <what was implemented>
    output:
      file: 'implement-{{loop.index}}.md'
    acceptance_criteria:
      - 'STATUS: done'
    on_fail:
      retry: 2
    timeout: 1200

  - id: test
    name: 'Test: Integration validation'
    type: agent
    agent: tester
    input: |
      Run integration tests on the complete feature.

      REPO: {{repo_path}}
      TEST_CMD: {{test_command}}

      Instructions:
      1. Run full test suite
      2. Check for integration issues
      3. Verify end-to-end functionality

      Reply with:
      STATUS: done
      RESULTS: <test outcomes>
      ISSUES: <any bugs, or "none">
    output:
      file: test-results.md
    acceptance_criteria:
      - 'STATUS: done'
    on_fail:
      retry_step: implement
      max_retries: 2

  - id: gate
    name: 'Gate: Quality Check'
    type: gate
    condition: '{{test.status == "completed"}}'
    on_false:
      escalate_to: human
      escalate_message: 'Quality gate failed'
````

### Security Audit

Loop through security findings and fix each issue.

````yaml
id: security-audit
name: Security Audit & Remediation
version: 1
description: Scan for vulnerabilities, prioritize, and fix issues.

agents:
  - id: scanner
    name: Scanner
    role: planner
    description: Finds security vulnerabilities

  - id: fixer
    name: Fixer
    role: developer
    description: Fixes security issues

  - id: verifier
    name: Verifier
    role: tester
    description: Validates fixes

steps:
  - id: scan
    name: 'Scan: Find vulnerabilities'
    type: agent
    agent: scanner
    input: |
      Perform comprehensive security audit.

      Scan for:
      - SQL injection
      - XSS
      - CSRF
      - Path traversal
      - Secrets in code

      Output YAML:
      ```yaml
      vulnerabilities:
        - id: vuln-001
          severity: critical
          type: sql-injection
          file: server/routes/users.ts
          description: "..."
      ```
    output:
      file: scan-results.yml

  - id: fix
    name: 'Fix: Patch vulnerabilities'
    type: loop
    agent: fixer
    loop:
      over: '{{scan.vulnerabilities}}'
      item_var: vuln
      completion: all_done
      continue_on_error: false
    input: |
      Fix this vulnerability:

      ID: {{vuln.id}}
      SEVERITY: {{vuln.severity}}
      TYPE: {{vuln.type}}
      FILE: {{vuln.file}}

      Implement the fix and write a regression test.
    output:
      file: 'fix-{{loop.index}}.md'

  - id: verify
    name: 'Verify: Validate fixes'
    type: agent
    agent: verifier
    input: |
      Validate all security fixes are effective.
      Try to bypass each fix (adversarial testing).
````

### Code Review

Parallel multi-model review with gate approval.

```yaml
id: code-review
name: Multi-Model Code Review
version: 1
description: Get reviews from multiple models concurrently.

agents:
  - id: claude
    name: Claude Reviewer
    role: reviewer
    model: github-copilot/claude-opus-4.6

  - id: gpt
    name: GPT Reviewer
    role: reviewer
    model: github-copilot/gpt-5

  - id: gemini
    name: Gemini Reviewer
    role: reviewer
    model: github-copilot/gemini-2.5-pro

steps:
  - id: review
    name: 'Review: Multi-model analysis'
    type: parallel
    parallel:
      completion: all
      fail_fast: false
      steps:
        - id: claude-review
          agent: claude
          input: 'Review this PR for code quality and bugs'
        - id: gpt-review
          agent: gpt
          input: 'Review this PR for security and performance'
        - id: gemini-review
          agent: gemini
          input: 'Review this PR for architecture and design'

  - id: gate
    name: 'Gate: Approval Decision'
    type: gate
    condition: '{{review.failures == 0}}'
    on_false:
      escalate_to: human
      escalate_message: 'One or more reviews flagged issues'
```

---

## API Quick Reference

| Method   | Endpoint                                          | Description                  |
| -------- | ------------------------------------------------- | ---------------------------- |
| `GET`    | `/api/workflows`                                  | List all workflows           |
| `GET`    | `/api/workflows/:id`                              | Get workflow definition      |
| `POST`   | `/api/workflows`                                  | Create workflow              |
| `PUT`    | `/api/workflows/:id`                              | Update workflow              |
| `DELETE` | `/api/workflows/:id`                              | Delete workflow              |
| `POST`   | `/api/workflows/:id/runs`                         | Start workflow run           |
| `GET`    | `/api/workflow-runs`                              | List runs (supports filters) |
| `GET`    | `/api/workflow-runs/:id`                          | Get run details              |
| `GET`    | `/api/workflow-runs/active`                       | Get active runs only         |
| `GET`    | `/api/workflow-runs/stats`                        | Get aggregated stats         |
| `POST`   | `/api/workflow-runs/:id/resume`                   | Resume blocked run           |
| `POST`   | `/api/workflow-runs/:runId/steps/:stepId/approve` | Approve gate step            |
| `POST`   | `/api/workflow-runs/:runId/steps/:stepId/reject`  | Reject gate step             |
| `GET`    | `/api/workflow-runs/:runId/steps/:stepId/status`  | Get step status              |
| `GET`    | `/api/tool-policies`                              | List tool policies           |
| `GET`    | `/api/tool-policies/:role`                        | Get policy for role          |
| `POST`   | `/api/tool-policies`                              | Create custom policy         |
| `PUT`    | `/api/tool-policies/:role`                        | Update policy                |
| `DELETE` | `/api/tool-policies/:role`                        | Delete custom policy         |

**Full API documentation**: See [API-WORKFLOWS.md](./API-WORKFLOWS.md)

---

## Troubleshooting

### Common Errors

#### Error: "Workflow must define at least one agent"

**Cause**: Missing `agents` section in YAML.

**Fix**:

```yaml
agents:
  - id: developer
    name: Developer
    role: developer
    description: Implements features
```

#### Error: "Step references unknown agent"

**Cause**: Step's `agent` field references an agent ID that doesn't exist.

**Fix**: Ensure agent is defined in `agents` section:

```yaml
agents:
  - id: developer
    ...

steps:
  - id: implement
    agent: developer  # Must match an agent.id
```

#### Error: "retry_step references unknown step"

**Cause**: `on_fail.retry_step` references a step ID that doesn't exist.

**Fix**: Ensure referenced step exists:

```yaml
steps:
  - id: implement
    ...
  - id: test
    on_fail:
      retry_step: implement  # Must match a step.id
```

#### Error: "Run not blocked (current status: running)"

**Cause**: Attempting to resume a workflow that's not in `blocked` status.

**Fix**: Only resume runs with status `blocked` (workflows waiting for gate approval or human escalation).

### Debug Logging

Enable detailed workflow execution logs:

**Server logs** (stdout):

```bash
# Look for workflow-related log entries
tail -f server.log | grep workflow
```

**Run state files**:

```bash
# View run state
cat .veritas-kanban/workflow-runs/run_20260209_abc123/run.json

# View step outputs
ls -la .veritas-kanban/workflow-runs/run_20260209_abc123/step-outputs/
```

**Progress file**:

```bash
# View step-by-step progress
cat .veritas-kanban/workflow-runs/run_20260209_abc123/progress.md
```

### Run State Recovery

If the server crashes mid-workflow, runs can be recovered:

1. **Find orphaned runs**:

   ```bash
   ls -la .veritas-kanban/workflow-runs/
   # Look for runs with status "running"
   ```

2. **Inspect run state**:

   ```bash
   cat .veritas-kanban/workflow-runs/run_XYZ/run.json
   ```

3. **Resume manually** (if blocked):
   ```bash
   curl -X POST http://localhost:3001/api/workflow-runs/run_XYZ/resume
   ```

> **📝 Note**: Automatic recovery is planned for a future release.

### Performance Issues

#### Slow workflow execution

**Possible causes:**

- Large progress files (>10MB)
- Too many step outputs in context
- Network issues with OpenClaw API

**Solutions:**

1. Use `session.context: minimal` for independent steps
2. Limit `includeOutputsFrom` to only necessary steps
3. Check OpenClaw server health

#### High token costs

**Possible causes:**

- Using `session.context: full` on all steps
- Reusing sessions across many steps (context bloat)

**Solutions:**

1. Use `session.mode: fresh` (default)
2. Use `session.context: minimal` or `custom`
3. Monitor token usage in dashboard

### Getting Help

- **GitHub Issues**: [github.com/BradGroux/veritas-kanban/issues](https://github.com/BradGroux/veritas-kanban/issues)
- **Documentation**: Check other docs in `/docs/` directory
- **Examples**: See `.veritas-kanban/workflows/` for working examples

---

**End of User Guide**

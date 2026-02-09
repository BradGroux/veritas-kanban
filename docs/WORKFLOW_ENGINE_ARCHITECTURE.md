# Workflow Engine Architecture — Veritas Kanban v3.0

**Author**: TARS (sub-agent)  
**Created**: 2026-02-09  
**Revised**: 2026-02-09 (Codex review revision)  
**GitHub Issue**: [#107](https://github.com/BradGroux/veritas-kanban/issues/107)  
**Status**: Architecture Specification

---

## Revision History

### 2026-02-09 — Codex Review Revision (TARS)

Addressed issues identified in Ava's codex review:

**🟡 Important Issues Addressed:**

1. **Retry routing (`retry_step`) defined** — Added step queue refactor and retry routing semantics with state machine diagram
2. **Loop verification flags wired** — Added executor logic for `verify_each`, `verify_step`, and `completion:any_done`
3. **RBAC/auditing on workflow CRUD APIs** — Added access control model, audit logging, and workflow versioning strategy
4. **Retention and concurrency strategy** — Added retention policy, cleanup jobs, concurrency limits, and session cleanup
5. **WebSocket payloads aligned with frontend** — Ensured event payloads match React component expectations with full run state
6. **Antfarm parity gaps closed** — Added setup steps, step timeouts/watchdogs, and CLI parity commands

**🟢 Nice-to-Have Issues Addressed:** 7. **Acceptance criteria validation** — Added `StepOutputValidator` with regex/JSON Schema/custom functions 8. **Task payload injection** — Ensured workflow run context includes full task payload in initial context

All changes preserve backward compatibility with existing YAML schemas while expanding functionality.

---

## 1. Overview & Goals

### What the Workflow Engine Is

The Veritas Kanban workflow engine is a **deterministic multi-step agent orchestration system** inspired by CI/CD pipelines but designed specifically for AI agent workflows. It transforms VK from an ad-hoc task board into a **repeatable, observable, and reliable agent execution platform**.

Think of it as **GitHub Actions for AI agents** — YAML-defined pipelines that coordinate multiple agents, manage state, handle failures, and provide real-time observability.

### What It Is NOT

- **Not a general-purpose workflow engine** (like Temporal, Airflow) — optimized specifically for AI agents
- **Not a replacement for OpenClaw** — workflows invoke OpenClaw sessions, they don't replace them
- **Not a programming language** — workflows are declarative YAML, not imperative scripts
- **Not a task scheduler** — workflows run on-demand (triggered by task creation or manual start)

### Core Principles

1. **Deterministic Execution** — same workflow + same inputs = same execution path (modulo agent non-determinism)
2. **Agent-Agnostic** — workflows don't care which LLM/agent implementation runs steps (OpenClaw handles that)
3. **YAML-First** — workflows are version-controlled YAML files, not database records
4. **Observable** — every step logs outputs, status broadcasts via WebSocket, squad chat integration
5. **Fail-Safe** — explicit retry/escalation policies, no silent failures
6. **Fresh Context by Default** — each step spawns a fresh OpenClaw session (divergence from antfarm's Ralph loop pattern)

### How It Fits Into VK's Architecture

```
User creates task (optionally linked to a workflow)
  ↓
TaskService creates task.md
  ↓
Task detail panel shows "Run Workflow" button
  ↓
WorkflowRunService spawns workflow run
  ↓
WorkflowStepExecutor iterates steps:
  - Spawns OpenClaw session per step (sessions_spawn)
  - Waits for completion (sessions_wait_for)
  - Writes step output to .veritas-kanban/workflow-runs/<run-id>/step-outputs/<step-id>.md
  - Broadcasts status via WebSocket
  - Posts to squad chat
  ↓
Run completes → task status updated
```

**Integration points:**

- **Tasks**: workflows update task status, deliverables, time tracking
- **Squad chat**: agents post progress to squad chat during workflow execution
- **Telemetry**: workflow runs emit `run.started`, `run.completed`, token usage events
- **Progress files**: each step reads/writes progress.md for context passing

### What Problems It Solves

| Problem (Before)                          | Solution (After)                                  |
| ----------------------------------------- | ------------------------------------------------- |
| Ad-hoc agent execution — no repeatability | YAML workflows → version-controlled pipelines     |
| No multi-agent coordination               | Steps define agent handoffs with context passing  |
| Agents repeat mistakes                    | Retry/escalation policies + lessons learned       |
| No visibility into agent progress         | Real-time WebSocket status + squad chat narration |
| Hard to debug agent failures              | Step-by-step outputs persisted in workflow-runs/  |
| Can't reuse successful patterns           | Workflow library → copy/paste/adapt               |

---

## 2. YAML Workflow Schema

### Schema Overview

```yaml
id: <unique-workflow-id>
name: <human-readable-name>
version: <integer>
description: |
  Multi-line description of what this workflow does
  and when to use it.

# Global workflow configuration
config:
  timeout: 7200 # Max workflow duration in seconds (default: 2 hours)
  fresh_session_default: true # All steps spawn fresh sessions unless overridden
  progress_file: progress.md # Shared progress file (default: progress.md)
  telemetry_tags: ['workflow', 'feature-dev'] # Tags for telemetry events

# Agent definitions — who can run steps
agents:
  - id: planner
    name: Planner
    role: analysis # Role slug (maps to toolPolicy in #110)
    model: github-copilot/claude-opus-4.6 # Default model for this agent
    description: Decomposes tasks into user stories

  - id: developer
    name: Developer
    role: coding
    model: github-copilot/claude-sonnet-4.5
    description: Implements features

# Sequential steps (future: parallel steps)
steps:
  - id: plan
    name: 'Plan: Decompose task'
    agent: planner # Which agent runs this step
    type: agent # Step type: "agent" | "loop" | "gate" | "parallel"

    # Fresh session control (overrides global default)
    fresh_session: true

    # Input prompt template — Jinja2-style variable substitution
    input: |
      Decompose the following task into ordered user stories.

      TASK: {{task.title}}
      {{task.description}}

      Output YAML:
      stories:
        - id: story-1
          title: ...
          acceptance_criteria: [...]

    # Output configuration — what this step produces
    output:
      file: plan.yml # Written to step-outputs/plan.yml
      schema: plan_output # JSON schema for validation (optional)

    # Acceptance criteria — step not complete until these pass
    acceptance_criteria:
      - 'Output contains valid YAML'
      - 'At least 3 stories defined'
      - 'Each story has acceptance_criteria'

    # Retry/failure policy
    on_fail:
      retry: 2 # Max retries
      escalate_to: human # "human" | "agent:<agent-id>" | "skip"
      escalate_message: 'Planning failed — manual decomposition needed'

    # Timeout override (seconds)
    timeout: 600

  - id: implement
    name: 'Implement: Execute stories'
    agent: developer
    type: loop # Loop type — iterates over a collection

    loop:
      over: '{{plan.stories}}' # Iterate over plan output
      item_var: current_story # Variable name for current item
      completion: all_done # "all_done" | "any_done" | "first_success"
      fresh_session_per_iteration: true # New session for each story
      verify_each: true # Verify after each iteration
      verify_step: verify # Step ID to run for verification

    input: |
      Implement this user story.

      STORY: {{current_story.title}}
      {{current_story.description}}

      COMPLETED STORIES:
      {{loop.completed | join(", ")}}

      PROGRESS:
      {{progress}}

    output:
      file: 'implement-{{loop.index}}.md'

    on_fail:
      retry: 1
      escalate_to: human

  - id: verify
    name: 'Verify: Check implementation'
    agent: verifier
    type: agent

    input: |
      Verify the developer's work.

      STORY: {{current_story.title}}
      CHANGES: {{implement.output}}

      Check:
      - Code exists (not TODOs)
      - Acceptance criteria met
      - Tests pass

    output:
      file: 'verify-{{loop.index}}.md'

    # Gate behavior — if verification fails, retry the previous step
    on_fail:
      retry_step: implement # Retry a different step
      max_retries: 2
      on_exhausted:
        escalate_to: human

  - id: gate-check
    name: 'Gate: Quality Check'
    type: gate # Gate type — boolean decision point

    condition: |
      {{verify.decision == "approved" and test.status == "passed"}}

    on_false:
      escalate_to: human
      escalate_message: 'Quality gate failed — code review required'

# Variable definitions (accessible to all steps)
variables:
  repo_path: '/path/to/repo'
  base_branch: 'main'
  test_command: 'npm test'

# Output schema definitions (optional — for validation)
schemas:
  plan_output:
    type: object
    required: [stories]
    properties:
      stories:
        type: array
        items:
          type: object
          required: [id, title, acceptance_criteria]
```

### TypeScript Interfaces

```typescript
// Workflow Definition Types

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  description: string;
  config?: WorkflowConfig;
  agents: WorkflowAgent[];
  steps: WorkflowStep[];
  variables?: Record<string, any>;
  schemas?: Record<string, any>;
}

export interface WorkflowConfig {
  timeout?: number; // seconds
  fresh_session_default?: boolean;
  progress_file?: string;
  telemetry_tags?: string[];
}

export interface WorkflowAgent {
  id: string;
  name: string;
  role: string; // maps to toolPolicy
  model?: string; // default model for this agent
  description: string;
}

export type StepType = 'agent' | 'loop' | 'gate' | 'parallel';

export interface WorkflowStep {
  id: string;
  name: string;
  agent?: string; // agent ID (required for type=agent|loop)
  type: StepType;
  fresh_session?: boolean;
  input?: string; // Jinja2 template
  output?: StepOutput;
  acceptance_criteria?: string[];
  on_fail?: FailurePolicy;
  timeout?: number;

  // Loop-specific config
  loop?: LoopConfig;

  // Gate-specific config
  condition?: string; // Jinja2 expression evaluating to boolean
  on_false?: EscalationPolicy;
}

export interface StepOutput {
  file: string; // Filename in step-outputs/
  schema?: string; // Schema ID for validation
}

export interface FailurePolicy {
  retry?: number;
  retry_step?: string; // Retry a different step ID
  escalate_to?: 'human' | `agent:${string}` | 'skip';
  escalate_message?: string;
  on_exhausted?: EscalationPolicy;
}

export interface EscalationPolicy {
  escalate_to: 'human' | `agent:${string}` | 'skip';
  escalate_message?: string;
}

export interface LoopConfig {
  over: string; // Jinja2 expression returning array
  item_var?: string; // Variable name for current item (default: "item")
  index_var?: string; // Variable name for loop index (default: "index")
  completion: 'all_done' | 'any_done' | 'first_success';
  fresh_session_per_iteration?: boolean;
  verify_each?: boolean;
  verify_step?: string; // Step ID to run after each iteration
  max_iterations?: number;
}

// Workflow Run Types

export type WorkflowRunStatus = 'pending' | 'running' | 'blocked' | 'completed' | 'failed';
export type StepRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface WorkflowRun {
  id: string; // run_<timestamp>_<nanoid>
  workflowId: string;
  workflowVersion: number;
  taskId?: string; // Optional task association
  status: WorkflowRunStatus;
  currentStep?: string; // Current step ID
  context: Record<string, any>; // Shared context across steps
  startedAt: string;
  completedAt?: string;
  error?: string;
  steps: StepRun[];
}

export interface StepRun {
  stepId: string;
  status: StepRunStatus;
  agent?: string;
  sessionKey?: string; // OpenClaw session key
  startedAt?: string;
  completedAt?: string;
  duration?: number; // seconds
  retries: number;
  output?: string; // Path to output file
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

---

## 3. Retry Routing & Failure Handling

### 3.1 Retry Semantics

When a step fails, the `on_fail` policy determines what happens next. The workflow engine supports three retry strategies:

1. **Retry the same step** (`retry: N`) — Re-execute the failed step up to N times
2. **Retry a different step** (`retry_step: <step-id>`) — Jump back to a specific step and re-execute from there
3. **Escalate** (`escalate_to: human|agent:<id>|skip`) — Block the workflow, delegate to another agent, or skip

### 3.2 Retry Routing Implementation

**Problem**: The initial implementation used a simple `for` loop to iterate through steps sequentially. This doesn't support jumping back to a previous step when `retry_step` is specified.

**Solution**: Refactor the executor to use a **step queue** instead of a `for` loop:

```typescript
// WorkflowRunService.executeRun() — Refactored

private async executeRun(run: WorkflowRun, workflow: WorkflowDefinition): Promise<void> {
  try {
    // Build initial step queue (ordered by workflow.steps)
    const stepQueue: string[] = workflow.steps.map(s => s.id);

    while (stepQueue.length > 0) {
      const stepId = stepQueue.shift()!;
      const step = workflow.steps.find(s => s.id === stepId)!;

      // Update current step
      run.currentStep = step.id;
      await this.saveRun(run);
      broadcastWorkflowStatus(run);

      // Execute the step
      const stepRun = run.steps.find(s => s.stepId === step.id)!;
      stepRun.status = 'running';
      stepRun.startedAt = new Date().toISOString();
      await this.saveRun(run);

      try {
        const result = await this.stepExecutor.executeStep(step, run);

        // Step succeeded
        stepRun.status = 'completed';
        stepRun.completedAt = new Date().toISOString();
        stepRun.duration = Math.floor(
          (new Date(stepRun.completedAt).getTime() - new Date(stepRun.startedAt!).getTime()) / 1000
        );
        stepRun.output = result.outputPath;

        // Merge step output into run context
        run.context[step.id] = result.output;

        await this.saveRun(run);
        broadcastWorkflowStatus(run);
      } catch (err: any) {
        // Step failed
        stepRun.status = 'failed';
        stepRun.error = err.message;
        stepRun.completedAt = new Date().toISOString();
        await this.saveRun(run);

        // Handle failure policy
        const handled = await this.handleStepFailure(step, stepRun, stepQueue, workflow, run);
        if (!handled) {
          // No retry policy — fail the entire workflow
          throw err;
        }
      }
    }

    // All steps completed
    run.status = 'completed';
    run.completedAt = new Date().toISOString();
    await this.saveRun(run);
    broadcastWorkflowStatus(run);

    log.info({ runId: run.id, workflowId: run.workflowId }, 'Workflow run completed');
  } catch (err: any) {
    run.status = 'failed';
    run.error = err.message;
    run.completedAt = new Date().toISOString();
    await this.saveRun(run);
    broadcastWorkflowStatus(run);

    log.error({ runId: run.id, err }, 'Workflow run failed');
  }
}

/**
 * Handle step failure according to on_fail policy
 * Returns true if handled (retry queued), false if should fail workflow
 */
private async handleStepFailure(
  step: WorkflowStep,
  stepRun: StepRun,
  stepQueue: string[],
  workflow: WorkflowDefinition,
  run: WorkflowRun
): Promise<boolean> {
  const policy = step.on_fail;
  if (!policy) return false;

  // Strategy 1: Retry the same step
  if (policy.retry && stepRun.retries < policy.retry) {
    stepRun.retries++;
    stepRun.status = 'pending';
    stepRun.error = undefined;

    // Re-queue this step at the front
    stepQueue.unshift(step.id);

    await this.saveRun(run);
    log.info({ stepId: step.id, retry: stepRun.retries }, 'Retrying step');
    return true;
  }

  // Strategy 2: Retry a different step
  if (policy.retry_step) {
    const retryStep = workflow.steps.find(s => s.id === policy.retry_step);
    if (!retryStep) {
      throw new Error(`retry_step references unknown step: ${policy.retry_step}`);
    }

    // Reset the retry step's state
    const retryStepRun = run.steps.find(s => s.stepId === retryStep.id)!;
    retryStepRun.status = 'pending';
    retryStepRun.retries = 0;
    retryStepRun.error = undefined;

    // Build a new queue starting from the retry step
    const retryIndex = workflow.steps.findIndex(s => s.id === policy.retry_step);
    const newQueue = workflow.steps.slice(retryIndex).map(s => s.id);

    // Replace the queue
    stepQueue.length = 0;
    stepQueue.push(...newQueue);

    // Store failure context for the retry step
    run.context._retryContext = {
      failedStep: step.id,
      error: stepRun.error,
      retries: stepRun.retries,
    };

    await this.saveRun(run);
    log.info({ failedStep: step.id, retryStep: retryStep.id }, 'Routing to retry step');
    return true;
  }

  // Strategy 3: Escalation
  if (policy.escalate_to === 'human') {
    run.status = 'blocked';
    run.error = policy.escalate_message || `Step ${step.id} failed`;
    await this.saveRun(run);
    broadcastWorkflowStatus(run);

    // Workflow is blocked — human must resume
    return true; // Handled (blocked, not failed)
  }

  if (policy.escalate_to === 'skip') {
    stepRun.status = 'skipped';
    await this.saveRun(run);
    log.info({ stepId: step.id }, 'Skipping failed step');
    return true;
  }

  if (policy.escalate_to?.startsWith('agent:')) {
    // Delegate to another agent (future feature)
    throw new Error('Agent escalation not yet implemented');
  }

  return false; // No policy matched — fail the workflow
}
```

### 3.3 Retry Routing State Machine

```
┌──────────────┐
│  Step Start  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Executing   │
└──────┬───────┘
       │
       ├─ Success ──────────────────────┐
       │                                │
       └─ Failure ───┐                  │
                     ▼                  │
              ┌──────────────┐          │
              │ Check Policy │          │
              └──────┬───────┘          │
                     │                  │
       ┌─────────────┼─────────────┐    │
       │             │             │    │
       ▼             ▼             ▼    │
  retry < max?   retry_step?   escalate │
       │             │             │    │
       │ YES         │ YES         │    │
       ▼             ▼             ▼    │
  Re-queue      Jump back      Block/  │
  same step     to step        Skip    │
       │             │             │    │
       └─────────────┴─────────────┴────┼─> Next step
                                        │   or complete
                                        ▼
                                  ┌──────────────┐
                                  │   Complete   │
                                  └──────────────┘
```

### 3.4 Failure Context Passing

When `retry_step` is triggered, the failure context is stored in `run.context._retryContext`:

```typescript
{
  failedStep: 'test',        // Which step failed
  error: 'Tests did not pass', // Error message
  retries: 2,                // How many times the failed step was retried
}
```

The retry step's input template can access this context:

```yaml
steps:
  - id: implement
    name: 'Implement: Code the feature'
    agent: developer
    input: |
      {{#if _retryContext}}
      RETRY ATTEMPT: The previous implementation failed.
      FAILED STEP: {{_retryContext.failedStep}}
      ERROR: {{_retryContext.error}}

      Please fix the issue and re-implement.
      {{/if}}

      Feature: {{task.title}}
      ...
```

### 3.5 Example: Verifier-Triggered Retry

From the `feature-dev` workflow:

```yaml
steps:
  - id: implement
    name: 'Implement: Code'
    agent: developer
    # ... implementation logic ...

  - id: verify
    name: 'Verify: Check implementation'
    agent: verifier
    input: |
      Check the developer's work.
      CHANGES: {{implement.output}}

      Acceptance criteria:
      - Code exists (not TODOs)
      - Tests pass
      - Meets requirements

    on_fail:
      retry_step: implement # Jump back to implement
      max_retries: 2 # Max 2 full cycles
      on_exhausted:
        escalate_to: human
```

**Execution flow**:

1. `implement` runs → produces code
2. `verify` runs → finds issues
3. `verify` fails → `retry_step: implement` triggers
4. Executor jumps back to `implement` with `_retryContext`
5. `implement` re-runs with failure context
6. `verify` runs again
7. If `verify` fails again → repeat (up to `max_retries`)
8. If still failing → escalate to human

---

## 4. Example Workflows

### 3.1 Feature Development (Classic)

````yaml
id: feature-dev
name: Feature Development Workflow
version: 1
description: |
  End-to-end feature development pipeline.
  Planner decomposes → Developer implements stories → Tester validates → Reviewer approves.

config:
  timeout: 7200
  fresh_session_default: true
  progress_file: progress.md
  telemetry_tags: ['workflow', 'feature-dev']

agents:
  - id: planner
    name: Planner
    role: analysis
    model: github-copilot/claude-opus-4.6
    description: Task decomposition specialist

  - id: developer
    name: Developer
    role: coding
    model: github-copilot/claude-sonnet-4.5
    description: Feature implementation

  - id: tester
    name: Tester
    role: testing
    model: github-copilot/claude-sonnet-4.5
    description: Integration testing

  - id: reviewer
    name: Reviewer
    role: analysis
    model: github-copilot/claude-opus-4.6
    description: Code review

variables:
  repo_path: '{{task.git.worktreePath}}'
  base_branch: '{{task.git.baseBranch}}'
  feature_branch: '{{task.git.branch}}'
  test_command: 'npm test'

steps:
  - id: plan
    name: 'Plan: Decompose into stories'
    agent: planner
    type: agent
    fresh_session: true

    input: |
      Decompose this task into 5-10 implementable user stories.

      TASK: {{task.title}}
      {{task.description}}

      REPO: {{repo_path}}

      Guidelines:
      - Each story fits in one coding session (one context window)
      - Order by dependency (backend before frontend)
      - Include acceptance criteria that are mechanically verifiable
      - Every story must include test criteria

      Output format (YAML):
      ```yaml
      stories:
        - id: story-1
          title: "Add user registration endpoint"
          description: "POST /api/auth/register with email/password validation"
          acceptance_criteria:
            - "POST /api/auth/register endpoint exists"
            - "Email validation rejects invalid emails"
            - "Password hashing uses bcrypt"
            - "Tests for registration pass"
            - "Typecheck passes"
        - id: story-2
          title: ...
      ```

    output:
      file: plan.yml

    acceptance_criteria:
      - 'Output contains valid YAML'
      - 'At least 3 stories defined'
      - 'Each story has acceptance_criteria'

    on_fail:
      retry: 2
      escalate_to: human
      escalate_message: 'Planning failed — need manual story breakdown'

    timeout: 600

  - id: implement
    name: 'Implement: Execute stories'
    agent: developer
    type: loop

    loop:
      over: '{{plan.stories}}'
      item_var: story
      completion: all_done
      fresh_session_per_iteration: true
      verify_each: false
      max_iterations: 20

    input: |
      Implement this user story in the feature branch.

      STORY {{loop.index + 1}}/{{loop.total}}: {{story.title}}
      {{story.description}}

      ACCEPTANCE CRITERIA:
      {{story.acceptance_criteria | join("\n")}}

      REPO: {{repo_path}}
      BRANCH: {{feature_branch}}
      TEST_CMD: {{test_command}}

      COMPLETED STORIES:
      {{loop.completed | map(attribute='title') | join("\n")}}

      PROGRESS LOG:
      {{progress}}

      Instructions:
      1. Read progress.md for context from previous stories
      2. cd {{repo_path}}
      3. git pull origin {{feature_branch}}
      4. Implement the story (code + tests)
      5. Run {{test_command}} — tests must pass
      6. Run npm run typecheck — must pass
      7. Commit: feat({{story.id}}): {{story.title}}
      8. Append to progress.md with what you did

      Reply with:
      STATUS: done
      CHANGES: <what was implemented>
      TESTS: <what tests were added>

    output:
      file: 'implement-{{loop.index}}.md'

    acceptance_criteria:
      - 'STATUS: done appears in output'
      - 'CHANGES section is not empty'
      - 'TESTS section lists test files'

    on_fail:
      retry: 2
      escalate_to: human
      escalate_message: 'Story {{story.title}} failed after 2 retries'

    timeout: 1200

  - id: test
    name: 'Test: Integration validation'
    agent: tester
    type: agent

    input: |
      Run integration tests on the complete feature.

      TASK: {{task.title}}
      REPO: {{repo_path}}
      BRANCH: {{feature_branch}}
      TEST_CMD: {{test_command}}

      IMPLEMENTED STORIES:
      {{implement.outputs | map(attribute='changes') | join("\n\n")}}

      PROGRESS LOG:
      {{progress}}

      Instructions:
      1. cd {{repo_path}}
      2. git pull origin {{feature_branch}}
      3. Run full test suite: {{test_command}}
      4. Check for integration issues between stories
      5. Verify the feature works end-to-end
      6. Check edge cases and error handling

      Reply with:
      STATUS: done
      RESULTS: <test outcomes>
      ISSUES: <any bugs found, or "none">

    output:
      file: test-results.md

    acceptance_criteria:
      - 'STATUS: done appears in output'
      - 'All tests passed (or ISSUES lists failures)'

    on_fail:
      retry_step: implement # Go back and fix the broken story
      max_retries: 2
      on_exhausted:
        escalate_to: human

    timeout: 900

  - id: gate-quality
    name: 'Gate: Quality Check'
    type: gate

    condition: |
      {{test.status == "completed" and "ISSUES: none" in test.output}}

    on_false:
      escalate_to: human
      escalate_message: 'Quality gate failed — tests did not pass or issues found'

  - id: pr
    name: 'PR: Create pull request'
    agent: developer
    type: agent

    input: |
      Create a pull request for this feature.

      TASK: {{task.title}}
      REPO: {{repo_path}}
      BRANCH: {{feature_branch}}
      BASE: {{base_branch}}

      CHANGES:
      {{implement.outputs | map(attribute='changes') | join("\n\n")}}

      TEST RESULTS:
      {{test.output}}

      Instructions:
      1. cd {{repo_path}}
      2. Create PR: gh pr create --base {{base_branch}} --head {{feature_branch}}
      3. Title: feat: {{task.title}}
      4. Body should include:
         - What was implemented (from CHANGES)
         - Test coverage (from TEST RESULTS)
         - Reference to VK task ({{task.id}})

      Reply with:
      STATUS: done
      PR: <PR URL>

    output:
      file: pr.md

    on_fail:
      escalate_to: human

    timeout: 300

  - id: review
    name: 'Review: Code review'
    agent: reviewer
    type: agent

    input: |
      Review the pull request for this feature.

      PR: {{pr.url}}
      TASK: {{task.title}}

      CHANGES:
      {{implement.outputs | map(attribute='changes') | join("\n\n")}}

      Instructions:
      1. gh pr view {{pr.number}}
      2. gh pr diff {{pr.number}}
      3. Review for:
         - Code quality and clarity
         - Potential bugs
         - Test coverage
         - Follows project conventions
      4. If issues found, add review comments: gh pr review {{pr.number}} --comment

      Reply with:
      STATUS: done
      DECISION: approved|changes_requested
      FEEDBACK: <review comments, if any>

    output:
      file: review.md

    on_fail:
      retry_step: implement
      max_retries: 2
      on_exhausted:
        escalate_to: human

    timeout: 600
````

### 3.2 Security Audit

````yaml
id: security-audit
name: Security Audit & Remediation
version: 1
description: |
  Comprehensive security audit workflow.
  Scanner finds vulnerabilities → Prioritizer ranks them → Fixer patches each issue → Tester validates.

config:
  timeout: 10800 # 3 hours
  fresh_session_default: true
  telemetry_tags: ['workflow', 'security']

agents:
  - id: scanner
    name: Security Scanner
    role: scanning
    model: github-copilot/claude-opus-4.6
    description: Vulnerability detection

  - id: prioritizer
    name: Prioritizer
    role: analysis
    model: github-copilot/claude-opus-4.6
    description: Risk assessment and ranking

  - id: fixer
    name: Security Fixer
    role: coding
    model: github-copilot/claude-sonnet-4.5
    description: Security patch implementation

  - id: tester
    name: Security Tester
    role: testing
    model: github-copilot/claude-sonnet-4.5
    description: Vulnerability validation

variables:
  repo_path: '{{task.git.worktreePath}}'
  security_branch: "security-audit-{{now | date('YYYY-MM-DD')}}"

steps:
  - id: scan
    name: 'Scan: Find vulnerabilities'
    agent: scanner
    type: agent

    input: |
      Perform a comprehensive security audit of the codebase.

      REPO: {{repo_path}}

      Scan for:
      1. Dependency vulnerabilities (npm audit / yarn audit / pip-audit)
      2. Hardcoded secrets (API keys, passwords, tokens in source)
      3. SQL injection (raw queries, string concatenation)
      4. XSS (unescaped user input in templates/responses)
      5. CSRF (missing tokens on state-changing endpoints)
      6. Auth bypass (missing auth middleware)
      7. Directory traversal (user input in file paths)
      8. SSRF (user-controlled URLs in server requests)
      9. Insecure deserialization
      10. Missing input validation
      11. Security headers (CORS, CSP, HSTS)

      For each finding, document:
      - Severity: critical|high|medium|low
      - File and line number
      - Description of the vulnerability
      - Suggested fix

      Output format (YAML):
      ```yaml
      vulnerabilities:
        - id: vuln-001
          severity: critical
          type: sql-injection
          file: server/routes/users.ts
          line: 42
          description: "Raw SQL query with user input"
          suggested_fix: "Use parameterized queries"
        - id: vuln-002
          ...
      ```

    output:
      file: scan-results.yml

    acceptance_criteria:
      - 'Output contains valid YAML'
      - 'Each vulnerability has severity, file, line, description'

    on_fail:
      retry: 1
      escalate_to: human

    timeout: 1800

  - id: prioritize
    name: 'Prioritize: Rank and group vulnerabilities'
    agent: prioritizer
    type: agent

    input: |
      Prioritize the security findings into a fix plan.

      VULNERABILITIES:
      {{scan.vulnerabilities | to_yaml}}

      Instructions:
      1. Deduplicate (same root cause = one fix)
      2. Group related issues
      3. Rank by: exploitability × impact
      4. Create max 20 fixes (defer rest)
      5. Each fix becomes a "story" with acceptance criteria

      Output format (YAML):
      ```yaml
      fix_plan:
        - id: fix-001
          severity: critical
          title: "Fix SQL injection in user routes"
          description: "Replace raw queries with parameterized queries"
          affected_files: ["server/routes/users.ts"]
          acceptance_criteria:
            - "All user queries use parameterized statements"
            - "SQL injection test fails (query blocked)"
            - "Tests pass"
        - id: fix-002
          ...
      deferred:
        - id: vuln-042
          reason: "Low priority, manual review needed"
      ```

    output:
      file: fix-plan.yml

    on_fail:
      retry: 1
      escalate_to: human

    timeout: 600

  - id: fix
    name: 'Fix: Implement security patches'
    agent: fixer
    type: loop

    loop:
      over: '{{prioritize.fix_plan}}'
      item_var: fix
      completion: all_done
      fresh_session_per_iteration: true
      max_iterations: 20

    input: |
      Implement this security fix.

      FIX {{loop.index + 1}}/{{loop.total}}: {{fix.title}}
      SEVERITY: {{fix.severity}}
      {{fix.description}}

      AFFECTED FILES:
      {{fix.affected_files | join("\n")}}

      ACCEPTANCE CRITERIA:
      {{fix.acceptance_criteria | join("\n")}}

      REPO: {{repo_path}}
      BRANCH: {{security_branch}}

      PROGRESS LOG:
      {{progress}}

      Instructions:
      1. cd {{repo_path}}
      2. Create/checkout security branch: git checkout -b {{security_branch}}
      3. Implement the fix (minimal, targeted changes)
      4. Write a regression test that verifies the vulnerability is patched
      5. Run tests — must pass
      6. Commit: fix(security): {{fix.title}}
      7. Append to progress.md

      Reply with:
      STATUS: done
      CHANGES: <what was fixed>
      REGRESSION_TEST: <test file and description>

    output:
      file: 'fix-{{loop.index}}.md'

    acceptance_criteria:
      - 'STATUS: done appears'
      - 'REGRESSION_TEST describes a test'

    on_fail:
      retry: 2
      escalate_to: human

    timeout: 1200

  - id: test
    name: 'Test: Validate security fixes'
    agent: tester
    type: agent

    input: |
      Validate that all security fixes are effective.

      REPO: {{repo_path}}
      BRANCH: {{security_branch}}

      FIXES APPLIED:
      {{fix.outputs | map(attribute='changes') | join("\n\n")}}

      Instructions:
      1. cd {{repo_path}}
      2. Run full test suite — all tests must pass
      3. Run npm audit (or equivalent) — compare before/after
      4. For each fix, verify the regression test exists and tests the right thing
      5. Try to bypass each fix (adversarial testing)

      Reply with:
      STATUS: done
      RESULTS: <test outcomes>
      AUDIT_COMPARISON: <before vs after npm audit results>
      BYPASS_ATTEMPTS: <any successful bypasses, or "none">

    output:
      file: test-results.md

    acceptance_criteria:
      - 'STATUS: done appears'
      - 'All tests passed'
      - 'BYPASS_ATTEMPTS: none'

    on_fail:
      retry_step: fix
      max_retries: 2
      on_exhausted:
        escalate_to: human

    timeout: 1800

  - id: pr
    name: 'PR: Create security PR'
    agent: fixer
    type: agent

    input: |
      Create a pull request for the security fixes.

      REPO: {{repo_path}}
      BRANCH: {{security_branch}}

      SCAN RESULTS: {{scan.vulnerabilities | length}} vulnerabilities found
      FIXES APPLIED: {{fix.outputs | length}}
      DEFERRED: {{prioritize.deferred | length}}

      TEST RESULTS:
      {{test.output}}

      Instructions:
      1. cd {{repo_path}}
      2. Create PR: gh pr create --base main --head {{security_branch}}
      3. Title: fix(security): audit and remediation {{now | date('YYYY-MM-DD')}}
      4. Body format:
         ## Security Audit Summary
         **Scan Date**: {{now | date('YYYY-MM-DD')}}
         **Vulnerabilities Found**: {{scan.vulnerabilities | length}}
         **Vulnerabilities Fixed**: {{fix.outputs | length}}
         **Deferred**: {{prioritize.deferred | length}}
         
         ## Fixes Applied
         (table of fixes from {{fix.outputs}})
         
         ## Test Results
         {{test.output}}
      5. Label: security

      Reply with:
      STATUS: done
      PR: <PR URL>

    output:
      file: pr.md

    on_fail:
      escalate_to: human

    timeout: 300
````

### 3.3 Content Pipeline

````yaml
id: content-pipeline
name: Content Creation Pipeline
version: 1
description: |
  End-to-end content workflow.
  Researcher gathers info → Writer drafts → Editor refines → Publisher releases.

config:
  timeout: 3600
  fresh_session_default: true
  telemetry_tags: ['workflow', 'content']

agents:
  - id: researcher
    name: Researcher
    role: research
    model: github-copilot/claude-opus-4.6
    description: Information gathering and synthesis

  - id: writer
    name: Writer
    role: writing
    model: github-copilot/claude-sonnet-4.5
    description: Content creation

  - id: editor
    name: Editor
    role: editing
    model: github-copilot/claude-opus-4.6
    description: Quality assurance and refinement

  - id: publisher
    name: Publisher
    role: publishing
    model: github-copilot/claude-sonnet-4.5
    description: Publication and distribution

variables:
  topic: '{{task.title}}'
  target_audience: '{{task.project}}'
  word_count_min: 1500
  word_count_max: 2500

steps:
  - id: research
    name: 'Research: Gather information'
    agent: researcher
    type: agent

    input: |
      Research this topic in depth.

      TOPIC: {{topic}}
      TARGET AUDIENCE: {{target_audience}}

      Instructions:
      1. Use web_search to find 10-15 authoritative sources
      2. Synthesize key findings, statistics, expert quotes
      3. Identify unique angles and insights
      4. Note gaps in existing coverage (opportunity for original content)

      Output format (Markdown):
      ```markdown
      # Research: {{topic}}

      ## Key Findings
      - Finding 1 (Source: ...)
      - Finding 2 (Source: ...)

      ## Statistics
      - Stat 1 (Source: ...)

      ## Expert Quotes
      > Quote 1 — Expert Name, Title

      ## Unique Angles
      - Angle 1: ...

      ## Sources
      1. [Source Title](URL)
      2. ...
      ```

    output:
      file: research.md

    acceptance_criteria:
      - 'At least 10 sources listed'
      - 'Key Findings section has 5+ findings'
      - 'Unique Angles section is not empty'

    on_fail:
      retry: 2
      escalate_to: human

    timeout: 900

  - id: write
    name: 'Write: Draft content'
    agent: writer
    type: agent

    input: |
      Write a comprehensive article based on the research.

      TOPIC: {{topic}}
      TARGET AUDIENCE: {{target_audience}}
      WORD COUNT: {{word_count_min}}-{{word_count_max}} words

      RESEARCH:
      {{research.output}}

      Instructions:
      1. Write in a clear, engaging style
      2. Structure: introduction, body (3-5 sections), conclusion
      3. Include the unique angles from research
      4. Cite sources inline (Markdown links)
      5. Add subheadings for scannability
      6. Include a TL;DR at the top

      Output format (Markdown):
      ```markdown
      # {{topic}}

      **TL;DR**: One-paragraph summary

      ## Introduction
      ...

      ## Section 1: ...
      ...

      ## Conclusion
      ...

      ---

      **Word count**: <actual count>
      ```

    output:
      file: draft.md

    acceptance_criteria:
      - 'Word count is between {{word_count_min}} and {{word_count_max}}'
      - 'At least 3 body sections'
      - 'TL;DR is present'
      - 'At least 5 inline citations'

    on_fail:
      retry: 2
      escalate_to: human

    timeout: 1200

  - id: edit
    name: 'Edit: Refine and polish'
    agent: editor
    type: agent

    input: |
      Edit the draft for clarity, accuracy, and style.

      DRAFT:
      {{write.output}}

      RESEARCH (for fact-checking):
      {{research.output}}

      Instructions:
      1. Check for factual errors (cross-reference research)
      2. Improve clarity (simplify complex sentences)
      3. Fix grammar, spelling, punctuation
      4. Strengthen transitions between sections
      5. Verify all citations are correct
      6. Ensure consistent tone and style
      7. Add callout boxes for key insights (> blockquotes)

      Output the edited version (Markdown) AND a change log:
      ```markdown
      # {{topic}} (Edited)

      <edited content>

      ---

      ## Editorial Changes
      - Fixed factual error in section 2 (source mismatch)
      - Clarified introduction (removed jargon)
      - Added blockquote for key stat
      - ...
      ```

    output:
      file: edited.md

    acceptance_criteria:
      - 'Editorial Changes section lists at least 3 changes'
      - 'All citations are valid URLs'

    on_fail:
      retry: 1
      escalate_to: human

    timeout: 900

  - id: gate-quality
    name: 'Gate: Quality Check'
    type: gate

    condition: |
      {{edit.status == "completed" and write.word_count >= word_count_min}}

    on_false:
      escalate_to: human
      escalate_message: 'Quality gate failed — content too short or editing incomplete'

  - id: publish
    name: 'Publish: Release content'
    agent: publisher
    type: agent

    input: |
      Publish the final content.

      FINAL CONTENT:
      {{edit.output}}

      TARGET: {{task.deliverables[0].path}}  # Example: blog, newsletter, docs site

      Instructions:
      1. If target is a blog:
         - Convert Markdown to HTML (preserve formatting)
         - Add frontmatter (title, date, author, tags)
         - Save to content/posts/{{topic | slugify}}.md
         - Commit and push
      2. If target is a newsletter:
         - Format for email (HTML)
         - Save draft to newsletter-drafts/
      3. If target is docs:
         - Update the appropriate docs page
         - Rebuild docs site

      Reply with:
      STATUS: done
      PUBLISHED_URL: <URL or file path>
      NEXT_STEPS: <any manual steps needed>

    output:
      file: publish.md

    on_fail:
      escalate_to: human

    timeout: 600
````

---

## 4. Server Architecture

### New Services

#### 4.1 WorkflowService

**Responsibilities**: YAML loading, validation, CRUD operations on workflow definitions.

```typescript
// server/src/services/workflow-service.ts

import fs from 'fs/promises';
import path from 'path';
import yaml from 'yaml';
import Ajv from 'ajv';
import type { WorkflowDefinition } from '@veritas-kanban/shared';
import { getWorkflowsDir } from '../utils/paths.js';

export class WorkflowService {
  private workflowsDir: string;
  private ajv: Ajv;
  private cache: Map<string, WorkflowDefinition> = new Map();

  constructor(workflowsDir?: string) {
    this.workflowsDir = workflowsDir || getWorkflowsDir();
    this.ajv = new Ajv();
    this.ensureDirectories();
  }

  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.workflowsDir, { recursive: true });
  }

  /**
   * Load and parse a workflow YAML file
   */
  async loadWorkflow(id: string): Promise<WorkflowDefinition | null> {
    // Check cache first
    if (this.cache.has(id)) {
      return this.cache.get(id)!;
    }

    const filePath = path.join(this.workflowsDir, `${id}.yml`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const workflow = yaml.parse(content) as WorkflowDefinition;

      // Validate schema
      this.validateWorkflow(workflow);

      // Cache it
      this.cache.set(id, workflow);

      return workflow;
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw new ValidationError(`Invalid workflow YAML: ${err.message}`);
    }
  }

  /**
   * List all available workflows
   */
  async listWorkflows(): Promise<WorkflowDefinition[]> {
    const files = await fs.readdir(this.workflowsDir);
    const workflows: WorkflowDefinition[] = [];

    for (const file of files) {
      if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;

      const id = file.replace(/\.(yml|yaml)$/, '');
      const workflow = await this.loadWorkflow(id);
      if (workflow) {
        workflows.push(workflow);
      }
    }

    return workflows;
  }

  /**
   * Save a workflow definition
   */
  async saveWorkflow(workflow: WorkflowDefinition): Promise<void> {
    this.validateWorkflow(workflow);

    const filePath = path.join(this.workflowsDir, `${workflow.id}.yml`);
    const content = yaml.stringify(workflow);

    await fs.writeFile(filePath, content, 'utf-8');

    // Update cache
    this.cache.set(workflow.id, workflow);
  }

  /**
   * Delete a workflow definition
   */
  async deleteWorkflow(id: string): Promise<void> {
    const filePath = path.join(this.workflowsDir, `${id}.yml`);
    await fs.unlink(filePath);
    this.cache.delete(id);
  }

  /**
   * Validate workflow definition against schema
   */
  private validateWorkflow(workflow: WorkflowDefinition): void {
    // Required fields
    if (!workflow.id || !workflow.name || !workflow.version) {
      throw new ValidationError('Workflow must have id, name, and version');
    }

    // At least one agent
    if (!workflow.agents || workflow.agents.length === 0) {
      throw new ValidationError('Workflow must define at least one agent');
    }

    // At least one step
    if (!workflow.steps || workflow.steps.length === 0) {
      throw new ValidationError('Workflow must define at least one step');
    }

    // Validate step references
    const agentIds = new Set(workflow.agents.map((a) => a.id));
    const stepIds = new Set(workflow.steps.map((s) => s.id));

    for (const step of workflow.steps) {
      // Agent steps must reference a valid agent
      if ((step.type === 'agent' || step.type === 'loop') && !agentIds.has(step.agent!)) {
        throw new ValidationError(`Step ${step.id} references unknown agent ${step.agent}`);
      }

      // retry_step must reference a valid step
      if (step.on_fail?.retry_step && !stepIds.has(step.on_fail.retry_step)) {
        throw new ValidationError(
          `Step ${step.id} retry_step references unknown step ${step.on_fail.retry_step}`
        );
      }

      // Loop verify_step must reference a valid step
      if (step.loop?.verify_step && !stepIds.has(step.loop.verify_step)) {
        throw new ValidationError(
          `Step ${step.id} verify_step references unknown step ${step.loop.verify_step}`
        );
      }
    }
  }

  /**
   * Clear the cache (useful for tests)
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// Singleton
let workflowServiceInstance: WorkflowService | null = null;

export function getWorkflowService(): WorkflowService {
  if (!workflowServiceInstance) {
    workflowServiceInstance = new WorkflowService();
  }
  return workflowServiceInstance;
}
```

#### 4.1.1 RBAC & Audit Logging

**Access Control Model**:

```typescript
// server/src/middleware/workflow-auth.ts

export type WorkflowPermission = 'view' | 'create' | 'edit' | 'delete' | 'execute';

export interface WorkflowACL {
  workflowId: string;
  owner: string; // User ID or 'system'
  editors: string[]; // Users who can edit
  viewers: string[]; // Users who can view
  executors: string[]; // Users who can trigger runs
  isPublic: boolean; // Anyone can view/execute
}

/**
 * Check if a user has permission to perform an action on a workflow
 */
export function checkWorkflowPermission(
  workflowId: string,
  userId: string,
  permission: WorkflowPermission
): boolean {
  // Load ACL from .veritas-kanban/workflows/.acl.json
  const acl = loadWorkflowACL(workflowId);

  // Owner has all permissions
  if (acl.owner === userId) return true;

  // System workflows (shipped by VK) are view/execute only for all users
  if (acl.owner === 'system') {
    return permission === 'view' || permission === 'execute';
  }

  // Check specific permissions
  switch (permission) {
    case 'view':
      return acl.isPublic || acl.viewers.includes(userId) || acl.editors.includes(userId);
    case 'execute':
      return acl.isPublic || acl.executors.includes(userId) || acl.editors.includes(userId);
    case 'edit':
      return acl.editors.includes(userId);
    case 'delete':
      return acl.owner === userId; // Only owner can delete
    case 'create':
      return true; // Any authenticated user can create workflows
    default:
      return false;
  }
}
```

**Audit Logging**:

Every workflow change (create/edit/delete) is logged to `.veritas-kanban/workflows/.audit.jsonl`:

```typescript
// server/src/services/workflow-audit.ts

export interface WorkflowAuditEvent {
  timestamp: string;
  userId: string;
  action: 'create' | 'edit' | 'delete' | 'run';
  workflowId: string;
  workflowVersion?: number;
  changes?: {
    field: string;
    oldValue: any;
    newValue: any;
  }[];
  runId?: string; // For 'run' events
}

export async function auditWorkflowChange(event: WorkflowAuditEvent): Promise<void> {
  const auditPath = path.join(getWorkflowsDir(), '.audit.jsonl');
  const line = JSON.stringify(event) + '\n';
  await fs.appendFile(auditPath, line, 'utf-8');

  log.info({ event }, 'Workflow audit event logged');
}
```

**Workflow Versioning Strategy**:

1. **Version field** — Each workflow YAML has a `version: <integer>` field
2. **Version immutability** — Editing a workflow increments the version
3. **Active runs use snapshot** — When a run starts, the workflow YAML is snapshotted into `workflow-runs/<run-id>/workflow.yml`
4. **Breaking changes** — If a workflow is edited while runs are active:
   - Active runs continue with their snapshotted version
   - New runs use the latest version
   - No interruption to in-flight runs

**TypeScript Interfaces**:

```typescript
export interface WorkflowACL {
  workflowId: string;
  owner: string;
  editors: string[];
  viewers: string[];
  executors: string[];
  isPublic: boolean;
}

export interface WorkflowAuditEvent {
  timestamp: string;
  userId: string;
  action: 'create' | 'edit' | 'delete' | 'run';
  workflowId: string;
  workflowVersion?: number;
  changes?: Array<{ field: string; oldValue: any; newValue: any }>;
  runId?: string;
}
```

**Workflow Routes with RBAC**:

```typescript
// server/src/routes/workflows.ts (updated)

import { requireAuth } from '../middleware/auth.js';
import { checkWorkflowPermission, auditWorkflowChange } from '../services/workflow-auth.js';
import { diffWorkflows } from '../utils/workflow-diff.js';

// GET /api/workflows — List workflows (filtered by user permissions)
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const allWorkflows = await workflowService.listWorkflows();

    // Filter by permissions
    const visibleWorkflows = allWorkflows.filter((w) =>
      checkWorkflowPermission(w.id, userId, 'view')
    );

    res.json(visibleWorkflows);
  })
);

// POST /api/workflows — Create workflow (requires authentication)
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const workflow = req.body as WorkflowDefinition;

    // Set owner ACL
    const acl: WorkflowACL = {
      workflowId: workflow.id,
      owner: userId,
      editors: [],
      viewers: [],
      executors: [],
      isPublic: false,
    };

    await workflowService.saveWorkflow(workflow);
    await workflowService.saveACL(acl);

    // Audit log
    await auditWorkflowChange({
      timestamp: new Date().toISOString(),
      userId,
      action: 'create',
      workflowId: workflow.id,
      workflowVersion: workflow.version,
    });

    res.status(201).json({ success: true });
  })
);

// PUT /api/workflows/:id — Edit workflow (requires edit permission)
router.put(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const workflow = req.body as WorkflowDefinition;

    if (!checkWorkflowPermission(workflow.id, userId, 'edit')) {
      throw new ForbiddenError('You do not have permission to edit this workflow');
    }

    // Load previous version for change tracking
    const previousVersion = await workflowService.loadWorkflow(workflow.id);

    // Increment version
    workflow.version = (previousVersion?.version || 0) + 1;

    await workflowService.saveWorkflow(workflow);

    // Audit log with changes
    await auditWorkflowChange({
      timestamp: new Date().toISOString(),
      userId,
      action: 'edit',
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      changes: diffWorkflows(previousVersion, workflow),
    });

    res.json({ success: true });
  })
);

// DELETE /api/workflows/:id — Delete workflow (owner only)
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const workflowId = req.params.id;

    if (!checkWorkflowPermission(workflowId, userId, 'delete')) {
      throw new ForbiddenError('Only the workflow owner can delete it');
    }

    await workflowService.deleteWorkflow(workflowId);

    // Audit log
    await auditWorkflowChange({
      timestamp: new Date().toISOString(),
      userId,
      action: 'delete',
      workflowId,
    });

    res.status(204).send();
  })
);
```

**Workflow Snapshot on Run Start**:

```typescript
// In WorkflowRunService.startRun()

const workflow = await this.workflowService.loadWorkflow(workflowId);
if (!workflow) {
  throw new NotFoundError(`Workflow ${workflowId} not found`);
}

// Snapshot the workflow YAML into the run directory
const runDir = path.join(this.runsDir, runId);
await fs.mkdir(runDir, { recursive: true });
const snapshotPath = path.join(runDir, 'workflow.yml');
await fs.writeFile(snapshotPath, yaml.stringify(workflow), 'utf-8');

// This ensures the run always uses the exact workflow version it started with,
// even if the workflow is edited mid-run.
```

#### 4.2 WorkflowRunService

**Responsibilities**: Executes workflows, manages run state, orchestrates step execution.

```typescript
// server/src/services/workflow-run-service.ts

import fs from 'fs/promises';
import path from 'path';
import { nanoid } from 'nanoid';
import type {
  WorkflowRun,
  StepRun,
  WorkflowDefinition,
  WorkflowStep,
} from '@veritas-kanban/shared';
import { getWorkflowService } from './workflow-service.js';
import { WorkflowStepExecutor } from './workflow-step-executor.js';
import { broadcastWorkflowStatus } from './broadcast-service.js';
import { getWorkflowRunsDir } from '../utils/paths.js';
import { createLogger } from '../lib/logger.js';
import { getTaskService } from './task-service.js';

const log = createLogger('workflow-run');

export class WorkflowRunService {
  private runsDir: string;
  private workflowService: WorkflowService;
  private stepExecutor: WorkflowStepExecutor;

  constructor(runsDir?: string) {
    this.runsDir = runsDir || getWorkflowRunsDir();
    this.workflowService = getWorkflowService();
    this.stepExecutor = new WorkflowStepExecutor();
    this.ensureDirectories();
  }

  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.runsDir, { recursive: true });
  }

  /**
   * Start a new workflow run
   */
  async startRun(
    workflowId: string,
    taskId?: string,
    initialContext?: Record<string, any>
  ): Promise<WorkflowRun> {
    const workflow = await this.workflowService.loadWorkflow(workflowId);
    if (!workflow) {
      throw new NotFoundError(`Workflow ${workflowId} not found`);
    }

    // ✅ Load the full task payload (if taskId provided)
    const taskService = getTaskService();
    const task = taskId ? await taskService.getTask(taskId) : null;

    // ✅ Ensure task payload includes ALL fields agents might need
    const taskPayload = task
      ? {
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          type: task.type,
          project: task.project,
          tags: task.tags,
          assignee: task.assignee,
          subtasks: task.subtasks,
          deliverables: task.deliverables,
          git: task.git, // Worktree path, branch, PR URL, etc.
          automation: task.automation,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        }
      : null;

    const runId = `run_${Date.now()}_${nanoid(8)}`;
    const now = new Date().toISOString();

    const run: WorkflowRun = {
      id: runId,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      taskId,
      status: 'running',
      currentStep: workflow.steps[0].id,
      context: {
        // ✅ Full task payload first (so it can be overridden by initialContext if needed)
        task: taskPayload,

        // Workflow variables
        ...workflow.variables,

        // Custom initial context (from API caller)
        ...initialContext,

        // Run metadata
        workflow: { id: workflow.id, version: workflow.version },
        run: { id: runId, startedAt: now },
      },
      startedAt: now,
      steps: workflow.steps.map((step) => ({
        stepId: step.id,
        status: 'pending',
        retries: 0,
      })),
    };

    // Persist initial run state
    await this.saveRun(run);

    // Broadcast status
    broadcastWorkflowStatus(run);

    // Start execution (async — don't await)
    this.executeRun(run, workflow).catch((err) => {
      log.error({ runId, err }, 'Workflow run failed');
    });

    return run;
  }

  /**
   * Execute the workflow run (iterates through steps)
   */
  private async executeRun(run: WorkflowRun, workflow: WorkflowDefinition): Promise<void> {
    try {
      // Build initial step queue so we can jump backwards when retry_step is set
      const stepQueue: string[] = workflow.steps.map((s) => s.id);

      while (stepQueue.length > 0) {
        const stepId = stepQueue.shift()!;
        const step = workflow.steps.find((s) => s.id === stepId)!;

        // Update current step for UI/telemetry
        run.currentStep = step.id;
        await this.saveRun(run);
        broadcastWorkflowStatus(run);

        const stepRun = run.steps.find((s) => s.stepId === step.id)!;
        stepRun.status = 'running';
        stepRun.startedAt = new Date().toISOString();
        await this.saveRun(run);

        try {
          const result = await this.stepExecutor.executeStep(step, run);

          stepRun.status = 'completed';
          stepRun.completedAt = new Date().toISOString();
          stepRun.duration = Math.floor(
            (new Date(stepRun.completedAt).getTime() - new Date(stepRun.startedAt!).getTime()) /
              1000
          );
          stepRun.output = result.outputPath;

          run.context[step.id] = result.output;

          await this.saveRun(run);
          broadcastWorkflowStatus(run);
        } catch (err: any) {
          stepRun.status = 'failed';
          stepRun.error = err.message;
          stepRun.completedAt = new Date().toISOString();
          await this.saveRun(run);

          const handled = await this.handleStepFailure(step, stepRun, stepQueue, workflow, run);
          if (!handled) {
            throw err;
          }
        }
      }

      run.status = 'completed';
      run.completedAt = new Date().toISOString();
      await this.saveRun(run);
      broadcastWorkflowStatus(run);

      log.info({ runId: run.id, workflowId: run.workflowId }, 'Workflow run completed');
    } catch (err: any) {
      run.status = 'failed';
      run.error = err.message;
      run.completedAt = new Date().toISOString();
      await this.saveRun(run);
      broadcastWorkflowStatus(run);

      log.error({ runId: run.id, err }, 'Workflow run failed');
    }
  }

  private async handleStepFailure(
    step: WorkflowStep,
    stepRun: StepRun,
    stepQueue: string[],
    workflow: WorkflowDefinition,
    run: WorkflowRun
  ): Promise<boolean> {
    const policy = step.on_fail;
    if (!policy) return false;

    // Strategy 1: retry the same step in-place
    if (policy.retry && stepRun.retries < policy.retry) {
      stepRun.retries++;
      stepRun.status = 'pending';
      stepRun.error = undefined;
      stepQueue.unshift(step.id);

      await this.saveRun(run);
      log.info({ stepId: step.id, retry: stepRun.retries }, 'Retrying step');
      return true;
    }

    // Strategy 2: jump to another step
    if (policy.retry_step) {
      const retryStep = workflow.steps.find((s) => s.id === policy.retry_step);
      if (!retryStep) {
        throw new Error(`retry_step references unknown step: ${policy.retry_step}`);
      }

      const retryStepRun = run.steps.find((s) => s.stepId === retryStep.id)!;
      retryStepRun.status = 'pending';
      retryStepRun.retries = 0;
      retryStepRun.error = undefined;

      const retryIndex = workflow.steps.findIndex((s) => s.id === policy.retry_step);
      const newQueue = workflow.steps.slice(retryIndex).map((s) => s.id);
      stepQueue.length = 0;
      stepQueue.push(...newQueue);

      run.context._retryContext = {
        failedStep: step.id,
        error: stepRun.error,
        retries: stepRun.retries,
      };

      await this.saveRun(run);
      log.info({ failedStep: step.id, retryStep: retryStep.id }, 'Routing to retry step');
      return true;
    }

    // Strategy 3: escalate or skip
    if (policy.escalate_to === 'human') {
      run.status = 'blocked';
      run.error = policy.escalate_message || `Step ${step.id} failed`;
      await this.saveRun(run);
      broadcastWorkflowStatus(run);
      return true; // Blocked, requires manual intervention
    }

    if (policy.escalate_to === 'skip') {
      stepRun.status = 'skipped';
      await this.saveRun(run);
      log.info({ stepId: step.id }, 'Skipping failed step');
      return true;
    }

    if (policy.escalate_to?.startsWith('agent:')) {
      throw new Error('Agent escalation not yet implemented');
    }

    return false; // No policy handled the failure
  }

  /**
   * Get a workflow run by ID
   */
  async getRun(runId: string): Promise<WorkflowRun | null> {
    const runPath = path.join(this.runsDir, runId, 'run.json');

    try {
      const content = await fs.readFile(runPath, 'utf-8');
      return JSON.parse(content) as WorkflowRun;
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * List all workflow runs (with optional filters)
   */
  async listRuns(filters?: {
    taskId?: string;
    workflowId?: string;
    status?: string;
  }): Promise<WorkflowRun[]> {
    const runDirs = await fs.readdir(this.runsDir);
    const runs: WorkflowRun[] = [];

    for (const dir of runDirs) {
      if (!dir.startsWith('run_')) continue;

      const run = await this.getRun(dir);
      if (!run) continue;

      // Apply filters
      if (filters?.taskId && run.taskId !== filters.taskId) continue;
      if (filters?.workflowId && run.workflowId !== filters.workflowId) continue;
      if (filters?.status && run.status !== filters.status) continue;

      runs.push(run);
    }

    // Sort by startedAt descending
    runs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    return runs;
  }

  /**
   * Resume a blocked workflow run
   */
  async resumeRun(runId: string, resumeContext?: Record<string, any>): Promise<WorkflowRun> {
    const run = await this.getRun(runId);
    if (!run) {
      throw new NotFoundError(`Run ${runId} not found`);
    }

    if (run.status !== 'blocked') {
      throw new ValidationError(`Run ${runId} is not blocked (status: ${run.status})`);
    }

    // Merge resume context
    run.context = { ...run.context, ...resumeContext };
    run.status = 'running';
    await this.saveRun(run);

    // Resume execution
    const workflow = await this.workflowService.loadWorkflow(run.workflowId);
    if (!workflow) {
      throw new NotFoundError(`Workflow ${run.workflowId} not found`);
    }

    this.executeRun(run, workflow).catch((err) => {
      log.error({ runId, err }, 'Workflow resume failed');
    });

    return run;
  }

  /**
   * Save run state to disk
   */
  private async saveRun(run: WorkflowRun): Promise<void> {
    const runDir = path.join(this.runsDir, run.id);
    await fs.mkdir(runDir, { recursive: true });

    const runPath = path.join(runDir, 'run.json');
    await fs.writeFile(runPath, JSON.stringify(run, null, 2), 'utf-8');
  }
}

// Singleton
let workflowRunServiceInstance: WorkflowRunService | null = null;

export function getWorkflowRunService(): WorkflowRunService {
  if (!workflowRunServiceInstance) {
    workflowRunServiceInstance = new WorkflowRunService();
  }
  return workflowRunServiceInstance;
}
```

#### 4.2.1 Retention & Concurrency Strategy

**Workflow Run Retention Policy**:

```typescript
// server/src/config/workflow-config.ts

export const WORKFLOW_RETENTION_CONFIG = {
  // How many completed runs to keep per workflow
  maxCompletedRunsPerWorkflow: 50,

  // How long to keep completed runs (days)
  completedRunRetentionDays: 30,

  // How long to keep failed runs (days)
  failedRunRetentionDays: 90,

  // Maximum total disk usage for workflow runs (MB)
  maxTotalDiskUsageMB: 5000,

  // Cleanup job interval (hours)
  cleanupIntervalHours: 24,
};
```

**Automatic Cleanup Job**:

```typescript
// server/src/jobs/workflow-cleanup.ts

import fs from 'fs/promises';
import path from 'path';
import { getWorkflowRunsDir } from '../utils/paths.js';
import { WORKFLOW_RETENTION_CONFIG } from '../config/workflow-config.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('workflow-cleanup');

export async function runWorkflowCleanup(): Promise<void> {
  const runsDir = getWorkflowRunsDir();
  const runDirs = await fs.readdir(runsDir);

  const now = Date.now();
  const completedCutoff =
    now - WORKFLOW_RETENTION_CONFIG.completedRunRetentionDays * 24 * 60 * 60 * 1000;
  const failedCutoff = now - WORKFLOW_RETENTION_CONFIG.failedRunRetentionDays * 24 * 60 * 60 * 1000;

  let deletedCount = 0;
  let reclaimedBytes = 0;

  for (const runDir of runDirs) {
    if (!runDir.startsWith('run_')) continue;

    const runPath = path.join(runsDir, runDir);
    const runJsonPath = path.join(runPath, 'run.json');

    try {
      const runData = JSON.parse(await fs.readFile(runJsonPath, 'utf-8'));

      // Skip active/blocked runs
      if (runData.status === 'running' || runData.status === 'blocked') {
        continue;
      }

      const completedAt = new Date(runData.completedAt).getTime();

      // Determine if should delete
      let shouldDelete = false;

      if (runData.status === 'completed' && completedAt < completedCutoff) {
        shouldDelete = true;
      } else if (runData.status === 'failed' && completedAt < failedCutoff) {
        shouldDelete = true;
      }

      if (shouldDelete) {
        // Calculate disk usage before deletion
        const size = await getDirSize(runPath);

        // Delete the run
        await fs.rm(runPath, { recursive: true, force: true });

        deletedCount++;
        reclaimedBytes += size;

        log.info(
          { runId: runDir, sizeMB: (size / 1024 / 1024).toFixed(2) },
          'Deleted workflow run'
        );
      }
    } catch (err: any) {
      log.error({ runDir, err }, 'Failed to process run for cleanup');
    }
  }

  log.info(
    {
      deletedRuns: deletedCount,
      reclaimedMB: (reclaimedBytes / 1024 / 1024).toFixed(2),
    },
    'Workflow cleanup completed'
  );
}

async function getDirSize(dirPath: string): Promise<number> {
  let total = 0;
  const files = await fs.readdir(dirPath, { withFileTypes: true });

  for (const file of files) {
    const filePath = path.join(dirPath, file.name);
    if (file.isDirectory()) {
      total += await getDirSize(filePath);
    } else {
      const stats = await fs.stat(filePath);
      total += stats.size;
    }
  }

  return total;
}
```

**Concurrency Limits**:

```typescript
// server/src/config/workflow-config.ts

export const WORKFLOW_CONCURRENCY_CONFIG = {
  // Maximum concurrent workflow runs globally
  maxConcurrentRuns: 5,

  // Maximum concurrent runs per workflow
  maxConcurrentRunsPerWorkflow: 2,

  // Maximum concurrent steps per workflow run (for parallel steps)
  maxConcurrentStepsPerRun: 3,

  // Queue size (pending runs waiting for a slot)
  maxQueueSize: 20,
};
```

**Concurrency Enforcement**:

```typescript
// server/src/services/workflow-run-service.ts (updated)

import { WORKFLOW_CONCURRENCY_CONFIG } from '../config/workflow-config.js';

export class WorkflowRunService {
  private activeRuns: Set<string> = new Set(); // Run IDs currently executing
  private runQueue: Array<{ runId: string; workflowId: string }> = [];

  async startRun(
    workflowId: string,
    taskId?: string,
    initialContext?: Record<string, any>
  ): Promise<WorkflowRun> {
    // Check global concurrency limit
    if (this.activeRuns.size >= WORKFLOW_CONCURRENCY_CONFIG.maxConcurrentRuns) {
      // Queue the run
      if (this.runQueue.length >= WORKFLOW_CONCURRENCY_CONFIG.maxQueueSize) {
        throw new Error('Workflow run queue is full — try again later');
      }

      const run = await this.createRun(workflowId, taskId, initialContext);
      run.status = 'pending';
      await this.saveRun(run);

      this.runQueue.push({ runId: run.id, workflowId });

      log.info({ runId: run.id, queuePosition: this.runQueue.length }, 'Run queued');
      return run;
    }

    // Check per-workflow concurrency limit
    let activeRunsForWorkflow = 0;
    for (const runId of this.activeRuns) {
      const existingRun = await this.getRun(runId);
      if (existingRun?.workflowId === workflowId) {
        activeRunsForWorkflow++;
      }
    }

    if (activeRunsForWorkflow >= WORKFLOW_CONCURRENCY_CONFIG.maxConcurrentRunsPerWorkflow) {
      throw new Error(`Workflow ${workflowId} has too many active runs`);
    }

    // Start the run
    const run = await this.createRun(workflowId, taskId, initialContext);
    this.activeRuns.add(run.id);

    // Execute (async)
    this.executeRun(run, workflow).finally(() => {
      this.activeRuns.delete(run.id);
      this.processQueue(); // Start next queued run
    });

    return run;
  }

  private async processQueue(): Promise<void> {
    if (this.runQueue.length === 0) return;
    if (this.activeRuns.size >= WORKFLOW_CONCURRENCY_CONFIG.maxConcurrentRuns) return;

    const { runId, workflowId } = this.runQueue.shift()!;
    const run = await this.getRun(runId);
    if (!run) return;

    // Update status and start execution
    run.status = 'running';
    await this.saveRun(run);
    broadcastWorkflowStatus(run);

    this.activeRuns.add(run.id);

    const workflow = await this.workflowService.loadWorkflow(workflowId);
    if (!workflow) {
      log.error({ runId, workflowId }, 'Workflow not found for queued run');
      return;
    }

    this.executeRun(run, workflow).finally(() => {
      this.activeRuns.delete(run.id);
      this.processQueue();
    });
  }
}
```

**OpenClaw Session Cleanup**:

When a workflow run completes, clean up all spawned OpenClaw sessions:

```typescript
// In WorkflowRunService.executeRun() — after completion

if (run.status === 'completed' || run.status === 'failed') {
  // Clean up all OpenClaw sessions spawned by this run
  for (const stepRun of run.steps) {
    if (stepRun.sessionKey) {
      try {
        await this.stepExecutor.cleanupSession(stepRun.sessionKey);
        log.info({ sessionKey: stepRun.sessionKey }, 'Cleaned up OpenClaw session');
      } catch (err: any) {
        log.warn({ sessionKey: stepRun.sessionKey, err }, 'Failed to cleanup session');
      }
    }
  }
}
```

**CLI Cleanup Command**:

```bash
# Manual cleanup (for debugging or maintenance)
vk workflow cleanup --dry-run
vk workflow cleanup --force
vk workflow cleanup --older-than 30d
```

**Scheduled Cleanup Job**:

```typescript
// server/src/jobs/scheduler.ts

import cron from 'node-cron';
import { runWorkflowCleanup } from './workflow-cleanup.js';
import { WORKFLOW_RETENTION_CONFIG } from '../config/workflow-config.js';

// Run cleanup every 24 hours (configurable)
const cronSchedule = `0 */${WORKFLOW_RETENTION_CONFIG.cleanupIntervalHours} * * *`;

cron.schedule(cronSchedule, async () => {
  await runWorkflowCleanup();
});
```

#### 4.3 WorkflowStepExecutor

**Responsibilities**: Executes individual steps (agent invocation via OpenClaw).

```typescript
// server/src/services/workflow-step-executor.ts

import fs from 'fs/promises';
import path from 'path';
import nunjucks from 'nunjucks';
import sanitizeFilename from 'sanitize-filename';
import yaml from 'yaml';
import { Parser as ExpressionParser } from 'expr-eval';
import type { WorkflowStep, WorkflowRun } from '@veritas-kanban/shared';
import { getWorkflowRunsDir } from '../utils/paths.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('workflow-step-executor');

// Jinja2-compatible templating
const templateEnv = nunjucks.configure({ autoescape: false });
const expressionParser = new ExpressionParser({
  operators: {
    add: true,
    multiply: true,
    logical: true,
    comparison: true,
  },
});

export interface StepExecutionResult {
  output: any; // Parsed output (for context passing)
  outputPath: string; // Path to output file
}

export class WorkflowStepExecutor {
  private runsDir: string;

  constructor(runsDir?: string) {
    this.runsDir = runsDir || getWorkflowRunsDir();
  }

  /**
   * Execute a single workflow step
   */
  async executeStep(step: WorkflowStep, run: WorkflowRun): Promise<StepExecutionResult> {
    log.info({ runId: run.id, stepId: step.id, type: step.type }, 'Executing step');

    switch (step.type) {
      case 'agent':
        return this.executeAgentStep(step, run);
      case 'loop':
        return this.executeLoopStep(step, run);
      case 'gate':
        return this.executeGateStep(step, run);
      case 'parallel':
        throw new Error('Parallel steps not yet implemented');
      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  /**
   * Execute an agent step (spawns OpenClaw session)
   */
  private async executeAgentStep(
    step: WorkflowStep,
    run: WorkflowRun
  ): Promise<StepExecutionResult> {
    // Render the input prompt with context
    const prompt = this.renderTemplate(step.input || '', run.context);

    // Spawn OpenClaw session
    const sessionKey = await this.spawnAgent(step.agent!, prompt, run.taskId);

    // Wait for completion
    const result = await this.waitForSession(sessionKey);
    const parsed = this.parseStepOutput(result, step);

    // ✅ Validate acceptance criteria before marking step as complete
    await this.validateAcceptanceCriteria(step, result, parsed);

    // Write output to step-outputs/
    const outputPath = await this.saveStepOutput(run.id, step.id, result);

    return {
      output: parsed,
      outputPath,
    };
  }

  /**
   * Execute a loop step (iterates over a collection)
   */
  private async executeLoopStep(
    step: WorkflowStep,
    run: WorkflowRun
  ): Promise<StepExecutionResult> {
    if (!step.loop) {
      throw new Error(`Loop step ${step.id} missing loop config`);
    }

    // Evaluate the loop collection
    const collection = this.evaluateExpression(step.loop.over, run.context);
    if (!Array.isArray(collection)) {
      throw new Error(`Loop step ${step.id} 'over' expression did not return an array`);
    }

    const itemVar = step.loop.item_var || 'item';
    const indexVar = step.loop.index_var || 'index';
    const results: any[] = [];
    const maxIterations = step.loop.max_iterations || collection.length;

    for (let i = 0; i < Math.min(collection.length, maxIterations); i++) {
      const item = collection[i];

      // Build loop context
      const loopContext = {
        ...run.context,
        [itemVar]: item,
        [indexVar]: i,
        loop: {
          index: i,
          total: collection.length,
          completed: results.filter((r) => r.success).map((r) => r.item),
          failed: results.filter((r) => !r.success).map((r) => r.item),
        },
      };

      // Render the input prompt
      const prompt = this.renderTemplate(step.input || '', loopContext);

      // Spawn agent (fresh session per iteration if configured)
      const sessionKey = await this.spawnAgent(step.agent!, prompt, run.taskId);

      // Wait for completion
      try {
        const result = await this.waitForSession(sessionKey);
        const parsed = this.parseStepOutput(result, step);
        results.push({ success: true, item, output: parsed });

        // Save iteration output
        const outputFile = step.output?.file || `${step.id}-${i}.md`;
        await this.saveStepOutput(run.id, step.id, result, outputFile);

        // ✅ VERIFY_EACH: Run verification after each iteration
        if (step.loop.verify_each && step.loop.verify_step) {
          const verificationPassed = await this.runVerificationStep(
            step.loop.verify_step,
            loopContext,
            run
          );

          if (!verificationPassed) {
            // Verification failed — treat iteration as failed
            results[results.length - 1].success = false;
            results[results.length - 1].verificationError = 'Verification step failed';

            // Handle failure according to completion strategy
            if (step.loop.completion === 'all_done') {
              throw new Error(`Verification failed for iteration ${i}`);
            }
          }
        }

        // ✅ COMPLETION: ANY_DONE — short-circuit on first success
        if (step.loop.completion === 'any_done' && results.some((r) => r.success)) {
          log.info({ stepId: step.id, iteration: i }, 'Loop short-circuited (any_done)');
          break;
        }
      } catch (err: any) {
        results.push({ success: false, item, error: err.message });

        // Handle loop failure
        if (step.loop.completion === 'all_done') {
          // Fail the entire loop
          throw err;
        } else if (step.loop.completion === 'first_success') {
          // Continue until first success
          continue;
        } else if (step.loop.completion === 'any_done') {
          // Continue — any success is enough (already checked above)
          continue;
        }
      }
    }

    // ✅ COMPLETION: Check final state
    const hasAnySuccess = results.some((r) => r.success);
    const hasAllSuccess = results.every((r) => r.success);

    if (step.loop.completion === 'all_done' && !hasAllSuccess) {
      throw new Error(`Loop ${step.id} failed — not all iterations succeeded`);
    }

    if (step.loop.completion === 'first_success' && !hasAnySuccess) {
      throw new Error(`Loop ${step.id} failed — no successful iterations`);
    }

    if (step.loop.completion === 'any_done' && !hasAnySuccess) {
      throw new Error(`Loop ${step.id} failed — no successful iterations`);
    }

    // Aggregate results
    const outputPath = await this.saveStepOutput(run.id, step.id, { results });

    // Update step run with loop state
    const stepRun = run.steps.find((s) => s.stepId === step.id)!;
    stepRun.loopState = {
      totalIterations: collection.length,
      currentIteration: results.length,
      completedIterations: results.filter((r) => r.success).length,
      failedIterations: results.filter((r) => !r.success).length,
    };

    return {
      output: { results },
      outputPath,
    };
  }

  /**
   * ✅ Run a verification step (for loop.verify_step)
   */
  private async runVerificationStep(
    verifyStepId: string,
    iterationContext: Record<string, any>,
    run: WorkflowRun
  ): Promise<boolean> {
    // Find the verification step definition
    const workflowService = getWorkflowService();
    const workflow = await workflowService.loadWorkflow(run.workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${run.workflowId} not found`);
    }

    const verifyStep = workflow.steps.find((s) => s.id === verifyStepId);
    if (!verifyStep) {
      throw new Error(`Verification step ${verifyStepId} not found in workflow`);
    }

    // Render the verification prompt with iteration context
    const prompt = this.renderTemplate(verifyStep.input || '', iterationContext);

    // Spawn verification agent
    const sessionKey = await this.spawnAgent(verifyStep.agent!, prompt, run.taskId);

    // Wait for result
    try {
      const result = await this.waitForSession(sessionKey);

      // Parse verification result
      // Convention: verification steps should output "DECISION: approved" or "DECISION: rejected"
      const decision = result.match(/DECISION:\s*(approved|rejected)/i)?.[1]?.toLowerCase();

      if (decision === 'approved') {
        return true;
      } else if (decision === 'rejected') {
        return false;
      } else {
        // If no explicit decision, assume failure
        log.warn({ verifyStepId, result }, 'Verification step did not return explicit decision');
        return false;
      }
    } catch (err: any) {
      log.error({ verifyStepId, err }, 'Verification step failed');
      return false;
    }
  }

  /**
   * Execute a gate step (boolean decision point)
   */
  private async executeGateStep(
    step: WorkflowStep,
    run: WorkflowRun
  ): Promise<StepExecutionResult> {
    if (!step.condition) {
      throw new Error(`Gate step ${step.id} missing condition`);
    }

    // Evaluate the condition
    const result = this.evaluateExpression(step.condition, run.context);

    if (!result) {
      // Gate failed
      if (step.on_false?.escalate_to === 'human') {
        throw new Error(step.on_false.escalate_message || `Gate ${step.id} failed`);
      } else if (step.on_false?.escalate_to === 'skip') {
        // Skip (no-op)
      }
    }

    // Save gate result
    const outputPath = await this.saveStepOutput(run.id, step.id, { passed: result });

    return {
      output: { passed: result },
      outputPath,
    };
  }

  /**
   * Spawn an OpenClaw agent session
   */
  private async spawnAgent(agentId: string, prompt: string, taskId?: string): Promise<string> {
    // TODO: Call OpenClaw sessions_spawn via HTTP or direct SDK
    // For now, placeholder:
    log.info({ agentId, taskId }, 'Spawning agent session');

    // Simulated spawn
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Wait for an OpenClaw session to complete
   */
  private async waitForSession(sessionKey: string): Promise<string> {
    // TODO: Poll OpenClaw sessions_wait_for endpoint
    // For now, placeholder:
    log.info({ sessionKey }, 'Waiting for session completion');

    // Simulated wait
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return 'Agent output goes here';
  }

  /**
   * Render a Jinja2 template with context
   */
  private renderTemplate(template: string, context: Record<string, any>): string {
    return templateEnv.renderString(template, context);
  }

  /**
   * Evaluate a Jinja2 expression (for gates, loop 'over')
   */
  private evaluateExpression(expression: string, context: Record<string, any>): any {
    try {
      const trimmed = expression.trim();
      const normalized =
        trimmed.startsWith('{{') && trimmed.endsWith('}}') ? trimmed.slice(2, -2).trim() : trimmed;

      const ast = expressionParser.parse(normalized);
      return ast.evaluate(context);
    } catch (err) {
      throw new Error(`Failed to evaluate expression safely: ${expression}`);
    }
  }

  /**
   * Parse agent output into structured data for context passing
   */
  private parseStepOutput(rawOutput: string, step: WorkflowStep): any {
    if (!rawOutput) return rawOutput;

    const hintedFile = step.output?.file || '';
    const extension = path.extname(hintedFile).toLowerCase();

    try {
      if (extension === '.yml' || extension === '.yaml') {
        return yaml.parse(rawOutput);
      }

      if (extension === '.json') {
        return JSON.parse(rawOutput);
      }

      // Allow schema-driven parsing in the future
      return rawOutput;
    } catch (err) {
      throw new Error(`Failed to parse output for step ${step.id}: ${(err as Error).message}`);
    }
  }

  /**
   * Save step output to disk
   */
  private async saveStepOutput(
    runId: string,
    stepId: string,
    output: any,
    filename?: string
  ): Promise<string> {
    const outputDir = path.join(this.runsDir, runId, 'step-outputs');
    await fs.mkdir(outputDir, { recursive: true });

    const candidate = filename || `${stepId}.md`;
    const safeName = sanitizeFilename(candidate) || `${stepId}.md`;
    const outputPath = path.join(outputDir, safeName);

    const content = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
    await fs.writeFile(outputPath, content, 'utf-8');

    return outputPath;
  }

  /**
   * ✅ Validate step output against acceptance criteria
   */
  private async validateAcceptanceCriteria(
    step: WorkflowStep,
    output: string,
    parsedOutput: any
  ): Promise<void> {
    if (!step.acceptance_criteria || step.acceptance_criteria.length === 0) {
      return; // No criteria to validate
    }

    const validator = new StepOutputValidator();

    for (const criterion of step.acceptance_criteria) {
      const passed = await validator.validate(criterion, output, parsedOutput);

      if (!passed) {
        throw new Error(`Acceptance criterion not met: "${criterion}"`);
      }
    }

    log.info(
      { stepId: step.id, criteria: step.acceptance_criteria.length },
      'All acceptance criteria passed'
    );
  }
}

/**
 * ✅ Step Output Validator — Supports regex, JSON Schema, and custom functions
 */
class StepOutputValidator {
  private ajv: Ajv;
  private customValidators: Map<string, (output: any) => boolean> = new Map();

  constructor() {
    this.ajv = new Ajv();
    this.registerCustomValidators();
  }

  /**
   * Validate a single acceptance criterion
   */
  async validate(criterion: string, rawOutput: string, parsedOutput: any): Promise<boolean> {
    // Strategy 1: Regex pattern match
    if (criterion.startsWith('/') && criterion.endsWith('/')) {
      const pattern = criterion.slice(1, -1);
      const regex = new RegExp(pattern);
      return regex.test(rawOutput);
    }

    // Strategy 2: JSON Schema reference
    if (criterion.startsWith('schema:')) {
      const schemaName = criterion.replace('schema:', '');
      // Load schema from workflow.schemas[schemaName]
      const schema = this.loadSchema(schemaName);
      const validate = this.ajv.compile(schema);
      return validate(parsedOutput) as boolean;
    }

    // Strategy 3: Custom function reference
    if (criterion.startsWith('fn:')) {
      const fnName = criterion.replace('fn:', '');
      const fn = this.customValidators.get(fnName);
      if (!fn) {
        throw new Error(`Custom validator "${fnName}" not found`);
      }
      return fn(parsedOutput);
    }

    // Strategy 4: Simple substring match (default)
    return rawOutput.includes(criterion);
  }

  /**
   * Load a JSON schema by name
   */
  private loadSchema(schemaName: string): any {
    // TODO: Load from workflow.schemas
    throw new Error(`Schema loading not yet implemented: ${schemaName}`);
  }

  /**
   * Register custom validation functions
   */
  private registerCustomValidators(): void {
    // Example custom validators
    this.customValidators.set('has_tests', (output) => {
      return output && output.tests && output.tests.length > 0;
    });

    this.customValidators.set('no_todos', (output) => {
      return !output.includes('TODO') && !output.includes('FIXME');
    });

    this.customValidators.set('valid_yaml', (output) => {
      try {
        yaml.parse(output);
        return true;
      } catch {
        return false;
      }
    });

    this.customValidators.set('valid_json', (output) => {
      try {
        JSON.parse(output);
        return true;
      } catch {
        return false;
      }
    });
  }
}
```

### New Routes

```typescript
// server/src/routes/workflows.ts

import { Router } from 'express';
import { z } from 'zod';
import type { WorkflowDefinition } from '@veritas-kanban/shared';
import { getWorkflowService } from '../services/workflow-service.js';
import { getWorkflowRunService } from '../services/workflow-run-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { checkWorkflowPermission, auditWorkflowChange } from '../services/workflow-auth.js';

const router = Router();
const workflowService = getWorkflowService();
const workflowRunService = getWorkflowRunService();

const startRunSchema = z.object({
  taskId: z.string().optional(),
  context: z.record(z.any()).optional(),
});

const resumeRunSchema = z.object({
  context: z.record(z.any()).optional(),
});

// GET /api/workflows — List workflows visible to the user
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const workflows = await workflowService.listWorkflows();
    const visible = workflows.filter((w) => checkWorkflowPermission(w.id, userId, 'view'));
    res.json(visible);
  })
);

// GET /api/workflows/:id — View a workflow
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const workflow = await workflowService.loadWorkflow(req.params.id);
    if (!workflow || !checkWorkflowPermission(workflow.id, req.user.id, 'view')) {
      throw new NotFoundError(`Workflow ${req.params.id} not found or not visible`);
    }
    res.json(workflow);
  })
);

// POST /api/workflows — Create workflow (any authenticated user)
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const workflow = req.body as WorkflowDefinition;

    await workflowService.saveWorkflow(workflow);
    await workflowService.saveACL({
      workflowId: workflow.id,
      owner: userId,
      editors: [],
      viewers: [],
      executors: [],
      isPublic: false,
    });

    await auditWorkflowChange({
      timestamp: new Date().toISOString(),
      userId,
      action: 'create',
      workflowId: workflow.id,
      workflowVersion: workflow.version,
    });

    res.status(201).json({ success: true });
  })
);

// PUT /api/workflows/:id — Update workflow (edit permission)
router.put(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const workflow = req.body as WorkflowDefinition;

    if (!checkWorkflowPermission(workflow.id, userId, 'edit')) {
      throw new ForbiddenError('You do not have permission to edit this workflow');
    }

    const previousVersion = await workflowService.loadWorkflow(workflow.id);
    workflow.version = (previousVersion?.version || 0) + 1;

    await workflowService.saveWorkflow(workflow);
    await auditWorkflowChange({
      timestamp: new Date().toISOString(),
      userId,
      action: 'edit',
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      changes: diffWorkflows(previousVersion, workflow),
    });

    res.json({ success: true });
  })
);

// DELETE /api/workflows/:id — Owner only
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const workflowId = req.params.id;

    if (!checkWorkflowPermission(workflowId, userId, 'delete')) {
      throw new ForbiddenError('Only the owner can delete this workflow');
    }

    await workflowService.deleteWorkflow(workflowId);
    await auditWorkflowChange({
      timestamp: new Date().toISOString(),
      userId,
      action: 'delete',
      workflowId,
    });

    res.status(204).send();
  })
);

// POST /api/workflows/:id/runs — Start a workflow run (execute permission)
router.post(
  '/:id/runs',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!checkWorkflowPermission(req.params.id, req.user.id, 'execute')) {
      throw new ForbiddenError('You do not have permission to run this workflow');
    }

    const { taskId, context } = startRunSchema.parse(req.body);
    const run = await workflowRunService.startRun(req.params.id, taskId, context);

    await auditWorkflowChange({
      timestamp: new Date().toISOString(),
      userId: req.user.id,
      action: 'run',
      workflowId: req.params.id,
      workflowVersion: run.workflowVersion,
      runId: run.id,
    });

    res.status(201).json(run);
  })
);

// GET /api/workflow-runs — List runs user can view
router.get(
  '/runs',
  requireAuth,
  asyncHandler(async (req, res) => {
    const filters = {
      taskId: req.query.taskId as string | undefined,
      workflowId: req.query.workflowId as string | undefined,
      status: req.query.status as string | undefined,
    };

    const runs = await workflowRunService.listRuns(filters);
    const visibleRuns = runs.filter((run) =>
      checkWorkflowPermission(run.workflowId, req.user.id, 'view')
    );

    res.json(visibleRuns);
  })
);

// GET /api/workflow-runs/:id — Run details
router.get(
  '/runs/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await workflowRunService.getRun(req.params.id);
    if (!run || !checkWorkflowPermission(run.workflowId, req.user.id, 'view')) {
      throw new NotFoundError(`Run ${req.params.id} not found`);
    }
    res.json(run);
  })
);

// POST /api/workflow-runs/:id/resume — Resume blocked run (execute permission)
router.post(
  '/runs/:id/resume',
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await workflowRunService.getRun(req.params.id);
    if (!run || !checkWorkflowPermission(run.workflowId, req.user.id, 'execute')) {
      throw new ForbiddenError('You do not have permission to resume this run');
    }

    if (run.status !== 'blocked') {
      throw new ValidationError(`Run ${req.params.id} is not blocked`);
    }

    const { context } = resumeRunSchema.parse(req.body || {});
    const resumed = await workflowRunService.resumeRun(req.params.id, context);
    res.json(resumed);
  })
);

export { router as workflowRoutes };
```

### Storage Structure

```
.veritas-kanban/
  workflows/
    feature-dev.yml
    security-audit.yml
    content-pipeline.yml
  workflow-runs/
    run_20260209_abc12345/
      run.json                  # Run state
      step-outputs/
        plan.yml                # Step outputs
        implement-0.md
        implement-1.md
        test-results.md
        pr.md
        review.md
```

### Integration with TaskService

When a workflow run completes, update the associated task:

```typescript
// In WorkflowRunService.executeRun()

if (run.status === 'completed' && run.taskId) {
  const taskService = getTaskService();
  await taskService.updateTask(run.taskId, {
    status: 'done',
    automation: {
      sessionKey: run.id,
      completedAt: run.completedAt,
      result: 'Workflow completed successfully',
    },
  });
}
```

### WebSocket Events

Broadcast workflow status updates to connected clients with **full run state** to avoid extra HTTP fetches:

```typescript
// server/src/services/broadcast-service.ts

export function broadcastWorkflowStatus(run: WorkflowRun): void {
  if (!wss) return;

  // ✅ Send the FULL WorkflowRun object (not just minimal fields)
  // This matches what WorkflowRunView expects and avoids extra HTTP calls
  const message = JSON.stringify({
    type: 'workflow:status',
    payload: {
      // Full run state
      id: run.id,
      workflowId: run.workflowId,
      workflowVersion: run.workflowVersion,
      taskId: run.taskId,
      status: run.status,
      currentStep: run.currentStep,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      error: run.error,

      // Full step details (not just stepId + status)
      steps: run.steps.map((s) => ({
        stepId: s.stepId,
        status: s.status,
        agent: s.agent,
        sessionKey: s.sessionKey,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        duration: s.duration,
        retries: s.retries,
        output: s.output,
        error: s.error,
        loopState: s.loopState,
      })),

      // Context is NOT sent (could be large/sensitive)
      // Frontend can fetch context via GET /api/workflow-runs/:id if needed
    },

    // Metadata for filtering/debugging
    meta: {
      timestamp: new Date().toISOString(),
      version: 1, // Event schema version (for future compatibility)
    },
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}
```

**Event Frequency & Debouncing**:

- **Step changes**: Emit immediately (step start, step complete, step fail)
- **Loop iterations**: Emit after each iteration completes (can be high-frequency for long loops)
- **Debouncing**: Not currently implemented — if loop steps create too many events, add a debounce layer:

```typescript
// Optional: Debounce high-frequency updates
let debounceTimer: NodeJS.Timeout | null = null;
let pendingRun: WorkflowRun | null = null;

export function broadcastWorkflowStatusDebounced(run: WorkflowRun): void {
  pendingRun = run;

  if (debounceTimer) return; // Already scheduled

  debounceTimer = setTimeout(() => {
    if (pendingRun) {
      broadcastWorkflowStatus(pendingRun);
      pendingRun = null;
    }
    debounceTimer = null;
  }, 500); // 500ms debounce window
}
```

**Frontend Integration**:

```tsx
// web/src/components/workflows/WorkflowRunView.tsx (updated)

useWebSocket({
  onMessage: (event) => {
    const message = JSON.parse(event.data);

    if (message.type === 'workflow:status' && message.payload.id === runId) {
      // ✅ Full run state is in message.payload
      setRun(message.payload);

      // No need to fetch from API — we have everything we need
    }
  },
});
```

---

## 5. Frontend Architecture

### New Pages/Components

#### 5.1 WorkflowsPage

List all available workflows.

```tsx
// web/src/pages/WorkflowsPage.tsx

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { WorkflowDefinition } from '@veritas-kanban/shared';

export function WorkflowsPage({ onBack }: { onBack: () => void }) {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/workflows')
      .then((res) => res.json())
      .then((data) => {
        setWorkflows(data);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div>Loading workflows...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Workflows</h1>
        <Button onClick={onBack}>Back to Board</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {workflows.map((workflow) => (
          <Card key={workflow.id}>
            <CardHeader>
              <CardTitle>{workflow.name}</CardTitle>
              <CardDescription>v{workflow.version}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">{workflow.description}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline">
                  View
                </Button>
                <Button size="sm">Run</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

#### 5.2 WorkflowRunView

Step-by-step progress visualization for a running workflow.

```tsx
// web/src/components/workflows/WorkflowRunView.tsx

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type { WorkflowRun, StepRun } from '@veritas-kanban/shared';
import { useWebSocket } from '@/hooks/useWebSocket';

interface Props {
  runId: string;
}

export function WorkflowRunView({ runId }: Props) {
  const [run, setRun] = useState<WorkflowRun | null>(null);

  // Subscribe to workflow status updates
  useWebSocket({
    onMessage: (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'workflow:status' && message.runId === runId) {
        // Update run state from WebSocket
        setRun((prev) => (prev ? { ...prev, ...message } : null));
      }
    },
  });

  useEffect(() => {
    // Load initial run state
    fetch(`/api/workflow-runs/${runId}`)
      .then((res) => res.json())
      .then(setRun);
  }, [runId]);

  if (!run) {
    return <div>Loading workflow run...</div>;
  }

  const completedSteps = run.steps.filter((s) => s.status === 'completed').length;
  const progress = (completedSteps / run.steps.length) * 100;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{run.workflowId}</h2>
        <Badge variant={run.status === 'running' ? 'default' : 'secondary'}>{run.status}</Badge>
      </div>

      <Progress value={progress} />

      <div className="space-y-4">
        {run.steps.map((step) => (
          <StepCard key={step.stepId} step={step} />
        ))}
      </div>

      {run.status === 'blocked' && <Button onClick={() => handleResume(run.id)}>Resume</Button>}
    </div>
  );
}

function StepCard({ step }: { step: StepRun }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{step.stepId}</CardTitle>
          <Badge
            variant={
              step.status === 'completed'
                ? 'success'
                : step.status === 'running'
                  ? 'default'
                  : step.status === 'failed'
                    ? 'destructive'
                    : 'secondary'
            }
          >
            {step.status}
          </Badge>
        </div>
      </CardHeader>
      {step.duration && (
        <CardContent>
          <p className="text-sm text-muted-foreground">Completed in {step.duration}s</p>
        </CardContent>
      )}
    </Card>
  );
}
```

#### 5.3 Integration with TaskDetailPanel

Add a "Run Workflow" button to the task detail panel:

```tsx
// web/src/components/board/TaskDetailPanel.tsx

{
  task.git && (
    <div className="mt-4">
      <Button onClick={() => startWorkflow(task.id, 'feature-dev')}>
        Run Feature Development Workflow
      </Button>
    </div>
  );
}

async function startWorkflow(taskId: string, workflowId: string) {
  const res = await fetch(`/api/workflows/${workflowId}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId }),
  });

  const run = await res.json();
  // Navigate to WorkflowRunView
  setView({ type: 'workflow-run', runId: run.id });
}
```

### Navigation Tab

Add a "Workflows" tab to the header navigation:

```tsx
// web/src/components/layout/Header.tsx

<Button
  variant="ghost"
  onClick={() => setView('workflows')}
  className={view === 'workflows' ? 'bg-accent' : ''}
>
  Workflows
</Button>
```

---

## 6. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ User                                                                │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           │ 1. Create task or click "Run Workflow"
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Frontend (React)                                                    │
│  - WorkflowsPage (list workflows)                                   │
│  - TaskDetailPanel ("Run Workflow" button)                          │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           │ 2. POST /api/workflows/:id/runs
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Server (Express)                                                    │
│  ┌────────────────────────────────────────────────────┐             │
│  │ WorkflowService                                    │             │
│  │  - loadWorkflow(id) → YAML → WorkflowDefinition    │             │
│  │  - Validate schema                                 │             │
│  └────────────────────────┬───────────────────────────┘             │
│                           │                                         │
│  ┌────────────────────────▼───────────────────────────┐             │
│  │ WorkflowRunService                                 │             │
│  │  - startRun(workflowId, taskId, context)           │             │
│  │  - Create WorkflowRun                              │             │
│  │  - Save to .veritas-kanban/workflow-runs/<id>/     │             │
│  │  - Broadcast status via WebSocket                  │             │
│  │  - executeRun() → iterate steps                    │             │
│  └────────────────────────┬───────────────────────────┘             │
│                           │                                         │
│                           │ 3. For each step                        │
│                           ▼                                         │
│  ┌────────────────────────────────────────────────────┐             │
│  │ WorkflowStepExecutor                               │             │
│  │  - executeStep(step, run)                          │             │
│  │  - Render input template (Jinja2)                  │             │
│  │  - Call OpenClaw sessions_spawn                    │             │
│  └────────────────────────┬───────────────────────────┘             │
└───────────────────────────┼─────────────────────────────────────────┘
                            │
                            │ 4. Spawn agent session
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ OpenClaw                                                            │
│  - sessions_spawn(agent, prompt, taskId)                            │
│  - Agent executes (coding, analysis, testing, etc.)                 │
│  - sessions_wait_for(sessionKey) → result                           │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         │ 5. Agent completes
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ WorkflowStepExecutor                                                │
│  - Parse agent output                                               │
│  - Write to step-outputs/<step-id>.md                               │
│  - Merge output into run.context                                    │
│  - Return to WorkflowRunService                                     │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         │ 6. Next step or complete
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ WorkflowRunService                                                  │
│  - Update run.status = 'completed'                                  │
│  - Broadcast status via WebSocket                                   │
│  - Update associated task (if taskId present)                       │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         │ 7. Real-time status updates
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Frontend (WorkflowRunView)                                          │
│  - Receives WebSocket message: workflow:status                      │
│  - Updates UI (step progress, badges, duration)                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. Integration Points

### Tasks

- **Workflow run → task creation**: When a workflow is started, optionally create a task
- **Workflow run → task update**: On completion, update task status/deliverables
- **Task → workflow trigger**: "Run Workflow" button in task detail panel

### Squad Chat

Every step posts to squad chat during execution:

```typescript
// In WorkflowStepExecutor.executeAgentStep()

await squadChatPost({
  agent: step.agent,
  message: `Starting step: ${step.name}`,
  tags: ['workflow', run.workflowId],
  model: 'gh-sonnet',
  taskTitle: run.taskId ? `Run ${run.id}` : undefined,
});
```

### Time Tracking

Each step run tracks duration — can be aggregated for task time tracking:

```typescript
const totalDuration = run.steps.reduce((sum, s) => sum + (s.duration || 0), 0);
```

### Telemetry

Emit run events:

```typescript
// On startRun()
telemetry.emit({
  type: 'run.started',
  workflowId: run.workflowId,
  runId: run.id,
  taskId: run.taskId,
  agent: 'workflow-engine',
});

// On completion
telemetry.emit({
  type: 'run.completed',
  workflowId: run.workflowId,
  runId: run.id,
  taskId: run.taskId,
  agent: 'workflow-engine',
  durationMs: Date.parse(run.completedAt) - Date.parse(run.startedAt),
  success: run.status === 'completed',
});
```

### Progress Files (#108)

Each step reads/writes `progress.md` for context passing:

```typescript
// In WorkflowStepExecutor
const progressPath = path.join(this.runsDir, run.id, run.config.progress_file || 'progress.md');
const progress = await fs.readFile(progressPath, 'utf-8').catch(() => '');
run.context.progress = progress;
```

### Acceptance Criteria (#109)

Steps can define `acceptance_criteria` — executor validates outputs:

```typescript
if (step.acceptance_criteria) {
  for (const criterion of step.acceptance_criteria) {
    if (!result.includes(criterion)) {
      throw new Error(`Acceptance criterion not met: ${criterion}`);
    }
  }
}
```

### Future Features

- **#110 (tool policies)**: Agent `role` field maps to toolPolicy
- **#111 (fresh sessions)**: `fresh_session` flag per step
- **#112 (loop steps)**: `type: loop` already designed
- **#113 (retry/escalation)**: `on_fail` policy already designed
- **#114 (dashboard)**: WorkflowRunList page (next section)

---

## 8. Implementation Phases

### Phase 1: Core Engine (Week 1-2)

**Goal**: YAML loading, sequential step execution, basic CLI.

**Deliverables**:

- [ ] `WorkflowService` — load/validate YAML
- [ ] `WorkflowRunService` — create/execute runs
- [ ] `WorkflowStepExecutor` — agent step execution (OpenClaw integration)
- [ ] Storage: `.veritas-kanban/workflows/`, `workflow-runs/`
- [ ] API routes: `GET/POST /api/workflows`, `POST /api/workflows/:id/runs`
- [ ] CLI command: `vk workflow run <workflow-id> --task=<task-id>`

**Test**: Run `feature-dev.yml` workflow from CLI, verify step outputs.

### Phase 2: Run State Management (Week 3)

**Goal**: Persistence, resume, WebSocket updates.

**Deliverables**:

- [ ] `run.json` state persistence
- [ ] `POST /api/workflow-runs/:id/resume` endpoint
- [ ] WebSocket broadcast: `workflow:status` events
- [ ] Retry/escalation policies: `on_fail` logic
- [ ] Progress file integration: read/write `progress.md`

**Test**: Start a workflow, kill the server mid-run, restart, resume from last checkpoint.

### Phase 3: Frontend (Week 4)

**Goal**: WorkflowsPage, RunView, navigation.

**Deliverables**:

- [ ] `WorkflowsPage` — list workflows, start runs
- [ ] `WorkflowRunView` — live step-by-step progress
- [ ] `WorkflowRunList` — active/completed/blocked runs
- [ ] "Run Workflow" button in TaskDetailPanel
- [ ] Navigation tab: "Workflows"

**Test**: Run a workflow from the UI, watch live updates, resume a blocked run.

### Phase 4: Advanced Features (Week 5-6)

**Goal**: Parallel steps, loops, gates.

**Deliverables**:

- [ ] Loop step execution: `type: loop`
- [ ] Gate step execution: `type: gate`
- [ ] Parallel step execution: `type: parallel` (fan-out/fan-in)
- [ ] Acceptance criteria validation
- [ ] Schema validation for step outputs

**Test**: Run `security-audit.yml` (uses loops), verify all fixes applied.

---

## 9. Open Questions

**For Brad to decide before coding begins:**

1. **OpenClaw Integration Approach**:
   - Option A: HTTP API (`POST /sessions/spawn`, `GET /sessions/:key/wait`)
   - Option B: Direct SDK (`await openclaw.spawn(...)`)
   - **Recommendation**: Start with HTTP (decoupled), migrate to SDK if performance matters

2. **Workflow Editor**:
   - Visual editor (drag-and-drop steps like GitHub Actions UI)?
   - Raw YAML editor with live preview?
   - **Recommendation**: Start with raw YAML (simpler), add visual editor in v3.1

3. **Workflow Versioning**:
   - How to handle workflow version upgrades mid-run?
   - **Recommendation**: Run always uses the version it started with (snapshot YAML in run state)

4. **Authentication**:
   - Should workflows have separate auth (workflow-specific API keys)?
   - **Recommendation**: Reuse existing VK auth (task owner = workflow runner)

5. **Concurrency**:
   - Max concurrent workflow runs globally?
   - Max concurrent steps per workflow?
   - **Recommendation**: Start with 1 concurrent workflow, 1 step at a time (serial), parallelize in Phase 4

6. **Error Handling**:
   - Should failed workflows auto-archive the task?
   - **Recommendation**: No — leave task in "blocked" status, require manual review/resume

7. **Cost Tracking**:
   - Track token usage per workflow run?
   - **Recommendation**: Yes — aggregate telemetry from all step sessions

8. **Workflow Library**:
   - Ship with built-in workflows (feature-dev, security-audit, etc.)?
   - **Recommendation**: Yes — seed `.veritas-kanban/workflows/` on first run

---

## 10. Antfarm Parity Features

### 10.1 Setup Steps

**Problem**: Antfarm has a `setup` phase before the main workflow runs (env prep, dependency install, etc.). VK workflows currently start directly with the first step.

**Solution**: Add an optional `setup` section to workflow YAML:

```yaml
id: feature-dev
name: Feature Development Workflow
version: 1

# ✅ Setup phase (runs before main steps)
setup:
  - id: prep-env
    name: 'Setup: Prepare environment'
    agent: system
    input: |
      Prepare the development environment.

      REPO: {{task.git.worktreePath}}
      BRANCH: {{task.git.branch}}

      Instructions:
      1. cd {{task.git.worktreePath}}
      2. git fetch origin
      3. git checkout {{task.git.branch}} || git checkout -b {{task.git.branch}}
      4. npm install (or yarn install)
      5. Run any pre-flight checks

      Reply with:
      STATUS: done
      ENV: <environment summary>

    on_fail:
      escalate_to: human

    timeout: 600

steps:
  # Main workflow steps (run after setup completes)
  - id: plan
    # ...
```

**Executor Logic**:

```typescript
// In WorkflowRunService.executeRun()

// Run setup steps first
if (workflow.setup && workflow.setup.length > 0) {
  for (const setupStep of workflow.setup) {
    const result = await this.stepExecutor.executeStep(setupStep, run);
    run.context[setupStep.id] = result.output;
  }
}

// Then run main steps
for (const step of workflow.steps) {
  // ...
}
```

### 10.2 Watchdogs & Step Timeouts

**Problem**: Antfarm monitors for stuck/hung steps. VK workflows currently have no timeout enforcement per step.

**Solution**: Add step-level and workflow-level timeouts with automatic escalation:

```typescript
// In WorkflowStepExecutor.executeStep()

const timeout = step.timeout || workflow.config?.timeout || 3600; // Default 1 hour

const timeoutPromise = new Promise<never>((_, reject) => {
  setTimeout(() => {
    reject(new Error(`Step ${step.id} timed out after ${timeout}s`));
  }, timeout * 1000);
});

try {
  const result = await Promise.race([this.executeAgentStep(step, run), timeoutPromise]);

  return result;
} catch (err: any) {
  if (err.message.includes('timed out')) {
    // Step timed out — handle according to on_fail policy
    log.error({ stepId: step.id, timeout }, 'Step timed out');

    if (step.on_fail?.escalate_to === 'human') {
      // Block workflow
      throw new Error(`Step ${step.id} timed out — manual intervention required`);
    } else {
      // Retry or fail
      throw err;
    }
  } else {
    throw err;
  }
}
```

**Watchdog Monitoring** (optional background job):

```typescript
// server/src/jobs/workflow-watchdog.ts

import cron from 'node-cron';
import { getWorkflowRunService } from '../services/workflow-run-service.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('workflow-watchdog');

// Run every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  const runService = getWorkflowRunService();
  const activeRuns = await runService.listRuns({ status: 'running' });

  const now = Date.now();

  for (const run of activeRuns) {
    const runningStep = run.steps.find((s) => s.status === 'running');
    if (!runningStep || !runningStep.startedAt) continue;

    const stepDuration = (now - new Date(runningStep.startedAt).getTime()) / 1000;
    const workflow = await getWorkflowService().loadWorkflow(run.workflowId);
    const stepDef = workflow?.steps.find((s) => s.id === runningStep.stepId);
    const timeout = stepDef?.timeout || workflow?.config?.timeout || 7200;

    if (stepDuration > timeout) {
      log.warn(
        {
          runId: run.id,
          stepId: runningStep.stepId,
          duration: stepDuration,
          timeout,
        },
        'Step timeout detected by watchdog'
      );

      // Mark the step as failed
      runningStep.status = 'failed';
      runningStep.error = `Timeout (${timeout}s exceeded)`;
      runningStep.completedAt = new Date().toISOString();

      // Block the workflow
      run.status = 'blocked';
      run.error = `Step ${runningStep.stepId} timed out`;

      await runService.saveRun(run);
      broadcastWorkflowStatus(run);
    }
  }
});
```

### 10.3 CLI Parity

**Problem**: Antfarm has a CLI for running workflows (`antfarm run`, `antfarm status`, `antfarm resume`). VK currently has API-only workflow control.

**Solution**: Add CLI commands for workflow management:

```bash
# List available workflows
vk workflow list

# Show workflow definition
vk workflow show <workflow-id>

# Run a workflow
vk workflow run <workflow-id> --task=<task-id>

# List active/completed runs
vk workflow runs [--status=running|completed|failed|blocked]

# Show run details
vk workflow status <run-id>

# Resume a blocked run
vk workflow resume <run-id> [--context='{"key":"value"}']

# Cancel a running workflow
vk workflow cancel <run-id>

# Cleanup old runs
vk workflow cleanup [--older-than=30d] [--dry-run]

# Validate a workflow YAML
vk workflow lint <workflow-file.yml>
```

**CLI Implementation**:

```typescript
// server/src/cli/workflow.ts

import { Command } from 'commander';
import { getWorkflowService } from '../services/workflow-service.js';
import { getWorkflowRunService } from '../services/workflow-run-service.js';
import { table } from 'table';
import chalk from 'chalk';

const workflowCmd = new Command('workflow');

// List workflows
workflowCmd
  .command('list')
  .description('List available workflows')
  .action(async () => {
    const workflows = await getWorkflowService().listWorkflows();

    console.log(
      table([
        ['ID', 'Name', 'Version', 'Steps'],
        ...workflows.map((w) => [w.id, w.name, w.version.toString(), w.steps.length.toString()]),
      ])
    );
  });

// Run a workflow
workflowCmd
  .command('run <workflow-id>')
  .option('--task <task-id>', 'Associate with a task')
  .option('--context <json>', 'Initial context (JSON)')
  .description('Start a workflow run')
  .action(async (workflowId, options) => {
    const runService = getWorkflowRunService();
    const context = options.context ? JSON.parse(options.context) : undefined;

    const run = await runService.startRun(workflowId, options.task, context);

    console.log(chalk.green(`✓ Started workflow run: ${run.id}`));
    console.log(`  Workflow: ${run.workflowId}`);
    console.log(`  Status: ${run.status}`);
    console.log(`  Task: ${run.taskId || 'none'}`);
  });

// Show run status
workflowCmd
  .command('status <run-id>')
  .description('Show workflow run status')
  .action(async (runId) => {
    const runService = getWorkflowRunService();
    const run = await runService.getRun(runId);

    if (!run) {
      console.error(chalk.red(`✗ Run ${runId} not found`));
      process.exit(1);
    }

    console.log(chalk.bold(`Workflow Run: ${run.id}`));
    console.log(`  Workflow: ${run.workflowId} (v${run.workflowVersion})`);
    console.log(`  Status: ${run.status}`);
    console.log(`  Started: ${run.startedAt}`);
    if (run.completedAt) {
      console.log(`  Completed: ${run.completedAt}`);
    }

    console.log('\nSteps:');
    console.log(
      table([
        ['Step ID', 'Status', 'Duration', 'Retries'],
        ...run.steps.map((s) => [
          s.stepId,
          s.status,
          s.duration ? `${s.duration}s` : '-',
          s.retries.toString(),
        ]),
      ])
    );
  });

// Resume a blocked run
workflowCmd
  .command('resume <run-id>')
  .option('--context <json>', 'Resume context (JSON)')
  .description('Resume a blocked workflow run')
  .action(async (runId, options) => {
    const runService = getWorkflowRunService();
    const context = options.context ? JSON.parse(options.context) : undefined;

    const run = await runService.resumeRun(runId, context);

    console.log(chalk.green(`✓ Resumed workflow run: ${run.id}`));
  });

export { workflowCmd };
```

## 11. Divergences from Antfarm

| Aspect              | Antfarm (Ralph)                                 | Veritas Kanban                  | Reasoning                             |
| ------------------- | ----------------------------------------------- | ------------------------------- | ------------------------------------- |
| **Context Model**   | Ralph loop (shared git history + progress file) | Fresh OpenClaw session per step | VK is multi-project, not single-repo  |
| **Agent Memory**    | Git commits + progress.md                       | Step outputs in workflow-runs/  | Explicit state > implicit git log     |
| **Retry Mechanism** | Explicit verify step + retry loop               | Declarative `on_fail` policy    | More flexible (retry different steps) |
| **Storage**         | In-repo files                                   | `.veritas-kanban/` directory    | Separation of concerns                |
| **Templating**      | Basic string interpolation                      | Jinja2 templates                | More expressive (loops, filters)      |
| **Execution Model** | CLI-driven (antfarm run)                        | API + UI-driven                 | Multi-user, real-time UI              |

---

## Appendix: Key Architectural Decisions

### 1. YAML Over Database

**Decision**: Workflows are version-controlled YAML files, not database records.

**Rationale**:

- Git-friendly (diff, merge, revert)
- Portable (copy workflows between VK instances)
- Human-readable (easy to review, audit)
- No schema migration pain

### 2. Fresh Sessions by Default

**Decision**: Each step spawns a fresh OpenClaw session unless `fresh_session: false`.

**Rationale**:

- Avoids context pollution (agent doesn't carry mistakes forward)
- More deterministic (same step → same result)
- Better error isolation (one step failure doesn't corrupt others)

**Trade-off**: More token usage (no context reuse). Mitigated by progress files.

### 3. Jinja2 for Templating

**Decision**: Use Jinja2 for input templates and expressions.

**Rationale**:

- Familiar syntax (Python/Ansible community)
- Powerful (loops, filters, conditionals)
- Safe (sandboxed evaluation)

**Alternative considered**: JavaScript template literals (rejected — security risk)

### 4. Explicit Retry Policies

**Decision**: Every step defines `on_fail` with retry/escalation logic.

**Rationale**:

- No silent failures
- Workflow author makes the decision (not the engine)
- Different steps need different policies (e.g., critical steps escalate immediately)

### 5. Step Outputs as Files

**Decision**: Step outputs written to `step-outputs/<step-id>.md`, not in-memory only.

**Rationale**:

- Observable (inspect outputs mid-run)
- Resumable (reload outputs after restart)
- Debuggable (see exactly what each agent produced)

---

**End of Architecture Document**

This document should be sufficient for a developer to implement the workflow engine from scratch. Next steps: Brad reviews, approves, then implementation begins with Phase 1.

# SOP: OpenAI Codex Integration

Use this playbook when Veritas Kanban delegates work to OpenAI Codex. v4.2 includes local Codex CLI execution through `codex exec` and SDK-backed local Codex sessions; Cloud delegation, workflow-engine execution, review actions, and richer Settings checks continue through the v4.2 patch train.

---

## Roles

| Role                     | Responsibilities                                                                  |
| ------------------------ | --------------------------------------------------------------------------------- |
| **Human / PM**           | Defines task scope, confirms Codex mode, reviews outputs, approves final merge.   |
| **Veritas Orchestrator** | Creates worktree, selects provider, starts attempt, tracks status/logs/telemetry. |
| **Codex Worker**         | Implements, tests, reports final summary, and leaves useful run evidence.         |
| **Reviewer Agent**       | Performs cross-model review when Codex authored code or reviewed another agent.   |

---

## Codex Modes

| Mode               | Use When                                          | Provider Shape                       |
| ------------------ | ------------------------------------------------- | ------------------------------------ |
| **Codex CLI**      | Local task execution and deterministic automation | `codex exec --json` in task worktree |
| **Codex SDK**      | Long-lived local threads and follow-up sessions   | `@openai/codex-sdk` server adapter   |
| **Codex Cloud**    | Background PR-oriented work through GitHub        | GitHub issue/PR comment delegation   |
| **Codex Review**   | Review task branches, PR diffs, or failed changes | CLI/SDK review action                |
| **Workflow Codex** | Pipeline steps in Veritas workflow definitions    | Provider-backed workflow step        |

Default for v4.2 is **Codex CLI**. Use **Codex SDK** when a task needs a durable local thread ID for follow-up prompts or richer session continuity.

---

## Lifecycle Overview

| Stage        | Action                                                                 | Required? |
| ------------ | ---------------------------------------------------------------------- | --------- |
| 0. Configure | Add Codex agent profile and verify `codex` install/auth.               | Yes       |
| 1. Prepare   | Create or verify task worktree; render task prompt.                    | Yes       |
| 2. Start     | Veritas starts provider attempt and marks task `in-progress`.          | Yes       |
| 3. Run       | Codex executes with scoped prompt and emits progress/log events.       | Yes       |
| 4. Observe   | Veritas maps JSONL/SDK events into attempt logs, activity, telemetry.  | Yes       |
| 5. Complete  | Veritas records final summary, deliverables, usage, and task outcome.  | Yes       |
| 6. Review    | Opposite-model review runs for code or high-risk changes.              | For code  |
| 7. Close     | Human or automation approves, merges, archives, or creates follow-ups. | Yes       |

---

## Local Codex CLI Flow

Recommended provider command shape:

```bash
codex exec \
  --cwd "<task-worktree>" \
  --sandbox workspace-write \
  --json \
  --output-last-message ".veritas-kanban/codex/<attempt-id>/final.md" \
  "<rendered task prompt>"
```

Recommended environment:

```bash
export VK_API_URL="http://localhost:3001"
export VK_API_KEY="<agent-role-key-if-auth-required>"
export CODEX_API_KEY="<optional-api-key-for-automation>"
```

### Veritas Behavior

1. Resolve the selected agent to a provider: `codex-cli`.
2. Create an attempt with provider metadata:
   ```json
   {
     "agent": "codex",
     "provider": "codex-cli",
     "model": "gpt-5.5",
     "sandbox": "workspace-write"
   }
   ```
3. Run Codex in the task worktree.
4. Parse JSONL events:
   - `thread.started`
   - `turn.started`
   - `item.started`
   - `item.completed`
   - `turn.completed`
   - `turn.failed`
   - `error`
5. Append human-readable attempt logs.
6. Preserve final response as the completion summary.
7. Emit telemetry and token usage when available.

---

## Codex SDK Flow

Use SDK mode when the user needs a durable local Codex thread across multiple prompts:

```ts
import { Codex } from '@openai/codex-sdk';

const codex = new Codex({ env: { VK_API_URL: 'http://localhost:3001' } });
const thread = codex.startThread({
  workingDirectory: '<task-worktree>',
  sandboxMode: 'workspace-write',
  approvalPolicy: 'never',
  networkAccessEnabled: true,
});
const result = await thread.run('Implement the Veritas task in the current worktree.');
```

Veritas persists the Codex thread ID in attempt metadata:

```json
{
  "agent": "codex-sdk",
  "provider": "codex-sdk",
  "model": "gpt-5.5",
  "threadId": "thread_..."
}
```

### SDK Session Rules

- Use fresh threads for independent task attempts.
- Reuse a thread only when the task explicitly needs follow-up work.
- Store thread IDs in attempt metadata, not task prose.
- Surface SDK availability errors clearly in Settings and attempt logs.

---

## Codex Cloud Delegation

Use cloud delegation when the desired output is a GitHub issue/PR workflow rather than direct local worktree execution.

Recommended prompt pattern:

```text
@codex Please work on this Veritas Kanban task.

Task: <id> - <title>
Repository: <owner/repo>
Branch/base: <base>
Acceptance criteria:
- <criterion>
- <criterion>

Veritas context:
- Task URL: <local or GitHub-linked URL>
- Related files:
- Required checks:

Please open a PR and include a concise implementation summary, tests run, and any follow-up risks.
```

Veritas should link the GitHub artifact back to the task and track cloud delegation as a provider attempt, even if execution happens outside the local runtime.

---

## MCP Setup For Codex

Codex should be able to use the Veritas MCP server when configured:

```bash
codex mcp add veritas-kanban \
  --env VK_API_URL=http://localhost:3001 \
  -- node /absolute/path/to/veritas-kanban/mcp/dist/index.js
```

Production or remote API mode:

```bash
codex mcp add veritas-kanban \
  --env VK_API_URL=https://kanban.example.com \
  --env VK_API_KEY=<agent-role-key> \
  -- node /absolute/path/to/veritas-kanban/mcp/dist/index.js
```

Recommended companion:

```bash
codex mcp add openaiDeveloperDocs --url https://developers.openai.com/mcp
```

---

## AGENTS.md Codex Snippet

Add this to a repository where Codex will work with Veritas:

```md
## Veritas Kanban Protocol

When working on Veritas Kanban tasks:

1. Treat Veritas Kanban as the source of truth for task state.
2. Before implementation, inspect the task, acceptance criteria, worktree, and related docs.
3. Move the task to `in-progress` and ensure an attempt is tracked.
4. Keep notes in task comments or progress files when findings affect future work.
5. Run relevant tests/checks before completion.
6. Report final summary, files changed, tests run, risks, and follow-ups.
7. For code changes, request cross-model review before final completion.
8. Use the Veritas MCP server when available instead of ad hoc HTTP calls.

For OpenAI product/API questions, use the OpenAI developer documentation MCP server first.
```

---

## Telemetry Mapping

| Codex Signal              | Veritas Destination                |
| ------------------------- | ---------------------------------- |
| Thread started            | Attempt metadata                   |
| Turn started/completed    | Attempt status + run duration      |
| Agent message             | Attempt log                        |
| Command execution         | Attempt log + activity event       |
| File change               | Attempt log + possible deliverable |
| MCP tool call             | Attempt log + trace                |
| Final response            | Completion summary                 |
| Usage tokens              | `run.tokens` telemetry             |
| Error/failed turn/process | Failed attempt + failure alert     |

If `autoTelemetry` is enabled, avoid double-emitting lifecycle events. Token usage should still be reported when Codex provides usage data.

---

## Review Rules

| Author       | Reviewer Recommendation                            |
| ------------ | -------------------------------------------------- |
| Codex        | Claude, Gemini, or another non-Codex reviewer      |
| Claude       | Codex review or GPT-family reviewer                |
| Human        | Codex review for complex code or high-risk changes |
| Codex review | Human adjudicates blocking findings                |

Follow [SOP-cross-model-code-review.md](SOP-cross-model-code-review.md) for scoring, findings, and final gate handling.

---

## Workflow Engine Rules

Codex workflow steps should:

- run through the provider abstraction
- receive rendered workflow context and progress notes
- write real step outputs
- respect configured concurrency limits
- fail visibly with retryable error metadata
- keep placeholder execution only for test/mock mode

Example step:

```yaml
steps:
  - id: implement
    type: agent
    agent: codex
    input: |
      Implement {{ task.title }} in the task worktree.
      Acceptance criteria:
      {{ task.acceptanceCriteria }}
```

---

## Escalation

| Scenario                             | Action                                                        |
| ------------------------------------ | ------------------------------------------------------------- |
| Codex auth unavailable               | Mark attempt failed with setup guidance; do not retry blindly |
| Codex command exits non-zero         | Preserve stderr/JSONL and create failure alert                |
| Codex changes files outside worktree | Stop attempt and flag for human review                        |
| Codex reports ambiguous completion   | Leave task in `in-progress` and request clarification         |
| Review finds blocking issue          | Create fix subtasks and keep original task blocked            |
| Cloud delegation produces stale PR   | Sync GitHub status and create local follow-up task            |

---

## Release QA

Before v4.2 ships:

- Run one mocked CLI provider success case in CI.
- Run one mocked CLI provider failure case in CI.
- Run one real local Codex code task manually.
- Run one Codex review manually.
- Run one workflow-engine Codex step manually.
- Verify Settings detects install/auth state.
- Verify attempt logs, telemetry, and final summaries render correctly.

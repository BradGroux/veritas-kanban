# SOP: OpenAI Codex Integration

Use this playbook when Veritas Kanban delegates work to OpenAI Codex. v4.3 includes local Codex CLI execution through `codex exec`, SDK-backed local Codex sessions, GitHub-native Codex Cloud delegation, workflow-engine Codex steps, Codex review actions, richer Settings health checks, provider adapters, Codex event mapping, and mocked runner coverage.

---

## Roles

| Role                     | Responsibilities                                                                  |
| ------------------------ | --------------------------------------------------------------------------------- |
| **Human / PM**           | Defines task scope, confirms Codex mode, reviews outputs, approves final merge.   |
| **Veritas Orchestrator** | Creates worktree, selects provider, starts attempt, tracks status/logs/telemetry. |
| **Codex Worker**         | Implements, tests, reports final summary, and leaves useful run evidence.         |
| **Reviewer Agent**       | Performs an independent review when the task or governance policy requires one.   |

---

## Codex Modes

| Mode               | Use When                                          | Provider Shape                       |
| ------------------ | ------------------------------------------------- | ------------------------------------ |
| **Codex CLI**      | Local task execution and deterministic automation | `codex exec --json` in task worktree |
| **Codex SDK**      | Long-lived local threads and follow-up sessions   | `@openai/codex-sdk` server adapter   |
| **Codex Cloud**    | Background PR-oriented work through GitHub        | GitHub issue/PR comment delegation   |
| **Codex Review**   | Review task branches, PR diffs, or failed changes | CLI/SDK review action                |
| **Workflow Codex** | Pipeline steps in Veritas workflow definitions    | Provider-backed workflow step        |

Default for v4.3 is **Codex CLI**. Use **Codex SDK** when a task needs a durable local thread ID for follow-up prompts or richer session continuity.

---

## Lifecycle Overview

| Stage        | Action                                                                  | Required?   |
| ------------ | ----------------------------------------------------------------------- | ----------- |
| 0. Configure | Add Codex agent profile and verify `codex` install/auth.                | Yes         |
| 1. Prepare   | Create or verify task worktree; render task prompt.                     | Yes         |
| 2. Start     | Veritas starts provider attempt and marks task `in-progress`.           | Yes         |
| 3. Run       | Codex executes with scoped prompt and emits progress/log events.        | Yes         |
| 4. Observe   | Veritas maps JSONL/SDK events into attempt logs, activity, telemetry.   | Yes         |
| 5. Complete  | Veritas records final summary, deliverables, usage, and task outcome.   | Yes         |
| 6. Review    | Independent review runs when required by the task or governance policy. | Conditional |
| 7. Close     | Human or automation approves, merges, archives, or creates follow-ups.  | Yes         |

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

When the selected agent profile has `sandboxPresetId`, Veritas validates the
policy before launch and derives the effective Codex sandbox arguments and
environment passthrough from that preset. Required unsupported controls block
the attempt before Codex starts; advisory controls continue with warnings and a
redacted governance trace.

### Veritas Behavior

1. Resolve the selected agent to a provider: `codex-cli`.
2. Dry-run the selected sandbox policy preset when one is assigned.
3. Create an attempt with provider metadata:
   ```json
   {
     "agent": "codex",
     "provider": "codex-cli",
     "model": "gpt-5.5",
     "sandbox": "workspace-write"
   }
   ```
4. Run Codex in the task worktree.
5. Parse JSONL events:
   - `thread.started`
   - `turn.started`
   - `item.started`
   - `item.completed`
   - `turn.completed`
   - `turn.failed`
   - `error`
6. Append human-readable attempt logs.
7. Preserve final response as the completion summary.
8. Let Veritas project lifecycle telemetry and provider-reported token usage;
   do not emit duplicate events from the managed Codex run.

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

Codex SDK starts use the same preset dry-run path as CLI starts. Prefer SDK mode
for required network disablement because the SDK supports that control directly.

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

Veritas endpoint:

```bash
curl -X POST http://localhost:3001/api/github/codex/delegate \
  -H "Content-Type: application/json" \
  -d '{"taskId":"task_123","target":"issue"}'
```

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

Veritas links the GitHub artifact back to the task and tracks cloud delegation as a provider attempt, even though execution happens outside the local runtime.

Attempt metadata:

```json
{
  "agent": "codex-cloud",
  "provider": "codex-cloud",
  "status": "pending",
  "cloudTarget": "issue",
  "cloudUrl": "https://github.com/owner/repo/issues/123"
}
```

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

## AGENTS.md managed-run snippet

Use the harness-neutral managed-run block from
[AGENTS-TEMPLATE.md](AGENTS-TEMPLATE.md). Codex does not need a separate VK
lifecycle protocol:

```md
## Veritas Kanban managed-run protocol

1. Treat the supplied task envelope as authoritative.
2. Work only in the assigned worktree and obey its commit policy.
3. Use only the run-scoped tools and credentials supplied by Veritas.
4. Do not register, heartbeat, start, complete, or emit telemetry manually.
5. Do not call `vk begin` or `vk done`; Veritas already owns the attempt.
6. Run focused verification that matches the requested change.
7. Return the outcome, changed files or artifacts, checks, risks, and blockers
   through the normal Codex final response.
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

## Optional review rules

Independent review is not a default completion gate. Enable it only when the
task, configured review gate, issue owner, or release owner requires it.

When required, follow
[SOP-cross-model-code-review.md](SOP-cross-model-code-review.md) for scoring,
findings, and final gate handling.

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

Before v4.3 ships:

- Run one mocked CLI provider success case in CI.
- Run one mocked CLI provider failure case in CI.
- Run one real local Codex code task manually.
- Run one Codex review manually.
- Run one workflow-engine Codex step manually.
- Verify Settings detects install/auth state.
- Verify attempt logs, telemetry, and final summaries render correctly.

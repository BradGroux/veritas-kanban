# Codex Workflow Examples

Use these recipes as starting points for v4.2 OpenAI Codex workflows in Veritas Kanban. They follow the same pattern as the broader [agent workflow examples](EXAMPLES-agent-workflows.md): clear task, scoped prompt, observable execution, review, and durable output.

---

## 1. Local Codex Feature Task

**Goal:** Let Codex implement a small feature in an isolated task worktree.

1. Create the task:

   ```bash
   vk create "Feature: Add retry button to failed workflow runs" \
     --project veritas-kanban \
     --type code \
     --priority high
   ```

2. Create or verify the worktree from the task Git tab.

3. Start Codex from the UI or API with agent `codex`.

4. Provider prompt:

   ```text
   Implement task <id>: Add retry button to failed workflow runs.

   Acceptance criteria:
   - Failed workflow runs show a retry action.
   - Retry uses the existing workflow run API.
   - Add focused tests for the retry path.
   - Update docs if the user-facing workflow changes.

   Work only in the task worktree. Run the relevant tests before summarizing.
   ```

5. Expected outputs:
   - attempt log with command/file-change events
   - final Codex summary
   - test command output
   - task comment or deliverable listing changed files

6. Review:
   - Create a cross-model review task.
   - Assign it to a non-Codex reviewer.

---

## 2. Codex Review Of A Claude-authored PR

**Goal:** Use Codex as the opposite-model reviewer for a Claude-authored branch.

1. Keep the original implementation task `in-progress`.
2. Trigger a Codex review action:

   ```bash
   curl -X POST http://localhost:3001/api/diff/<task-id>/codex-review \
     -H "Content-Type: application/json" \
     -d '{"instructions":"Apply docs/SOP-cross-model-code-review.md. Focus on regressions and missing tests."}'
   ```

3. Codex reviews the task branch diff in read-only mode:

   ```text
   Review branch <branch> against main.

   Apply docs/SOP-cross-model-code-review.md.
   Focus on:
   - provider abstraction correctness
   - process execution safety
   - cancellation and timeout handling
   - test coverage gaps
   - backwards compatibility with OpenClaw

   Return findings grouped by severity with file/line references where possible.
   ```

4. Expected outputs:
   - review findings as Veritas review comments
   - verdict: approve or changes required
   - follow-up subtasks for confirmed issues

---

## 3. Codex SDK Follow-up Session

**Goal:** Continue a Codex task after human feedback without losing context.

1. Start the initial task in SDK provider mode.
2. Veritas stores the Codex thread ID in attempt metadata as `threadId`.
3. Human adds a task comment:

   ```text
   Please keep the provider API smaller. Move Codex-specific JSONL parsing into its own module.
   ```

4. Veritas resumes the SDK thread with:

   ```text
   Continue task <id>. Address the latest human feedback:
   - Keep provider API smaller.
   - Move Codex-specific JSONL parsing into its own module.

   Preserve existing behavior and tests.
   ```

5. Expected outputs:
   - same Codex thread continues
   - attempt log includes `thread.started`, item, turn, and usage events
   - final summary explains the delta from the first pass

---

## 4. Workflow Engine: Plan -> Codex Implement -> Review

**Goal:** Use Codex as one step in a repeatable workflow pipeline.

```yaml
id: codex-feature-dev
name: Codex Feature Development
agents:
  - id: planner
    name: Planner
    role: planner
  - id: codex
    name: Codex
    role: developer
    provider: codex-sdk
    model: gpt-5.5
  - id: reviewer
    name: Reviewer
    role: reviewer

steps:
  - id: plan
    type: agent
    agent: planner
    input: |
      Produce an implementation plan for {{ task.title }}.

  - id: implement
    type: agent
    agent: codex
    depends_on: [plan]
    input: |
      Implement the approved plan for {{ task.title }}.
      Use the task worktree and run relevant tests.

  - id: review
    type: agent
    agent: reviewer
    depends_on: [implement]
    input: |
      Review Codex's implementation using docs/SOP-cross-model-code-review.md.
```

Expected behavior:

- `plan` writes a step output.
- `implement` runs through the Codex provider.
- `review` runs through the configured reviewer provider.
- The workflow run stores real outputs, not placeholder text.

---

## 5. Codex Cloud Delegation Through GitHub

**Goal:** Send a Veritas task to Codex Cloud when the desired output is a GitHub PR.

1. Create or select a Veritas task.
2. Use the task action: **Delegate to Codex Cloud**.
3. Veritas creates a GitHub issue or PR comment:

   ```text
   @codex Please implement this Veritas task.

   Task: task_20260506_codex - Add Codex settings health checks
   Acceptance criteria:
   - Settings can detect codex binary availability.
   - Settings can show auth status without exposing secrets.
   - Tests cover missing binary and authenticated states.

   Please open a PR with implementation summary and tests run.
   ```

4. Veritas stores:
   - GitHub issue/PR URL
   - provider mode `codex-cloud`
   - delegation timestamp
   - sync status
   - cloud attempt metadata (`cloudTarget`, `cloudUrl`)

5. Human reviews the Codex Cloud PR and links it back to the Veritas task.

---

## 6. Codex MCP-first Board Maintenance

**Goal:** Give Codex structured access to Veritas rather than raw HTTP commands.

1. Configure MCP:

   ```bash
   codex mcp add veritas-kanban \
     --env VK_API_URL=http://localhost:3001 \
     -- node /absolute/path/to/veritas-kanban/mcp/dist/index.js
   ```

2. Prompt:

   ```text
   Use the Veritas MCP tools to:
   - list blocked high-priority tasks
   - summarize why each is blocked
   - propose one next action per task
   - create follow-up tasks only when the blocker is actionable
   ```

3. Expected outputs:
   - no browser scraping
   - structured task reads through MCP
   - task updates/comments through MCP tools
   - summary saved as a Veritas comment or daily standup note

---

## 7. Release QA Smoke Test

**Goal:** Prove the Codex integration is ready for v4.2.

Checklist:

- [ ] Settings detects installed `codex`.
- [ ] Settings reports missing/authenticated state correctly.
- [ ] Mocked Codex CLI provider passes CI.
- [ ] Mocked Codex SDK provider records `threadId` and token usage.
- [ ] Real Codex CLI task completes locally.
- [ ] Real Codex SDK task completes locally when SDK credentials are available.
- [ ] Attempt log includes final summary and command/file events.
- [ ] Token usage appears when Codex provides usage data.
- [ ] Codex review produces findings on a known diff.
- [ ] Workflow engine runs a Codex-backed step.
- [ ] Docs mention known limitations.

Completion summary template:

```text
Codex v4.2 QA complete.

Validated:
- Local task execution:
- Review flow:
- Workflow step:
- Telemetry/logs:
- Settings:

Known risks:
- ...
```

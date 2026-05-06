# OpenAI Codex Integration Roadmap

Release target: **Veritas Kanban v4.2**

This roadmap tracks the first-class OpenAI Codex integration work for Veritas Kanban. v4.2 now includes local `codex exec` execution, SDK-backed local Codex sessions, GitHub-native Codex Cloud delegation, Codex-backed workflow-engine steps, and Codex review actions. The remaining work expands that foundation into deeper Settings health checks.

Companion docs:

- [SOP: OpenAI Codex Integration](SOP-codex-integration.md)
- [Codex Workflow Examples](EXAMPLES-codex-workflows.md)
- [SOP: Cross-Model Code Review](SOP-cross-model-code-review.md)
- [AGENTS.md Template](AGENTS-TEMPLATE.md)

## Product Goal

Veritas Kanban should become the local-first command center for Codex-backed software work:

- Start Codex on a Veritas code task from the UI or API.
- Run Codex inside the task worktree with tracked status, logs, outputs, and telemetry.
- Use Codex in workflow-engine agent steps.
- Let Codex use the Veritas MCP server and project instructions.
- Support advanced Codex SDK sessions and optional cloud delegation.
- Preserve Veritas guardrails, task history, attempts, deliverables, and review flows.

## Integration Modes

### Codex CLI Provider

The first implementation path uses `codex exec` because it is designed for automation and can emit JSONL events. Veritas launches it inside the task worktree, streams progress into attempt logs, parses usage events, and completes the task from the final Codex result.

Recommended default shape:

```bash
codex exec --cwd <task-worktree> --sandbox workspace-write --json <prompt>
```

### Codex SDK Provider

The SDK path supports long-lived local Codex threads, resumable session IDs, and richer follow-up workflows. Veritas starts `@openai/codex-sdk` threads in the task worktree, streams SDK events into attempt logs, emits token telemetry, and persists the SDK `threadId` on the active/completed attempt.

Recommended default shape:

```ts
const thread = codex.startThread({
  workingDirectory: '<task-worktree>',
  sandboxMode: 'workspace-write',
  approvalPolicy: 'never',
  networkAccessEnabled: true,
});
```

### Codex Cloud Delegation

Cloud delegation starts through GitHub-native workflows: Veritas can create or comment on GitHub issues/PRs with scoped `@codex` prompts, then sync links and outcomes back into the task. If official cloud APIs become available, they can be added behind the same provider boundary.

API shape:

```http
POST /api/github/codex/delegate
```

```json
{
  "taskId": "task_...",
  "target": "issue",
  "model": "gpt-5.5"
}
```

## Architecture Direction

v4.2 starts with a focused provider seam inside the existing agent service instead of a full rewrite. `codex` agents resolve to the local Codex CLI runner, `codex-sdk` agents resolve to the SDK session runner, `codex-cloud` uses GitHub-native delegation, and existing agents keep the OpenClaw request-file behavior. A fuller provider abstraction is still tracked for workflow and review execution.

Expected long-term provider capabilities:

- `start`
- `stop`
- `status`
- `stream logs`
- `complete/fail`
- optional `resume`
- optional `review`
- optional `cloudDelegate`

The provider abstraction should support:

- OpenClaw compatibility through an OpenClaw provider adapter.
- Codex CLI through a local process provider.
- Codex SDK through the implemented thread/session provider.
- Codex Cloud through GitHub issue/PR delegation.
- Future providers without route-level branching.

## Telemetry And Logs

Codex JSONL should be normalized into Veritas concepts:

- agent messages
- reasoning and progress updates
- command executions
- file changes
- MCP tool calls
- web searches
- final summaries
- token usage from completed turns when available

Attempt logs should remain readable markdown, while raw JSONL can be retained where it helps debugging.

## Workflow Engine

Workflow agent steps execute through provider-aware step handling. Codex-backed steps support:

- fresh sessions
- resumable sessions when using SDK mode
- step output files
- retry and failure handling through the workflow runner
- tool-policy hints in prompt/config where direct enforcement is unavailable

Workflow agents can opt into Codex with provider metadata:

```yaml
agents:
  - id: codex
    name: Codex
    role: implementer
    provider: codex-sdk
    model: gpt-5.5
    description: Codex workflow implementer
```

## Review Actions

Codex review actions run against the task worktree diff in read-only SDK mode and map structured findings into Veritas review comments:

```http
POST /api/diff/<taskId>/codex-review
```

```json
{
  "model": "gpt-5.5",
  "instructions": "Focus on regressions and missing tests.",
  "save": true
}
```

## MCP And Project Instructions

v4.2 should make Veritas MCP setup easy for Codex:

```bash
codex mcp add veritas-kanban --env VK_API_URL=http://localhost:3001 -- node /absolute/path/to/veritas-kanban/mcp/dist/index.js
```

The docs should also provide an `AGENTS.md` pattern that teaches Codex the Veritas task lifecycle: begin work, update task state, log findings, report deliverables, run checks, summarize completion, and keep the board as source of truth.

## v4.2 Issue Track

- [#298](https://github.com/BradGroux/veritas-kanban/issues/298) - v4.2 Epic: Build first-class OpenAI Codex support
- [#299](https://github.com/BradGroux/veritas-kanban/issues/299) - Add agent provider abstraction for OpenClaw, Codex CLI, Codex SDK, and future agents
- [#300](https://github.com/BradGroux/veritas-kanban/issues/300) - Implement local Codex CLI adapter using codex exec JSONL events
- [#301](https://github.com/BradGroux/veritas-kanban/issues/301) - Add Codex SDK provider for long-lived local threads and richer session control
- [#302](https://github.com/BradGroux/veritas-kanban/issues/302) - Support Codex Cloud delegation through GitHub issue/PR workflows
- [#303](https://github.com/BradGroux/veritas-kanban/issues/303) - Build Codex settings UX for profiles, auth checks, sandbox mode, model, and provider mode
- [#304](https://github.com/BradGroux/veritas-kanban/issues/304) - Map Codex logs, JSONL events, token usage, and artifacts into Veritas telemetry
- [#305](https://github.com/BradGroux/veritas-kanban/issues/305) - Make Veritas MCP and AGENTS.md setup first-class for Codex
- [#306](https://github.com/BradGroux/veritas-kanban/issues/306) - Execute workflow engine agent steps through provider adapters including Codex
- [#307](https://github.com/BradGroux/veritas-kanban/issues/307) - Add Codex review and PR automation workflows
- [#308](https://github.com/BradGroux/veritas-kanban/issues/308) - Write v4.2 Codex documentation, examples, and release notes
- [#309](https://github.com/BradGroux/veritas-kanban/issues/309) - Create Codex test harness, mocked runners, E2E coverage, and v4.2 release QA checklist

## Documentation Pass

The v4.2 docs should land with the implementation, not after it. Required documentation updates:

- Codex integration roadmap: architecture and release scope.
- Codex SOP: operational playbook for CLI, SDK, Cloud, MCP, telemetry, reviews, and workflow execution.
- Codex examples: copy/pasteable task, review, SDK, Cloud, MCP, and workflow recipes.
- README documentation map.
- FEATURES entry for Codex provider support.
- MCP guide with Codex setup.
- API reference for provider fields and Codex-specific routes.
- CLI guide if a setup/check helper is added.
- AGENTS.md template with Codex-specific lifecycle instructions and MCP commands.
- Release notes with known limitations and QA evidence.

## Release Acceptance

v4.2 is done when:

- Codex can complete a Veritas code task from the UI or API through the local CLI provider.
- Codex can run as a workflow-engine agent step.
- Codex logs, final output, and token usage appear in Veritas attempt and telemetry surfaces.
- Codex setup has first-class Settings UX and docs.
- Veritas MCP setup for Codex is documented and smoke-tested.
- CI includes mocked Codex coverage.
- Manual release QA includes one real local Codex task, one Codex review, and one Codex workflow step.

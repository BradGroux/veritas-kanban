# OpenAI Codex Integration

Veritas Kanban includes local `codex exec` execution, SDK-backed local Codex sessions, a supervised Codex app-server adapter, GitHub-native Codex Cloud delegation, Codex-backed workflow-engine steps, review actions, Settings health checks, provider adapters, event mapping, and mocked runner coverage.

Companion docs:

- [SOP: OpenAI Codex Integration](SOP-codex-integration.md)
- [Codex Workflow Examples](EXAMPLES-codex-workflows.md)
- [Optional Independent Code Review](SOP-cross-model-code-review.md)
- [AGENTS.md Template](AGENTS-TEMPLATE.md)

## Product Scope

Veritas Kanban is a local-first command center for Codex-backed software work:

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

When a Codex agent profile or workflow agent has `sandboxPresetId`, Veritas
dry-runs the sandbox policy before launching the CLI process. The resulting
filesystem mode, network posture, and environment passthrough are applied where
the provider supports them. Required unsupported controls fail closed before
execution and write a redacted `sandbox-policy` governance trace.

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

The SDK provider also honors sandbox policy presets. This is the preferred path
for deny-by-default network policies because the SDK capability check supports
network disablement, whereas the CLI path is limited to the controls exposed by
`codex exec`.

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

## Architecture

Executable task providers resolve through the dedicated
`AgentProviderAdapterRegistry`. The registry owns exact provider selection,
task-envelope rendering, runtime probing, run-event mapping, start dispatch,
and stop semantics. `ClawdbotAgentService` supplies shared admission,
supervision, journaling, budget, and completion effects without selecting an
implicit fallback adapter.

`codex` agents resolve to the local Codex CLI runner, `codex-sdk` agents resolve
to the SDK session runner, and `codex-cloud` uses GitHub-native delegation.
OpenClaw task dispatch uses the gateway `sessions_spawn` path and persists the
returned session identity on the active attempt.

Provider capabilities include:

- `start`
- `stop`
- `status`
- `stream logs`
- `complete/fail`
- optional `resume`
- optional `review`
- optional `cloudDelegate`

The provider adapter interface supports:

- OpenClaw compatibility through an OpenClaw provider adapter.
- Codex CLI through a local process provider.
- Codex SDK through the implemented thread/session provider.
- Codex Cloud through GitHub issue/PR delegation.
- Additional providers can be added without route-level branching.

## Telemetry And Logs

Codex JSONL is normalized into Veritas concepts:

- agent messages
- reasoning and progress updates
- command executions
- file changes
- MCP tool calls
- web searches
- final summaries
- token usage from completed turns when available

Attempt logs remain readable Markdown, while raw JSONL can be retained where it helps debugging.

## Workflow Engine

Workflow agent steps execute through provider-aware step handling. Codex-backed steps support:

- fresh sessions
- resumable sessions when using SDK mode
- step output files
- retry and failure handling through the workflow runner
- tool-policy hints in prompt/config where direct enforcement is unavailable
- per-agent `sandboxPresetId` launch guardrails

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

Workflow definitions should normally omit `command` for Codex agents. Command overrides are
rejected unless they are `codex`, match `VERITAS_CODEX_EXECUTABLE` or `CODEX_PATH`, or the server
is intentionally started with `VERITAS_ALLOW_UNSAFE_CODEX_COMMAND_OVERRIDES=1`.

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

## Settings Health

Settings exposes Codex readiness through a dedicated health check:

```http
GET /api/settings/codex/health
```

The response reports Codex CLI install/version/auth state, the installed Codex
SDK version and import availability, Codex agent profile readiness, enabled
Codex profiles, and recommendations. Veritas Kanban currently validates its
stream adapter against `@openai/codex-sdk` 0.149.0 event contracts.

## MCP And Project Instructions

Configure Veritas MCP for Codex with:

```bash
codex mcp add veritas-kanban --env VK_API_URL=http://localhost:3001 -- node /absolute/path/to/veritas-kanban/mcp/dist/index.js
```

Use the [AGENTS.md Template](AGENTS-TEMPLATE.md) to teach Codex the Veritas task lifecycle: begin work, update task state, log findings, report deliverables, run checks, summarize completion, and keep the board as source of truth.

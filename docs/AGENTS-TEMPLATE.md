# Agent Guide and `AGENTS.md` Template

Use this guide when an agent needs to work through Veritas Kanban. Start by
choosing the correct integration mode. Managed harnesses and external
self-reporting agents have different lifecycle responsibilities.

## Choose the integration mode

| Mode                          | Use it when                                                                                     | Who owns task lifecycle         |
| ----------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------- |
| Managed harness               | VK launches Buzz Agent, Grok Build, Codex, Claude Code, GitHub Copilot CLI, Hermes, or OpenClaw | VK and the selected adapter     |
| External self-reporting agent | A separate process registers itself and calls VK APIs directly                                  | The external agent              |
| Unmanaged MCP client          | An assistant only needs typed VK tools and is not being launched as the task runner             | The MCP client and its operator |

Do not combine the managed and self-reporting paths. A managed run must not
register itself, send heartbeats, call start/complete endpoints, emit duplicate
telemetry, or run `vk begin`/`vk done`. VK already created the attempt and owns
its terminal state.

## Shared protocol for managed harnesses

Every managed Buzz, Grok Build, Codex, Claude Code, Copilot CLI, Hermes, and
OpenClaw run follows this contract:

1. Treat the Veritas task envelope as the authority for the objective,
   acceptance criteria, constraints, worktree, side effects, commit policy,
   expected outputs, verification gates, and completion evidence.
2. Read repository instructions available in the assigned worktree, including
   `AGENTS.md` and any harness-specific supplement that the adapter exposes.
3. Work only in the assigned worktree. Preserve files that existed at launch
   unless the task explicitly authorizes changing them.
4. Use only the tools and MCP servers in the run-scoped catalog. Prefer the
   provided VK tools over ad hoc HTTP calls.
5. Never copy credentials into commands, prompts, files, comments, logs, or
   final output. Use only the brokered references and provider boot
   authentication supplied by VK.
6. Record durable findings through an available task comment or artifact tool
   when they affect later work. If no such tool is available, include the
   finding in the final response.
7. Run the smallest verification that proves the requested change. Do not run
   a full repository suite unless the task or release gate requires it.
8. Return a concise final response with the outcome, files or artifacts
   changed, checks run, remaining risks, and blockers. The harness converts its
   native terminal result into VK completion evidence.

### Copy-ready project instruction

Add this block to a repository's canonical `AGENTS.md` when VK manages its
agents:

```md
## Veritas Kanban managed-run protocol

When Veritas Kanban launches this work:

1. Treat the supplied task envelope as authoritative.
2. Work only in the assigned worktree and obey its commit policy.
3. Use only the run-scoped tools and credentials supplied by Veritas.
4. Do not register, heartbeat, start, complete, or emit telemetry manually.
5. Do not call `vk begin` or `vk done`; Veritas already owns the attempt.
6. Run focused verification that matches the requested change.
7. Return the outcome, changed files or artifacts, checks, risks, and blockers
   through the harness's normal final response.
```

## How each managed harness receives VK context

| Harness                         | VK transport                              | Agent-facing behavior                                                                                                                        |
| ------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Buzz Agent                      | ACP v1 stdio                              | Receives the immutable task envelope and selected run tools through the ACP session. Session load/resume is unavailable.                     |
| Grok Build                      | ACP v1 stdio                              | Receives the immutable task envelope and selected catalog in a dedicated `grok agent --no-leader ... stdio` process.                         |
| GitHub Copilot CLI              | ACP v1 stdio                              | Receives the immutable task envelope and selected catalog with remote, plugins, custom instructions, and experimental features disabled.     |
| OpenAI Codex CLI/SDK/app-server | Native process, SDK, or app-server stream | Receives the task envelope plus supported run-scoped MCP configuration. The adapter owns terminal capture.                                   |
| Claude Code                     | Supervised bare-mode stream               | Receives the task envelope and an explicit run-scoped MCP configuration. It does not inherit arbitrary local plugins, hooks, or MCP servers. |
| Hermes                          | Supervised one-shot process               | Reads `AGENTS.md` from the assigned worktree and returns scripted stdout. Resume is unavailable.                                             |
| OpenClaw                        | Gateway tool invocation                   | Receives the task request through the configured gateway and reports through the attempt-bound callback.                                     |

The current support tier is determined by runtime evidence, not this table.
Before enabling a profile, the operator must run:

```bash
vk doctor --json
```

See [Agent Providers](AGENT-PROVIDERS.md) and
[Harness Compatibility](HARNESS-COMPATIBILITY.md) for tested versions,
capabilities, authentication, sandbox behavior, limitations, and recovery.

## Run-scoped VK tools

Managed adapters receive only the catalog selected for that attempt:

- A tool with an `allow` decision may be injected natively when the transport
  can enforce the exact catalog.
- An approval-backed or credential-bound tool is available only through the
  system-owned `veritas-run` bridge.
- Tools absent from the catalog are not authorized.
- If a required tool is missing or rejected, report the blocker. Do not install
  another MCP server, inherit a global configuration, or fall back to raw
  credentials.

Managed agents do not need a separate global VK MCP configuration. The adapter
injects the permitted run-scoped view when supported. The global MCP setup
below is for unmanaged clients.

## External self-reporting agents

Use this path only when VK does not launch the process through a built-in
adapter.

### Reusable `AGENTS.md` template

```md
# AGENTS.md

## Identity

- Agent ID: `my-agent-id`
- Name: My Agent
- Model: provider/model
- Provider: external
- Version: 1.0.0

## Capabilities

- `code`: Write, review, and refactor code
- `research`: Research and analysis
- `review`: Code review and validation
- `documentation`: Write and maintain documentation

## Veritas Kanban external-agent protocol

1. Register on startup and send a heartbeat every two to three minutes.
2. Treat VK as the source of truth for task and attempt state.
3. Start work through the documented task API and retain the returned attempt
   and runtime-manifest identities.
4. Work only inside the assigned repository/worktree boundary.
5. Emit progress, token, and completion data once. Do not duplicate events.
6. On completion, report the final outcome, verification evidence, and the
   exact attempt/runtime identities expected by VK.
7. Deregister cleanly on shutdown.
```

### Authentication

Set the VK endpoint and an agent-role API key outside source control:

```bash
export VK_API_URL=http://localhost:3001
export VK_API_KEY=your-agent-api-key
```

Every protected example below assumes:

```bash
-H "X-API-Key: ${VK_API_KEY}"
```

### Registration

```bash
curl -X POST "${VK_API_URL}/api/agents/register" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${VK_API_KEY}" \
  --data '{
    "id": "my-agent-id",
    "name": "My Agent",
    "model": "provider/model",
    "provider": "external",
    "capabilities": [
      {"name": "code", "description": "Write and review code"},
      {"name": "research", "description": "Research and analysis"}
    ],
    "version": "1.0.0"
  }'
```

### Heartbeat

```bash
curl -X POST "${VK_API_URL}/api/agents/register/my-agent-id/heartbeat" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${VK_API_KEY}" \
  --data '{
    "status": "busy",
    "currentTaskId": "task_20260205_abc123",
    "currentTaskTitle": "Implement feature X"
  }'
```

Valid states are `online`, `busy`, `idle`, and `offline`. VK marks an agent
offline after its configured heartbeat timeout.

### Task lifecycle

For an external agent:

1. Send a busy heartbeat with `currentTaskId`.
2. Call `POST /api/agents/:taskId/start`.
3. Retain the returned `attemptId` and provider-runtime manifest digest.
4. Report token usage to `POST /api/agents/:taskId/tokens` with the active
   attempt.
5. Complete through `POST /api/agents/:taskId/complete` with the same attempt
   and runtime-manifest digest.
6. Send an idle heartbeat and clear the current task.

Use the exact request and response schemas in
[API Reference](API-REFERENCE.md). Do not guess field names from these summary
steps.

### Telemetry

Managed runs project `run.started`, `run.completed`, and provider-reported token
events automatically. External agents must emit them once:

```bash
curl -X POST "${VK_API_URL}/api/telemetry/events" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${VK_API_KEY}" \
  --data '{"type":"run.started","taskId":"<TASK_ID>","agent":"my-agent-id"}'

curl -X POST "${VK_API_URL}/api/telemetry/events" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${VK_API_KEY}" \
  --data '{"type":"run.completed","taskId":"<TASK_ID>","agent":"my-agent-id","durationMs":<MS>,"success":true}'
```

Do not manually emit these events for a managed provider run.

### Deregistration

```bash
curl -X DELETE "${VK_API_URL}/api/agents/register/my-agent-id" \
  -H "X-API-Key: ${VK_API_KEY}"
```

## Unmanaged MCP clients

Use the VK MCP server when an assistant needs typed board tools but is not the
managed task runner.

Generic stdio configuration:

```json
{
  "mcpServers": {
    "veritas-kanban": {
      "command": "node",
      "args": ["/absolute/path/to/veritas-kanban/mcp/dist/index.js"],
      "env": {
        "VK_API_URL": "http://localhost:3001",
        "VK_API_KEY": "your-agent-api-key"
      }
    }
  }
}
```

Codex CLI configuration:

```bash
codex mcp add veritas-kanban \
  --env VK_API_URL=http://localhost:3001 \
  --env VK_API_KEY=your-agent-api-key \
  -- node /absolute/path/to/veritas-kanban/mcp/dist/index.js
```

Restart the MCP client after changing its configuration. Verify read and write
permissions with the smoke procedure in the
[MCP Server Guide](mcp/README.md).

## References

- [Agent Providers](AGENT-PROVIDERS.md)
- [Harness Compatibility](HARNESS-COMPATIBILITY.md)
- [Buzz Integration](BUZZ-INTEGRATION.md)
- [MCP Server Guide](mcp/README.md)
- [CLI Guide](CLI-GUIDE.md)
- [API Reference](API-REFERENCE.md)

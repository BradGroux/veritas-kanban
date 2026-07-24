# Veritas Kanban v6 Agent Runtime Control Plane

This document defines the supported v6.0.1 architecture for executable agent
harnesses and Buzz integration. It is the version-level composition of the
individual contract documents for
[ACP](ACP-PROVIDER-V1.md),
[harness conformance](HARNESS-CONFORMANCE-V1.md),
[tool control](TOOL-CONTROL-PLANE-V1.md), and
[runtime hooks](RUNTIME-HOOK-V1.md).

Documentation freshness: 2026-07-24 for Veritas Kanban 6.0.1.

## Authority Model

Veritas owns:

- task and attempt identity;
- worktree allocation and baseline;
- task envelope and launch manifest;
- sandbox, environment key names, budgets, tools, MCP, and credential
  references;
- run supervision, approvals, causal events, and terminal completion; and
- workflow, Squad Chat, roster/profile, telemetry, and audit state.

A provider owns only its documented transport, native session identifiers, and
raw execution behavior inside the compiled boundary. Buzz relay communication
owns signed delivery, not Veritas task or completion state.

## Adapter Boundaries

| Adapter                    | Harnesses                                                                 | Transport boundary                            | v6 behavior                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `acp-stdio`                | Buzz Agent, Grok Build, GitHub Copilot CLI, configured generic ACP agents | JSON-RPC over bounded newline-delimited stdio | Exact initialize identity/capabilities, session lifecycle negotiation, causal updates, permission brokering, no-shell supervision |
| `codex-app-server`         | OpenAI Codex app-server 0.145.0                                           | Pinned JSON-RPC v2 stdio schemas              | Thread/turn lifecycle, streamed items, exact provider requests, remote control and unsandboxed shell method disabled              |
| `claude-code`              | Claude Code 2.1.218                                                       | Supervised bare-mode stream-json process      | System-owned arguments, static permissions, credential scrubbing, bounded JSONL, authoritative result required                    |
| `codex-cli`                | OpenAI Codex CLI                                                          | One-shot JSON process                         | Existing task transport plus v6 launch, tool, credential, event, supervisor, and completion contracts                             |
| `codex-sdk`                | `@openai/codex-sdk 0.144.3`                                               | In-process SDK stream                         | Existing SDK session transport plus the shared v6 contracts                                                                       |
| `hermes-cli`               | Hermes Agent v2026.7.7.2                                                  | One-shot process                              | No resume; unsupported conversation controls fail closed                                                                          |
| `openclaw`                 | OpenClaw v2026.6.11                                                       | Gateway `/tools/invoke`                       | Remote task session with explicit gateway policy and capability evidence                                                          |
| Buzz communication adapter | Buzz v0.4.24 relay/community                                              | Signed Nostr HTTP and WebSocket               | Channel mapping, replay, identity, definition import, and external workflow-trigger evidence only                                 |

Provider profiles select an adapter. No unknown executable, provider-less
record, or unsupported profile can route through an implicit fallback.

## Run Lifecycle

```text
profile normalization
  -> provider runtime probe and support tier
  -> transactional worktree allocation
  -> immutable task envelope
  -> immutable launch manifest and credential plan
  -> supervised provider launch
  -> causal event journal
  -> exact-action approvals and mediated tools
  -> provider conversation lifecycle
  -> idempotent completion result
  -> terminal lease and worktree reconciliation
```

The probe and launch both bind provider version/build, profile configuration,
transport, capability digest, and probe revision. Drift detected between them
blocks before prompt execution.

`run-event/v1` is appended before legacy logs, traces, telemetry, and live
projection. Per-attempt cursors and deduplication support reconnect/replay.
`run-supervisor/v1` owns one active process group or remote handle and one
terminal transition. Restart recovery verifies PID/handle, worktree, task
envelope, launch manifest, and event cursor before reattaching or resuming.

`conversation-lifecycle/v1` exposes only operations supported by current
provider evidence. A generic process stdin write never stands in for a provider
follow-up protocol.

## MCP, Tools, Credentials, And Approvals

Tool-server discovery produces a version-bound inventory. A run catalog
compiles exact allow, deny, and approval decisions. Native provider injection
is allowed only when the provider transport can represent the complete policy
without exposing denied or approval-required tools.

Credential-bound tools use the system-owned `veritas-run` stdio MCP bridge.
The provider receives an opaque handle bound to the task, attempt, catalog,
launch manifest, allowed method, tool arguments digest, approval, operation,
TTL, and use count. A credential value resolves only inside the one-shot
downstream call and never enters native provider configuration or durable
evidence.

`run-approval/v1` binds a reviewer decision to the exact provider request and
action hash. Expired, stale, changed, cancelled, interrupted, duplicate, or
already-terminal requests deny safely. Mobile review is allowed only for
adapter-declared mobile-safe actions.

## Buzz Composition

Buzz has five intentionally separate seams:

1. Relay compatibility and reference-only identity configuration.
2. Signed Squad Chat root/reply delivery and replay.
3. Preview-first one-way persona/team definition import.
4. `buzz-agent` task execution through generic ACP and the `veritas-run`
   bridge.
5. Allowlisted root-message workflow triggers through the provider-neutral
   pre-external-trigger hook.

No seam creates a parallel task, workflow, credential, roster, chat, memory, or
completion authority. Relay failure cannot mark an agent run complete, and ACP
task execution cannot grant relay or community permissions.

## Certification And Runtime State

`harness-compatibility-matrix/v1` is the reviewed record for exact builds,
source caveats, fixtures, capabilities, invalidation, and limitations.
`harness-conformance-suite/v1` supplies seeded repeated deterministic
evaluations. The live support tier additionally consumes installation,
configuration, authentication posture, current runtime manifest, and platform.

Settings, API diagnostics, `vk doctor --json`, dispatch, and telemetry consume
the same record. Credential-gated live smoke supplements deterministic
evidence and never hides a failure.

## Security Boundaries

- Provider processes launch without a shell in the assigned worktree.
- User-controlled paths pass segment validation and base containment.
- Environment values are allowlisted and redacted before durable storage.
- Protocol records, stdout/stderr, queues, payloads, retries, timeouts, and
  artifacts are bounded.
- Required unsupported filesystem, network, environment, credential, MCP,
  tool, approval, lifecycle, and budget controls block before attempt mutation.
- Fine-grained HTTP method/path/domain proxy enforcement remains deferred to
  issue 855. v6.0.1 claims only the network controls proven in current provider
  runtime evidence.

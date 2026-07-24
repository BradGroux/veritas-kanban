# ACP Provider v1

Issue: [#870](https://github.com/BradGroux/veritas-kanban/issues/870)

## Boundary

`acp-stdio` lets an explicitly configured Agent Client Protocol runtime execute
a Veritas task. It is the client role in ACP terminology: Veritas owns the
process, sends lifecycle requests, receives session updates, and answers
permission requests. The external-client server role is tracked by #960.

Veritas remains authoritative for task/worktree ownership, provider selection,
sandbox policy, launch evidence, tools, approvals, events, supervision, and
completion. ACP adds no parallel session store.

## Launch sequence

1. Normalize the configured harness as an explicit `acp-stdio` support profile.
2. Verify the executable without inferring an adapter from its command name.
3. Start a bounded probe process and negotiate stable ACP protocol version 1.
4. Persist the agent identity and deterministic capability digest in
   `provider-runtime-manifest/v1`.
5. Compile the task envelope, sandbox, tool catalog, and runtime evidence into
   `run-launch-manifest/v1` before mutating attempt state.
6. Register `run-supervisor/v1`, start a fresh ACP process, and reject any
   capability-digest drift.
7. Create, resume/load, or fork the exact conversation and send the attributed
   task prompt.
8. Journal session updates and resolve permission requests through the durable
   approval broker.
9. Normalize the ACP stop reason into Veritas completion evidence, close the
   protocol connection, and terminate the supervised process group.

## Capability rules

`session/new`, `session/prompt`, and `session/cancel` are the baseline. Resume
and follow-up require `sessionCapabilities.resume` or `loadSession`. Fork and
close require their matching negotiated session capabilities. Unsupported
operations are persisted as `unsupported` runtime evidence and fail before a
provider request is sent.

The capability digest covers the complete normalized `agentCapabilities`
object. A launch process that negotiates a different digest from the probe is
rejected before session creation.

## Events and approvals

ACP message chunks, thoughts, plans, tool calls, and tool updates are converted
to ordered provider-neutral journal kinds while preserving the bounded raw
update. Session and tool-call identity are attached as source metadata.

`session/request_permission` creates `run-approval/v1` evidence bound to the
task, attempt, provider, session, tool call, exact input, offered options,
launch-manifest digest, action class, and risk class. Only the authenticated
broker decision selects an ACP allow or reject option. Cancellation and timeout
return a cancelled outcome.

## Tool and credential posture

ACP session setup may receive stdio, Streamable HTTP, or SSE MCP server
definitions from the immutable run catalog. ACP v1 has no native per-tool
allowlist, so any deny or approval decision on a selected server blocks native
injection. This prevents an ACP runtime from seeing more tools than the launch
manifest authorized.

The process receives a minimal safe environment plus explicitly selected
sandbox and tool-server keys. Values are resolved only at dispatch and never
persisted. Credential-bound tool definitions remain unavailable until #932.

## Limits

- Stable protocol version: ACP v1 only.
- Transport: newline-delimited JSON-RPC over stdio.
- Maximum JSON-RPC record: 1 MiB.
- Startup/session request timeout: 10 seconds.
- Prompt timeout: 24 hours under the durable run supervisor.
- Captured stderr: final 8 KiB after redaction.
- Process shutdown: `SIGTERM`, then `SIGKILL` after 2 seconds if required.

## Protocol sources

- [Agent Client Protocol specification](https://github.com/agentclientprotocol/agent-client-protocol)
- [Official TypeScript SDK](https://github.com/agentclientprotocol/typescript-sdk)
- Fixture contract: stable ACP v1 as exposed by
  `@agentclientprotocol/sdk@1.3.0`

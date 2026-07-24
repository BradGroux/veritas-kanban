# Tool Control Plane v1

Status: implemented for Veritas Kanban 6.0

Issue: [#857](https://github.com/BradGroux/veritas-kanban/issues/857)

## Purpose

The tool control plane gives an agent attempt an explicit, immutable MCP tool
catalog. Provider prompts never substitute for enforcement. Definition,
discovery, launch selection, provider injection, approval, invocation, and
event evidence all use the same catalog decisions.

## Contracts

### `tool-server-definition/v1`

An administrator-managed definition contains:

- stable server ID and declared version;
- enabled and required/optional posture;
- stdio command plus argument array, or a Streamable HTTP URL;
- environment, header, and credential reference names only;
- startup and call timeouts; and
- definition-level allow, deny, and approval-required selectors.

The canonical digest excludes timestamps and changes whenever executable,
transport, version, or policy inputs change.

### `tool-server-discovery/v1`

Discovery performs MCP `initialize`, `notifications/initialized`, and bounded,
paginated `tools/list`. The result records the definition digest, server
version, protocol version, redacted tool metadata, bounded input schemas, and
schema digests. Cache identity is the definition digest, so configuration or
declared-version drift cannot reuse stale discovery. Launch still opens the
server and validates its negotiated protocol and reported runtime version
before reusing cached schemas, so a required offline or drifted server blocks
before attempt mutation.

### `run-tool-catalog/v1`

The catalog binds:

- task and attempt IDs;
- provider, provider-runtime digest, and task-envelope digest;
- definition and discovery digests;
- required or optional readiness; and
- each tool's `allow`, `deny`, or `approval` decision.

The catalog is compiled before launch evidence and persisted before provider
dispatch. Its digest is stored in `run-launch-manifest/v1.tools.catalogDigest`.
A catalog cannot be replaced under the same task and attempt identity with
different evidence.

## Launch Flow

```text
profile MCP IDs + definition controls
              |
              v
load definitions -> discover/cache -> compile decisions
              |                            |
              | failure                    v
              +-> required: block     persist catalog
              +-> optional: degrade        |
                                           v
                              bind launch-manifest digest
                                           |
                                           v
                         inject supported native provider
```

Codex app-server receives the exact catalog as thread-scoped `mcp_servers`
configuration. Its base process still starts with inherited MCP disabled.
Claude Code receives a generated `--strict-mcp-config` document and an exact
MCP `--allowedTools` list. Other adapters report `tool.mcp` unsupported and
fail before attempt mutation when a profile selects MCP servers.

Provider-wide named-tool restrictions remain a separate capability gate. A
positive MCP catalog does not claim to constrain provider built-in tools; such
profiles fail closed when the adapter cannot enforce both surfaces.

Only `allow` decisions enter native provider configuration.
Approval-required tools are deliberately disabled there because native calls
would bypass the Veritas approval broker. Those tools use the mediated
`call_run_tool` path.

## Mediated Invocation

A call must provide the exact task, active attempt, server, tool, arguments,
and a caller-stable operation ID. The route verifies:

1. the attempt is still active and running;
2. its launch manifest contains the same catalog digest;
3. the server and tool exist and are ready in that catalog;
4. policy does not deny the tool;
5. arguments match the discovered JSON Schema; and
6. any approval matches the exact server, tool, arguments, catalog digest, and
   operation identity.

The journal records `tool.started` before dispatch, followed by
`tool.completed` or a causal `run.error`. Reusing an operation ID cannot
dispatch the tool twice. Results and errors are bounded and redacted before
storage.

## Runtime Supervision

Stdio servers are spawned directly without a shell in the task worktree and
receive a minimal environment. JSON-RPC records are newline-delimited and
bounded. Protocol errors, run completion, and graceful Veritas shutdown
terminate the supervised process group or child tree.

HTTP servers use bounded JSON or server-sent event responses, propagate an MCP
session ID only within the live session, and apply explicit timeouts. A failed
call closes and removes the transient session before a later retry.

## Storage

File mode stores definitions, discoveries, and catalogs in
`.veritas-kanban/tool-control-plane/state.json` under the repository storage
abstraction and file lock. SQLite mode uses migration 21 tables:

- `tool_server_definitions`
- `tool_server_discoveries`
- `run_tool_catalogs`

Repository resolution is lazy so SQLite bootstrap and migrations finish before
the route singleton first accesses storage.

## Credential Boundary

Definitions persist environment key names, header key names, and broker
reference IDs, never their values. Credential-bound discovery removes the
referenced environment keys and HTTP headers before starting the server. It
therefore succeeds only when the server can expose its schema without
credentials.

Each ready catalog entry binds the exact credential-definition digest, scope
digest, and safe environment or header target name. Missing, disabled,
unmapped, out-of-scope, external-source, or drifted definitions fail closed.
Credential-bound entries are omitted from every native provider MCP
configuration and from provider environment passthrough. The launch credential
plan reports `brokerState: supported` only when every selected sandbox
credential reference has this exact tool-control-plane evidence.

Mediated invocation now derives one canonical MCP credential action from the
exact server, tool, arguments, and catalog digest. The route supplies the
active launch-manifest digest internally. Each catalog binding issues and
consumes a unique run lease inside nested controlled callbacks, opens a
one-shot downstream MCP session with the resolved environment/header values,
and closes it before the callback returns. Results are checked for credential
material before they leave the broker.

Approval-required definitions reuse the durable approval for the same
operation and credential-action fingerprint. Replayed operations, caller
manifest overrides, stale run bindings, changed definitions/scopes, mismatched
approvals, unavailable sources, and credential-bearing results fail closed.

The system-owned `veritas-run` stdio MCP bridge exposes only catalog read and
mediated call. Its opaque authority is held in memory and bound to the exact
task, attempt, catalog, launch manifest, expiry, and allowed bridge methods.
The dedicated HTTP surface derives run identity from that authority, so the
provider cannot choose another task, attempt, catalog, or manifest.

Codex CLI/SDK, Codex app-server, Claude Code, and ACP stdio inject this same
bridge contract. Credential-bound native definitions remain omitted. Hermes
and OpenClaw fail closed at manifest compilation because their certified
transports cannot yet enforce system-owned bridge injection. Completion,
failure, interruption, cancellation, expiry, or restart revokes or rejects the
authority.

## Operator Surfaces

- REST: `/api/v1/tool-servers`
- Run bridge: `/api/run-tool-bridge/catalog` and
  `/api/run-tool-bridge/call` (opaque run authority only)
- CLI: `vk tool-servers` (alias `vk tools`)
- MCP: `list_tool_servers`, `discover_tool_server`,
  `get_run_tool_catalog`, and `call_run_tool`

Definition reads require settings read authority. Definition mutations and
discovery require administrator authority. Catalog reads require agent read
authority; mediated calls require agent write authority.

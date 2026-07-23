# Credential Broker

Veritas Kanban keeps task credentials out of provider processes by separating
metadata, leases, and value resolution.

The v6 foundation includes:

- `credential-definition/v1` metadata records;
- `credential-lease/v1` run-bound leases;
- opaque provider-safe handles persisted only as hashes;
- exact task, attempt, immutable launch-manifest, scope, and action binding;
- TTL, maximum-use, refresh, revocation, expiry, and reconciliation state;
- metadata-only audit events; and
- a controlled in-process callback that is the only API allowed to receive the
  resolved value.

It does not yet make a provider broker-capable. A handle in a prompt or
environment is not a security boundary. Provider use stays disabled until an
accepted network or tool dispatcher can prevent bypass.

## Credential classes

Treat these as separate:

1. **Harness boot authentication** starts the provider itself, such as native
   login state or a model-provider key required by the provider executable.
2. **Task integration credentials** authorize a bounded HTTP, tool, or MCP
   action during a run. These are the broker target.
3. **Compatibility passthrough** explicitly places a raw value in the provider
   environment. It is high risk and never counts as brokered.

## Register a definition

Definitions are admin-only:

```http
POST /api/credential-broker
Content-Type: application/json
```

```json
{
  "id": "github-token",
  "name": "GitHub token",
  "enabled": true,
  "source": {
    "kind": "environment",
    "reference": "VK_GITHUB_TOKEN"
  },
  "scope": {
    "dispatchTypes": ["http"],
    "hosts": ["api.github.com"],
    "tools": [],
    "destinations": ["https://api.github.com"],
    "methods": ["GET"],
    "actions": ["issues.read"],
    "pathPrefixes": ["/repos/"]
  },
  "lease": {
    "ttlSeconds": 60,
    "maxUses": 1,
    "renewable": false
  },
  "approval": "not-required"
}
```

`source.reference` is an environment key name or external manager path, never a
value. The initial local source can resolve an environment key at the internal
dispatch boundary. Production deployments should use a future external
secret-manager adapter instead of treating process environment as a vault.

Metadata that resembles an embedded token, authorization header, or
`name=value` credential is rejected.

## Lease lifecycle

The internal broker issues a lease only when:

- the task has the requested active attempt;
- the immutable run launch manifest digest matches;
- that manifest declares the definition reference;
- the definition is enabled;
- the exact action is inside every configured scope; and
- any required approval verifier authorizes the same action fingerprint.

The raw handle is returned once to the internal caller. Persistence contains
only its SHA-256 hash. The lease records definition, scope, action, run, expiry,
use-count, SHA-256 fingerprints of caller-supplied operation IDs, and optional
approval fingerprints. Raw operation IDs are never persisted or audited.

Use is compare-and-set serialized. A consumer must present the same task,
attempt, launch manifest, handle, canonical action, and a unique operation ID.
A changed host, destination, method, path, tool, action, or arguments digest
fails closed. Reusing an operation ID is rejected instead of replaying a
credential-bearing action or refresh. Source resolution happens only after the
use is claimed. Missing sources and callbacks that return, throw, or conceal
credential material in accessors, custom objects, cycles, or excessively deep
results produce credential-free errors. Binary callback results are rejected
entirely because backing buffers can expose bytes outside a visible slice or
mutate after inspection.

Completion, failure, interruption, and cancellation revoke the matching run
leases after the terminal result is durably persisted. Duplicate terminal
delivery retries revocation, so a transient broker failure can heal without
rewriting the terminal result. Startup and one-minute periodic reconciliation:

- expires leases past their TTL;
- blocks leases whose source is unavailable;
- revokes leases whose definition changed or was disabled;
- revokes leases whose run or manifest binding disappeared; and
- leaves only currently valid active leases usable.

Manifest declarations and sandbox `brokerRefs` are exact definition IDs. Values
such as `github-token=...` are invalid and never normalize to a valid reference.
The broker state writer publishes complete owner-token lock metadata atomically
and never auto-deletes an existing lock. Dead, malformed, or otherwise
unverifiable ownership fails closed because portable filesystems cannot compare
and unlink ownership atomically. After confirming that no Veritas process owns
the state file, an operator may remove the adjacent `.lock` file and let
reconciliation retry.

## Audit record

The broker stores bounded metadata events for definition changes, issue, use,
denial, refresh, revoke, expiry, and reconciliation. Events contain IDs,
fingerprints, decision reasons, and timestamps. They do not contain headers,
request bodies, URLs with query strings, credential values, or callback errors.

The causal run-event journal will later project this metadata into the unified
run stream. Broker correctness does not depend on that projection.

## Fail-closed provider posture

A required brokered sandbox preset needs `credential.broker: supported`.
`advisory`, externally delegated, unknown, stale, or bypassable evidence is
treated as unsupported and blocks launch.

Current executable providers have not completed provider-facing handle
migration. Controlled HTTP consumption belongs to the run-scoped egress
gateway; controlled MCP/tool consumption belongs to the tool-server control
plane. Until those boundaries and provider migration are complete, use the
registry and lease service only from trusted internal dispatch code.

## Rotation and revocation

- Change the external source value without changing the definition to rotate
  future resolution.
- Update or disable a definition to revoke its active leases.
- Revoke a lease explicitly for an operator stop.
- Do not delete a definition while an active lease exists; disable it first.
- Never fall back from a failed brokered lease to raw environment passthrough.

## Rollback

Disable brokered sandbox selection and revoke active leases. Keep metadata-only
definitions for operator review or delete them after no active leases remain.
Rollback never copies a value into app configuration and never weakens a
required preset into implicit passthrough.

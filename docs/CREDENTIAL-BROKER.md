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
- `run-launch-credential-plan/v1` evidence that classifies provider boot
  authentication, task integration references, and high-risk compatibility
  passthrough without storing values.

The tool control plane compiles value-free credential boundary evidence into a
run catalog and consumes leases only inside mediated tool calls. A handle in a
prompt or provider environment is still not a security boundary:
credential-bound native server injection remains omitted, and automatic
system-owned provider bridge injection is tracked by #970.

## Credential classes

Treat these as separate:

1. **Harness boot authentication** starts the provider itself, such as native
   login state or a model-provider key required by the provider executable.
2. **Task integration credentials** authorize a bounded HTTP, tool, or MCP
   action during a run. These are the broker target.
3. **Compatibility passthrough** explicitly places a raw value in the provider
   environment. It is high risk and never counts as brokered.

Every newly compiled run launch manifest records those classes, delivery
posture, boundary posture, and provider-runtime evidence in a deterministic
credential plan. Known native provider authentication keys are classified as
boot authentication. Unknown credential-like environment keys are classified
as high-risk compatibility passthrough. Broker definition IDs are classified
as task integration credentials and block launch while their controlled
boundary is unavailable. Probe timestamp-only refreshes do not create material
drift, but provider build, classification, mode, reference, delivery, boundary,
or risk changes do.

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

Current executable providers classify their launch credentials consistently,
but classification alone does not make them broker-capable. Controlled HTTP
consumption belongs to the run-scoped egress gateway; controlled MCP/tool
consumption belongs to the tool-server control plane. A task reference is
reported as brokered only when an immutable run catalog contains the matching
credential-definition and scope digests. Uncovered references still block
launch. During a mediated call, the server-owned manifest digest and exact
catalog action issue a lease; its source value exists only inside the
downstream dispatch callback.

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

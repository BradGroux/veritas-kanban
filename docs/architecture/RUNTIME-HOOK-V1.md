# Runtime Hook v1

`runtime-hook/v1` is the provider-neutral in-process extension seam for ordered
runtime decisions and passive observations. It exists so features such as Buzz
workflow triggers can use one governed contract instead of adding
provider-specific callbacks.

## Scope

The v1 bus accepts only handlers registered by trusted server code. Executable
repository scripts, arbitrary plugins, and HTTP/webhook handlers are
unsupported until the filesystem and egress boundaries in #862 and #855 can
enforce them.

Initial events:

| Event                           | May deny |
| ------------------------------- | -------- |
| `session.pre-start`             | Yes      |
| `session.post-end`              | No       |
| `tool.pre-use`                  | Yes      |
| `tool.post-use`                 | No       |
| `permission.post-denied`        | No       |
| `completion.post-recorded`      | No       |
| `workflow.pre-external-trigger` | Yes      |

Post-event definitions must use `fail-open`. If a post-event handler returns a
deny decision, the bus records `invalid-post-decision` and leaves the completed
result unchanged.

## Envelope and definitions

Every envelope contains:

- a version, event ID, event type, and timestamp;
- optional workspace, profile, workflow, and run scope IDs;
- opaque source, task, attempt, tool, approval, workflow, and external-event
  references;
- a flat, bounded metadata record containing primitives only.

Unknown events, nested or oversized metadata, credential-like fields, and
recognized secret values are rejected before handler execution. Provider
credentials and unrestricted host paths are not hook payload fields.

Definitions bind one event to one registered handler, scope, order, timeout,
enabled state, and fail-open or fail-closed policy. Re-registering the same
definition ID is the controlled update path. Definitions can be enabled or
disabled without deleting prior outcomes.

## Deterministic order

Matching definitions execute sequentially in this order:

1. global
2. workspace
3. profile
4. workflow
5. run

Within a scope, lower explicit order runs first, then definition ID. Disabled
and non-matching definitions are omitted. The first blocking denial or
fail-closed failure stops later handlers.

## Failure and reentrancy

Handlers receive an `AbortSignal`. The bus enforces a 10 to 5,000 millisecond
timeout and rejects recursive dispatch of the same event/hook pair. Missing,
failed, timed-out, or reentrant pre-event handlers obey their declared failure
policy. Post-events stay passive regardless of handler failure.

Handlers must stop work when their signal is aborted. The bus cannot make an
arbitrary in-process side effect reversible after it occurs.

## Evidence and dry-run

Each outcome retains source event ID, hook/handler IDs, execution order,
timestamps, duration, disposition, blocking state, and a bounded redacted
diagnostic. When task and attempt references exist, the default recorder appends
a namespaced `runtime.hook` event to the causal run journal and returns its
event/sequence reference.

`dryRun()` validates the same envelope and resolves the same effective ordering,
registered handlers, and fail-closed missing-handler blockers. It never invokes
a handler or writes evidence.

## Feature integration

Feature code uses the singleton bus only to register a bounded built-in handler
and versioned definition. It must keep product configuration, authorization,
and domain persistence in the feature that owns them. For #911, the Buzz
adapter supplies an authenticated external-event reference, while the workflow
trigger feature owns its rule, causal key, journal disposition, and exactly-once
workflow dispatch.

# Run Terminal v1

`run-terminal-handle/v1` is the provider-neutral ownership contract for commands executed on behalf of one Veritas run. It is distinct from the provider process, workflow scheduler, MCP server runtime, and any operator shell.

## Current scope

The first implementation supports background pipe-mode commands with:

- one opaque handle bound to workspace, task, attempt, and launch-manifest digest;
- a manifest-approved executable, relative cwd, and environment-key subset;
- immediate background return, bounded single/any/all waits, foreground detachment without changing ownership, status inspection, and attempt cleanup;
- active run status includes only handles owned by that workspace, task, and attempt;
- run completion and cancellation terminate all still-active attempt handles, including detached jobs, before the terminal run result is committed;
- fail-closed ownership persistence before a new handle is returned;
- redacted byte-bounded stdout/stderr chunks with monotonic cursors, explicit gap metadata, and a total-volume circuit that terminates noisy jobs before they flood the journal;
- graceful process-group termination followed by bounded forced termination;
- causal `command.started`, `command.detached`, `stream.stdout`, `stream.stderr`, and `command.completed` journal events; and
- bounded handle and retained-output reconstruction from the durable causal journal.

PTY mode, interactive stdin, restart reattachment, and external API/CLI/MCP exposure are explicitly unsupported in this slice. Callers receive typed blockers instead of an implicit downgrade.

## Authority boundary

The service accepts a server-owned launch context and an untrusted command request. The launch context contains the exact workspace, task, attempt, launch-manifest digest, worktree root, approved environment values, and approved executable list. The request may select only an approved command, arguments without credential material, a canonical cwd within the worktree, and environment keys already present in that context. Lexical traversal and symlink escapes fail closed before spawn.

The child is launched without a shell. On Unix-like systems it owns a detached process group; on Windows it remains an exact child until the platform-specific tree supervisor is added. The service never exposes a writable stdin stream.

Terminal children are subordinate to their owning run. Detaching changes foreground coordination only; it does not outlive the attempt. Attempt cleanup terminates matching live handles in parallel and verifies that already-terminal handles have complete journal evidence before allowing the run completion to commit.

When a provider completion arrives after a server restart, Veritas reconciles the attempt's durable terminal journal before cleanup. Handles that cannot be safely reattached are recorded as interrupted before the provider's terminal result is committed.

## Output and replay

Each redacted chunk receives a handle-local cursor. Chunks are capped below the journal spill threshold so the cursor, stream, and content remain directly replayable. Retention is byte-bounded; when older chunks are dropped, `retainedFromCursor`, `droppedBytes`, `truncated`, and the query page's `gap` flag make the loss explicit. Completion waits for successful terminal journal persistence, so callers never receive a durable-completion claim when causal evidence is incomplete.

`reconcileAttempt(workspaceId, taskId, attemptId)` replays at most 20,000 system-authored run-terminal events and validates each persisted handle before making it visible. Terminal handles and retained output remain queryable after a service restart. A handle without durable completion evidence is marked `interrupted` and receives a deduplicated `command.completed` reconciliation event. The runtime does not claim that it can inherit stdout/stderr pipes from the prior server process, so `restartReattachment` remains `unsupported` rather than pretending the process is safely controlled.

## Code

- Shared contract: `shared/src/types/run-terminal.types.ts`
- Request validation: `server/src/schemas/run-terminal-schemas.ts`
- Runtime: `server/src/services/run-terminal-service.ts`
- Focused verification: `server/src/__tests__/run-terminal-service.test.ts`

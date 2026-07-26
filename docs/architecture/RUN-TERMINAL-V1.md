# Run Terminal v1

`run-terminal-handle/v1` is the provider-neutral ownership contract for commands executed on behalf of one Veritas run. It is distinct from the provider process, workflow scheduler, MCP server runtime, and any operator shell.

## Current scope

The first implementation supports background pipe-mode commands with:

- one opaque handle bound to workspace, task, attempt, and launch-manifest digest;
- a manifest-approved executable, relative cwd, and environment-key subset;
- immediate background return, bounded single/any/all waits, foreground detachment without changing ownership, status inspection, and attempt cleanup;
- redacted byte-bounded stdout/stderr chunks with monotonic cursors, explicit gap metadata, and a total-volume circuit that terminates noisy jobs before they flood the journal;
- graceful process-group termination followed by bounded forced termination;
- causal `command.started`, `stream.stdout`, `stream.stderr`, and `command.completed` journal events.

PTY mode, interactive stdin, restart reattachment, external API/CLI/MCP exposure, and persistent handles are explicitly unsupported in this slice. Callers receive typed blockers instead of an implicit downgrade.

## Authority boundary

The service accepts a server-owned launch context and an untrusted command request. The launch context contains the exact workspace, task, attempt, launch-manifest digest, worktree root, approved environment values, and approved executable list. The request may select only an approved command, arguments without credential material, a canonical cwd within the worktree, and environment keys already present in that context. Lexical traversal and symlink escapes fail closed before spawn.

The child is launched without a shell. On Unix-like systems it owns a detached process group; on Windows it remains an exact child until the platform-specific tree supervisor is added. The service never exposes a writable stdin stream.

## Output and replay

Each redacted chunk receives a handle-local cursor. Retention is byte-bounded; when older chunks are dropped, `retainedFromCursor`, `droppedBytes`, `truncated`, and the query page's `gap` flag make the loss explicit. Completion waits for the terminal journal queue, so callers that observe a completed wait can replay the corresponding terminal event.

The in-memory buffer is not restart evidence. Durable handle metadata, platform reattachment, and conservative restart reconciliation remain required before the service can advertise `restartReattachment: enforced`.

## Code

- Shared contract: `shared/src/types/run-terminal.types.ts`
- Request validation: `server/src/schemas/run-terminal-schemas.ts`
- Runtime: `server/src/services/run-terminal-service.ts`
- Focused verification: `server/src/__tests__/run-terminal-service.test.ts`

# Workspace Checkpoints v1

`workspace-checkpoint/v1` is the immutable storage contract for a run-owned worktree at a safe execution boundary. It is not the existing task-resume checkpoint and it is not permission to mutate or rewind a workspace.

## Capture foundation

The first slice captures:

- exact workspace, task, attempt, boundary, parent, turn, and conversation-cursor identity;
- Git HEAD, branch, porcelain status digest, and a content-addressed copy of the exact Git index;
- tracked worktree files, untracked non-ignored files, and explicit tracked-file absence;
- content-addressed regular text blobs with mode, size, and SHA-256 evidence;
- deterministic exclusion evidence for sensitive files, binary files, symlinks, unsupported entries, file-size limits, aggregate byte limits, and inventory limits; and
- a digest over the complete immutable metadata document.

Ignored files are excluded by Git policy. Sensitive files, binary files, symlinks, `.git`, and `.veritas-kanban` content are excluded before blob persistence. Defaults cap one checkpoint at 10,000 files, 64 MiB total content, 8 MiB per file, and 2,000 retained exclusion records.

## Consistency and atomicity

Capture resolves the canonical Git worktree root and refuses a subdirectory or different repository. It records Git state before scanning, validates each file did not change across no-follow open/read/file-handle-stat checks, and compares HEAD, branch, index, and status again before publishing. Concurrent workspace mutation therefore aborts the capture instead of exposing a mixed-time snapshot.

Blobs are written under a SHA-256 content address and verified on reuse. Metadata is written into a private temporary directory and the directory is renamed into the exact run scope only after every blob and integrity check succeeds. Interrupted captures may leave unreachable deduplicated blobs, but list/get cannot expose a partial checkpoint as valid.

Caller operation IDs are persisted only as digests. Repeating the same exact capture operation returns the original checkpoint. Reusing that operation identity with changed boundary, scope, cursor, parent, worktree, or policy evidence returns conflict.

## Runtime boundaries and ownership

The workspace checkpoint coordinator captures immediately before the first provider turn, a native steered operator turn, and provider-native compaction. Recovery launches are labeled `before-retry`; cross-provider execution-tree edges are labeled `before-provider-handoff`; other launches and native steering are labeled `before-user-turn`.

Only worktrees with a complete Veritas manifest and lease are eligible. The coordinator re-reads the durable manifest and requires exact task, attempt, path, branch, lease, lifecycle, rebase, and unexpired ownership evidence before each capture. Unmanaged worktrees are skipped, while partial, stale, expired, or conflicting ownership fails closed.

Captures are serialized per attempt and chained through `parentCheckpointId`. Every published boundary emits a deduplicated `workspace.checkpoint.created` run event containing checkpoint identity, digest, boundary, counts, and a digest of any provider conversation cursor.

## Deliberate next boundaries

Direct parent-to-child checkpoints can be compared without touching the worktree. The bounded comparison reports affected captured files, line-numbered unified hunks, content digests, mode changes, and whether HEAD, branch, index, or Git status changed. Comparisons fail closed if either checkpoint is missing, the checkpoints are not directly chained, or their worktree ownership evidence differs.

Provider event mappers normalize bounded relative file paths and tool names into the causal journal. The attribution service considers only evidence between the two checkpoint-created events. Explicit provider file events and known path-bearing write tools are agent evidence; operator file events are operator evidence; system file events are external evidence. When every write event for a file carries bounded unified-diff hunk ranges, each checkpoint hunk is attributed only from overlapping old and new line ranges. This can distinguish agent and operator changes in different hunks of the same file. Any unscoped write evidence falls back to conservative file-window attribution; missing, non-overlapping, or mixed exact evidence remains `unknown`. Missing checkpoint event boundaries mark the complete evidence window unavailable.

Rewind preview revalidates the durable worktree lease before and after a no-follow current-state inspection. It compares the current worktree root, HEAD, branch, index, status, affected file hashes, modes, exclusions, and attribution against the expected descendant checkpoint. The result lists reverse file actions, Git and conversation-cursor changes, estimated discarded bytes, and explicit blockers. Automatic rewind is safe only when every current-state and ownership check matches and every changed file is exclusively supported by high-confidence agent evidence.

Every preview carries both a full observation digest and a stable evidence digest over ownership, current state, diff, conflicts, resolutions, selected paths, and loss estimates. The stable digest excludes only observation timestamps and their derived digests, so an unchanged preview can survive an asynchronous approval round trip while any material evidence change invalidates the approval. A conflict-free preview, or one whose attribution conflicts have an explicit per-path `accept`, `reject`, or `leave-untouched` decision, can drive a private `workspace-checkpoint-rewind-transaction/v1` record. `accept` selects the path for rewind; `reject` and `leave-untouched` preserve the descendant path. Other conflict classes remain unresolved and fail closed. The storage transaction rechecks the complete descendant diff immediately before mutation, restores only the selected paths through no-follow parent validation and atomic file replacement, verifies the exact hybrid target/descendant file posture, and commits the canonical decisions as durable evidence. Any ordinary failure rolls the affected paths back to the descendant checkpoint. An interrupted transaction remains recoverable; recovery accepts only files that still match the recorded target or descendant states and refuses unknown external edits. Attempt-local mutation serialization prevents competing rewind operations inside the owning server process, while the higher service layer must revalidate the authoritative worktree lease before invoking storage.

The rewind coordinator requests a critical, non-mobile approval whose exact action binds the stable preview evidence, runtime state, provider evidence revision, checkpoints, and estimated loss. It leaves the provider running while approval is pending. Once approved, the provider runtime port quiesces the exact runtime state, after which the coordinator regenerates the preview and requires the same stable evidence before starting storage mutation. Runtime cursor recovery occurs only after the storage transaction commits. If runtime recovery fails, the coordinator rolls the committed storage transaction back before allowing runtime recovery from the descendant anchor; a failed storage rollback deliberately leaves the provider quiesced for recovery.

The production runtime port currently supports only an active Codex app-server attempt. It interrupts the exact live turn, consumes that terminal notification as quiescence instead of finalizing the attempt, and forks provider history from the approved target turn. The resulting thread receives a new provider ID, so the runtime records both the new live cursor and the checkpoint cursor used as its rewind anchor. A later operator message starts a new native turn on the recovered thread. The adapter refuses item-level cursors, a target in another thread, the currently interrupted turn, providers without native fork, and any runtime whose evidence changed during approval.

Operators call `POST /api/agents/:taskId/workspace/checkpoints/rewind` with the exact active `attemptId`, target and descendant checkpoint IDs, an idempotent `requestId` (or `X-Idempotency-Key`), and optional path resolutions. The first conflict-free or fully resolved request returns `202` with the critical approval. Repeating the same request after approval revalidates the evidence and returns `200` only after storage and runtime recovery commit. The route requires `agent:write` plus local run-control capability.

Retention pruning accepts explicit checkpoint-count, logical-byte, age, and protected-checkpoint limits. An active run always preserves every discovered complete chain tip even when configured limits are zero, including conservative preservation of concurrent branches. Cleanup reports the exact metadata bytes removed and logical content bytes dereferenced. Content-addressed blob garbage collection is deliberately deferred until it can coordinate safely with concurrent captures, so retention never claims those shared blob bytes as reclaimed.

This foundation does not yet claim partial-hunk resolution inside one file, provider-runtime rewind outside the exact Codex app-server turn-fork case, or shared blob garbage collection. Those layers must consume the immutable repository and remain preview-first.

## Code

- Shared contract: `shared/src/types/workspace-checkpoint.types.ts`
- Validation: `server/src/schemas/workspace-checkpoint-schemas.ts`
- File repository: `server/src/storage/workspace-checkpoint-repository.ts`
- Ownership and boundary coordination: `server/src/services/workspace-checkpoint-service.ts`
- Read-only comparison: `server/src/services/workspace-checkpoint-diff-service.ts`
- Conservative causal attribution: `server/src/services/workspace-checkpoint-attribution-service.ts`
- Conflict-aware rewind preview: `server/src/services/workspace-checkpoint-rewind-preview-service.ts`
- Approval, storage, and runtime coordination: `server/src/services/workspace-checkpoint-rewind-service.ts`
- Production Codex app-server port and operator route: `server/src/services/clawdbot-agent-service.ts`, `server/src/routes/agents.ts`
- Focused verification: `server/src/__tests__/workspace-checkpoint-repository.test.ts`, `server/src/__tests__/workspace-checkpoint-diff-service.test.ts`, `server/src/__tests__/workspace-checkpoint-attribution-service.test.ts`, and `server/src/__tests__/workspace-checkpoint-rewind-preview-service.test.ts`

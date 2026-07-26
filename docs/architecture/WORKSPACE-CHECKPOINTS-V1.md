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

Provider event mappers normalize bounded relative file paths and tool names into the causal journal. The attribution service considers only evidence between the two checkpoint-created events. Explicit provider file events and known path-bearing write tools are agent evidence; operator file events are operator evidence; system file events are external evidence. Every changed hunk inherits the conservative file-window attribution. Missing or mixed evidence is `unknown`, and missing checkpoint event boundaries mark the evidence window incomplete.

Rewind preview revalidates the durable worktree lease before and after a no-follow current-state inspection. It compares the current worktree root, HEAD, branch, index, status, affected file hashes, modes, exclusions, and attribution against the expected descendant checkpoint. The result lists reverse file actions, Git and conversation-cursor changes, estimated discarded bytes, and explicit blockers. Automatic rewind is safe only when every current-state and ownership check matches and every changed file is exclusively supported by high-confidence agent evidence.

Every preview now carries a digest over its exact ownership, current-state, diff, conflict, and loss evidence. A conflict-free preview can drive a private `workspace-checkpoint-rewind-transaction/v1` record. The storage transaction rechecks the descendant immediately before mutation, restores only the approved affected paths through no-follow parent validation and atomic file replacement, verifies the exact target Git and file posture, and commits durable evidence. Any ordinary failure rolls the affected paths back to the descendant checkpoint. An interrupted transaction remains recoverable; recovery accepts only files that still match the recorded target or descendant states and refuses unknown external edits. Attempt-local mutation serialization prevents competing rewind operations inside the owning server process, while the higher service layer must revalidate the authoritative worktree lease before invoking storage.

Retention pruning accepts explicit checkpoint-count, logical-byte, age, and protected-checkpoint limits. An active run always preserves every discovered complete chain tip even when configured limits are zero, including conservative preservation of concurrent branches. Cleanup reports the exact metadata bytes removed and logical content bytes dereferenced. Content-addressed blob garbage collection is deliberately deferred until it can coordinate safely with concurrent captures, so retention never claims those shared blob bytes as reclaimed.

This foundation does not yet claim exact overlapping-hunk attribution, selective conflict resolution, provider conversation-cursor restoration, run-metadata coordination, exact operator approval, or shared blob garbage collection. Those layers must consume the immutable repository and remain preview-first. The operator-facing rewind service must bind exact approval to the preview digest, quiesce the provider, revalidate ownership, and coordinate the storage transaction with cursor and run-state updates.

## Code

- Shared contract: `shared/src/types/workspace-checkpoint.types.ts`
- Validation: `server/src/schemas/workspace-checkpoint-schemas.ts`
- File repository: `server/src/storage/workspace-checkpoint-repository.ts`
- Ownership and boundary coordination: `server/src/services/workspace-checkpoint-service.ts`
- Read-only comparison: `server/src/services/workspace-checkpoint-diff-service.ts`
- Conservative causal attribution: `server/src/services/workspace-checkpoint-attribution-service.ts`
- Conflict-aware rewind preview: `server/src/services/workspace-checkpoint-rewind-preview-service.ts`
- Focused verification: `server/src/__tests__/workspace-checkpoint-repository.test.ts`, `server/src/__tests__/workspace-checkpoint-diff-service.test.ts`, `server/src/__tests__/workspace-checkpoint-attribution-service.test.ts`, and `server/src/__tests__/workspace-checkpoint-rewind-preview-service.test.ts`

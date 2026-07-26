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

This foundation does not yet claim exact overlapping-hunk attribution, rewind conflict analysis, restore, or retention cleanup. Those layers must consume the immutable repository and remain preview-first. Rewind cannot write until current HEAD, index, file hashes, worktree ownership, external changes, and approval evidence all match the checkpoint descendant it intends to replace.

## Code

- Shared contract: `shared/src/types/workspace-checkpoint.types.ts`
- Validation: `server/src/schemas/workspace-checkpoint-schemas.ts`
- File repository: `server/src/storage/workspace-checkpoint-repository.ts`
- Ownership and boundary coordination: `server/src/services/workspace-checkpoint-service.ts`
- Read-only comparison: `server/src/services/workspace-checkpoint-diff-service.ts`
- Conservative causal attribution: `server/src/services/workspace-checkpoint-attribution-service.ts`
- Focused verification: `server/src/__tests__/workspace-checkpoint-repository.test.ts`, `server/src/__tests__/workspace-checkpoint-diff-service.test.ts`, and `server/src/__tests__/workspace-checkpoint-attribution-service.test.ts`

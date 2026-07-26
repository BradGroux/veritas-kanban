import type {
  TaskEnvelope,
  WorkspaceCheckpointCurrentFile,
  WorkspaceCheckpointFile,
  WorkspaceCheckpointFileChangeKind,
  WorkspaceCheckpointRewindAction,
  WorkspaceCheckpointRewindConflict,
  WorkspaceCheckpointRewindFilePreview,
  WorkspaceCheckpointRewindPreview,
  WorkspaceCheckpointRewindResolution,
} from '@veritas-kanban/shared';
import { ConflictError } from '../middleware/error-handler.js';
import {
  FileWorkspaceCheckpointRepository,
  type WorkspaceCheckpointRepository,
} from '../storage/workspace-checkpoint-repository.js';
import { WorkspaceCheckpointAttributionService } from './workspace-checkpoint-attribution-service.js';
import {
  WorkspaceCheckpointOwnershipService,
  type WorkspaceCheckpointOwnershipSource,
} from './workspace-checkpoint-ownership-service.js';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';
import { digestWorkspaceCheckpointRewindEvidence } from '../utils/workspace-checkpoint-rewind-digest.js';
import { normalizeWorkspaceEvidencePath } from './provider-event-evidence.js';

export interface WorkspaceCheckpointRewindPreviewInput {
  taskEnvelope: TaskEnvelope;
  taskId: string;
  attemptId: string;
  targetCheckpointId: string;
  descendantCheckpointId: string;
  resolutions?: WorkspaceCheckpointRewindResolution[];
}

export interface WorkspaceCheckpointRewindPreviewServiceOptions {
  repository?: WorkspaceCheckpointRepository;
  diffs?: Pick<WorkspaceCheckpointAttributionService, 'compare'>;
  ownership?: WorkspaceCheckpointOwnershipSource;
  now?: () => Date;
}

export class WorkspaceCheckpointRewindPreviewService {
  private readonly repository: WorkspaceCheckpointRepository;
  private readonly diffs: Pick<WorkspaceCheckpointAttributionService, 'compare'>;
  private readonly authority: WorkspaceCheckpointOwnershipService;
  private readonly now: () => Date;

  constructor(options: WorkspaceCheckpointRewindPreviewServiceOptions = {}) {
    this.repository = options.repository ?? new FileWorkspaceCheckpointRepository();
    this.diffs = options.diffs ?? new WorkspaceCheckpointAttributionService();
    this.authority = new WorkspaceCheckpointOwnershipService(options);
    this.now = options.now ?? (() => new Date());
  }

  async preview(
    input: WorkspaceCheckpointRewindPreviewInput
  ): Promise<WorkspaceCheckpointRewindPreview> {
    const firstAuthority = await this.authority.verify(input);
    if (firstAuthority.status === 'skipped') {
      throw new ConflictError('Workspace rewind preview requires a managed run-owned worktree.');
    }
    const scope = {
      workspaceId: input.taskEnvelope.workspace.workspaceId,
      taskId: input.taskId,
      attemptId: input.attemptId,
    };
    const [target, descendant, checkpointDiff] = await Promise.all([
      this.repository.get({ ...scope, checkpointId: input.targetCheckpointId }),
      this.repository.get({ ...scope, checkpointId: input.descendantCheckpointId }),
      this.diffs.compare({
        ...scope,
        fromCheckpointId: input.targetCheckpointId,
        toCheckpointId: input.descendantCheckpointId,
      }),
    ]);
    if (!target || !descendant) {
      throw new ConflictError('Workspace rewind preview requires both checkpoints.');
    }
    if (
      target.worktreeManifestId !== firstAuthority.manifest.id ||
      descendant.worktreeManifestId !== firstAuthority.manifest.id ||
      descendant.parentCheckpointId !== target.id ||
      target.worktreeRootDigest !== descendant.worktreeRootDigest ||
      checkpointDiff.fromCheckpoint.id !== target.id ||
      checkpointDiff.fromCheckpoint.digest !== target.digest ||
      checkpointDiff.toCheckpoint.id !== descendant.id ||
      checkpointDiff.toCheckpoint.digest !== descendant.digest
    ) {
      throw new ConflictError(
        'Workspace rewind checkpoints do not match the direct owned checkpoint chain.'
      );
    }
    const current = await this.repository.inspectCurrent({
      worktreePath: input.taskEnvelope.workspace.worktreePath,
      paths: checkpointDiff.files.map((file) => file.path),
      maxFileBytes: Math.max(target.policy.maxFileBytes, descendant.policy.maxFileBytes),
      maxBytes: Math.max(target.policy.maxBytes, descendant.policy.maxBytes),
    });
    const secondAuthority = await this.authority.verify(input);
    if (
      secondAuthority.status === 'skipped' ||
      secondAuthority.manifest.id !== firstAuthority.manifest.id ||
      secondAuthority.manifest.lease.id !== firstAuthority.manifest.lease.id
    ) {
      throw new ConflictError('Workspace ownership changed during rewind preview.');
    }

    const conflicts: WorkspaceCheckpointRewindConflict[] = [];
    addGitConflict(
      conflicts,
      'worktree-root-changed',
      'Worktree root no longer matches the descendant checkpoint.',
      descendant.worktreeRootDigest,
      current.worktreeRootDigest
    );
    addGitConflict(
      conflicts,
      'head-diverged',
      'Git HEAD changed after the descendant checkpoint.',
      descendant.git.head,
      current.git.head
    );
    addGitConflict(
      conflicts,
      'branch-diverged',
      'Git branch changed after the descendant checkpoint.',
      descendant.git.branch,
      current.git.branch
    );
    addGitConflict(
      conflicts,
      'index-diverged',
      'Git index changed after the descendant checkpoint.',
      descendant.git.indexDigest,
      current.git.indexDigest
    );
    addGitConflict(
      conflicts,
      'status-diverged',
      'Git worktree status changed after the descendant checkpoint.',
      descendant.git.statusDigest,
      current.git.statusDigest
    );
    if (target.git.head !== descendant.git.head || target.git.branch !== descendant.git.branch) {
      conflicts.push({
        kind: 'git-history-change',
        message:
          'The rewind would change Git history or branch posture without causal Git ownership evidence.',
      });
    }
    if (target.git.indexDigest !== descendant.git.indexDigest) {
      conflicts.push({
        kind: 'index-posture-change',
        message: 'The rewind would change the Git index without causal staging ownership evidence.',
      });
    }
    if (!target.conversationCursor) {
      conflicts.push({
        kind: 'conversation-cursor-unavailable',
        message: 'The target checkpoint does not contain a restorable conversation cursor.',
      });
    }

    const targetExclusions = new Set(target.exclusions.map((entry) => entry.path));
    const descendantExclusions = new Set(descendant.exclusions.map((entry) => entry.path));
    const overlappingPaths = checkpointDiff.files
      .map((file) => file.path)
      .filter((path) => targetExclusions.has(path) || descendantExclusions.has(path));
    for (const path of overlappingPaths) {
      conflicts.push({
        kind: 'excluded-path-overlap',
        path,
        message: 'Checkpoint exclusion evidence overlaps a path the rewind would change.',
      });
    }
    const inventoryIncomplete = target.exclusionsTruncated || descendant.exclusionsTruncated;
    if (inventoryIncomplete) {
      conflicts.push({
        kind: 'inventory-incomplete',
        message: 'Checkpoint exclusion inventory is truncated, so automatic rewind is unsafe.',
      });
    }
    if (
      target.git.statusDigest !== descendant.git.statusDigest &&
      (target.excludedCount > 0 || descendant.excludedCount > 0)
    ) {
      conflicts.push({
        kind: 'inventory-incomplete',
        message:
          'Git status changed across checkpoints that exclude files, so automatic rewind cannot prove the excluded workspace state.',
      });
    }

    const descendantFiles = new Map(descendant.files.map((file) => [file.path, file]));
    const currentFiles = new Map(current.files.map((file) => [file.path, file]));
    const resolutions = normalizeResolutions(
      input.resolutions,
      new Set(checkpointDiff.files.map((file) => file.path))
    );
    const resolutionsByPath = new Map(
      resolutions.map((resolution) => [resolution.path, resolution])
    );
    const files = checkpointDiff.files.map((file) => {
      const fileConflicts = inspectFileConflicts(
        file.path,
        descendantFiles.get(file.path),
        currentFiles.get(file.path)
      );
      if (
        !checkpointDiff.attribution?.evidenceComplete ||
        file.attribution?.source !== 'agent-tool' ||
        file.attribution.confidence !== 'high'
      ) {
        fileConflicts.push({
          kind: 'attribution-ambiguous',
          path: file.path,
          message: 'The changed file is not proven to contain only agent-authored changes.',
        });
      }
      conflicts.push(...fileConflicts);
      const resolution = resolutionsByPath.get(file.path);
      const selectedForRewind = resolution
        ? resolution.decision === 'accept'
        : fileConflicts.length === 0;
      const action = rewindAction(file.kind);
      const estimatedDiscardedBytes =
        action === 'restore-mode' ? 0 : (currentFiles.get(file.path)?.size ?? 0);
      return {
        path: file.path,
        action,
        estimatedDiscardedBytes,
        ...(file.attribution ? { attribution: file.attribution } : {}),
        ...(resolution ? { resolution: resolution.decision } : {}),
        selectedForRewind,
        conflicts: fileConflicts,
      } satisfies WorkspaceCheckpointRewindFilePreview;
    });
    const unresolvedConflicts = conflicts.filter(
      (conflict) => !resolutionSettlesConflict(conflict, resolutionsByPath)
    );
    const selectedPaths = files
      .filter((file) => file.selectedForRewind)
      .map((file) => file.path)
      .sort((left, right) => left.localeCompare(right));

    const preview = {
      schemaVersion: 'workspace-checkpoint-rewind-preview/v1' as const,
      ...scope,
      targetCheckpointId: target.id,
      descendantCheckpointId: descendant.id,
      ownership: {
        manifestId: secondAuthority.manifest.id,
        leaseId: secondAuthority.manifest.lease.id,
        ownerAttemptId: input.attemptId,
        verifiedAt: this.now().toISOString(),
      },
      current,
      checkpointDiff,
      git: {
        headWillChange: target.git.head !== descendant.git.head,
        branchWillChange: target.git.branch !== descendant.git.branch,
        indexWillChange: target.git.indexDigest !== descendant.git.indexDigest,
      },
      conversation: {
        cursorWillChange: target.conversationCursor !== descendant.conversationCursor,
        targetCursorAvailable: Boolean(target.conversationCursor),
      },
      files,
      resolutions,
      selectedPaths,
      exclusions: {
        targetCount: target.excludedCount,
        descendantCount: descendant.excludedCount,
        overlappingPaths,
        inventoryIncomplete,
      },
      conflicts,
      unresolvedConflicts,
      estimatedDataLossBytes: files.reduce(
        (total, file) => total + (file.selectedForRewind ? file.estimatedDiscardedBytes : 0),
        0
      ),
      safeForAutomaticRewind: conflicts.length === 0 && resolutions.length === 0,
      safeForApprovedRewind: unresolvedConflicts.length === 0,
    };
    const payload = {
      ...preview,
      evidenceDigest: digestWorkspaceCheckpointRewindEvidence(preview),
    };
    return { ...payload, digest: digestRunLaunchValue(payload) };
  }
}

function normalizeResolutions(
  resolutions: WorkspaceCheckpointRewindResolution[] | undefined,
  availablePaths: Set<string>
): WorkspaceCheckpointRewindResolution[] {
  if ((resolutions?.length ?? 0) > 10_000) {
    throw new ConflictError('Workspace rewind exceeds the path-resolution limit.');
  }
  const normalized: WorkspaceCheckpointRewindResolution[] = [];
  const seen = new Set<string>();
  for (const resolution of resolutions ?? []) {
    if (!['accept', 'reject', 'leave-untouched'].includes(resolution.decision)) {
      throw new ConflictError('Workspace rewind resolution decision is unsupported.', {
        path: resolution.path,
      });
    }
    const path = normalizeWorkspaceEvidencePath(resolution.path);
    if (!path || path !== resolution.path || !availablePaths.has(path)) {
      throw new ConflictError('Workspace rewind resolution references an unknown or unsafe path.', {
        path: resolution.path,
      });
    }
    if (seen.has(path)) {
      throw new ConflictError('Workspace rewind contains duplicate path resolutions.', { path });
    }
    seen.add(path);
    normalized.push({ path, decision: resolution.decision });
  }
  return normalized.sort((left, right) => left.path.localeCompare(right.path));
}

function resolutionSettlesConflict(
  conflict: WorkspaceCheckpointRewindConflict,
  resolutions: Map<string, WorkspaceCheckpointRewindResolution>
): boolean {
  if (conflict.kind !== 'attribution-ambiguous' || !conflict.path) return false;
  return resolutions.has(conflict.path);
}

function inspectFileConflicts(
  path: string,
  expected: WorkspaceCheckpointFile | undefined,
  current: WorkspaceCheckpointCurrentFile | undefined
): WorkspaceCheckpointRewindConflict[] {
  const conflicts: WorkspaceCheckpointRewindConflict[] = [];
  const expectedState = expected?.state ?? 'absent';
  const currentState = current?.state ?? 'absent';
  if (['symlink', 'unsupported', 'too-large', 'unreadable'].includes(currentState)) {
    return [
      {
        kind: 'file-unreadable',
        path,
        message: 'Current file cannot be proven safe for automatic rewind.',
        expected: expectedState,
        actual: currentState,
      },
    ];
  }
  if (expectedState !== currentState) {
    conflicts.push({
      kind: 'file-diverged',
      path,
      message: 'Current file presence differs from the descendant checkpoint.',
      expected: expectedState,
      actual: currentState,
    });
    return conflicts;
  }
  if (
    expectedState === 'present' &&
    (expected?.contentDigest !== current?.contentDigest || expected?.mode !== current?.mode)
  ) {
    conflicts.push({
      kind: 'file-diverged',
      path,
      message: 'Current file content or mode differs from the descendant checkpoint.',
      expected: `${expected?.contentDigest ?? 'missing'}:${expected?.mode ?? 'missing'}`,
      actual: `${current?.contentDigest ?? 'missing'}:${current?.mode ?? 'missing'}`,
    });
  }
  return conflicts;
}

function rewindAction(kind: WorkspaceCheckpointFileChangeKind): WorkspaceCheckpointRewindAction {
  if (kind === 'added') return 'delete';
  if (kind === 'mode-changed') return 'restore-mode';
  return 'restore';
}

function addGitConflict(
  conflicts: WorkspaceCheckpointRewindConflict[],
  kind: Extract<
    WorkspaceCheckpointRewindConflict['kind'],
    | 'worktree-root-changed'
    | 'head-diverged'
    | 'branch-diverged'
    | 'index-diverged'
    | 'status-diverged'
  >,
  message: string,
  expected: string | null,
  actual: string | null
): void {
  if (expected === actual) return;
  conflicts.push({ kind, message, expected, actual });
}

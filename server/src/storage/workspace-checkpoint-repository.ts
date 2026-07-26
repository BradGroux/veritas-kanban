import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, open } from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type {
  WorkspaceCheckpoint,
  WorkspaceCheckpointBoundary,
  WorkspaceCheckpointCurrentFile,
  WorkspaceCheckpointCurrentState,
  WorkspaceCheckpointExclusion,
  WorkspaceCheckpointFile,
  WorkspaceCheckpointFileSource,
  WorkspaceCheckpointPolicy,
  WorkspaceCheckpointRewindPreview,
  WorkspaceCheckpointRewindTransaction,
  WorkspaceCheckpointRetentionResult,
} from '@veritas-kanban/shared';
import {
  parseWorkspaceCheckpoint,
  parseWorkspaceCheckpointRewindTransaction,
} from '../schemas/workspace-checkpoint-schemas.js';
import { ConflictError } from '../middleware/error-handler.js';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';
import { getRuntimeDir } from '../utils/paths.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import {
  atomicWriteFile,
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
} from './fs-helpers.js';

const DEFAULT_POLICY: WorkspaceCheckpointPolicy = {
  ignoredFiles: 'excluded',
  sensitiveFiles: 'excluded',
  binaryFiles: 'excluded',
  symlinks: 'excluded',
  maxFiles: 10_000,
  maxBytes: 64 * 1_024 * 1_024,
  maxFileBytes: 8 * 1_024 * 1_024,
  maxExclusions: 2_000,
};
const MAX_METADATA_BYTES = 32 * 1_024 * 1_024;
const MAX_GIT_OUTPUT_BYTES = 32 * 1_024 * 1_024;
const rewindMutationQueues = new Map<string, Promise<void>>();
const MAX_POLICY: Record<'maxFiles' | 'maxBytes' | 'maxFileBytes' | 'maxExclusions', number> = {
  maxFiles: 100_000,
  maxBytes: 4 * 1_024 * 1_024 * 1_024,
  maxFileBytes: 512 * 1_024 * 1_024,
  maxExclusions: 100_000,
};

export interface WorkspaceCheckpointCaptureInput {
  workspaceId: string;
  taskId: string;
  attemptId: string;
  operationId: string;
  boundary: WorkspaceCheckpointBoundary;
  worktreePath: string;
  worktreeManifestId?: string;
  parentCheckpointId?: string;
  turnId?: string;
  conversationCursor?: string;
}

export interface WorkspaceCheckpointLookup {
  workspaceId: string;
  taskId: string;
  attemptId: string;
  checkpointId: string;
}

export interface WorkspaceCheckpointOperationLookup {
  workspaceId: string;
  taskId: string;
  attemptId: string;
  operationIdDigest: string;
}

export interface WorkspaceCheckpointListQuery {
  workspaceId: string;
  taskId: string;
  attemptId: string;
  limit?: number;
}

export interface WorkspaceCheckpointCurrentInspectionInput {
  worktreePath: string;
  paths: string[];
  maxFileBytes: number;
  maxBytes: number;
}

export interface WorkspaceCheckpointRetentionInput extends WorkspaceCheckpointListQuery {
  activeRun: boolean;
  maxCheckpoints: number;
  maxLogicalBytes: number;
  maxAgeSeconds: number;
  protectedCheckpointIds?: string[];
}

export interface WorkspaceCheckpointRewindInput extends WorkspaceCheckpointListQuery {
  operationId: string;
  worktreePath: string;
  preview: WorkspaceCheckpointRewindPreview;
}

export interface WorkspaceCheckpointRewindLookup extends WorkspaceCheckpointListQuery {
  transactionId: string;
}

export interface WorkspaceCheckpointRewindRecoveryInput extends WorkspaceCheckpointRewindLookup {
  worktreePath: string;
}

export interface WorkspaceCheckpointRepository {
  capture(input: WorkspaceCheckpointCaptureInput): Promise<WorkspaceCheckpoint>;
  get(lookup: WorkspaceCheckpointLookup): Promise<WorkspaceCheckpoint | null>;
  list(query: WorkspaceCheckpointListQuery): Promise<WorkspaceCheckpoint[]>;
  readBlob(digest: string): Promise<Buffer>;
  inspectCurrent(
    input: WorkspaceCheckpointCurrentInspectionInput
  ): Promise<WorkspaceCheckpointCurrentState>;
  prune(input: WorkspaceCheckpointRetentionInput): Promise<WorkspaceCheckpointRetentionResult>;
  rewind(input: WorkspaceCheckpointRewindInput): Promise<WorkspaceCheckpointRewindTransaction>;
  getRewind(
    lookup: WorkspaceCheckpointRewindLookup
  ): Promise<WorkspaceCheckpointRewindTransaction | null>;
  recoverRewind(
    input: WorkspaceCheckpointRewindRecoveryInput
  ): Promise<WorkspaceCheckpointRewindTransaction>;
}

export interface WorkspaceCheckpointCommandResult {
  stdout: Buffer;
  stderr: Buffer;
}

export type WorkspaceCheckpointCommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string; maxBuffer: number }
) => Promise<WorkspaceCheckpointCommandResult>;

export interface FileWorkspaceCheckpointRepositoryOptions {
  baseDir?: string;
  policy?: Partial<WorkspaceCheckpointPolicy>;
  now?: () => Date;
  runCommand?: WorkspaceCheckpointCommandRunner;
  beforePublish?: (checkpoint: WorkspaceCheckpoint) => void | Promise<void>;
  beforeRewindMutation?: (input: {
    phase: 'apply' | 'rollback';
    path: string;
    index: number;
  }) => void | Promise<void>;
}

interface GitCaptureState {
  head: string | null;
  branch: string | null;
  index: Buffer;
  indexDigest: string;
  status: Buffer;
  statusDigest: string;
  tracked: string[];
  untracked: string[];
}

export function getWorkspaceCheckpointsDir(): string {
  return path.join(getRuntimeDir(), 'workspace-checkpoints');
}

export class FileWorkspaceCheckpointRepository implements WorkspaceCheckpointRepository {
  private readonly baseDir: string;
  private readonly policy: WorkspaceCheckpointPolicy;
  private readonly now: () => Date;
  private readonly runCommand: WorkspaceCheckpointCommandRunner;
  private readonly beforePublish?: (checkpoint: WorkspaceCheckpoint) => void | Promise<void>;
  private readonly beforeRewindMutation?: FileWorkspaceCheckpointRepositoryOptions['beforeRewindMutation'];

  constructor(options: FileWorkspaceCheckpointRepositoryOptions = {}) {
    this.baseDir = path.resolve(options.baseDir ?? getWorkspaceCheckpointsDir());
    this.policy = normalizePolicy(options.policy);
    this.now = options.now ?? (() => new Date());
    this.runCommand = options.runCommand ?? defaultCommandRunner;
    this.beforePublish = options.beforePublish;
    this.beforeRewindMutation = options.beforeRewindMutation;
  }

  async capture(input: WorkspaceCheckpointCaptureInput): Promise<WorkspaceCheckpoint> {
    validateCaptureInput(input);
    const canonicalRoot = await realpath(path.resolve(input.worktreePath));
    const gitRoot = (await this.git(canonicalRoot, ['rev-parse', '--show-toplevel']))
      .toString('utf8')
      .trim();
    const canonicalGitRoot = await realpath(gitRoot);
    if (canonicalGitRoot !== canonicalRoot) {
      throw new ConflictError('Workspace checkpoint root is not the exact Git worktree root.', {
        requestedRootDigest: digestRunLaunchValue(canonicalRoot),
        gitRootDigest: digestRunLaunchValue(canonicalGitRoot),
      });
    }
    const worktreeRootDigest = digestRunLaunchValue(canonicalRoot);
    const operationIdDigest = digestRunLaunchValue(input.operationId);
    const captureRequestDigest = digestRunLaunchValue({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      attemptId: input.attemptId,
      boundary: input.boundary,
      operationIdDigest,
      worktreeRootDigest,
      worktreeManifestId: input.worktreeManifestId,
      parentCheckpointId: input.parentCheckpointId,
      turnId: input.turnId,
      conversationCursor: input.conversationCursor,
      policy: this.policy,
    });
    const checkpointId = getWorkspaceCheckpointIdForOperation({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      attemptId: input.attemptId,
      operationIdDigest,
    });
    const lookup = {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      attemptId: input.attemptId,
      checkpointId,
    };
    const existing = await this.get(lookup);
    if (existing) {
      if (existing.captureRequestDigest !== captureRequestDigest) {
        throw new ConflictError(
          'Workspace checkpoint operation identity was reused for a changed capture request.',
          { checkpointId }
        );
      }
      return existing;
    }

    const before = await this.captureGitState(canonicalRoot);
    const candidates = mergeCandidates(before.tracked, before.untracked);
    const files: WorkspaceCheckpointFile[] = [];
    const exclusions: WorkspaceCheckpointExclusion[] = [];
    let excludedCount = 0;
    let contentBytes = 0;
    for (const [candidateIndex, candidate] of candidates.entries()) {
      const exclude = (reason: WorkspaceCheckpointExclusion['reason'], size?: number) => {
        excludedCount += 1;
        if (exclusions.length < this.policy.maxExclusions) {
          exclusions.push({
            path: candidate.path,
            source: candidate.source,
            reason,
            ...(size === undefined ? {} : { size }),
          });
        }
      };
      if (candidateIndex >= this.policy.maxFiles) {
        for (const remainder of candidates.slice(candidateIndex)) {
          excludedCount += 1;
          if (exclusions.length < this.policy.maxExclusions) {
            exclusions.push({
              path: remainder.path,
              source: remainder.source,
              reason: 'file-limit',
            });
          }
        }
        break;
      }
      if (sensitivePath(candidate.path)) {
        exclude('sensitive');
        continue;
      }
      if (candidate.path.includes('\\')) {
        exclude('unsupported-file');
        continue;
      }
      const resolved = ensureWithinBase(canonicalRoot, path.resolve(canonicalRoot, candidate.path));
      let first: Awaited<ReturnType<typeof lstat>>;
      try {
        first = await lstat(resolved);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && candidate.source === 'tracked') {
          files.push({
            path: candidate.path,
            source: candidate.source,
            state: 'absent',
            size: 0,
          });
          continue;
        }
        exclude('read-failed');
        continue;
      }
      if (first.isSymbolicLink()) {
        exclude('symlink');
        continue;
      }
      if (!first.isFile()) {
        exclude('unsupported-file');
        continue;
      }
      if (first.size > this.policy.maxFileBytes) {
        exclude('too-large', first.size);
        continue;
      }
      if (contentBytes + first.size > this.policy.maxBytes) {
        exclude('byte-limit', first.size);
        continue;
      }
      let content: Buffer;
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const opened = await handle.stat();
        if (
          !opened.isFile() ||
          first.dev !== opened.dev ||
          first.ino !== opened.ino ||
          first.size !== opened.size ||
          first.mtimeMs !== opened.mtimeMs
        ) {
          throw new ConflictError('Workspace file changed while its checkpoint was captured.', {
            path: candidate.path,
          });
        }
        content = await handle.readFile();
        const second = await handle.stat();
        if (
          !second.isFile() ||
          opened.dev !== second.dev ||
          opened.ino !== second.ino ||
          opened.size !== second.size ||
          opened.mtimeMs !== second.mtimeMs ||
          content.byteLength !== second.size
        ) {
          throw new ConflictError('Workspace file changed while its checkpoint was captured.', {
            path: candidate.path,
          });
        }
      } catch (error) {
        if (error instanceof ConflictError) throw error;
        if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
          throw new ConflictError('Workspace file became a symlink during checkpoint capture.', {
            path: candidate.path,
          });
        }
        exclude('read-failed', first.size);
        continue;
      } finally {
        await handle?.close();
      }
      if (binaryContent(content)) {
        exclude('binary', content.byteLength);
        continue;
      }
      const blobDigest = await this.storeBlob(content);
      files.push({
        path: candidate.path,
        source: candidate.source,
        state: 'present',
        mode: first.mode & 0o7777,
        size: content.byteLength,
        contentDigest: blobDigest,
        blobDigest,
      });
      contentBytes += content.byteLength;
    }
    const after = await this.captureGitState(canonicalRoot);
    if (
      before.head !== after.head ||
      before.branch !== after.branch ||
      before.indexDigest !== after.indexDigest ||
      before.statusDigest !== after.statusDigest
    ) {
      throw new ConflictError('Workspace Git state changed while its checkpoint was captured.', {
        checkpointId,
      });
    }
    const indexBlobDigest = await this.storeBlob(before.index);
    const createdAt = this.now().toISOString();
    const payload = {
      schemaVersion: 'workspace-checkpoint/v1' as const,
      id: checkpointId,
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      attemptId: input.attemptId,
      boundary: input.boundary,
      operationIdDigest,
      captureRequestDigest,
      worktreeRootDigest,
      ...(input.worktreeManifestId ? { worktreeManifestId: input.worktreeManifestId } : {}),
      ...(input.parentCheckpointId ? { parentCheckpointId: input.parentCheckpointId } : {}),
      ...(input.turnId ? { turnId: input.turnId } : {}),
      ...(input.conversationCursor ? { conversationCursor: input.conversationCursor } : {}),
      git: {
        head: before.head,
        branch: before.branch,
        indexDigest: before.indexDigest,
        indexBlobDigest,
        indexBytes: before.index.byteLength,
        statusDigest: before.statusDigest,
        dirty: before.status.byteLength > 0,
      },
      policy: this.policy,
      files,
      exclusions,
      excludedCount,
      exclusionsTruncated: excludedCount > exclusions.length,
      fileCount: files.length,
      contentBytes,
      storedBytes: contentBytes + before.index.byteLength,
      createdAt,
    };
    const checkpoint = parseWorkspaceCheckpoint({
      ...payload,
      digest: digestRunLaunchValue(payload),
    });
    return this.publish(checkpoint);
  }

  async get(lookup: WorkspaceCheckpointLookup): Promise<WorkspaceCheckpoint | null> {
    const metadataPath = this.metadataPath(lookup);
    if (!(await this.assertPrivateDirectoryPath(path.dirname(metadataPath), true))) return null;
    const content = await this.readBoundedRegularFile(
      metadataPath,
      MAX_METADATA_BYTES,
      'Workspace checkpoint metadata failed its integrity bound.',
      true
    );
    if (!content) return null;
    const checkpoint = parseWorkspaceCheckpoint(JSON.parse(content.toString('utf8')));
    if (
      checkpoint.workspaceId !== lookup.workspaceId ||
      checkpoint.taskId !== lookup.taskId ||
      checkpoint.attemptId !== lookup.attemptId ||
      checkpoint.id !== lookup.checkpointId
    ) {
      throw new ConflictError('Workspace checkpoint metadata scope does not match its path.', {
        checkpointId: lookup.checkpointId,
      });
    }
    const { digest: _digest, ...payload } = checkpoint;
    if (checkpoint.digest !== digestRunLaunchValue(payload)) {
      throw new ConflictError('Workspace checkpoint metadata digest is invalid.', {
        checkpointId: lookup.checkpointId,
      });
    }
    return checkpoint;
  }

  async list(query: WorkspaceCheckpointListQuery): Promise<WorkspaceCheckpoint[]> {
    validateScope(query);
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 2_000);
    const parent = this.attemptPath(query);
    if (!(await this.assertPrivateDirectoryPath(parent, true))) return [];
    const entries = (await readdir(parent, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isDirectory() && !entry.isSymbolicLink() && entry.name.startsWith('checkpoint_')
      )
      .sort((left, right) => left.name.localeCompare(right.name));
    const checkpoints: WorkspaceCheckpoint[] = [];
    for (const entry of entries) {
      if (checkpoints.length >= limit) break;
      const checkpoint = await this.get({
        ...query,
        checkpointId: entry.name,
      });
      if (checkpoint) checkpoints.push(checkpoint);
    }
    return checkpoints.sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) || left.id.localeCompare(right.id)
    );
  }

  async readBlob(digest: string): Promise<Buffer> {
    const blobPath = this.blobPath(digest);
    await this.assertPrivateDirectoryPath(path.dirname(blobPath));
    const content = await this.readBoundedRegularFile(
      blobPath,
      Math.max(this.policy.maxBytes, MAX_GIT_OUTPUT_BYTES),
      'Workspace checkpoint blob is not a bounded regular file.',
      true
    );
    if (!content) {
      throw new ConflictError('Workspace checkpoint blob is missing.', { digest });
    }
    if (sha256(content) !== digest) {
      throw new ConflictError('Workspace checkpoint blob digest is invalid.', { digest });
    }
    return content;
  }

  async inspectCurrent(
    input: WorkspaceCheckpointCurrentInspectionInput
  ): Promise<WorkspaceCheckpointCurrentState> {
    if (
      !Number.isInteger(input.maxFileBytes) ||
      input.maxFileBytes < 1 ||
      input.maxFileBytes > MAX_POLICY.maxFileBytes ||
      !Number.isInteger(input.maxBytes) ||
      input.maxBytes < input.maxFileBytes ||
      input.maxBytes > MAX_POLICY.maxBytes
    ) {
      throw new Error('Workspace checkpoint current inspection limits are invalid.');
    }
    const paths = [...new Set(input.paths)].sort((left, right) => left.localeCompare(right));
    if (paths.length > MAX_POLICY.maxFiles) {
      throw new Error('Workspace checkpoint current inspection exceeds its file-count bound.');
    }
    for (const candidate of paths) validateCurrentInspectionPath(candidate);

    const canonicalRoot = await realpath(path.resolve(input.worktreePath));
    const gitRoot = (await this.git(canonicalRoot, ['rev-parse', '--show-toplevel']))
      .toString('utf8')
      .trim();
    const canonicalGitRoot = await realpath(gitRoot);
    if (canonicalGitRoot !== canonicalRoot) {
      throw new ConflictError('Workspace checkpoint inspection root is not the exact Git root.');
    }
    const before = await this.captureGitState(canonicalRoot);
    const files: WorkspaceCheckpointCurrentFile[] = [];
    let inspectedBytes = 0;
    for (const candidate of paths) {
      const file = await this.inspectCurrentFile(
        canonicalRoot,
        candidate,
        input.maxFileBytes,
        Math.max(0, input.maxBytes - inspectedBytes)
      );
      files.push(file);
      if (file.state === 'present') inspectedBytes += file.size ?? 0;
    }
    const after = await this.captureGitState(canonicalRoot);
    if (
      before.head !== after.head ||
      before.branch !== after.branch ||
      before.indexDigest !== after.indexDigest ||
      before.statusDigest !== after.statusDigest
    ) {
      throw new ConflictError('Workspace Git state changed during checkpoint inspection.');
    }
    const inspectedAt = this.now().toISOString();
    const payload = {
      schemaVersion: 'workspace-checkpoint-current-state/v1' as const,
      worktreeRootDigest: digestRunLaunchValue(canonicalRoot),
      git: {
        head: before.head,
        branch: before.branch,
        indexDigest: before.indexDigest,
        statusDigest: before.statusDigest,
        dirty: before.status.byteLength > 0,
      },
      files,
      inspectedAt,
    };
    return {
      ...payload,
      digest: digestRunLaunchValue(payload),
    };
  }

  async prune(
    input: WorkspaceCheckpointRetentionInput
  ): Promise<WorkspaceCheckpointRetentionResult> {
    validateScope(input);
    if (
      !Number.isInteger(input.maxCheckpoints) ||
      input.maxCheckpoints < 0 ||
      input.maxCheckpoints > 100_000 ||
      !Number.isInteger(input.maxLogicalBytes) ||
      input.maxLogicalBytes < 0 ||
      input.maxLogicalBytes > MAX_POLICY.maxBytes * 100_000 ||
      !Number.isInteger(input.maxAgeSeconds) ||
      input.maxAgeSeconds < 1
    ) {
      throw new Error('Workspace checkpoint retention policy is invalid.');
    }
    const protectedIds = new Set(input.protectedCheckpointIds ?? []);
    for (const checkpointId of protectedIds) validateIdentifier(checkpointId, 'checkpointId');
    const parent = this.attemptPath(input);
    if (!(await this.assertPrivateDirectoryPath(parent, true))) {
      return {
        schemaVersion: 'workspace-checkpoint-retention-result/v1',
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        attemptId: input.attemptId,
        activeRun: input.activeRun,
        preservedCheckpointIds: [],
        removedCheckpointIds: [],
        reclaimedMetadataBytes: 0,
        logicalContentBytesDereferenced: 0,
        contentBlobGcDeferred: true,
        completedAt: this.now().toISOString(),
      };
    }
    const entries = (await readdir(parent, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isDirectory() && !entry.isSymbolicLink() && entry.name.startsWith('checkpoint_')
      )
      .sort((left, right) => left.name.localeCompare(right.name));
    const checkpoints: WorkspaceCheckpoint[] = [];
    for (const entry of entries) {
      const checkpoint = await this.get({
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        attemptId: input.attemptId,
        checkpointId: entry.name,
      });
      if (checkpoint) checkpoints.push(checkpoint);
    }
    checkpoints.sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) || left.id.localeCompare(right.id)
    );
    if (input.activeRun) {
      const parentIds = new Set(
        checkpoints
          .map((checkpoint) => checkpoint.parentCheckpointId)
          .filter((checkpointId): checkpointId is string => Boolean(checkpointId))
      );
      const tips = checkpoints.filter((checkpoint) => !parentIds.has(checkpoint.id));
      for (const checkpoint of tips.length > 0 ? tips : checkpoints.slice(0, 1)) {
        protectedIds.add(checkpoint.id);
      }
    }

    const preserved: WorkspaceCheckpoint[] = [];
    const removed: WorkspaceCheckpoint[] = [];
    let retainedLogicalBytes = 0;
    const cutoff = this.now().getTime() - input.maxAgeSeconds * 1_000;
    for (const checkpoint of checkpoints) {
      const required = protectedIds.has(checkpoint.id);
      const withinAge = Date.parse(checkpoint.createdAt) >= cutoff;
      const withinCount = preserved.length < input.maxCheckpoints;
      const withinBytes = retainedLogicalBytes + checkpoint.storedBytes <= input.maxLogicalBytes;
      if (required || (withinAge && withinCount && withinBytes)) {
        preserved.push(checkpoint);
        retainedLogicalBytes += checkpoint.storedBytes;
      } else {
        removed.push(checkpoint);
      }
    }

    let reclaimedMetadataBytes = 0;
    for (const checkpoint of removed) {
      const checkpointPath = this.checkpointPath({ ...checkpoint, checkpointId: checkpoint.id });
      await this.assertPrivateDirectoryPath(checkpointPath);
      const metadata = await lstat(path.join(checkpointPath, 'metadata.json'));
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new ConflictError('Workspace checkpoint retention found invalid metadata.');
      }
      await rm(checkpointPath, { recursive: true, force: false });
      reclaimedMetadataBytes += metadata.size;
    }
    return {
      schemaVersion: 'workspace-checkpoint-retention-result/v1',
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      attemptId: input.attemptId,
      activeRun: input.activeRun,
      preservedCheckpointIds: preserved.map((checkpoint) => checkpoint.id),
      removedCheckpointIds: removed.map((checkpoint) => checkpoint.id),
      reclaimedMetadataBytes,
      logicalContentBytesDereferenced: removed.reduce(
        (total, checkpoint) => total + checkpoint.storedBytes,
        0
      ),
      contentBlobGcDeferred: true,
      completedAt: this.now().toISOString(),
    };
  }

  async rewind(
    input: WorkspaceCheckpointRewindInput
  ): Promise<WorkspaceCheckpointRewindTransaction> {
    validateScope(input);
    validateOpaqueReference(input.operationId, 'operationId');
    return serializeRewindMutation(input, () => this.rewindLocked(input));
  }

  private async rewindLocked(
    input: WorkspaceCheckpointRewindInput
  ): Promise<WorkspaceCheckpointRewindTransaction> {
    const preview = input.preview;
    const { digest: previewDigest, ...previewPayload } = preview;
    if (
      previewDigest !== digestRunLaunchValue(previewPayload) ||
      preview.workspaceId !== input.workspaceId ||
      preview.taskId !== input.taskId ||
      preview.attemptId !== input.attemptId ||
      !preview.safeForAutomaticRewind ||
      preview.conflicts.length > 0 ||
      preview.files.some((file) => file.conflicts.length > 0) ||
      !preview.checkpointDiff.directParent ||
      (preview.checkpointDiff.files.length > 0 &&
        !preview.checkpointDiff.attribution?.evidenceComplete) ||
      preview.checkpointDiff.files.some(
        (file) =>
          file.attribution?.source !== 'agent-tool' || file.attribution.confidence !== 'high'
      ) ||
      preview.git.headWillChange ||
      preview.git.branchWillChange ||
      preview.git.indexWillChange
    ) {
      throw new ConflictError(
        'Workspace rewind requires an intact conflict-free automatic preview.'
      );
    }
    const affectedPaths = [...new Set(preview.files.map((file) => file.path))].sort((left, right) =>
      left.localeCompare(right)
    );
    const diffPaths = [...new Set(preview.checkpointDiff.files.map((file) => file.path))].sort(
      (left, right) => left.localeCompare(right)
    );
    if (JSON.stringify(affectedPaths) !== JSON.stringify(diffPaths)) {
      throw new ConflictError(
        'Workspace rewind preview paths do not match its attributed checkpoint diff.'
      );
    }
    for (const candidate of affectedPaths) validateCurrentInspectionPath(candidate);
    const scope = {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      attemptId: input.attemptId,
    };
    const [target, descendant] = await Promise.all([
      this.get({ ...scope, checkpointId: preview.targetCheckpointId }),
      this.get({ ...scope, checkpointId: preview.descendantCheckpointId }),
    ]);
    if (
      !target ||
      !descendant ||
      descendant.parentCheckpointId !== target.id ||
      preview.checkpointDiff.fromCheckpoint.id !== target.id ||
      preview.checkpointDiff.toCheckpoint.id !== descendant.id ||
      target.digest !== preview.checkpointDiff.fromCheckpoint.digest ||
      descendant.digest !== preview.checkpointDiff.toCheckpoint.digest ||
      target.worktreeRootDigest !== descendant.worktreeRootDigest ||
      target.worktreeManifestId !== preview.ownership.manifestId ||
      descendant.worktreeManifestId !== preview.ownership.manifestId ||
      preview.ownership.ownerAttemptId !== input.attemptId ||
      target.git.head !== descendant.git.head ||
      target.git.branch !== descendant.git.branch ||
      target.git.indexDigest !== descendant.git.indexDigest ||
      preview.checkpointDiff.git.headChanged !== (target.git.head !== descendant.git.head) ||
      preview.checkpointDiff.git.branchChanged !== (target.git.branch !== descendant.git.branch) ||
      preview.checkpointDiff.git.indexChanged !==
        (target.git.indexDigest !== descendant.git.indexDigest) ||
      preview.checkpointDiff.git.statusChanged !==
        (target.git.statusDigest !== descendant.git.statusDigest) ||
      target.exclusionsTruncated ||
      descendant.exclusionsTruncated ||
      (target.git.statusDigest !== descendant.git.statusDigest &&
        (target.excludedCount > 0 || descendant.excludedCount > 0))
    ) {
      throw new ConflictError(
        'Workspace rewind checkpoints do not match the approved direct restore chain.'
      );
    }
    const operationIdDigest = digestRunLaunchValue(input.operationId);
    const transactionId = getWorkspaceCheckpointRewindIdForOperation({
      ...scope,
      operationIdDigest,
    });
    const requestDigest = digestRunLaunchValue({
      ...scope,
      operationIdDigest,
      previewDigest,
      expectedCurrentDigest: preview.current.digest,
      targetCheckpointId: target.id,
      targetCheckpointDigest: target.digest,
      descendantCheckpointId: descendant.id,
      descendantCheckpointDigest: descendant.digest,
      worktreeRootDigest: target.worktreeRootDigest,
      affectedPaths,
    });
    const existing = await this.getRewind({ ...scope, transactionId });
    if (existing) {
      if (existing.requestDigest !== requestDigest) {
        throw new ConflictError(
          'Workspace rewind operation identity was reused for a changed request.',
          { transactionId }
        );
      }
      if (existing.state === 'committed') return existing;
      throw new ConflictError(
        existing.state === 'rolled-back'
          ? 'Workspace rewind operation was rolled back and requires a new preview and operation identity.'
          : 'Workspace rewind operation is incomplete and requires explicit durable recovery.',
        { transactionId, state: existing.state }
      );
    }

    const canonicalRoot = await this.assertExactWorktreeRoot(
      input.worktreePath,
      target.worktreeRootDigest
    );
    const current = await this.inspectCurrent({
      worktreePath: canonicalRoot,
      paths: affectedPaths,
      maxFileBytes: Math.max(target.policy.maxFileBytes, descendant.policy.maxFileBytes),
      maxBytes: Math.max(target.policy.maxBytes, descendant.policy.maxBytes),
    });
    if (
      !sameCurrentState(current, preview.current) ||
      !checkpointMatchesCurrent(descendant, current, affectedPaths)
    ) {
      throw new ConflictError(
        'Workspace rewind current state no longer matches its approved descendant.'
      );
    }

    const startedAt = this.now().toISOString();
    const published = await this.publishRewindTransaction(
      sealRewindTransaction({
        schemaVersion: 'workspace-checkpoint-rewind-transaction/v1',
        id: transactionId,
        ...scope,
        operationIdDigest,
        requestDigest,
        previewDigest,
        expectedCurrentDigest: preview.current.digest,
        targetCheckpointId: target.id,
        targetCheckpointDigest: target.digest,
        descendantCheckpointId: descendant.id,
        descendantCheckpointDigest: descendant.digest,
        worktreeRootDigest: target.worktreeRootDigest,
        state: 'prepared',
        affectedPaths,
        restoredPathCount: 0,
        recoveryCheckpointId: descendant.id,
        startedAt,
        updatedAt: startedAt,
      })
    );
    if (!published.created) {
      if (published.transaction.state === 'committed') return published.transaction;
      throw new ConflictError('Workspace rewind operation is already owned by another executor.', {
        transactionId,
        state: published.transaction.state,
      });
    }
    let transaction = published.transaction;

    try {
      const immediatelyBefore = await this.inspectCurrent({
        worktreePath: canonicalRoot,
        paths: affectedPaths,
        maxFileBytes: Math.max(target.policy.maxFileBytes, descendant.policy.maxFileBytes),
        maxBytes: Math.max(target.policy.maxBytes, descendant.policy.maxBytes),
      });
      if (!checkpointMatchesCurrent(descendant, immediatelyBefore, affectedPaths)) {
        throw new ConflictError(
          'Workspace rewind descendant changed after the transaction was prepared.'
        );
      }
      transaction = await this.updateRewindTransaction(transaction, {
        state: 'applying',
        updatedAt: this.now().toISOString(),
      });
      await this.applyCheckpointFiles(canonicalRoot, target, affectedPaths, 'apply');
      const restored = await this.inspectCurrent({
        worktreePath: canonicalRoot,
        paths: affectedPaths,
        maxFileBytes: target.policy.maxFileBytes,
        maxBytes: target.policy.maxBytes,
      });
      if (!checkpointMatchesCurrent(target, restored, affectedPaths)) {
        throw new ConflictError('Workspace rewind did not produce the exact target state.');
      }
      const completedAt = this.now().toISOString();
      return this.updateRewindTransaction(transaction, {
        state: 'committed',
        restoredPathCount: affectedPaths.length,
        updatedAt: completedAt,
        completedAt,
      });
    } catch (error) {
      if (transaction.state === 'prepared') {
        const completedAt = this.now().toISOString();
        await this.updateRewindTransaction(transaction, {
          state: 'rolled-back',
          restoredPathCount: 0,
          updatedAt: completedAt,
          completedAt,
        });
        throw new ConflictError(
          'Workspace rewind aborted before mutation and preserved the changed workspace.',
          {
            transactionId,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
      transaction = await this.bestEffortRewindState(transaction, {
        state: 'rolling-back',
        updatedAt: this.now().toISOString(),
      });
      try {
        await this.applyCheckpointFiles(canonicalRoot, descendant, affectedPaths, 'rollback');
        const recovered = await this.inspectCurrent({
          worktreePath: canonicalRoot,
          paths: affectedPaths,
          maxFileBytes: descendant.policy.maxFileBytes,
          maxBytes: descendant.policy.maxBytes,
        });
        if (!checkpointMatchesCurrent(descendant, recovered, affectedPaths)) {
          throw new ConflictError(
            'Workspace rewind rollback did not recover the descendant state.'
          );
        }
        const completedAt = this.now().toISOString();
        await this.updateRewindTransaction(transaction, {
          state: 'rolled-back',
          restoredPathCount: 0,
          updatedAt: completedAt,
          completedAt,
        });
      } catch (rollbackError) {
        throw new ConflictError(
          'Workspace rewind failed and requires durable transaction recovery.',
          {
            transactionId,
            error: error instanceof Error ? error.message : String(error),
            rollbackError:
              rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          }
        );
      }
      throw new ConflictError('Workspace rewind failed and restored the descendant checkpoint.', {
        transactionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getRewind(
    lookup: WorkspaceCheckpointRewindLookup
  ): Promise<WorkspaceCheckpointRewindTransaction | null> {
    validateScope(lookup);
    validateIdentifier(lookup.transactionId, 'transactionId');
    const metadataPath = this.rewindMetadataPath(lookup);
    if (!(await this.assertPrivateDirectoryPath(path.dirname(metadataPath), true))) return null;
    const content = await this.readBoundedRegularFile(
      metadataPath,
      MAX_METADATA_BYTES,
      'Workspace rewind transaction metadata failed its integrity bound.',
      true
    );
    if (!content) return null;
    const transaction = parseWorkspaceCheckpointRewindTransaction(
      JSON.parse(content.toString('utf8'))
    );
    if (
      transaction.workspaceId !== lookup.workspaceId ||
      transaction.taskId !== lookup.taskId ||
      transaction.attemptId !== lookup.attemptId ||
      transaction.id !== lookup.transactionId
    ) {
      throw new ConflictError('Workspace rewind transaction scope does not match its path.', {
        transactionId: lookup.transactionId,
      });
    }
    const { digest: _digest, ...payload } = transaction;
    if (transaction.digest !== digestRunLaunchValue(payload)) {
      throw new ConflictError('Workspace rewind transaction digest is invalid.', {
        transactionId: lookup.transactionId,
      });
    }
    return transaction;
  }

  async recoverRewind(
    input: WorkspaceCheckpointRewindRecoveryInput
  ): Promise<WorkspaceCheckpointRewindTransaction> {
    validateScope(input);
    validateIdentifier(input.transactionId, 'transactionId');
    return serializeRewindMutation(input, () => this.recoverRewindLocked(input));
  }

  private async recoverRewindLocked(
    input: WorkspaceCheckpointRewindRecoveryInput
  ): Promise<WorkspaceCheckpointRewindTransaction> {
    const transaction = await this.getRewind(input);
    if (!transaction) {
      throw new ConflictError('Workspace rewind transaction was not found.');
    }
    if (transaction.state === 'committed' || transaction.state === 'rolled-back') {
      return transaction;
    }
    const [target, descendant] = await Promise.all([
      this.get({
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        attemptId: input.attemptId,
        checkpointId: transaction.targetCheckpointId,
      }),
      this.get({
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        attemptId: input.attemptId,
        checkpointId: transaction.recoveryCheckpointId,
      }),
    ]);
    if (
      !target ||
      !descendant ||
      target.digest !== transaction.targetCheckpointDigest ||
      descendant.digest !== transaction.descendantCheckpointDigest ||
      target.worktreeRootDigest !== transaction.worktreeRootDigest ||
      descendant.worktreeRootDigest !== transaction.worktreeRootDigest
    ) {
      throw new ConflictError(
        'Workspace rewind recovery checkpoint is missing or does not match the transaction.'
      );
    }
    const canonicalRoot = await this.assertExactWorktreeRoot(
      input.worktreePath,
      transaction.worktreeRootDigest
    );
    const beforeRecovery = await this.inspectCurrent({
      worktreePath: canonicalRoot,
      paths: transaction.affectedPaths,
      maxFileBytes: Math.max(target.policy.maxFileBytes, descendant.policy.maxFileBytes),
      maxBytes: Math.max(target.policy.maxBytes, descendant.policy.maxBytes),
    });
    if (
      !rewindRecoveryMatchesKnownStates(
        target,
        descendant,
        beforeRecovery,
        transaction.affectedPaths
      )
    ) {
      throw new ConflictError(
        'Workspace rewind recovery found changes outside the known transaction states.',
        { transactionId: transaction.id }
      );
    }
    let recovering = await this.bestEffortRewindState(transaction, {
      state: 'rolling-back',
      updatedAt: this.now().toISOString(),
    });
    await this.applyCheckpointFiles(
      canonicalRoot,
      descendant,
      transaction.affectedPaths,
      'rollback'
    );
    const recovered = await this.inspectCurrent({
      worktreePath: canonicalRoot,
      paths: transaction.affectedPaths,
      maxFileBytes: descendant.policy.maxFileBytes,
      maxBytes: descendant.policy.maxBytes,
    });
    if (!checkpointFilesMatchCurrent(descendant, recovered, transaction.affectedPaths)) {
      throw new ConflictError('Workspace rewind recovery did not restore the descendant state.', {
        transactionId: transaction.id,
      });
    }
    const completedAt = this.now().toISOString();
    recovering = await this.updateRewindTransaction(recovering, {
      state: 'rolled-back',
      restoredPathCount: 0,
      updatedAt: completedAt,
      completedAt,
    });
    return recovering;
  }

  private async assertExactWorktreeRoot(
    worktreePath: string,
    expectedDigest: string
  ): Promise<string> {
    const canonicalRoot = await realpath(path.resolve(worktreePath));
    const gitRoot = (await this.git(canonicalRoot, ['rev-parse', '--show-toplevel']))
      .toString('utf8')
      .trim();
    const canonicalGitRoot = await realpath(gitRoot);
    if (
      canonicalGitRoot !== canonicalRoot ||
      digestRunLaunchValue(canonicalRoot) !== expectedDigest
    ) {
      throw new ConflictError(
        'Workspace rewind root is not the exact checkpoint-owned Git worktree.'
      );
    }
    return canonicalRoot;
  }

  private async applyCheckpointFiles(
    worktreeRoot: string,
    checkpoint: WorkspaceCheckpoint,
    affectedPaths: string[],
    phase: 'apply' | 'rollback'
  ): Promise<void> {
    const files = new Map(checkpoint.files.map((file) => [file.path, file]));
    for (const [index, relativePath] of affectedPaths.entries()) {
      await this.beforeRewindMutation?.({ phase, path: relativePath, index });
      const file = files.get(relativePath);
      const parentReady = await this.prepareSafeWorktreeParent(
        worktreeRoot,
        relativePath,
        file?.state === 'present'
      );
      const destination = ensureWithinBase(worktreeRoot, path.resolve(worktreeRoot, relativePath));
      if (!file || file.state === 'absent') {
        if (!parentReady) continue;
        try {
          const existing = await lstat(destination);
          if (!existing.isFile() || existing.isSymbolicLink()) {
            throw new ConflictError('Workspace rewind refused to delete a non-regular file.', {
              path: relativePath,
            });
          }
          await unlink(destination);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        continue;
      }
      if (!parentReady || !file.blobDigest || file.mode === undefined) {
        throw new ConflictError('Workspace rewind target file is incomplete.', {
          path: relativePath,
        });
      }
      try {
        const existing = await lstat(destination);
        if (!existing.isFile() || existing.isSymbolicLink()) {
          throw new ConflictError('Workspace rewind refused to replace a non-regular file.', {
            path: relativePath,
          });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const content = await this.readBlob(file.blobDigest);
      if (content.byteLength !== file.size || sha256(content) !== file.contentDigest) {
        throw new ConflictError('Workspace rewind target blob does not match its checkpoint.', {
          path: relativePath,
        });
      }
      await atomicWriteFile(destination, content);
      await chmod(destination, file.mode);
    }
  }

  private async prepareSafeWorktreeParent(
    worktreeRoot: string,
    relativePath: string,
    create: boolean
  ): Promise<boolean> {
    const segments = relativePath.split('/').slice(0, -1);
    let current = worktreeRoot;
    for (const segment of segments) {
      current = ensureWithinBase(worktreeRoot, path.join(current, segment));
      try {
        const stat = await lstat(current);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          throw new ConflictError(
            'Workspace rewind path contains a non-directory or symbolic-link parent.',
            { path: relativePath }
          );
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (!create) return false;
        await mkdir(current, { mode: 0o700 });
        const created = await lstat(current);
        if (!created.isDirectory() || created.isSymbolicLink()) {
          throw new ConflictError('Workspace rewind could not create a safe parent directory.', {
            path: relativePath,
          });
        }
      }
      if ((await realpath(current)) !== current) {
        throw new ConflictError('Workspace rewind path resolves through an unexpected parent.', {
          path: relativePath,
        });
      }
    }
    return true;
  }

  private async publishRewindTransaction(
    transaction: WorkspaceCheckpointRewindTransaction
  ): Promise<{ transaction: WorkspaceCheckpointRewindTransaction; created: boolean }> {
    const parent = await this.preparePrivateDirectory([
      transaction.workspaceId,
      transaction.taskId,
      transaction.attemptId,
      'rewinds',
    ]);
    const destination = this.rewindPath({
      workspaceId: transaction.workspaceId,
      taskId: transaction.taskId,
      attemptId: transaction.attemptId,
      transactionId: transaction.id,
    });
    const temporary = ensureWithinBase(
      parent,
      path.join(parent, `.tmp-${transaction.id}-${nanoid(8)}`)
    );
    await mkdir(temporary, { mode: 0o700 });
    try {
      await this.writeRewindMetadata(path.join(temporary, 'metadata.json'), transaction);
      await rename(temporary, destination);
      return { transaction, created: true };
    } catch (error) {
      const raced = await this.getRewind({
        workspaceId: transaction.workspaceId,
        taskId: transaction.taskId,
        attemptId: transaction.attemptId,
        transactionId: transaction.id,
      });
      if (raced?.requestDigest === transaction.requestDigest) {
        return { transaction: raced, created: false };
      }
      throw error;
    } finally {
      await rm(temporary, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async updateRewindTransaction(
    transaction: WorkspaceCheckpointRewindTransaction,
    patch: Partial<
      Pick<
        WorkspaceCheckpointRewindTransaction,
        'state' | 'restoredPathCount' | 'updatedAt' | 'completedAt'
      >
    >
  ): Promise<WorkspaceCheckpointRewindTransaction> {
    const current = await this.getRewind({
      workspaceId: transaction.workspaceId,
      taskId: transaction.taskId,
      attemptId: transaction.attemptId,
      transactionId: transaction.id,
    });
    if (!current || current.digest !== transaction.digest) {
      throw new ConflictError('Workspace rewind transaction changed before its state update.', {
        transactionId: transaction.id,
      });
    }
    const updated = sealRewindTransaction({ ...current, ...patch, digest: undefined });
    await this.writeRewindMetadata(
      this.rewindMetadataPath({
        workspaceId: updated.workspaceId,
        taskId: updated.taskId,
        attemptId: updated.attemptId,
        transactionId: updated.id,
      }),
      updated
    );
    return updated;
  }

  private async bestEffortRewindState(
    transaction: WorkspaceCheckpointRewindTransaction,
    patch: Partial<
      Pick<
        WorkspaceCheckpointRewindTransaction,
        'state' | 'restoredPathCount' | 'updatedAt' | 'completedAt'
      >
    >
  ): Promise<WorkspaceCheckpointRewindTransaction> {
    try {
      return await this.updateRewindTransaction(transaction, patch);
    } catch {
      return transaction;
    }
  }

  private async writeRewindMetadata(
    metadataPath: string,
    transaction: WorkspaceCheckpointRewindTransaction
  ): Promise<void> {
    const metadata = `${JSON.stringify(transaction, null, 2)}\n`;
    if (Buffer.byteLength(metadata) > MAX_METADATA_BYTES) {
      throw new ConflictError('Workspace rewind transaction metadata exceeds its bound.', {
        transactionId: transaction.id,
      });
    }
    await atomicWriteFile(metadataPath, metadata);
  }

  private async captureGitState(worktreeRoot: string): Promise<GitCaptureState> {
    const [headResult, branchResult, indexPathResult, status, tracked, untracked] =
      await Promise.all([
        this.git(worktreeRoot, ['rev-parse', '--verify', 'HEAD'], true),
        this.git(worktreeRoot, ['symbolic-ref', '--short', '-q', 'HEAD'], true),
        this.git(worktreeRoot, ['rev-parse', '--git-path', 'index']),
        this.git(worktreeRoot, ['status', '--porcelain=v2', '-z', '--untracked-files=all']),
        this.git(worktreeRoot, ['ls-files', '-z', '--cached']),
        this.git(worktreeRoot, ['ls-files', '-z', '--others', '--exclude-standard']),
      ]);
    const indexPathValue = indexPathResult.toString('utf8').trim();
    const indexPath = path.isAbsolute(indexPathValue)
      ? indexPathValue
      : path.resolve(worktreeRoot, indexPathValue);
    const index =
      (await this.readBoundedRegularFile(
        indexPath,
        MAX_GIT_OUTPUT_BYTES,
        'Workspace checkpoint Git index is not a bounded regular file.',
        true
      )) ?? Buffer.alloc(0);
    return {
      head: optionalOutput(headResult),
      branch: optionalOutput(branchResult),
      index,
      indexDigest: sha256(index),
      status,
      statusDigest: sha256(status),
      tracked: parseNullList(tracked),
      untracked: parseNullList(untracked),
    };
  }

  private async inspectCurrentFile(
    worktreeRoot: string,
    relativePath: string,
    maxFileBytes: number,
    remainingBytes: number
  ): Promise<WorkspaceCheckpointCurrentFile> {
    const resolved = ensureWithinBase(worktreeRoot, path.resolve(worktreeRoot, relativePath));
    let first: Awaited<ReturnType<typeof lstat>>;
    try {
      first = await lstat(resolved);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { path: relativePath, state: 'absent' };
      }
      return { path: relativePath, state: 'unreadable' };
    }
    if (first.isSymbolicLink()) {
      return { path: relativePath, state: 'symlink', size: first.size };
    }
    if (!first.isFile()) {
      return { path: relativePath, state: 'unsupported', size: first.size };
    }
    if (first.size > maxFileBytes || first.size > remainingBytes) {
      return { path: relativePath, state: 'too-large', size: first.size };
    }

    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        first.dev !== opened.dev ||
        first.ino !== opened.ino ||
        first.size !== opened.size ||
        first.mtimeMs !== opened.mtimeMs
      ) {
        throw new ConflictError('Workspace file changed during checkpoint inspection.', {
          path: relativePath,
        });
      }
      const content = await handle.readFile();
      const second = await handle.stat();
      if (
        !second.isFile() ||
        opened.dev !== second.dev ||
        opened.ino !== second.ino ||
        opened.size !== second.size ||
        opened.mtimeMs !== second.mtimeMs ||
        content.byteLength !== second.size
      ) {
        throw new ConflictError('Workspace file changed during checkpoint inspection.', {
          path: relativePath,
        });
      }
      return {
        path: relativePath,
        state: 'present',
        mode: second.mode & 0o7777,
        size: content.byteLength,
        contentDigest: sha256(content),
      };
    } catch (error) {
      if (error instanceof ConflictError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        return { path: relativePath, state: 'symlink', size: first.size };
      }
      return { path: relativePath, state: 'unreadable', size: first.size };
    } finally {
      await handle?.close();
    }
  }

  private async git(worktreeRoot: string, args: string[], allowFailure = false): Promise<Buffer> {
    try {
      return (
        await this.runCommand('git', args, {
          cwd: worktreeRoot,
          maxBuffer: MAX_GIT_OUTPUT_BYTES,
        })
      ).stdout;
    } catch (error) {
      if (allowFailure) return Buffer.alloc(0);
      throw new ConflictError('Workspace checkpoint Git inspection failed.', {
        command: args[0],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async storeBlob(content: Buffer): Promise<string> {
    const digest = sha256(content);
    const blobPath = this.blobPath(digest);
    await this.preparePrivateDirectory(['blobs', digest.slice('sha256:'.length, 9)]);
    const existing = await this.readBoundedRegularFile(
      blobPath,
      Math.max(this.policy.maxBytes, MAX_GIT_OUTPUT_BYTES),
      'Workspace checkpoint blob path is not a bounded regular file.',
      true
    );
    if (existing) {
      if (sha256(existing) !== digest) {
        throw new ConflictError('Workspace checkpoint blob path contains mismatched content.', {
          digest,
        });
      }
      return digest;
    }
    await atomicWriteFile(blobPath, content);
    return digest;
  }

  private async publish(checkpoint: WorkspaceCheckpoint): Promise<WorkspaceCheckpoint> {
    const parent = await this.preparePrivateDirectory([
      checkpoint.workspaceId,
      checkpoint.taskId,
      checkpoint.attemptId,
    ]);
    const destination = this.checkpointPath({ ...checkpoint, checkpointId: checkpoint.id });
    const temporary = ensureWithinBase(
      parent,
      path.join(parent, `.tmp-${checkpoint.id}-${nanoid(8)}`)
    );
    await mkdir(temporary, { mode: 0o700 });
    try {
      const metadata = `${JSON.stringify(checkpoint, null, 2)}\n`;
      if (Buffer.byteLength(metadata) > MAX_METADATA_BYTES) {
        throw new ConflictError('Workspace checkpoint metadata exceeds its integrity bound.', {
          checkpointId: checkpoint.id,
        });
      }
      await atomicWriteFile(path.join(temporary, 'metadata.json'), metadata);
      await this.beforePublish?.(checkpoint);
      await rename(temporary, destination);
      return checkpoint;
    } catch (error) {
      const raced = await this.get({
        workspaceId: checkpoint.workspaceId,
        taskId: checkpoint.taskId,
        attemptId: checkpoint.attemptId,
        checkpointId: checkpoint.id,
      });
      if (raced?.captureRequestDigest === checkpoint.captureRequestDigest) return raced;
      throw error;
    } finally {
      await rm(temporary, { recursive: true, force: true }).catch(() => {});
    }
  }

  private metadataPath(lookup: WorkspaceCheckpointLookup): string {
    return path.join(this.checkpointPath(lookup), 'metadata.json');
  }

  private rewindMetadataPath(lookup: WorkspaceCheckpointRewindLookup): string {
    return path.join(this.rewindPath(lookup), 'metadata.json');
  }

  private rewindPath(lookup: WorkspaceCheckpointRewindLookup): string {
    validateIdentifier(lookup.transactionId, 'transactionId');
    return ensureWithinBase(
      this.baseDir,
      path.join(this.attemptPath(lookup), 'rewinds', lookup.transactionId)
    );
  }

  private checkpointPath(lookup: WorkspaceCheckpointLookup): string {
    validateIdentifier(lookup.checkpointId, 'checkpointId');
    return ensureWithinBase(this.baseDir, path.join(this.attemptPath(lookup), lookup.checkpointId));
  }

  private attemptPath(
    scope: Pick<WorkspaceCheckpointLookup, 'workspaceId' | 'taskId' | 'attemptId'>
  ): string {
    validateScope(scope);
    return ensureWithinBase(
      this.baseDir,
      path.join(this.baseDir, scope.workspaceId, scope.taskId, scope.attemptId)
    );
  }

  private blobPath(digest: string): string {
    const match = /^sha256:([a-f0-9]{64})$/.exec(digest);
    if (!match) throw new Error('Workspace checkpoint blob digest is invalid.');
    return ensureWithinBase(
      this.baseDir,
      path.join(this.baseDir, 'blobs', match[1].slice(0, 2), match[1])
    );
  }

  private async preparePrivateDirectory(segments: string[]): Promise<string> {
    await mkdir(this.baseDir, { recursive: true, mode: 0o700 });
    await this.assertPrivateDirectory(this.baseDir);
    let current = this.baseDir;
    for (const segment of segments) {
      validateIdentifier(segment, 'storage path');
      const next = ensureWithinBase(this.baseDir, path.join(current, segment));
      await mkdir(next, { mode: 0o700 }).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      });
      await this.assertPrivateDirectory(next);
      current = next;
    }
    return current;
  }

  private async assertPrivateDirectoryPath(
    directory: string,
    allowMissing = false
  ): Promise<boolean> {
    const bounded = ensureWithinBase(this.baseDir, directory);
    const relative = path.relative(this.baseDir, bounded);
    let current = this.baseDir;
    try {
      await this.assertPrivateDirectory(current);
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    for (const segment of relative ? relative.split(path.sep) : []) {
      validateIdentifier(segment, 'storage path');
      current = ensureWithinBase(this.baseDir, path.join(current, segment));
      try {
        await this.assertPrivateDirectory(current);
      } catch (error) {
        if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    }
    return true;
  }

  private async assertPrivateDirectory(directory: string): Promise<void> {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new ConflictError('Workspace checkpoint path is not a private regular directory.');
    }
  }

  private async readBoundedRegularFile(
    filePath: string,
    maxBytes: number,
    message: string,
    allowMissing = false
  ): Promise<Buffer | null> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > maxBytes) {
        throw new ConflictError(message);
      }
      return await handle.readFile();
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        throw new ConflictError(message, {
          cause: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }
}

function validateCaptureInput(input: WorkspaceCheckpointCaptureInput): void {
  validateScope(input);
  validateOpaqueReference(input.operationId, 'operationId');
  for (const optional of [
    input.worktreeManifestId,
    input.parentCheckpointId,
    input.turnId,
    input.conversationCursor,
  ]) {
    if (optional) validateOpaqueReference(optional, 'checkpoint reference');
  }
  if (
    ![
      'before-user-turn',
      'before-compaction',
      'before-retry',
      'before-provider-handoff',
      'manual',
    ].includes(input.boundary)
  ) {
    throw new Error('Workspace checkpoint boundary is invalid.');
  }
}

function validateScope(
  scope: Pick<WorkspaceCheckpointLookup, 'workspaceId' | 'taskId' | 'attemptId'>
): void {
  validateIdentifier(scope.workspaceId, 'workspaceId');
  validateIdentifier(scope.taskId, 'taskId');
  validateIdentifier(scope.attemptId, 'attemptId');
}

function validateCurrentInspectionPath(value: string): void {
  if (
    !value ||
    value.length > 4_096 ||
    value.includes('\0') ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/.test(value) ||
    value.split('/').some((segment) => segment === '..' || segment === '')
  ) {
    throw new Error('Workspace checkpoint inspection path is invalid.');
  }
}

function validateIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9._:-]{1,240}$/.test(value)) {
    throw new Error(`Workspace checkpoint ${label} is invalid.`);
  }
}

function validateOpaqueReference(value: string, label: string): void {
  if (
    typeof value !== 'string' ||
    value.length > 2_048 ||
    value.trim().length === 0 ||
    value.includes('\0')
  ) {
    throw new Error(`Workspace checkpoint ${label} is invalid.`);
  }
}

function normalizePolicy(
  overrides: Partial<WorkspaceCheckpointPolicy> | undefined
): WorkspaceCheckpointPolicy {
  const policy = { ...DEFAULT_POLICY, ...overrides };
  for (const key of ['maxFiles', 'maxBytes', 'maxFileBytes', 'maxExclusions'] as const) {
    if (!Number.isInteger(policy[key]) || policy[key] < 1 || policy[key] > MAX_POLICY[key]) {
      throw new Error(
        `Workspace checkpoint ${key} must be an integer between 1 and ${MAX_POLICY[key]}.`
      );
    }
  }
  if (policy.maxFileBytes > policy.maxBytes) {
    throw new Error('Workspace checkpoint maxFileBytes cannot exceed maxBytes.');
  }
  return policy;
}

export function getWorkspaceCheckpointIdForOperation(
  lookup: WorkspaceCheckpointOperationLookup
): string {
  validateScope(lookup);
  if (!/^sha256:[a-f0-9]{64}$/.test(lookup.operationIdDigest)) {
    throw new Error('Workspace checkpoint operation digest is invalid.');
  }
  return `checkpoint_${digestRunLaunchValue({
    workspaceId: lookup.workspaceId,
    taskId: lookup.taskId,
    attemptId: lookup.attemptId,
    operationIdDigest: lookup.operationIdDigest,
  })
    .slice('sha256:'.length)
    .slice(0, 24)}`;
}

export function getWorkspaceCheckpointRewindIdForOperation(
  lookup: WorkspaceCheckpointOperationLookup
): string {
  validateScope(lookup);
  if (!/^sha256:[a-f0-9]{64}$/.test(lookup.operationIdDigest)) {
    throw new Error('Workspace rewind operation digest is invalid.');
  }
  return `rewind_${digestRunLaunchValue({
    workspaceId: lookup.workspaceId,
    taskId: lookup.taskId,
    attemptId: lookup.attemptId,
    operationIdDigest: lookup.operationIdDigest,
  })
    .slice('sha256:'.length)
    .slice(0, 24)}`;
}

function sealRewindTransaction(
  input: Omit<WorkspaceCheckpointRewindTransaction, 'digest'> & { digest?: undefined }
): WorkspaceCheckpointRewindTransaction {
  const { digest: _digest, ...payload } = input;
  return parseWorkspaceCheckpointRewindTransaction({
    ...payload,
    digest: digestRunLaunchValue(payload),
  });
}

function sameCurrentState(
  left: WorkspaceCheckpointCurrentState,
  right: WorkspaceCheckpointCurrentState
): boolean {
  return (
    left.worktreeRootDigest === right.worktreeRootDigest &&
    left.git.head === right.git.head &&
    left.git.branch === right.git.branch &&
    left.git.indexDigest === right.git.indexDigest &&
    left.git.statusDigest === right.git.statusDigest &&
    left.git.dirty === right.git.dirty &&
    stableCurrentFiles(left.files) === stableCurrentFiles(right.files)
  );
}

function checkpointMatchesCurrent(
  checkpoint: WorkspaceCheckpoint,
  current: WorkspaceCheckpointCurrentState,
  paths: string[]
): boolean {
  if (
    checkpoint.worktreeRootDigest !== current.worktreeRootDigest ||
    checkpoint.git.head !== current.git.head ||
    checkpoint.git.branch !== current.git.branch ||
    checkpoint.git.indexDigest !== current.git.indexDigest ||
    checkpoint.git.statusDigest !== current.git.statusDigest ||
    checkpoint.git.dirty !== current.git.dirty
  ) {
    return false;
  }
  return checkpointFilesMatchCurrent(checkpoint, current, paths);
}

function checkpointFilesMatchCurrent(
  checkpoint: WorkspaceCheckpoint,
  current: WorkspaceCheckpointCurrentState,
  paths: string[]
): boolean {
  if (
    checkpoint.worktreeRootDigest !== current.worktreeRootDigest ||
    checkpoint.git.head !== current.git.head ||
    checkpoint.git.branch !== current.git.branch ||
    checkpoint.git.indexDigest !== current.git.indexDigest
  ) {
    return false;
  }
  const checkpointFiles = new Map(checkpoint.files.map((file) => [file.path, file]));
  const currentFiles = new Map(current.files.map((file) => [file.path, file]));
  return paths.every((candidate) =>
    checkpointFileMatchesCurrent(checkpointFiles.get(candidate), currentFiles.get(candidate))
  );
}

function rewindRecoveryMatchesKnownStates(
  target: WorkspaceCheckpoint,
  descendant: WorkspaceCheckpoint,
  current: WorkspaceCheckpointCurrentState,
  paths: string[]
): boolean {
  if (
    target.worktreeRootDigest !== current.worktreeRootDigest ||
    target.git.head !== current.git.head ||
    target.git.branch !== current.git.branch ||
    target.git.indexDigest !== current.git.indexDigest
  ) {
    return false;
  }
  const targetFiles = new Map(target.files.map((file) => [file.path, file]));
  const descendantFiles = new Map(descendant.files.map((file) => [file.path, file]));
  const currentFiles = new Map(current.files.map((file) => [file.path, file]));
  return paths.every((candidate) => {
    const actual = currentFiles.get(candidate);
    return (
      checkpointFileMatchesCurrent(targetFiles.get(candidate), actual) ||
      checkpointFileMatchesCurrent(descendantFiles.get(candidate), actual)
    );
  });
}

function checkpointFileMatchesCurrent(
  expected: WorkspaceCheckpointFile | undefined,
  actual: WorkspaceCheckpointCurrentFile | undefined
): boolean {
  const expectedState = expected?.state ?? 'absent';
  if (!actual || expectedState !== actual.state) return false;
  if (expectedState === 'absent') return true;
  return (
    expected?.contentDigest === actual.contentDigest &&
    expected?.mode === actual.mode &&
    expected?.size === actual.size
  );
}

function stableCurrentFiles(files: WorkspaceCheckpointCurrentFile[]): string {
  return JSON.stringify([...files].sort((left, right) => left.path.localeCompare(right.path)));
}

async function serializeRewindMutation<T>(
  scope: Pick<WorkspaceCheckpointLookup, 'workspaceId' | 'taskId' | 'attemptId'>,
  operation: () => Promise<T>
): Promise<T> {
  const key = `${scope.workspaceId}:${scope.taskId}:${scope.attemptId}`;
  const previous = rewindMutationQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  rewindMutationQueues.set(key, current);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    if (rewindMutationQueues.get(key) === current) rewindMutationQueues.delete(key);
    release();
  }
}

function mergeCandidates(
  tracked: string[],
  untracked: string[]
): Array<{ path: string; source: WorkspaceCheckpointFileSource }> {
  const candidates = new Map<string, WorkspaceCheckpointFileSource>();
  for (const file of tracked) candidates.set(file, 'tracked');
  for (const file of untracked) {
    if (!candidates.has(file)) candidates.set(file, 'untracked');
  }
  return [...candidates.entries()]
    .map(([candidatePath, source]) => ({ path: candidatePath, source }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function parseNullList(value: Buffer): string[] {
  return value.toString('utf8').split('\0').filter(Boolean);
}

function optionalOutput(value: Buffer): string | null {
  const output = value.toString('utf8').trim();
  return output || null;
}

function sensitivePath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/').toLowerCase();
  const segments = normalized.split('/');
  const name = segments.at(-1) ?? '';
  if (segments.includes('.git') || segments.includes('.veritas-kanban')) return true;
  if (name === '.env' || (name.startsWith('.env.') && !/\.(?:example|sample)$/.test(name))) {
    return true;
  }
  return (
    name === '.npmrc' ||
    name === '.netrc' ||
    name === 'credentials.json' ||
    name === 'secrets.json' ||
    /\.(?:pem|key|p12|pfx)$/.test(name)
  );
}

function binaryContent(content: Buffer): boolean {
  if (content.subarray(0, 8_192).includes(0)) return true;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(content);
    return false;
  } catch {
    return true;
  }
}

function sha256(content: Uint8Array): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

async function defaultCommandRunner(
  command: string,
  args: string[],
  options: { cwd: string; maxBuffer: number }
): Promise<WorkspaceCheckpointCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        encoding: 'buffer',
        maxBuffer: options.maxBuffer,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `${command} ${args[0] ?? ''} failed: ${Buffer.from(stderr).toString('utf8').trim()}`,
              { cause: error }
            )
          );
          return;
        }
        resolve({ stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) });
      }
    );
  });
}

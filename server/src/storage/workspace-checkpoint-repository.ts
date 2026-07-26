import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type {
  WorkspaceCheckpoint,
  WorkspaceCheckpointBoundary,
  WorkspaceCheckpointExclusion,
  WorkspaceCheckpointFile,
  WorkspaceCheckpointFileSource,
  WorkspaceCheckpointPolicy,
} from '@veritas-kanban/shared';
import { parseWorkspaceCheckpoint } from '../schemas/workspace-checkpoint-schemas.js';
import { ConflictError } from '../middleware/error-handler.js';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';
import { getRuntimeDir } from '../utils/paths.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import { atomicWriteFile, lstat, mkdir, readdir, realpath, rename, rm } from './fs-helpers.js';

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

export interface WorkspaceCheckpointRepository {
  capture(input: WorkspaceCheckpointCaptureInput): Promise<WorkspaceCheckpoint>;
  get(lookup: WorkspaceCheckpointLookup): Promise<WorkspaceCheckpoint | null>;
  list(query: WorkspaceCheckpointListQuery): Promise<WorkspaceCheckpoint[]>;
  readBlob(digest: string): Promise<Buffer>;
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

  constructor(options: FileWorkspaceCheckpointRepositoryOptions = {}) {
    this.baseDir = path.resolve(options.baseDir ?? getWorkspaceCheckpointsDir());
    this.policy = normalizePolicy(options.policy);
    this.now = options.now ?? (() => new Date());
    this.runCommand = options.runCommand ?? defaultCommandRunner;
    this.beforePublish = options.beforePublish;
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

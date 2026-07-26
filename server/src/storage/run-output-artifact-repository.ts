import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type {
  RunOutputArtifactCleanupInput,
  RunOutputArtifactCleanupResult,
  RunOutputArtifactCreateResult,
  RunOutputArtifactListQuery,
  RunOutputArtifactLookup,
  RunOutputArtifactMetadata,
  RunOutputArtifactRange,
  RunOutputArtifactRangeQuery,
  RunOutputQuarantineReason,
} from '@veritas-kanban/shared';
import { RunOutputArtifactMetadataSchema } from '../schemas/run-output-artifact-schemas.js';
import { getRuntimeDir } from '../utils/paths.js';
import { ensureWithinBase, validatePathSegment } from '../utils/sanitize.js';
import type { RunOutputArtifactRepository } from './interfaces.js';

const MAX_METADATA_BYTES = 64 * 1024;
const MAX_RANGE_BYTES = 4 * 1024 * 1024;
const MAX_SCAN_RECORDS = 20_000;
const MAX_LIST_LIMIT = 2_000;
const MAX_CLEANUP_LIMIT = 2_000;

export interface FileRunOutputArtifactRepositoryHooks {
  beforePublish?: (metadata: RunOutputArtifactMetadata) => void | Promise<void>;
}

export function getRunOutputArtifactsDir(): string {
  return path.join(getRuntimeDir(), 'run-output-artifacts');
}

function contentHash(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function sameIdentity(
  left: RunOutputArtifactMetadata,
  right: RunOutputArtifactMetadata
): boolean {
  return (
    left.id === right.id &&
    left.sha256 === right.sha256 &&
    left.scope.workspaceId === right.scope.workspaceId &&
    left.scope.taskId === right.scope.taskId &&
    left.scope.runId === right.scope.runId &&
    left.scope.attemptId === right.scope.attemptId
  );
}

function exactScope(metadata: RunOutputArtifactMetadata, lookup: RunOutputArtifactLookup): boolean {
  return (
    metadata.id === lookup.artifactId &&
    metadata.scope.workspaceId === lookup.workspaceId &&
    metadata.scope.taskId === lookup.taskId &&
    metadata.scope.runId === lookup.runId &&
    metadata.scope.attemptId === lookup.attemptId &&
    (lookup.turnId === undefined || metadata.scope.turnId === lookup.turnId)
  );
}

export class FileRunOutputArtifactRepository implements RunOutputArtifactRepository {
  constructor(
    private readonly baseDir = getRunOutputArtifactsDir(),
    private readonly hooks: FileRunOutputArtifactRepositoryHooks = {}
  ) {
    ensureWithinBase(path.dirname(baseDir), baseDir);
  }

  async create(
    candidate: RunOutputArtifactMetadata,
    content: Uint8Array | null
  ): Promise<RunOutputArtifactCreateResult> {
    const metadata = RunOutputArtifactMetadataSchema.parse(candidate);
    this.validateContent(metadata, content);
    const parent = await this.prepareScope(metadata.scope);
    const artifactDir = this.artifactPath(metadata.scope, metadata.id);
    const existing = await this.get(this.lookupFor(metadata));
    if (existing) {
      if (!sameIdentity(existing, metadata)) {
        throw new Error(`Run output artifact ${metadata.id} has conflicting identity.`);
      }
      return { metadata: existing, created: false };
    }

    const temporaryDir = path.join(parent, `.tmp-${metadata.id}-${nanoid(8)}`);
    ensureWithinBase(parent, temporaryDir);
    await mkdir(temporaryDir, { mode: 0o700 });
    try {
      await this.writeExclusive(
        path.join(temporaryDir, 'metadata.json'),
        Buffer.from(JSON.stringify(metadata), 'utf-8')
      );
      if (content) {
        await this.writeExclusive(path.join(temporaryDir, 'payload.bin'), content);
      }
      await this.hooks.beforePublish?.(metadata);
      await rename(temporaryDir, artifactDir);
      return { metadata, created: true };
    } catch (error) {
      const raced = await this.get(this.lookupFor(metadata));
      if (raced && sameIdentity(raced, metadata)) return { metadata: raced, created: false };
      throw error;
    } finally {
      await rm(temporaryDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async get(lookup: RunOutputArtifactLookup): Promise<RunOutputArtifactMetadata | null> {
    const metadataPath = path.join(
      this.artifactPath(lookup, lookup.artifactId),
      'metadata.json'
    );
    const content = await this.readBoundedFile(metadataPath, MAX_METADATA_BYTES);
    if (!content) return null;
    const metadata = RunOutputArtifactMetadataSchema.parse(
      JSON.parse(Buffer.from(content).toString('utf-8'))
    );
    return exactScope(metadata, lookup) ? metadata : null;
  }

  async readRange(query: RunOutputArtifactRangeQuery): Promise<RunOutputArtifactRange | null> {
    if (!Number.isInteger(query.offset) || query.offset < 0) {
      throw new Error('Artifact range offset must be a non-negative integer.');
    }
    if (!Number.isInteger(query.length) || query.length < 1 || query.length > MAX_RANGE_BYTES) {
      throw new Error(`Artifact range length must be between 1 and ${MAX_RANGE_BYTES} bytes.`);
    }
    const metadata = await this.get(query);
    if (!metadata || metadata.state !== 'available') return null;
    const payloadPath = path.join(this.artifactPath(query, query.artifactId), 'payload.bin');
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(payloadPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size !== metadata.storedBytes) {
        throw new Error('Run output artifact payload failed its size integrity check.');
      }
      const length = Math.min(query.length, Math.max(0, stat.size - query.offset));
      const content = Buffer.alloc(length);
      const result = length > 0 ? await handle.read(content, 0, length, query.offset) : undefined;
      return {
        metadata,
        offset: query.offset,
        length: result?.bytesRead ?? 0,
        content: content.subarray(0, result?.bytesRead ?? 0),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        throw new Error('Run output artifact payload is not a regular file.', { cause: error });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async list(query: RunOutputArtifactListQuery): Promise<RunOutputArtifactMetadata[]> {
    validatePathSegment(query.workspaceId);
    const workspaceDir = path.join(this.baseDir, query.workspaceId);
    ensureWithinBase(this.baseDir, workspaceDir);
    const records = await this.scanWorkspace(workspaceDir);
    const states = query.states ? new Set(query.states) : undefined;
    const limit = Math.min(Math.max(query.limit ?? 100, 1), MAX_LIST_LIMIT);
    return records
      .filter((metadata) => metadata.scope.workspaceId === query.workspaceId)
      .filter((metadata) => !query.taskId || metadata.scope.taskId === query.taskId)
      .filter((metadata) => !query.runId || metadata.scope.runId === query.runId)
      .filter((metadata) => !query.attemptId || metadata.scope.attemptId === query.attemptId)
      .filter((metadata) => !states || states.has(metadata.state))
      .sort(
        (left, right) =>
          Date.parse(right.retention.createdAt) - Date.parse(left.retention.createdAt) ||
          left.id.localeCompare(right.id)
      )
      .slice(0, limit);
  }

  async cleanup(input: RunOutputArtifactCleanupInput): Promise<RunOutputArtifactCleanupResult> {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), MAX_CLEANUP_LIMIT);
    const workspaces = input.workspaceId
      ? [input.workspaceId]
      : await this.childDirectories(this.baseDir);
    const now = Date.parse(input.now);
    if (!Number.isFinite(now)) throw new Error('Cleanup time must be a valid ISO timestamp.');
    const eligible: RunOutputArtifactMetadata[] = [];
    let retainedByLease = 0;
    for (const workspaceId of workspaces) {
      validatePathSegment(workspaceId);
      const workspaceDir = path.join(this.baseDir, workspaceId);
      for (const metadata of await this.scanWorkspace(workspaceDir)) {
        if (metadata.state !== 'available') continue;
        if (Date.parse(metadata.retention.expiresAt) > now) continue;
        if (
          metadata.retention.activeLeaseUntil &&
          Date.parse(metadata.retention.activeLeaseUntil) > now
        ) {
          retainedByLease += 1;
          continue;
        }
        eligible.push(metadata);
      }
    }
    eligible.sort(
      (left, right) =>
        Date.parse(left.retention.expiresAt) - Date.parse(right.retention.expiresAt) ||
        left.id.localeCompare(right.id)
    );
    let reclaimedBytes = 0;
    const expiredArtifactIds: string[] = [];
    for (const metadata of eligible.slice(0, limit)) {
      await this.expire(metadata, input.now);
      reclaimedBytes += metadata.storedBytes;
      expiredArtifactIds.push(metadata.id);
    }
    return {
      expiredArtifactIds,
      reclaimedBytes,
      retainedByLease,
      hasMore: eligible.length > limit,
    };
  }

  async quarantine(
    lookup: RunOutputArtifactLookup,
    reason: RunOutputQuarantineReason,
    now: string
  ): Promise<RunOutputArtifactMetadata | null> {
    const metadata = await this.get(lookup);
    if (!metadata) return null;
    if (metadata.state === 'quarantined') return metadata;
    if (metadata.state !== 'available') return metadata;
    return this.transitionBodyState(metadata, 'quarantined', now, reason);
  }

  private validateContent(metadata: RunOutputArtifactMetadata, content: Uint8Array | null): void {
    if (metadata.state === 'available') {
      if (!content) throw new Error('Available run output artifacts require persisted content.');
      if (content.byteLength !== metadata.storedBytes || contentHash(content) !== metadata.sha256) {
        throw new Error('Run output artifact content does not match its integrity metadata.');
      }
      return;
    }
    if (content || metadata.storedBytes !== 0) {
      throw new Error('Unavailable run output artifacts cannot persist a payload body.');
    }
  }

  private lookupFor(metadata: RunOutputArtifactMetadata): RunOutputArtifactLookup {
    return { ...metadata.scope, artifactId: metadata.id };
  }

  private artifactPath(
    scope: Pick<
      RunOutputArtifactLookup,
      'workspaceId' | 'taskId' | 'runId' | 'attemptId'
    >,
    artifactId: string
  ): string {
    for (const segment of [
      scope.workspaceId,
      scope.taskId,
      scope.runId,
      scope.attemptId,
      artifactId,
    ]) {
      validatePathSegment(segment);
    }
    const resolved = path.join(
      this.baseDir,
      scope.workspaceId,
      scope.taskId,
      scope.runId,
      scope.attemptId,
      artifactId
    );
    ensureWithinBase(this.baseDir, resolved);
    return resolved;
  }

  private async prepareScope(scope: RunOutputArtifactMetadata['scope']): Promise<string> {
    await mkdir(this.baseDir, { recursive: true, mode: 0o700 });
    await this.assertPrivateDirectory(this.baseDir);
    let current = this.baseDir;
    for (const segment of [scope.workspaceId, scope.taskId, scope.runId, scope.attemptId]) {
      validatePathSegment(segment);
      const next = path.join(current, segment);
      ensureWithinBase(this.baseDir, next);
      await mkdir(next, { mode: 0o700 }).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      });
      await this.assertPrivateDirectory(next);
      current = next;
    }
    return current;
  }

  private async assertPrivateDirectory(directory: string): Promise<void> {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Run output artifact path is not a private regular directory.');
    }
  }

  private async writeExclusive(filePath: string, content: Uint8Array): Promise<void> {
    const handle = await open(
      filePath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600
    );
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async readBoundedFile(
    filePath: string,
    maxBytes: number
  ): Promise<Uint8Array | null> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > maxBytes) {
        throw new Error('Run output artifact metadata is not a bounded regular file.');
      }
      return await handle.readFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        throw new Error('Run output artifact metadata is not a bounded regular file.', {
          cause: error,
        });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private async childDirectories(parent: string): Promise<string[]> {
    try {
      const entries = await readdir(parent, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => entry.name)
        .filter((entry) => !entry.startsWith('.'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  private async scanWorkspace(workspaceDir: string): Promise<RunOutputArtifactMetadata[]> {
    const records: RunOutputArtifactMetadata[] = [];
    const taskIds = await this.childDirectories(workspaceDir);
    for (const taskId of taskIds) {
      const taskDir = path.join(workspaceDir, taskId);
      for (const runId of await this.childDirectories(taskDir)) {
        const runDir = path.join(taskDir, runId);
        for (const attemptId of await this.childDirectories(runDir)) {
          const attemptDir = path.join(runDir, attemptId);
          for (const artifactId of await this.childDirectories(attemptDir)) {
            if (records.length >= MAX_SCAN_RECORDS) {
              throw new Error('Run output artifact scan reached its bounded record limit.');
            }
            const content = await this.readBoundedFile(
              path.join(attemptDir, artifactId, 'metadata.json'),
              MAX_METADATA_BYTES
            );
            if (!content) continue;
            records.push(
              RunOutputArtifactMetadataSchema.parse(
                JSON.parse(Buffer.from(content).toString('utf-8'))
              )
            );
          }
        }
      }
    }
    return records;
  }

  private async expire(metadata: RunOutputArtifactMetadata, now: string): Promise<void> {
    await this.transitionBodyState(metadata, 'expired', now);
  }

  private async transitionBodyState(
    metadata: RunOutputArtifactMetadata,
    state: 'expired' | 'quarantined',
    now: string,
    quarantineReason?: RunOutputQuarantineReason
  ): Promise<RunOutputArtifactMetadata> {
    const artifactDir = this.artifactPath(metadata.scope, metadata.id);
    const payloadPath = path.join(artifactDir, 'payload.bin');
    await unlink(payloadPath).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
    const transitioned = RunOutputArtifactMetadataSchema.parse({
      ...metadata,
      state,
      quarantineReason,
      redaction: {
        ...metadata.redaction,
        state: state === 'quarantined' ? 'quarantined' : metadata.redaction.state,
        validatedAt: now,
      },
    });
    const temporaryPath = path.join(artifactDir, `.metadata-${nanoid(8)}.tmp`);
    await this.writeExclusive(temporaryPath, Buffer.from(JSON.stringify(transitioned), 'utf-8'));
    await rename(temporaryPath, path.join(artifactDir, 'metadata.json'));
    return transitioned;
  }
}

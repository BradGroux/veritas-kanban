import { createHash } from 'node:crypto';
import path from 'node:path';
import type { WorktreeManifest } from '@veritas-kanban/shared';
import { parseWorktreeManifest } from '../schemas/worktree-manifest-schemas.js';
import { ensureWithinBase, validatePathSegment } from '../utils/sanitize.js';
import { atomicWriteFile, fileExists, mkdir, readFile, readdir } from './fs-helpers.js';
import { withWorktreeManifestLock } from './worktree-manifest-lock.js';

export interface WorktreeManifestRepository {
  read(taskId: string): Promise<WorktreeManifest | null>;
  list(): Promise<WorktreeManifest[]>;
  save(manifest: WorktreeManifest): Promise<WorktreeManifest>;
  withTaskLock<T>(taskId: string, operation: () => Promise<T>): Promise<T>;
  withAllocationLock<T>(repositoryKey: string, operation: () => Promise<T>): Promise<T>;
}

export interface FileWorktreeManifestRepositoryOptions {
  manifestsDir: string;
  lockTimeoutMs?: number;
}

export class FileWorktreeManifestRepository implements WorktreeManifestRepository {
  private readonly manifestsDir: string;
  private readonly lockTimeoutMs: number;

  constructor(options: FileWorktreeManifestRepositoryOptions) {
    this.manifestsDir = path.resolve(options.manifestsDir);
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5_000;
  }

  async read(taskId: string): Promise<WorktreeManifest | null> {
    const manifestPath = this.manifestPath(taskId);
    if (!(await fileExists(manifestPath))) return null;
    return parseWorktreeManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  }

  async list(): Promise<WorktreeManifest[]> {
    if (!(await fileExists(this.manifestsDir))) return [];
    const files = (await readdir(this.manifestsDir))
      .filter((file) => file.endsWith('.json'))
      .sort();
    const manifests = await Promise.all(
      files.map(async (file) => {
        const manifestPath = ensureWithinBase(
          this.manifestsDir,
          path.join(this.manifestsDir, file)
        );
        return parseWorktreeManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
      })
    );
    return manifests;
  }

  async save(manifest: WorktreeManifest): Promise<WorktreeManifest> {
    const manifestPath = this.manifestPath(manifest.taskId);
    const current = await this.read(manifest.taskId);
    const next = parseWorktreeManifest({
      ...structuredClone(manifest),
      revision: (current?.revision ?? -1) + 1,
    });
    await mkdir(this.manifestsDir, { recursive: true });
    await atomicWriteFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
    return structuredClone(next);
  }

  async withTaskLock<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
    return withWorktreeManifestLock(this.manifestPath(taskId), operation, this.lockTimeoutMs);
  }

  async withAllocationLock<T>(repositoryKey: string, operation: () => Promise<T>): Promise<T> {
    const key = createHash('sha256').update(repositoryKey).digest('hex');
    const lockPath = ensureWithinBase(
      this.manifestsDir,
      path.join(this.manifestsDir, `.allocation-${key}`)
    );
    return withWorktreeManifestLock(lockPath, operation, this.lockTimeoutMs);
  }

  private manifestPath(taskId: string): string {
    validatePathSegment(taskId);
    return ensureWithinBase(this.manifestsDir, path.join(this.manifestsDir, `${taskId}.json`));
  }
}

export class InMemoryWorktreeManifestRepository implements WorktreeManifestRepository {
  private readonly manifests = new Map<string, WorktreeManifest>();
  private readonly queues = new Map<string, Promise<void>>();

  async read(taskId: string): Promise<WorktreeManifest | null> {
    const manifest = this.manifests.get(taskId);
    return manifest ? structuredClone(manifest) : null;
  }

  async list(): Promise<WorktreeManifest[]> {
    return [...this.manifests.values()]
      .sort((left, right) => left.taskId.localeCompare(right.taskId))
      .map((manifest) => structuredClone(manifest));
  }

  async save(manifest: WorktreeManifest): Promise<WorktreeManifest> {
    const current = this.manifests.get(manifest.taskId);
    const next = parseWorktreeManifest({
      ...structuredClone(manifest),
      revision: (current?.revision ?? -1) + 1,
    });
    this.manifests.set(next.taskId, next);
    return structuredClone(next);
  }

  async withTaskLock<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(taskId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.queues.set(taskId, current);
    await previous;
    try {
      return await operation();
    } finally {
      if (this.queues.get(taskId) === current) this.queues.delete(taskId);
      release();
    }
  }

  async withAllocationLock<T>(repositoryKey: string, operation: () => Promise<T>): Promise<T> {
    return this.withTaskLock(`allocation:${repositoryKey}`, operation);
  }
}

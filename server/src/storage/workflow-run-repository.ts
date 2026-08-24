import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'yaml';
import type { WorkflowDefinition, WorkflowRun } from '../types/workflow.js';
import { withFileLock } from '../services/file-lock.js';
import { ensureWithinBase, validatePathSegment } from '../utils/sanitize.js';
import { atomicWriteFile } from './fs-helpers.js';

const MAX_WORKFLOW_RUN_BYTES = 16 * 1024 * 1024;
const MAX_WORKFLOW_SNAPSHOT_BYTES = 4 * 1024 * 1024;

export type WorkflowRunFilters = { taskId?: string; workflowId?: string; status?: string };
export type WorkflowRunMetadata = Pick<
  WorkflowRun,
  | 'id'
  | 'workflowId'
  | 'workflowVersion'
  | 'taskId'
  | 'status'
  | 'startedAt'
  | 'completedAt'
  | 'error'
>;

type MaybePromise<T> = T | Promise<T>;

export interface WorkflowRunRepository {
  get(runId: string): MaybePromise<WorkflowRun | null>;
  list(filters?: WorkflowRunFilters): MaybePromise<WorkflowRun[]>;
  listMetadata(filters?: WorkflowRunFilters): MaybePromise<WorkflowRunMetadata[]>;
  save(run: WorkflowRun, expectedRevision?: number): MaybePromise<boolean>;
  saveWorkflowSnapshot(runId: string, workflow: WorkflowDefinition): MaybePromise<void>;
}

export class FileWorkflowRunRepository implements WorkflowRunRepository {
  private readonly runsDir: string;

  constructor(runsDir: string) {
    this.runsDir = path.resolve(runsDir);
  }

  async get(runId: string): Promise<WorkflowRun | null> {
    const runDir = this.runDir(runId);
    if (!(await this.regularDirectoryExists(this.runsDir))) return null;
    if (!(await this.regularDirectoryExists(runDir))) return null;
    return this.readRun(this.runPath(runId));
  }

  async list(filters: WorkflowRunFilters = {}): Promise<WorkflowRun[]> {
    const runs: WorkflowRun[] = [];
    for (const runId of await this.listRunIds()) {
      const run = await this.get(runId);
      if (!run || !matchesFilters(run, filters)) continue;
      runs.push(run);
    }
    return runs.sort(compareRuns);
  }

  async listMetadata(filters: WorkflowRunFilters = {}): Promise<WorkflowRunMetadata[]> {
    const metadata: WorkflowRunMetadata[] = [];
    for (const runId of await this.listRunIds()) {
      try {
        const run = await this.get(runId);
        if (!run || !matchesFilters(run, filters)) continue;
        metadata.push({
          id: run.id,
          workflowId: run.workflowId,
          workflowVersion: run.workflowVersion,
          taskId: run.taskId,
          status: run.status,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          error: run.error,
        });
      } catch {
        continue;
      }
    }
    return metadata.sort(
      (left, right) =>
        new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime() ||
        right.id.localeCompare(left.id)
    );
  }

  async save(run: WorkflowRun, expectedRevision = 0): Promise<boolean> {
    const runDir = this.runDir(run.id);
    const runPath = this.runPath(run.id);
    await this.prepareDirectory(this.runsDir);
    await this.prepareDirectory(runDir);
    return withFileLock(runPath, async () => {
      const current = await this.readRun(runPath);
      const currentRevision = current?.revision ?? 0;
      if (
        (current && currentRevision !== expectedRevision) ||
        (!current && expectedRevision !== 0)
      ) {
        return false;
      }
      const content = JSON.stringify(run, null, 2);
      if (Buffer.byteLength(content, 'utf8') > MAX_WORKFLOW_RUN_BYTES) {
        throw new Error('Workflow run exceeds the 16 MiB storage limit');
      }
      await atomicWriteFile(runPath, content, 'utf8');
      return true;
    });
  }

  async saveWorkflowSnapshot(runId: string, workflow: WorkflowDefinition): Promise<void> {
    const runDir = this.runDir(runId);
    const snapshotPath = ensureWithinBase(runDir, path.join(runDir, 'workflow.yml'));
    await this.prepareDirectory(this.runsDir);
    await this.prepareDirectory(runDir);
    const content = yaml.stringify(workflow);
    if (Buffer.byteLength(content, 'utf8') > MAX_WORKFLOW_SNAPSHOT_BYTES) {
      throw new Error('Workflow snapshot exceeds the 4 MiB storage limit');
    }
    await withFileLock(snapshotPath, () => atomicWriteFile(snapshotPath, content, 'utf8'));
  }

  private async listRunIds(): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(this.runsDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const stats = await lstat(this.runsDir);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('Workflow runs path must use a regular directory');
    }
    return entries
      .filter(
        (entry) => entry.isDirectory() && !entry.isSymbolicLink() && entry.name.startsWith('run_')
      )
      .map((entry) => entry.name)
      .filter((runId) => {
        try {
          validatePathSegment(runId);
          return true;
        } catch {
          return false;
        }
      });
  }

  private runDir(runId: string): string {
    return ensureWithinBase(this.runsDir, path.join(this.runsDir, validatePathSegment(runId)));
  }

  private runPath(runId: string): string {
    const runDir = this.runDir(runId);
    return ensureWithinBase(runDir, path.join(runDir, 'run.json'));
  }

  private async prepareDirectory(directory: string): Promise<void> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stats = await lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('Workflow runs path must use a regular directory');
    }
  }

  private async regularDirectoryExists(directory: string): Promise<boolean> {
    try {
      const stats = await lstat(directory);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new Error('Workflow runs path must use a regular directory');
      }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  private async readRun(runPath: string): Promise<WorkflowRun | null> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(runPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const [pathStats, stats] = await Promise.all([lstat(runPath), handle.stat()]);
      if (
        pathStats.isSymbolicLink() ||
        pathStats.dev !== stats.dev ||
        pathStats.ino !== stats.ino
      ) {
        throw new Error('Workflow run must not use a symbolic link or changed file');
      }
      if (!stats.isFile() || stats.size > MAX_WORKFLOW_RUN_BYTES) {
        throw new Error('Workflow run must use a bounded regular file');
      }
      return JSON.parse(await handle.readFile({ encoding: 'utf8' })) as WorkflowRun;
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT') return null;
      if (errorCode === 'ELOOP') {
        throw new Error('Workflow run must not use a symbolic link', { cause: error });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }
}

function matchesFilters(run: WorkflowRun, filters: WorkflowRunFilters): boolean {
  return (
    (!filters.taskId || run.taskId === filters.taskId) &&
    (!filters.workflowId || run.workflowId === filters.workflowId) &&
    (!filters.status || run.status === filters.status)
  );
}

function compareRuns(left: WorkflowRun, right: WorkflowRun): number {
  return (
    new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime() ||
    right.id.localeCompare(left.id)
  );
}

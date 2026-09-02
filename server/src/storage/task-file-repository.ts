import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, open, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { ReviewComment, Task } from '@veritas-kanban/shared';
import matter from '../utils/frontmatter.js';
import { createLogger } from '../lib/logger.js';
import { withFileLock } from '../services/file-lock.js';
import type {
  TaskIdentityCandidate,
  TaskIdentityLocation,
  TaskIdentityScanSource,
} from '../services/task-identity-diagnostics.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import { atomicWriteFile, batchedMap, watch, type FSWatcher } from './fs-helpers.js';

const log = createLogger('task-file-repository');
const MAX_TASK_FILE_BYTES = 16 * 1024 * 1024;
const WRITE_DEBOUNCE_MS = 200;
const TASK_ID_REGEX = /^task_(\d{8}_[a-zA-Z0-9_-]{1,20}|[a-zA-Z0-9_-]+)$/;

export interface FileTaskRepositoryOptions {
  activeDir: string;
  archiveDir: string;
}

export interface TaskFileDescriptor {
  path: string;
  filename: string;
  diagnosticPath: string;
}

export interface TaskFileChange {
  filename: string;
  task: Task | null;
}

type ActiveMutation<T> = (current: Task, persist: (updated: Task) => Promise<void>) => Promise<T>;

function makeSlug(text: string): string {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  let start = 0;
  let end = normalized.length;
  while (normalized[start] === '-') start += 1;
  while (normalized[end - 1] === '-') end -= 1;
  return normalized.slice(start, end).slice(0, 50);
}

function assertTaskId(id: string): void {
  if (!TASK_ID_REGEX.test(id)) {
    throw new Error('Invalid task ID format');
  }
}

function assertLookupId(id: string): void {
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error('Invalid task lookup ID');
  }
}

export class FileTaskRepository {
  private readonly activeDir: string;
  private readonly archiveDir: string;
  private readonly taskRoot: string;
  private ready: Promise<void> | null = null;
  private watcher: FSWatcher | null = null;
  private lastWriteTime = 0;
  private readonly taskMutexes = new Map<string, Promise<void>>();

  constructor(options: FileTaskRepositoryOptions) {
    this.activeDir = path.resolve(options.activeDir);
    this.archiveDir = path.resolve(options.archiveDir);
    this.taskRoot = path.dirname(this.activeDir);
  }

  ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = Promise.all([
        mkdir(this.activeDir, { recursive: true }),
        mkdir(this.archiveDir, { recursive: true }),
      ]).then(() => undefined);
    }
    return this.ready;
  }

  async seedExamplesIfEmpty(): Promise<number> {
    await this.ensureReady();
    const activeEntries = await readdir(this.activeDir, { withFileTypes: true });
    if (activeEntries.some((entry) => entry.isFile() && entry.name.endsWith('.md'))) return 0;

    const examplesDir = ensureWithinBase(this.taskRoot, path.join(this.taskRoot, 'examples'));
    try {
      const examples = await readdir(examplesDir, { withFileTypes: true });
      const markdownExamples = examples.filter(
        (entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.md')
      );
      await Promise.all(
        markdownExamples.map((entry) =>
          copyFile(
            this.containedFile(examplesDir, entry.name),
            this.containedFile(this.activeDir, entry.name)
          )
        )
      );
      return markdownExamples.length;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw error;
    }
  }

  async listActive(): Promise<Task[]> {
    await this.ensureReady();
    const tasks = await this.listTasksIn(this.activeDir);
    return this.sortNewestFirst(tasks);
  }

  async findActiveById(id: string): Promise<Task | null> {
    assertLookupId(id);
    await this.ensureReady();
    return this.findTaskIn(this.activeDir, id);
  }

  async createActive(task: Task): Promise<void> {
    assertTaskId(task.id);
    await this.ensureReady();
    await this.withTaskLock(task.id, async () => {
      await withFileLock(this.taskLockPath(task.id), async () => {
        const descriptor = this.describeActive(task);
        this.markWrite();
        await atomicWriteFile(descriptor.path, this.taskToMarkdown(task), 'utf8');
      });
    });
  }

  async withBoardMutation<T>(mutation: () => Promise<T>): Promise<T> {
    await this.ensureReady();
    return withFileLock(path.join(this.taskRoot, 'board-position'), mutation);
  }

  async withActiveMutation<T>(id: string, mutation: ActiveMutation<T>): Promise<T | null> {
    assertLookupId(id);
    await this.ensureReady();
    return this.withTaskLock(id, () =>
      withFileLock(this.taskLockPath(id), async () => {
        const currentFile = await this.findTaskFilename(this.activeDir, id);
        if (!currentFile) return null;
        const current = await this.readTask(this.activeDir, currentFile);
        if (!current) return null;

        let persisted = false;
        const persist = async (updated: Task): Promise<void> => {
          if (persisted) throw new Error('Task mutation attempted more than one persistence write');
          if (updated.id !== id) throw new Error('Task mutation cannot change task identity');
          persisted = true;

          const destination = this.describeActive(updated);
          this.markWrite();
          await atomicWriteFile(destination.path, this.taskToMarkdown(updated), 'utf8');
          if (currentFile !== destination.filename) {
            await this.unlinkOptional(this.containedFile(this.activeDir, currentFile));
          }
        };

        return mutation(current, persist);
      })
    );
  }

  async deleteActive(id: string): Promise<boolean> {
    assertLookupId(id);
    await this.ensureReady();
    return this.withTaskLock(id, () =>
      withFileLock(this.taskLockPath(id), async () => {
        const filenames = await this.findTaskFilenames(this.activeDir, id);
        if (filenames.length === 0) return false;
        this.markWrite();
        await Promise.all(
          filenames.map((filename) => unlink(this.containedFile(this.activeDir, filename)))
        );
        return true;
      })
    );
  }

  async archiveActive(id: string, archive: Task | ((current: Task) => Task)): Promise<boolean> {
    assertLookupId(id);
    await this.ensureReady();
    return this.withTaskLock(id, () =>
      withFileLock(this.taskLockPath(id), async () => {
        const filenames = await this.findTaskFilenames(this.activeDir, id);
        if (filenames.length === 0) return false;
        const current = await this.findNewestTaskIn(this.activeDir, filenames);
        if (!current) return false;
        const archivedTask = typeof archive === 'function' ? archive(current) : archive;
        if (archivedTask.id !== id) throw new Error('Archived task identity does not match');
        const content = this.taskToMarkdown(archivedTask);
        this.markWrite();
        await Promise.all(
          filenames.map(async (filename) => {
            await atomicWriteFile(this.containedFile(this.archiveDir, filename), content, 'utf8');
            await unlink(this.containedFile(this.activeDir, filename));
          })
        );
        return true;
      })
    );
  }

  async listArchived(): Promise<Task[]> {
    await this.ensureReady();
    return this.sortNewestFirst(await this.listTasksIn(this.archiveDir));
  }

  async findArchivedById(id: string): Promise<Task | null> {
    assertLookupId(id);
    await this.ensureReady();
    return this.findTaskIn(this.archiveDir, id);
  }

  async restoreArchived(
    id: string,
    restore: Task | ((current: Task) => Task | null)
  ): Promise<boolean> {
    assertLookupId(id);
    await this.ensureReady();
    return this.withTaskLock(id, () =>
      withFileLock(this.taskLockPath(id), async () => {
        const archivedFilename = await this.findTaskFilename(this.archiveDir, id);
        if (!archivedFilename) return false;
        const current = await this.readTask(this.archiveDir, archivedFilename);
        if (!current) return false;
        const restoredTask = typeof restore === 'function' ? restore(current) : restore;
        if (!restoredTask) return false;
        if (restoredTask.id !== id) throw new Error('Restored task identity does not match');
        const destination = this.describeActive(restoredTask);
        this.markWrite();
        await atomicWriteFile(destination.path, this.taskToMarkdown(restoredTask), 'utf8');
        await unlink(this.containedFile(this.archiveDir, archivedFilename));
        return true;
      })
    );
  }

  async readActiveFile(filename: string): Promise<Task | null> {
    await this.ensureReady();
    return this.readTask(this.activeDir, filename);
  }

  watchActive(listener: (change: TaskFileChange) => void): void {
    if (this.watcher) return;
    try {
      this.watcher = watch(this.activeDir, (_eventType, filename) => {
        if (!filename || !filename.endsWith('.md')) return;
        if (Date.now() - this.lastWriteTime < WRITE_DEBOUNCE_MS) return;
        this.readActiveFile(filename)
          .then((task) => listener({ filename, task }))
          .catch((error) => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
              listener({ filename, task: null });
              return;
            }
            log.error({ err: error, filename }, 'Error reloading task file');
          });
      });
    } catch (error) {
      log.warn({ err: error }, 'Could not start task file watcher');
    }
  }

  getIdentityScanSources(backlogDir: string | null): TaskIdentityScanSource[] {
    const sources: TaskIdentityScanSource[] = [
      { location: 'active', dir: this.activeDir },
      { location: 'archive', dir: this.archiveDir },
    ];
    if (backlogDir) sources.push({ location: 'backlog', dir: backlogDir });
    return sources;
  }

  getActiveDirectory(): string {
    return this.activeDir;
  }

  getActiveDestinationPath(): string {
    return this.diagnosticPath(this.activeDir);
  }

  describeActiveTask(task: Task): TaskFileDescriptor {
    return this.describeActive(task);
  }

  describeIdentityCandidate(task: Task, location: TaskIdentityLocation): TaskIdentityCandidate {
    const descriptor =
      location === 'archive' ? this.describeTask(this.archiveDir, task) : this.describeActive(task);
    return {
      location,
      path: descriptor.path,
      filename: descriptor.filename,
      taskId: task.id,
      title: task.title,
      git: task.git,
      github: task.github,
    };
  }

  dispose(): void {
    this.watcher?.close();
    this.watcher = null;
    this.taskMutexes.clear();
  }

  private async listTasksIn(directory: string): Promise<Task[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const filenames = entries
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.md'))
      .map((entry) => entry.name);
    const tasks = await batchedMap(filenames, (filename) => this.readTask(directory, filename));
    return tasks.filter((task): task is Task => task !== null);
  }

  private async findTaskIn(directory: string, id: string): Promise<Task | null> {
    const filenames = await this.findTaskFilenames(directory, id);
    return this.findNewestTaskIn(directory, filenames);
  }

  private async findNewestTaskIn(directory: string, filenames: string[]): Promise<Task | null> {
    const tasks = await Promise.all(
      filenames.map((filename) => this.readTask(directory, filename))
    );
    const parsed = tasks.filter((task): task is Task => task !== null);
    return this.sortNewestFirst(parsed)[0] ?? null;
  }

  private async findTaskFilename(directory: string, id: string): Promise<string | null> {
    return (await this.findTaskFilenames(directory, id))[0] ?? null;
  }

  private async findTaskFilenames(directory: string, id: string): Promise<string[]> {
    assertLookupId(id);
    const entries = await readdir(directory, { withFileTypes: true });
    const prefix = `${id}-`;
    return entries
      .filter(
        (entry) =>
          entry.isFile() &&
          !entry.isSymbolicLink() &&
          entry.name.startsWith(prefix) &&
          entry.name.endsWith('.md')
      )
      .map((entry) => entry.name)
      .sort();
  }

  private async readTask(directory: string, filename: string): Promise<Task | null> {
    const filePath = this.containedFile(directory, filename);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const [pathStats, stats] = await Promise.all([lstat(filePath), handle.stat()]);
      if (
        pathStats.isSymbolicLink() ||
        pathStats.dev !== stats.dev ||
        pathStats.ino !== stats.ino ||
        !stats.isFile() ||
        stats.size > MAX_TASK_FILE_BYTES
      ) {
        throw new Error('Task storage requires a bounded regular file');
      }
      return this.parseTaskFile(await handle.readFile({ encoding: 'utf8' }), filename);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private parseTaskFile(content: string, filename: string): Task | null {
    try {
      const { data, content: description } = matter(content);
      let cleanDescription = description;
      const reviewComments: Task['reviewComments'] = [];
      const reviewSection = description.indexOf('## Review Comments');
      if (reviewSection !== -1) cleanDescription = description.slice(0, reviewSection).trim();

      const id = data.id || filename.split('-')[0];
      if (!TASK_ID_REGEX.test(id)) {
        log.warn({ filename, id }, 'Invalid task ID format');
        return null;
      }

      return {
        id,
        title: data.title || 'Untitled',
        description: cleanDescription.trim(),
        type: data.type || 'code',
        status: data.status || 'todo',
        priority: data.priority || 'medium',
        project: data.project,
        sprint: data.sprint,
        agent: data.agent,
        agents: data.agents,
        executionPolicy: data.executionPolicy,
        created: data.created || new Date().toISOString(),
        updated: data.updated || new Date().toISOString(),
        git: data.git,
        github: data.github,
        delegatedWork: data.delegatedWork,
        externalWorkItems: data.externalWorkItems,
        attempt: data.attempt,
        attempts: data.attempts,
        reviewComments,
        reviewScores: data.reviewScores,
        review: data.review,
        subtasks: data.subtasks,
        autoCompleteOnSubtasks: data.autoCompleteOnSubtasks,
        blockedBy: data.blockedBy,
        blockedReason: data.blockedReason,
        automation: data.automation,
        timeTracking: data.timeTracking,
        comments: data.comments,
        observations: data.observations,
        attachments: data.attachments,
        position: data.position,
        boardRank: data.boardRank,
        lastBoardMove: data.lastBoardMove,
        costPrediction: data.costPrediction,
        actualCost: data.actualCost,
        lessonsLearned: data.lessonsLearned,
        lessonTags: data.lessonTags,
        checkpoint: data.checkpoint,
        verificationSteps: data.verificationSteps,
        deliverables: data.deliverables,
        dependencies: data.dependencies,
        runMode: data.runMode,
        qaGate: data.qaGate,
        deletedAt: data.deletedAt,
        deletedBy: data.deletedBy,
        purgeAfter: data.purgeAfter,
        revision:
          typeof data.revision === 'number' && Number.isInteger(data.revision) && data.revision >= 0
            ? data.revision
            : undefined,
      };
    } catch (error) {
      log.error({ err: error, filename }, 'Failed to parse task file');
      return null;
    }
  }

  private taskToMarkdown(task: Task): string {
    const { description, reviewComments, ...rest } = task;
    const content = matter.stringify(description || '', this.deepCleanUndefined(rest));
    if (!reviewComments?.length) return content;
    const comments = reviewComments
      .map((comment: ReviewComment) => `- **${comment.file}:${comment.line}** - ${comment.content}`)
      .join('\n');
    return `${content}\n\n## Review Comments\n\n${comments}`;
  }

  private deepCleanUndefined(value: Record<string, unknown>): Record<string, unknown> {
    const clean: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) continue;
      if (Array.isArray(entry)) {
        clean[key] = entry.map((item) =>
          item && typeof item === 'object' && !Array.isArray(item)
            ? this.deepCleanUndefined(item as Record<string, unknown>)
            : item
        );
      } else if (entry && typeof entry === 'object') {
        clean[key] = this.deepCleanUndefined(entry as Record<string, unknown>);
      } else {
        clean[key] = entry;
      }
    }
    return clean;
  }

  private describeActive(task: Task): TaskFileDescriptor {
    return this.describeTask(this.activeDir, task);
  }

  private describeTask(directory: string, task: Task): TaskFileDescriptor {
    assertTaskId(task.id);
    const filename = `${task.id}-${makeSlug(task.title)}.md`;
    const filePath = this.containedFile(directory, filename);
    return { path: filePath, filename, diagnosticPath: this.diagnosticPath(filePath) };
  }

  private diagnosticPath(filePath: string): string {
    return path.relative(this.taskRoot, filePath);
  }

  private containedFile(directory: string, filename: string): string {
    const safeFilename = path.basename(filename);
    if (safeFilename !== filename) throw new Error('Task filename must be a single path segment');
    return ensureWithinBase(directory, path.join(directory, safeFilename));
  }

  private taskLockPath(id: string): string {
    assertLookupId(id);
    return this.containedFile(this.activeDir, `.${id}.task`);
  }

  private markWrite(): void {
    this.lastWriteTime = Date.now();
  }

  private async unlinkOptional(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private sortNewestFirst(tasks: Task[]): Task[] {
    return tasks.sort(
      (left, right) => new Date(right.updated).getTime() - new Date(left.updated).getTime()
    );
  }

  withTaskLock<T>(id: string, callback: () => Promise<T>): Promise<T> {
    assertLookupId(id);
    const previous = this.taskMutexes.get(id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.taskMutexes.set(id, current);

    return previous.then(callback).finally(() => {
      release();
      if (this.taskMutexes.get(id) === current) this.taskMutexes.delete(id);
    });
  }
}

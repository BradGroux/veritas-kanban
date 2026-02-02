/**
 * BacklogRepository - File-based storage for backlog tasks
 *
 * Mirrors the archive pattern: tasks in tasks/backlog/ directory,
 * separate from active tasks, not loaded by main task service.
 */

import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import type { Task } from '@veritas-kanban/shared';
import { createLogger } from '../lib/logger.js';

const log = createLogger('backlog-repo');

// Default paths - resolve to project root (one level up from server/)
const DEFAULT_PROJECT_ROOT = path.resolve(process.cwd(), '..');
const DEFAULT_BACKLOG_DIR = path.join(DEFAULT_PROJECT_ROOT, 'tasks', 'backlog');

export interface BacklogRepositoryOptions {
  backlogDir?: string;
}

export class BacklogRepository {
  private backlogDir: string;

  constructor(options: BacklogRepositoryOptions = {}) {
    this.backlogDir = options.backlogDir || DEFAULT_BACKLOG_DIR;
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    fs.mkdir(this.backlogDir, { recursive: true }).catch((err) => {
      log.error({ err }, 'Failed to create backlog directory');
    });
  }

  /**
   * Parse a task markdown file
   */
  private parseTaskFile(content: string, filename: string): Task | null {
    try {
      const parsed = matter(content);
      const frontmatter = parsed.data as Partial<Task>;
      const task: Task = {
        id: frontmatter.id || '',
        title: frontmatter.title || '',
        description: parsed.content.trim(),
        type: frontmatter.type || 'task',
        status: frontmatter.status || 'todo',
        priority: (frontmatter.priority as Task['priority']) || 'medium',
        project: frontmatter.project,
        sprint: frontmatter.sprint,
        created: frontmatter.created || new Date().toISOString(),
        updated: frontmatter.updated || new Date().toISOString(),
        agent: frontmatter.agent,
        git: frontmatter.git,
        github: frontmatter.github,
        attempt: frontmatter.attempt,
        attempts: frontmatter.attempts,
        reviewComments: frontmatter.reviewComments,
        review: frontmatter.review,
        subtasks: frontmatter.subtasks,
        autoCompleteOnSubtasks: frontmatter.autoCompleteOnSubtasks,
        verificationSteps: frontmatter.verificationSteps,
        blockedBy: frontmatter.blockedBy,
        blockedReason: frontmatter.blockedReason,
        automation: frontmatter.automation,
        plan: frontmatter.plan,
        timeTracking: frontmatter.timeTracking,
        comments: frontmatter.comments,
        attachments: frontmatter.attachments,
        position: frontmatter.position,
      };
      return task;
    } catch (err) {
      log.error({ err, filename }, 'Failed to parse backlog task file');
      return null;
    }
  }

  /**
   * Convert task object to markdown file content
   */
  private taskToMarkdown(task: Task): string {
    const { description, ...frontmatter } = task;
    // Strip undefined values — YAML.dump can't serialize them
    const clean = Object.fromEntries(
      Object.entries(frontmatter).filter(([, v]) => v !== undefined)
    );
    return matter.stringify(description || '', clean);
  }

  /**
   * Generate filename from task (same pattern as active tasks)
   */
  private taskToFilename(task: Task): string {
    const slug = task.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
    return `${task.id}-${slug}.md`;
  }

  /**
   * List all backlog tasks
   */
  async listAll(): Promise<Task[]> {
    await this.ensureDirectory();

    const files = await fs.readdir(this.backlogDir);
    const mdFiles = files.filter((f) => f.endsWith('.md'));

    const results = await Promise.all(
      mdFiles.map(async (filename) => {
        const filepath = path.join(this.backlogDir, filename);
        const content = await fs.readFile(filepath, 'utf-8');
        return this.parseTaskFile(content, filename);
      })
    );

    // Filter out null values from failed parses
    const tasks = results.filter((t): t is Task => t !== null);

    // Sort by updated date, newest first
    return tasks.sort(
      (a: Task, b: Task) => new Date(b.updated).getTime() - new Date(a.updated).getTime()
    );
  }

  /**
   * Get a single backlog task by ID
   */
  async findById(id: string): Promise<Task | null> {
    const tasks = await this.listAll();
    return tasks.find((t) => t.id === id) || null;
  }

  /**
   * Create a new task in backlog
   */
  async create(task: Task): Promise<Task> {
    const filename = this.taskToFilename(task);
    const filepath = path.join(this.backlogDir, filename);
    const content = this.taskToMarkdown(task);

    await fs.writeFile(filepath, content, 'utf-8');
    log.debug({ taskId: task.id }, 'Created backlog task');

    return task;
  }

  /**
   * Update a backlog task
   */
  async update(id: string, updates: Partial<Task>): Promise<Task> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error(`Backlog task not found: ${id}`);
    }

    const oldFilename = this.taskToFilename(existing);
    const oldFilepath = path.join(this.backlogDir, oldFilename);

    const updated: Task = {
      ...existing,
      ...updates,
      id: existing.id, // Never change ID
      updated: new Date().toISOString(),
    };

    const newFilename = this.taskToFilename(updated);
    const newFilepath = path.join(this.backlogDir, newFilename);

    const content = this.taskToMarkdown(updated);

    // If filename changed (due to title change), remove old file
    if (oldFilename !== newFilename) {
      await fs.unlink(oldFilepath).catch(() => {});
    }

    await fs.writeFile(newFilepath, content, 'utf-8');
    log.debug({ taskId: id }, 'Updated backlog task');

    return updated;
  }

  /**
   * Delete a backlog task
   */
  async delete(id: string): Promise<boolean> {
    const task = await this.findById(id);
    if (!task) {
      return false;
    }

    const filename = this.taskToFilename(task);
    const filepath = path.join(this.backlogDir, filename);

    await fs.unlink(filepath);
    log.debug({ taskId: id }, 'Deleted backlog task');

    return true;
  }

  /**
   * Move a task file from backlog to active tasks
   */
  async moveToActive(id: string, activeTasksDir: string): Promise<boolean> {
    const task = await this.findById(id);
    if (!task) {
      return false;
    }

    const filename = this.taskToFilename(task);
    const sourcePath = path.join(this.backlogDir, filename);
    const destPath = path.join(activeTasksDir, filename);

    await fs.rename(sourcePath, destPath);
    log.debug({ taskId: id }, 'Moved task from backlog to active');

    return true;
  }

  /**
   * Move a task file from active tasks to backlog
   */
  async moveFromActive(task: Task, activeTasksDir: string): Promise<boolean> {
    const filename = this.taskToFilename(task);
    const sourcePath = path.join(activeTasksDir, filename);
    const destPath = path.join(this.backlogDir, filename);

    await fs.rename(sourcePath, destPath);
    log.debug({ taskId: task.id }, 'Moved task from active to backlog');

    return true;
  }
}

// Singleton instance
let backlogRepositoryInstance: BacklogRepository | null = null;

export function getBacklogRepository(): BacklogRepository {
  if (!backlogRepositoryInstance) {
    backlogRepositoryInstance = new BacklogRepository();
  }
  return backlogRepositoryInstance;
}

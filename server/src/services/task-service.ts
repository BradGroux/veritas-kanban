import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import { nanoid } from 'nanoid';
import type { Task, CreateTaskInput, UpdateTaskInput, ReviewComment } from '@veritas-kanban/shared';

// Simple slug function to avoid CJS/ESM issues with slugify
function makeSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

const TASKS_DIR = path.join(process.cwd(), 'tasks', 'active');
const ARCHIVE_DIR = path.join(process.cwd(), 'tasks', 'archive');

export class TaskService {
  constructor() {
    this.ensureDirectories();
  }

  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(TASKS_DIR, { recursive: true });
    await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  }

  private generateId(): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `task_${date}_${nanoid(6)}`;
  }

  private taskToFilename(task: Task): string {
    const slug = makeSlug(task.title);
    return `${task.id}-${slug}.md`;
  }

  private taskToMarkdown(task: Task): string {
    const { description, reviewComments, ...frontmatter } = task;
    
    const content = matter.stringify(description || '', frontmatter);
    
    // Add review comments section if present
    if (reviewComments && reviewComments.length > 0) {
      const commentsSection = reviewComments
        .map((c: ReviewComment) => `- **${c.file}:${c.line}** - ${c.content}`)
        .join('\n');
      return content + '\n\n## Review Comments\n\n' + commentsSection;
    }
    
    return content;
  }

  private parseTaskFile(content: string, filename: string): Task {
    const { data, content: description } = matter(content);
    
    // Extract review comments from description if present
    let cleanDescription = description;
    const reviewComments: Task['reviewComments'] = [];
    
    const reviewSection = description.indexOf('## Review Comments');
    if (reviewSection !== -1) {
      cleanDescription = description.slice(0, reviewSection).trim();
    }

    return {
      id: data.id || filename.split('-')[0],
      title: data.title || 'Untitled',
      description: cleanDescription.trim(),
      type: data.type || 'code',
      status: data.status || 'todo',
      priority: data.priority || 'medium',
      project: data.project,
      tags: data.tags,
      created: data.created || new Date().toISOString(),
      updated: data.updated || new Date().toISOString(),
      git: data.git,
      attempt: data.attempt,
      attempts: data.attempts,
      reviewComments,
    };
  }

  async listTasks(): Promise<Task[]> {
    await this.ensureDirectories();
    
    const files = await fs.readdir(TASKS_DIR);
    const mdFiles = files.filter(f => f.endsWith('.md'));
    
    const tasks = await Promise.all(
      mdFiles.map(async (filename) => {
        const filepath = path.join(TASKS_DIR, filename);
        const content = await fs.readFile(filepath, 'utf-8');
        return this.parseTaskFile(content, filename);
      })
    );

    // Sort by updated date, newest first
    return tasks.sort((a: Task, b: Task) => 
      new Date(b.updated).getTime() - new Date(a.updated).getTime()
    );
  }

  async getTask(id: string): Promise<Task | null> {
    const tasks = await this.listTasks();
    return tasks.find(t => t.id === id) || null;
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const now = new Date().toISOString();
    
    const task: Task = {
      id: this.generateId(),
      title: input.title,
      description: input.description || '',
      type: input.type || 'code',
      status: 'todo',
      priority: input.priority || 'medium',
      project: input.project,
      tags: input.tags,
      created: now,
      updated: now,
    };

    const filename = this.taskToFilename(task);
    const filepath = path.join(TASKS_DIR, filename);
    const content = this.taskToMarkdown(task);
    
    await fs.writeFile(filepath, content, 'utf-8');
    
    return task;
  }

  async updateTask(id: string, input: UpdateTaskInput): Promise<Task | null> {
    const task = await this.getTask(id);
    if (!task) return null;

    // Handle git field separately to merge properly
    const { git: gitUpdate, ...restInput } = input;
    
    const updatedTask: Task = {
      ...task,
      ...restInput,
      git: gitUpdate ? { ...task.git, ...gitUpdate } as Task['git'] : task.git,
      updated: new Date().toISOString(),
    };

    // Remove old file if title changed (filename changes)
    const oldFilename = this.taskToFilename(task);
    const newFilename = this.taskToFilename(updatedTask);
    
    if (oldFilename !== newFilename) {
      await fs.unlink(path.join(TASKS_DIR, oldFilename)).catch(() => {});
    }

    const filepath = path.join(TASKS_DIR, newFilename);
    const content = this.taskToMarkdown(updatedTask);
    
    await fs.writeFile(filepath, content, 'utf-8');
    
    return updatedTask;
  }

  async deleteTask(id: string): Promise<boolean> {
    const task = await this.getTask(id);
    if (!task) return false;

    const filename = this.taskToFilename(task);
    await fs.unlink(path.join(TASKS_DIR, filename));
    
    return true;
  }

  async archiveTask(id: string): Promise<boolean> {
    const task = await this.getTask(id);
    if (!task) return false;

    const filename = this.taskToFilename(task);
    const sourcePath = path.join(TASKS_DIR, filename);
    const destPath = path.join(ARCHIVE_DIR, filename);
    
    await fs.rename(sourcePath, destPath);
    
    return true;
  }
}

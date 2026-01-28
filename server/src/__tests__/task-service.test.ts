import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { TaskService } from '../services/task-service.js';

describe('TaskService', () => {
  let service: TaskService;
  let testRoot: string;
  let tasksDir: string;
  let archiveDir: string;

  beforeEach(async () => {
    // Create fresh test directories with unique suffix
    const uniqueSuffix = Math.random().toString(36).substring(7);
    testRoot = path.join(os.tmpdir(), `veritas-test-tasks-${uniqueSuffix}`);
    tasksDir = path.join(testRoot, 'active');
    archiveDir = path.join(testRoot, 'archive');
    
    await fs.mkdir(tasksDir, { recursive: true });
    await fs.mkdir(archiveDir, { recursive: true });
    
    service = new TaskService({
      tasksDir,
      archiveDir,
    });
  });

  afterEach(async () => {
    // Clean up test directories
    if (testRoot) {
      await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('Task file parsing', () => {
    it('should parse a valid task file', async () => {
      const taskContent = `---
id: task_20260126_abc123
title: Test Task
type: code
status: todo
priority: high
project: test-project
sprint: US-900
created: '2026-01-26T10:00:00.000Z'
updated: '2026-01-26T10:00:00.000Z'
---
This is the task description.

With multiple paragraphs.
`;
      await fs.writeFile(path.join(tasksDir, 'task_20260126_abc123-test-task.md'), taskContent);

      const tasks = await service.listTasks();
      expect(tasks).toHaveLength(1);

      const task = tasks[0];
      expect(task.id).toBe('task_20260126_abc123');
      expect(task.title).toBe('Test Task');
      expect(task.type).toBe('code');
      expect(task.status).toBe('todo');
      expect(task.priority).toBe('high');
      expect(task.project).toBe('test-project');
      expect(task.sprint).toBe('US-900');
      expect(task.description).toContain('This is the task description');
    });

    it('should parse a task with git metadata', async () => {
      const taskContent = `---
id: task_20260126_git123
title: Git Task
type: code
status: in-progress
priority: medium
created: '2026-01-26T10:00:00.000Z'
updated: '2026-01-26T10:00:00.000Z'
git:
  repo: my-repo
  branch: feature/test
  baseBranch: main
  worktreePath: /path/to/worktree
---
Code task with git info.
`;
      await fs.writeFile(path.join(tasksDir, 'task_20260126_git123-git-task.md'), taskContent);

      const tasks = await service.listTasks();
      const task = tasks[0];
      
      expect(task.git).toBeDefined();
      expect(task.git?.repo).toBe('my-repo');
      expect(task.git?.branch).toBe('feature/test');
      expect(task.git?.baseBranch).toBe('main');
      expect(task.git?.worktreePath).toBe('/path/to/worktree');
    });

    it('should parse a task with attempt history', async () => {
      const taskContent = `---
id: task_20260126_attempt123
title: Agent Task
type: code
status: blocked
priority: high
created: '2026-01-26T10:00:00.000Z'
updated: '2026-01-26T12:00:00.000Z'
attempt:
  id: attempt_001
  agent: claude-code
  status: complete
  started: '2026-01-26T11:00:00.000Z'
  ended: '2026-01-26T12:00:00.000Z'
attempts:
  - id: attempt_001
    agent: claude-code
    status: complete
    started: '2026-01-26T11:00:00.000Z'
    ended: '2026-01-26T12:00:00.000Z'
---
Task with agent attempt.
`;
      await fs.writeFile(path.join(tasksDir, 'task_20260126_attempt123-agent-task.md'), taskContent);

      const tasks = await service.listTasks();
      const task = tasks[0];
      
      expect(task.attempt).toBeDefined();
      expect(task.attempt?.agent).toBe('claude-code');
      expect(task.attempt?.status).toBe('complete');
      expect(task.attempts).toHaveLength(1);
    });

    it('should handle minimal task files', async () => {
      const taskContent = `---
id: task_minimal
title: Minimal Task
type: code
status: todo
priority: medium
created: '2026-01-26T10:00:00.000Z'
updated: '2026-01-26T10:00:00.000Z'
---
`;
      await fs.writeFile(path.join(tasksDir, 'task_minimal-minimal-task.md'), taskContent);

      const tasks = await service.listTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].description).toBe('');
    });

    it('should return empty array for empty directory', async () => {
      const tasks = await service.listTasks();
      expect(tasks).toEqual([]);
    });
  });

  describe('Task creation', () => {
    it('should create a task with all fields', async () => {
      const task = await service.createTask({
        title: 'New Task',
        description: 'Task description here',
        type: 'research',
        priority: 'high',
        project: 'my-project',
        sprint: 'US-900',
      });

      expect(task.id).toMatch(/^task_\d{8}_/);
      expect(task.title).toBe('New Task');
      expect(task.description).toBe('Task description here');
      expect(task.type).toBe('research');
      expect(task.status).toBe('todo');
      expect(task.priority).toBe('high');
      expect(task.project).toBe('my-project');
      expect(task.sprint).toBe('US-900');

      // Verify file was created
      const files = await fs.readdir(tasksDir);
      expect(files.some(f => f.includes('new-task'))).toBe(true);
    });

    it('should create a task with minimal fields', async () => {
      const task = await service.createTask({
        title: 'Minimal',
      });

      expect(task.title).toBe('Minimal');
      expect(task.type).toBe('code'); // default
      expect(task.priority).toBe('medium'); // default
      expect(task.status).toBe('todo'); // default
    });

    it('should generate proper slugs for filenames', async () => {
      const task = await service.createTask({
        title: 'Test: Special Characters! & More?',
      });

      const files = await fs.readdir(tasksDir);
      const taskFile = files.find(f => f.includes(task.id));
      expect(taskFile).toMatch(/test-special-characters-more/);
    });
  });

  describe('Task updates', () => {
    it('should update task fields', async () => {
      const task = await service.createTask({ title: 'Original' });
      
      // Small delay to ensure different timestamp
      await new Promise(r => setTimeout(r, 10));
      
      const updated = await service.updateTask(task.id, {
        title: 'Updated Title',
        status: 'in-progress',
        priority: 'high',
      });

      expect(updated?.title).toBe('Updated Title');
      expect(updated?.status).toBe('in-progress');
      expect(updated?.priority).toBe('high');
      expect(new Date(updated!.updated).getTime()).toBeGreaterThanOrEqual(new Date(task.updated).getTime());
    });

    it('should return null for non-existent task', async () => {
      const result = await service.updateTask('nonexistent', { title: 'Test' });
      expect(result).toBeNull();
    });

    it('should rename file when title changes', async () => {
      const task = await service.createTask({ title: 'Original Name' });
      const originalFiles = await fs.readdir(tasksDir);
      
      await service.updateTask(task.id, { title: 'New Name' });
      const newFiles = await fs.readdir(tasksDir);

      expect(originalFiles.some(f => f.includes('original-name'))).toBe(true);
      expect(newFiles.some(f => f.includes('new-name'))).toBe(true);
      expect(newFiles.some(f => f.includes('original-name'))).toBe(false);
    });
  });

  describe('Task deletion', () => {
    it('should delete a task', async () => {
      const task = await service.createTask({ title: 'To Delete' });
      
      const result = await service.deleteTask(task.id);
      expect(result).toBe(true);

      const tasks = await service.listTasks();
      expect(tasks).toHaveLength(0);
    });

    it('should return false for non-existent task', async () => {
      const result = await service.deleteTask('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('Task archival', () => {
    it('should move task to archive', async () => {
      const task = await service.createTask({ title: 'To Archive' });
      
      const result = await service.archiveTask(task.id);
      expect(result).toBe(true);

      // Task should be gone from active
      const activeTasks = await service.listTasks();
      expect(activeTasks).toHaveLength(0);

      // Task should be in archive
      const archiveFiles = await fs.readdir(archiveDir);
      expect(archiveFiles.some(f => f.includes('to-archive'))).toBe(true);
    });

    it('should return false for non-existent task', async () => {
      const result = await service.archiveTask('nonexistent');
      expect(result).toBe(false);
    });
  });
});

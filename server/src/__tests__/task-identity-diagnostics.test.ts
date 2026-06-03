import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { BacklogService } from '../services/backlog-service.js';
import { TaskService } from '../services/task-service.js';
import {
  filterTaskIdentityDiagnostics,
  scanTaskIdentityDiagnostics,
} from '../services/task-identity-diagnostics.js';
import { BacklogRepository } from '../storage/backlog-repository.js';
import { TelemetryService } from '../services/telemetry-service.js';

const CREATED = '2026-06-03T00:00:00.000Z';

function taskMarkdown(input: {
  id: string;
  title: string;
  githubIssue?: number;
  githubRepo?: string;
}): string {
  const github = input.githubIssue
    ? `
github:
  repo: ${input.githubRepo ?? 'BradGroux/veritas-kanban'}
  issueNumber: ${input.githubIssue}`
    : '';

  return `---
id: ${input.id}
title: ${input.title}
type: code
status: todo
priority: medium
created: ${CREATED}
updated: ${CREATED}${github}
---

${input.title}
`;
}

async function writeTask(dir: string, filename: string, markdown: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), markdown, 'utf-8');
}

describe('task identity diagnostics', () => {
  let testRoot: string;
  let activeDir: string;
  let backlogDir: string;
  let archiveDir: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-identity-'));
    activeDir = path.join(testRoot, 'tasks', 'active');
    backlogDir = path.join(testRoot, 'tasks', 'backlog');
    archiveDir = path.join(testRoot, 'tasks', 'archive');
    await Promise.all([
      fs.mkdir(activeDir, { recursive: true }),
      fs.mkdir(backlogDir, { recursive: true }),
      fs.mkdir(archiveDir, { recursive: true }),
    ]);
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('reports deterministic duplicate task IDs and business IDs across task buckets', async () => {
    await writeTask(
      activeDir,
      'task_20260603_dup-active.md',
      taskMarkdown({ id: 'task_20260603_dup', title: 'Active duplicate' })
    );
    await writeTask(
      backlogDir,
      'task_20260603_dup-backlog.md',
      taskMarkdown({ id: 'task_20260603_dup', title: 'Backlog duplicate' })
    );
    await writeTask(
      activeDir,
      'task_20260603_issue_a-active.md',
      taskMarkdown({ id: 'task_20260603_issue_a', title: 'Issue active', githubIssue: 377 })
    );
    await writeTask(
      archiveDir,
      'task_20260603_issue_b-archive.md',
      taskMarkdown({ id: 'task_20260603_issue_b', title: 'Issue archived', githubIssue: 377 })
    );

    const diagnostics = await scanTaskIdentityDiagnostics([
      { location: 'active', dir: activeDir },
      { location: 'backlog', dir: backlogDir },
      { location: 'archive', dir: archiveDir },
    ]);

    expect(diagnostics.hasConflicts).toBe(true);
    expect(diagnostics.conflicts).toEqual([
      expect.objectContaining({
        kind: 'business-id',
        id: 'github:BradGroux/veritas-kanban#377',
        sources: [
          expect.objectContaining({
            location: 'active',
            path: 'active/task_20260603_issue_a-active.md',
          }),
          expect.objectContaining({
            location: 'archive',
            path: 'archive/task_20260603_issue_b-archive.md',
          }),
        ],
      }),
      expect.objectContaining({
        kind: 'task-id',
        id: 'task_20260603_dup',
        sources: [
          expect.objectContaining({
            location: 'active',
            path: 'active/task_20260603_dup-active.md',
          }),
          expect.objectContaining({
            location: 'backlog',
            path: 'backlog/task_20260603_dup-backlog.md',
          }),
        ],
      }),
    ]);
  });

  it('filters conflicts to a target task before failing mutations', async () => {
    await writeTask(
      activeDir,
      'task_20260603_dup-active.md',
      taskMarkdown({ id: 'task_20260603_dup', title: 'Active duplicate' })
    );
    await writeTask(
      archiveDir,
      'task_20260603_dup-archive.md',
      taskMarkdown({ id: 'task_20260603_dup', title: 'Archive duplicate' })
    );
    await writeTask(
      backlogDir,
      'task_20260603_ok-backlog.md',
      taskMarkdown({ id: 'task_20260603_ok', title: 'Safe backlog task' })
    );

    const diagnostics = await scanTaskIdentityDiagnostics([
      { location: 'active', dir: activeDir },
      { location: 'backlog', dir: backlogDir },
      { location: 'archive', dir: archiveDir },
    ]);

    expect(filterTaskIdentityDiagnostics(diagnostics, 'task_20260603_ok').hasConflicts).toBe(false);
    expect(filterTaskIdentityDiagnostics(diagnostics, 'task_20260603_dup')).toMatchObject({
      hasConflicts: true,
      conflictCount: 1,
    });
  });

  it('blocks active task updates when the target identity is duplicated on disk', async () => {
    const taskService = new TaskService({
      tasksDir: activeDir,
      archiveDir,
      telemetryService: new TelemetryService({
        telemetryDir: path.join(testRoot, 'telemetry'),
        config: { enabled: false },
      }),
    });

    await writeTask(
      activeDir,
      'task_20260603_dup-active.md',
      taskMarkdown({ id: 'task_20260603_dup', title: 'Active duplicate' })
    );
    await writeTask(
      archiveDir,
      'task_20260603_dup-archive.md',
      taskMarkdown({ id: 'task_20260603_dup', title: 'Archive duplicate' })
    );

    await expect(
      taskService.updateTask('task_20260603_dup', { title: 'Updated' })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
      details: expect.objectContaining({
        operation: 'task.update',
        taskId: 'task_20260603_dup',
        duplicateIds: ['task_20260603_dup'],
      }),
    });

    taskService.dispose();
  });

  it('blocks active task updates that would create a duplicate business identity', async () => {
    const taskService = new TaskService({
      tasksDir: activeDir,
      archiveDir,
      backlogDir,
      telemetryService: new TelemetryService({
        telemetryDir: path.join(testRoot, 'telemetry'),
        config: { enabled: false },
      }),
    });

    await writeTask(
      activeDir,
      'task_20260603_active-active.md',
      taskMarkdown({ id: 'task_20260603_active', title: 'Active task' })
    );
    await writeTask(
      backlogDir,
      'task_20260603_backlog-backlog.md',
      taskMarkdown({
        id: 'task_20260603_backlog',
        title: 'Backlog issue',
        githubIssue: 377,
      })
    );

    await expect(
      taskService.updateTask('task_20260603_active', {
        github: { issueNumber: 377, repo: 'BradGroux/veritas-kanban' },
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
      details: expect.objectContaining({
        operation: 'task.update',
        taskId: 'task_20260603_active',
        destinationPath: 'active/task_20260603_active-active-task.md',
        duplicateIds: ['github:BradGroux/veritas-kanban#377'],
      }),
    });

    taskService.dispose();
  });

  it('blocks backlog promotion when it would move one duplicate identity to active', async () => {
    const taskService = new TaskService({
      tasksDir: activeDir,
      archiveDir,
      telemetryService: new TelemetryService({
        telemetryDir: path.join(testRoot, 'telemetry'),
        config: { enabled: false },
      }),
    });
    const backlogService = new BacklogService({
      backlogRepo: new BacklogRepository({ backlogDir }),
      taskService,
      telemetry: new TelemetryService({
        telemetryDir: path.join(testRoot, 'telemetry-backlog'),
        config: { enabled: false },
      }),
    });

    await writeTask(
      activeDir,
      'task_20260603_dup-active.md',
      taskMarkdown({ id: 'task_20260603_dup', title: 'Active duplicate' })
    );
    await writeTask(
      backlogDir,
      'task_20260603_dup-backlog.md',
      taskMarkdown({ id: 'task_20260603_dup', title: 'Backlog duplicate' })
    );

    await expect(backlogService.promoteToActive('task_20260603_dup')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
      details: expect.objectContaining({
        operation: 'backlog.promote',
        taskId: 'task_20260603_dup',
        destinationPath: 'active',
        duplicateIds: ['task_20260603_dup'],
      }),
    });

    taskService.dispose();
  });
});

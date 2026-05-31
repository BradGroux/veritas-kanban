import { describe, expect, it } from 'vitest';
import type { Task } from '@veritas-kanban/shared';
import { createTestSqliteDatabase } from '../../storage/sqlite/test-helpers.js';
import { SqliteTaskRepository } from '../../storage/sqlite/task-repository.js';

interface CountRow {
  count: number;
}

interface AttachmentRow {
  id: string;
  task_id: string;
  workspace_id: string;
  mime_type: string;
  size_bytes: number;
  sha256: string | null;
  storage_path: string;
  validation_status: string;
  retention_status: string;
  cleanup_eligible: number;
}

interface DeliverableRow {
  id: string;
  task_id: string;
  workspace_id: string;
  type: string;
  status: string;
  agent: string | null;
  model: string | null;
  source_run_id: string | null;
  version_number: number;
  redaction_json: string | null;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    id: `task_20260530_${Math.random().toString(36).slice(2, 8)}`,
    title: 'SQLite Task',
    description: 'Persisted in SQLite',
    type: 'code',
    status: 'todo',
    priority: 'medium',
    created: now,
    updated: now,
    ...overrides,
  };
}

describe('SqliteTaskRepository', () => {
  it('persists and reads full task JSON with indexed fields', async () => {
    const fixture = createTestSqliteDatabase();
    const task = makeTask({
      title: 'Full fidelity task',
      description: 'Includes nested task details',
      project: 'veritas',
      sprint: 'v5',
      github: { issueNumber: 330, repo: 'BradGroux/veritas-kanban' },
      subtasks: [
        {
          id: 'subtask-1',
          title: 'Wire repository',
          completed: false,
          created: new Date().toISOString(),
          acceptanceCriteria: ['CRUD works'],
          criteriaChecked: [false],
        },
      ],
      comments: [
        {
          id: 'comment-1',
          author: 'tester',
          text: 'Preserve comments',
          timestamp: new Date().toISOString(),
        },
      ],
      observations: [
        {
          id: 'observation-1',
          type: 'decision',
          content: 'Use JSON payload plus indexed columns',
          score: 8,
          timestamp: new Date().toISOString(),
        },
      ],
      deliverables: [
        {
          id: 'deliverable-1',
          title: 'Patch',
          type: 'code',
          status: 'attached',
          created: new Date().toISOString(),
        },
      ],
      verificationSteps: [
        {
          id: 'verify-1',
          description: 'Run tests',
          checked: false,
        },
      ],
      timeTracking: {
        entries: [],
        totalSeconds: 120,
        isRunning: false,
      },
      position: 3,
    });

    try {
      fixture.database.open();
      const repo = new SqliteTaskRepository(fixture.database);

      await repo.create(task);

      expect(await repo.findById(task.id)).toEqual(task);
      expect(await repo.findAll()).toEqual([task]);
    } finally {
      fixture.cleanup();
    }
  });

  it('syncs attachment and deliverable metadata into normalized SQLite tables', async () => {
    const fixture = createTestSqliteDatabase();
    const task = makeTask({
      title: 'Artifact metadata task',
      attachments: [
        {
          id: 'att-1',
          filename: 'att-1_report.pdf',
          originalName: 'report.pdf',
          mimeType: 'application/pdf',
          size: 4096,
          uploaded: '2026-05-30T12:00:00.000Z',
          workspaceId: 'local',
          sessionId: 'session-1',
          uploadedBy: 'tester',
          sha256: 'abc123',
          storagePath: 'tasks/attachments/task-1/att-1_report.pdf',
          validationStatus: 'valid',
          retentionStatus: 'active',
          cleanupEligible: false,
        },
      ],
      deliverables: [
        {
          id: 'deliverable-1',
          title: 'Completion packet',
          type: 'report',
          status: 'attached',
          agent: 'codex',
          model: 'gpt-5',
          sourceRunId: 'run-1',
          version: 3,
          created: '2026-05-30T12:05:00.000Z',
          updated: '2026-05-30T12:06:00.000Z',
          description: 'Verified artifact',
          redaction: {
            level: 'standard',
            containsSensitiveContent: false,
            notes: ['paths redacted'],
          },
        },
      ],
    });

    try {
      fixture.database.open();
      const repo = new SqliteTaskRepository(fixture.database);

      await repo.create(task);

      const db = fixture.database.getConnection();
      const attachment = db
        .prepare(
          `
            SELECT id, task_id, workspace_id, mime_type, size_bytes, sha256, storage_path,
                   validation_status, retention_status, cleanup_eligible
            FROM task_attachments
            WHERE task_id = ?
          `
        )
        .get(task.id) as AttachmentRow | undefined;
      expect(attachment).toEqual({
        id: 'att-1',
        task_id: task.id,
        workspace_id: 'local',
        mime_type: 'application/pdf',
        size_bytes: 4096,
        sha256: 'abc123',
        storage_path: 'tasks/attachments/task-1/att-1_report.pdf',
        validation_status: 'valid',
        retention_status: 'active',
        cleanup_eligible: 0,
      });

      const deliverable = db
        .prepare(
          `
            SELECT id, task_id, workspace_id, type, status, agent, model, source_run_id,
                   version_number, redaction_json
            FROM task_deliverables
            WHERE task_id = ?
          `
        )
        .get(task.id) as DeliverableRow | undefined;
      expect(deliverable).toEqual({
        id: 'deliverable-1',
        task_id: task.id,
        workspace_id: 'local',
        type: 'report',
        status: 'attached',
        agent: 'codex',
        model: 'gpt-5',
        source_run_id: 'run-1',
        version_number: 3,
        redaction_json: JSON.stringify(task.deliverables?.[0]?.redaction),
      });

      await repo.update(task.id, {
        attachments: [],
        deliverables: [
          {
            ...(task.deliverables?.[0] as NonNullable<Task['deliverables']>[number]),
            status: 'reviewed',
            version: 4,
          },
        ],
      });

      const attachmentCount = db
        .prepare('SELECT COUNT(*) AS count FROM task_attachments WHERE task_id = ?')
        .get(task.id) as CountRow;
      expect(attachmentCount.count).toBe(0);

      const updatedDeliverable = db
        .prepare(
          `
            SELECT status, version_number
            FROM task_deliverables
            WHERE task_id = ?
          `
        )
        .get(task.id) as Pick<DeliverableRow, 'status' | 'version_number'> | undefined;
      expect(updatedDeliverable).toEqual({ status: 'reviewed', version_number: 4 });
    } finally {
      fixture.cleanup();
    }
  });

  it('updates, archives, restores, and deletes active tasks without file moves', async () => {
    const fixture = createTestSqliteDatabase();
    const task = makeTask({ title: 'Lifecycle task' });

    try {
      fixture.database.open();
      const repo = new SqliteTaskRepository(fixture.database);

      await repo.create(task);
      const updated = await repo.update(task.id, { title: 'Updated lifecycle task', position: 1 });

      expect(updated.title).toBe('Updated lifecycle task');
      expect(updated.position).toBe(1);

      expect(await repo.archive(task.id)).toBe(true);
      expect(await repo.findById(task.id)).toBeNull();
      expect((await repo.listArchived()).map((archived) => archived.id)).toEqual([task.id]);

      const restored = await repo.restore(task.id);
      expect(restored?.status).toBe('done');
      expect(await repo.findArchivedById(task.id)).toBeNull();
      expect(await repo.findById(task.id)).toEqual(restored);

      await repo.delete(task.id);
      expect(await repo.findById(task.id)).toBeNull();
    } finally {
      fixture.cleanup();
    }
  });

  it('uses FTS-backed search for active task title and description', async () => {
    const fixture = createTestSqliteDatabase();

    try {
      fixture.database.open();
      const repo = new SqliteTaskRepository(fixture.database);

      const matching = makeTask({
        title: 'FTS search target',
        description: 'Contains the uncommon persistence-token phrase',
      });
      const nonMatching = makeTask({
        title: 'Different task',
        description: 'No matching content',
      });

      await repo.create(matching);
      await repo.create(nonMatching);

      const results = await repo.search('persistence-token');

      expect(results.map((task) => task.id)).toEqual([matching.id]);
    } finally {
      fixture.cleanup();
    }
  });
});

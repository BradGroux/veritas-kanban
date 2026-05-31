import { describe, expect, it } from 'vitest';
import type { Task } from '@veritas-kanban/shared';
import type { WorkflowRun } from '../../types/workflow.js';
import { createTestSqliteDatabase } from '../../storage/sqlite/test-helpers.js';
import { SqliteTaskRepository } from '../../storage/sqlite/task-repository.js';
import { SqliteWorkProductRepository } from '../../storage/sqlite/work-product-repository.js';
import { SqliteWorkflowRunRepository } from '../../storage/sqlite/workflow-repositories.js';
import { SqliteNotificationRepository } from '../../storage/sqlite/notification-repository.js';
import { SqliteChatRepository } from '../../storage/sqlite/chat-repository.js';
import { SqliteScheduledDeliverablesRepository } from '../../storage/sqlite/scheduled-deliverables-repository.js';
import { SqliteOperationalProvenanceRepository } from '../../storage/sqlite/provenance-repository.js';

describe('SQLite operational provenance repository', () => {
  it('indexes task and run provenance without returning raw JSON payloads', async () => {
    const fixture = createTestSqliteDatabase();
    fixture.database.open();

    try {
      const now = '2026-05-31T08:00:00.000Z';
      const taskRepository = new SqliteTaskRepository(fixture.database);
      const workProducts = new SqliteWorkProductRepository(fixture.database);
      const workflowRuns = new SqliteWorkflowRunRepository(fixture.database);
      const notifications = new SqliteNotificationRepository(fixture.database);
      const chat = new SqliteChatRepository(fixture.database);
      const scheduled = new SqliteScheduledDeliverablesRepository(fixture.database);
      const provenance = new SqliteOperationalProvenanceRepository(fixture.database);

      const task: Task = {
        id: 'task_provenance_1',
        title: 'Ship provenance APIs',
        description: 'Expose SQLite provenance rows for v5 surfaces.',
        type: 'feature',
        status: 'in-progress',
        priority: 'high',
        created: now,
        updated: '2026-05-31T08:02:00.000Z',
        attachments: [
          {
            id: 'att_1',
            filename: 'evidence.md',
            originalName: 'Evidence.md',
            mimeType: 'text/markdown',
            size: 1200,
            uploaded: '2026-05-31T08:01:00.000Z',
            uploadedBy: 'codex',
            storagePath: 'tasks/attachments/task_provenance_1/evidence.md',
            validationStatus: 'valid',
            cleanupEligible: true,
          },
        ],
        deliverables: [
          {
            id: 'deliv_1',
            title: 'Completion packet',
            type: 'report',
            status: 'attached',
            path: 'docs/completion.md',
            agent: 'codex',
            model: 'gpt-5',
            sourceRunId: 'run_provenance_1',
            redaction: { level: 'standard' },
            created: '2026-05-31T08:03:00.000Z',
          },
        ],
      };

      await taskRepository.create(task);
      workProducts.save(
        {
          id: 'wp_1',
          workspaceId: 'local',
          kind: 'summary',
          title: 'Run handoff',
          status: 'active',
          render: {
            schemaVersion: 1,
            kind: 'summary',
            summary: 'Ready for review.',
          },
          version: 1,
          taskId: task.id,
          sourceRunId: 'run_provenance_1',
          agent: 'codex',
          model: 'gpt-5',
          redaction: { level: 'strict' },
          createdAt: '2026-05-31T08:04:00.000Z',
          updatedAt: '2026-05-31T08:04:00.000Z',
        },
        'Ready for review.'
      );

      const run: WorkflowRun = {
        id: 'run_provenance_1',
        workflowId: 'wf_release',
        workflowVersion: 1,
        taskId: task.id,
        status: 'completed',
        currentStep: 'handoff',
        context: {},
        startedAt: '2026-05-31T08:05:00.000Z',
        completedAt: '2026-05-31T08:06:00.000Z',
        steps: [],
      };
      workflowRuns.save(run);

      notifications.saveNotifications([
        {
          id: 'notif_1',
          taskId: task.id,
          targetAgent: 'reviewer',
          fromAgent: 'codex',
          content: 'Review the completion packet.',
          type: 'review',
          title: 'Review needed',
          taskTitle: task.title,
          targetUrl: `/tasks/${task.id}`,
          delivered: false,
          createdAt: '2026-05-31T08:07:00.000Z',
        },
      ]);
      chat.saveSession({
        id: 'chat_1',
        taskId: task.id,
        title: 'Task handoff',
        agent: 'codex',
        model: 'gpt-5',
        mode: 'build',
        created: '2026-05-31T08:08:00.000Z',
        updated: '2026-05-31T08:08:00.000Z',
        messages: [
          {
            id: 'msg_1',
            role: 'assistant',
            content: 'Completion packet is attached.',
            agent: 'codex',
            model: 'gpt-5',
            timestamp: '2026-05-31T08:08:00.000Z',
          },
        ],
      });
      scheduled.saveRuns([
        {
          id: 'sched_run_1',
          deliverableId: 'weekly_qa',
          status: 'success',
          outputFile: 'docs/weekly-qa.md',
          summary: 'Weekly QA snapshot',
          sourceRunId: 'run_provenance_1',
          workflowId: 'wf_release',
          runAt: '2026-05-31T08:09:00.000Z',
        },
      ]);

      const taskRecords = provenance.listForTask(task.id);
      expect(taskRecords.map((record) => record.kind)).toEqual([
        'chat-message',
        'notification',
        'workflow-run',
        'work-product',
        'task-deliverable',
        'task-attachment',
      ]);
      expect(taskRecords.find((record) => record.id === 'wp_1')).toMatchObject({
        kind: 'work-product',
        sourceRunId: 'run_provenance_1',
        redactionLevel: 'strict',
        agent: 'codex',
        model: 'gpt-5',
      });
      expect(taskRecords.find((record) => record.id === 'att_1')).toMatchObject({
        kind: 'task-attachment',
        contentType: 'text/markdown',
        cleanupEligible: true,
        path: 'tasks/attachments/task_provenance_1/evidence.md',
      });

      const runRecords = provenance.listForRun('run_provenance_1');
      expect(runRecords.map((record) => record.kind)).toEqual([
        'scheduled-deliverable-run',
        'workflow-run',
        'work-product',
        'task-deliverable',
      ]);
      expect(
        runRecords.find((record) => record.kind === 'scheduled-deliverable-run')
      ).toMatchObject({
        id: 'sched_run_1',
        workflowId: 'wf_release',
        path: 'docs/weekly-qa.md',
      });

      const rawRecord = taskRecords[0] as unknown as Record<string, unknown>;
      expect(rawRecord.product_json).toBeUndefined();
      expect(rawRecord.deliverable_json).toBeUndefined();
      expect(rawRecord.message_json).toBeUndefined();
      expect(rawRecord.notification_json).toBeUndefined();
    } finally {
      fixture.cleanup();
    }
  });
});

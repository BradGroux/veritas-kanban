import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatSession, Task } from '@veritas-kanban/shared';
import { createTestSqliteDatabase } from '../../storage/sqlite/test-helpers.js';
import { SqliteTaskRepository } from '../../storage/sqlite/task-repository.js';
import { SqliteTelemetryRepository } from '../../storage/sqlite/telemetry-repository.js';
import { SqliteChatRepository } from '../../storage/sqlite/chat-repository.js';
import { SqliteWorkflowRunRepository } from '../../storage/sqlite/workflow-repositories.js';
import type { WorkflowRun, WorkflowRunStatus } from '../../types/workflow.js';

const TASK_COUNT = 1_500;
const COMMENT_COUNT_PER_TASK = 2;
const ATTACHMENT_METADATA_COUNT = 600;
const TELEMETRY_EVENT_COUNT = 6_000;
const WORKFLOW_RUN_COUNT = 1_200;
const CHAT_SESSION_COUNT = 60;
const CHAT_MESSAGES_PER_SESSION = 50;

const PERF_BUDGET_MS = {
  boardList: 2_000,
  taskSearch: 750,
  dashboardTelemetryWindow: 1_500,
  workflowRunningList: 750,
  chatHistory: 750,
};

interface QueryPlanRow {
  detail: string;
}

interface Measurement<T> {
  durationMs: number;
  value: T;
}

function isoAt(index: number): string {
  return new Date(Date.UTC(2026, 5, 1, 12, 0, 0) + index * 1000).toISOString();
}

function makeTask(index: number): Task {
  const updated = isoAt(index);
  return {
    id: `task_perf_${index.toString().padStart(5, '0')}`,
    title: `Perf task ${index}`,
    description: `Representative SQLite performance fixture perf-token-${index}`,
    type: index % 5 === 0 ? 'research' : 'code',
    status: ['todo', 'in-progress', 'blocked', 'done'][index % 4] as Task['status'],
    priority: ['low', 'medium', 'high', 'critical'][index % 4] as Task['priority'],
    project: `project-${index % 8}`,
    sprint: `v5-${index % 6}`,
    position: index,
    created: isoAt(index - TASK_COUNT),
    updated,
    comments: Array.from({ length: COMMENT_COUNT_PER_TASK }, (_, commentIndex) => ({
      id: `comment_${index}_${commentIndex}`,
      author: `agent-${commentIndex}`,
      text: `Representative comment ${commentIndex} for perf task ${index}`,
      timestamp: isoAt(index + commentIndex),
    })),
    attachments:
      index < ATTACHMENT_METADATA_COUNT
        ? [
            {
              id: `attachment_${index.toString().padStart(5, '0')}`,
              filename: `attachment_${index.toString().padStart(5, '0')}.txt`,
              originalName: `Fixture ${index}.txt`,
              mimeType: 'text/plain',
              size: 512 + index,
              uploaded: updated,
              workspaceId: 'local',
              uploadedBy: 'perf-fixture',
              storagePath: `tasks/attachments/task_perf_${index.toString().padStart(5, '0')}/attachment.txt`,
              validationStatus: 'valid',
              retentionStatus: 'active',
              cleanupEligible: index % 5 === 0,
            },
          ]
        : undefined,
  };
}

function makeWorkflowRun(index: number): WorkflowRun {
  const status = ['running', 'completed', 'failed', 'blocked'][index % 4] as WorkflowRunStatus;
  const startedAt = isoAt(index);
  const completedAt = status === 'running' || status === 'blocked' ? undefined : isoAt(index + 1);

  return {
    id: `run_perf_${index.toString().padStart(5, '0')}`,
    workflowId: `workflow-${index % 12}`,
    workflowVersion: 1,
    taskId: `task_perf_${(index % TASK_COUNT).toString().padStart(5, '0')}`,
    status,
    currentStep: status === 'running' ? 'step-2' : undefined,
    context: { fixture: 'v5-performance', index },
    startedAt,
    completedAt,
    error: status === 'failed' ? 'fixture failure' : undefined,
    steps: [
      {
        stepId: 'step-1',
        status: status === 'failed' ? 'failed' : 'completed',
        retries: 0,
        duration: 3,
      },
    ],
  };
}

function makeChatSession(index: number): ChatSession {
  const timestamp = isoAt(index);
  return {
    id: `chat_perf_${index.toString().padStart(4, '0')}`,
    taskId: `task_perf_${index.toString().padStart(5, '0')}`,
    title: `Perf chat ${index}`,
    messages: [],
    agent: 'veritas',
    mode: 'ask',
    created: timestamp,
    updated: timestamp,
  };
}

function makeChatMessage(session: ChatSession, messageIndex: number): ChatMessage {
  const timestamp = isoAt(messageIndex);
  return {
    id: `${session.id}_msg_${messageIndex.toString().padStart(4, '0')}`,
    role: messageIndex % 2 === 0 ? 'user' : 'assistant',
    content: `Representative chat history message ${messageIndex} for ${session.id}`,
    timestamp,
    agent: messageIndex % 2 === 0 ? undefined : 'veritas',
  };
}

function seedRepresentativeDataset(
  database: ReturnType<typeof createTestSqliteDatabase>['database']
) {
  const db = database.getConnection();

  const insertTask = db.prepare(`
    INSERT INTO tasks (
      id,
      workspace_id,
      storage_state,
      title,
      description,
      type,
      status,
      priority,
      project,
      sprint,
      position,
      task_json,
      created_at,
      updated_at,
      archived_at,
      deleted_at
    )
    VALUES (?, 'local', 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
  `);
  const insertTaskSearch = db.prepare(`
    INSERT INTO task_search (task_id, title, description)
    VALUES (?, ?, ?)
  `);
  const insertAttachment = db.prepare(`
    INSERT INTO task_attachments (
      id,
      workspace_id,
      task_id,
      filename,
      original_name,
      mime_type,
      size_bytes,
      sha256,
      storage_path,
      uploaded_at,
      uploaded_by,
      session_id,
      validation_status,
      validation_error,
      retention_status,
      cleanup_eligible,
      attachment_json,
      deleted_at
    )
    VALUES (?, 'local', ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, NULL)
  `);
  const insertTelemetry = db.prepare(`
    INSERT INTO telemetry_events (
      id,
      workspace_id,
      type,
      task_id,
      project_id,
      agent,
      model,
      attempt_id,
      success,
      duration_ms,
      exit_code,
      input_tokens,
      output_tokens,
      cache_tokens,
      total_tokens,
      cost,
      error,
      stack_trace,
      session_key,
      payload_json,
      created_at
    )
    VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
  `);
  const insertWorkflowRun = db.prepare(`
    INSERT INTO workflow_runs (
      id,
      workspace_id,
      workflow_id,
      workflow_version,
      task_id,
      status,
      current_step,
      run_json,
      workflow_snapshot_json,
      started_at,
      completed_at,
      last_checkpoint,
      error
    )
    VALUES (?, 'local', ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?)
  `);
  const insertChatSession = db.prepare(`
    INSERT INTO chat_sessions (
      id,
      workspace_id,
      task_id,
      title,
      agent,
      model,
      mode,
      session_json,
      created_at,
      updated_at
    )
    VALUES (?, 'local', ?, ?, ?, NULL, ?, ?, ?, ?)
  `);
  const insertChatMessage = db.prepare(`
    INSERT INTO chat_messages (
      id,
      workspace_id,
      session_id,
      task_id,
      role,
      agent,
      model,
      message_json,
      created_at
    )
    VALUES (?, 'local', ?, ?, ?, ?, NULL, ?, ?)
  `);

  db.exec('BEGIN IMMEDIATE;');
  try {
    for (let index = 0; index < TASK_COUNT; index += 1) {
      const task = makeTask(index);
      insertTask.run(
        task.id,
        task.title,
        task.description,
        task.type,
        task.status,
        task.priority,
        task.project ?? null,
        task.sprint ?? null,
        task.position ?? null,
        JSON.stringify(task),
        task.created,
        task.updated
      );
      insertTaskSearch.run(task.id, task.title, task.description);

      for (const attachment of task.attachments ?? []) {
        insertAttachment.run(
          attachment.id,
          task.id,
          attachment.filename,
          attachment.originalName,
          attachment.mimeType,
          attachment.size,
          attachment.storagePath ?? '',
          attachment.uploaded,
          attachment.uploadedBy ?? null,
          attachment.validationStatus ?? 'unknown',
          attachment.retentionStatus ?? 'active',
          attachment.cleanupEligible === true ? 1 : 0,
          JSON.stringify(attachment)
        );
      }
    }

    for (let index = 0; index < TELEMETRY_EVENT_COUNT; index += 1) {
      const timestamp = isoAt(index);
      const type = index % 2 === 0 ? 'run.completed' : 'run.tokens';
      const taskId = `task_perf_${(index % TASK_COUNT).toString().padStart(5, '0')}`;
      const event = {
        id: `evt_perf_${index.toString().padStart(5, '0')}`,
        type,
        timestamp,
        taskId,
        project: `project-${index % 8}`,
        agent: `agent-${index % 6}`,
        model: 'gpt-5',
        success: index % 7 !== 0,
        durationMs: 1_000 + (index % 400),
        inputTokens: 800 + (index % 50),
        outputTokens: 200 + (index % 40),
        totalTokens: 1_000 + (index % 90),
        cost: 0.01 + (index % 10) / 100,
        sessionKey: `session-${index % 40}`,
      };

      insertTelemetry.run(
        event.id,
        event.type,
        event.taskId,
        event.project,
        event.agent,
        event.model,
        `attempt-${index % 20}`,
        event.success ? 1 : 0,
        event.durationMs,
        event.success ? 0 : 1,
        event.inputTokens,
        event.outputTokens,
        0,
        event.totalTokens,
        event.cost,
        event.success ? null : 'fixture failure',
        event.sessionKey,
        JSON.stringify(event),
        timestamp
      );
    }

    for (let index = 0; index < WORKFLOW_RUN_COUNT; index += 1) {
      const run = makeWorkflowRun(index);
      insertWorkflowRun.run(
        run.id,
        run.workflowId,
        run.workflowVersion,
        run.taskId ?? null,
        run.status,
        run.currentStep ?? null,
        JSON.stringify(run),
        run.startedAt,
        run.completedAt ?? null,
        run.error ?? null
      );
    }

    for (let sessionIndex = 0; sessionIndex < CHAT_SESSION_COUNT; sessionIndex += 1) {
      const session = makeChatSession(sessionIndex);
      insertChatSession.run(
        session.id,
        session.taskId ?? null,
        session.title,
        session.agent,
        session.mode,
        JSON.stringify(session),
        session.created,
        session.updated
      );

      for (let messageIndex = 0; messageIndex < CHAT_MESSAGES_PER_SESSION; messageIndex += 1) {
        const message = makeChatMessage(session, messageIndex);
        insertChatMessage.run(
          message.id,
          session.id,
          session.taskId ?? null,
          message.role,
          message.agent ?? null,
          JSON.stringify(message),
          message.timestamp
        );
      }
    }

    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

function queryPlan(database: ReturnType<typeof createTestSqliteDatabase>['database'], sql: string) {
  return database
    .getConnection()
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all() as unknown as QueryPlanRow[];
}

function expectPlanUsesIndex(plan: QueryPlanRow[], indexName: string) {
  expect(plan.map((row) => row.detail).join('\n')).toContain(indexName);
}

async function measure<T>(fn: () => T | Promise<T>): Promise<Measurement<T>> {
  const startedAt = performance.now();
  const value = await fn();
  return {
    durationMs: performance.now() - startedAt,
    value,
  };
}

describe('SQLite v5 representative performance', () => {
  it('keeps board, search, dashboard, workflow, and chat reads on indexed plans', () => {
    const fixture = createTestSqliteDatabase();

    try {
      fixture.database.open();

      expectPlanUsesIndex(
        queryPlan(
          fixture.database,
          `
            SELECT task_json
            FROM tasks
            WHERE workspace_id = 'local'
              AND storage_state = 'active'
              AND deleted_at IS NULL
            ORDER BY updated_at DESC
          `
        ),
        'idx_tasks_workspace_state_updated'
      );

      expectPlanUsesIndex(
        queryPlan(
          fixture.database,
          `
            SELECT payload_json
            FROM telemetry_events
            WHERE workspace_id = 'local'
              AND type = 'run.completed'
              AND created_at >= '2026-06-01T12:00:00.000Z'
            ORDER BY created_at ASC, id ASC
          `
        ),
        'idx_telemetry_type_created'
      );

      expectPlanUsesIndex(
        queryPlan(
          fixture.database,
          `
            SELECT id, workflow_id, workflow_version, task_id, status, started_at, completed_at, error
            FROM workflow_runs
            WHERE workspace_id = 'local'
              AND status = 'running'
            ORDER BY started_at DESC, id DESC
          `
        ),
        'idx_workflow_runs_status_started'
      );

      expectPlanUsesIndex(
        queryPlan(
          fixture.database,
          `
            SELECT message_json
            FROM chat_messages
            WHERE workspace_id = 'local'
              AND session_id = 'chat_perf_0020'
            ORDER BY created_at ASC, rowid ASC
          `
        ),
        'idx_chat_messages_session_created'
      );
    } finally {
      fixture.cleanup();
    }
  });

  it('records conservative timings on a representative local v5 dataset', async () => {
    const fixture = createTestSqliteDatabase();

    try {
      fixture.database.open();
      seedRepresentativeDataset(fixture.database);

      const taskRepository = new SqliteTaskRepository(fixture.database);
      const telemetryRepository = new SqliteTelemetryRepository(fixture.database);
      const workflowRunRepository = new SqliteWorkflowRunRepository(fixture.database);
      const chatRepository = new SqliteChatRepository(fixture.database);

      const boardList = await measure(() => taskRepository.findAll());
      const taskSearch = await measure(() => taskRepository.search('perf-token-1499'));
      const dashboardTelemetryWindow = await measure(() =>
        telemetryRepository.getEvents({
          type: 'run.completed',
          since: '2026-06-01T12:30:00.000Z',
          limit: 10_000,
        })
      );
      const workflowRunningList = await measure(() =>
        workflowRunRepository.listMetadata({ status: 'running' })
      );
      const chatHistory = await measure(() => chatRepository.getSession('chat_perf_0020'));

      expect(boardList.value).toHaveLength(TASK_COUNT);
      expect(taskSearch.value[0]?.id).toBe('task_perf_01499');
      expect(dashboardTelemetryWindow.value.length).toBeGreaterThan(0);
      expect(workflowRunningList.value.length).toBeGreaterThan(0);
      expect(chatHistory.value?.messages).toHaveLength(CHAT_MESSAGES_PER_SESSION);

      const measurements = {
        dataset: {
          tasks: TASK_COUNT,
          comments: TASK_COUNT * COMMENT_COUNT_PER_TASK,
          attachmentMetadataRows: ATTACHMENT_METADATA_COUNT,
          telemetryEvents: TELEMETRY_EVENT_COUNT,
          workflowRuns: WORKFLOW_RUN_COUNT,
          chatSessions: CHAT_SESSION_COUNT,
          chatMessages: CHAT_SESSION_COUNT * CHAT_MESSAGES_PER_SESSION,
        },
        timingsMs: {
          boardList: Number(boardList.durationMs.toFixed(1)),
          taskSearch: Number(taskSearch.durationMs.toFixed(1)),
          dashboardTelemetryWindow: Number(dashboardTelemetryWindow.durationMs.toFixed(1)),
          workflowRunningList: Number(workflowRunningList.durationMs.toFixed(1)),
          chatHistory: Number(chatHistory.durationMs.toFixed(1)),
        },
        budgetsMs: PERF_BUDGET_MS,
      };

      console.info(`[v5-sqlite-performance] ${JSON.stringify(measurements)}`);

      expect(boardList.durationMs).toBeLessThan(PERF_BUDGET_MS.boardList);
      expect(taskSearch.durationMs).toBeLessThan(PERF_BUDGET_MS.taskSearch);
      expect(dashboardTelemetryWindow.durationMs).toBeLessThan(
        PERF_BUDGET_MS.dashboardTelemetryWindow
      );
      expect(workflowRunningList.durationMs).toBeLessThan(PERF_BUDGET_MS.workflowRunningList);
      expect(chatHistory.durationMs).toBeLessThan(PERF_BUDGET_MS.chatHistory);
    } finally {
      fixture.cleanup();
    }
  });
});

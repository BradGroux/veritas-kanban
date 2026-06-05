import { describe, expect, it, vi } from 'vitest';
import type { AnyTelemetryEvent, Task, WorkProduct } from '@veritas-kanban/shared';
import type { Activity } from '../services/activity-service.js';
import type { StatusHistoryEntry } from '../services/status-history-service.js';
import { EvidenceTimelineService } from '../services/evidence-timeline-service.js';

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `${id} title`,
    description: `${id} description`,
    type: 'feature',
    status: 'in-progress',
    priority: 'high',
    project: 'platform',
    created: '2026-06-04T08:00:00.000Z',
    updated: '2026-06-04T09:00:00.000Z',
    git: {
      repo: 'veritas-kanban',
      branch: `feature/${id}`,
      baseBranch: 'main',
      worktreePath: '/worktrees/platform',
    },
    ...overrides,
  };
}

function makeWorkProduct(taskId: string): WorkProduct {
  return {
    id: 'wp_1',
    workspaceId: 'default',
    kind: 'markdown',
    title: 'Completion packet',
    status: 'active',
    render: {
      schemaVersion: 1,
      kind: 'markdown',
      markdown: '# Completion',
    },
    version: 2,
    taskId,
    sourceRunId: 'attempt_1',
    agent: 'codex',
    metadata: { packetType: 'completion_packet' },
    createdAt: '2026-06-04T10:00:00.000Z',
    updatedAt: '2026-06-04T10:30:00.000Z',
  };
}

describe('EvidenceTimelineService', () => {
  it('composes task, activity, status, telemetry, and work-product evidence', async () => {
    const task = makeTask('task_a', {
      comments: [
        {
          id: 'comment_1',
          author: 'brad',
          text: 'Needs source-linked recap.',
          timestamp: '2026-06-04T09:05:00.000Z',
        },
      ],
      timeTracking: {
        entries: [
          {
            id: 'time_1',
            startTime: '2026-06-04T09:10:00.000Z',
            endTime: '2026-06-04T09:40:00.000Z',
            duration: 1800,
            description: 'Evidence pass',
            manual: true,
          },
        ],
        totalSeconds: 1800,
        isRunning: false,
      },
    });
    const activity: Activity[] = [
      {
        id: 'act_1',
        type: 'status_changed',
        taskId: task.id,
        taskTitle: task.title,
        actor: 'brad',
        details: { from: 'todo', to: 'in-progress' },
        timestamp: '2026-06-04T09:01:00.000Z',
      },
    ];
    const statusHistory: StatusHistoryEntry[] = [
      {
        id: 'status_1',
        timestamp: '2026-06-04T09:02:00.000Z',
        previousStatus: 'idle',
        newStatus: 'working',
        taskId: task.id,
        taskTitle: task.title,
        durationMs: 60_000,
      },
    ];
    const telemetry: AnyTelemetryEvent[] = [
      {
        id: 'run_1',
        type: 'run.completed',
        timestamp: '2026-06-04T09:45:00.000Z',
        taskId: task.id,
        project: task.project,
        agent: 'codex',
        success: true,
        durationMs: 120_000,
        attemptId: 'attempt_1',
      },
    ];
    const workProduct = makeWorkProduct(task.id);

    const service = new EvidenceTimelineService({
      taskService: { listTasks: vi.fn().mockResolvedValue([task]) },
      activity: { getActivities: vi.fn().mockResolvedValue(activity) },
      statusHistory: {
        getHistory: vi.fn().mockResolvedValue(statusHistory),
        getHistoryByDateRange: vi.fn().mockResolvedValue(statusHistory),
      },
      telemetry: { getEvents: vi.fn().mockResolvedValue(telemetry) },
      workProducts: { list: vi.fn().mockResolvedValue([workProduct]) },
    });

    const result = await service.getTimeline({ taskId: task.id, limit: 20 });

    expect(result.events.map((event) => event.id)).toEqual([
      'task:task_a:created',
      'task:task_a:updated',
      'activity:act_1',
      'status-history:status_1',
      'comment:task_a:comment_1',
      'time:task_a:time_1',
      'telemetry:run_1',
      'work-product:wp_1:2',
    ]);
    expect(result.total).toBe(8);
    expect(result.recap.markdown).toContain('Evidence recap for task task_a');
    expect(result.recap.citations.map((citation) => citation.eventId)).toContain(
      'work-product:wp_1:2'
    );
    expect(result.events.find((event) => event.id === 'telemetry:run_1')?.sourceLink).toMatchObject(
      {
        target: 'timeline',
        runId: 'attempt_1',
        taskId: task.id,
      }
    );
  });

  it('applies project, repo, cwd, type, source, actor, and pagination filters', async () => {
    const matchingTask = makeTask('task_match');
    const otherTask = makeTask('task_other', {
      project: 'other',
      git: {
        repo: 'other-repo',
        branch: 'feature/other',
        baseBranch: 'main',
        worktreePath: '/worktrees/other',
      },
    });
    const telemetry: AnyTelemetryEvent[] = [
      {
        id: 'run_match',
        type: 'run.completed',
        timestamp: '2026-06-04T09:30:00.000Z',
        taskId: matchingTask.id,
        project: matchingTask.project,
        agent: 'codex',
        success: false,
        durationMs: 30_000,
        attemptId: 'attempt_match',
      },
      {
        id: 'run_other',
        type: 'run.completed',
        timestamp: '2026-06-04T09:31:00.000Z',
        taskId: otherTask.id,
        project: otherTask.project,
        agent: 'other-agent',
        success: true,
      },
    ];
    const workProducts = { list: vi.fn().mockResolvedValue([]) };
    const telemetryService = { getEvents: vi.fn().mockResolvedValue(telemetry) };

    const service = new EvidenceTimelineService({
      taskService: { listTasks: vi.fn().mockResolvedValue([matchingTask, otherTask]) },
      activity: { getActivities: vi.fn().mockResolvedValue([]) },
      statusHistory: {
        getHistory: vi.fn().mockResolvedValue([]),
        getHistoryByDateRange: vi.fn().mockResolvedValue([]),
      },
      telemetry: telemetryService,
      workProducts,
    });

    const result = await service.getTimeline({
      project: 'platform',
      repo: 'veritas-kanban',
      cwd: '/worktrees/platform',
      type: 'agent_run',
      source: 'telemetry',
      actor: 'codex',
      page: 1,
      limit: 1,
    });

    expect(result.total).toBe(1);
    expect(result.events[0]).toMatchObject({
      id: 'telemetry:run_match',
      type: 'agent_run',
      source: 'telemetry',
      agent: 'codex',
      taskId: matchingTask.id,
    });
    expect(result.hasMore).toBe(false);
    expect(telemetryService.getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ project: 'platform', limit: 5000 })
    );
    expect(workProducts.list).toHaveBeenCalledTimes(1);
    expect(workProducts.list).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: matchingTask.id, includeArchived: true })
    );
  });
});

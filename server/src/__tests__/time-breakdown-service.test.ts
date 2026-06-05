import { describe, expect, it, vi } from 'vitest';
import type { EvidenceTimelineResponse } from '@veritas-kanban/shared';
import { TimeBreakdownService } from '../services/time-breakdown-service.js';

function evidenceResponse(): EvidenceTimelineResponse {
  return {
    events: [
      {
        id: 'time:task_a:entry_1',
        timestamp: '2026-06-04T09:30:00.000Z',
        type: 'time',
        source: 'task',
        title: 'Time tracked',
        detail: 'Implementation',
        taskId: 'task_a',
        taskTitle: 'Editable time exports',
        project: 'platform',
        repo: 'veritas-kanban',
        cwd: '/worktrees/platform',
        actor: 'brad',
        metadata: { durationSeconds: 1800, manual: true, running: false },
        sourceLink: { label: 'Open time tracking', target: 'task', taskId: 'task_a' },
      },
      {
        id: 'telemetry:run_1',
        timestamp: '2026-06-04T10:00:00.000Z',
        type: 'agent_run',
        source: 'telemetry',
        title: 'Agent run failed by codex',
        taskId: 'task_a',
        taskTitle: 'Editable time exports',
        project: 'platform',
        repo: 'veritas-kanban',
        cwd: '/worktrees/platform',
        agent: 'codex',
        metadata: { durationMs: 600_000, success: false },
        sourceLink: {
          label: 'Open run timeline',
          target: 'timeline',
          taskId: 'task_a',
          runId: 'attempt_1',
        },
      },
      {
        id: 'status-history:status_1',
        timestamp: '2026-06-04T10:15:00.000Z',
        type: 'status',
        source: 'status-history',
        title: 'Agent status working -> idle',
        taskId: 'task_a',
        taskTitle: 'Editable time exports',
        project: 'platform',
        repo: 'veritas-kanban',
        cwd: '/worktrees/platform',
        metadata: { previousStatus: 'working', newStatus: 'idle', durationMs: 300_000 },
        sourceLink: { label: 'Open task', target: 'task', taskId: 'task_a' },
      },
      {
        id: 'comment:task_a:comment_1',
        timestamp: '2026-06-04T10:30:00.000Z',
        type: 'comment',
        source: 'task',
        title: 'Comment added',
        detail: 'Client export copy needs review.',
        taskId: 'task_a',
        taskTitle: 'Editable time exports',
        project: 'platform',
        repo: 'veritas-kanban',
        cwd: '/worktrees/platform',
        actor: 'brad',
        sourceLink: { label: 'Open comments', target: 'task', taskId: 'task_a' },
      },
    ],
    recap: { markdown: 'recap', citations: [] },
    total: 4,
    page: 1,
    limit: 200,
    hasMore: false,
    generatedAt: '2026-06-04T11:00:00.000Z',
    filters: {},
  };
}

describe('TimeBreakdownService', () => {
  it('derives explicit, inferred, and ambiguous blocks with source-backed exports', async () => {
    const getTimeline = vi.fn().mockResolvedValue(evidenceResponse());
    const service = new TimeBreakdownService({
      evidence: { getTimeline },
      now: () => new Date('2026-06-05T12:00:00.000Z'),
    });

    const result = await service.generate({
      preset: 'custom',
      from: '2026-06-04T00:00:00.000Z',
      to: '2026-06-05T00:00:00.000Z',
      project: 'platform',
      repo: 'veritas-kanban',
      cwd: '/worktrees/platform',
      actor: 'brad',
    });

    expect(getTimeline).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '2026-06-04T00:00:00.000Z',
        to: '2026-06-05T00:00:00.000Z',
        project: 'platform',
        repo: 'veritas-kanban',
        cwd: '/worktrees/platform',
        actor: 'brad',
        limit: 200,
      })
    );
    expect(result.totals).toMatchObject({
      explicitSeconds: 1800,
      inferredSeconds: 900,
      totalSeconds: 2700,
      ambiguousCount: 1,
      blocks: 4,
    });
    expect(result.blocks.map((block) => block.kind)).toEqual([
      'explicit',
      'inferred',
      'inferred',
      'ambiguous',
    ]);
    expect(result.groups[0]).toMatchObject({
      date: '2026-06-04',
      project: 'platform',
      repo: 'veritas-kanban',
      explicitSeconds: 1800,
      inferredSeconds: 900,
      ambiguousCount: 1,
    });
    expect(result.markdown).toContain('time:task_a:entry_1');
    expect(result.csv).toContain('status-history:status_1');
    expect(result.clientSummary).toContain('Explicit tracked time: 30m.');
  });

  it('can return explicit-only tracked time for deterministic exports', async () => {
    const service = new TimeBreakdownService({
      evidence: { getTimeline: vi.fn().mockResolvedValue(evidenceResponse()) },
      now: () => new Date('2026-06-05T12:00:00.000Z'),
    });

    const result = await service.generate({ includeInferred: false });

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({
      kind: 'explicit',
      durationSeconds: 1800,
      confidence: 'high',
    });
    expect(result.totals.inferredSeconds).toBe(0);
    expect(result.totals.ambiguousCount).toBe(0);
  });
});

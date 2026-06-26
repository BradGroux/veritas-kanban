/**
 * DigestService Tests
 * Tests the formatting logic (formatForTeams, formatNumber).
 * generateDigest requires too many external dependencies to test in isolation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RunTelemetryEvent, Task, TokenTelemetryEvent } from '@veritas-kanban/shared';
import { DigestService, type DailyDigest } from '../services/digest-service.js';

const mockPendingApprovals = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockQueueMonitorList = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    generatedAt: '2026-06-04T12:00:00.000Z',
    summary: { total: 0, enabled: 0, paused: 0, blocked: 0, failed: 0, due: 0 },
    monitors: [],
    recentEvents: [],
  })
);

// Mock dependencies
vi.mock('../services/metrics/index.js', () => ({
  getMetricsService: () => ({
    getAllMetrics: vi.fn().mockResolvedValue({
      tasks: { total: 0 },
      runs: { runs: 0, successes: 0, failures: 0, errors: 0, successRate: 0, byAgent: [] },
      tokens: { totalTokens: 0, inputTokens: 0, outputTokens: 0, byAgent: [] },
      duration: {},
    }),
    getFailedRuns: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('../services/telemetry-service.js', () => ({
  getTelemetryService: () => ({
    getEvents: vi.fn().mockResolvedValue([]),
    getConfig: vi.fn().mockReturnValue({ traces: false }),
  }),
}));

vi.mock('../services/task-service.js', () => ({
  TaskService: class MockTaskService {
    listTasks = vi.fn().mockResolvedValue([]);
    getTask = vi.fn();
  },
}));

vi.mock('../services/agent-permission-service.js', () => ({
  getAgentPermissionService: () => ({
    getPendingApprovals: mockPendingApprovals,
  }),
}));

vi.mock('../services/queue-intake-monitor-service.js', () => ({
  getQueueIntakeMonitorService: () => ({
    list: mockQueueMonitorList,
  }),
}));

function makeDigest(overrides: Partial<DailyDigest> = {}): DailyDigest {
  return {
    period: {
      start: '2024-06-15T00:00:00.000Z',
      end: '2024-06-16T00:00:00.000Z',
    },
    hasActivity: true,
    tasks: {
      completed: 3,
      created: 5,
      inProgress: 2,
      blocked: 1,
      total: 15,
      completedTitles: ['Fix login bug', 'Add dark mode', 'Update docs'],
      blockedTitles: ['API migration'],
    },
    runs: {
      total: 10,
      successes: 8,
      failures: 1,
      errors: 1,
      successRate: 0.8,
      byAgent: [
        { agent: 'veritas', runs: 7, successRate: 0.857 },
        { agent: 'copilot', runs: 3, successRate: 0.667 },
      ],
    },
    tokens: {
      total: 150000,
      input: 100000,
      output: 50000,
      byAgent: [
        { agent: 'veritas', total: 100000 },
        { agent: 'copilot', total: 50000 },
      ],
    },
    issues: {
      failedRuns: [
        {
          agent: 'copilot',
          taskId: 'task_123',
          error: 'Timeout waiting for response from the model',
          timestamp: '2024-06-15T14:30:00.000Z',
        },
      ],
    },
    ...overrides,
  };
}

describe('DigestService', () => {
  let service: DigestService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPendingApprovals.mockResolvedValue([]);
    mockQueueMonitorList.mockResolvedValue({
      generatedAt: '2026-06-04T12:00:00.000Z',
      summary: { total: 0, enabled: 0, paused: 0, blocked: 0, failed: 0, due: 0 },
      monitors: [],
      recentEvents: [],
    });
    service = new DigestService();
  });

  describe('generateOperationsDigest', () => {
    it('groups deterministic operations counts with source links', async () => {
      const tasks: Task[] = [
        {
          id: 'task_active',
          title: 'Active work',
          description: 'Active task',
          type: 'feature',
          status: 'in-progress',
          priority: 'high',
          project: 'platform',
          created: '2026-06-04T08:00:00.000Z',
          updated: '2026-06-04T08:30:00.000Z',
          git: {
            repo: 'veritas-kanban',
            branch: 'feature',
            baseBranch: 'main',
            worktreePath: '/worktrees/platform',
          },
        },
        {
          id: 'task_blocked',
          title: 'Blocked work',
          description: 'Blocked task',
          type: 'bug',
          status: 'blocked',
          priority: 'high',
          project: 'platform',
          created: '2026-06-04T08:00:00.000Z',
          updated: '2026-06-04T10:00:00.000Z',
          git: {
            repo: 'veritas-kanban',
            branch: 'blocked',
            baseBranch: 'main',
            worktreePath: '/worktrees/platform',
          },
        },
        {
          id: 'task_done',
          title: 'Completed work',
          description: 'Done task',
          type: 'feature',
          status: 'done',
          priority: 'medium',
          project: 'platform',
          created: '2026-06-04T08:00:00.000Z',
          updated: '2026-06-04T11:30:00.000Z',
          git: {
            repo: 'veritas-kanban',
            branch: 'done',
            baseBranch: 'main',
            worktreePath: '/worktrees/platform',
          },
        },
      ];
      const runFailure: RunTelemetryEvent = {
        id: 'run_failed',
        type: 'run.completed',
        timestamp: '2026-06-04T11:45:00.000Z',
        taskId: 'task_active',
        agent: 'codex',
        success: false,
        durationMs: 60_000,
        error: 'Tests failed',
        attemptId: 'attempt_failed',
      };
      const tokens: TokenTelemetryEvent = {
        id: 'tokens_1',
        type: 'run.tokens',
        timestamp: '2026-06-04T11:50:00.000Z',
        taskId: 'task_active',
        agent: 'codex',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cost: 0.0123,
      };
      const telemetry = { getEvents: vi.fn().mockResolvedValue([runFailure, tokens]) };
      const taskService = { listTasks: vi.fn().mockResolvedValue(tasks) };
      const serviceOverrides = service as unknown as {
        telemetry: typeof telemetry;
        taskService: typeof taskService;
      };
      serviceOverrides.telemetry = telemetry;
      serviceOverrides.taskService = taskService;
      mockPendingApprovals.mockResolvedValue([
        {
          id: 'approval_1',
          agentId: 'codex',
          action: 'push_branch',
          taskId: 'task_blocked',
          details: 'Needs owner approval',
          status: 'pending',
          createdAt: '2026-06-04T11:55:00.000Z',
        },
      ]);

      const digest = await service.generateOperationsDigest({
        from: '2026-06-04T00:00:00.000Z',
        to: '2026-06-04T12:00:00.000Z',
        project: 'platform',
      });

      expect(telemetry.getEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          project: 'platform',
          type: ['run.completed', 'run.error', 'run.tokens'],
        })
      );
      expect(digest.hasActivity).toBe(true);
      expect(digest.groups).toHaveLength(1);
      expect(digest.groups[0]).toMatchObject({
        project: 'platform',
        repo: 'veritas-kanban',
        cwd: '/worktrees/platform',
        totals: {
          active: 1,
          blocked: 1,
          stuck: 1,
          completed: 1,
          failed: 1,
          runs: 1,
          totalTokens: 150,
          activeTimeMs: 60_000,
        },
      });
      expect(digest.groups[0].sourceLinks.activeTasks[0]?.id).toBe('task_active');
      expect(digest.groups[0].sourceLinks.failedRuns[0]?.id).toBe('attempt_failed');
      expect(digest.groups[0].openApprovals[0]).toMatchObject({
        id: 'approval_1',
        agent: 'codex',
        action: 'push_branch',
      });
      expect(digest.totals.openApprovals).toBe(1);
    });

    it('includes queue monitor activity and skipped reasons', async () => {
      const serviceOverrides = service as unknown as {
        telemetry: { getEvents: ReturnType<typeof vi.fn> };
        taskService: { listTasks: ReturnType<typeof vi.fn> };
      };
      serviceOverrides.telemetry = { getEvents: vi.fn().mockResolvedValue([]) };
      serviceOverrides.taskService = { listTasks: vi.fn().mockResolvedValue([]) };
      mockQueueMonitorList.mockResolvedValue({
        generatedAt: '2026-06-04T12:00:00.000Z',
        summary: { total: 1, enabled: 1, paused: 0, blocked: 0, failed: 0, due: 0 },
        monitors: [
          {
            id: 'veritas-backlog',
            source: { repo: 'veritas-kanban' },
          },
        ],
        recentEvents: [
          {
            id: 'qm_evt_1',
            monitorId: 'veritas-backlog',
            type: 'manual-run',
            status: 'success',
            action: 'dry-run',
            summary: 'Dry run selected BradGroux/veritas-kanban#736.',
            createdAt: '2026-06-04T11:30:00.000Z',
            skippedReasons: ['Blocked item: needs-info'],
          },
        ],
      });

      const digest = await service.generateOperationsDigest({
        from: '2026-06-04T00:00:00.000Z',
        to: '2026-06-04T12:00:00.000Z',
        project: 'operations',
      });
      const markdown = service.formatOperationsDigestMarkdown(digest);

      expect(digest.hasActivity).toBe(true);
      expect(digest.groups[0]).toMatchObject({
        project: 'operations',
        repo: 'veritas-kanban',
      });
      expect(digest.groups[0].queueMonitors[0]).toMatchObject({
        id: 'qm_evt_1',
        status: 'success',
        action: 'dry-run',
        skippedReasons: ['Blocked item: needs-info'],
      });
      expect(markdown.markdown).toContain('Queue monitors:');
      expect(markdown.markdown).toContain('skipped 1');
    });

    it('filters deterministic operations by repository and cwd', async () => {
      const makeTask = (id: string, repo: string, worktreePath: string): Task => ({
        id,
        title: `${repo} task`,
        description: `${repo} task`,
        type: 'feature',
        status: 'in-progress',
        priority: 'medium',
        project: 'platform',
        created: '2026-06-04T08:00:00.000Z',
        updated: '2026-06-04T11:00:00.000Z',
        git: {
          repo,
          branch: `feature/${id}`,
          baseBranch: 'main',
          worktreePath,
        },
      });
      const tasks = [
        makeTask('task_match', 'veritas-kanban', '/worktrees/platform'),
        makeTask('task_other', 'other-repo', '/worktrees/other'),
      ];
      const telemetry = {
        getEvents: vi.fn().mockResolvedValue([
          {
            id: 'tokens_match',
            type: 'run.tokens',
            timestamp: '2026-06-04T11:30:00.000Z',
            taskId: 'task_match',
            agent: 'codex',
            inputTokens: 25,
            outputTokens: 15,
            totalTokens: 40,
            cost: 0.004,
          } satisfies TokenTelemetryEvent,
          {
            id: 'tokens_other',
            type: 'run.tokens',
            timestamp: '2026-06-04T11:35:00.000Z',
            taskId: 'task_other',
            agent: 'codex',
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            cost: 0.015,
          } satisfies TokenTelemetryEvent,
        ]),
      };
      const taskService = { listTasks: vi.fn().mockResolvedValue(tasks) };
      const serviceOverrides = service as unknown as {
        telemetry: typeof telemetry;
        taskService: typeof taskService;
      };
      serviceOverrides.telemetry = telemetry;
      serviceOverrides.taskService = taskService;

      const digest = await service.generateOperationsDigest({
        from: '2026-06-04T00:00:00.000Z',
        to: '2026-06-04T12:00:00.000Z',
        project: 'platform',
        repo: 'veritas-kanban',
        cwd: '/worktrees/platform',
      });

      expect(digest.groups).toHaveLength(1);
      expect(digest.groups[0]).toMatchObject({
        project: 'platform',
        repo: 'veritas-kanban',
        cwd: '/worktrees/platform',
        totals: {
          active: 1,
          totalTokens: 40,
        },
      });
      expect(digest.groups[0].sourceLinks.activeTasks).toHaveLength(1);
      expect(digest.groups[0].sourceLinks.tokenEvents[0]?.id).toBe('tokens_match');
      expect(digest.totals.totalTokens).toBe(40);
    });
  });

  describe('formatForTeams', () => {
    it('should return empty result for no activity', () => {
      const digest = makeDigest({ hasActivity: false });
      const result = service.formatForTeams(digest);
      expect(result.isEmpty).toBe(true);
      expect(result.markdown).toBe('');
    });

    it('should include daily digest header', () => {
      const digest = makeDigest();
      const result = service.formatForTeams(digest);
      expect(result.isEmpty).toBe(false);
      expect(result.markdown).toContain('📊 Daily Digest');
    });

    it('should include task summary section', () => {
      const digest = makeDigest();
      const result = service.formatForTeams(digest);
      expect(result.markdown).toContain('📋 Tasks');
      expect(result.markdown).toContain('**Completed:** 3');
      expect(result.markdown).toContain('**Created:** 5');
      expect(result.markdown).toContain('**In Progress:** 2');
      expect(result.markdown).toContain('**Blocked:** 1');
    });

    it('should not show blocked section when no blocked tasks', () => {
      const digest = makeDigest({
        tasks: {
          completed: 1,
          created: 1,
          inProgress: 0,
          blocked: 0,
          total: 5,
          completedTitles: ['Task 1'],
          blockedTitles: [],
        },
      });
      const result = service.formatForTeams(digest);
      expect(result.markdown).not.toContain('🚫 **Blocked:**');
    });

    it('should include accomplishments section', () => {
      const digest = makeDigest();
      const result = service.formatForTeams(digest);
      expect(result.markdown).toContain('🏆 Accomplishments');
      expect(result.markdown).toContain('Fix login bug');
      expect(result.markdown).toContain('Add dark mode');
      expect(result.markdown).toContain('Update docs');
    });

    it('should include agent runs section', () => {
      const digest = makeDigest();
      const result = service.formatForTeams(digest);
      expect(result.markdown).toContain('🤖 Agent Runs');
      expect(result.markdown).toContain('**Total:** 10 runs');
      expect(result.markdown).toContain('**Success Rate:** 80%');
      expect(result.markdown).toContain('veritas: 7 runs');
      expect(result.markdown).toContain('copilot: 3 runs');
    });

    it('should not show agent runs when total is 0', () => {
      const digest = makeDigest({
        runs: {
          total: 0,
          successes: 0,
          failures: 0,
          errors: 0,
          successRate: 0,
          byAgent: [],
        },
      });
      const result = service.formatForTeams(digest);
      expect(result.markdown).not.toContain('🤖 Agent Runs');
    });

    it('should include token usage section', () => {
      const digest = makeDigest();
      const result = service.formatForTeams(digest);
      expect(result.markdown).toContain('💰 Token Usage');
      expect(result.markdown).toContain('150.0K tokens');
    });

    it('should not show token usage when total is 0', () => {
      const digest = makeDigest({
        tokens: { total: 0, input: 0, output: 0, byAgent: [] },
      });
      const result = service.formatForTeams(digest);
      expect(result.markdown).not.toContain('💰 Token Usage');
    });

    it('should include blocked items section', () => {
      const digest = makeDigest();
      const result = service.formatForTeams(digest);
      expect(result.markdown).toContain('🚫 Blocked Items');
      expect(result.markdown).toContain('API migration');
    });

    it('should include failed runs section', () => {
      const digest = makeDigest();
      const result = service.formatForTeams(digest);
      expect(result.markdown).toContain('⚠️ Failed Runs');
      expect(result.markdown).toContain('copilot');
      expect(result.markdown).toContain('task_123');
    });
  });

  describe('formatNumber (private)', () => {
    const formatNumber = (num: number) => {
      return (service as unknown as { formatNumber(value: number): string }).formatNumber(num);
    };

    it('should format small numbers as-is', () => {
      expect(formatNumber(500)).toBe('500');
      expect(formatNumber(999)).toBe('999');
    });

    it('should format thousands with K', () => {
      expect(formatNumber(1000)).toBe('1.0K');
      expect(formatNumber(5500)).toBe('5.5K');
      expect(formatNumber(150000)).toBe('150.0K');
    });

    it('should format millions with M', () => {
      expect(formatNumber(1000000)).toBe('1.0M');
      expect(formatNumber(2500000)).toBe('2.5M');
    });
  });
});

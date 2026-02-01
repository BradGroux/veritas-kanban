/**
 * SummaryService Tests
 * Tests pure aggregation/formatting logic with no external dependencies.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SummaryService } from '../services/summary-service.js';
import type { Task } from '@veritas-kanban/shared';
import type { Activity } from '../services/activity-service.js';

// Helper to create a minimal task for testing
function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task_${Math.random().toString(36).substring(7)}`,
    title: 'Test Task',
    type: 'code',
    status: 'todo',
    priority: 'medium',
    project: 'test-project',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    ...overrides,
  } as Task;
}

describe('SummaryService', () => {
  let service: SummaryService;

  beforeEach(() => {
    service = new SummaryService();
  });

  describe('getOverallSummary', () => {
    it('should return empty summary for empty task list', () => {
      const result = service.getOverallSummary([]);
      expect(result.total).toBe(0);
      expect(result.byStatus.todo).toBe(0);
      expect(result.byStatus['in-progress']).toBe(0);
      expect(result.byStatus.blocked).toBe(0);
      expect(result.byStatus.done).toBe(0);
      expect(result.highPriority).toHaveLength(0);
      expect(Object.keys(result.byProject)).toHaveLength(0);
    });

    it('should count tasks by status correctly', () => {
      const tasks = [
        makeTask({ status: 'todo' }),
        makeTask({ status: 'todo' }),
        makeTask({ status: 'in-progress' }),
        makeTask({ status: 'blocked' }),
        makeTask({ status: 'done' }),
        makeTask({ status: 'done' }),
        makeTask({ status: 'done' }),
      ];

      const result = service.getOverallSummary(tasks);
      expect(result.total).toBe(7);
      expect(result.byStatus.todo).toBe(2);
      expect(result.byStatus['in-progress']).toBe(1);
      expect(result.byStatus.blocked).toBe(1);
      expect(result.byStatus.done).toBe(3);
    });

    it('should break down tasks by project', () => {
      const tasks = [
        makeTask({ project: 'alpha', status: 'done' }),
        makeTask({ project: 'alpha', status: 'in-progress' }),
        makeTask({ project: 'beta', status: 'todo' }),
        makeTask({ project: undefined }),
      ];

      const result = service.getOverallSummary(tasks);
      expect(result.byProject.alpha).toEqual({ total: 2, done: 1, inProgress: 1 });
      expect(result.byProject.beta).toEqual({ total: 1, done: 0, inProgress: 0 });
      expect(result.byProject.unassigned).toEqual({ total: 1, done: 0, inProgress: 0 });
    });

    it('should identify high priority non-done tasks', () => {
      const tasks = [
        makeTask({ priority: 'high', status: 'todo', title: 'Urgent 1' }),
        makeTask({ priority: 'high', status: 'in-progress', title: 'Urgent 2' }),
        makeTask({ priority: 'high', status: 'done', title: 'Finished' }),
        makeTask({ priority: 'medium', status: 'todo', title: 'Normal' }),
      ];

      const result = service.getOverallSummary(tasks);
      expect(result.highPriority).toHaveLength(2);
      expect(result.highPriority.map((t) => t.title)).toContain('Urgent 1');
      expect(result.highPriority.map((t) => t.title)).toContain('Urgent 2');
      expect(result.highPriority.map((t) => t.title)).not.toContain('Finished');
    });
  });

  describe('getRecentActivity', () => {
    it('should return empty for no tasks', () => {
      const result = service.getRecentActivity([], 24);
      expect(result.completed).toHaveLength(0);
      expect(result.highPriorityActive).toHaveLength(0);
      expect(result.period.hours).toBe(24);
    });

    it('should find recently completed tasks', () => {
      const recent = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1 hour ago
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48 hours ago

      const tasks = [
        makeTask({ status: 'done', updated: recent, title: 'Recent Done' }),
        makeTask({ status: 'done', updated: old, title: 'Old Done' }),
        makeTask({ status: 'todo', updated: recent, title: 'Not Done' }),
      ];

      const result = service.getRecentActivity(tasks, 24);
      expect(result.completed).toHaveLength(1);
      expect(result.completed[0].title).toBe('Recent Done');
    });

    it('should find recently active high-priority tasks', () => {
      const recent = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

      const tasks = [
        makeTask({
          priority: 'high',
          status: 'in-progress',
          updated: recent,
          title: 'Active High',
        }),
        makeTask({ priority: 'high', status: 'blocked', updated: recent, title: 'Blocked High' }),
        makeTask({ priority: 'high', status: 'todo', updated: recent, title: 'Todo High' }),
        makeTask({ priority: 'high', status: 'done', updated: recent, title: 'Done High' }),
        makeTask({
          priority: 'medium',
          status: 'in-progress',
          updated: recent,
          title: 'Medium Active',
        }),
        makeTask({ priority: 'high', status: 'in-progress', updated: old, title: 'Old High' }),
      ];

      const result = service.getRecentActivity(tasks, 24);
      expect(result.highPriorityActive).toHaveLength(2);
      expect(result.highPriorityActive.map((t) => t.title)).toContain('Active High');
      expect(result.highPriorityActive.map((t) => t.title)).toContain('Blocked High');
    });

    it('should use custom hours parameter', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

      const tasks = [makeTask({ status: 'done', updated: threeHoursAgo, title: 'Done 3h ago' })];

      // Within 4-hour window
      const result4h = service.getRecentActivity(tasks, 4);
      expect(result4h.completed).toHaveLength(1);

      // Outside 2-hour window
      const result2h = service.getRecentActivity(tasks, 2);
      expect(result2h.completed).toHaveLength(0);
    });
  });

  describe('getProjectProgress', () => {
    it('should return empty for no tasks', () => {
      const result = service.getProjectProgress([]);
      expect(result).toHaveLength(0);
    });

    it('should calculate project progress percentages', () => {
      const tasks = [
        makeTask({ project: 'alpha', status: 'done' }),
        makeTask({ project: 'alpha', status: 'done' }),
        makeTask({ project: 'alpha', status: 'todo' }),
        makeTask({ project: 'alpha', status: 'in-progress' }),
        makeTask({ project: 'beta', status: 'done' }),
        makeTask({ project: 'beta', status: 'done' }),
      ];

      const result = service.getProjectProgress(tasks);
      const alpha = result.find((p) => p.name === 'alpha');
      const beta = result.find((p) => p.name === 'beta');

      expect(alpha).toBeDefined();
      expect(alpha!.total).toBe(4);
      expect(alpha!.done).toBe(2);
      expect(alpha!.percent).toBe(50);

      expect(beta).toBeDefined();
      expect(beta!.total).toBe(2);
      expect(beta!.done).toBe(2);
      expect(beta!.percent).toBe(100);
    });

    it('should filter out projects with only 1 task', () => {
      const tasks = [
        makeTask({ project: 'solo', status: 'done' }),
        makeTask({ project: 'pair', status: 'done' }),
        makeTask({ project: 'pair', status: 'todo' }),
      ];

      const result = service.getProjectProgress(tasks);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('pair');
    });
  });

  describe('generateMemoryMarkdown', () => {
    it('should return default message for no activity', () => {
      const result = service.generateMemoryMarkdown([]);
      expect(result).toBe('No recent kanban activity.\n');
    });

    it('should include completed tasks section', () => {
      const recent = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
      const tasks = [
        makeTask({
          status: 'done',
          updated: recent,
          title: 'Finished Task',
          project: 'alpha',
          priority: 'high',
        }),
      ];

      const result = service.generateMemoryMarkdown(tasks, 24);
      expect(result).toContain('### Veritas Kanban - Completed Tasks');
      expect(result).toContain('✅ Finished Task');
      expect(result).toContain('(alpha)');
      expect(result).toContain('🔴');
    });

    it('should include active high-priority section', () => {
      const tasks = [
        makeTask({
          status: 'in-progress',
          priority: 'high',
          title: 'Important Work',
          project: 'beta',
        }),
        makeTask({ status: 'blocked', priority: 'high', title: 'Stuck Task', project: 'beta' }),
      ];

      const result = service.generateMemoryMarkdown(tasks);
      expect(result).toContain('### Active High-Priority Tasks');
      expect(result).toContain('🔄 Important Work');
      expect(result).toContain('👀 Stuck Task');
    });

    it('should include project progress section', () => {
      const tasks = [
        makeTask({ project: 'alpha', status: 'done' }),
        makeTask({ project: 'alpha', status: 'done' }),
        makeTask({ project: 'alpha', status: 'todo' }),
      ];

      const result = service.generateMemoryMarkdown(tasks);
      expect(result).toContain('### Project Progress');
      expect(result).toContain('**alpha**');
    });
  });

  describe('getStandupData', () => {
    const targetDate = new Date('2026-02-01T12:00:00');

    function makeActivity(overrides: Partial<Activity> = {}): Activity {
      return {
        id: `activity_${Math.random().toString(36).substring(7)}`,
        type: 'task_updated',
        taskId: 'task_123',
        taskTitle: 'Test Task',
        timestamp: '2026-02-01T10:00:00.000Z',
        ...overrides,
      };
    }

    it('should return empty standup for no tasks', () => {
      const result = service.getStandupData([], [], targetDate);
      expect(result.date).toBe('2026-02-01');
      expect(result.completed).toHaveLength(0);
      expect(result.inProgress).toHaveLength(0);
      expect(result.blocked).toHaveLength(0);
      expect(result.upcoming).toHaveLength(0);
      expect(result.activity).toHaveLength(0);
      expect(result.stats.tasksCompleted).toBe(0);
    });

    it('should find tasks completed on target date', () => {
      const tasks = [
        makeTask({
          status: 'done',
          updated: '2026-02-01T15:00:00.000Z',
          title: 'Done Today',
          agent: 'Veritas',
          timeTracking: {
            entries: [
              {
                id: 'time_1',
                startTime: '2026-02-01T14:00:00.000Z',
                endTime: '2026-02-01T15:00:00.000Z',
                duration: 3600,
              },
            ],
            totalSeconds: 3600,
            isRunning: false,
          },
        }),
        makeTask({
          status: 'done',
          updated: '2026-01-30T10:00:00.000Z',
          title: 'Done Earlier',
        }),
      ];

      const result = service.getStandupData(tasks, [], targetDate);
      expect(result.completed).toHaveLength(1);
      expect(result.completed[0].title).toBe('Done Today');
      expect(result.completed[0].agent).toBe('Veritas');
      expect(result.completed[0].timeSpent).toBeGreaterThan(0);
    });

    it('should find in-progress tasks', () => {
      const tasks = [
        makeTask({ status: 'in-progress', title: 'Working on it', agent: 'Veritas' }),
        makeTask({ status: 'todo', title: 'Not started' }),
      ];

      const result = service.getStandupData(tasks, [], targetDate);
      expect(result.inProgress).toHaveLength(1);
      expect(result.inProgress[0].title).toBe('Working on it');
    });

    it('should find blocked tasks with reasons', () => {
      const tasks = [
        makeTask({
          status: 'blocked',
          title: 'Stuck',
          blockedReason: { category: 'waiting-on-feedback', note: 'Waiting for API access' },
        }),
      ];

      const result = service.getStandupData(tasks, [], targetDate);
      expect(result.blocked).toHaveLength(1);
      expect(result.blocked[0].reason).toBe('Waiting for API access');
    });

    it('should sort upcoming tasks by priority', () => {
      const tasks = [
        makeTask({ status: 'todo', priority: 'low', title: 'Low' }),
        makeTask({ status: 'todo', priority: 'high', title: 'High' }),
        makeTask({ status: 'todo', priority: 'medium', title: 'Medium' }),
      ];

      const result = service.getStandupData(tasks, [], targetDate);
      expect(result.upcoming).toHaveLength(3);
      expect(result.upcoming[0].title).toBe('High');
      expect(result.upcoming[1].title).toBe('Medium');
      expect(result.upcoming[2].title).toBe('Low');
    });

    it('should limit upcoming to 10 tasks', () => {
      const tasks = Array.from({ length: 15 }, (_, i) =>
        makeTask({ status: 'todo', title: `Todo ${i}` })
      );

      const result = service.getStandupData(tasks, [], targetDate);
      expect(result.upcoming).toHaveLength(10);
    });

    it('should filter activities by target date', () => {
      const activities = [
        makeActivity({
          type: 'status_changed',
          taskTitle: 'Task A',
          timestamp: '2026-02-01T10:00:00.000Z',
        }),
        makeActivity({
          type: 'comment_added',
          taskTitle: 'Task B',
          timestamp: '2026-01-31T10:00:00.000Z',
        }),
      ];

      const result = service.getStandupData([], activities, targetDate);
      expect(result.activity).toHaveLength(1);
      expect(result.activity[0].summary).toContain('Task A');
    });

    it('should calculate stats correctly', () => {
      const tasks = [
        makeTask({
          status: 'done',
          updated: '2026-02-01T15:00:00.000Z',
          agent: 'Veritas',
          comments: [
            { id: 'c1', author: 'Veritas', text: 'Done', timestamp: '2026-02-01T15:00:00.000Z' },
            { id: 'c2', author: 'Veritas', text: 'Note', timestamp: '2026-02-01T14:00:00.000Z' },
          ],
        }),
        makeTask({
          status: 'in-progress',
          agent: 'Veritas',
          comments: [
            { id: 'c3', author: 'Brad', text: 'Check', timestamp: '2026-01-31T10:00:00.000Z' },
          ],
        }),
      ];

      const result = service.getStandupData(tasks, [], targetDate);
      expect(result.stats.tasksCompleted).toBe(1);
      expect(result.stats.agentsActive).toContain('Veritas');
      expect(result.stats.commentsAdded).toBe(2); // Only Feb 1 comments
    });
  });

  describe('generateStandupMarkdown', () => {
    it('should generate valid markdown report', () => {
      const standupData = {
        date: '2026-02-01',
        completed: [
          {
            id: 'task_123',
            title: 'Finished task',
            agent: 'Veritas',
            completedAt: '2026-02-01T15:00:00.000Z',
            timeSpent: 2700,
          },
        ],
        inProgress: [
          {
            id: 'task_456',
            title: 'Working task',
            agent: 'Veritas',
            started: '2026-02-01T10:00:00.000Z',
          },
        ],
        blocked: [
          {
            id: 'task_789',
            title: 'Stuck task',
            agent: 'Veritas',
            reason: 'waiting on API access',
          },
        ],
        upcoming: [{ id: 'task_000', title: 'Next task', priority: 'high' }],
        activity: [],
        stats: {
          tasksCompleted: 1,
          totalTimeTracked: '45m',
          agentsActive: ['Veritas'],
          commentsAdded: 2,
        },
      };

      const markdown = service.generateStandupMarkdown(standupData);
      expect(markdown).toContain('# Daily Standup — February 1, 2026');
      expect(markdown).toContain('## ✅ Completed');
      expect(markdown).toContain('task_123: Finished task');
      expect(markdown).toContain('Veritas');
      expect(markdown).toContain('45m');
      expect(markdown).toContain('## 🔄 In Progress');
      expect(markdown).toContain('task_456: Working task');
      expect(markdown).toContain('## 🚫 Blocked');
      expect(markdown).toContain('waiting on API access');
      expect(markdown).toContain('## 📋 Up Next');
      expect(markdown).toContain('🔴');
      expect(markdown).toContain('## 📊 Stats');
      expect(markdown).toContain('Tasks completed: 1');
      expect(markdown).toContain('Comments added: 2');
    });

    it('should omit empty sections', () => {
      const standupData = {
        date: '2026-02-01',
        completed: [],
        inProgress: [],
        blocked: [],
        upcoming: [],
        activity: [],
        stats: {
          tasksCompleted: 0,
          totalTimeTracked: '0s',
          agentsActive: [],
          commentsAdded: 0,
        },
      };

      const markdown = service.generateStandupMarkdown(standupData);
      expect(markdown).toContain('# Daily Standup');
      expect(markdown).not.toContain('## ✅ Completed');
      expect(markdown).not.toContain('## 🔄 In Progress');
      expect(markdown).not.toContain('## 🚫 Blocked');
      expect(markdown).not.toContain('## 📋 Up Next');
      expect(markdown).toContain('## 📊 Stats');
    });
  });

  describe('generateStandupText', () => {
    it('should generate plain text report', () => {
      const standupData = {
        date: '2026-02-01',
        completed: [
          {
            id: 'task_123',
            title: 'Finished task',
            agent: 'Veritas',
            completedAt: '2026-02-01T15:00:00.000Z',
            timeSpent: 2700,
          },
        ],
        inProgress: [],
        blocked: [],
        upcoming: [],
        activity: [],
        stats: {
          tasksCompleted: 1,
          totalTimeTracked: '45m',
          agentsActive: ['Veritas'],
          commentsAdded: 0,
        },
      };

      const text = service.generateStandupText(standupData);
      expect(text).toContain('DAILY STANDUP');
      expect(text).toContain('COMPLETED:');
      expect(text).toContain('task_123: Finished task (Veritas) [45m]');
      expect(text).toContain('STATS:');
      expect(text).not.toContain('#');
      expect(text).not.toContain('**');
    });
  });
});

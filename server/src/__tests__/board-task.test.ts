import { describe, expect, it } from 'vitest';
import { toBoardTask, evaluateTaskReadiness, type Task } from '@veritas-kanban/shared';

describe('board task projection', () => {
  it('bounds growing task content while preserving readiness, revisions and progress', () => {
    const task: Task = {
      id: 'task_board',
      title: 'Implement board projection',
      description: 'Acceptance criteria and verification report. '.repeat(10000),
      type: 'code',
      priority: 'medium',
      status: 'todo',
      created: '2026-09-07',
      updated: '2026-09-07',
      revision: 7,
      subtasks: Array.from({ length: 1000 }, (_, i) => ({
        id: String(i),
        title: 'Checklist text '.repeat(100),
        completed: i < 300,
      })),
      blockedBy: ['task_blocker'],
      position: 3,
    };
    const result = toBoardTask(task);
    expect(result.description).toHaveLength(400);
    expect(result).not.toHaveProperty('subtasks');
    const readiness = evaluateTaskReadiness(task, { isCodeTask: true });
    expect(result.boardSummary).toMatchObject({
      subtaskTotal: 1000,
      subtaskCompleted: 300,
      readiness: {
        ready: readiness.ready,
        percent: readiness.percent,
        missingRequired: readiness.missingRequired.map((check) => ({ label: check.label })),
      },
    });
    expect(result).toMatchObject({ revision: 7, position: 3, blockedBy: ['task_blocker'] });
    expect(JSON.stringify(result).length).toBeLessThan(5000);
  });
});

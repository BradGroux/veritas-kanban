import { describe, expect, it, vi } from 'vitest';
import type { CreateReflectionCandidateInput, Task } from '@veritas-kanban/shared';
import { ReflectionService, type ReflectionTaskService } from '../services/reflection-service.js';

function createInput(
  overrides: Partial<CreateReflectionCandidateInput> = {}
): CreateReflectionCandidateInput {
  return {
    category: 'team',
    source: {
      kind: 'user-correction',
      taskId: 'task_20260626_reflect',
      messageId: 'msg_1',
    },
    summary: 'Agent repeated a stale implementation path.',
    previousApproach: 'Continued with the old route shape.',
    correction: 'Use the current route schema before editing.',
    nextAttempt: 'Inspect the live route schema first and update the smallest matching surface.',
    evidence: [{ kind: 'note', title: 'Correction', content: 'User corrected the route shape.' }],
    tags: ['workflow', 'agent-correction'],
    ...overrides,
  };
}

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task_20260626_reflect',
    title: 'Reflection task',
    description: '',
    type: 'feature',
    status: 'in-progress',
    priority: 'medium',
    created: '2026-06-26T12:00:00.000Z',
    updated: '2026-06-26T12:00:00.000Z',
    ...overrides,
  } as Task;
}

function createHarness(task: Task = createTask()) {
  const audit = vi.fn().mockResolvedValue(undefined);
  const updateTask = vi.fn().mockResolvedValue(task);
  const taskService: ReflectionTaskService = {
    getTask: vi.fn().mockResolvedValue(task),
    updateTask,
  };
  return {
    audit,
    updateTask,
    taskService,
    service: new ReflectionService({
      persist: false,
      audit,
      taskService,
    }),
  };
}

describe('ReflectionService', () => {
  it('creates pending candidates without changing durable task lessons', async () => {
    const { service, updateTask } = createHarness();

    const candidate = await service.create(
      createInput({
        summary:
          'Do not copy token=secret123 or /Users/bradgroux/Projects/private into durable memory.',
      })
    );

    expect(candidate.status).toBe('pending');
    expect(candidate.summary).toContain('token=[REDACTED]');
    expect(candidate.summary).toContain('[REDACTED_PATH]');
    expect(candidate.redaction).toMatchObject({
      redacted: true,
      notes: expect.arrayContaining(['credential', 'private-path']),
    });
    expect(updateTask).not.toHaveBeenCalled();
  });

  it('accepts a reviewed task-linked candidate into task lessons', async () => {
    const task = createTask({ lessonsLearned: 'Existing lesson', lessonTags: ['existing'] });
    const { service, updateTask } = createHarness(task);
    const candidate = await service.create(createInput());

    const accepted = await service.accept(candidate.id, {
      reviewedBy: 'brad',
      promotionTarget: 'task-lesson',
      reviewerNote: 'Promote this correction for future task work.',
    });

    expect(accepted.status).toBe('accepted');
    expect(accepted.appliedTargets[0]).toMatchObject({ kind: 'task-lesson', id: task.id });
    expect(updateTask).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({
        lessonsLearned: expect.stringContaining('Reflection Lesson'),
        lessonTags: expect.arrayContaining(['reflection', 'reflection:team']),
      })
    );
  });

  it('keeps rejected candidates auditable without applying lessons', async () => {
    const { service, updateTask } = createHarness();
    const candidate = await service.create(createInput());

    const rejected = await service.reject(candidate.id, {
      reviewedBy: 'brad',
      reason: 'The lesson is too narrow to reuse.',
    });

    expect(rejected).toMatchObject({
      status: 'rejected',
      reviewedBy: 'brad',
      rejectionReason: 'The lesson is too narrow to reuse.',
    });
    expect(updateTask).not.toHaveBeenCalled();
  });

  it('groups duplicate candidates and soft-merges duplicates into the representative', async () => {
    const { service } = createHarness();
    const first = await service.create(createInput());
    const second = await service.create(
      createInput({ source: { kind: 'error', taskId: 'task_20260626_reflect', errorId: 'err_1' } })
    );

    expect(second.duplicateOf).toBe(first.id);
    const listed = await service.list({ limit: 20 });
    expect(listed.duplicateGroups).toHaveLength(1);
    expect(listed.duplicateGroups[0].candidateIds).toEqual(
      expect.arrayContaining([first.id, second.id])
    );

    const merged = await service.mergeDuplicate(second.id, { mergedBy: 'brad' });

    expect(merged.status).toBe('deleted');
    expect(merged.mergedInto).toBe(first.id);
    expect(merged.deleteReason).toContain(first.id);
  });
});

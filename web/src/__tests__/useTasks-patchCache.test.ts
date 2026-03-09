/**
 * Regression tests for task detail mutation cache patching.
 *
 * Verifies that detail-level mutations (subtasks, comments, observations,
 * verification steps) patch the task list cache in-place instead of
 * invalidating it — which would trigger a redundant GET /api/tasks.
 *
 * Introduced as part of the fetch-pattern cleanup (2026-03-06).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { Task } from '@veritas-kanban/shared';
import {
  useAddSubtask,
  useUpdateSubtask,
  useDeleteSubtask,
  useAddComment,
  useEditComment,
  useDeleteComment,
  useAddObservation,
  useDeleteObservation,
  useAddVerificationStep,
  useUpdateVerificationStep,
  useDeleteVerificationStep,
  useToggleSubtaskCriteria,
} from '@/hooks/useTasks';

// ── Helpers ──────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Test Task',
    description: '',
    type: 'feature',
    status: 'todo',
    priority: 'medium',
    created: '2025-01-01T00:00:00Z',
    updated: '2025-01-01T00:00:00Z',
    subtasks: [],
    comments: [],
    reviewComments: [],
    ...overrides,
  } as Task;
}

/** Creates a fresh QueryClient seeded with a task list cache. */
function createSeededClient(tasks: Task[]) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  qc.setQueryData(['tasks'], tasks);
  return qc;
}

/** Wrapper factory for renderHook. */
function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

// ── Mock API ─────────────────────────────────────────────────

// Mock the api module — vi.mock factory is hoisted, so all data must be inline.
vi.mock('@/lib/api', () => {
  const updated = {
    id: 'task-1',
    title: 'Test Task',
    description: '',
    type: 'feature',
    status: 'todo',
    priority: 'medium',
    created: '2025-01-01T00:00:00Z',
    updated: '2025-01-01T00:00:00Z',
    subtasks: [{ id: 'sub-1', title: 'New subtask', completed: false }],
    comments: [{ id: 'cmt-1', author: 'tester', text: 'Hello', created: '2025-01-01T00:00:00Z' }],
    reviewComments: [],
  };
  const m = (v: unknown) => vi.fn().mockResolvedValue(v);
  return {
    api: {
      tasks: {
        list: m([]),
        addSubtask: m(updated),
        updateSubtask: m(updated),
        deleteSubtask: m(updated),
        toggleSubtaskCriteria: m(updated),
        addComment: m(updated),
        editComment: m(updated),
        deleteComment: m(updated),
        addObservation: m(updated),
        deleteObservation: m(updated),
        addVerificationStep: m(updated),
        updateVerificationStep: m(updated),
        deleteVerificationStep: m(updated),
      },
    },
  };
});

// Same shape as mock return — for test assertions
const updatedTask = makeTask({
  subtasks: [
    { id: 'sub-1', title: 'New subtask', completed: false },
  ] as unknown as Task['subtasks'],
  comments: [
    { id: 'cmt-1', author: 'tester', text: 'Hello', created: '2025-01-01T00:00:00Z' },
  ] as unknown as Task['comments'],
});

// ── Tests ────────────────────────────────────────────────────

describe('Detail mutation cache patching (no full-list invalidation)', () => {
  let qc: QueryClient;
  const originalTask = makeTask();
  const otherTask = makeTask({ id: 'task-2', title: 'Other Task' });
  let invalidateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    qc = createSeededClient([originalTask, otherTask]);
    invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  });

  afterEach(() => {
    invalidateSpy.mockRestore();
    qc.clear();
  });

  /**
   * Helper: runs a mutation hook and asserts:
   * 1. The task list cache was patched in-place (task-1 updated, task-2 untouched)
   * 2. The individual task cache was set
   * 3. invalidateQueries was NOT called with ['tasks'] (no full refetch)
   */
  async function assertPatchOnly(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hookFn: () => { mutate: (...args: any[]) => void; isSuccess: boolean },
    mutateArgs: unknown
  ) {
    const { result } = renderHook(hookFn, { wrapper: makeWrapper(qc) });

    await act(async () => {
      result.current.mutate(mutateArgs);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // List cache should have the updated task patched in
    const listCache = qc.getQueryData<Task[]>(['tasks']);
    expect(listCache).toHaveLength(2);
    expect(listCache?.find((t) => t.id === 'task-1')).toEqual(updatedTask);
    expect(listCache?.find((t) => t.id === 'task-2')).toEqual(otherTask);

    // Individual cache should be set
    const individualCache = qc.getQueryData<Task>(['tasks', 'task-1']);
    expect(individualCache).toEqual(updatedTask);

    // invalidateQueries should NOT have been called with ['tasks']
    const tasksInvalidations = invalidateSpy.mock.calls.filter((call: unknown[]) => {
      const key = (call[0] as { queryKey?: unknown })?.queryKey;
      return Array.isArray(key) && key.length === 1 && key[0] === 'tasks';
    });
    expect(tasksInvalidations).toHaveLength(0);
  }

  it('useAddSubtask patches cache without full invalidation', async () => {
    await assertPatchOnly(() => useAddSubtask(), { taskId: 'task-1', title: 'New subtask' });
  });

  it('useUpdateSubtask patches cache without full invalidation', async () => {
    await assertPatchOnly(() => useUpdateSubtask(), {
      taskId: 'task-1',
      subtaskId: 'sub-1',
      updates: { completed: true },
    });
  });

  it('useDeleteSubtask patches cache without full invalidation', async () => {
    await assertPatchOnly(() => useDeleteSubtask(), { taskId: 'task-1', subtaskId: 'sub-1' });
  });

  it('useToggleSubtaskCriteria patches cache without full invalidation', async () => {
    await assertPatchOnly(() => useToggleSubtaskCriteria(), {
      taskId: 'task-1',
      subtaskId: 'sub-1',
      criteriaIndex: 0,
    });
  });

  it('useAddComment patches cache without full invalidation', async () => {
    await assertPatchOnly(() => useAddComment(), {
      taskId: 'task-1',
      author: 'tester',
      text: 'Hello',
    });
  });

  it('useEditComment patches cache without full invalidation', async () => {
    await assertPatchOnly(() => useEditComment(), {
      taskId: 'task-1',
      commentId: 'cmt-1',
      text: 'Edited',
    });
  });

  it('useDeleteComment patches cache without full invalidation', async () => {
    await assertPatchOnly(() => useDeleteComment(), { taskId: 'task-1', commentId: 'cmt-1' });
  });

  it('useAddObservation patches cache without full invalidation', async () => {
    await assertPatchOnly(() => useAddObservation(), {
      taskId: 'task-1',
      data: { type: 'insight', content: 'Test insight' },
    });
  });

  it('useDeleteObservation patches cache without full invalidation', async () => {
    await assertPatchOnly(() => useDeleteObservation(), {
      taskId: 'task-1',
      observationId: 'obs-1',
    });
  });

  it('useAddVerificationStep patches cache without full invalidation', async () => {
    await assertPatchOnly(() => useAddVerificationStep(), {
      taskId: 'task-1',
      description: 'Verify X',
    });
  });

  it('useUpdateVerificationStep patches cache without full invalidation', async () => {
    await assertPatchOnly(() => useUpdateVerificationStep(), {
      taskId: 'task-1',
      stepId: 'step-1',
      updates: { checked: true },
    });
  });

  it('useDeleteVerificationStep patches cache without full invalidation', async () => {
    await assertPatchOnly(() => useDeleteVerificationStep(), {
      taskId: 'task-1',
      stepId: 'step-1',
    });
  });
});

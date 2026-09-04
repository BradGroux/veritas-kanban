import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PartialBlueprintCreationError, useTemplateForm } from '@/hooks/useTemplateForm';

const mocks = vi.hoisted(() => ({
  templates: [] as Array<Record<string, unknown>>,
  mutateAsync: vi.fn(),
}));

vi.mock('@/hooks/useTemplates', () => ({
  useTemplates: () => ({ data: mocks.templates }),
}));

vi.mock('@/hooks/useTasks', () => ({
  useCreateTask: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}));

describe('useTemplateForm blueprint creation', () => {
  beforeEach(() => {
    mocks.mutateAsync.mockReset();
    mocks.templates = [
      {
        id: 'release-blueprint',
        name: 'Release blueprint',
        version: 1,
        taskDefaults: {},
        blueprint: [
          { refId: 'build', title: 'Build release', taskDefaults: {} },
          {
            refId: 'publish',
            title: 'Publish release',
            taskDefaults: {},
            blockedByRefs: ['build'],
          },
        ],
        created: '2026-09-04T00:00:00.000Z',
        updated: '2026-09-04T00:00:00.000Z',
      },
    ];
  });

  it('reports partial blueprint completion so the UI can block a blind retry', async () => {
    const failure = new Error('Second task failed');
    mocks.mutateAsync.mockResolvedValueOnce({ id: 'task_build' }).mockRejectedValueOnce(failure);
    const { result } = renderHook(() => useTemplateForm());

    act(() => {
      result.current.applyTemplate(mocks.templates[0] as never);
    });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.createTasks('', '', '', '', 'code', 'medium', 'auto');
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(PartialBlueprintCreationError);
    expect(caught).toMatchObject({ completedCount: 1, totalCount: 2, cause: failure });
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(2);
    expect(mocks.mutateAsync.mock.calls[1]?.[0]).toMatchObject({
      title: 'Publish release',
      blockedBy: ['task_build'],
    });
  });

  it('preserves the original error when no blueprint task was created', async () => {
    const failure = new Error('First task failed');
    mocks.mutateAsync.mockRejectedValueOnce(failure);
    const { result } = renderHook(() => useTemplateForm());

    act(() => {
      result.current.applyTemplate(mocks.templates[0] as never);
    });

    await expect(result.current.createTasks('', '', '', '', 'code', 'medium', 'auto')).rejects.toBe(
      failure
    );
  });
});

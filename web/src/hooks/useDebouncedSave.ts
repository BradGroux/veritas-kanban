import { createElement, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isRevisionConflict, useUpdateTask } from './useTasks';
import { useToast } from '@/hooks/useToast';
import { useFeatureSetting } from '@/hooks/useFeatureSettings';
import { getTaskSaveWrites } from '@/lib/task-save-writes';
import {
  getTaskConflict,
  markTaskConflictEditsPreserved,
  resolveTaskConflict,
  useTaskConflict,
} from '@/hooks/useTaskConflicts';
import type { Task } from '@veritas-kanban/shared';

export function useDebouncedSave(task: Task | null, open = true) {
  const queryClient = useQueryClient();
  const writer = getTaskSaveWrites(queryClient);
  const updateTask = useUpdateTask();
  const { toast } = useToast();
  const autoSaveDelayMs = useFeatureSetting('tasks', 'autoSaveDelayMs');
  const taskId = task?.id;
  const taskRef = useRef(task);
  const delayRef = useRef(autoSaveDelayMs);
  taskRef.current = task;
  delayRef.current = autoSaveDelayMs;
  const conflict = useTaskConflict(taskId);
  const mutateRef = useRef(updateTask.mutateAsync);
  const toastRef = useRef(toast);
  mutateRef.current = updateTask.mutateAsync;
  toastRef.current = toast;
  const getSnapshot = useCallback(() => writer.getSnapshot(taskId), [writer, taskId]);
  const snapshot = useSyncExternalStore(writer.subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    const attachedTask = taskRef.current;
    if (!attachedTask || !open) return;
    const id = attachedTask.id;
    return writer.attach(
      attachedTask,
      {
        save: async (targetId, input) => {
          const saved = await mutateRef.current({
            id: targetId,
            input,
            isCurrent: writer.isActive,
          });
          if (!writer.isActive()) return saved;
          // Reuse useUpdateTask's cache merge, including concurrent timer state.
          return queryClient.getQueryData<Task>(['tasks', targetId]) ?? saved;
        },
        canSave: () => !getTaskConflict(id),
        onSaved: () => resolveTaskConflict(id, 'task update'),
        onDispose: () => resolveTaskConflict(id, 'task update'),
        onFailure: (draft, error, fields, retry) => {
          if (isRevisionConflict(error)) {
            markTaskConflictEditsPreserved(id, fields);
            return;
          }
          return toastRef.current({
            variant: 'destructive',
            title: 'Failed to save changes',
            description: `Changes to ${draft.title} are kept for retry. ${error instanceof Error ? error.message : 'Please try again'}`,
            action: createElement(
              'button',
              {
                type: 'button',
                onClick: retry,
                className:
                  'text-sm underline rounded focus-visible:outline focus-visible:outline-2',
              },
              'Retry task save'
            ),
          }).dismiss;
        },
      },
      delayRef.current
    );
    // Identity and open state own attachment; server refreshes merge separately.
  }, [writer, queryClient, taskId, open]);

  useEffect(() => {
    if (task) writer.sync(task);
  }, [writer, task]);
  useEffect(() => {
    if (taskId) writer.setDelay(taskId, autoSaveDelayMs);
  }, [writer, taskId, autoSaveDelayMs]);
  useEffect(() => {
    if (taskId && !conflict) writer.resume(taskId);
  }, [writer, taskId, conflict]);

  const updateField = useCallback(
    <K extends keyof Task>(field: K, value: Task[K]) => {
      if (taskId) writer.update(taskId, field, value);
    },
    [writer, taskId]
  );
  const retryConflict = useCallback(() => {
    if (!taskId) return;
    resolveTaskConflict(taskId, 'task update');
    writer.retry(taskId);
  }, [writer, taskId]);
  const discardConflict = useCallback(() => {
    if (!taskId) return;
    const current = conflict?.currentTask ?? task;
    if (current) writer.discard(taskId, current);
    resolveTaskConflict(taskId, 'task update');
  }, [writer, taskId, conflict?.currentTask, task]);

  return {
    localTask: snapshot?.localTask ?? task,
    updateField,
    isDirty: snapshot?.isDirty ?? false,
    isSaving: snapshot?.isSaving ?? false,
    conflict,
    retryConflict,
    discardConflict,
  };
}

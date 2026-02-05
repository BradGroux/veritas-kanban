import { useState, useEffect, useCallback, useRef } from 'react';
import { useUpdateTask } from './useTasks';
import { useToast } from '@/hooks/useToast';
import type { Task } from '@veritas-kanban/shared';

export function useDebouncedSave(task: Task | null) {
  const updateTask = useUpdateTask();
  const { toast } = useToast();
  const [localTask, setLocalTask] = useState<Task | null>(task);
  const [changedFields, setChangedFields] = useState<Set<keyof Task>>(new Set());
  const changedFieldsRef = useRef(changedFields);
  const mutateRef = useRef(updateTask.mutate);
  const toastRef = useRef(toast);

  // Keep refs current without triggering effects
  changedFieldsRef.current = changedFields;
  mutateRef.current = updateTask.mutate;
  toastRef.current = toast;

  // Sync from server — preserve locally dirty fields so refetches
  // don't overwrite what the user is actively typing
  useEffect(() => {
    if (!task) {
      setLocalTask(null);
      setChangedFields(new Set());
      return;
    }

    const dirty = changedFieldsRef.current;
    if (dirty.size === 0) {
      // No pending edits — take server value wholesale
      setLocalTask(task);
    } else {
      // Merge: server values for clean fields, keep local values for dirty ones
      setLocalTask((prev) => {
        if (!prev) return task;
        const merged = { ...task };
        dirty.forEach((field) => {
          (merged as Record<string, unknown>)[field as string] = prev[field];
        });
        return merged;
      });
    }
  }, [task]);

  // Debounced save — only send fields that were actually changed
  useEffect(() => {
    if (changedFields.size === 0 || !localTask) return;

    const timeout = setTimeout(() => {
      const input: Record<string, unknown> = {};
      // Snapshot the fields being saved so we only clear those on success
      const fieldsToClear = new Set(changedFields);
      fieldsToClear.forEach((field) => {
        input[field] = localTask[field];
      });

      mutateRef.current(
        {
          id: localTask.id,
          input,
        },
        {
          onSuccess: () => {
            // Only clear the fields we actually saved, not any new edits that
            // may have occurred while the mutation was in flight
            setChangedFields((prev) => {
              const remaining = new Set(prev);
              fieldsToClear.forEach((f) => remaining.delete(f));
              return remaining;
            });
          },
          onError: (error) => {
            toastRef.current({
              variant: 'destructive',
              title: 'Failed to save changes',
              description: error instanceof Error ? error.message : 'Please try again',
            });
          },
        }
      );
    }, 500);

    return () => clearTimeout(timeout);
  }, [localTask, changedFields]);

  const updateField = useCallback(<K extends keyof Task>(field: K, value: Task[K]) => {
    setLocalTask((prev) => (prev ? { ...prev, [field]: value } : null));
    setChangedFields((prev) => new Set(prev).add(field));
  }, []);

  const isDirty = changedFields.size > 0;

  return { localTask, updateField, isDirty };
}

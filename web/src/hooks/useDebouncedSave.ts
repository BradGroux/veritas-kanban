import { useState, useEffect, useCallback, useRef } from 'react';
import { isRevisionConflict, useUpdateTask } from './useTasks';
import { useToast } from '@/hooks/useToast';
import { useFeatureSetting } from '@/hooks/useFeatureSettings';
import {
  markTaskConflictEditsPreserved,
  resolveTaskConflict,
  useTaskConflict,
} from '@/hooks/useTaskConflicts';
import type { Task } from '@veritas-kanban/shared';

export function useDebouncedSave(task: Task | null) {
  const updateTask = useUpdateTask();
  const { toast } = useToast();
  const autoSaveDelayMs = useFeatureSetting('tasks', 'autoSaveDelayMs');
  const [localTask, setLocalTask] = useState<Task | null>(task);
  const [changedFields, setChangedFields] = useState<Set<keyof Task>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const conflict = useTaskConflict(task?.id);
  const changedFieldsRef = useRef(changedFields);
  const localTaskRef = useRef(localTask);
  const fieldVersionsRef = useRef(new Map<keyof Task, number>());
  const saveInFlightRef = useRef(false);
  const mutateRef = useRef(updateTask.mutate);
  const toastRef = useRef(toast);

  // Keep refs current without triggering effects
  changedFieldsRef.current = changedFields;
  localTaskRef.current = localTask;
  mutateRef.current = updateTask.mutate;
  toastRef.current = toast;

  // Sync from server — preserve locally dirty fields so refetches
  // don't overwrite what the user is actively typing
  useEffect(() => {
    if (!task) {
      setLocalTask(null);
      setChangedFields(new Set());
      fieldVersionsRef.current.clear();
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

  const savePendingChanges = useCallback(() => {
    const taskToSave = localTaskRef.current;
    const fieldsToSave = new Set(changedFieldsRef.current);
    if (!taskToSave || fieldsToSave.size === 0 || saveInFlightRef.current) return;

    const input: Record<string, unknown> = {};
    const savedVersions = new Map<keyof Task, number>();
    fieldsToSave.forEach((field) => {
      input[field] = taskToSave[field];
      savedVersions.set(field, fieldVersionsRef.current.get(field) ?? 0);
    });

    saveInFlightRef.current = true;
    setIsSaving(true);
    mutateRef.current(
      {
        id: taskToSave.id,
        input,
      },
      {
        onSuccess: () => {
          saveInFlightRef.current = false;
          setIsSaving(false);
          resolveTaskConflict(taskToSave.id, 'task update');
          setChangedFields((previous) => {
            const remaining = new Set(previous);
            fieldsToSave.forEach((field) => {
              if (fieldVersionsRef.current.get(field) === savedVersions.get(field)) {
                remaining.delete(field);
              }
            });
            return remaining;
          });
        },
        onError: (error) => {
          saveInFlightRef.current = false;
          setIsSaving(false);
          if (isRevisionConflict(error)) {
            markTaskConflictEditsPreserved(
              taskToSave.id,
              Array.from(fieldsToSave, (field) => String(field))
            );
            return;
          }
          toastRef.current({
            variant: 'destructive',
            title: 'Failed to save changes',
            description:
              typeof (error as { message?: unknown }).message === 'string'
                ? (error as { message: string }).message
                : 'Please try again',
          });
        },
      }
    );
  }, []);

  // Debounced save — only send fields that were actually changed
  useEffect(() => {
    if (changedFields.size === 0 || !localTask || conflict || saveInFlightRef.current) {
      return;
    }

    const timeout = setTimeout(() => {
      savePendingChanges();
    }, autoSaveDelayMs);

    return () => clearTimeout(timeout);
  }, [localTask, changedFields, autoSaveDelayMs, conflict, savePendingChanges]);

  const updateField = useCallback(<K extends keyof Task>(field: K, value: Task[K]) => {
    fieldVersionsRef.current.set(field, (fieldVersionsRef.current.get(field) ?? 0) + 1);
    setLocalTask((prev) => (prev ? { ...prev, [field]: value } : null));
    setChangedFields((prev) => new Set(prev).add(field));
  }, []);

  const retryConflict = useCallback(() => {
    const taskId = localTaskRef.current?.id;
    if (!taskId) return;
    resolveTaskConflict(taskId, 'task update');
    savePendingChanges();
  }, [savePendingChanges]);

  const discardConflict = useCallback(() => {
    const taskId = localTaskRef.current?.id;
    if (!taskId) return;
    fieldVersionsRef.current.clear();
    setChangedFields(new Set());
    setLocalTask(conflict?.currentTask ?? task);
    resolveTaskConflict(taskId, 'task update');
  }, [conflict?.currentTask, task]);

  const isDirty = changedFields.size > 0;

  return {
    localTask,
    updateField,
    isDirty,
    isSaving,
    conflict,
    retryConflict,
    discardConflict,
  };
}

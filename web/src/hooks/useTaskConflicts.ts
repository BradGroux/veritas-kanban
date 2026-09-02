import { useCallback, useSyncExternalStore } from 'react';
import type { Task } from '@veritas-kanban/shared';
import { dismissToast } from './useToast';

export type TaskConflictOperation = 'task update' | 'comment change';

export interface TaskConflict {
  identity: string;
  taskId: string;
  taskTitle: string;
  currentRevision?: number;
  currentTask?: Task;
  operation: TaskConflictOperation;
  localEditsPreserved: boolean;
  dirtyFields: string[];
}

interface RecordTaskConflictInput {
  taskId: string;
  taskTitle: string;
  currentTask?: Task;
  operation: TaskConflictOperation;
}

const conflicts = new Map<string, TaskConflict>();
const listeners = new Set<() => void>();
const openTaskSurfaces = new Set<string>();

function emitChange(): void {
  listeners.forEach((listener) => listener());
}

export function taskConflictToastId(taskId: string): string {
  return `task-conflict:${taskId}`;
}

export function recordTaskConflict(input: RecordTaskConflictInput): {
  conflict: TaskConflict;
  isNewIdentity: boolean;
  hasOpenSurface: boolean;
} {
  const currentRevision =
    typeof input.currentTask?.revision === 'number' ? input.currentTask.revision : undefined;
  const identity = `${input.taskId}:${currentRevision ?? 'unknown'}`;
  const existing = conflicts.get(input.taskId);

  if (existing?.identity === identity) {
    return {
      conflict: existing,
      isNewIdentity: false,
      hasOpenSurface: openTaskSurfaces.has(input.taskId),
    };
  }

  const conflict: TaskConflict = {
    identity,
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    currentRevision,
    currentTask: input.currentTask,
    operation: input.operation,
    localEditsPreserved: false,
    dirtyFields: [],
  };
  conflicts.set(input.taskId, conflict);
  emitChange();

  return {
    conflict,
    isNewIdentity: true,
    hasOpenSurface: openTaskSurfaces.has(input.taskId),
  };
}

export function markTaskConflictEditsPreserved(taskId: string, dirtyFields: string[]): void {
  const conflict = conflicts.get(taskId);
  if (!conflict) return;

  const nextFields = Array.from(new Set(dirtyFields)).sort();
  conflicts.set(taskId, {
    ...conflict,
    operation: 'task update',
    localEditsPreserved: true,
    dirtyFields: nextFields,
  });
  emitChange();
}

export function resolveTaskConflict(taskId: string, operation?: TaskConflictOperation): void {
  const conflict = conflicts.get(taskId);
  if (operation && conflict?.operation !== operation) return;

  if (conflicts.delete(taskId)) emitChange();
  dismissToast(taskConflictToastId(taskId));
}

export function openTaskConflict(taskId: string): void {
  window.dispatchEvent(new CustomEvent('open-task', { detail: { taskId } }));
  dismissToast(taskConflictToastId(taskId));
}

export function registerOpenTaskConflictSurface(taskId: string): () => void {
  openTaskSurfaces.add(taskId);
  return () => {
    openTaskSurfaces.delete(taskId);
  };
}

export function useTaskConflict(taskId: string | undefined): TaskConflict | null {
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
  const getSnapshot = useCallback(
    () => (taskId ? (conflicts.get(taskId) ?? null) : null),
    [taskId]
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function resetTaskConflicts(): void {
  conflicts.clear();
  openTaskSurfaces.clear();
  emitChange();
}

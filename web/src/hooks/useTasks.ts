import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useWebSocketStatus } from '@/contexts/WebSocketContext';
import { toast } from '@/hooks/useToast';
import type { Task, CreateTaskInput, UpdateTaskInput } from '@veritas-kanban/shared';

/**
 * Polling intervals based on WebSocket connection state.
 * - Connected: 60s safety-net polling (WS delivers real-time updates)
 * - Disconnected: 10s aggressive polling as fallback
 */
const POLL_INTERVAL_WS_CONNECTED = 60_000;
const POLL_INTERVAL_WS_DISCONNECTED = 10_000;

export function useTasks() {
  const { isConnected } = useWebSocketStatus();

  return useQuery({
    queryKey: ['tasks'],
    queryFn: api.tasks.list,
    refetchInterval: isConnected ? POLL_INTERVAL_WS_CONNECTED : POLL_INTERVAL_WS_DISCONNECTED,
    staleTime: isConnected ? 30_000 : 5_000,
  });
}

export function useArchivedTasks() {
  return useQuery({
    queryKey: ['tasks', 'archived'],
    queryFn: api.tasks.listArchived,
  });
}

export function useTask(id: string) {
  return useQuery({
    queryKey: ['tasks', id],
    queryFn: () => api.tasks.get(id),
    enabled: !!id,
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateTaskInput) => api.tasks.create(input),
    // Optimistic update: immediately add a placeholder task
    onMutate: async (input) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['tasks'] });

      // Snapshot the previous value
      const previousTasks = queryClient.getQueryData<Task[]>(['tasks']);

      // Optimistically add new task with temporary ID
      const optimisticTask: Task = {
        id: `temp-${Date.now()}`,
        title: input.title,
        description: input.description || '',
        type: (input.type || 'code') as Task['type'],
        status: 'todo',
        priority: input.priority || 'medium',
        project: input.project,
        sprint: input.sprint,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        subtasks: [],
        comments: [],
        reviewComments: [],
      };

      queryClient.setQueryData<Task[]>(['tasks'], (old) =>
        old ? [optimisticTask, ...old] : [optimisticTask]
      );

      return { previousTasks };
    },
    // On error, rollback to previous value
    onError: (_err, _input, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(['tasks'], context.previousTasks);
      }
    },
    // Always refetch to sync with server
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task-counts'] });
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTaskInput }) =>
      api.tasks.update(id, input),
    // On success, merge the server response with the current cache.
    // Preserve timeTracking from the cache if it wasn't part of this update,
    // since concurrent timer mutations (start/stop) may have already patched
    // the cache with newer time tracking state. Without this, the debounced
    // save response (which doesn't include timeTracking changes) would
    // overwrite the timer stop/start that happened in between.
    onSuccess: (serverTask, { input }) => {
      const mergeWithCachedTimeTracking = (cached: Task | undefined): Task => {
        if (!cached || input.timeTracking !== undefined) {
          // If this update explicitly included timeTracking, use server response as-is
          return serverTask;
        }
        // Preserve the cached timeTracking (which may reflect a more recent timer mutation)
        return { ...serverTask, timeTracking: cached.timeTracking };
      };

      queryClient.setQueryData<Task[]>(['tasks'], (old) =>
        old ? old.map((t) => (t.id === serverTask.id ? mergeWithCachedTimeTracking(t) : t)) : old
      );

      const cachedTask = queryClient.getQueryData<Task>(['tasks', serverTask.id]);
      queryClient.setQueryData(['tasks', serverTask.id], mergeWithCachedTimeTracking(cachedTask));

      // GH-87: Invalidate metrics cache if status changed to keep sidebar in sync.
      // The sidebar relies on useMetrics() which has a 30s refetch interval + 10s staleTime.
      // Without this, sidebar counts can lag behind the actual board state.
      if (input.status) {
        queryClient.invalidateQueries({ queryKey: ['metrics'] });
        queryClient.invalidateQueries({ queryKey: ['task-counts'] });
      }
    },
    // Handle validation errors with detailed toast messages
    onError: (error: Error & { code?: string; details?: unknown }) => {
      // Extract enforcement gate error details
      const details = error.details as
        | Array<{ code: string; message: string; path: string[] }>
        | undefined;

      // If this is an enforcement gate error, show a detailed toast
      if (details && details.length > 0) {
        const gateError = details[0];

        // Map gate codes to user-friendly titles
        const gateNames: Record<string, string> = {
          REVIEW_GATE: '🔒 Review Gate',
          CLOSING_COMMENTS_REQUIRED: '💬 Closing Comments Required',
          DELIVERABLE_REQUIRED: '📦 Deliverable Required',
        };

        const title = gateNames[gateError.code] || '⚠️ Validation Error';

        toast({
          title,
          description: gateError.message,
          variant: 'destructive',
          duration: 8000, // Longer duration for enforcement messages
        });
      } else {
        // Generic error fallback
        toast({
          title: '❌ Update Failed',
          description: error.message || 'An unexpected error occurred',
          variant: 'destructive',
        });
      }
    },
    // NOTE: No general onSettled invalidation here. The onSuccess handler already
    // patches the cache with the server response (preserving timer state).
    // An aggressive invalidateQueries would trigger a background refetch
    // whose response could overwrite timer state that was patched between
    // the mutation start and the refetch completing. The WebSocket
    // task:changed events and polling handle eventual consistency.
    // Status-specific metrics invalidation is handled above (GH-87).
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.tasks.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task-counts'] });
    },
  });
}

export function useArchiveTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.tasks.archive(id),
    onMutate: async (id: string) => {
      // Cancel outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ['tasks'] });

      // Snapshot previous value for rollback
      const previous = queryClient.getQueryData<Task[]>(['tasks']);

      // Optimistically remove the task from the board immediately
      if (previous) {
        queryClient.setQueryData<Task[]>(
          ['tasks'],
          previous.filter((t) => t.id !== id)
        );
      }

      return { previous };
    },
    onError: (_err, _id, context) => {
      // Roll back on failure
      if (context?.previous) {
        queryClient.setQueryData(['tasks'], context.previous);
      }
    },
    onSettled: () => {
      // Always refetch after mutation settles to ensure consistency
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', 'archived'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      queryClient.invalidateQueries({ queryKey: ['task-counts'] });
    },
  });
}

export function useBulkArchive() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sprint: string) => api.tasks.bulkArchive(sprint),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', 'archived'] });
      queryClient.invalidateQueries({ queryKey: ['task-counts'] });
    },
  });
}

export function useBulkUpdate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      ids,
      status,
    }: {
      ids: string[];
      status: 'todo' | 'in-progress' | 'blocked' | 'done';
    }) => api.tasks.bulkUpdate(ids, status),
    onMutate: async ({ ids, status }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['tasks'] });

      // Snapshot previous value
      const previous = queryClient.getQueryData<Task[]>(['tasks']);

      // Optimistically update tasks
      if (previous) {
        queryClient.setQueryData<Task[]>(
          ['tasks'],
          previous.map((t) => (ids.includes(t.id) ? { ...t, status } : t))
        );
      }

      return { previous };
    },
    onError: (_err, _vars, context) => {
      // Rollback on error
      if (context?.previous) {
        queryClient.setQueryData(['tasks'], context.previous);
      }
    },
    onSettled: () => {
      // Single batch of cache invalidations (not per-task)
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      queryClient.invalidateQueries({ queryKey: ['task-counts'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}

export function useBulkArchiveByIds() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) => api.tasks.bulkArchiveByIds(ids),
    onMutate: async (ids: string[]) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['tasks'] });

      // Snapshot previous value
      const previous = queryClient.getQueryData<Task[]>(['tasks']);

      // Optimistically remove tasks from board
      if (previous) {
        queryClient.setQueryData<Task[]>(
          ['tasks'],
          previous.filter((t) => !ids.includes(t.id))
        );
      }

      return { previous };
    },
    onError: (_err, _ids, context) => {
      // Rollback on error
      if (context?.previous) {
        queryClient.setQueryData(['tasks'], context.previous);
      }
    },
    onSettled: () => {
      // Single batch of cache invalidations (not per-task)
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', 'archived'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      queryClient.invalidateQueries({ queryKey: ['task-counts'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}

export function useRestoreTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.tasks.restore(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', 'archived'] });
      queryClient.invalidateQueries({ queryKey: ['task-counts'] });
    },
  });
}

export function useAddSubtask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      title,
      acceptanceCriteria,
    }: {
      taskId: string;
      title: string;
      acceptanceCriteria?: string[];
    }) => api.tasks.addSubtask(taskId, title, acceptanceCriteria),
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.setQueryData(['tasks', task.id], task);
    },
  });
}

export function useUpdateSubtask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      subtaskId,
      updates,
    }: {
      taskId: string;
      subtaskId: string;
      updates: { title?: string; completed?: boolean };
    }) => api.tasks.updateSubtask(taskId, subtaskId, updates),
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.setQueryData(['tasks', task.id], task);
    },
  });
}

export function useDeleteSubtask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, subtaskId }: { taskId: string; subtaskId: string }) =>
      api.tasks.deleteSubtask(taskId, subtaskId),
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.setQueryData(['tasks', task.id], task);
    },
  });
}

export function useToggleSubtaskCriteria() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      subtaskId,
      criteriaIndex,
    }: {
      taskId: string;
      subtaskId: string;
      criteriaIndex: number;
    }) => api.tasks.toggleSubtaskCriteria(taskId, subtaskId, criteriaIndex),
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.setQueryData(['tasks', task.id], task);
    },
  });
}

export function useAddVerificationStep() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, description }: { taskId: string; description: string }) =>
      api.tasks.addVerificationStep(taskId, description),
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.setQueryData(['tasks', task.id], task);
    },
  });
}

export function useUpdateVerificationStep() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      stepId,
      updates,
    }: {
      taskId: string;
      stepId: string;
      updates: { description?: string; checked?: boolean };
    }) => api.tasks.updateVerificationStep(taskId, stepId, updates),
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.setQueryData(['tasks', task.id], task);
    },
  });
}

export function useDeleteVerificationStep() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, stepId }: { taskId: string; stepId: string }) =>
      api.tasks.deleteVerificationStep(taskId, stepId),
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.setQueryData(['tasks', task.id], task);
    },
  });
}

export function useAddComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, author, text }: { taskId: string; author: string; text: string }) =>
      api.tasks.addComment(taskId, author, text),
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.setQueryData(['tasks', task.id], task);
    },
  });
}

export function useEditComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      commentId,
      text,
    }: {
      taskId: string;
      commentId: string;
      text: string;
    }) => api.tasks.editComment(taskId, commentId, text),
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.setQueryData(['tasks', task.id], task);
    },
  });
}

export function useDeleteComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, commentId }: { taskId: string; commentId: string }) =>
      api.tasks.deleteComment(taskId, commentId),
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.setQueryData(['tasks', task.id], task);
    },
  });
}

export function useAddObservation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      data,
    }: {
      taskId: string;
      data: {
        type: 'decision' | 'blocker' | 'insight' | 'context';
        content: string;
        score?: number;
        agent?: string;
      };
    }) => api.tasks.addObservation(taskId, data),
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.setQueryData(['tasks', task.id], task);
    },
  });
}

export function useDeleteObservation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, observationId }: { taskId: string; observationId: string }) =>
      api.tasks.deleteObservation(taskId, observationId),
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.setQueryData(['tasks', task.id], task);
    },
  });
}

export function useReorderTasks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (orderedIds: string[]) => api.tasks.reorder(orderedIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

function sortByPosition(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const posA = a.position ?? Number.MAX_SAFE_INTEGER;
    const posB = b.position ?? Number.MAX_SAFE_INTEGER;
    if (posA !== posB) return posA - posB;
    // Fallback: newer tasks first (preserve existing behavior for un-positioned tasks)
    return new Date(b.updated).getTime() - new Date(a.updated).getTime();
  });
}

export function useTasksByStatus(tasks: Task[] | undefined) {
  if (!tasks) {
    return {
      todo: [],
      'in-progress': [],
      blocked: [],
      done: [],
      cancelled: [],
    };
  }

  return {
    todo: sortByPosition(tasks.filter((t) => t.status === 'todo')),
    'in-progress': sortByPosition(tasks.filter((t) => t.status === 'in-progress')),
    blocked: sortByPosition(tasks.filter((t) => t.status === 'blocked')),
    done: sortByPosition(tasks.filter((t) => t.status === 'done')),
    cancelled: sortByPosition(tasks.filter((t) => t.status === 'cancelled')),
  };
}

// Check if a task is blocked by incomplete dependencies
export function isTaskBlocked(task: Task, allTasks: Task[]): boolean {
  if (!task.blockedBy?.length) return false;

  const blockingTasks = allTasks.filter((t) => task.blockedBy?.includes(t.id));
  return blockingTasks.some((t) => t.status !== 'done');
}

// Get the blockers for a task
export function getTaskBlockers(task: Task, allTasks: Task[]): Task[] {
  if (!task.blockedBy?.length) return [];

  return allTasks.filter((t) => task.blockedBy?.includes(t.id) && t.status !== 'done');
}

// Archive suggestions - sprints where all tasks are done
export function useArchiveSuggestions() {
  const { isConnected } = useWebSocketStatus();

  return useQuery({
    queryKey: ['tasks', 'archive-suggestions'],
    queryFn: api.tasks.getArchiveSuggestions,
    // When WS is connected, task:changed events trigger invalidation anyway
    refetchInterval: isConnected ? 120_000 : 30_000,
  });
}

export function useArchiveSprint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sprint: string) => api.tasks.archiveSprint(sprint),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', 'archived'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', 'archive-suggestions'] });
      queryClient.invalidateQueries({ queryKey: ['task-counts'] });
    },
  });
}

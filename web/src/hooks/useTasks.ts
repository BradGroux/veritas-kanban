import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Task, CreateTaskInput, UpdateTaskInput } from '@veritas-kanban/shared';

export function useTasks() {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: api.tasks.list,
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTaskInput }) => 
      api.tasks.update(id, input),
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.setQueryData(['tasks', task.id], task);
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => api.tasks.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useArchiveTask() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => api.tasks.archive(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', 'archived'] });
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
    },
  });
}

export function useAddSubtask() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ taskId, title }: { taskId: string; title: string }) => 
      api.tasks.addSubtask(taskId, title),
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.setQueryData(['tasks', task.id], task);
    },
  });
}

export function useUpdateSubtask() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ taskId, subtaskId, updates }: { 
      taskId: string; 
      subtaskId: string; 
      updates: { title?: string; completed?: boolean } 
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
    mutationFn: ({ taskId, commentId, text }: { taskId: string; commentId: string; text: string }) => 
      api.tasks.editComment(taskId, commentId, text),
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
      review: [],
      done: [],
    };
  }

  return {
    todo: sortByPosition(tasks.filter(t => t.status === 'todo')),
    'in-progress': sortByPosition(tasks.filter(t => t.status === 'in-progress')),
    review: sortByPosition(tasks.filter(t => t.status === 'review')),
    done: sortByPosition(tasks.filter(t => t.status === 'done')),
  };
}

// Check if a task is blocked by incomplete dependencies
export function isTaskBlocked(task: Task, allTasks: Task[]): boolean {
  if (!task.blockedBy?.length) return false;
  
  const blockingTasks = allTasks.filter(t => task.blockedBy?.includes(t.id));
  return blockingTasks.some(t => t.status !== 'done');
}

// Get the blockers for a task
export function getTaskBlockers(task: Task, allTasks: Task[]): Task[] {
  if (!task.blockedBy?.length) return [];
  
  return allTasks.filter(t => task.blockedBy?.includes(t.id) && t.status !== 'done');
}

// Archive suggestions - sprints where all tasks are done
export function useArchiveSuggestions() {
  return useQuery({
    queryKey: ['tasks', 'archive-suggestions'],
    queryFn: api.tasks.getArchiveSuggestions,
    refetchInterval: 30000, // Check every 30s
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
    },
  });
}

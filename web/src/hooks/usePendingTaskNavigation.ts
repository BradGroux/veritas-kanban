import { useEffect } from 'react';
import type { Task } from '@veritas-kanban/shared';
import { useView } from '@/contexts/ViewContext';
import { toast } from '@/hooks/useToast';
import type { TaskDetailNavigationTarget } from '@/lib/task-detail-tabs';

/** The current navigation owns its lookup; superseded results cannot open another task. */
export function usePendingTaskNavigation(
  tasks: readonly Task[] | undefined,
  open: (task: Task, target: TaskDetailNavigationTarget | null) => void
) {
  const { pendingTaskId, pendingTaskTarget, clearPendingTask, returnFromTask } = useView();
  useEffect(() => {
    if (!pendingTaskId) return;
    let active = true;
    const local = tasks?.find((task) => task.id === pendingTaskId);
    if (local) {
      open(local, pendingTaskTarget);
      clearPendingTask();
      return;
    }
    void (async () => {
      try {
        const { api } = await import('@/lib/api');
        if (!active) return;
        const task = await api.tasks.get(pendingTaskId);
        if (!active) return;
        if (task?.id === pendingTaskId) {
          open(task, pendingTaskTarget);
          clearPendingTask();
          return;
        }
      } catch {
        if (!active) return;
      }
      toast({
        variant: 'destructive',
        title: 'Task unavailable',
        description:
          'The requested task could not be opened. Check your access or try the link again.',
      });
      clearPendingTask();
      returnFromTask();
    })();
    return () => {
      active = false;
    };
  }, [pendingTaskId, pendingTaskTarget, tasks, open, clearPendingTask, returnFromTask]);
}

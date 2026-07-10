/**
 * Blocking Service
 *
 * Handles task blocking/dependency logic.
 * Extracted from tasks.ts route to separate business logic from HTTP concerns.
 *
 * Dual-field enforcement (#787): checks both legacy `blockedBy` and canonical
 * `dependencies.depends_on` so the modern dependency API is always honoured.
 */

import type { Task } from '@veritas-kanban/shared';

export interface BlockerInfo {
  id: string;
  title: string;
  status?: string;
}

export interface BlockingStatus {
  isBlocked: boolean;
  blockers: BlockerInfo[];
  completedBlockers: BlockerInfo[];
}

/** Collect the full set of dependency IDs from both legacy and canonical fields. */
function allDependencyIds(task: Task): string[] {
  const ids = new Set<string>();
  for (const id of task.blockedBy ?? []) ids.add(id);
  for (const id of task.dependencies?.depends_on ?? []) ids.add(id);
  return Array.from(ids);
}

export class BlockingService {
  /**
   * Get the blocking status for a task.
   * Considers both `blockedBy` (legacy) and `dependencies.depends_on` (canonical).
   */
  getBlockingStatus(task: Task, allTasks: Task[]): BlockingStatus {
    const depIds = allDependencyIds(task);
    if (depIds.length === 0) {
      return { isBlocked: false, blockers: [], completedBlockers: [] };
    }

    const blockingTasks = allTasks.filter((t) => depIds.includes(t.id));
    const incompleteBlockers = blockingTasks.filter((t) => t.status !== 'done');
    const completedBlockers = blockingTasks.filter((t) => t.status === 'done');

    return {
      isBlocked: incompleteBlockers.length > 0,
      blockers: incompleteBlockers.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
      })),
      completedBlockers: completedBlockers.map((t) => ({
        id: t.id,
        title: t.title,
      })),
    };
  }

  /**
   * Check if a task can move to in-progress (all dependencies must be done).
   * Considers both `blockedBy` (legacy) and `dependencies.depends_on` (canonical).
   */
  canMoveToInProgress(
    task: Task,
    allTasks: Task[]
  ): { allowed: boolean; blockers?: BlockerInfo[] } {
    const depIds = allDependencyIds(task);
    if (depIds.length === 0) {
      return { allowed: true };
    }

    const blockingTasks = allTasks.filter((t) => depIds.includes(t.id));
    const incompleteBlockers = blockingTasks.filter((t) => t.status !== 'done');

    if (incompleteBlockers.length > 0) {
      return {
        allowed: false,
        blockers: incompleteBlockers.map((t) => ({ id: t.id, title: t.title })),
      };
    }

    return { allowed: true };
  }

  /**
   * Get all tasks that are blocked by a given task (reverse lookup).
   * Considers both `blockedBy` (legacy) and `dependencies.depends_on` (canonical).
   */
  getDependentTasks(taskId: string, allTasks: Task[]): Task[] {
    return allTasks.filter((t) => {
      if (t.blockedBy?.includes(taskId)) return true;
      if (t.dependencies?.depends_on?.includes(taskId)) return true;
      return false;
    });
  }

  /**
   * Check if completing a task would unblock other tasks.
   */
  getTasksThatWouldBeUnblocked(taskId: string, allTasks: Task[]): Task[] {
    const dependentTasks = this.getDependentTasks(taskId, allTasks);

    return dependentTasks.filter((task) => {
      const depIds = allDependencyIds(task).filter((id) => id !== taskId);
      const otherIncomplete = depIds.filter((blockerId) => {
        const blockerTask = allTasks.find((t: Task) => t.id === blockerId);
        return blockerTask && blockerTask.status !== 'done';
      });
      return otherIncomplete.length === 0;
    });
  }

  /**
   * Validate that adding a dependency wouldn't create a circular dependency.
   * Traverses both `blockedBy` and `dependencies.depends_on` graphs.
   */
  wouldCreateCircularDependency(taskId: string, newBlockerId: string, allTasks: Task[]): boolean {
    const visited = new Set<string>();
    const queue = [newBlockerId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;

      if (currentId === taskId) {
        return true;
      }

      if (visited.has(currentId)) {
        continue;
      }
      visited.add(currentId);

      const task = allTasks.find((t) => t.id === currentId);
      if (task) {
        queue.push(...allDependencyIds(task));
      }
    }

    return false;
  }
}

// Singleton instance
let instance: BlockingService | null = null;

export function getBlockingService(): BlockingService {
  if (!instance) {
    instance = new BlockingService();
  }
  return instance;
}

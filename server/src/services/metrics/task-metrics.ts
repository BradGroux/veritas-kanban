/**
 * Task-related metrics: task counts by status and sprint velocity.
 */
import fs from 'fs/promises';
import path from 'path';
import type { TaskStatus, BlockedCategory } from '@veritas-kanban/shared';
import { TaskService } from '../task-service.js';
import { PROJECT_ROOT } from './helpers.js';
import type {
  TaskMetrics,
  MetricsPeriod,
  VelocityTrend,
  SprintVelocityPoint,
  CurrentSprintProgress,
  VelocityMetrics,
} from './types.js';

/**
 * Get task counts by status, optionally filtered by time period.
 * When a period is provided, only tasks updated within that window are counted.
 */
export async function computeTaskMetrics(
  taskService: TaskService,
  project?: string,
  since?: string | null
): Promise<TaskMetrics> {
  const [activeTasks, archivedTasks] = await Promise.all([
    taskService.listTasks(),
    taskService.listArchivedTasks(),
  ]);

  // Filter by project if specified
  let filteredActive = project ? activeTasks.filter((t) => t.project === project) : activeTasks;
  let filteredArchived = project
    ? archivedTasks.filter((t) => t.project === project)
    : archivedTasks;

  // Filter by time period if specified (tasks updated within the window)
  if (since) {
    const sinceDate = new Date(since).getTime();
    filteredActive = filteredActive.filter((t) => {
      const updated = t.updated ? new Date(t.updated).getTime() : 0;
      const created = t.created ? new Date(t.created).getTime() : 0;
      return updated >= sinceDate || created >= sinceDate;
    });
    filteredArchived = filteredArchived.filter((t) => {
      const updated = t.updated ? new Date(t.updated).getTime() : 0;
      const created = t.created ? new Date(t.created).getTime() : 0;
      return updated >= sinceDate || created >= sinceDate;
    });
  }

  // Count by status
  const byStatus: Record<TaskStatus, number> = {
    todo: 0,
    'in-progress': 0,
    blocked: 0,
    done: 0,
  };

  // Count by blocked reason
  const byBlockedReason: Record<BlockedCategory | 'unspecified', number> = {
    'waiting-on-feedback': 0,
    'technical-snag': 0,
    prerequisite: 0,
    other: 0,
    unspecified: 0,
  };

  for (const task of filteredActive) {
    byStatus[task.status]++;

    // Count blocked reasons for blocked tasks
    if (task.status === 'blocked') {
      if (task.blockedReason?.category) {
        byBlockedReason[task.blockedReason.category]++;
      } else {
        byBlockedReason['unspecified']++;
      }
    }
  }

  const archived = filteredArchived.length;
  const total = filteredActive.length + archived;
  const completed = byStatus['done'] + archived;

  return {
    byStatus,
    byBlockedReason,
    total,
    completed,
    archived,
  };
}

/**
 * Get sprint velocity metrics.
 * Calculates tasks completed per sprint with rolling average and trend.
 */
export async function computeVelocityMetrics(
  taskService: TaskService,
  project?: string,
  limit = 10
): Promise<VelocityMetrics> {
  // Get all tasks (active + archived) to calculate velocity
  const [activeTasks, archivedTasks] = await Promise.all([
    taskService.listTasks(),
    taskService.listArchivedTasks(),
  ]);

  // Load sprint labels from sprints.json for display
  const sprintLabels = new Map<string, string>();
  try {
    const sprintsFile = path.join(PROJECT_ROOT, '.veritas-kanban', 'sprints.json');
    const sprintsData = await fs.readFile(sprintsFile, 'utf-8');
    const sprints = JSON.parse(sprintsData) as Array<{ id: string; label: string }>;
    for (const s of sprints) {
      sprintLabels.set(s.id, s.label);
    }
  } catch {
    // No sprints file or can't read it - will use IDs as labels
  }

  // Filter by project if specified
  const allTasks = [...activeTasks, ...archivedTasks].filter(
    (t) => !project || t.project === project
  );

  // Group tasks by sprint
  const sprintData = new Map<
    string,
    {
      completed: number;
      total: number;
      byType: Record<string, number>;
    }
  >();

  for (const task of allTasks) {
    if (!task.sprint) continue;

    if (!sprintData.has(task.sprint)) {
      sprintData.set(task.sprint, { completed: 0, total: 0, byType: {} });
    }

    const data = sprintData.get(task.sprint)!;
    data.total++;

    // Count completed tasks (done or archived)
    const isCompleted = task.status === 'done' || archivedTasks.some((a) => a.id === task.id);
    if (isCompleted) {
      data.completed++;

      // Track by type
      const taskType = task.type || 'other';
      data.byType[taskType] = (data.byType[taskType] || 0) + 1;
    }
  }

  // Sort sprints by label (assumes sprint labels are sortable like "US-100", "US-200", etc.)
  const sortedSprints = [...sprintData.entries()]
    .sort((a, b) => {
      // Extract numeric part for better sorting
      const numA = parseInt(a[0].replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(b[0].replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    })
    .slice(-limit); // Keep only the most recent sprints

  // Calculate velocity for each sprint
  const sprints: SprintVelocityPoint[] = [];
  const completedCounts: number[] = [];

  for (const [sprintId, data] of sortedSprints) {
    completedCounts.push(data.completed);

    // Calculate rolling average (last 3 sprints)
    const recentCompleted = completedCounts.slice(-3);
    const rollingAverage =
      recentCompleted.length > 0
        ? Math.round((recentCompleted.reduce((a, b) => a + b, 0) / recentCompleted.length) * 10) /
          10
        : 0;

    // Use display label if available, otherwise fall back to ID
    const sprintLabel = sprintLabels.get(sprintId) || sprintId;

    sprints.push({
      sprint: sprintLabel,
      completed: data.completed,
      total: data.total,
      rollingAverage,
      byType: data.byType,
    });
  }

  // Calculate overall metrics
  const totalCompleted = completedCounts.reduce((a, b) => a + b, 0);
  const averageVelocity =
    sprints.length > 0 ? Math.round((totalCompleted / sprints.length) * 10) / 10 : 0;

  // Determine trend (comparing last 3 vs previous 3)
  let trend: VelocityTrend = 'steady';
  if (sprints.length >= 4) {
    const recentSprints = sprints.slice(-3);
    const previousSprints = sprints.slice(-6, -3);

    if (previousSprints.length >= 2) {
      const recentAvg = recentSprints.reduce((a, b) => a + b.completed, 0) / recentSprints.length;
      const previousAvg =
        previousSprints.reduce((a, b) => a + b.completed, 0) / previousSprints.length;

      const changePercent = previousAvg > 0 ? ((recentAvg - previousAvg) / previousAvg) * 100 : 0;

      if (changePercent > 10) {
        trend = 'accelerating';
      } else if (changePercent < -10) {
        trend = 'slowing';
      }
    }
  }

  // Get current sprint progress (find sprints with incomplete tasks)
  let currentSprint: CurrentSprintProgress | undefined;
  for (const [sprintId, data] of [...sprintData.entries()].reverse()) {
    if (data.completed < data.total) {
      // Use display label if available
      const sprintLabel = sprintLabels.get(sprintId) || sprintId;
      currentSprint = {
        sprint: sprintLabel,
        completed: data.completed,
        total: data.total,
        percentComplete: data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0,
        vsAverage:
          averageVelocity > 0
            ? Math.round(((data.completed - averageVelocity) / averageVelocity) * 100)
            : 0,
      };
      break;
    }
  }

  return {
    sprints,
    averageVelocity,
    trend,
    currentSprint,
  };
}

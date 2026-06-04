import type { Task } from '@veritas-kanban/shared';
import { getTaskService } from './task-service.js';
import { StatusHistoryService } from './status-history-service.js';
import type {
  TimelineResponse,
  TaskTimeline,
  ParallelismSnapshot,
  MetricsResponse,
  AgentPeriod,
  TimelineQuery,
  MetricsQuery,
} from '../schemas/analytics-schemas.js';

/**
 * Time period with task info
 */
interface TimePeriod {
  startTime: number; // timestamp in ms
  endTime: number;
  taskId: string;
  agent?: string;
}

/**
 * Analytics Service
 *
 * Aggregates data from time tracking and status history to compute:
 * - Timeline views (Gantt-style visualization data)
 * - Parallelism metrics (concurrent tasks over time)
 * - Lead time and throughput metrics
 * - Agent utilization
 */
export class AnalyticsService {
  private taskService = getTaskService();
  private statusHistoryService = new StatusHistoryService();

  /**
   * Get timeline data for tasks
   *
   * Aggregates time tracking data from tasks, calculates overlaps,
   * and determines parallelism at each point in time.
   */
  async getTimeline(query: TimelineQuery): Promise<TimelineResponse> {
    const taskService = this.taskService;
    const allTasks = await taskService.listTasks();

    // Determine time window (default: all tracked time)
    let from: Date;
    let to: Date;

    if (query.from && query.to) {
      from = new Date(query.from);
      to = new Date(query.to);
    } else {
      // Find the earliest and latest time entries across all tasks
      const timeRanges = allTasks
        .filter((t) => t.timeTracking?.entries && t.timeTracking.entries.length > 0)
        .map((t) => {
          const entries = t.timeTracking!.entries;
          const start = new Date(entries[0].startTime);
          const lastEntry = entries[entries.length - 1];
          const end = lastEntry.endTime ? new Date(lastEntry.endTime) : new Date();
          return { start, end };
        });

      if (timeRanges.length === 0) {
        // No time entries - return empty timeline for current day
        from = new Date();
        from.setHours(0, 0, 0, 0);
        to = new Date();
        to.setHours(23, 59, 59, 999);
      } else {
        const starts = timeRanges.map((r) => r.start.getTime());
        const ends = timeRanges.map((r) => r.end.getTime());
        from = new Date(Math.min(...starts));
        to = new Date(Math.max(...ends));
      }
    }

    // Filter tasks by criteria
    let tasks = allTasks;

    if (query.project) {
      tasks = tasks.filter((t) => t.project === query.project);
    }

    if (query.sprint) {
      tasks = tasks.filter((t) => t.sprint === query.sprint);
    }

    if (query.agent) {
      tasks = tasks.filter((t) => t.agent === query.agent);
    }

    // Build task timelines
    const taskTimelines: TaskTimeline[] = tasks
      .filter((t) => t.timeTracking?.entries && t.timeTracking.entries.length > 0)
      .map((task) => this.buildTaskTimeline(task, from, to));

    // Calculate parallelism over time
    const parallelism = this.calculateParallelism(taskTimelines, from, to);

    return {
      period: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
      tasks: taskTimelines,
      parallelism,
      summary: {
        totalTasks: taskTimelines.length,
        maxConcurrency:
          parallelism.length > 0 ? Math.max(...parallelism.map((p) => p.concurrentTaskCount)) : 0,
        averageConcurrency:
          parallelism.length > 0
            ? parallelism.reduce((sum, p) => sum + p.concurrentTaskCount, 0) / parallelism.length
            : 0,
        timelineStartTime: taskTimelines.length > 0 ? from.toISOString() : undefined,
        timelineEndTime: taskTimelines.length > 0 ? to.toISOString() : undefined,
      },
    };
  }

  /**
   * Get aggregate metrics for a time period or sprint
   */
  async getMetrics(query: MetricsQuery): Promise<MetricsResponse> {
    const taskService = this.taskService;
    let allTasks = await taskService.listTasks();

    // Filter by sprint and project
    if (query.sprint) {
      allTasks = allTasks.filter((t) => t.sprint === query.sprint);
    }

    if (query.project) {
      allTasks = allTasks.filter((t) => t.project === query.project);
    }

    // Determine time window
    let from: Date;
    let to: Date;

    if (query.from && query.to) {
      from = new Date(query.from);
      to = new Date(query.to);
    } else {
      // Default: last 30 days
      to = new Date();
      from = new Date(to);
      from.setDate(from.getDate() - 30);
    }

    // Calculate metrics from tasks
    const tasksWithTime = allTasks.filter(
      (t) => t.timeTracking?.entries && t.timeTracking.entries.length > 0
    );

    // Build time periods from all tasks
    const timePeriods: TimePeriod[] = [];
    for (const task of tasksWithTime) {
      const entries = task.timeTracking!.entries;
      for (const entry of entries) {
        const startMs = new Date(entry.startTime).getTime();
        // Handle active entries (no endTime)
        const endMs = entry.endTime
          ? new Date(entry.endTime).getTime()
          : startMs + (entry.duration || 0) * 1000;

        timePeriods.push({
          startTime: startMs,
          endTime: endMs,
          taskId: task.id,
          agent: task.agent,
        });
      }
    }

    // Calculate parallelism
    const parallelism = this.calculateParallelismMetrics(timePeriods, from, to);

    // Calculate throughput and lead time
    const doneTasksInPeriod = allTasks.filter((t) => {
      if (t.status !== 'done' || !t.updated) return false;
      const updatedTime = new Date(t.updated).getTime();
      return updatedTime >= from.getTime() && updatedTime <= to.getTime();
    });

    const createdTasksInPeriod = allTasks.filter((t) => {
      if (!t.created) return false;
      const createdTime = new Date(t.created).getTime();
      return createdTime >= from.getTime() && createdTime <= to.getTime();
    });

    // Calculate lead times
    const leadTimes = doneTasksInPeriod
      .map((t) => {
        if (!t.created || !t.updated) return null;
        const created = new Date(t.created).getTime();
        const updated = new Date(t.updated).getTime();
        return updated - created;
      })
      .filter((v) => v !== null) as number[];

    const fromTodoToDone =
      leadTimes.length > 0 ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length : 0;

    // Calculate agent utilization
    const agentPeriods = this.calculateAgentUtilization(tasksWithTime);

    // Total tracked time
    const totalTrackedTime =
      timePeriods.reduce((sum, p) => sum + (p.endTime - p.startTime), 0) / 1000;

    // Efficiency metrics
    const totalPeriodSeconds = (to.getTime() - from.getTime()) / 1000;

    return {
      period: {
        from: from.toISOString(),
        to: to.toISOString(),
        sprint: query.sprint,
      },
      parallelism: {
        averageConcurrency: parallelism.average,
        maxConcurrency: parallelism.max,
        minConcurrency: parallelism.min,
      },
      throughput: {
        tasksCompleted: doneTasksInPeriod.length,
        tasksCreated: createdTasksInPeriod.length,
        averageCompletionTime: leadTimes.length > 0 ? fromTodoToDone / 1000 : 0,
      },
      leadTime: {
        fromTodoToDone: fromTodoToDone / 1000,
        fromCreatedToStarted: 0, // Would require status history
        fromStartedToDone: 0, // Would require status history
      },
      agentUtilization: agentPeriods,
      efficiency: {
        totalTrackedTime,
        totalTaskCount: tasksWithTime.length,
        averageTimePerTask: tasksWithTime.length > 0 ? totalTrackedTime / tasksWithTime.length : 0,
        utilizationRate:
          totalPeriodSeconds > 0 ? Math.min(1, totalTrackedTime / totalPeriodSeconds) : 0,
      },
    };
  }

  /**
   * Build a task timeline from its time entries
   */
  private buildTaskTimeline(task: Task, windowStart: Date, windowEnd: Date): TaskTimeline {
    const entries = task.timeTracking?.entries || [];

    // Filter entries within window
    const relevantEntries = entries.filter(
      (e: {
        id: string;
        startTime: string;
        endTime?: string;
        duration?: number;
        description?: string;
        manual?: boolean;
      }) => {
        const startMs = new Date(e.startTime).getTime();
        const endMs = e.endTime
          ? new Date(e.endTime).getTime()
          : startMs + (e.duration || 0) * 1000;
        return startMs < windowEnd.getTime() && endMs > windowStart.getTime();
      }
    );

    let startTime: string | undefined;
    let endTime: string | undefined;

    if (relevantEntries.length > 0) {
      startTime = relevantEntries[0].startTime;
      const lastEntry = relevantEntries[relevantEntries.length - 1];
      endTime =
        lastEntry.endTime ||
        new Date(
          new Date(lastEntry.startTime).getTime() + (lastEntry.duration || 0) * 1000
        ).toISOString();
    }

    const totalDurationSeconds = task.timeTracking?.totalSeconds || 0;

    return {
      id: task.id,
      title: task.title,
      project: task.project,
      sprint: task.sprint,
      agent: task.agent,
      status: task.status,
      startTime,
      endTime,
      durationSeconds: totalDurationSeconds,
      timeEntries: relevantEntries.map(
        (e: {
          id: string;
          startTime: string;
          endTime?: string;
          duration?: number;
          description?: string;
          manual?: boolean;
        }) => ({
          id: e.id,
          startTime: e.startTime,
          endTime: e.endTime,
          duration: e.duration,
          description: e.description,
        })
      ),
    };
  }

  /**
   * Calculate parallelism (concurrent tasks) from task timelines
   *
   * Returns snapshots showing how many tasks were running at specific times
   */
  private calculateParallelism(
    taskTimelines: TaskTimeline[],
    from: Date,
    to: Date
  ): ParallelismSnapshot[] {
    if (taskTimelines.length === 0) return [];

    // Collect all time points (start and end of each entry)
    const timePoints = new Set<number>();

    for (const task of taskTimelines) {
      for (const entry of task.timeEntries) {
        timePoints.add(new Date(entry.startTime).getTime());
        if (entry.endTime) {
          timePoints.add(new Date(entry.endTime).getTime());
        }
      }
    }

    // Add window boundaries
    timePoints.add(from.getTime());
    timePoints.add(to.getTime());

    // Sort time points and create snapshots
    const sortedTimes = Array.from(timePoints).sort((a, b) => a - b);
    const snapshots: ParallelismSnapshot[] = [];

    for (let i = 0; i < sortedTimes.length - 1; i++) {
      const timestamp = new Date(sortedTimes[i]);
      const timeMs = timestamp.getTime();

      // Find all tasks active at this time
      const activeTasks = taskTimelines.filter((task) => {
        return task.timeEntries.some((entry) => {
          const startMs = new Date(entry.startTime).getTime();
          const endMs = entry.endTime
            ? new Date(entry.endTime).getTime()
            : startMs + (entry.duration || 0) * 1000;
          return startMs <= timeMs && endMs > timeMs;
        });
      });

      if (activeTasks.length > 0) {
        snapshots.push({
          timestamp: timestamp.toISOString(),
          concurrentTaskCount: activeTasks.length,
          taskIds: activeTasks.map((t) => t.id),
        });
      }
    }

    return snapshots;
  }

  /**
   * Calculate parallelism metrics (average, max, min concurrent tasks)
   */
  private calculateParallelismMetrics(timePeriods: TimePeriod[], from: Date, to: Date) {
    if (timePeriods.length === 0) {
      return { average: 0, max: 0, min: 0 };
    }

    // Collect time points
    const timePoints = new Set<number>();

    for (const period of timePeriods) {
      timePoints.add(period.startTime);
      timePoints.add(period.endTime);
    }

    timePoints.add(from.getTime());
    timePoints.add(to.getTime());

    // Sample at intervals (5-minute intervals for performance)
    const sampleInterval = 5 * 60 * 1000; // 5 minutes
    const startMs = from.getTime();
    const endMs = to.getTime();

    const concurrencyCounts: number[] = [];

    for (let timeMs = startMs; timeMs <= endMs; timeMs += sampleInterval) {
      const count = timePeriods.filter((p) => p.startTime <= timeMs && p.endTime > timeMs).length;
      concurrencyCounts.push(count);
    }

    const average =
      concurrencyCounts.length > 0
        ? concurrencyCounts.reduce((a, b) => a + b, 0) / concurrencyCounts.length
        : 0;
    const max = concurrencyCounts.length > 0 ? Math.max(...concurrencyCounts) : 0;
    const min = concurrencyCounts.length > 0 ? Math.min(...concurrencyCounts) : 0;

    return { average, max, min };
  }

  /**
   * Calculate agent utilization (working time per agent)
   */
  private calculateAgentUtilization(tasks: Task[]): AgentPeriod[] {
    const agentMap = new Map<
      string,
      { startTime: number; endTime: number; totalDuration: number; taskCount: number }
    >();

    for (const task of tasks) {
      const agent = task.agent || 'unknown';
      const entries = task.timeTracking?.entries || [];

      for (const entry of entries) {
        const startMs = new Date(entry.startTime).getTime();
        const endMs = entry.endTime
          ? new Date(entry.endTime).getTime()
          : startMs + (entry.duration || 0) * 1000;
        const duration = endMs - startMs;

        if (!agentMap.has(agent)) {
          agentMap.set(agent, {
            startTime: startMs,
            endTime: endMs,
            totalDuration: duration,
            taskCount: 1,
          });
        } else {
          const existing = agentMap.get(agent)!;
          existing.startTime = Math.min(existing.startTime, startMs);
          existing.endTime = Math.max(existing.endTime, endMs);
          existing.totalDuration += duration;
          existing.taskCount += 1;
        }
      }
    }

    return Array.from(agentMap.entries()).map(([agent, data]) => ({
      agent,
      startTime: new Date(data.startTime).toISOString(),
      endTime: new Date(data.endTime).toISOString(),
      durationSeconds: Math.round(data.totalDuration / 1000),
      tasksCompleted: data.taskCount,
      totalTaskDurationSeconds: Math.round(data.totalDuration / 1000),
    }));
  }
}

// Singleton instance
let analyticsService: AnalyticsService | null = null;

export function getAnalyticsService(): AnalyticsService {
  if (!analyticsService) {
    analyticsService = new AnalyticsService();
  }
  return analyticsService;
}

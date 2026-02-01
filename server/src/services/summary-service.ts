/**
 * Summary Service
 *
 * Handles task aggregation and summary generation logic.
 * Extracted from summary.ts route to separate business logic from HTTP concerns.
 */

import type { Task, Comment } from '@veritas-kanban/shared';
import { formatDuration, formatDate } from '@veritas-kanban/shared';
import type { Activity } from './activity-service.js';

export interface StatusCounts {
  todo: number;
  'in-progress': number;
  blocked: number;
  done: number;
}

export interface ProjectStats {
  total: number;
  done: number;
  inProgress: number;
}

export interface TaskSummary {
  id: string;
  title: string;
  status: string;
  project?: string;
}

export interface OverallSummary {
  total: number;
  byStatus: StatusCounts;
  byProject: Record<string, ProjectStats>;
  highPriority: TaskSummary[];
}

export interface RecentActivity {
  completed: {
    id: string;
    title: string;
    project?: string;
    priority: string;
    completedAt: string;
    automation?: Task['automation'];
  }[];
  highPriorityActive: {
    id: string;
    title: string;
    status: string;
    project?: string;
  }[];
  period: {
    hours: number;
    since: string;
  };
}

export interface ProjectProgress {
  name: string;
  total: number;
  done: number;
  percent: number;
}

export class SummaryService {
  // ============ Aggregation Logic ============

  /**
   * Get overall task summary with status counts, project breakdown, and high-priority items
   */
  getOverallSummary(tasks: Task[]): OverallSummary {
    const byStatus: StatusCounts = {
      todo: tasks.filter((t) => t.status === 'todo').length,
      'in-progress': tasks.filter((t) => t.status === 'in-progress').length,
      blocked: tasks.filter((t) => t.status === 'blocked').length,
      done: tasks.filter((t) => t.status === 'done').length,
    };

    const byProject: Record<string, ProjectStats> = {};
    tasks.forEach((task) => {
      const project = task.project || 'unassigned';
      if (!byProject[project]) {
        byProject[project] = { total: 0, done: 0, inProgress: 0 };
      }
      byProject[project].total++;
      if (task.status === 'done') byProject[project].done++;
      if (task.status === 'in-progress') byProject[project].inProgress++;
    });

    const highPriority = tasks
      .filter((t) => t.priority === 'high' && t.status !== 'done')
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        project: t.project,
      }));

    return {
      total: tasks.length,
      byStatus,
      byProject,
      highPriority,
    };
  }

  /**
   * Get recently completed and active high-priority tasks
   */
  getRecentActivity(tasks: Task[], hours: number = 24): RecentActivity {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Find tasks completed recently (status=done and updated within timeframe)
    const completed = tasks
      .filter((task) => {
        if (task.status !== 'done') return false;
        const updated = new Date(task.updated);
        return updated >= cutoff;
      })
      .map((t) => ({
        id: t.id,
        title: t.title,
        project: t.project,
        priority: t.priority,
        completedAt: t.updated,
        automation: t.automation,
      }));

    // High-priority tasks that moved to in-progress or review
    const highPriorityActive = tasks
      .filter((task) => {
        if (task.priority !== 'high') return false;
        if (task.status === 'todo' || task.status === 'done') return false;
        const updated = new Date(task.updated);
        return updated >= cutoff;
      })
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        project: t.project,
      }));

    return {
      completed,
      highPriorityActive,
      period: {
        hours,
        since: cutoff.toISOString(),
      },
    };
  }

  /**
   * Get project progress statistics
   */
  getProjectProgress(tasks: Task[]): ProjectProgress[] {
    const byProject: Record<string, { total: number; done: number }> = {};

    tasks.forEach((task) => {
      const project = task.project || 'unassigned';
      if (!byProject[project]) {
        byProject[project] = { total: 0, done: 0 };
      }
      byProject[project].total++;
      if (task.status === 'done') byProject[project].done++;
    });

    return Object.entries(byProject)
      .filter(([_, stats]) => stats.total > 1)
      .map(([name, stats]) => ({
        name,
        total: stats.total,
        done: stats.done,
        percent: Math.round((stats.done / stats.total) * 100),
      }));
  }

  // ============ Memory Formatting ============

  /**
   * Generate markdown summary for memory file sync
   */
  generateMemoryMarkdown(tasks: Task[], hours: number = 24): string {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Completed tasks
    const completed = tasks.filter((task) => {
      if (task.status !== 'done') return false;
      const updated = new Date(task.updated);
      return updated >= cutoff;
    });

    // Active high-priority
    const highPriority = tasks.filter(
      (t) => t.priority === 'high' && (t.status === 'in-progress' || t.status === 'blocked')
    );

    // Build markdown
    let markdown = '';

    if (completed.length > 0) {
      markdown += '### Veritas Kanban - Completed Tasks\n\n';
      completed.forEach((task) => {
        const projectTag = task.project ? ` (${task.project})` : '';
        const priorityTag = task.priority === 'high' ? ' 🔴' : '';
        markdown += `- ✅ ${task.title}${projectTag}${priorityTag}\n`;
        if (task.automation?.result) {
          markdown += `  - Result: ${task.automation.result}\n`;
        }
      });
      markdown += '\n';
    }

    if (highPriority.length > 0) {
      markdown += '### Active High-Priority Tasks\n\n';
      highPriority.forEach((task) => {
        const projectTag = task.project ? ` (${task.project})` : '';
        const statusIcon = task.status === 'in-progress' ? '🔄' : '👀';
        markdown += `- ${statusIcon} ${task.title}${projectTag} [${task.status}]\n`;
      });
      markdown += '\n';
    }

    // Project progress
    const projectProgress = this.getProjectProgress(tasks);

    if (projectProgress.length > 0) {
      markdown += '### Project Progress\n\n';
      projectProgress.forEach((p) => {
        markdown += `- **${p.name}**: ${p.done}/${p.total} (${p.percent}%)\n`;
      });
    }

    return markdown || 'No recent kanban activity.\n';
  }

  // ============ Standup Generation ============

  /**
   * Helper: Check if a date string falls on the target date
   */
  private isOnDate(dateStr: string, targetDate: Date): boolean {
    const d = new Date(dateStr);
    return (
      d.getFullYear() === targetDate.getFullYear() &&
      d.getMonth() === targetDate.getMonth() &&
      d.getDate() === targetDate.getDate()
    );
  }

  /**
   * Helper: Calculate time spent on a task for a specific date.
   * Considers time entries that overlap with the target date.
   */
  private getTimeSpentOnDate(task: Task, targetDate: Date): number {
    if (!task.timeTracking?.entries) return 0;

    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    let totalSeconds = 0;

    for (const entry of task.timeTracking.entries) {
      const entryStart = new Date(entry.startTime);

      // For running entries, use now as end time
      const entryEnd = entry.endTime ? new Date(entry.endTime) : new Date();

      // Check if entry overlaps with the target date
      if (entryStart > dayEnd || entryEnd < dayStart) continue;

      // Calculate overlap duration
      const overlapStart = entryStart < dayStart ? dayStart : entryStart;
      const overlapEnd = entryEnd > dayEnd ? dayEnd : entryEnd;
      const overlapSeconds = Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / 1000);

      totalSeconds += Math.max(0, overlapSeconds);
    }

    return totalSeconds;
  }

  /**
   * Get standup data for a specific date
   */
  getStandupData(tasks: Task[], activities: Activity[], targetDate: Date): StandupData {
    const dateStr = targetDate.toISOString().slice(0, 10);

    // Tasks completed on target date (status=done AND updated on that date)
    const completed: StandupTask[] = tasks
      .filter((t) => t.status === 'done' && this.isOnDate(t.updated, targetDate))
      .map((t) => ({
        id: t.id,
        title: t.title,
        agent: t.agent || undefined,
        completedAt: t.updated,
        timeSpent: this.getTimeSpentOnDate(t, targetDate) || (t.timeTracking?.totalSeconds ?? 0),
      }));

    // Tasks currently in progress (updated on or before target date)
    const inProgress: StandupInProgress[] = tasks
      .filter((t) => t.status === 'in-progress')
      .map((t) => ({
        id: t.id,
        title: t.title,
        agent: t.agent || undefined,
        started: t.created,
      }));

    // Blocked tasks
    const blocked: StandupBlocked[] = tasks
      .filter((t) => t.status === 'blocked')
      .map((t) => ({
        id: t.id,
        title: t.title,
        agent: t.agent || undefined,
        reason: t.blockedReason?.note || t.blockedReason?.category || 'No reason specified',
      }));

    // Upcoming tasks (todo, sorted by priority)
    const priorityOrder: Record<string, number> = {
      high: 0,
      medium: 1,
      low: 2,
    };
    const upcoming: StandupUpcoming[] = tasks
      .filter((t) => t.status === 'todo')
      .sort((a, b) => (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1))
      .slice(0, 10) // Limit to top 10 upcoming
      .map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
      }));

    // Filter activities for the target date
    const dayActivities: StandupActivity[] = activities
      .filter((a) => this.isOnDate(a.timestamp, targetDate))
      .map((a) => ({
        type: a.type,
        summary: `${a.type.replace(/_/g, ' ')}: ${a.taskTitle}`,
        timestamp: a.timestamp,
      }));

    // Calculate total time tracked across all tasks for target date
    let totalTimeSeconds = 0;
    for (const task of tasks) {
      totalTimeSeconds += this.getTimeSpentOnDate(task, targetDate);
    }

    // Count comments added on target date
    let commentsAdded = 0;
    for (const task of tasks) {
      if (task.comments) {
        commentsAdded += task.comments.filter((c: Comment) =>
          this.isOnDate(c.timestamp, targetDate)
        ).length;
      }
    }

    // Collect unique active agents
    const agentsActive = [
      ...new Set(
        [...completed, ...inProgress, ...blocked]
          .map((t) => t.agent)
          .filter((a): a is string => !!a)
      ),
    ];

    const stats: StandupStats = {
      tasksCompleted: completed.length,
      totalTimeTracked: formatDuration(totalTimeSeconds),
      agentsActive,
      commentsAdded,
    };

    return {
      date: dateStr,
      completed,
      inProgress,
      blocked,
      upcoming,
      activity: dayActivities,
      stats,
    };
  }

  /**
   * Generate a markdown standup report
   */
  generateStandupMarkdown(standupData: StandupData): string {
    const date = new Date(standupData.date + 'T00:00:00');
    const dateLabel = formatDate(date, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const lines: string[] = [];
    lines.push(`# Daily Standup — ${dateLabel}`);
    lines.push('');

    // Completed
    if (standupData.completed.length > 0) {
      lines.push('## ✅ Completed');
      for (const task of standupData.completed) {
        const agent = task.agent ? ` — ${task.agent}` : '';
        const time = task.timeSpent ? ` (${formatDuration(task.timeSpent)})` : '';
        lines.push(`- **${task.id}: ${task.title}**${agent}${time}`);
      }
      lines.push('');
    }

    // In Progress
    if (standupData.inProgress.length > 0) {
      lines.push('## 🔄 In Progress');
      for (const task of standupData.inProgress) {
        const agent = task.agent ? ` — ${task.agent}` : '';
        lines.push(`- **${task.id}: ${task.title}**${agent}`);
      }
      lines.push('');
    }

    // Blocked
    if (standupData.blocked.length > 0) {
      lines.push('## 🚫 Blocked');
      for (const task of standupData.blocked) {
        const agent = task.agent ? ` — ${task.agent},` : ' —';
        lines.push(`- **${task.id}: ${task.title}**${agent} ${task.reason}`);
      }
      lines.push('');
    }

    // Upcoming (only show if there are upcoming tasks)
    if (standupData.upcoming.length > 0) {
      lines.push('## 📋 Up Next');
      for (const task of standupData.upcoming) {
        const priority = task.priority === 'high' ? ' 🔴' : task.priority === 'low' ? ' 🟢' : '';
        lines.push(`- **${task.id}: ${task.title}**${priority}`);
      }
      lines.push('');
    }

    // Stats
    lines.push('## 📊 Stats');
    lines.push(`- Tasks completed: ${standupData.stats.tasksCompleted}`);
    lines.push(`- Time tracked: ${standupData.stats.totalTimeTracked}`);
    if (standupData.stats.agentsActive.length > 0) {
      lines.push(`- Agents active: ${standupData.stats.agentsActive.join(', ')}`);
    }
    if (standupData.stats.commentsAdded > 0) {
      lines.push(`- Comments added: ${standupData.stats.commentsAdded}`);
    }
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Generate a plain text standup report (no markdown formatting)
   */
  generateStandupText(standupData: StandupData): string {
    const date = new Date(standupData.date + 'T00:00:00');
    const dateLabel = formatDate(date, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const lines: string[] = [];
    lines.push(`DAILY STANDUP — ${dateLabel}`);
    lines.push('='.repeat(40));
    lines.push('');

    if (standupData.completed.length > 0) {
      lines.push('COMPLETED:');
      for (const task of standupData.completed) {
        const agent = task.agent ? ` (${task.agent})` : '';
        const time = task.timeSpent ? ` [${formatDuration(task.timeSpent)}]` : '';
        lines.push(`  * ${task.id}: ${task.title}${agent}${time}`);
      }
      lines.push('');
    }

    if (standupData.inProgress.length > 0) {
      lines.push('IN PROGRESS:');
      for (const task of standupData.inProgress) {
        const agent = task.agent ? ` (${task.agent})` : '';
        lines.push(`  * ${task.id}: ${task.title}${agent}`);
      }
      lines.push('');
    }

    if (standupData.blocked.length > 0) {
      lines.push('BLOCKED:');
      for (const task of standupData.blocked) {
        lines.push(`  * ${task.id}: ${task.title} - ${task.reason}`);
      }
      lines.push('');
    }

    if (standupData.upcoming.length > 0) {
      lines.push('UP NEXT:');
      for (const task of standupData.upcoming) {
        lines.push(`  * ${task.id}: ${task.title} [${task.priority}]`);
      }
      lines.push('');
    }

    lines.push('STATS:');
    lines.push(`  Tasks completed: ${standupData.stats.tasksCompleted}`);
    lines.push(`  Time tracked: ${standupData.stats.totalTimeTracked}`);
    if (standupData.stats.agentsActive.length > 0) {
      lines.push(`  Agents active: ${standupData.stats.agentsActive.join(', ')}`);
    }
    if (standupData.stats.commentsAdded > 0) {
      lines.push(`  Comments added: ${standupData.stats.commentsAdded}`);
    }
    lines.push('');

    return lines.join('\n');
  }
}

// ============ Standup Types ============

export interface StandupTask {
  id: string;
  title: string;
  agent?: string;
  completedAt: string;
  timeSpent: number; // seconds
}

export interface StandupInProgress {
  id: string;
  title: string;
  agent?: string;
  started: string;
}

export interface StandupBlocked {
  id: string;
  title: string;
  agent?: string;
  reason: string;
}

export interface StandupUpcoming {
  id: string;
  title: string;
  priority: string;
}

export interface StandupActivity {
  type: string;
  summary: string;
  timestamp: string;
}

export interface StandupStats {
  tasksCompleted: number;
  totalTimeTracked: string;
  agentsActive: string[];
  commentsAdded: number;
}

export interface StandupData {
  date: string;
  completed: StandupTask[];
  inProgress: StandupInProgress[];
  blocked: StandupBlocked[];
  upcoming: StandupUpcoming[];
  activity: StandupActivity[];
  stats: StandupStats;
}

// Singleton instance
let instance: SummaryService | null = null;

export function getSummaryService(): SummaryService {
  if (!instance) {
    instance = new SummaryService();
  }
  return instance;
}

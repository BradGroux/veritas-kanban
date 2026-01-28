import {
  getMetricsService,
  type MetricsService,
  type TaskMetrics,
  type RunMetrics,
  type TokenMetrics,
} from './metrics/index.js';
import { getTelemetryService, type TelemetryService } from './telemetry-service.js';
import { TaskService } from './task-service.js';
import type { Task, TaskTelemetryEvent } from '@veritas-kanban/shared';

export interface DailyDigest {
  period: {
    start: string;
    end: string;
  };
  hasActivity: boolean;

  // Task stats
  tasks: {
    completed: number;
    created: number;
    inProgress: number;
    blocked: number;
    total: number;
    completedTitles: string[]; // Top accomplishments
    blockedTitles: string[]; // Blocked items
  };

  // Agent run stats
  runs: {
    total: number;
    successes: number;
    failures: number;
    errors: number;
    successRate: number;
    byAgent: Array<{
      agent: string;
      runs: number;
      successRate: number;
    }>;
  };

  // Token usage stats
  tokens: {
    total: number;
    input: number;
    output: number;
    byAgent: Array<{
      agent: string;
      total: number;
    }>;
  };

  // Failures and issues
  issues: {
    failedRuns: Array<{
      agent: string;
      taskId?: string;
      error?: string;
      timestamp: string;
    }>;
  };
}

export interface DigestTeamsMessage {
  markdown: string;
  isEmpty: boolean;
}

/**
 * Service for generating daily digest summaries
 */
export class DigestService {
  private metrics: MetricsService;
  private telemetry: TelemetryService;
  private taskService: TaskService;

  constructor() {
    this.metrics = getMetricsService();
    this.telemetry = getTelemetryService();
    this.taskService = new TaskService();
  }

  /**
   * Get timestamp for 24 hours ago
   */
  private get24hAgo(): string {
    const now = new Date();
    now.setHours(now.getHours() - 24);
    return now.toISOString();
  }

  /**
   * Generate the daily digest data
   */
  async generateDigest(): Promise<DailyDigest> {
    const since = this.get24hAgo();
    const now = new Date().toISOString();

    // Get metrics from metrics service
    const [metricsData, failedRuns, events] = await Promise.all([
      this.metrics.getAllMetrics('24h'),
      this.metrics.getFailedRuns('24h', undefined, 10),
      this.telemetry.getEvents({ since, limit: 1000 }),
    ]);

    // Get task events from last 24h
    const taskEvents = events.filter(
      (e) => e.type === 'task.created' || e.type === 'task.status_changed'
    ) as TaskTelemetryEvent[];

    // Count task changes
    const createdCount = taskEvents.filter((e) => e.type === 'task.created').length;
    const completedCount = taskEvents.filter(
      (e) => e.type === 'task.status_changed' && e.status === 'done'
    ).length;

    // Get current task list for titles
    const allTasks = await this.taskService.listTasks();

    // Get recently completed tasks (status is done and updated in last 24h)
    const recentlyCompleted = allTasks.filter(
      (t) => t.status === 'done' && new Date(t.updated).toISOString() >= since
    );

    // Get blocked tasks
    const blockedTasks = allTasks.filter((t) => t.status === 'blocked');

    // Get in-progress tasks
    const inProgressTasks = allTasks.filter((t) => t.status === 'in-progress');

    // Determine if there's any activity
    const hasActivity =
      createdCount > 0 ||
      completedCount > 0 ||
      metricsData.runs.runs > 0 ||
      metricsData.tokens.totalTokens > 0;

    return {
      period: {
        start: since,
        end: now,
      },
      hasActivity,
      tasks: {
        completed: completedCount,
        created: createdCount,
        inProgress: inProgressTasks.length,
        blocked: blockedTasks.length,
        total: allTasks.length,
        completedTitles: recentlyCompleted.slice(0, 5).map((t) => t.title),
        blockedTitles: blockedTasks.slice(0, 5).map((t) => t.title),
      },
      runs: {
        total: metricsData.runs.runs,
        successes: metricsData.runs.successes,
        failures: metricsData.runs.failures,
        errors: metricsData.runs.errors,
        successRate: metricsData.runs.successRate,
        byAgent: metricsData.runs.byAgent.map((a) => ({
          agent: a.agent,
          runs: a.runs,
          successRate: a.successRate,
        })),
      },
      tokens: {
        total: metricsData.tokens.totalTokens,
        input: metricsData.tokens.inputTokens,
        output: metricsData.tokens.outputTokens,
        byAgent: metricsData.tokens.byAgent.map((a) => ({
          agent: a.agent,
          total: a.totalTokens,
        })),
      },
      issues: {
        failedRuns: failedRuns.slice(0, 5).map((r) => ({
          agent: r.agent,
          taskId: r.taskId,
          error: r.errorMessage,
          timestamp: r.timestamp,
        })),
      },
    };
  }

  /**
   * Format the digest as Teams markdown
   */
  formatForTeams(digest: DailyDigest): DigestTeamsMessage {
    if (!digest.hasActivity) {
      return {
        markdown: '',
        isEmpty: true,
      };
    }

    const lines: string[] = [];

    // Header
    const startDate = new Date(digest.period.start).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
    lines.push(`# 📊 Daily Digest - ${startDate}`);
    lines.push('');

    // Task Summary
    lines.push('## 📋 Tasks');
    lines.push(`- ✅ **Completed:** ${digest.tasks.completed}`);
    lines.push(`- 🆕 **Created:** ${digest.tasks.created}`);
    lines.push(`- 🔄 **In Progress:** ${digest.tasks.inProgress}`);
    if (digest.tasks.blocked > 0) {
      lines.push(`- 🚫 **Blocked:** ${digest.tasks.blocked}`);
    }
    lines.push('');

    // Top Accomplishments
    if (digest.tasks.completedTitles.length > 0) {
      lines.push('### 🏆 Accomplishments');
      digest.tasks.completedTitles.forEach((title) => {
        lines.push(`- ${title}`);
      });
      lines.push('');
    }

    // Agent Runs
    if (digest.runs.total > 0) {
      lines.push('## 🤖 Agent Runs');
      const successPct = (digest.runs.successRate * 100).toFixed(0);
      lines.push(`- **Total:** ${digest.runs.total} runs`);
      lines.push(`- **Success Rate:** ${successPct}%`);

      if (digest.runs.byAgent.length > 0) {
        lines.push('- **By Agent:**');
        digest.runs.byAgent.forEach((a) => {
          const pct = (a.successRate * 100).toFixed(0);
          lines.push(`  - ${a.agent}: ${a.runs} runs (${pct}% success)`);
        });
      }
      lines.push('');
    }

    // Token Usage
    if (digest.tokens.total > 0) {
      lines.push('## 💰 Token Usage');
      const totalFormatted = this.formatNumber(digest.tokens.total);
      const inputFormatted = this.formatNumber(digest.tokens.input);
      const outputFormatted = this.formatNumber(digest.tokens.output);
      lines.push(`- **Total:** ${totalFormatted} tokens`);
      lines.push(`- **Input:** ${inputFormatted} | **Output:** ${outputFormatted}`);

      if (digest.tokens.byAgent.length > 0) {
        lines.push('- **By Agent:**');
        digest.tokens.byAgent.forEach((a) => {
          const formatted = this.formatNumber(a.total);
          lines.push(`  - ${a.agent}: ${formatted}`);
        });
      }
      lines.push('');
    }

    // Blocked Items
    if (digest.tasks.blockedTitles.length > 0) {
      lines.push('## 🚫 Blocked Items');
      digest.tasks.blockedTitles.forEach((title) => {
        lines.push(`- ${title}`);
      });
      lines.push('');
    }

    // Failed Runs
    if (digest.issues.failedRuns.length > 0) {
      lines.push('## ⚠️ Failed Runs');
      digest.issues.failedRuns.forEach((run) => {
        const time = new Date(run.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        });
        const taskPart = run.taskId ? ` (${run.taskId})` : '';
        const errorPart = run.error ? `: ${run.error.slice(0, 50)}...` : '';
        lines.push(`- ${time} - ${run.agent}${taskPart}${errorPart}`);
      });
      lines.push('');
    }

    return {
      markdown: lines.join('\n'),
      isEmpty: false,
    };
  }

  /**
   * Format number with K/M suffix
   */
  private formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }
}

// Singleton instance
let instance: DigestService | null = null;

export function getDigestService(): DigestService {
  if (!instance) {
    instance = new DigestService();
  }
  return instance;
}

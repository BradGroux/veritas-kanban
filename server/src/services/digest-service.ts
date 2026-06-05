import { getMetricsService, type MetricsService } from './metrics/index.js';
import { getTelemetryService, type TelemetryService } from './telemetry-service.js';
import { TaskService } from './task-service.js';
import { getAgentPermissionService, type ApprovalRequest } from './agent-permission-service.js';
import type {
  RunTelemetryEvent,
  Task,
  TaskTelemetryEvent,
  TokenTelemetryEvent,
} from '@veritas-kanban/shared';

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

export interface AgentOperationsDigestOptions {
  windowHours?: number;
  from?: string;
  to?: string;
  project?: string;
}

export interface AgentOperationsSourceLink {
  kind: 'approval' | 'run' | 'task' | 'telemetry';
  id: string;
  label: string;
  timestamp?: string;
  taskId?: string;
}

export interface AgentOperationsFailure extends AgentOperationsSourceLink {
  agent?: string;
  error?: string;
}

export interface AgentOperationsApproval extends AgentOperationsSourceLink {
  agent: string;
  action: string;
  details?: string;
}

export interface AgentOperationsDigestGroup {
  key: string;
  project: string;
  repo: string;
  cwd?: string;
  totals: {
    active: number;
    blocked: number;
    stuck: number;
    completed: number;
    failed: number;
    runs: number;
    tokenCost: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    wallTimeMs: number;
    activeTimeMs: number;
  };
  sourceLinks: {
    activeTasks: AgentOperationsSourceLink[];
    blockedTasks: AgentOperationsSourceLink[];
    stuckTasks: AgentOperationsSourceLink[];
    completedTasks: AgentOperationsSourceLink[];
    failedRuns: AgentOperationsSourceLink[];
    tokenEvents: AgentOperationsSourceLink[];
  };
  topPlanCompletions: AgentOperationsSourceLink[];
  notableFailures: AgentOperationsFailure[];
  openApprovals: AgentOperationsApproval[];
}

export interface AgentOperationsDigest {
  period: {
    start: string;
    end: string;
    windowHours: number;
  };
  generatedAt: string;
  hasActivity: boolean;
  groups: AgentOperationsDigestGroup[];
  totals: AgentOperationsDigestGroup['totals'] & {
    openApprovals: number;
    groups: number;
  };
  refresh: {
    manual: boolean;
    schedule: 'daily-ready';
    narrative: 'deterministic-only';
  };
}

export interface DigestMarkdownMessage {
  markdown: string;
  isEmpty: boolean;
}

const DEFAULT_OPERATIONS_WINDOW_HOURS = 24;
const MAX_OPERATIONS_WINDOW_HOURS = 24 * 30;
const STUCK_TASK_MS = 2 * 60 * 60 * 1000;

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
   * Generate a deterministic project/repo/cwd operations digest for standups and briefings.
   */
  async generateOperationsDigest(
    options: AgentOperationsDigestOptions = {}
  ): Promise<AgentOperationsDigest> {
    const period = resolveOperationsPeriod(options);
    const [tasks, events, approvals] = await Promise.all([
      this.taskService.listTasks(),
      this.telemetry.getEvents({
        since: period.start,
        until: period.end,
        type: ['run.completed', 'run.error', 'run.tokens'],
        project: options.project,
        limit: 10000,
      }),
      getAgentPermissionService().getPendingApprovals(),
    ]);

    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const groups = new Map<string, AgentOperationsDigestGroup>();
    const signalTimesByGroup = new Map<string, number[]>();

    const getGroup = (project: string | undefined, repo: string | undefined, cwd?: string) => {
      const normalizedProject = project || 'unassigned';
      const normalizedRepo = repo || 'unknown';
      const key = `${normalizedProject}::${normalizedRepo}::${cwd ?? ''}`;
      const existing = groups.get(key);
      if (existing) return existing;

      const group: AgentOperationsDigestGroup = {
        key,
        project: normalizedProject,
        repo: normalizedRepo,
        cwd,
        totals: emptyOperationsTotals(),
        sourceLinks: {
          activeTasks: [],
          blockedTasks: [],
          stuckTasks: [],
          completedTasks: [],
          failedRuns: [],
          tokenEvents: [],
        },
        topPlanCompletions: [],
        notableFailures: [],
        openApprovals: [],
      };
      groups.set(key, group);
      signalTimesByGroup.set(key, []);
      return group;
    };

    const recordSignal = (group: AgentOperationsDigestGroup, timestamp?: string) => {
      const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;
      if (Number.isFinite(parsed)) {
        signalTimesByGroup.get(group.key)?.push(parsed);
      }
    };

    for (const task of tasks) {
      if (options.project && task.project !== options.project) continue;
      const group = getGroup(task.project, task.git?.repo, task.git?.worktreePath);
      const taskLink = taskSourceLink(task);

      if (task.status === 'in-progress') {
        group.totals.active++;
        pushUnique(group.sourceLinks.activeTasks, taskLink);
        recordSignal(group, task.updated);

        if (Date.parse(period.end) - Date.parse(task.updated) >= STUCK_TASK_MS) {
          group.totals.stuck++;
          pushUnique(group.sourceLinks.stuckTasks, taskLink);
        }
      }

      if (task.status === 'blocked') {
        group.totals.blocked++;
        pushUnique(group.sourceLinks.blockedTasks, taskLink);
        recordSignal(group, task.updated);
      }

      if (task.status === 'done' && inPeriod(task.updated, period.start, period.end)) {
        group.totals.completed++;
        pushUnique(group.sourceLinks.completedTasks, taskLink);
        pushUnique(group.topPlanCompletions, taskLink);
        recordSignal(group, task.updated);
      }
    }

    for (const event of events) {
      const task = event.taskId ? taskById.get(event.taskId) : undefined;
      if (options.project && (task?.project ?? event.project) !== options.project) continue;
      const group = getGroup(
        task?.project ?? event.project,
        task?.git?.repo,
        task?.git?.worktreePath
      );
      recordSignal(group, event.timestamp);

      if (event.type === 'run.completed') {
        const runEvent = event as RunTelemetryEvent;
        group.totals.runs++;
        group.totals.activeTimeMs += positiveNumber(runEvent.durationMs);
        if (isRunSuccess(runEvent)) {
          pushUnique(group.topPlanCompletions, runSourceLink(runEvent));
        } else {
          group.totals.failed++;
          const failure = runFailureLink(runEvent);
          pushUnique(group.sourceLinks.failedRuns, failure);
          pushUnique(group.notableFailures, failure);
        }
      }

      if (event.type === 'run.error') {
        const runEvent = event as RunTelemetryEvent;
        group.totals.runs++;
        group.totals.failed++;
        const failure = runFailureLink(runEvent);
        pushUnique(group.sourceLinks.failedRuns, failure);
        pushUnique(group.notableFailures, failure);
      }

      if (event.type === 'run.tokens') {
        const tokenEvent = event as TokenTelemetryEvent;
        group.totals.inputTokens += positiveNumber(tokenEvent.inputTokens);
        group.totals.outputTokens += positiveNumber(tokenEvent.outputTokens);
        group.totals.totalTokens +=
          positiveNumber(tokenEvent.totalTokens) ||
          positiveNumber(tokenEvent.inputTokens) +
            positiveNumber(tokenEvent.outputTokens) +
            positiveNumber(tokenEvent.cacheTokens);
        group.totals.tokenCost += positiveNumber(tokenEvent.cost);
        pushUnique(group.sourceLinks.tokenEvents, telemetrySourceLink(tokenEvent));
      }
    }

    for (const approval of approvals) {
      const task = approval.taskId ? taskById.get(approval.taskId) : undefined;
      if (options.project && task?.project !== options.project) continue;
      const group = getGroup(task?.project, task?.git?.repo, task?.git?.worktreePath);
      const approvalLink = approvalSourceLink(approval);
      pushUnique(group.openApprovals, approvalLink);
      recordSignal(group, approval.createdAt);
    }

    for (const group of groups.values()) {
      const signals = signalTimesByGroup.get(group.key) ?? [];
      group.totals.wallTimeMs = observedWallTime(signals);
      group.topPlanCompletions = group.topPlanCompletions.slice(0, 5);
      group.notableFailures = group.notableFailures.slice(0, 5);
      group.openApprovals = group.openApprovals.slice(0, 10);
    }

    const sortedGroups = Array.from(groups.values())
      .filter((group) => groupHasActivity(group))
      .sort((a, b) => groupActivityRank(b) - groupActivityRank(a) || a.key.localeCompare(b.key));
    const totals = rollupOperationsTotals(sortedGroups);

    return {
      period,
      generatedAt: new Date().toISOString(),
      hasActivity: sortedGroups.length > 0,
      groups: sortedGroups,
      totals,
      refresh: {
        manual: true,
        schedule: 'daily-ready',
        narrative: 'deterministic-only',
      },
    };
  }

  /**
   * Format the operations digest as deterministic markdown for briefings.
   */
  formatOperationsDigestMarkdown(digest: AgentOperationsDigest): DigestMarkdownMessage {
    if (!digest.hasActivity) {
      return { markdown: '', isEmpty: true };
    }

    const lines: string[] = [];
    lines.push(`# Agent Operations Digest`);
    lines.push('');
    lines.push(`Window: ${digest.period.start} to ${digest.period.end}`);
    lines.push(
      `Totals: ${digest.totals.active} active, ${digest.totals.blocked} blocked, ${digest.totals.stuck} stuck, ${digest.totals.completed} completed, ${digest.totals.failed} failed`
    );
    if (digest.totals.totalTokens > 0) {
      lines.push(
        `Tokens: ${this.formatNumber(digest.totals.totalTokens)} total, $${digest.totals.tokenCost.toFixed(4)} estimated`
      );
    }
    lines.push('');

    for (const group of digest.groups.slice(0, 10)) {
      lines.push(`## ${group.project} / ${group.repo}${group.cwd ? ` / ${group.cwd}` : ''}`);
      lines.push(
        `- Counts: ${group.totals.active} active, ${group.totals.blocked} blocked, ${group.totals.stuck} stuck, ${group.totals.completed} completed, ${group.totals.failed} failed`
      );
      lines.push(
        `- Runtime: ${formatDurationMs(group.totals.activeTimeMs)} active, ${formatDurationMs(group.totals.wallTimeMs)} observed wall`
      );
      if (group.totals.totalTokens > 0) {
        lines.push(
          `- Tokens: ${this.formatNumber(group.totals.totalTokens)} total, $${group.totals.tokenCost.toFixed(4)} estimated`
        );
      }
      if (group.topPlanCompletions.length > 0) {
        lines.push('- Plan completions:');
        for (const item of group.topPlanCompletions) {
          lines.push(`  - ${item.label} (${item.id})`);
        }
      }
      if (group.notableFailures.length > 0) {
        lines.push('- Notable failures:');
        for (const failure of group.notableFailures) {
          lines.push(`  - ${failure.label}${failure.error ? `: ${failure.error}` : ''}`);
        }
      }
      if (group.openApprovals.length > 0) {
        lines.push('- Open approvals:');
        for (const approval of group.openApprovals) {
          lines.push(`  - ${approval.agent}: ${approval.action} (${approval.id})`);
        }
      }
      lines.push('');
    }

    return { markdown: lines.join('\n'), isEmpty: false };
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

function resolveOperationsPeriod(
  options: AgentOperationsDigestOptions
): AgentOperationsDigest['period'] {
  const end = validIso(options.to) ?? new Date().toISOString();
  const windowHours = clampWindowHours(options.windowHours);
  const start =
    validIso(options.from) ??
    new Date(Date.parse(end) - windowHours * 60 * 60 * 1000).toISOString();

  return {
    start,
    end,
    windowHours: Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 3_600_000)),
  };
}

function validIso(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function clampWindowHours(value?: number): number {
  if (!Number.isFinite(value)) return DEFAULT_OPERATIONS_WINDOW_HOURS;
  return Math.min(MAX_OPERATIONS_WINDOW_HOURS, Math.max(1, Math.round(value as number)));
}

function emptyOperationsTotals(): AgentOperationsDigestGroup['totals'] {
  return {
    active: 0,
    blocked: 0,
    stuck: 0,
    completed: 0,
    failed: 0,
    runs: 0,
    tokenCost: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    wallTimeMs: 0,
    activeTimeMs: 0,
  };
}

function groupHasActivity(group: AgentOperationsDigestGroup): boolean {
  return (
    groupActivityRank(group) > 0 ||
    group.openApprovals.length > 0 ||
    group.sourceLinks.tokenEvents.length > 0
  );
}

function groupActivityRank(group: AgentOperationsDigestGroup): number {
  const totals = group.totals;
  return (
    totals.active +
    totals.blocked +
    totals.stuck +
    totals.completed +
    totals.failed +
    totals.runs +
    totals.totalTokens
  );
}

function rollupOperationsTotals(
  groups: AgentOperationsDigestGroup[]
): AgentOperationsDigest['totals'] {
  const totals = groups.reduce(
    (acc, group) => {
      acc.active += group.totals.active;
      acc.blocked += group.totals.blocked;
      acc.stuck += group.totals.stuck;
      acc.completed += group.totals.completed;
      acc.failed += group.totals.failed;
      acc.runs += group.totals.runs;
      acc.tokenCost += group.totals.tokenCost;
      acc.inputTokens += group.totals.inputTokens;
      acc.outputTokens += group.totals.outputTokens;
      acc.totalTokens += group.totals.totalTokens;
      acc.wallTimeMs += group.totals.wallTimeMs;
      acc.activeTimeMs += group.totals.activeTimeMs;
      acc.openApprovals += group.openApprovals.length;
      return acc;
    },
    { ...emptyOperationsTotals(), openApprovals: 0, groups: groups.length }
  );
  totals.tokenCost = Number(totals.tokenCost.toFixed(6));
  return totals;
}

function taskSourceLink(task: Task): AgentOperationsSourceLink {
  return {
    kind: 'task',
    id: task.id,
    label: task.title,
    timestamp: task.updated,
    taskId: task.id,
  };
}

function runSourceLink(event: RunTelemetryEvent): AgentOperationsSourceLink {
  const id = event.attemptId ?? event.id;
  return {
    kind: 'run',
    id,
    label: `${event.agent || 'agent'} run${event.taskId ? ` for ${event.taskId}` : ''}`,
    timestamp: event.timestamp,
    taskId: event.taskId,
  };
}

function runFailureLink(event: RunTelemetryEvent): AgentOperationsFailure {
  return {
    ...runSourceLink(event),
    agent: event.agent,
    error: event.error,
  };
}

function telemetrySourceLink(event: TokenTelemetryEvent): AgentOperationsSourceLink {
  return {
    kind: 'telemetry',
    id: event.id,
    label: `${event.agent || 'agent'} token usage`,
    timestamp: event.timestamp,
    taskId: event.taskId,
  };
}

function approvalSourceLink(approval: ApprovalRequest): AgentOperationsApproval {
  return {
    kind: 'approval',
    id: approval.id,
    label: `${approval.agentId} approval: ${approval.action}`,
    timestamp: approval.createdAt,
    taskId: approval.taskId,
    agent: approval.agentId,
    action: approval.action,
    details: approval.details,
  };
}

function inPeriod(timestamp: string, start: string, end: string): boolean {
  return timestamp >= start && timestamp <= end;
}

function positiveNumber(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function isRunSuccess(event: RunTelemetryEvent): boolean {
  return (
    event.success === true || (event as unknown as Record<string, unknown>).status === 'success'
  );
}

function observedWallTime(timestamps: number[]): number {
  if (timestamps.length < 2) return 0;
  return Math.max(0, Math.max(...timestamps) - Math.min(...timestamps));
}

function pushUnique<T extends { kind: string; id: string }>(items: T[], item: T) {
  if (!items.some((existing) => existing.kind === item.kind && existing.id === item.id)) {
    items.push(item);
  }
}

function formatDurationMs(ms: number): string {
  if (ms <= 0) return '0m';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

// Singleton instance
let instance: DigestService | null = null;

export function getDigestService(): DigestService {
  if (!instance) {
    instance = new DigestService();
  }
  return instance;
}

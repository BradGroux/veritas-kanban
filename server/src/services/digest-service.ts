import { getMetricsService, type MetricsService } from './metrics/index.js';
import { getTelemetryService, type TelemetryService } from './telemetry-service.js';
import { TaskService } from './task-service.js';
import { getAgentPermissionService, type ApprovalRequest } from './agent-permission-service.js';
import { getRunApprovalBrokerService } from './run-approval-broker-service.js';
import { getQueueIntakeMonitorService } from './queue-intake-monitor-service.js';
import type {
  QueueMonitorEvent,
  RunTelemetryEvent,
  RunApprovalRequest,
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
  repo?: string;
  cwd?: string;
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

export interface AgentOperationsQueueMonitorActivity extends AgentOperationsSourceLink {
  status: QueueMonitorEvent['status'];
  action: QueueMonitorEvent['action'];
  skippedReasons: string[];
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
  queueMonitors: AgentOperationsQueueMonitorActivity[];
}

export interface AgentOperationsDigest {
  period: {
    start: string;
    end: string;
    windowHours: number;
  };
  generatedAt: string;
  hasActivity: boolean;
  filters: {
    project?: string;
    repo?: string;
    cwd?: string;
  };
  inventory: AgentOperationsInventory;
  dataQuality: AgentOperationsDataQualityIssue[];
  semantics: AgentOperationsSemantics;
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

export type AgentOperationsExclusionReason =
  'filterMismatch' | 'status' | 'timeWindow' | 'missingSourceMetadata';

export interface AgentOperationsInventory {
  totalBoardTasks: number;
  matchingFilters: number;
  includedTasks: number;
  excludedTasks: number;
  excludedBy: Record<AgentOperationsExclusionReason, number>;
  sourceLinks: {
    includedTasks: AgentOperationsSourceLink[];
    excludedBy: Record<AgentOperationsExclusionReason, AgentOperationsSourceLink[]>;
  };
}

export interface AgentOperationsDataQualityIssue {
  code: 'unknown-project' | 'unknown-repository' | 'missing-cwd';
  label: string;
  count: number;
  sourceLinks: AgentOperationsSourceLink[];
}

export interface AgentOperationsSemantics {
  active: string;
  blocked: string;
  stuck: string;
  completed: string;
  failed: string;
  runs: string;
  activeTime: string;
  observedWallTime: string;
  tokenCost: string;
}

export interface DigestMarkdownMessage {
  markdown: string;
  isEmpty: boolean;
}

const DEFAULT_OPERATIONS_WINDOW_HOURS = 24;
const MAX_OPERATIONS_WINDOW_HOURS = 24 * 30;
const STUCK_TASK_MS = 2 * 60 * 60 * 1000;
const MONITOR_PROJECT = 'operations';
const OPERATIONS_SEMANTICS: AgentOperationsSemantics = {
  active: 'Current snapshot: tasks whose current status is in-progress.',
  blocked: 'Current snapshot: tasks whose current status is blocked.',
  stuck:
    'Current snapshot subset of active tasks whose task updated timestamp is at least 2 hours before the window end.',
  completed: 'Tasks whose current status is done and whose updated timestamp is inside the window.',
  failed:
    'Unique terminal run attempts inside the window that ended unsuccessfully or have an error event without a completion event.',
  runs: 'Unique terminal run attempts inside the window, deduplicated by attempt ID when available and otherwise by event ID.',
  activeTime:
    'Sum of positive durationMs values from unique completed run events inside the window.',
  observedWallTime:
    'Elapsed span between the earliest and latest included signals inside the window for each source group; it is not task age.',
  tokenCost:
    'Sum of positive reported token-event cost values inside the window; no cost is inferred when telemetry omits it.',
};

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
    const filters = normalizeOperationsOptions(options);
    const period = resolveOperationsPeriod(filters);
    const [tasks, events, legacyApprovals, runApprovals, queueMonitorList] = await Promise.all([
      this.taskService.listTasks(),
      this.telemetry.getEvents({
        since: period.start,
        until: period.end,
        type: ['run.completed', 'run.error', 'run.tokens'],
        project: filters.project,
        limit: 10000,
      }),
      getAgentPermissionService().getPendingApprovals(),
      getRunApprovalBrokerService().list({ workspaceId: 'local', status: 'pending' }),
      getQueueIntakeMonitorService().list(new Date(period.end)),
    ]);
    const approvals: Array<ApprovalRequest | RunApprovalRequest> = [
      ...legacyApprovals,
      ...runApprovals,
    ];

    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const monitorById = new Map(queueMonitorList.monitors.map((monitor) => [monitor.id, monitor]));
    const groups = new Map<string, AgentOperationsDigestGroup>();
    const signalTimesByGroup = new Map<string, number[]>();
    const inventory = emptyOperationsInventory(tasks.length);
    const dataQualityLinks = {
      unknownProject: [] as AgentOperationsSourceLink[],
      unknownRepository: [] as AgentOperationsSourceLink[],
      missingCwd: [] as AgentOperationsSourceLink[],
    };

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
        queueMonitors: [],
      };
      groups.set(key, group);
      signalTimesByGroup.set(key, []);
      return group;
    };

    const recordSignal = (group: AgentOperationsDigestGroup, timestamp?: string) => {
      const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;
      if (
        Number.isFinite(parsed) &&
        parsed >= Date.parse(period.start) &&
        parsed <= Date.parse(period.end)
      ) {
        signalTimesByGroup.get(group.key)?.push(parsed);
      }
    };

    for (const task of tasks) {
      const taskLink = taskSourceLink(task);
      const context = taskOperationsContext(task);
      const missingRequiredMetadata = missingRequiredOperationsMetadata(context, filters);
      if (missingRequiredMetadata) {
        recordInventoryExclusion(inventory, 'missingSourceMetadata', taskLink);
        continue;
      }
      if (!matchesOperationsFilters(context, filters)) {
        recordInventoryExclusion(inventory, 'filterMismatch', taskLink);
        continue;
      }
      inventory.matchingFilters++;
      recordTaskDataQuality(task, taskLink, dataQualityLinks);

      const inclusion = taskInventoryInclusion(task, period);
      if (inclusion !== 'included') {
        recordInventoryExclusion(inventory, inclusion, taskLink);
        continue;
      }
      inventory.includedTasks++;
      pushUnique(inventory.sourceLinks.includedTasks, taskLink);

      const group = getGroup(task.project, task.git?.repo, task.git?.worktreePath);

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

    const completedRunKeys = new Set(
      events
        .filter((event): event is RunTelemetryEvent => event.type === 'run.completed')
        .map(runIdentity)
    );
    const countedRunKeys = new Set<string>();
    const countedTokenEventIds = new Set<string>();

    for (const event of events) {
      const task = event.taskId ? taskById.get(event.taskId) : undefined;
      if (
        !matchesOperationsFilters(
          {
            project: task?.project ?? event.project,
            repo: task?.git?.repo,
            cwd: task?.git?.worktreePath,
          },
          filters
        )
      ) {
        continue;
      }
      const group = getGroup(
        task?.project ?? event.project,
        task?.git?.repo,
        task?.git?.worktreePath
      );

      if (event.type === 'run.completed') {
        const runEvent = event as RunTelemetryEvent;
        const runKey = runIdentity(runEvent);
        if (countedRunKeys.has(runKey)) continue;
        countedRunKeys.add(runKey);
        recordSignal(group, event.timestamp);
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
        const runKey = runIdentity(runEvent);
        if (completedRunKeys.has(runKey) || countedRunKeys.has(runKey)) continue;
        countedRunKeys.add(runKey);
        recordSignal(group, event.timestamp);
        group.totals.runs++;
        group.totals.failed++;
        const failure = runFailureLink(runEvent);
        pushUnique(group.sourceLinks.failedRuns, failure);
        pushUnique(group.notableFailures, failure);
      }

      if (event.type === 'run.tokens') {
        const tokenEvent = event as TokenTelemetryEvent;
        if (countedTokenEventIds.has(tokenEvent.id)) continue;
        countedTokenEventIds.add(tokenEvent.id);
        recordSignal(group, event.timestamp);
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
      if (!matchesOperationsFilters(taskOperationsContext(task), filters)) continue;
      const group = getGroup(task?.project, task?.git?.repo, task?.git?.worktreePath);
      const approvalLink = approvalSourceLink(approval);
      pushUnique(group.openApprovals, approvalLink);
      recordSignal(group, approval.createdAt);
    }

    for (const event of queueMonitorList.recentEvents) {
      if (!inPeriod(event.createdAt, period.start, period.end)) continue;
      const monitor = monitorById.get(event.monitorId);
      const context = {
        project: MONITOR_PROJECT,
        repo: monitor?.source.repo ?? 'unknown',
      };
      if (!matchesOperationsFilters(context, filters)) continue;
      const group = getGroup(context.project, context.repo);
      const monitorLink = queueMonitorSourceLink(event);
      pushUnique(group.queueMonitors, monitorLink);
      recordSignal(group, event.createdAt);
    }

    for (const group of groups.values()) {
      const signals = signalTimesByGroup.get(group.key) ?? [];
      group.totals.wallTimeMs = observedWallTime(signals);
      group.topPlanCompletions = group.topPlanCompletions.slice(0, 5);
      group.notableFailures = group.notableFailures.slice(0, 5);
      group.queueMonitors = group.queueMonitors.slice(0, 10);
    }

    const sortedGroups = Array.from(groups.values())
      .filter((group) => groupHasActivity(group))
      .sort((a, b) => groupActivityRank(b) - groupActivityRank(a) || a.key.localeCompare(b.key));
    const totals = rollupOperationsTotals(sortedGroups);
    const dataQuality = operationsDataQualityIssues(dataQualityLinks);

    return {
      period,
      generatedAt: new Date().toISOString(),
      hasActivity: sortedGroups.length > 0 || inventory.totalBoardTasks > 0,
      filters: {
        project: filters.project,
        repo: filters.repo,
        cwd: filters.cwd,
      },
      inventory,
      dataQuality,
      semantics: OPERATIONS_SEMANTICS,
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
      `Scope: project=${digest.filters.project ?? 'all'}, repo=${digest.filters.repo ?? 'all'}, cwd=${digest.filters.cwd ?? 'all'}`
    );
    lines.push(
      `Inventory: ${digest.inventory.totalBoardTasks} board tasks, ${digest.inventory.matchingFilters} match filters, ${digest.inventory.includedTasks} included, ${digest.inventory.excludedTasks} excluded`
    );
    lines.push(
      `Excluded: ${digest.inventory.excludedBy.filterMismatch} filter mismatch, ${digest.inventory.excludedBy.status} status, ${digest.inventory.excludedBy.timeWindow} time window, ${digest.inventory.excludedBy.missingSourceMetadata} missing source metadata`
    );
    lines.push(
      `Totals: ${digest.totals.active} active, ${digest.totals.blocked} blocked, ${digest.totals.stuck} stuck, ${digest.totals.completed} completed, ${digest.totals.failed} failed`
    );
    lines.push(
      'Semantics: active, blocked, and stuck are current task state; completed, failed, runs, tokens, and observed wall time are windowed.'
    );
    if (digest.totals.totalTokens > 0) {
      lines.push(
        `Tokens: ${this.formatNumber(digest.totals.totalTokens)} total, $${digest.totals.tokenCost.toFixed(4)} estimated`
      );
    }
    lines.push('');

    if (digest.dataQuality.length > 0) {
      lines.push('## Data quality');
      for (const issue of digest.dataQuality) {
        lines.push(`- ${issue.label}: ${issue.count} task${issue.count === 1 ? '' : 's'}`);
      }
      lines.push('');
    }

    for (const group of digest.groups) {
      lines.push(`## ${group.project} / ${group.repo}${group.cwd ? ` / ${group.cwd}` : ''}`);
      lines.push(
        `- Counts: ${group.totals.active} active, ${group.totals.blocked} blocked, ${group.totals.stuck} stuck, ${group.totals.completed} completed, ${group.totals.failed} failed`
      );
      lines.push(
        `- Runtime: ${formatDurationMs(group.totals.activeTimeMs)} completed-run time, ${formatDurationMs(group.totals.wallTimeMs)} observed in-window wall`
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
      if (group.queueMonitors.length > 0) {
        lines.push('- Queue monitors:');
        for (const monitor of group.queueMonitors) {
          const skipped =
            monitor.skippedReasons.length > 0 ? `; skipped ${monitor.skippedReasons.length}` : '';
          lines.push(`  - ${monitor.label}: ${monitor.status}/${monitor.action}${skipped}`);
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

function emptyOperationsInventory(totalBoardTasks: number): AgentOperationsInventory {
  return {
    totalBoardTasks,
    matchingFilters: 0,
    includedTasks: 0,
    excludedTasks: 0,
    excludedBy: {
      filterMismatch: 0,
      status: 0,
      timeWindow: 0,
      missingSourceMetadata: 0,
    },
    sourceLinks: {
      includedTasks: [],
      excludedBy: {
        filterMismatch: [],
        status: [],
        timeWindow: [],
        missingSourceMetadata: [],
      },
    },
  };
}

function recordInventoryExclusion(
  inventory: AgentOperationsInventory,
  reason: AgentOperationsExclusionReason,
  task: AgentOperationsSourceLink
) {
  inventory.excludedTasks++;
  inventory.excludedBy[reason]++;
  pushUnique(inventory.sourceLinks.excludedBy[reason], task);
}

function taskInventoryInclusion(
  task: Task,
  period: AgentOperationsDigest['period']
): 'included' | 'status' | 'timeWindow' {
  if (task.status === 'in-progress' || task.status === 'blocked') return 'included';
  if (task.status === 'done') {
    return inPeriod(task.updated, period.start, period.end) ? 'included' : 'timeWindow';
  }
  return 'status';
}

function missingRequiredOperationsMetadata(
  candidate: { project?: string; repo?: string; cwd?: string },
  filters: AgentOperationsDigestOptions
): boolean {
  return Boolean(
    (filters.project && !normalizeOptionalFilter(candidate.project)) ||
    (filters.repo && !normalizeOptionalFilter(candidate.repo)) ||
    (filters.cwd && !normalizeOptionalFilter(candidate.cwd))
  );
}

function recordTaskDataQuality(
  task: Task,
  taskLink: AgentOperationsSourceLink,
  links: {
    unknownProject: AgentOperationsSourceLink[];
    unknownRepository: AgentOperationsSourceLink[];
    missingCwd: AgentOperationsSourceLink[];
  }
) {
  if (!normalizeOptionalFilter(task.project)) pushUnique(links.unknownProject, taskLink);
  if (!normalizeOptionalFilter(task.git?.repo)) pushUnique(links.unknownRepository, taskLink);
  if (!normalizeOptionalFilter(task.git?.worktreePath)) pushUnique(links.missingCwd, taskLink);
}

function operationsDataQualityIssues(links: {
  unknownProject: AgentOperationsSourceLink[];
  unknownRepository: AgentOperationsSourceLink[];
  missingCwd: AgentOperationsSourceLink[];
}): AgentOperationsDataQualityIssue[] {
  return [
    {
      code: 'unknown-project' as const,
      label: 'Tasks grouped under unassigned project',
      sourceLinks: links.unknownProject,
    },
    {
      code: 'unknown-repository' as const,
      label: 'Tasks grouped under unknown repository',
      sourceLinks: links.unknownRepository,
    },
    {
      code: 'missing-cwd' as const,
      label: 'Tasks missing CWD/worktree metadata',
      sourceLinks: links.missingCwd,
    },
  ]
    .filter((issue) => issue.sourceLinks.length > 0)
    .map((issue) => ({ ...issue, count: issue.sourceLinks.length }));
}

function groupHasActivity(group: AgentOperationsDigestGroup): boolean {
  return (
    groupActivityRank(group) > 0 ||
    group.openApprovals.length > 0 ||
    group.queueMonitors.length > 0 ||
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

function taskOperationsContext(task?: Task): {
  project?: string;
  repo?: string;
  cwd?: string;
} {
  return {
    project: task?.project,
    repo: task?.git?.repo,
    cwd: task?.git?.worktreePath,
  };
}

function matchesOperationsFilters(
  candidate: { project?: string; repo?: string; cwd?: string },
  options: AgentOperationsDigestOptions
): boolean {
  return (
    matchesOperationsFilter(normalizeProject(candidate.project), options.project) &&
    matchesOperationsFilter(normalizeRepo(candidate.repo), options.repo) &&
    matchesOperationsFilter(candidate.cwd, options.cwd)
  );
}

function normalizeOperationsOptions(
  options: AgentOperationsDigestOptions
): AgentOperationsDigestOptions {
  return {
    ...options,
    project: normalizeOptionalFilter(options.project),
    repo: normalizeOptionalFilter(options.repo),
    cwd: normalizeOptionalFilter(options.cwd),
  };
}

function matchesOperationsFilter(candidate: string | undefined, filter: string | undefined) {
  const normalizedFilter = normalizeOptionalFilter(filter);
  if (!normalizedFilter) return true;
  return candidate === normalizedFilter;
}

function normalizeOptionalFilter(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeProject(value: string | undefined): string {
  return normalizeOptionalFilter(value) ?? 'unassigned';
}

function normalizeRepo(value: string | undefined): string {
  return normalizeOptionalFilter(value) ?? 'unknown';
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

function approvalSourceLink(
  approval: ApprovalRequest | RunApprovalRequest
): AgentOperationsApproval {
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

function queueMonitorSourceLink(event: QueueMonitorEvent): AgentOperationsQueueMonitorActivity {
  return {
    kind: 'telemetry',
    id: event.id,
    label: `${event.monitorId}: ${event.summary}`,
    timestamp: event.createdAt,
    status: event.status,
    action: event.action,
    skippedReasons: event.skippedReasons,
  };
}

function inPeriod(timestamp: string, start: string, end: string): boolean {
  const value = Date.parse(timestamp);
  const periodStart = Date.parse(start);
  const periodEnd = Date.parse(end);
  return (
    Number.isFinite(value) &&
    Number.isFinite(periodStart) &&
    Number.isFinite(periodEnd) &&
    value >= periodStart &&
    value <= periodEnd
  );
}

function positiveNumber(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function isRunSuccess(event: RunTelemetryEvent): boolean {
  return (
    event.success === true || (event as unknown as Record<string, unknown>).status === 'success'
  );
}

function runIdentity(event: RunTelemetryEvent): string {
  return event.attemptId ?? event.id;
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

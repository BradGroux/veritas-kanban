import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type {
  SchedulerDueRunResult,
  SchedulerEvent,
  SchedulerEventType,
  SchedulerItem,
  SchedulerItemKind,
  SchedulerListResponse,
  SchedulerRunResult,
  SchedulerRunStatus,
  SchedulerValidationIssue,
  SchedulerValidationResult,
  WorkflowDefinition,
  WorkflowSchedule,
  WorkflowScheduleMode,
} from '@veritas-kanban/shared';
import type { RunTelemetryEvent } from '@veritas-kanban/shared';
import { createLogger } from '../lib/logger.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { getRuntimeDir } from '../utils/paths.js';
import {
  getScheduledDeliverablesService,
  type Deliverable,
  type DeliverableRun,
  type ScheduledDeliverablesService,
} from './scheduled-deliverables-service.js';
import { ScheduledDeliverablesRunner } from './scheduled-deliverables-runner-service.js';
import { getTelemetryService, type TelemetryService } from './telemetry-service.js';
import {
  getWorkflowAuthoringService,
  type WorkflowAuthoringService,
} from './workflow-authoring-service.js';
import { getWorkflowRunService, type WorkflowRunService } from './workflow-run-service.js';
import { getWorkflowService, type WorkflowService } from './workflow-service.js';

const log = createLogger('scheduler');
const STATE_VERSION = 1;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MINUTES = 5;
const MAX_EVENTS = 200;
const SCHEDULER_PROJECT = 'operations';
const SCHEDULER_AGENT = 'scheduler';

interface SchedulerItemState {
  attempts?: number;
  nextAttemptAt?: string;
  lastRunAt?: string;
  nextRunAt?: string;
  lastStatus?: SchedulerRunStatus;
  lastSummary?: string;
  lastError?: string;
  sourceRunId?: string;
}

interface SchedulerStateFile {
  version: typeof STATE_VERSION;
  items: Record<string, SchedulerItemState>;
  events: SchedulerEvent[];
}

interface SchedulerServiceOptions {
  stateFile?: string;
  deliverablesService?: ScheduledDeliverablesService;
  workflowService?: WorkflowService;
  workflowRunService?: WorkflowRunService;
  workflowAuthoringService?: WorkflowAuthoringService;
  telemetryService?: TelemetryService;
}

export class SchedulerService {
  private readonly stateFile: string;
  private readonly deliverablesService: ScheduledDeliverablesService;
  private readonly workflowService: WorkflowService;
  private readonly workflowRunService: WorkflowRunService;
  private readonly workflowAuthoringService: WorkflowAuthoringService;
  private readonly telemetryService: TelemetryService;
  private state: SchedulerStateFile | null = null;
  private runningDue = false;
  private readonly runningItems = new Set<string>();

  constructor(options: SchedulerServiceOptions = {}) {
    this.stateFile = options.stateFile ?? path.join(getRuntimeDir(), 'scheduler-state.json');
    this.deliverablesService = options.deliverablesService ?? getScheduledDeliverablesService();
    this.workflowService = options.workflowService ?? getWorkflowService();
    this.workflowRunService = options.workflowRunService ?? getWorkflowRunService();
    this.workflowAuthoringService =
      options.workflowAuthoringService ?? getWorkflowAuthoringService();
    this.telemetryService = options.telemetryService ?? getTelemetryService();
  }

  async list(now = new Date()): Promise<SchedulerListResponse> {
    await this.ensureLoaded();
    const items = await this.buildItems(now);
    const dueCutoff = now.getTime();
    const summary = items.reduce(
      (acc, item) => {
        acc.total++;
        if (item.enabled) acc.enabled++;
        if (!item.enabled) acc.paused++;
        if (item.health === 'blocked') acc.blocked++;
        if (item.lastStatus === 'failed') acc.failed++;
        if (isItemDue(item, dueCutoff)) acc.due++;
        return acc;
      },
      { total: 0, enabled: 0, paused: 0, due: 0, failed: 0, blocked: 0 }
    );

    return {
      generatedAt: now.toISOString(),
      summary,
      items,
      recentEvents: [...this.currentState().events].slice(-20).reverse(),
    };
  }

  async getItem(itemId: string, now = new Date()): Promise<SchedulerItem> {
    const items = await this.buildItems(now);
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) throw new NotFoundError(`Scheduler item not found: ${itemId}`);
    return item;
  }

  async validate(itemId: string, now = new Date()): Promise<SchedulerValidationResult> {
    const item = await this.getItem(itemId, now);
    const issues = this.validateItem(item);
    await this.recordEvent({
      item,
      type: 'validate',
      status: issues.some((issue) => issue.severity === 'error') ? 'failed' : 'success',
      summary:
        issues.length === 0
          ? 'Scheduler item validation passed.'
          : 'Scheduler item has validation issues.',
      error: issues.find((issue) => issue.severity === 'error')?.message,
      now,
    });

    return {
      itemId,
      ok: !issues.some((issue) => issue.severity === 'error'),
      issues,
    };
  }

  async pause(itemId: string, now = new Date()): Promise<SchedulerRunResult> {
    const item = await this.getItem(itemId, now);
    if (!item.enabled) {
      throw new ValidationError(`Scheduler item is already paused: ${itemId}`);
    }

    if (item.kind === 'scheduled-deliverable') {
      await this.deliverablesService.update(item.sourceId, { enabled: false });
    } else {
      await this.updateWorkflowSchedule(item.sourceId, { enabled: false });
    }

    const state = this.currentState();
    state.items[itemId] = {
      ...state.items[itemId],
      attempts: 0,
      nextAttemptAt: undefined,
    };
    const event = await this.recordEvent({
      item: { ...item, enabled: false },
      type: 'pause',
      status: 'success',
      summary: 'Scheduler item paused.',
      now,
    });
    await this.saveState();
    return { item: await this.getItem(itemId, now), event };
  }

  async resume(itemId: string, now = new Date()): Promise<SchedulerRunResult> {
    const item = await this.getItem(itemId, now);
    if (item.enabled) {
      throw new ValidationError(`Scheduler item is already enabled: ${itemId}`);
    }

    if (item.kind === 'scheduled-deliverable') {
      await this.deliverablesService.update(item.sourceId, { enabled: true });
    } else {
      await this.updateWorkflowSchedule(item.sourceId, { enabled: true });
    }

    const state = this.currentState();
    state.items[itemId] = {
      ...state.items[itemId],
      attempts: 0,
      nextAttemptAt: undefined,
    };
    const event = await this.recordEvent({
      item: { ...item, enabled: true },
      type: 'resume',
      status: 'success',
      summary: 'Scheduler item resumed.',
      now,
    });
    await this.saveState();
    return { item: await this.getItem(itemId, now), event };
  }

  async runItem(
    itemId: string,
    trigger: Extract<SchedulerEventType, 'manual-run' | 'due-run'> = 'manual-run',
    now = new Date()
  ): Promise<SchedulerRunResult> {
    const item = await this.getItem(itemId, now);
    if (this.runningItems.has(itemId)) {
      const event = await this.recordEvent({
        item,
        type: 'overlap',
        status: 'skipped',
        summary: 'Scheduler item is already running.',
        now,
      });
      return { item, event };
    }

    const issues = this.validateItem(item);
    const blockingIssue = issues.find((issue) => issue.severity === 'error');
    if (blockingIssue) {
      const event = await this.recordEvent({
        item,
        type: trigger,
        status: 'failed',
        summary: 'Scheduler item failed validation before launch.',
        error: blockingIssue.message,
        now,
      });
      return { item: await this.getItem(itemId, now), event };
    }

    this.runningItems.add(itemId);
    const startedAt = Date.now();
    try {
      const result =
        item.kind === 'scheduled-deliverable'
          ? await this.runDeliverable(item, trigger, now, startedAt)
          : await this.runWorkflow(item, trigger, now, startedAt);
      await this.saveState();
      return result;
    } finally {
      this.runningItems.delete(itemId);
    }
  }

  async runDue(now = new Date()): Promise<SchedulerDueRunResult> {
    if (this.runningDue) {
      return { checked: 0, executed: 0, skipped: 0, failed: 0, overlapping: true, events: [] };
    }

    this.runningDue = true;
    try {
      const list = await this.list(now);
      const due = list.items.filter((item) => isItemDue(item, now.getTime()));
      const result: SchedulerDueRunResult = {
        checked: due.length,
        executed: 0,
        skipped: 0,
        failed: 0,
        overlapping: false,
        events: [],
      };

      for (const item of due) {
        const run = await this.runItem(item.id, 'due-run', now);
        result.events.push(run.event);
        if (run.event.status === 'failed') result.failed++;
        else if (run.event.status === 'skipped') result.skipped++;
        else result.executed++;
      }

      return result;
    } finally {
      this.runningDue = false;
    }
  }

  private async runDeliverable(
    item: SchedulerItem,
    trigger: Extract<SchedulerEventType, 'manual-run' | 'due-run'>,
    now: Date,
    startedAt: number
  ): Promise<SchedulerRunResult> {
    const result = await this.deliverablesService.get(item.sourceId);
    if (!result) throw new NotFoundError(`Scheduled deliverable not found: ${item.sourceId}`);

    const runs: DeliverableRun[] = [];
    const runner = new ScheduledDeliverablesRunner({
      deliverablesService: {
        listDue: async () => [result.deliverable],
        recordRun: async (params) => {
          const run = await this.deliverablesService.recordRun(params);
          runs.push(run);
          return run;
        },
      },
    });
    const runnerResult = await runner.runDue(now);
    const run = runs.at(-1);
    const status = deliverableRunnerStatus(runnerResult);
    const summary =
      run?.summary ??
      (status === 'skipped'
        ? 'Scheduled deliverable skipped.'
        : status === 'failed'
          ? 'Scheduled deliverable failed.'
          : 'Scheduled deliverable executed.');
    const event = await this.recordEvent({
      item,
      type: trigger,
      status,
      summary,
      error: run?.error,
      sourceRunId: run?.id,
      durationMs: Date.now() - startedAt,
      now,
      nextRunAt: (await this.deliverablesService.get(item.sourceId))?.deliverable.nextRunAt,
    });
    return { item: await this.getItem(item.id, now), event };
  }

  private async runWorkflow(
    item: SchedulerItem,
    trigger: Extract<SchedulerEventType, 'manual-run' | 'due-run'>,
    now: Date,
    startedAt: number
  ): Promise<SchedulerRunResult> {
    const workflow = await this.workflowService.loadWorkflow(item.sourceId);
    if (!workflow) throw new NotFoundError(`Workflow not found: ${item.sourceId}`);

    const dryRun = await this.workflowAuthoringService.dryRun({
      workflow,
      context: { clientMode: 'local', now: now.toISOString() },
    });
    const blocker = dryRun.messages.find((message) => message.severity === 'error');
    if (blocker) {
      const event = await this.recordEvent({
        item,
        type: trigger,
        status: 'failed',
        summary: 'Workflow schedule failed preflight validation.',
        error: blocker.message,
        durationMs: Date.now() - startedAt,
        now,
      });
      return { item: await this.getItem(item.id, now), event };
    }

    const run = await this.workflowRunService.startRun(
      workflow.id,
      undefined,
      {
        scheduler: {
          itemId: item.id,
          trigger,
          runAt: now.toISOString(),
        },
      },
      workflow.config?.budget
    );
    const event = await this.recordEvent({
      item,
      type: trigger,
      status: 'started',
      summary: `Workflow run started: ${run.id}`,
      sourceRunId: run.id,
      durationMs: Date.now() - startedAt,
      now,
      nextRunAt: nextScheduledAt(workflow.schedule, now.toISOString()),
    });
    return { item: await this.getItem(item.id, now), event };
  }

  private async updateWorkflowSchedule(
    workflowId: string,
    update: Partial<Pick<WorkflowSchedule, 'enabled'>>
  ): Promise<void> {
    const workflow = await this.workflowService.loadWorkflow(workflowId);
    if (!workflow?.schedule) {
      throw new NotFoundError(`Scheduled workflow not found: ${workflowId}`);
    }
    workflow.schedule = { ...workflow.schedule, ...update };
    workflow.version = (workflow.version || 0) + 1;
    workflow.updatedAt = new Date().toISOString();
    await this.workflowService.saveWorkflow(workflow);
  }

  private async buildItems(now: Date): Promise<SchedulerItem[]> {
    await this.ensureLoaded();
    const [deliverables, workflows] = await Promise.all([
      this.deliverablesService.list(),
      this.workflowService.listWorkflows(),
    ]);

    const items = [
      ...deliverables.map((deliverable) => this.deliverableItem(deliverable)),
      ...workflows
        .filter((workflow) => shouldExposeWorkflow(workflow))
        .map((workflow) => this.workflowItem(workflow, now)),
    ];

    return items.sort((a, b) => {
      const aNext = a.nextRunAt ? Date.parse(a.nextRunAt) : Number.POSITIVE_INFINITY;
      const bNext = b.nextRunAt ? Date.parse(b.nextRunAt) : Number.POSITIVE_INFINITY;
      if (aNext !== bNext) return aNext - bNext;
      return a.name.localeCompare(b.name);
    });
  }

  private deliverableItem(deliverable: Deliverable): SchedulerItem {
    const id = itemId('scheduled-deliverable', deliverable.id);
    const state = this.currentState().items[id] ?? {};
    return this.decorateItem({
      id,
      kind: 'scheduled-deliverable',
      provider: 'local-server',
      sourceId: deliverable.id,
      name: deliverable.name,
      description: deliverable.description,
      enabled: deliverable.enabled,
      trigger: {
        mode: deliverable.schedule,
        description: deliverable.scheduleDescription,
        cronExpr: deliverable.cronExpr,
        customDueRunnerSupported: deliverable.schedule !== 'custom',
      },
      tags: deliverable.tags,
      nextRunAt: deliverable.nextRunAt,
      lastRunAt: deliverable.lastRunAt,
      lastStatus: state.lastStatus,
      lastSummary: state.lastSummary,
      lastError: state.lastError,
      sourceRunId: state.sourceRunId,
      health: 'healthy',
      healthSummary: 'Ready',
      retry: retryState(state),
      actions: baseActions(deliverable.enabled),
    });
  }

  private workflowItem(workflow: WorkflowDefinition, now: Date): SchedulerItem {
    const id = itemId('workflow', workflow.id);
    const state = this.currentState().items[id] ?? {};
    const schedule = workflow.schedule as WorkflowSchedule;
    const nextRunAt = workflowNextRunAt(workflow, state, now);
    return this.decorateItem({
      id,
      kind: 'workflow',
      provider: 'local-server',
      sourceId: workflow.id,
      name: workflow.name,
      description: workflow.description,
      enabled: Boolean(schedule.enabled),
      trigger: {
        mode: schedule.mode,
        description: describeWorkflowSchedule(schedule),
        cronExpr: schedule.cronExpr,
        timezone: schedule.timezone,
        startAt: schedule.startAt,
        endAt: schedule.endAt,
        customDueRunnerSupported: schedule.mode !== 'custom',
      },
      tags: workflow.config?.telemetry_tags ?? [],
      nextRunAt,
      lastRunAt: state.lastRunAt,
      lastStatus: state.lastStatus,
      lastSummary: state.lastSummary,
      lastError: state.lastError,
      sourceRunId: state.sourceRunId,
      health: 'healthy',
      healthSummary: 'Ready',
      retry: retryState(state),
      actions: baseActions(Boolean(schedule.enabled)),
    });
  }

  private decorateItem(item: SchedulerItem): SchedulerItem {
    const issues = this.validateItem(item);
    const retryBlocked =
      item.retry.attempts >= item.retry.maxAttempts && item.lastStatus === 'failed';
    const error = issues.find((issue) => issue.severity === 'error');
    const warning = issues.find((issue) => issue.severity === 'warning');

    if (!item.enabled) {
      return { ...item, health: 'paused', healthSummary: 'Paused' };
    }
    if (retryBlocked || error) {
      return {
        ...item,
        health: 'blocked',
        healthSummary: retryBlocked
          ? 'Retry limit reached; run manually or resume to reset.'
          : (error?.message ?? 'Blocked'),
      };
    }
    if (warning) {
      return { ...item, health: 'warning', healthSummary: warning.message };
    }
    return { ...item, health: 'healthy', healthSummary: 'Ready' };
  }

  private validateItem(item: SchedulerItem): SchedulerValidationIssue[] {
    const issues: SchedulerValidationIssue[] = [];
    if (!item.name.trim()) {
      issues.push({
        severity: 'error',
        path: 'name',
        message: 'Scheduler item is missing a name.',
        remediation: 'Name the scheduled deliverable or workflow.',
      });
    }
    if (item.enabled && item.trigger.mode === 'custom' && !item.trigger.cronExpr) {
      issues.push({
        severity: 'error',
        path: 'trigger.cronExpr',
        message: 'Custom schedule is missing a cron expression.',
        remediation: 'Add cronExpr or switch to a standard interval schedule.',
      });
    }
    if (item.enabled && !item.trigger.customDueRunnerSupported) {
      issues.push({
        severity: 'warning',
        path: 'trigger.mode',
        message:
          'Custom cron schedules are visible and manually runnable, but due-run execution is not enabled.',
        remediation: 'Add a cron adapter before relying on automatic due-run execution.',
      });
    }
    if (item.enabled && item.nextRunAt && !Number.isFinite(Date.parse(item.nextRunAt))) {
      issues.push({
        severity: 'error',
        path: 'nextRunAt',
        message: 'Next run timestamp is invalid.',
        remediation: 'Pause and resume the item to recalculate schedule state.',
      });
    }
    if (item.enabled && item.trigger.endAt && Date.parse(item.trigger.endAt) <= Date.now()) {
      issues.push({
        severity: 'warning',
        path: 'trigger.endAt',
        message: 'Schedule end time has passed.',
        remediation: 'Extend endAt or pause the schedule.',
      });
    }
    return issues;
  }

  private async recordEvent(params: {
    item: SchedulerItem;
    type: SchedulerEventType;
    status: SchedulerRunStatus;
    summary: string;
    now: Date;
    durationMs?: number;
    error?: string;
    sourceRunId?: string;
    nextRunAt?: string;
  }): Promise<SchedulerEvent> {
    await this.ensureLoaded();
    const event: SchedulerEvent = {
      id: `sched_evt_${nanoid(10)}`,
      itemId: params.item.id,
      sourceId: params.item.sourceId,
      kind: params.item.kind,
      type: params.type,
      status: params.status,
      summary: params.summary,
      runAt: params.now.toISOString(),
      durationMs: params.durationMs,
      error: params.error,
      sourceRunId: params.sourceRunId,
      nextRunAt: params.nextRunAt,
    };

    const state = this.currentState();
    const previous = state.items[params.item.id] ?? {};
    const failed = params.status === 'failed';
    const attempts = failed ? (previous.attempts ?? 0) + 1 : 0;
    state.items[params.item.id] = {
      ...previous,
      attempts,
      nextAttemptAt:
        failed && attempts < DEFAULT_MAX_ATTEMPTS
          ? retryAttemptAt(params.now, attempts)
          : undefined,
      lastRunAt: params.now.toISOString(),
      nextRunAt: params.nextRunAt ?? previous.nextRunAt,
      lastStatus: params.status,
      lastSummary: params.summary,
      lastError: params.error,
      sourceRunId: params.sourceRunId,
    };
    state.events.push(event);
    state.events = state.events.slice(-MAX_EVENTS);
    await this.saveState();
    await this.emitTelemetry(event);
    log.info(
      { eventId: event.id, itemId: event.itemId, status: event.status },
      'Scheduler event recorded'
    );
    return event;
  }

  private async emitTelemetry(event: SchedulerEvent): Promise<void> {
    const base = {
      taskId: event.itemId,
      project: SCHEDULER_PROJECT,
      agent: SCHEDULER_AGENT,
      attemptId: event.id,
      durationMs: event.durationMs,
      error: event.error,
    };
    if (event.status === 'failed') {
      await this.telemetryService.emit<RunTelemetryEvent>({
        ...base,
        type: 'run.error',
        error: event.error ?? event.summary,
      });
      return;
    }
    await this.telemetryService.emit<RunTelemetryEvent>({
      ...base,
      type: 'run.completed',
      success: event.status !== 'skipped',
    });
  }

  private async ensureLoaded(): Promise<void> {
    if (this.state) return;
    try {
      const data = await fs.readFile(this.stateFile, 'utf-8');
      const parsed = JSON.parse(data) as SchedulerStateFile;
      this.state = {
        version: STATE_VERSION,
        items: parsed.items ?? {},
        events: Array.isArray(parsed.events) ? parsed.events.slice(-MAX_EVENTS) : [],
      };
    } catch {
      this.state = { version: STATE_VERSION, items: {}, events: [] };
    }
  }

  private currentState(): SchedulerStateFile {
    if (!this.state) {
      throw new Error('Scheduler state has not been loaded');
    }
    return this.state;
  }

  private async saveState(): Promise<void> {
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    await fs.writeFile(this.stateFile, JSON.stringify(this.state, null, 2));
  }
}

function itemId(kind: SchedulerItemKind, sourceId: string): string {
  return `${kind}:${sourceId}`;
}

function retryState(state: SchedulerItemState) {
  return {
    attempts: state.attempts ?? 0,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    backoffMinutes: DEFAULT_BACKOFF_MINUTES,
    nextAttemptAt: state.nextAttemptAt,
  };
}

function baseActions(enabled: boolean): SchedulerItem['actions'] {
  return {
    canRun: true,
    canPause: enabled,
    canResume: !enabled,
    canValidate: true,
  };
}

function shouldExposeWorkflow(workflow: WorkflowDefinition): boolean {
  const schedule = workflow.schedule;
  if (!schedule) return false;
  return (
    schedule.mode !== 'manual' ||
    schedule.enabled ||
    workflow.outputTargets?.some((target) => target.type === 'scheduled-snapshot') === true
  );
}

function workflowNextRunAt(
  workflow: WorkflowDefinition,
  state: SchedulerItemState,
  now: Date
): string | undefined {
  const schedule = workflow.schedule;
  if (!schedule?.enabled || schedule.mode === 'manual' || schedule.mode === 'custom') {
    return state.nextRunAt;
  }
  if (state.nextRunAt) return state.nextRunAt;
  if (state.lastRunAt) return nextScheduledAt(schedule, state.lastRunAt);
  if (schedule.startAt) return schedule.startAt;
  return now.toISOString();
}

function nextScheduledAt(
  schedule: WorkflowSchedule | undefined,
  baseAt: string
): string | undefined {
  if (!schedule || schedule.mode === 'manual' || schedule.mode === 'custom') return undefined;
  return addScheduleInterval(schedule.mode, baseAt);
}

function addScheduleInterval(mode: WorkflowScheduleMode, baseAt: string): string | undefined {
  const date = new Date(baseAt);
  if (!Number.isFinite(date.getTime())) return undefined;
  switch (mode) {
    case 'daily':
      date.setUTCDate(date.getUTCDate() + 1);
      break;
    case 'weekly':
      date.setUTCDate(date.getUTCDate() + 7);
      break;
    case 'biweekly':
      date.setUTCDate(date.getUTCDate() + 14);
      break;
    case 'monthly':
      date.setUTCMonth(date.getUTCMonth() + 1);
      break;
    default:
      return undefined;
  }
  return date.toISOString();
}

function describeWorkflowSchedule(schedule: WorkflowSchedule): string {
  if (schedule.mode === 'custom')
    return schedule.cronExpr ? `Cron: ${schedule.cronExpr}` : 'Custom schedule';
  if (schedule.mode === 'daily') return 'Every day';
  if (schedule.mode === 'weekly') return 'Every week';
  if (schedule.mode === 'biweekly') return 'Every 2 weeks';
  if (schedule.mode === 'monthly') return 'Every month';
  return 'Manual';
}

function deliverableRunnerStatus(result: {
  executed: number;
  failed: number;
  skipped: number;
}): SchedulerRunStatus {
  if (result.failed > 0) return 'failed';
  if (result.executed > 0) return 'success';
  if (result.skipped > 0) return 'skipped';
  return 'skipped';
}

function isItemDue(item: SchedulerItem, cutoff: number): boolean {
  if (!item.enabled || item.health === 'blocked' || item.health === 'paused') return false;
  if (!item.trigger.customDueRunnerSupported) return false;
  if (item.retry.nextAttemptAt && Date.parse(item.retry.nextAttemptAt) > cutoff) return false;
  if (!item.nextRunAt) return false;
  const next = Date.parse(item.nextRunAt);
  return Number.isFinite(next) && next <= cutoff;
}

function retryAttemptAt(now: Date, attempts: number): string {
  const multiplier = Math.max(1, 2 ** Math.max(0, attempts - 1));
  const minutes = Math.min(DEFAULT_BACKOFF_MINUTES * multiplier, 60);
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

let schedulerServiceInstance: SchedulerService | null = null;

export function getSchedulerService(): SchedulerService {
  if (!schedulerServiceInstance) {
    schedulerServiceInstance = new SchedulerService();
  }
  return schedulerServiceInstance;
}

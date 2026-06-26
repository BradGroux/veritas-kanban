import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { nanoid } from 'nanoid';
import type {
  QueueMonitorAction,
  QueueMonitorActionRecord,
  QueueMonitorCandidate,
  QueueMonitorCandidatePacket,
  QueueMonitorDefinition,
  QueueMonitorEvent,
  QueueMonitorEventType,
  QueueMonitorExplainResult,
  QueueMonitorGateCheck,
  QueueMonitorHealthResult,
  QueueMonitorListResponse,
  QueueMonitorRunResult,
  QueueMonitorRunStatus,
  QueueMonitorRunTrigger,
  QueueMonitorSnapshot,
  QueueMonitorState,
  QueueMonitorUpdateInput,
  RunTelemetryEvent,
  WatcherContinuationEvaluationResult,
} from '@veritas-kanban/shared';
import { createLogger } from '../lib/logger.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { getRuntimeDir } from '../utils/paths.js';
import { getAgentBudgetService, type AgentBudgetService } from './agent-budget-service.js';
import { getBreaker } from './circuit-registry.js';
import {
  getGovernanceTraceService,
  type GovernanceTraceService,
} from './governance-trace-service.js';
import {
  DEFAULT_SANDBOX_PRESET_ID,
  getSandboxPolicyService,
  type SandboxPolicyService,
} from './sandbox-policy-service.js';
import { getTelemetryService, type TelemetryService } from './telemetry-service.js';
import { WatcherPolicyService } from './watcher-policy-service.js';
import {
  getWorkflowAuthoringService,
  type WorkflowAuthoringService,
} from './workflow-authoring-service.js';
import { getWorkflowRunService, type WorkflowRunService } from './workflow-run-service.js';
import { getWorkflowService, type WorkflowService } from './workflow-service.js';

const execFileAsync = promisify(execFile);
const log = createLogger('queue-intake-monitor');

const STORE_VERSION = 1;
const MAX_EVENTS = 200;
const DEFAULT_MAX_CANDIDATES = 20;
const DEFAULT_INTERVAL_MINUTES = 30;
const DEFAULT_FAILURE_THRESHOLD = 3;
const MONITOR_AGENT = 'queue-intake-monitor';
const MONITOR_PROJECT = 'operations';
const DEFAULT_CREATED_AT = '2026-06-26T00:00:00.000Z';
const DEFAULT_BLOCKED_LABELS = ['blocked', 'status: blocked', 'needs-info', 'on hold'];

interface QueueMonitorStore {
  version: typeof STORE_VERSION;
  monitors: QueueMonitorDefinition[];
  state: Record<string, QueueMonitorState>;
  events: QueueMonitorEvent[];
}

export interface QueueIntakeMonitorServiceOptions {
  storeFile?: string;
  githubExec?: (args: string[]) => Promise<string>;
  watcherPolicyService?: WatcherPolicyService;
  sandboxPolicyService?: SandboxPolicyService;
  budgetService?: AgentBudgetService;
  governanceTraceService?: GovernanceTraceService;
  workflowService?: WorkflowService;
  workflowRunService?: WorkflowRunService;
  workflowAuthoringService?: WorkflowAuthoringService;
  telemetryService?: TelemetryService;
}

interface GhUser {
  login?: string;
}

interface GhLabel {
  name: string;
}

interface GhIssue {
  number: number;
  title: string;
  state: string;
  labels?: GhLabel[];
  assignees?: GhUser[];
  author?: GhUser | null;
  createdAt: string;
  updatedAt: string;
  url: string;
  comments?: number;
}

interface GhPullRequest extends GhIssue {
  isDraft?: boolean;
  reviewDecision?: string;
  statusCheckRollup?: Array<{
    conclusion?: string;
    status?: string;
    state?: string;
  }>;
}

interface GateContext {
  checks: QueueMonitorGateCheck[];
  policy?: WatcherContinuationEvaluationResult;
  sandbox?: QueueMonitorActionRecord['sandbox'];
  budgetDecision?: string;
}

export class QueueIntakeMonitorService {
  private readonly storeFile: string;
  private readonly githubExec: (args: string[]) => Promise<string>;
  private readonly watcherPolicyService: WatcherPolicyService;
  private readonly sandboxPolicyService: SandboxPolicyService;
  private readonly budgetService: AgentBudgetService;
  private readonly governanceTraceService: GovernanceTraceService;
  private readonly workflowService: WorkflowService;
  private readonly workflowRunService: WorkflowRunService;
  private readonly workflowAuthoringService: WorkflowAuthoringService;
  private readonly telemetryService: TelemetryService;
  private store: QueueMonitorStore | null = null;
  private readonly runningMonitors = new Set<string>();

  constructor(options: QueueIntakeMonitorServiceOptions = {}) {
    this.storeFile = options.storeFile ?? path.join(getRuntimeDir(), 'queue-monitors.json');
    this.githubExec = options.githubExec ?? defaultGhExec;
    this.watcherPolicyService = options.watcherPolicyService ?? new WatcherPolicyService();
    this.sandboxPolicyService = options.sandboxPolicyService ?? getSandboxPolicyService();
    this.budgetService = options.budgetService ?? getAgentBudgetService();
    this.governanceTraceService = options.governanceTraceService ?? getGovernanceTraceService();
    this.workflowService = options.workflowService ?? getWorkflowService();
    this.workflowRunService = options.workflowRunService ?? getWorkflowRunService();
    this.workflowAuthoringService =
      options.workflowAuthoringService ?? getWorkflowAuthoringService();
    this.telemetryService = options.telemetryService ?? getTelemetryService();
  }

  async list(now = new Date()): Promise<QueueMonitorListResponse> {
    await this.ensureLoaded();
    const monitors = this.currentStore()
      .monitors.map((monitor) => this.snapshot(monitor, now))
      .sort((a, b) => {
        const aNext = a.nextRunAt ? Date.parse(a.nextRunAt) : Number.POSITIVE_INFINITY;
        const bNext = b.nextRunAt ? Date.parse(b.nextRunAt) : Number.POSITIVE_INFINITY;
        if (aNext !== bNext) return aNext - bNext;
        return a.name.localeCompare(b.name);
      });
    const cutoff = now.getTime();
    const summary = monitors.reduce(
      (acc, monitor) => {
        acc.total++;
        if (monitor.enabled) acc.enabled++;
        if (!monitor.enabled) acc.paused++;
        if (monitor.health === 'blocked') acc.blocked++;
        if (monitor.lastStatus === 'failed' || monitor.lastStatus === 'blocked') acc.failed++;
        if (isMonitorDue(monitor, cutoff)) acc.due++;
        return acc;
      },
      { total: 0, enabled: 0, paused: 0, blocked: 0, failed: 0, due: 0 }
    );

    return {
      generatedAt: now.toISOString(),
      summary,
      monitors,
      recentEvents: this.currentStore().events.slice(-20).reverse(),
    };
  }

  async getMonitor(monitorId: string, now = new Date()): Promise<QueueMonitorSnapshot> {
    await this.ensureLoaded();
    const monitor = this.findDefinition(monitorId);
    return this.snapshot(monitor, now);
  }

  async health(monitorId: string, now = new Date()): Promise<QueueMonitorHealthResult> {
    const monitor = await this.getMonitor(monitorId, now);
    return {
      monitor,
      actionItem: monitor.actionItem,
    };
  }

  async explain(monitorId: string, now = new Date()): Promise<QueueMonitorExplainResult> {
    await this.ensureLoaded();
    const definition = this.findDefinition(monitorId);
    const packet = await this.buildPacket(definition, now);
    const action = await this.planAction(definition, packet, 'explain', now, { mutate: false });
    return {
      monitor: this.snapshot(definition, now),
      packet,
      action,
    };
  }

  async updateMonitor(
    monitorId: string,
    patch: QueueMonitorUpdateInput,
    now = new Date()
  ): Promise<QueueMonitorSnapshot> {
    await this.ensureLoaded();
    const store = this.currentStore();
    const index = store.monitors.findIndex((monitor) => monitor.id === monitorId);
    if (index === -1) throw new NotFoundError(`Queue monitor not found: ${monitorId}`);
    const current = store.monitors[index];
    const updated: QueueMonitorDefinition = {
      ...current,
      enabled: patch.enabled ?? current.enabled,
      mode: patch.mode ?? current.mode,
      runner: patch.runner ?? current.runner,
      intervalMinutes: clampInt(patch.intervalMinutes ?? current.intervalMinutes, 1, 24 * 60),
      maxCandidates: clampInt(patch.maxCandidates ?? current.maxCandidates, 1, 100),
      workflowId: nullableString(patch.workflowId, current.workflowId),
      assignee: nullableString(patch.assignee, current.assignee),
      sandboxPresetId: nullableString(patch.sandboxPresetId, current.sandboxPresetId),
      budget: patch.budget === null ? undefined : (patch.budget ?? current.budget),
      source: {
        ...current.source,
        repo: patch.repo?.trim() || current.source.repo,
        state: patch.state ?? current.source.state,
        labels: Array.isArray(patch.labels) ? normalizeLabels(patch.labels) : current.source.labels,
        includeIssues: patch.includeIssues ?? current.source.includeIssues,
        includePullRequests: patch.includePullRequests ?? current.source.includePullRequests,
      },
      stopConditions: {
        ...current.stopConditions,
        ...(patch.stopConditions ?? {}),
      },
      updatedAt: now.toISOString(),
    };
    store.monitors[index] = normalizeDefinition(updated);
    if (patch.enabled === true) {
      store.state[monitorId] = {
        ...this.stateFor(monitorId),
        failureStreak: 0,
        lastError: undefined,
        actionItem: undefined,
        nextRunAt: now.toISOString(),
      };
    }
    await this.saveStore();
    return this.snapshot(store.monitors[index], now);
  }

  async pause(monitorId: string, now = new Date()): Promise<QueueMonitorRunResult> {
    await this.ensureLoaded();
    const monitor = await this.updateMonitor(monitorId, { enabled: false }, now);
    const packet = emptyPacket(monitor, now);
    const action = actionRecord({
      action: 'none',
      status: 'success',
      summary: 'Queue monitor paused.',
      packet,
      checks: [],
      now,
    });
    const event = await this.recordEvent(monitor, 'pause', action, packet, now);
    return { monitor: await this.getMonitor(monitorId, now), packet, action, event };
  }

  async resume(monitorId: string, now = new Date()): Promise<QueueMonitorRunResult> {
    await this.ensureLoaded();
    const monitor = await this.updateMonitor(monitorId, { enabled: true }, now);
    const packet = emptyPacket(monitor, now);
    const action = actionRecord({
      action: 'none',
      status: 'success',
      summary: 'Queue monitor resumed.',
      packet,
      checks: [],
      now,
    });
    const event = await this.recordEvent(monitor, 'resume', action, packet, now);
    return { monitor: await this.getMonitor(monitorId, now), packet, action, event };
  }

  async runOnce(
    monitorId: string,
    trigger: QueueMonitorRunTrigger = 'manual-run',
    now = new Date()
  ): Promise<QueueMonitorRunResult> {
    await this.ensureLoaded();
    const definition = this.findDefinition(monitorId);
    const initialSnapshot = this.snapshot(definition, now);
    if (!definition.enabled) {
      const packet = emptyPacket(initialSnapshot, now);
      const action = actionRecord({
        action: 'none',
        status: 'skipped',
        summary: 'Queue monitor is paused.',
        packet,
        checks: [],
        now,
      });
      const event = await this.recordEvent(initialSnapshot, trigger, action, packet, now);
      return { monitor: await this.getMonitor(monitorId, now), packet, action, event };
    }

    if (initialSnapshot.health === 'blocked') {
      const packet = initialSnapshot.lastPacket ?? emptyPacket(initialSnapshot, now);
      const action = actionRecord({
        action: 'blocked',
        status: 'blocked',
        summary: initialSnapshot.healthSummary,
        packet,
        checks: [
          {
            name: 'circuit-breaker',
            status: 'block',
            summary: initialSnapshot.healthSummary,
          },
        ],
        now,
      });
      const event = await this.recordEvent(initialSnapshot, 'circuit-open', action, packet, now);
      return { monitor: await this.getMonitor(monitorId, now), packet, action, event };
    }

    if (this.runningMonitors.has(monitorId)) {
      const packet = initialSnapshot.lastPacket ?? emptyPacket(initialSnapshot, now);
      const action = actionRecord({
        action: 'none',
        status: 'skipped',
        summary: 'Queue monitor is already running.',
        packet,
        checks: [],
        now,
      });
      const event = await this.recordEvent(initialSnapshot, trigger, action, packet, now);
      return { monitor: await this.getMonitor(monitorId, now), packet, action, event };
    }

    this.runningMonitors.add(monitorId);
    const startedAt = Date.now();
    try {
      const packet = await this.buildPacket(definition, now);
      const action = await this.planAction(definition, packet, trigger, now, { mutate: true });
      const event = await this.recordEvent(
        this.snapshot(definition, now),
        trigger,
        action,
        packet,
        now,
        Date.now() - startedAt
      );
      return { monitor: await this.getMonitor(monitorId, now), packet, action, event };
    } catch (error) {
      const packet = initialSnapshot.lastPacket ?? emptyPacket(initialSnapshot, now);
      const action = actionRecord({
        action: 'blocked',
        status: 'failed',
        summary: 'Queue monitor scan failed.',
        error: errorMessage(error),
        packet,
        checks: [
          {
            name: 'github-scan',
            status: 'block',
            summary: errorMessage(error),
          },
        ],
        now,
      });
      const event = await this.recordEvent(
        this.snapshot(definition, now),
        trigger,
        action,
        packet,
        now,
        Date.now() - startedAt
      );
      return { monitor: await this.getMonitor(monitorId, now), packet, action, event };
    } finally {
      this.runningMonitors.delete(monitorId);
    }
  }

  async dueMonitors(now = new Date()): Promise<QueueMonitorSnapshot[]> {
    const list = await this.list(now);
    return list.monitors.filter((monitor) => isMonitorDue(monitor, now.getTime()));
  }

  recentEvents(limit = 20): QueueMonitorEvent[] {
    const store = this.store;
    if (!store) return [];
    return store.events.slice(-limit).reverse();
  }

  private async buildPacket(
    definition: QueueMonitorDefinition,
    now: Date
  ): Promise<QueueMonitorCandidatePacket> {
    const rawCandidates = await this.fetchGitHubCandidates(definition);
    const maxCandidates = clampInt(definition.maxCandidates, 1, 100);
    const candidates = rawCandidates
      .map((candidate) => scoreCandidate(candidate, definition))
      .sort(compareCandidates)
      .slice(0, maxCandidates);
    const skipped = candidates
      .filter((candidate) => candidate.blockers.length > 0)
      .map((candidate) => ({
        candidateId: candidate.id,
        title: candidate.title,
        reasons: candidate.blockers,
      }));
    const selected = candidates.find((candidate) => candidate.blockers.length === 0);
    return {
      id: `qmp_${nanoid(10)}`,
      monitorId: definition.id,
      generatedAt: now.toISOString(),
      repo: definition.source.repo,
      filters: {
        labels: definition.source.labels,
        state: definition.source.state,
        includeIssues: definition.source.includeIssues,
        includePullRequests: definition.source.includePullRequests,
        limit: maxCandidates,
      },
      candidates,
      selected,
      skipped,
      truncated: rawCandidates.length > maxCandidates,
      checks: [
        {
          name: 'github-scan',
          status: 'pass',
          summary: `Fetched ${rawCandidates.length} GitHub records from ${definition.source.repo}.`,
        },
      ],
    };
  }

  private async planAction(
    definition: QueueMonitorDefinition,
    packet: QueueMonitorCandidatePacket,
    trigger: QueueMonitorRunTrigger,
    now: Date,
    options: { mutate: boolean }
  ): Promise<QueueMonitorActionRecord> {
    const selected = packet.selected;
    if (!selected) {
      return actionRecord({
        action: 'none',
        status: 'skipped',
        summary:
          packet.candidates.length === 0
            ? 'No GitHub queue candidates matched the monitor filters.'
            : 'No candidate passed monitor blocker checks.',
        packet,
        checks: packet.checks,
        now,
      });
    }

    if (definition.mode === 'dry-run') {
      return actionRecord({
        action: 'dry-run',
        status: 'success',
        summary: `Dry run selected ${candidateLabel(selected)}.`,
        selectedCandidateId: selected.id,
        packet,
        checks: packet.checks,
        now,
      });
    }

    if (definition.mode === 'draft-plan') {
      return actionRecord({
        action: 'draft-plan',
        status: 'success',
        summary: `Draft plan ready for ${candidateLabel(selected)}.`,
        selectedCandidateId: selected.id,
        packet,
        checks: [
          ...packet.checks,
          {
            name: 'mutation',
            status: 'pass',
            summary:
              'Draft-plan mode records intent without mutating GitHub or starting workflows.',
          },
        ],
        now,
      });
    }

    const gate = await this.evaluateGates(definition, packet, trigger);
    const blocker = gate.checks.find((check) => check.status === 'block');
    if (blocker) {
      return actionRecord({
        action: 'blocked',
        status: 'blocked',
        summary: blocker.summary,
        selectedCandidateId: selected.id,
        packet,
        checks: gate.checks,
        policy: gate.policy,
        sandbox: gate.sandbox,
        budgetDecision: gate.budgetDecision,
        now,
      });
    }

    if (!options.mutate || trigger === 'explain') {
      return actionRecord({
        action: definition.mode === 'assign-only' ? 'assign' : 'start-workflow',
        status: 'success',
        summary: `Policy gates passed for ${candidateLabel(selected)}.`,
        selectedCandidateId: selected.id,
        packet,
        checks: gate.checks,
        policy: gate.policy,
        sandbox: gate.sandbox,
        budgetDecision: gate.budgetDecision,
        now,
      });
    }

    if (definition.mode === 'assign-only') {
      if (!definition.assignee) {
        return actionRecord({
          action: 'blocked',
          status: 'blocked',
          summary: 'Assign-only mode requires an assignee.',
          selectedCandidateId: selected.id,
          packet,
          checks: [
            ...gate.checks,
            { name: 'assignee', status: 'block', summary: 'Assign-only mode requires assignee.' },
          ],
          policy: gate.policy,
          sandbox: gate.sandbox,
          budgetDecision: gate.budgetDecision,
          now,
        });
      }
      await this.githubExec([
        'issue',
        'edit',
        String(selected.number),
        '--repo',
        selected.repo,
        '--add-assignee',
        definition.assignee,
      ]);
      return actionRecord({
        action: 'assign',
        status: 'success',
        summary: `Assigned ${candidateLabel(selected)} to ${definition.assignee}.`,
        selectedCandidateId: selected.id,
        packet,
        checks: gate.checks,
        policy: gate.policy,
        sandbox: gate.sandbox,
        budgetDecision: gate.budgetDecision,
        now,
      });
    }

    const run = await this.startWorkflow(definition, packet, selected, trigger, now);
    return actionRecord({
      action: 'start-workflow',
      status: 'started',
      summary: `Started workflow ${run.id} for ${candidateLabel(selected)}.`,
      selectedCandidateId: selected.id,
      sourceRunId: run.id,
      packet,
      checks: gate.checks,
      policy: gate.policy,
      sandbox: gate.sandbox,
      budgetDecision: gate.budgetDecision,
      now,
    });
  }

  private async evaluateGates(
    definition: QueueMonitorDefinition,
    packet: QueueMonitorCandidatePacket,
    trigger: QueueMonitorRunTrigger
  ): Promise<GateContext> {
    const selected = packet.selected;
    const checks: QueueMonitorGateCheck[] = [...packet.checks];
    if (!selected) return { checks };

    checks.push({
      name: 'runner',
      status: definition.runner === 'local' ? 'pass' : 'block',
      summary:
        definition.runner === 'local'
          ? 'Local runner is available.'
          : 'GitHub Actions runner mode requires a dispatch adapter before launch.',
    });

    const policy = await this.watcherPolicyService.evaluateContinuation(
      {
        runId: `queue-monitor:${definition.id}`,
        project: MONITOR_PROJECT,
        agent: MONITOR_AGENT,
        prompt: monitorDispatchPrompt(definition, selected),
        continuationCount: this.stateFor(definition.id).failureStreak,
        metadata: {
          monitorId: definition.id,
          trigger,
          candidate: {
            kind: selected.kind,
            repo: selected.repo,
            number: selected.number,
            url: selected.url,
          },
        },
      },
      { actor: MONITOR_AGENT }
    );
    checks.push({
      name: 'watcher-policy',
      status:
        policy.decision === 'block'
          ? 'block'
          : policy.decision === 'require_approval'
            ? 'block'
            : 'pass',
      summary:
        policy.decision === 'allow'
          ? 'Watcher policy allowed the action.'
          : `Watcher policy returned ${policy.decision}.`,
      evidence: policy.reasons,
    });

    let sandbox: QueueMonitorActionRecord['sandbox'];
    const sandboxResult = await this.sandboxPolicyService.dryRun({
      presetId: definition.sandboxPresetId ?? DEFAULT_SANDBOX_PRESET_ID,
      provider: 'codex-cli',
    });
    sandbox = {
      presetId: sandboxResult.preset.id,
      decision: sandboxResult.decision,
      provider: sandboxResult.provider,
      warnings: sandboxResult.warnings,
      remediation: sandboxResult.remediation,
    };
    checks.push({
      name: 'sandbox',
      status: sandboxResult.decision === 'block' ? 'block' : 'pass',
      summary:
        sandboxResult.decision === 'block'
          ? `Sandbox preset ${sandboxResult.preset.id} cannot be enforced.`
          : `Sandbox preset ${sandboxResult.preset.id} is usable.`,
      evidence: sandboxResult.warnings,
    });

    const budgetDecision = await this.evaluateBudget(definition, selected);
    checks.push({
      name: 'budget',
      status: isBlockingBudgetDecision(budgetDecision) ? 'block' : 'pass',
      summary: `Budget decision: ${budgetDecision}.`,
    });

    if (definition.mode === 'execute') {
      if (!definition.workflowId) {
        checks.push({
          name: 'workflow',
          status: 'block',
          summary: 'Execute mode requires a workflowId before launching work.',
        });
      } else {
        const workflow = await this.workflowService.loadWorkflow(definition.workflowId);
        if (!workflow) {
          checks.push({
            name: 'workflow',
            status: 'block',
            summary: `Workflow not found: ${definition.workflowId}.`,
          });
        } else {
          const dryRun = await this.workflowAuthoringService.dryRun({
            workflow,
            context: {
              clientMode: 'local',
            },
          });
          const blocker = dryRun.messages.find((message) => message.severity === 'error');
          checks.push({
            name: 'workflow',
            status: blocker ? 'block' : 'pass',
            summary: blocker?.message ?? `Workflow ${workflow.id} passed dry-run validation.`,
          });
        }
      }
    }

    return { checks, policy, sandbox, budgetDecision };
  }

  private async evaluateBudget(
    definition: QueueMonitorDefinition,
    selected: QueueMonitorCandidate
  ): Promise<string> {
    const policy = this.budgetService.resolve({ runBudget: definition.budget });
    const evaluation = this.budgetService.evaluate(
      policy,
      { fanOut: 1 },
      {
        actionType: 'queue-monitor.run',
        project: MONITOR_PROJECT,
        workflowId: definition.workflowId,
        taskId: selected.id,
      }
    );
    if (evaluation.trace) {
      await this.governanceTraceService.record(evaluation.trace);
    }
    return evaluation.decision;
  }

  private async startWorkflow(
    definition: QueueMonitorDefinition,
    packet: QueueMonitorCandidatePacket,
    selected: QueueMonitorCandidate,
    trigger: QueueMonitorRunTrigger,
    now: Date
  ) {
    if (!definition.workflowId) {
      throw new ValidationError('Execute mode requires workflowId');
    }
    return this.workflowRunService.startRun(
      definition.workflowId,
      undefined,
      {
        queueMonitor: {
          monitorId: definition.id,
          packetId: packet.id,
          trigger,
          selectedAt: now.toISOString(),
          candidate: {
            id: selected.id,
            kind: selected.kind,
            repo: selected.repo,
            number: selected.number,
            title: selected.title,
            url: selected.url,
            labels: selected.labels,
            ciState: selected.ciState,
          },
        },
      },
      definition.budget
    );
  }

  private async fetchGitHubCandidates(
    definition: QueueMonitorDefinition
  ): Promise<QueueMonitorCandidate[]> {
    const limit = clampInt(definition.maxCandidates * 2, 1, 100);
    const candidates: QueueMonitorCandidate[] = [];
    if (definition.source.includeIssues) {
      const issues = await this.ghJson<GhIssue[]>(issueListArgs(definition, limit));
      candidates.push(...issues.map((issue) => issueCandidate(definition.source.repo, issue)));
    }
    if (definition.source.includePullRequests) {
      const prs = await this.ghJson<GhPullRequest[]>(prListArgs(definition, limit));
      candidates.push(...prs.map((pr) => prCandidate(definition.source.repo, pr)));
    }
    return candidates;
  }

  private async ghJson<T>(args: string[]): Promise<T> {
    const stdout = await this.githubExec(args);
    return JSON.parse(stdout || '[]') as T;
  }

  private async recordEvent(
    monitor: QueueMonitorSnapshot,
    type: QueueMonitorEventType,
    action: QueueMonitorActionRecord,
    packet: QueueMonitorCandidatePacket,
    now: Date,
    durationMs?: number
  ): Promise<QueueMonitorEvent> {
    await this.ensureLoaded();
    const store = this.currentStore();
    const state = this.stateFor(monitor.id);
    const failure = action.status === 'failed' || action.status === 'blocked';
    const failureStreak = failure ? state.failureStreak + 1 : 0;
    const actionItem =
      failureStreak >= failureThreshold(monitor)
        ? {
            id: `qmai_${nanoid(8)}`,
            title: `Queue monitor blocked: ${monitor.name}`,
            severity: 'blocker' as const,
            summary: action.summary,
            remediation:
              'Review GitHub auth, policy settings, budget, sandbox, workflow configuration, or candidate blockers before resuming this monitor.',
            createdAt: now.toISOString(),
          }
        : failure
          ? state.actionItem
          : undefined;

    store.state[monitor.id] = {
      ...state,
      lastScanAt:
        type === 'manual-run' || type === 'due-run' || type === 'explain'
          ? now.toISOString()
          : state.lastScanAt,
      lastActionAt: now.toISOString(),
      nextRunAt: nextRunAt(monitor, now),
      failureStreak,
      lastStatus: action.status,
      lastSummary: action.summary,
      lastError: action.error,
      lastPacket: packet,
      lastAction: action,
      actionItem,
    };

    const event: QueueMonitorEvent = {
      id: `qm_evt_${nanoid(10)}`,
      monitorId: monitor.id,
      type,
      status: action.status,
      action: action.action,
      summary: action.summary,
      createdAt: now.toISOString(),
      durationMs,
      error: action.error,
      selectedCandidateId: action.selectedCandidateId,
      sourceRunId: action.sourceRunId,
      skippedReasons: action.skippedReasons,
    };
    store.events.push(event);
    store.events = store.events.slice(-MAX_EVENTS);
    await this.saveStore();
    await this.emitTelemetry(monitor.id, event);
    log.info(
      { monitorId: monitor.id, eventId: event.id, status: event.status, action: event.action },
      'Queue monitor event recorded'
    );
    return event;
  }

  private async emitTelemetry(monitorId: string, event: QueueMonitorEvent): Promise<void> {
    const base = {
      taskId: `queue-monitor:${monitorId}`,
      project: MONITOR_PROJECT,
      agent: MONITOR_AGENT,
      attemptId: event.id,
      durationMs: event.durationMs,
      error: event.error,
    };
    if (event.status === 'failed' || event.status === 'blocked') {
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

  private snapshot(definition: QueueMonitorDefinition, now: Date): QueueMonitorSnapshot {
    const state = this.stateFor(definition.id);
    const next = state.nextRunAt ?? (definition.enabled ? now.toISOString() : undefined);
    const base: QueueMonitorSnapshot = {
      ...definition,
      health: 'healthy',
      healthSummary: 'Ready',
      lastScanAt: state.lastScanAt,
      lastActionAt: state.lastActionAt,
      nextRunAt: next,
      failureStreak: state.failureStreak,
      lastStatus: state.lastStatus,
      lastSummary: state.lastSummary,
      lastError: state.lastError,
      lastPacket: state.lastPacket,
      lastAction: state.lastAction,
      actionItem: state.actionItem,
      actions: {
        canRun: true,
        canPause: definition.enabled,
        canResume: !definition.enabled,
        canExplain: true,
      },
    };

    if (!definition.enabled) {
      return { ...base, health: 'paused', healthSummary: 'Paused' };
    }
    if (state.failureStreak >= failureThreshold(definition)) {
      return {
        ...base,
        health: 'blocked',
        healthSummary: state.actionItem?.summary ?? 'Failure threshold reached.',
      };
    }
    if (state.failureStreak > 0) {
      return {
        ...base,
        health: 'warning',
        healthSummary: `${state.failureStreak} consecutive failure${state.failureStreak === 1 ? '' : 's'}.`,
      };
    }
    if (definition.mode === 'execute' && !definition.workflowId) {
      return {
        ...base,
        health: 'warning',
        healthSummary: 'Execute mode needs workflowId before launch.',
      };
    }
    return base;
  }

  private findDefinition(monitorId: string): QueueMonitorDefinition {
    const monitor = this.currentStore().monitors.find((candidate) => candidate.id === monitorId);
    if (!monitor) throw new NotFoundError(`Queue monitor not found: ${monitorId}`);
    return monitor;
  }

  private stateFor(monitorId: string): QueueMonitorState {
    const store = this.currentStore();
    store.state[monitorId] ??= { failureStreak: 0 };
    return store.state[monitorId];
  }

  private async ensureLoaded(): Promise<void> {
    if (this.store) return;
    try {
      const raw = await fs.readFile(this.storeFile, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<QueueMonitorStore>;
      this.store = normalizeStore(parsed);
    } catch {
      this.store = defaultStore();
    }
  }

  private currentStore(): QueueMonitorStore {
    if (!this.store) throw new Error('Queue monitor store has not been loaded');
    return this.store;
  }

  private async saveStore(): Promise<void> {
    await fs.mkdir(path.dirname(this.storeFile), { recursive: true });
    await fs.writeFile(this.storeFile, JSON.stringify(this.store, null, 2), 'utf-8');
  }
}

async function defaultGhExec(args: string[]): Promise<string> {
  const ghBreaker = getBreaker('github');
  const { stdout } = await ghBreaker.execute(() => execFileAsync('gh', args));
  return stdout.trim();
}

function defaultStore(): QueueMonitorStore {
  return {
    version: STORE_VERSION,
    monitors: [defaultBacklogMonitor()],
    state: {},
    events: [],
  };
}

function defaultBacklogMonitor(): QueueMonitorDefinition {
  return {
    id: 'veritas-backlog-high-priority',
    name: 'Veritas high-priority backlog',
    description: 'Scan open high-priority Veritas issues and PRs for the next policy-safe action.',
    enabled: true,
    source: {
      kind: 'github',
      repo: 'BradGroux/veritas-kanban',
      state: 'open',
      labels: ['priority: high'],
      includeIssues: true,
      includePullRequests: true,
    },
    mode: 'dry-run',
    runner: 'local',
    intervalMinutes: DEFAULT_INTERVAL_MINUTES,
    maxCandidates: DEFAULT_MAX_CANDIDATES,
    sandboxPresetId: DEFAULT_SANDBOX_PRESET_ID,
    stopConditions: {
      maxFailureStreak: DEFAULT_FAILURE_THRESHOLD,
      skipBlockedLabels: DEFAULT_BLOCKED_LABELS,
      skipDraftPullRequests: true,
      skipFailedChecks: true,
    },
    tags: ['github', 'backlog', 'operations'],
    createdAt: DEFAULT_CREATED_AT,
    updatedAt: DEFAULT_CREATED_AT,
  };
}

function normalizeStore(input: Partial<QueueMonitorStore>): QueueMonitorStore {
  const monitors = Array.isArray(input.monitors) ? input.monitors : [defaultBacklogMonitor()];
  return {
    version: STORE_VERSION,
    monitors: monitors.map(normalizeDefinition),
    state: input.state ?? {},
    events: Array.isArray(input.events) ? input.events.slice(-MAX_EVENTS) : [],
  };
}

function normalizeDefinition(input: QueueMonitorDefinition): QueueMonitorDefinition {
  const fallback = defaultBacklogMonitor();
  return {
    ...fallback,
    ...input,
    source: {
      ...fallback.source,
      ...input.source,
      labels: normalizeLabels(input.source?.labels ?? fallback.source.labels),
      includeIssues: input.source?.includeIssues ?? true,
      includePullRequests: input.source?.includePullRequests ?? true,
    },
    intervalMinutes: clampInt(input.intervalMinutes, 1, 24 * 60),
    maxCandidates: clampInt(input.maxCandidates, 1, 100),
    stopConditions: {
      ...fallback.stopConditions,
      ...(input.stopConditions ?? {}),
    },
    tags: Array.isArray(input.tags) ? input.tags : [],
  };
}

function issueListArgs(definition: QueueMonitorDefinition, limit: number): string[] {
  const args = [
    'issue',
    'list',
    '--repo',
    definition.source.repo,
    '--state',
    definition.source.state,
    '--limit',
    String(limit),
    '--json',
    'number,title,state,labels,assignees,author,createdAt,updatedAt,url,comments',
  ];
  addLabelArgs(args, definition.source.labels);
  return args;
}

function prListArgs(definition: QueueMonitorDefinition, limit: number): string[] {
  const args = [
    'pr',
    'list',
    '--repo',
    definition.source.repo,
    '--state',
    definition.source.state,
    '--limit',
    String(limit),
    '--json',
    'number,title,state,labels,assignees,author,createdAt,updatedAt,url,isDraft,reviewDecision,statusCheckRollup',
  ];
  addLabelArgs(args, definition.source.labels);
  return args;
}

function addLabelArgs(args: string[], labels: string[]): void {
  for (const label of labels) {
    args.push('--label', label);
  }
}

function issueCandidate(repo: string, issue: GhIssue): QueueMonitorCandidate {
  return {
    id: `${repo}#${issue.number}`,
    kind: 'issue',
    repo,
    number: issue.number,
    title: issue.title,
    url: issue.url,
    state: issue.state,
    labels: labelNames(issue.labels),
    assignees: userLogins(issue.assignees),
    author: issue.author?.login,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    comments: issue.comments,
    ciState: 'unknown',
    blockers: [],
    score: 0,
    reasons: [],
  };
}

function prCandidate(repo: string, pr: GhPullRequest): QueueMonitorCandidate {
  return {
    id: `${repo}#${pr.number}`,
    kind: 'pull-request',
    repo,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: pr.state,
    labels: labelNames(pr.labels),
    assignees: userLogins(pr.assignees),
    author: pr.author?.login,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    isDraft: Boolean(pr.isDraft),
    reviewDecision: pr.reviewDecision,
    ciState: statusCheckState(pr.statusCheckRollup),
    blockers: [],
    score: 0,
    reasons: [],
  };
}

function scoreCandidate(
  candidate: QueueMonitorCandidate,
  definition: QueueMonitorDefinition
): QueueMonitorCandidate {
  const labels = candidate.labels.map((label) => label.toLowerCase());
  const blockers: string[] = [];
  const blockedLabels = definition.stopConditions.skipBlockedLabels ?? DEFAULT_BLOCKED_LABELS;
  for (const blocked of blockedLabels) {
    if (labels.includes(blocked.toLowerCase())) {
      blockers.push(`Blocked by label: ${blocked}`);
    }
  }
  if (candidate.kind === 'pull-request' && definition.stopConditions.skipDraftPullRequests) {
    if (candidate.isDraft) blockers.push('Draft pull request.');
  }
  if (
    candidate.kind === 'pull-request' &&
    definition.stopConditions.skipFailedChecks &&
    candidate.ciState === 'failing'
  ) {
    blockers.push('Pull request has failing CI.');
  }

  const reasons: string[] = [];
  let score = 0;
  if (labels.includes('priority: high')) {
    score += 100;
    reasons.push('high priority');
  } else if (labels.includes('priority: medium')) {
    score += 50;
    reasons.push('medium priority');
  } else if (labels.includes('priority: low')) {
    score += 10;
    reasons.push('low priority');
  }
  if (candidate.assignees.length === 0) {
    score += 15;
    reasons.push('unassigned');
  }
  if (candidate.kind === 'issue') {
    score += 10;
    reasons.push('issue intake');
  }
  if (candidate.kind === 'pull-request' && candidate.ciState === 'passing') {
    score += 20;
    reasons.push('passing checks');
  }
  if (candidate.kind === 'pull-request' && candidate.ciState === 'pending') {
    score -= 10;
    reasons.push('pending checks');
  }
  const ageDays = Math.max(0, (Date.now() - Date.parse(candidate.updatedAt)) / 86_400_000);
  score += Math.min(20, Math.floor(ageDays));

  return {
    ...candidate,
    blockers,
    score,
    reasons,
  };
}

function compareCandidates(a: QueueMonitorCandidate, b: QueueMonitorCandidate): number {
  if (a.blockers.length !== b.blockers.length) return a.blockers.length - b.blockers.length;
  if (a.score !== b.score) return b.score - a.score;
  const updatedDelta = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
  if (updatedDelta !== 0) return updatedDelta;
  return a.id.localeCompare(b.id);
}

function statusCheckState(
  checks?: GhPullRequest['statusCheckRollup']
): QueueMonitorCandidate['ciState'] {
  if (!checks || checks.length === 0) return 'unknown';
  if (
    checks.some((check) =>
      ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'].includes(
        (check.conclusion ?? '').toUpperCase()
      )
    )
  ) {
    return 'failing';
  }
  if (
    checks.some((check) => {
      const status = (check.status ?? check.state ?? '').toUpperCase();
      const conclusion = (check.conclusion ?? '').toUpperCase();
      return status !== 'COMPLETED' && conclusion !== 'SUCCESS';
    })
  ) {
    return 'pending';
  }
  return 'passing';
}

function actionRecord(params: {
  action: QueueMonitorAction;
  status: QueueMonitorRunStatus;
  summary: string;
  packet: QueueMonitorCandidatePacket;
  checks: QueueMonitorGateCheck[];
  now: Date;
  selectedCandidateId?: string;
  sourceRunId?: string;
  error?: string;
  policy?: WatcherContinuationEvaluationResult;
  sandbox?: QueueMonitorActionRecord['sandbox'];
  budgetDecision?: string;
}): QueueMonitorActionRecord {
  return {
    action: params.action,
    status: params.status,
    summary: params.summary,
    selectedCandidateId: params.selectedCandidateId,
    sourceRunId: params.sourceRunId,
    error: params.error,
    skippedReasons: params.packet.skipped.flatMap((item) =>
      item.reasons.map((reason) => `${item.title}: ${reason}`)
    ),
    policy: params.policy,
    sandbox: params.sandbox,
    budgetDecision: params.budgetDecision,
    gateChecks: params.checks,
    recordedAt: params.now.toISOString(),
  };
}

function emptyPacket(
  monitor: Pick<QueueMonitorDefinition, 'id' | 'source' | 'maxCandidates'>,
  now: Date
): QueueMonitorCandidatePacket {
  return {
    id: `qmp_${nanoid(10)}`,
    monitorId: monitor.id,
    generatedAt: now.toISOString(),
    repo: monitor.source.repo,
    filters: {
      labels: monitor.source.labels,
      state: monitor.source.state,
      includeIssues: monitor.source.includeIssues,
      includePullRequests: monitor.source.includePullRequests,
      limit: monitor.maxCandidates,
    },
    candidates: [],
    skipped: [],
    truncated: false,
    checks: [],
  };
}

function monitorDispatchPrompt(
  definition: QueueMonitorDefinition,
  selected: QueueMonitorCandidate
): string {
  return JSON.stringify({
    mode: definition.mode,
    runner: definition.runner,
    monitorId: definition.id,
    action: definition.mode === 'execute' ? 'start-workflow' : 'assign',
    repo: selected.repo,
    candidate: {
      kind: selected.kind,
      number: selected.number,
      title: selected.title,
      url: selected.url,
      labels: selected.labels,
    },
  });
}

function candidateLabel(candidate: QueueMonitorCandidate): string {
  return `${candidate.repo}#${candidate.number} ${candidate.title}`;
}

function labelNames(labels?: GhLabel[]): string[] {
  return (labels ?? [])
    .map((label) => label.name)
    .filter(Boolean)
    .sort();
}

function userLogins(users?: GhUser[]): string[] {
  return (users ?? []).map((user) => user.login).filter((login): login is string => Boolean(login));
}

function normalizeLabels(labels: string[]): string[] {
  return [...new Set(labels.map((label) => label.trim()).filter(Boolean))].sort();
}

function nullableString(value: string | null | undefined, fallback?: string): string | undefined {
  if (value === null) return undefined;
  if (typeof value === 'string') return value.trim() || undefined;
  return fallback;
}

function clampInt(value: unknown, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function failureThreshold(monitor: Pick<QueueMonitorDefinition, 'stopConditions'>): number {
  return clampInt(monitor.stopConditions.maxFailureStreak ?? DEFAULT_FAILURE_THRESHOLD, 1, 20);
}

function nextRunAt(
  monitor: Pick<QueueMonitorDefinition, 'enabled' | 'intervalMinutes'>,
  now: Date
): string | undefined {
  if (!monitor.enabled) return undefined;
  return new Date(now.getTime() + monitor.intervalMinutes * 60_000).toISOString();
}

function isMonitorDue(monitor: QueueMonitorSnapshot, cutoff: number): boolean {
  if (!monitor.enabled || monitor.health === 'blocked' || monitor.health === 'paused') return false;
  if (!monitor.nextRunAt) return false;
  const next = Date.parse(monitor.nextRunAt);
  return Number.isFinite(next) && next <= cutoff;
}

function isBlockingBudgetDecision(decision: string): boolean {
  return decision === 'pause' || decision === 'require-approval' || decision === 'cancel';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let queueIntakeMonitorServiceInstance: QueueIntakeMonitorService | null = null;

export function getQueueIntakeMonitorService(): QueueIntakeMonitorService {
  if (!queueIntakeMonitorServiceInstance) {
    queueIntakeMonitorServiceInstance = new QueueIntakeMonitorService();
  }
  return queueIntakeMonitorServiceInstance;
}

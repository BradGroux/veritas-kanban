/**
 * WorkflowRunService — Executes workflows, manages run state, orchestrates step execution
 * Phase 1: Core Engine (sequential steps, basic retry logic)
 */

import fs from 'fs/promises';
import path from 'path';
import { nanoid } from 'nanoid';
import {
  buildWorkflowPipelineSummary,
  ZERO_AGENT_BUDGET_USAGE,
  type AgentBudgetDecision,
  type AgentBudgetPolicy,
  type AgentBudgetThresholdEvent,
  type AgentBudgetUsage,
  type WorkflowPipelineRoleStatusPatch,
  type WorkflowSubagentRunStatus,
  type WorkflowSubagentTelemetry,
} from '@veritas-kanban/shared';
import type { WorkflowRun, StepRun, WorkflowDefinition, WorkflowStep } from '../types/workflow.js';
import { getWorkflowService } from './workflow-service.js';
import { WorkflowStepExecutor } from './workflow-step-executor.js';
import { getWorkflowRunsDir } from '../utils/paths.js';
import { createLogger } from '../lib/logger.js';
import { broadcastWorkflowStatus } from './broadcast-service.js';
import { getTaskService } from './task-service.js';
import { SqliteDatabase, type SqliteConnectionOptions } from '../storage/sqlite/database.js';
import { SqliteWorkflowRunRepository } from '../storage/sqlite/workflow-repositories.js';
import { getConfigService } from './config-service.js';
import { getAgentBudgetService } from './agent-budget-service.js';
import { getGovernanceTraceService } from './governance-trace-service.js';

const log = createLogger('workflow-run');

// Concurrency limits
const MAX_CONCURRENT_RUNS = 10;
let activeRunCount = 0;
const RUN_ID_PATTERN = /^run_\d{10,}_[a-zA-Z0-9_-]{6,}$/;
const RESERVED_CONTEXT_KEYS = new Set([
  'task',
  'workflow',
  'run',
  'pipeline',
  '_sessions',
  '_retryContext',
]);

class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class WorkflowRunService {
  private runsDir: string;
  private workflowService: ReturnType<typeof getWorkflowService>;
  private stepExecutor: WorkflowStepExecutor;
  private readonly repository: SqliteWorkflowRunRepository | null = null;
  private readonly sqliteDatabase: SqliteDatabase | null = null;
  private readonly ownsSqliteDatabase: boolean = false;

  constructor(options: string | WorkflowRunServiceOptions = {}) {
    const resolvedOptions = typeof options === 'string' ? { runsDir: options } : options;
    this.runsDir = resolvedOptions.runsDir || getWorkflowRunsDir();
    this.workflowService = resolvedOptions.workflowService ?? getWorkflowService();
    this.stepExecutor = new WorkflowStepExecutor(resolvedOptions.runsDir);
    const storageType =
      resolvedOptions.storageType ?? (process.env.VERITAS_STORAGE === 'sqlite' ? 'sqlite' : 'file');

    if (storageType === 'sqlite') {
      this.sqliteDatabase =
        resolvedOptions.sqliteDatabase ??
        new SqliteDatabase(resolvedOptions.sqliteConnectionOptions);
      this.ownsSqliteDatabase = !resolvedOptions.sqliteDatabase;
      this.sqliteDatabase.open();
      this.repository = new SqliteWorkflowRunRepository(this.sqliteDatabase);
    }

    if (!this.repository) {
      this.ensureDirectories();
    }
  }

  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.runsDir, { recursive: true });
  }

  private normalizeRunId(runId: string): string {
    const trimmed = (runId ?? '').trim();
    if (!trimmed) {
      throw new ValidationError('Run ID is required');
    }

    if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
      throw new ValidationError('Run ID contains illegal path characters');
    }

    if (!RUN_ID_PATTERN.test(trimmed)) {
      throw new ValidationError('Run ID format is invalid');
    }

    return trimmed;
  }

  private syncPipelineSummary(run: WorkflowRun, workflow: WorkflowDefinition): void {
    const baseSummary = buildWorkflowPipelineSummary(workflow);
    if (!baseSummary) return;

    const patches: WorkflowPipelineRoleStatusPatch = {};
    for (const role of baseSummary.roles) {
      patches[role.id] = this.pipelineRoleStatusPatch(role.agent, run, workflow);
    }
    run.context.pipeline = buildWorkflowPipelineSummary(workflow, patches);
  }

  private pipelineRoleStatusPatch(
    agentId: string,
    run: WorkflowRun,
    workflow: WorkflowDefinition
  ): { status: WorkflowSubagentRunStatus; telemetry: WorkflowSubagentTelemetry } {
    const statuses: WorkflowSubagentRunStatus[] = [];
    const telemetry: WorkflowSubagentTelemetry = {};
    let durationSeconds = 0;

    for (const step of workflow.steps) {
      const stepRun = run.steps.find((candidate) => candidate.stepId === step.id);
      if (!stepRun) continue;

      if (step.agent === agentId) {
        statuses.push(this.stepStatusForPipeline(stepRun, run));
        this.mergeStepTelemetry(telemetry, stepRun);
        durationSeconds += stepRun.duration ?? 0;
      }

      for (const subStep of step.parallel?.steps ?? []) {
        if (subStep.agent !== agentId) continue;
        statuses.push(this.parallelSubstepStatus(step, subStep.id, stepRun, run));
        this.mergeStepTelemetry(telemetry, stepRun);
        durationSeconds += stepRun.duration ?? 0;
      }
    }

    if (durationSeconds > 0) {
      telemetry.durationSeconds = durationSeconds;
    }

    return {
      status: this.resolvePipelineStatus(statuses),
      telemetry,
    };
  }

  private stepStatusForPipeline(stepRun: StepRun, run: WorkflowRun): WorkflowSubagentRunStatus {
    if (run.status === 'blocked' && run.currentStep === stepRun.stepId) return 'blocked';
    return stepRun.status;
  }

  private parallelSubstepStatus(
    step: WorkflowStep,
    subStepId: string,
    stepRun: StepRun,
    run: WorkflowRun
  ): WorkflowSubagentRunStatus {
    const output = run.context[step.id];
    const subSteps =
      output &&
      typeof output === 'object' &&
      Array.isArray((output as { subSteps?: unknown }).subSteps)
        ? (output as { subSteps: Array<{ id?: string; status?: string }> }).subSteps
        : [];
    const subStepOutput = subSteps.find((candidate) => candidate.id === subStepId);
    if (subStepOutput?.status === 'fulfilled') return 'completed';
    if (subStepOutput?.status === 'rejected') return 'failed';
    if (run.status === 'blocked' && run.currentStep === step.id) return 'blocked';
    if (stepRun.status === 'running') return 'running';
    if (stepRun.status === 'failed') return 'failed';
    if (stepRun.status === 'skipped') return 'skipped';
    return 'pending';
  }

  private resolvePipelineStatus(statuses: WorkflowSubagentRunStatus[]): WorkflowSubagentRunStatus {
    if (statuses.length === 0) return 'pending';
    if (statuses.includes('failed')) return 'failed';
    if (statuses.includes('blocked')) return 'blocked';
    if (statuses.includes('running')) return 'running';
    if (statuses.every((status) => status === 'completed')) return 'completed';
    if (statuses.every((status) => status === 'skipped')) return 'skipped';
    if (statuses.includes('completed')) return 'completed';
    return 'pending';
  }

  private isBlockingBudgetDecision(decision: AgentBudgetDecision): boolean {
    return decision === 'pause' || decision === 'require-approval' || decision === 'cancel';
  }

  private async evaluateRunBudget(
    run: WorkflowRun,
    workflow: WorkflowDefinition,
    step: WorkflowStep,
    actionType: string,
    enforce: boolean,
    delta: Partial<AgentBudgetUsage> = {}
  ): Promise<boolean> {
    if (!run.budget?.enabled) return false;

    const agentDef = step.agent
      ? workflow.agents.find((candidate) => candidate.id === step.agent)
      : undefined;
    const activeAgentBudget =
      agentDef?.budget?.enabled &&
      agentDef.budget.limits &&
      Object.keys(agentDef.budget.limits).length > 0
        ? agentDef.budget
        : undefined;
    const budgetService = getAgentBudgetService();
    const effectivePolicy =
      budgetService.resolve({
        workflowBudget: run.budget.policy,
        workflowAgentBudget: activeAgentBudget,
      }) ?? run.budget.policy;
    if (!effectivePolicy) return false;
    const runtimeSeconds = Math.ceil((Date.now() - new Date(run.startedAt).getTime()) / 1000);
    const retries = run.steps.reduce((sum, stepRun) => sum + stepRun.retries, 0);
    const fanOut = Math.max(run.budget.usage.fanOut, step.parallel?.steps.length ?? 1);
    run.budget.usage = budgetService.mergeUsage(run.budget.usage, {
      ...delta,
      runtimeSeconds,
      retries,
      fanOut,
    });

    const evaluation = budgetService.evaluate(effectivePolicy, run.budget.usage, {
      workflowId: run.workflowId,
      runId: run.id,
      taskId: run.taskId,
      stepId: step.id,
      agentId: step.agent,
      actionType,
    });
    if (!activeAgentBudget) {
      run.budget.policy = effectivePolicy;
    }
    run.budget.decision = evaluation.decision;
    run.budget.modelOverride ??= evaluation.modelOverride;
    run.budget.thresholdEvents = mergeBudgetThresholdEvents(
      run.budget.thresholdEvents,
      evaluation.thresholdEvents
    );

    if (evaluation.trace) {
      const trace = await getGovernanceTraceService().record(evaluation.trace);
      run.budget.traceIds = [...new Set([...run.budget.traceIds, trace.id])];
    }

    if (!enforce || !this.isBlockingBudgetDecision(evaluation.decision)) {
      return false;
    }

    const detail = evaluation.thresholdEvents.map((event) => event.message).join(' ');
    if (evaluation.decision === 'cancel') {
      run.status = 'failed';
      run.error = `Budget cancel: ${detail}`;
      run.completedAt = new Date().toISOString();
    } else {
      run.status = 'blocked';
      run.error = `Budget ${evaluation.decision}: ${detail}`;
    }
    this.syncPipelineSummary(run, workflow);
    return true;
  }

  private mergeStepTelemetry(telemetry: WorkflowSubagentTelemetry, stepRun: StepRun): void {
    if (stepRun.startedAt) {
      telemetry.startedAt =
        !telemetry.startedAt || stepRun.startedAt < telemetry.startedAt
          ? stepRun.startedAt
          : telemetry.startedAt;
    }
    if (stepRun.completedAt) {
      telemetry.completedAt =
        !telemetry.completedAt || stepRun.completedAt > telemetry.completedAt
          ? stepRun.completedAt
          : telemetry.completedAt;
    }
  }

  /**
   * Start a new workflow run
   */
  async startRun(
    workflowId: string,
    taskId?: string,
    initialContext?: Record<string, unknown>,
    runBudget?: AgentBudgetPolicy
  ): Promise<WorkflowRun> {
    // Check concurrency limit
    if (activeRunCount >= MAX_CONCURRENT_RUNS) {
      throw new ValidationError(
        `Maximum concurrent workflow runs (${MAX_CONCURRENT_RUNS}) exceeded. Wait for active runs to complete.`
      );
    }

    const workflow = await this.workflowService.loadWorkflow(workflowId);
    if (!workflow) {
      throw new NotFoundError(`Workflow ${workflowId} not found`);
    }

    // Load full task payload if taskId provided
    const taskService = getTaskService();
    const task = taskId ? await taskService.getTask(taskId) : null;
    const safeInitialContext = this.validateExternalContext(initialContext, 'Initial context');
    const config = await getConfigService().getConfig();
    const budgetService = getAgentBudgetService();
    const budgetPolicy = budgetService.resolve({
      workspaceBudget: config.features?.budget?.enabled
        ? config.features.budget.defaultRunBudget
        : undefined,
      workflowBudget: workflow.config?.budget,
      runBudget,
    });
    const hasWorkflowAgentBudget = workflow.agents.some(
      (agent) =>
        agent.budget?.enabled && agent.budget.limits && Object.keys(agent.budget.limits).length > 0
    );
    const budgetEvaluation = budgetService.evaluate(
      budgetPolicy,
      { fanOut: 1 },
      {
        workflowId: workflow.id,
        taskId,
        actionType: 'workflow.start',
        project: task?.project,
      }
    );
    const budgetTraceIds: string[] = [];
    if (budgetEvaluation.trace) {
      const trace = await getGovernanceTraceService().record(budgetEvaluation.trace);
      budgetTraceIds.push(trace.id);
    }
    if (this.isBlockingBudgetDecision(budgetEvaluation.decision)) {
      throw new ValidationError(
        `Workflow run budget requires operator action before launch: ${budgetEvaluation.decision}`
      );
    }

    const runId = `run_${Date.now()}_${nanoid(8)}`;
    const now = new Date().toISOString();

    const run: WorkflowRun = {
      id: runId,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      taskId,
      status: 'running',
      currentStep: workflow.steps[0].id,
      context: {
        // Workflow variables
        ...workflow.variables,

        // Custom initial context (from API caller)
        ...safeInitialContext,

        // Task payload (if provided)
        ...(task ? { task } : {}),

        // Orchestrator/subagent pipeline summary for run views and completion handoff.
        ...(workflow.pipeline ? { pipeline: buildWorkflowPipelineSummary(workflow) } : {}),

        // Run metadata
        workflow: {
          id: workflow.id,
          version: workflow.version,
          // Phase 2: Store agent definitions for tool policy access (#110)
          agents: workflow.agents,
        },
        run: { id: runId, startedAt: now },

        // Phase 2: Session tracking for reuse mode (#111)
        _sessions: {},
      },
      budget: budgetPolicy
        ? {
            ...budgetService.initialState(budgetPolicy),
            usage: budgetEvaluation.usage,
            decision: budgetEvaluation.decision,
            thresholdEvents: budgetEvaluation.thresholdEvents,
            traceIds: budgetTraceIds,
            modelOverride: budgetEvaluation.modelOverride,
          }
        : hasWorkflowAgentBudget
          ? {
              enabled: true,
              usage: { ...ZERO_AGENT_BUDGET_USAGE },
              decision: 'allow',
              thresholdEvents: [],
              traceIds: [],
            }
          : undefined,
      startedAt: now,
      steps: workflow.steps.map((step) => ({
        stepId: step.id,
        status: 'pending',
        retries: 0,
      })),
    };

    // Persist initial run state
    await this.saveRun(run);

    // Snapshot workflow YAML into run directory (for version immutability)
    await this.snapshotWorkflow(run.id, workflow);

    log.info({ runId, workflowId, workflowVersion: workflow.version }, 'Workflow run started');

    // Start execution (async — don't await)
    this.executeRun(run, workflow).catch((err) => {
      log.error({ runId, err }, 'Workflow run failed');
    });

    return run;
  }

  /**
   * Execute the workflow run (iterates through steps with retry logic)
   */
  private async executeRun(run: WorkflowRun, workflow: WorkflowDefinition): Promise<void> {
    // Increment active run counter
    activeRunCount++;

    try {
      // Build initial step queue (skip already completed/skipped steps on resume)
      const stepQueue: string[] = this.buildStepQueue(run, workflow);

      while (stepQueue.length > 0) {
        const stepId = stepQueue.shift()!;
        const step = workflow.steps.find((s) => s.id === stepId)!;
        if (await this.evaluateRunBudget(run, workflow, step, 'workflow.step.start', true)) {
          await this.saveRun(run);
          broadcastWorkflowStatus(run);
          return;
        }

        // Skip if step already completed/skipped (defensive when retry_step rebuilds queue)
        const existingStepRun = run.steps.find((s) => s.stepId === step.id)!;
        if (existingStepRun.status === 'completed' || existingStepRun.status === 'skipped') {
          continue;
        }

        // Update current step
        run.currentStep = step.id;
        await this.saveRun(run);
        broadcastWorkflowStatus(run);

        const stepRun = existingStepRun;
        stepRun.status = 'running';
        stepRun.startedAt = new Date().toISOString();
        this.syncPipelineSummary(run, workflow);
        await this.saveRun(run);

        try {
          const result = await this.stepExecutor.executeStep(step, run);
          if (result.budgetUsage) {
            const budgetBlocked = await this.evaluateRunBudget(
              run,
              workflow,
              step,
              'workflow.step.usage',
              true,
              result.budgetUsage
            );
            if (budgetBlocked) {
              await this.saveRun(run);
              broadcastWorkflowStatus(run);
              return;
            }
          }

          stepRun.status = 'completed';
          stepRun.completedAt = new Date().toISOString();
          stepRun.duration = Math.floor(
            (new Date(stepRun.completedAt).getTime() - new Date(stepRun.startedAt!).getTime()) /
              1000
          );
          stepRun.output = result.outputPath;

          // Merge step output into run context
          run.context[step.id] = result.output;

          this.syncPipelineSummary(run, workflow);
          await this.saveRun(run);
          broadcastWorkflowStatus(run);
        } catch (err: unknown) {
          // Step failed
          stepRun.status = 'failed';
          stepRun.error = err instanceof Error ? err.message : 'Unknown error';
          stepRun.completedAt = new Date().toISOString();
          this.syncPipelineSummary(run, workflow);
          await this.saveRun(run);
          broadcastWorkflowStatus(run);

          // Handle failure policy
          const handled = await this.handleStepFailure(step, stepRun, stepQueue, workflow, run);
          if (!handled) {
            // No retry policy — fail the entire workflow
            throw err;
          }

          if ((run.status as WorkflowRun['status']) === 'blocked') {
            log.info({ runId: run.id, stepId: step.id }, 'Workflow run blocked — awaiting resume');
            return;
          }
        }
      }

      if (run.status === 'blocked') {
        log.info({ runId: run.id }, 'Workflow run remains blocked');
        return;
      }

      // All steps completed
      run.status = 'completed';
      run.completedAt = new Date().toISOString();
      this.syncPipelineSummary(run, workflow);
      await this.saveRun(run);
      broadcastWorkflowStatus(run);

      log.info({ runId: run.id, workflowId: run.workflowId }, 'Workflow run completed');
    } catch (err: unknown) {
      run.status = 'failed';
      run.error = err instanceof Error ? err.message : 'Unknown error';
      run.completedAt = new Date().toISOString();
      this.syncPipelineSummary(run, workflow);
      await this.saveRun(run);
      broadcastWorkflowStatus(run);

      log.error({ runId: run.id, err }, 'Workflow run failed');
    } finally {
      // Decrement active run counter
      activeRunCount--;
    }
  }

  /**
   * Handle step failure according to on_fail policy
   * Returns true if handled (retry queued), false if should fail workflow
   */
  private async handleStepFailure(
    step: WorkflowStep,
    stepRun: StepRun,
    stepQueue: string[],
    workflow: WorkflowDefinition,
    run: WorkflowRun
  ): Promise<boolean> {
    const policy = step.on_fail;
    if (!policy) return false;

    // Strategy 1: Retry the same step
    if (policy.retry && stepRun.retries < policy.retry) {
      stepRun.retries++;
      stepRun.status = 'pending';
      stepRun.error = undefined;

      // Phase 2: Apply retry delay if specified (#113)
      if (policy.retry_delay_ms && policy.retry_delay_ms > 0) {
        log.info(
          { stepId: step.id, retry: stepRun.retries, delayMs: policy.retry_delay_ms },
          'Delaying retry'
        );
        await new Promise((resolve) => setTimeout(resolve, policy.retry_delay_ms));
      }

      // Re-queue this step at the front
      stepQueue.unshift(step.id);

      this.syncPipelineSummary(run, workflow);
      await this.saveRun(run);
      log.info({ stepId: step.id, retry: stepRun.retries }, 'Retrying step');
      return true;
    }

    // Strategy 2: Retry a different step
    if (policy.retry_step) {
      const retryStep = workflow.steps.find((s) => s.id === policy.retry_step);
      if (!retryStep) {
        throw new Error(`retry_step references unknown step: ${policy.retry_step}`);
      }

      // Reset the retry step's state
      const retryStepRun = run.steps.find((s) => s.stepId === retryStep.id)!;
      retryStepRun.status = 'pending';
      retryStepRun.retries = 0;
      retryStepRun.error = undefined;

      // Build a new queue starting from the retry step
      const retryIndex = workflow.steps.findIndex((s) => s.id === policy.retry_step);
      const newQueue = workflow.steps.slice(retryIndex).map((s) => s.id);

      // Replace the queue
      stepQueue.length = 0;
      stepQueue.push(...newQueue);

      // Store failure context for the retry step
      run.context._retryContext = {
        failedStep: step.id,
        error: stepRun.error,
        retries: stepRun.retries,
      };

      this.syncPipelineSummary(run, workflow);
      await this.saveRun(run);
      log.info({ failedStep: step.id, retryStep: retryStep.id }, 'Routing to retry step');
      return true;
    }

    // Strategy 3: Escalation
    if (policy.escalate_to === 'human') {
      run.status = 'blocked';
      run.error = policy.escalate_message || `Step ${step.id} failed`;
      this.syncPipelineSummary(run, workflow);
      await this.saveRun(run);

      log.warn({ runId: run.id, stepId: step.id }, 'Workflow blocked');
      return true; // Handled (blocked, not failed)
    }

    if (policy.escalate_to === 'skip') {
      stepRun.status = 'skipped';
      this.syncPipelineSummary(run, workflow);
      await this.saveRun(run);
      log.info({ stepId: step.id }, 'Skipping failed step');
      return true;
    }

    if (policy.escalate_to?.startsWith('agent:')) {
      // Delegate to another agent (future feature)
      throw new Error('Agent escalation not yet implemented');
    }

    return false; // No policy matched — fail the workflow
  }

  /**
   * Get a workflow run by ID
   */
  async getRun(runId: string): Promise<WorkflowRun | null> {
    const safeRunId = this.normalizeRunId(runId);
    if (this.repository) {
      return this.repository.get(safeRunId);
    }

    const runPath = path.join(this.runsDir, safeRunId, 'run.json');

    try {
      const content = await fs.readFile(runPath, 'utf-8');
      return JSON.parse(content) as WorkflowRun;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * List all workflow runs (with optional filters)
   */
  async listRuns(filters?: {
    taskId?: string;
    workflowId?: string;
    status?: string;
  }): Promise<WorkflowRun[]> {
    if (this.repository) {
      return this.repository.list(filters);
    }

    const runDirs = await fs.readdir(this.runsDir).catch(() => []);
    const runs: WorkflowRun[] = [];

    for (const dir of runDirs) {
      if (!dir.startsWith('run_')) continue;

      let run: WorkflowRun | null;
      try {
        run = await this.getRun(dir);
      } catch (err) {
        if (err instanceof ValidationError) {
          log.warn({ runDir: dir }, 'Skipping run directory with invalid ID');
          continue;
        }
        throw err;
      }

      if (!run) continue;

      // Apply filters
      if (filters?.taskId && run.taskId !== filters.taskId) continue;
      if (filters?.workflowId && run.workflowId !== filters.workflowId) continue;
      if (filters?.status && run.status !== filters.status) continue;

      runs.push(run);
    }

    // Sort by startedAt descending
    runs.sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime() ||
        b.id.localeCompare(a.id)
    );

    return runs;
  }

  /**
   * List workflow run metadata only (efficient for list endpoints)
   * Returns only: id, workflowId, workflowVersion, taskId, status, startedAt, completedAt, error
   */
  async listRunsMetadata(filters?: {
    taskId?: string;
    workflowId?: string;
    status?: string;
  }): Promise<
    Array<
      Pick<
        WorkflowRun,
        | 'id'
        | 'workflowId'
        | 'workflowVersion'
        | 'taskId'
        | 'status'
        | 'startedAt'
        | 'completedAt'
        | 'error'
      >
    >
  > {
    if (this.repository) {
      const metadata = this.repository.listMetadata(filters);
      log.info({ count: metadata.length }, 'Listed run metadata');
      return metadata;
    }

    const runDirs = await fs.readdir(this.runsDir).catch(() => []);
    const metadata: Array<
      Pick<
        WorkflowRun,
        | 'id'
        | 'workflowId'
        | 'workflowVersion'
        | 'taskId'
        | 'status'
        | 'startedAt'
        | 'completedAt'
        | 'error'
      >
    > = [];

    for (const dir of runDirs) {
      if (!dir.startsWith('run_')) continue;

      const runPath = path.join(this.runsDir, dir, 'run.json');

      try {
        const content = await fs.readFile(runPath, 'utf-8');
        const run = JSON.parse(content) as WorkflowRun;

        // Apply filters
        if (filters?.taskId && run.taskId !== filters.taskId) continue;
        if (filters?.workflowId && run.workflowId !== filters.workflowId) continue;
        if (filters?.status && run.status !== filters.status) continue;

        metadata.push({
          id: run.id,
          workflowId: run.workflowId,
          workflowVersion: run.workflowVersion,
          taskId: run.taskId,
          status: run.status,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          error: run.error,
        });
      } catch (err: unknown) {
        log.warn({ runDir: dir, err }, 'Failed to read run metadata');
        continue;
      }
    }

    // Sort by startedAt descending
    metadata.sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime() ||
        b.id.localeCompare(a.id)
    );

    log.info({ count: metadata.length }, 'Listed run metadata');
    return metadata;
  }

  /**
   * Resume a blocked workflow run
   */
  async resumeRun(runId: string, resumeContext?: Record<string, unknown>): Promise<WorkflowRun> {
    const run = await this.getRun(runId);
    if (!run) {
      throw new NotFoundError(`Run ${runId} not found`);
    }

    if (run.status !== 'blocked') {
      throw new ValidationError(`Run ${runId} is not blocked (status: ${run.status})`);
    }

    // Merge resume context after rejecting attempts to replace server-owned context.
    run.context = {
      ...run.context,
      ...this.validateExternalContext(resumeContext, 'Resume context'),
    };
    run.status = 'running';
    await this.saveRun(run);

    // Resume execution
    const workflow = await this.workflowService.loadWorkflow(run.workflowId);
    if (!workflow) {
      throw new NotFoundError(`Workflow ${run.workflowId} not found`);
    }

    this.syncPipelineSummary(run, workflow);
    await this.saveRun(run);

    log.info({ runId }, 'Resuming workflow run');

    this.executeRun(run, workflow).catch((err) => {
      log.error({ runId, err }, 'Workflow resume failed');
    });

    return run;
  }

  private validateExternalContext(
    context: Record<string, unknown> | undefined,
    source: string
  ): Record<string, unknown> {
    if (!context) return {};

    const blockedKeys = Object.keys(context).filter((key) => RESERVED_CONTEXT_KEYS.has(key));
    if (blockedKeys.length > 0) {
      throw new ValidationError(
        `${source} cannot set reserved workflow context keys: ${blockedKeys.join(', ')}`
      );
    }

    return context;
  }

  /**
   * Get aggregated workflow statistics for dashboard
   * Filters by user permissions and calculates metrics for given period
   */
  async getStats(
    period: '24h' | '7d' | '30d',
    userId: string
  ): Promise<{
    period: string;
    totalWorkflows: number;
    activeRuns: number;
    completedRuns: number;
    failedRuns: number;
    avgDuration: number;
    successRate: number;
    perWorkflow: Array<{
      workflowId: string;
      workflowName: string;
      runs: number;
      completed: number;
      failed: number;
      successRate: number;
      avgDuration: number;
    }>;
  }> {
    // Calculate time window
    const now = new Date();
    const periodMs = {
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    };
    const startTime = new Date(now.getTime() - periodMs[period]);

    // Import permission check (dynamic to avoid circular deps)
    const { checkWorkflowPermission } = await import('../middleware/workflow-auth.js');

    // Get all runs and filter by permissions
    const allRuns = await this.listRunsMetadata({});
    const visibleRuns = [];
    for (const run of allRuns) {
      const hasPermission = await checkWorkflowPermission(run.workflowId, userId, 'view');
      if (hasPermission) {
        visibleRuns.push(run);
      }
    }

    // Get all workflows and filter by permissions
    const allWorkflows = await this.workflowService.listWorkflowsMetadata();
    const visibleWorkflows = [];
    for (const workflow of allWorkflows) {
      const hasPermission = await checkWorkflowPermission(workflow.id, userId, 'view');
      if (hasPermission) {
        visibleWorkflows.push(workflow);
      }
    }

    // Calculate overall stats
    const activeRuns = visibleRuns.filter((r) => r.status === 'running').length;
    const runsInPeriod = visibleRuns.filter((r) => new Date(r.startedAt) >= startTime);
    const completedRuns = runsInPeriod.filter((r) => r.status === 'completed').length;
    const failedRuns = runsInPeriod.filter((r) => r.status === 'failed').length;

    // Calculate average duration (completed runs only)
    const completedRunsWithDuration = runsInPeriod.filter(
      (r) => r.status === 'completed' && r.completedAt
    );
    const totalDuration = completedRunsWithDuration.reduce((sum, r) => {
      if (!r.completedAt) return sum;
      const duration = new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime();
      return sum + duration;
    }, 0);
    const avgDuration =
      completedRunsWithDuration.length > 0 ? totalDuration / completedRunsWithDuration.length : 0;

    // Calculate success rate
    const totalFinished = completedRuns + failedRuns;
    const successRate = totalFinished > 0 ? completedRuns / totalFinished : 0;

    // Per-workflow stats
    const workflowStatsMap = new Map<
      string,
      {
        workflowId: string;
        workflowName: string;
        runs: number;
        completed: number;
        failed: number;
        successRate: number;
        avgDuration: number;
      }
    >();

    for (const run of runsInPeriod) {
      if (!workflowStatsMap.has(run.workflowId)) {
        const workflow = visibleWorkflows.find((w) => w.id === run.workflowId);
        workflowStatsMap.set(run.workflowId, {
          workflowId: run.workflowId,
          workflowName: workflow?.name || run.workflowId,
          runs: 0,
          completed: 0,
          failed: 0,
          successRate: 0,
          avgDuration: 0,
        });
      }

      const stats = workflowStatsMap.get(run.workflowId);
      if (!stats) continue;

      stats.runs++;
      if (run.status === 'completed') stats.completed++;
      if (run.status === 'failed') stats.failed++;
    }

    // Calculate per-workflow success rates and avg durations
    for (const stats of workflowStatsMap.values()) {
      const totalFinished = stats.completed + stats.failed;
      stats.successRate = totalFinished > 0 ? stats.completed / totalFinished : 0;

      const workflowCompletedRuns = runsInPeriod.filter(
        (r) => r.workflowId === stats.workflowId && r.status === 'completed' && r.completedAt
      );
      const workflowTotalDuration = workflowCompletedRuns.reduce((sum, r) => {
        if (!r.completedAt) return sum;
        const duration = new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime();
        return sum + duration;
      }, 0);
      stats.avgDuration =
        workflowCompletedRuns.length > 0 ? workflowTotalDuration / workflowCompletedRuns.length : 0;
    }

    return {
      period,
      totalWorkflows: visibleWorkflows.length,
      activeRuns,
      completedRuns,
      failedRuns,
      avgDuration: Math.floor(avgDuration),
      successRate,
      perWorkflow: Array.from(workflowStatsMap.values()),
    };
  }

  private buildStepQueue(run: WorkflowRun, workflow: WorkflowDefinition): string[] {
    return workflow.steps
      .filter((step) => {
        const state = run.steps.find((s) => s.stepId === step.id);
        if (!state) return true;
        return state.status !== 'completed' && state.status !== 'skipped';
      })
      .map((step) => step.id);
  }

  /**
   * Save run state to disk
   * Phase 2: Updates lastCheckpoint timestamp on every save
   */
  private async saveRun(run: WorkflowRun): Promise<void> {
    // Update checkpoint timestamp
    run.lastCheckpoint = new Date().toISOString();

    if (this.repository) {
      this.repository.save(run);
      return;
    }

    const runDir = path.join(this.runsDir, run.id);
    await fs.mkdir(runDir, { recursive: true });

    const runPath = path.join(runDir, 'run.json');
    await fs.writeFile(runPath, JSON.stringify(run, null, 2), 'utf-8');
  }

  /**
   * Snapshot workflow YAML into run directory (for version immutability)
   */
  private async snapshotWorkflow(runId: string, workflow: WorkflowDefinition): Promise<void> {
    if (this.repository) {
      this.repository.saveWorkflowSnapshot(runId, workflow);
      return;
    }

    const runDir = path.join(this.runsDir, runId);
    await fs.mkdir(runDir, { recursive: true });

    const snapshotPath = path.join(runDir, 'workflow.yml');
    const yaml = await import('yaml');
    await fs.writeFile(snapshotPath, yaml.stringify(workflow), 'utf-8');
  }

  dispose(): void {
    if (this.ownsSqliteDatabase) {
      this.sqliteDatabase?.close();
    }
  }
}

export interface WorkflowRunServiceOptions {
  runsDir?: string;
  storageType?: 'file' | 'sqlite';
  sqliteDatabase?: SqliteDatabase;
  sqliteConnectionOptions?: SqliteConnectionOptions;
  workflowService?: ReturnType<typeof getWorkflowService>;
}

// Singleton
let workflowRunServiceInstance: WorkflowRunService | null = null;

export function getWorkflowRunService(): WorkflowRunService {
  if (!workflowRunServiceInstance) {
    workflowRunServiceInstance = new WorkflowRunService();
  }
  return workflowRunServiceInstance;
}

function mergeBudgetThresholdEvents(
  existing: AgentBudgetThresholdEvent[],
  next: AgentBudgetThresholdEvent[]
): AgentBudgetThresholdEvent[] {
  const byKey = new Map<string, AgentBudgetThresholdEvent>();
  for (const event of [...existing, ...next]) {
    byKey.set(`${event.metric}:${event.threshold}:${event.action}`, event);
  }
  return Array.from(byKey.values());
}

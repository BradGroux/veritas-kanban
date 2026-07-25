/**
 * WorkflowRunService — Executes workflows, manages run state, orchestrates step execution
 * Phase 1: Core Engine (sequential steps, basic retry logic)
 */

import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import {
  ADMISSION_CONTROL_PROVIDER,
  buildWorkflowPipelineSummary,
  DEFAULT_ROUTING_CONFIG,
  ZERO_AGENT_BUDGET_USAGE,
  type AgentBudgetDecision,
  type AgentBudgetPolicy,
  type AgentBudgetThresholdEvent,
  type AgentBudgetUsage,
  type AgentType,
  type AdmissionDecision,
  type AdmissionQueueClaim,
  type AdmissionQueueEntry,
  type AdmissionReservation,
  type AdmissionReservationRelease,
  type ExecutionTreeBudgetPolicy,
  type ExecutionTreeIdentity,
  type RunRecoveryRecord,
  type Task,
  type WorkflowPipelineRoleStatusPatch,
  type WorkflowSubagentRunStatus,
  type WorkflowSubagentTelemetry,
  WORKFLOW_ADMISSION_SCHEMA_VERSION,
} from '@veritas-kanban/shared';
import type { WorkflowRun, StepRun, WorkflowDefinition, WorkflowStep } from '../types/workflow.js';
import { getWorkflowService } from './workflow-service.js';
import {
  WorkflowStepExecutor,
  HumanGateBlockError,
  type WorkflowAgentStepPreparation,
} from './workflow-step-executor.js';
import { getWorkflowRunsDir } from '../utils/paths.js';
import { createLogger } from '../lib/logger.js';
import { broadcastWorkflowStatus } from './broadcast-service.js';
import { getTaskService } from './task-service.js';
import { SqliteDatabase, type SqliteConnectionOptions } from '../storage/sqlite/database.js';
import { SqliteWorkflowRunRepository } from '../storage/sqlite/workflow-repositories.js';
import { getConfigService } from './config-service.js';
import { getAgentBudgetService } from './agent-budget-service.js';
import { getGovernanceTraceService } from './governance-trace-service.js';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { RunRecoveryPolicyService } from './run-recovery-policy-service.js';
import { getAgentRoutingService } from './agent-routing-service.js';
import { atomicWriteFile } from '../storage/fs-helpers.js';
import { withFileLock } from './file-lock.js';
import {
  AdmissionControlService,
  getAdmissionControlService,
} from './admission-control-service.js';
import { normalizeWorkspaceId } from './task-envelope-service.js';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';

const log = createLogger('workflow-run');

/** Default maximum cross-step reroutes per run before exhaustion policy fires (#780) */
const MAX_REROUTES_DEFAULT = 10;
const scheduledWorkflowRecoveries = new Map<
  string,
  { stepId: string; timer: ReturnType<typeof setTimeout> }
>();
const RUN_ID_PATTERN = /^run_\d{10,}_[a-zA-Z0-9_-]{6,}$/;
const WORKFLOW_ADMISSION_ID_PREFIX = 'workflow';
const RESERVED_CONTEXT_KEYS = new Set([
  'task',
  'workflow',
  'run',
  'pipeline',
  '_sessions',
  '_sessionPhaseAuthority',
  '_retryContext',
  '_gateBlock',
  '_gateApproval',
]);

class WorkflowStepAdmissionError extends Error {
  readonly decision: AdmissionDecision;

  constructor(readonly binding: NonNullable<StepRun['admission']>) {
    const decision = binding.decision;
    super(
      decision.outcome === 'retryable-overload'
        ? 'Workflow step is waiting for admission capacity.'
        : 'Workflow step violates an admission policy.'
    );
    this.name = 'WorkflowStepAdmissionError';
    this.decision = decision;
  }
}

class WorkflowRunChangedError extends ConflictError {
  constructor(runId: string, expectedRevision: number, currentRevision?: number) {
    super('Workflow run changed during persistence', {
      runId,
      expectedRevision,
      currentRevision,
    });
    this.name = 'WorkflowRunChangedError';
  }
}

export class WorkflowRunService {
  private runsDir: string;
  private workflowService: ReturnType<typeof getWorkflowService>;
  private stepExecutor: WorkflowStepExecutor;
  private readonly repository: SqliteWorkflowRunRepository | null = null;
  private readonly sqliteDatabase: SqliteDatabase | null = null;
  private readonly ownsSqliteDatabase: boolean = false;
  private readonly runRecoveryPolicy: RunRecoveryPolicyService;
  private readonly admission: AdmissionControlService;
  private readonly requestAdmissionQueueDrain?: () => void;

  constructor(options: string | WorkflowRunServiceOptions = {}) {
    const resolvedOptions = typeof options === 'string' ? { runsDir: options } : options;
    this.runsDir = resolvedOptions.runsDir || getWorkflowRunsDir();
    this.workflowService = resolvedOptions.workflowService ?? getWorkflowService();
    this.runRecoveryPolicy = resolvedOptions.runRecoveryPolicy ?? new RunRecoveryPolicyService();
    this.admission = resolvedOptions.admission ?? getAdmissionControlService();
    this.requestAdmissionQueueDrain = resolvedOptions.requestAdmissionQueueDrain;
    this.stepExecutor =
      resolvedOptions.stepExecutor ??
      new WorkflowStepExecutor(resolvedOptions.runsDir, {
        persistRun: (run) => this.saveRun(run),
      });
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

  private rootAdmissionTaskId(runId: string): string {
    return `${WORKFLOW_ADMISSION_ID_PREFIX}-root:${runId}`;
  }

  private stepAdmissionTaskId(runId: string, stepId: string, sequence: number): string {
    const digest = createHash('sha256')
      .update(`${runId}:${stepId}:${sequence}`)
      .digest('hex')
      .slice(0, 32);
    return `${WORKFLOW_ADMISSION_ID_PREFIX}-step:${digest}`;
  }

  private workflowWorkspaceId(task: Task | null): string {
    if (!task) return 'local';
    return normalizeWorkspaceId(task.project?.trim() || task.git?.repo || task.id);
  }

  private admissionConflict(decision: AdmissionDecision, subject: string): ConflictError {
    return new ConflictError(
      decision.outcome === 'retryable-overload'
        ? `${subject} is waiting for admission capacity.`
        : `${subject} violates an admission policy.`,
      {
        code:
          decision.outcome === 'retryable-overload'
            ? 'ADMISSION_OVERLOAD'
            : 'ADMISSION_POLICY_DENIED',
        decision,
      }
    );
  }

  private async admitWorkflowRoot(
    run: WorkflowRun,
    task: Task | null,
    budgetSources?: {
      workspaceBudget?: AgentBudgetPolicy;
      workflowBudget?: AgentBudgetPolicy;
      runBudget?: AgentBudgetPolicy;
    }
  ): Promise<NonNullable<WorkflowRun['admission']>> {
    const admissionTaskId = this.rootAdmissionTaskId(run.id);
    const attemptId = admissionTaskId;
    const workspaceId = this.workflowWorkspaceId(task);
    const rootTaskId = run.taskId ?? admissionTaskId;
    const executionTree: ExecutionTreeIdentity =
      run.executionTree ??
      ({
        schemaVersion: 'execution-tree-identity/v1',
        rootObjectiveId: `objective_${createHash('sha256')
          .update(`${workspaceId}:${rootTaskId}:${run.id}`)
          .digest('hex')
          .slice(0, 32)}`,
        nodeId: attemptId,
        edge: 'root',
        depth: 0,
      } as const);
    run.executionTree = executionTree;
    const budgetPolicies = mergeWorkflowExecutionTreePolicies([
      workflowExecutionTreePolicy(
        budgetSources?.workspaceBudget,
        'workspace',
        workspaceId,
        'Workspace budget'
      ),
      workflowExecutionTreePolicy(
        budgetSources?.workflowBudget,
        'workflow',
        run.workflowId,
        'Workflow budget'
      ),
      workflowExecutionTreePolicy(budgetSources?.runBudget, 'run', run.id, 'Workflow run budget'),
      workflowExecutionTreePolicy(
        run.budget?.policy,
        'root-objective',
        executionTree.rootObjectiveId,
        'Root objective budget'
      ),
    ]);
    const admissionInput = {
      taskId: admissionTaskId,
      rootTaskId,
      workspaceId,
      provider: ADMISSION_CONTROL_PROVIDER,
      hostId: this.admission.getExecutionHostId(),
      source: 'workflow',
      workflowRunId: run.id,
      idempotencyKey: `workflow-root:${run.id}`,
      requested: {
        runSlots: 1,
        processSlots: 0,
        estimatedMemoryMb: 0,
      },
      executionTree,
      budgetPolicies,
      budgetRequest: { fanOut: 1 },
    } as const;
    const decision = await this.admission.admitOrQueue(admissionInput, {
      attemptId,
      priority: task?.priority,
      target: {
        kind: 'workflow-root',
        workflowId: run.workflowId,
        workflowVersion: run.workflowVersion,
        workflowRunId: run.id,
        workflowRunRevision: (run.revision ?? 0) + 1,
        ...(run.taskId ? { associatedTaskId: run.taskId } : {}),
        initialContextDigest: digestRunLaunchValue(run.context),
        budgetPolicyDigest: digestRunLaunchValue(budgetPolicies),
        executionTreeDigest: digestRunLaunchValue(executionTree),
      },
    });
    if (decision.outcome === 'queued' && decision.queueEntry) {
      return {
        schemaVersion: WORKFLOW_ADMISSION_SCHEMA_VERSION,
        state: 'waiting',
        workspaceId,
        rootTaskId,
        admissionTaskId,
        attemptId,
        queueEntryId: decision.queueEntry.id,
        decision,
        executionTree,
      };
    }
    if (decision.outcome !== 'admitted' || !decision.reservation) {
      throw this.admissionConflict(decision, 'Workflow root');
    }
    let reservation: AdmissionReservation;
    try {
      reservation = await this.admission.bindAttempt(decision.reservation.id, attemptId);
      await this.admission.recordBudgetUsage(reservation.id, {
        schemaVersion: 'execution-tree-budget-event/v1',
        id: `launch_${attemptId}`,
        mode: 'delta',
        usage: { ...ZERO_AGENT_BUDGET_USAGE, fanOut: 1 },
        source: 'workflow-root-launch',
        occurredAt: run.startedAt,
      });
    } catch (error) {
      await this.admission
        .releaseIfUnbound(
          decision.reservation.id,
          'start-failed',
          `workflow-root-bind-failed:${run.id}`
        )
        .catch(() => {});
      throw error;
    }
    return {
      schemaVersion: WORKFLOW_ADMISSION_SCHEMA_VERSION,
      state: 'active',
      workspaceId,
      rootTaskId,
      admissionTaskId,
      attemptId,
      reservationId: reservation.id,
      decision,
      executionTree,
    };
  }

  private async ensureWorkflowRootAdmission(run: WorkflowRun): Promise<void> {
    if (!run.admission) {
      const task = run.taskId ? await getTaskService().getTask(run.taskId) : null;
      run.admission = await this.admitWorkflowRoot(run, task);
      await this.saveRun(run);
      return;
    }
    const recovered = await this.admission.recoverVerifiedRun({
      workspaceId: run.admission.workspaceId,
      taskId: run.admission.admissionTaskId,
      attemptId: run.admission.attemptId,
    });
    if (!recovered || recovered.id !== run.admission.reservationId) {
      throw new ConflictError('Workflow root admission could not be recovered.', {
        runId: run.id,
        expectedReservationId: run.admission.reservationId,
        recoveredReservationId: recovered?.id,
      });
    }
    if (!run.admission.executionTree) {
      const executionTree: ExecutionTreeIdentity = recovered.request.executionTree ??
        run.executionTree ?? {
          schemaVersion: 'execution-tree-identity/v1',
          rootObjectiveId: `objective_${createHash('sha256')
            .update(`${run.admission.workspaceId}:${run.admission.rootTaskId}:${run.id}`)
            .digest('hex')
            .slice(0, 32)}`,
          nodeId: run.admission.attemptId,
          edge: 'root',
          depth: 0,
        };
      run.executionTree = executionTree;
      run.admission = { ...run.admission, executionTree };
      await this.saveRun(run);
    }
  }

  private async admitWorkflowStep(
    run: WorkflowRun,
    step: WorkflowStep,
    preparation: WorkflowAgentStepPreparation
  ): Promise<NonNullable<StepRun['admission']>> {
    if (!run.admission?.reservationId || run.admission.state === 'waiting') {
      throw new ConflictError('Workflow root admission is missing before step launch.', {
        runId: run.id,
        stepId: step.id,
      });
    }
    const rootReservationId = run.admission.reservationId;
    const stepRun = run.steps.find((candidate) => candidate.stepId === step.id);
    if (!stepRun) throw new Error(`Workflow run is missing step state for ${step.id}`);
    const sequence = (stepRun.admission?.sequence ?? 0) + 1;
    const admissionTaskId = this.stepAdmissionTaskId(run.id, step.id, sequence);
    const attemptId = admissionTaskId;
    const parentExecutionTree = run.admission.executionTree;
    const executionTree: ExecutionTreeIdentity = {
      schemaVersion: 'execution-tree-identity/v1',
      rootObjectiveId: parentExecutionTree.rootObjectiveId,
      nodeId: attemptId,
      parentNodeId: parentExecutionTree.nodeId,
      edge:
        stepRun.runRetry?.action === 'fallback'
          ? 'fallback'
          : stepRun.runRetry
            ? 'retry'
            : 'workflow-step',
      depth: parentExecutionTree.depth + 1,
    };
    stepRun.executionTree = executionTree;
    const hostId =
      preparation.hostRouting.selectedHostId ??
      (preparation.runtimeProvider === 'openclaw' ? 'openclaw-gateway' : 'local-process');
    const admissionInput = {
      taskId: admissionTaskId,
      rootTaskId: run.admission.rootTaskId,
      workspaceId: run.admission.workspaceId,
      provider: preparation.runtimeProvider,
      hostId,
      source:
        stepRun.runRetry?.action === 'fallback'
          ? 'fallback'
          : stepRun.runRetry
            ? 'recovery'
            : 'workflow',
      workflowRunId: run.id,
      workflowStepId: step.id,
      rootReservationId,
      idempotencyKey: `workflow-step:${run.id}:${step.id}:${sequence}`,
      executionTree,
      budgetPolicies: (await this.admission.get(rootReservationId)).request.budgetPolicies,
      budgetRequest: {
        fanOut: Math.max(1, step.parallel?.steps.length ?? 1),
        retries: stepRun.runRetry ? 1 : 0,
      },
    } as const;
    const decision = await this.admission.admitOrQueue(admissionInput, {
      attemptId,
      priority: run.taskId ? (await getTaskService().getTask(run.taskId))?.priority : undefined,
      target: {
        kind: 'workflow-step',
        workflowId: run.workflowId,
        workflowVersion: run.workflowVersion,
        workflowRunId: run.id,
        workflowRunRevision: (run.revision ?? 0) + 1,
        workflowStepId: step.id,
        workflowStepSequence: sequence,
        recoverySequence: stepRun.runRetry?.sequence ?? 0,
        parentNodeId: parentExecutionTree.nodeId,
        edge: executionTree.edge,
        provider: preparation.runtimeProvider,
        hostId,
        providerRuntimeManifestDigest: preparation.runtimeManifest.digest,
        requiredRuntimeCapabilitiesDigest: digestRunLaunchValue(
          preparation.requiredRuntimeCapabilities
        ),
        phaseEvidenceDigest: preparation.phaseAuthority.evidence.digest,
        phaseLaunchDigest: preparation.phaseLaunchDigest,
      },
    });
    const binding: NonNullable<StepRun['admission']> = {
      schemaVersion: WORKFLOW_ADMISSION_SCHEMA_VERSION,
      state: decision.outcome === 'queued' ? 'waiting' : undefined,
      sequence,
      admissionTaskId,
      attemptId,
      decision,
      executionTree,
    };
    if (decision.outcome === 'queued' && decision.queueEntry) {
      return {
        ...binding,
        queueEntryId: decision.queueEntry.id,
      };
    }
    if (decision.outcome !== 'admitted' || !decision.reservation) {
      throw new WorkflowStepAdmissionError(binding);
    }
    try {
      const reservation = await this.admission.bindAttempt(decision.reservation.id, attemptId);
      await this.admission.recordBudgetUsage(reservation.id, {
        schemaVersion: 'execution-tree-budget-event/v1',
        id: `launch_${attemptId}`,
        mode: 'delta',
        usage: {
          ...ZERO_AGENT_BUDGET_USAGE,
          fanOut: Math.max(1, step.parallel?.steps.length ?? 1),
          retries: stepRun.runRetry ? 1 : 0,
        },
        source: 'workflow-step-launch',
        occurredAt: run.startedAt,
      });
      return {
        ...binding,
        state: 'active',
        reservationId: reservation.id,
      };
    } catch (error) {
      await this.admission
        .releaseIfUnbound(
          decision.reservation.id,
          'start-failed',
          `workflow-step-bind-failed:${attemptId}`
        )
        .catch(() => {});
      throw error;
    }
  }

  private async releaseStepAdmission(
    stepRun: StepRun,
    reason: AdmissionReservationRelease['reason'],
    idempotencyKey: string
  ): Promise<void> {
    if (!stepRun.admission?.reservationId) return;
    await this.admission.release(stepRun.admission.reservationId, reason, idempotencyKey);
  }

  private async releaseRootAdmission(
    run: WorkflowRun,
    reason: AdmissionReservationRelease['reason'],
    idempotencyKey: string
  ): Promise<void> {
    if (!run.admission?.reservationId) return;
    await this.admission.release(run.admission.reservationId, reason, idempotencyKey);
  }

  async dispatchQueuedAdmission(claim: AdmissionQueueClaim): Promise<void> {
    const target = claim.entry.target;
    if (!target || target.kind === 'direct') {
      throw new ConflictError('Queue claim is not a workflow launch.', {
        code: 'ADMISSION_QUEUE_TARGET_MISMATCH',
        queueId: claim.entry.id,
      });
    }

    try {
      if (target.kind === 'workflow-root') {
        await this.dispatchQueuedWorkflowRoot(claim);
        return;
      }
      await this.dispatchQueuedWorkflowStep(claim);
    } catch (error) {
      const current = await this.admission.getQueueEntry(claim.entry.id);
      if (current.state === 'dispatched') {
        log.warn(
          { err: error, queueId: current.id },
          'Workflow queue dispatch failed after durable ownership transfer'
        );
        return;
      }
      await this.rollbackWorkflowQueueClaim(claim).catch((rollbackError) => {
        log.error(
          { err: rollbackError, queueId: claim.entry.id },
          'Workflow queue claim rollback failed'
        );
      });
      await this.admission
        .release(
          claim.reservation.id,
          'start-failed',
          `workflow-queue-dispatch-failed:${claim.entry.id}`
        )
        .catch(() => {});
      if (
        error instanceof ConflictError ||
        error instanceof NotFoundError ||
        error instanceof ValidationError
      ) {
        const terminalEntry = await this.admission.terminateQueueEntry(
          claim.entry.id,
          'WORKFLOW_QUEUE_AUTHORITY_DRIFT',
          'Workflow queue authority changed before dispatch.'
        );
        await this.terminalizeWorkflowQueueTarget(claim, terminalEntry);
        return;
      }
      await this.admission.requeueQueueEntry(
        claim.entry.id,
        'WORKFLOW_QUEUE_TRANSIENT_FAILURE',
        'Workflow queue dispatch failed before ownership became durable.'
      );
    }
  }

  private async terminalizeWorkflowQueueTarget(
    claim: AdmissionQueueClaim,
    terminalEntry: AdmissionQueueEntry
  ): Promise<void> {
    const target = claim.entry.target;
    if (!target || target.kind === 'direct') return;
    const run = await this.getRun(target.workflowRunId);
    if (!run) return;
    const reason = terminalEntry.terminal?.reason ?? 'Workflow queue authority changed.';
    if (
      target.kind === 'workflow-root' &&
      run.admission?.queueEntryId === claim.entry.id &&
      ['waiting', 'dispatching'].includes(run.admission.state ?? '')
    ) {
      run.admission = {
        ...run.admission,
        state: 'terminal',
        reservationId: undefined,
        ...(run.admission.decision
          ? {
              decision: {
                ...run.admission.decision,
                queueEntry: terminalEntry,
              },
            }
          : {}),
      };
      run.status = 'failed';
      run.error = reason;
      run.completedAt = new Date().toISOString();
      await this.saveRun(run);
      broadcastWorkflowStatus(run);
      return;
    }
    if (target.kind !== 'workflow-step') return;
    const stepRun = run.steps.find(
      (candidate) => candidate.admission?.queueEntryId === claim.entry.id
    );
    const stepAdmission = stepRun?.admission;
    if (
      !stepRun ||
      !stepAdmission ||
      !['waiting', 'dispatching'].includes(stepAdmission.state ?? '')
    ) {
      return;
    }
    stepRun.admission = {
      ...stepAdmission,
      state: 'terminal',
      reservationId: undefined,
      decision: {
        ...stepAdmission.decision,
        queueEntry: terminalEntry,
      },
    };
    stepRun.status = 'failed';
    stepRun.error = reason;
    stepRun.completedAt = new Date().toISOString();
    run.status = 'failed';
    run.error = reason;
    run.completedAt = stepRun.completedAt;
    await this.saveRun(run);
    await this.releaseRootAdmission(
      run,
      'failed',
      `workflow-step-queue-terminal:${run.id}:${stepRun.stepId}:${stepAdmission.sequence}`
    ).catch((releaseError) => {
      log.error(
        { err: releaseError, runId: run.id, stepId: stepRun.stepId },
        'Failed to release workflow root after terminal queue drift'
      );
    });
    broadcastWorkflowStatus(run);
  }

  private async dispatchQueuedWorkflowRoot(claim: AdmissionQueueClaim): Promise<void> {
    const target = claim.entry.target;
    if (target?.kind !== 'workflow-root') {
      throw new ConflictError('Queue claim is not a workflow root.', {
        code: 'ADMISSION_QUEUE_TARGET_MISMATCH',
        queueId: claim.entry.id,
      });
    }
    const run = await this.getRun(target.workflowRunId);
    if (!run) throw new NotFoundError(`Run ${target.workflowRunId} not found`);
    const workflow = await this.workflowService.loadWorkflow(run.workflowId);
    if (!workflow) throw new NotFoundError(`Workflow ${run.workflowId} not found`);
    const driftFields = [
      run.workflowId !== target.workflowId ? 'workflowId' : undefined,
      run.workflowVersion !== target.workflowVersion ? 'workflowVersion' : undefined,
      workflow.version !== target.workflowVersion ? 'currentWorkflowVersion' : undefined,
      run.revision !== target.workflowRunRevision ? 'workflowRunRevision' : undefined,
      run.taskId !== target.associatedTaskId ? 'associatedTaskId' : undefined,
      run.status !== 'pending' ? 'runStatus' : undefined,
      run.admission?.state !== 'waiting' ? 'admissionState' : undefined,
      run.admission?.queueEntryId !== claim.entry.id ? 'queueEntryId' : undefined,
      run.admission?.attemptId !== claim.entry.attemptId ? 'attemptId' : undefined,
      digestRunLaunchValue(run.context) !== target.initialContextDigest
        ? 'initialContextDigest'
        : undefined,
      digestRunLaunchValue(claim.entry.request.budgetPolicies ?? []) !== target.budgetPolicyDigest
        ? 'budgetPolicyDigest'
        : undefined,
      digestRunLaunchValue(run.executionTree) !== target.executionTreeDigest
        ? 'executionTreeDigest'
        : undefined,
    ].filter((field): field is string => Boolean(field));
    if (driftFields.length > 0) {
      throw new ConflictError('Queued workflow root changed before dispatch.', {
        code: 'ADMISSION_QUEUE_DRIFT',
        queueId: claim.entry.id,
        driftFields,
      });
    }

    const reservation = await this.admission.bindQueuedAttempt(
      claim.entry.id,
      claim.reservation.id,
      claim.entry.attemptId
    );
    await this.admission.recordBudgetUsage(reservation.id, {
      schemaVersion: 'execution-tree-budget-event/v1',
      id: `launch_${claim.entry.attemptId}`,
      mode: 'delta',
      usage: { ...ZERO_AGENT_BUDGET_USAGE, fanOut: 1 },
      source: 'workflow-root-launch',
      occurredAt: run.startedAt,
    });
    const currentAdmission = run.admission;
    if (!currentAdmission) {
      throw new ConflictError('Queued workflow root admission binding is missing.', {
        code: 'ADMISSION_QUEUE_DRIFT',
        queueId: claim.entry.id,
      });
    }
    const dispatchingAdmission: NonNullable<WorkflowRun['admission']> = {
      ...currentAdmission,
      state: 'dispatching',
      reservationId: reservation.id,
    };
    run.admission = dispatchingAdmission;
    await this.saveRun(run);
    await this.admission.markQueueDispatched(claim.entry.id, claim.entry.attemptId);
    run.admission = { ...dispatchingAdmission, state: 'active' };
    run.status = 'running';
    run.error = undefined;
    await this.saveRun(run);

    void this.executeRun(run, workflow).catch((error) => {
      log.error({ err: error, runId: run.id }, 'Queued workflow root execution failed');
    });
  }

  private async dispatchQueuedWorkflowStep(claim: AdmissionQueueClaim): Promise<void> {
    const target = claim.entry.target;
    if (target?.kind !== 'workflow-step') {
      throw new ConflictError('Queue claim is not a workflow step.', {
        code: 'ADMISSION_QUEUE_TARGET_MISMATCH',
        queueId: claim.entry.id,
      });
    }
    const run = await this.getRun(target.workflowRunId);
    if (!run) throw new NotFoundError(`Run ${target.workflowRunId} not found`);
    const workflow = await this.workflowService.loadWorkflow(run.workflowId);
    if (!workflow) throw new NotFoundError(`Workflow ${run.workflowId} not found`);
    const step = workflow.steps.find((candidate) => candidate.id === target.workflowStepId);
    if (!step) throw new NotFoundError(`Workflow step ${target.workflowStepId} not found`);
    const stepRun = run.steps.find((candidate) => candidate.stepId === target.workflowStepId);
    if (!stepRun) throw new NotFoundError(`Run step ${target.workflowStepId} not found`);
    const driftFields = [
      run.workflowId !== target.workflowId ? 'workflowId' : undefined,
      run.workflowVersion !== target.workflowVersion ? 'workflowVersion' : undefined,
      workflow.version !== target.workflowVersion ? 'currentWorkflowVersion' : undefined,
      run.revision !== target.workflowRunRevision ? 'workflowRunRevision' : undefined,
      run.status !== 'pending' ? 'runStatus' : undefined,
      run.currentStep !== target.workflowStepId ? 'currentStep' : undefined,
      !run.admission?.reservationId || run.admission.state === 'waiting'
        ? 'rootAdmission'
        : undefined,
      claim.entry.request.rootReservationId !== run.admission?.reservationId
        ? 'rootReservationId'
        : undefined,
      stepRun.status !== 'pending' ? 'stepStatus' : undefined,
      stepRun.admission?.state !== 'waiting' ? 'stepAdmissionState' : undefined,
      stepRun.admission?.queueEntryId !== claim.entry.id ? 'queueEntryId' : undefined,
      stepRun.admission?.sequence !== target.workflowStepSequence
        ? 'workflowStepSequence'
        : undefined,
      (stepRun.runRetry?.sequence ?? 0) !== target.recoverySequence
        ? 'recoverySequence'
        : undefined,
      stepRun.executionTree?.parentNodeId !== target.parentNodeId ? 'parentNodeId' : undefined,
      stepRun.executionTree?.edge !== target.edge ? 'executionTreeEdge' : undefined,
    ].filter((field): field is string => Boolean(field));
    if (driftFields.length > 0) {
      throw new ConflictError('Queued workflow step changed before dispatch.', {
        code: 'ADMISSION_QUEUE_DRIFT',
        queueId: claim.entry.id,
        driftFields,
      });
    }

    const preparation = await this.stepExecutor.prepareStep(step, run);
    if (preparation.kind !== 'agent') {
      throw new ConflictError('Queued workflow step is no longer provider-backed.', {
        code: 'ADMISSION_QUEUE_DRIFT',
        queueId: claim.entry.id,
      });
    }
    this.assertQueuedWorkflowStepPreparation(run, stepRun, preparation);
    const reservation = await this.admission.bindQueuedAttempt(
      claim.entry.id,
      claim.reservation.id,
      claim.entry.attemptId
    );
    await this.admission.recordBudgetUsage(reservation.id, {
      schemaVersion: 'execution-tree-budget-event/v1',
      id: `launch_${claim.entry.attemptId}`,
      mode: 'delta',
      usage: {
        ...ZERO_AGENT_BUDGET_USAGE,
        fanOut: Math.max(1, step.parallel?.steps.length ?? 1),
        retries: stepRun.runRetry ? 1 : 0,
      },
      source: 'workflow-step-launch',
      occurredAt: run.startedAt,
    });
    this.stepExecutor.applyPreparation(run, preparation);
    const currentStepAdmission = stepRun.admission;
    if (!currentStepAdmission) {
      throw new ConflictError('Queued workflow step admission binding is missing.', {
        code: 'ADMISSION_QUEUE_DRIFT',
        queueId: claim.entry.id,
      });
    }
    stepRun.admission = {
      ...currentStepAdmission,
      state: 'dispatching',
      reservationId: reservation.id,
    };
    stepRun.error = undefined;
    run.status = 'pending';
    run.error = undefined;
    await this.saveRun(run);
    await this.admission.markQueueDispatched(claim.entry.id, claim.entry.attemptId);

    void this.executeRun(run, workflow).catch((error) => {
      log.error(
        { err: error, runId: run.id, stepId: step.id },
        'Queued workflow step execution failed'
      );
    });
  }

  private assertQueuedWorkflowStepPreparation(
    run: WorkflowRun,
    stepRun: StepRun,
    preparation: WorkflowAgentStepPreparation
  ): void {
    const target = stepRun.admission?.decision.queueEntry?.target;
    if (target?.kind !== 'workflow-step') {
      throw new ConflictError('Workflow step queue target is missing.', {
        code: 'ADMISSION_QUEUE_DRIFT',
        runId: run.id,
        stepId: stepRun.stepId,
      });
    }
    const hostId =
      preparation.hostRouting.selectedHostId ??
      (preparation.runtimeProvider === 'openclaw' ? 'openclaw-gateway' : 'local-process');
    const driftFields = [
      preparation.runtimeProvider !== target.provider ? 'provider' : undefined,
      hostId !== target.hostId ? 'hostId' : undefined,
      preparation.runtimeManifest.digest !== target.providerRuntimeManifestDigest
        ? 'providerRuntimeManifestDigest'
        : undefined,
      digestRunLaunchValue(preparation.requiredRuntimeCapabilities) !==
      target.requiredRuntimeCapabilitiesDigest
        ? 'requiredRuntimeCapabilitiesDigest'
        : undefined,
      preparation.phaseAuthority.evidence.digest !== target.phaseEvidenceDigest
        ? 'phaseEvidenceDigest'
        : undefined,
      preparation.phaseLaunchDigest !== target.phaseLaunchDigest ? 'phaseLaunchDigest' : undefined,
    ].filter((field): field is string => Boolean(field));
    if (driftFields.length > 0) {
      throw new ConflictError('Queued workflow step launch authority changed.', {
        code: 'ADMISSION_QUEUE_DRIFT',
        queueId: stepRun.admission?.queueEntryId,
        driftFields,
      });
    }
  }

  private async rollbackWorkflowQueueClaim(claim: AdmissionQueueClaim): Promise<void> {
    const target = claim.entry.target;
    if (!target || target.kind === 'direct') return;
    const run = await this.getRun(target.workflowRunId);
    if (!run) return;
    if (
      run.admission?.queueEntryId === claim.entry.id &&
      run.admission.state === 'dispatching' &&
      run.admission.reservationId === claim.reservation.id
    ) {
      run.admission = {
        ...run.admission,
        state: 'waiting',
        reservationId: undefined,
      };
      run.status = 'pending';
      run.error = 'Workflow launch is waiting for admission capacity.';
      await this.saveRun(run);
      return;
    }
    const stepRun = run.steps.find(
      (candidate) => candidate.admission?.queueEntryId === claim.entry.id
    );
    if (
      stepRun?.admission?.state === 'dispatching' &&
      stepRun.admission.reservationId === claim.reservation.id
    ) {
      stepRun.admission = {
        ...stepRun.admission,
        state: 'waiting',
        reservationId: undefined,
      };
      stepRun.status = 'pending';
      stepRun.error = 'Workflow step is waiting for admission capacity.';
      run.status = 'pending';
      run.error = stepRun.error;
      await this.saveRun(run);
    }
  }

  private async reconcileWorkflowRootQueue(run: WorkflowRun): Promise<boolean> {
    const binding = run.admission;
    if (!binding || !['waiting', 'dispatching'].includes(binding.state ?? '')) {
      return false;
    }
    if (!binding.queueEntryId) {
      throw new ConflictError('Workflow queue binding is missing its queue entry.', {
        runId: run.id,
        admissionState: binding.state,
      });
    }
    const entry = await this.admission.getQueueEntry(binding.queueEntryId);
    if (binding.state === 'waiting') {
      if (entry.state === 'terminal') {
        run.admission = {
          ...binding,
          state: 'terminal',
          decision: binding.decision
            ? { ...binding.decision, queueEntry: entry }
            : binding.decision,
        };
        run.status = 'failed';
        run.error = entry.terminal?.reason ?? 'Workflow admission queue terminated.';
        run.completedAt = new Date().toISOString();
        await this.saveRun(run);
        broadcastWorkflowStatus(run);
      } else {
        this.scheduleAdmissionQueueDrain();
      }
      return true;
    }
    if (
      entry.state === 'dispatched' &&
      entry.dispatchedAttemptId === binding.attemptId &&
      entry.reservationId === binding.reservationId
    ) {
      const recovered = await this.admission.recoverVerifiedRun({
        workspaceId: binding.workspaceId,
        taskId: binding.admissionTaskId,
        attemptId: binding.attemptId,
      });
      if (!recovered || recovered.id !== binding.reservationId) {
        throw new ConflictError('Dispatched workflow root admission could not be recovered.', {
          runId: run.id,
          queueId: entry.id,
          expectedReservationId: binding.reservationId,
          recoveredReservationId: recovered?.id,
        });
      }
      const workflow = await this.workflowService.loadWorkflow(run.workflowId);
      if (!workflow || workflow.version !== run.workflowVersion) {
        throw new ConflictError('Dispatched workflow definition is unavailable for recovery.', {
          runId: run.id,
          workflowId: run.workflowId,
          workflowVersion: run.workflowVersion,
          currentWorkflowVersion: workflow?.version,
        });
      }
      run.admission = { ...binding, state: 'active' };
      run.status = 'running';
      run.error = undefined;
      await this.saveRun(run);
      void this.executeRun(run, workflow).catch((error) => {
        log.error({ err: error, runId: run.id }, 'Recovered workflow root execution failed');
      });
      return true;
    }
    if (entry.state === 'terminal') {
      run.admission = {
        ...binding,
        state: 'terminal',
        reservationId: undefined,
        decision: binding.decision ? { ...binding.decision, queueEntry: entry } : binding.decision,
      };
      run.status = 'failed';
      run.error = entry.terminal?.reason ?? 'Workflow admission queue terminated.';
      run.completedAt = new Date().toISOString();
      await this.saveRun(run);
      if (binding.reservationId) {
        await this.admission
          .release(
            binding.reservationId,
            'start-failed',
            `workflow-root-queue-terminal-restart:${run.id}`
          )
          .catch(() => {});
      }
      broadcastWorkflowStatus(run);
      return true;
    }
    run.admission = {
      ...binding,
      state: 'waiting',
      reservationId: undefined,
    };
    run.status = 'pending';
    run.error = 'Workflow root is waiting for admission capacity.';
    await this.saveRun(run);
    if (binding.reservationId) {
      await this.admission.release(
        binding.reservationId,
        'start-failed',
        `workflow-root-queue-restart:${run.id}`
      );
    }
    if (entry.state === 'leased') {
      await this.admission.requeueQueueEntry(
        entry.id,
        'WORKFLOW_QUEUE_RESTART',
        'Server restarted before workflow ownership became durable.'
      );
    }
    this.scheduleAdmissionQueueDrain();
    broadcastWorkflowStatus(run);
    return true;
  }

  private async reconcileWorkflowStepQueue(run: WorkflowRun, stepRun: StepRun): Promise<boolean> {
    const binding = stepRun.admission;
    if (!binding || !['waiting', 'dispatching'].includes(binding.state ?? '')) {
      return false;
    }
    if (!binding.queueEntryId) {
      throw new ConflictError('Workflow step queue binding is missing its queue entry.', {
        runId: run.id,
        stepId: stepRun.stepId,
        admissionState: binding.state,
      });
    }
    const entry = await this.admission.getQueueEntry(binding.queueEntryId);
    if (binding.state === 'waiting') {
      if (entry.state === 'terminal') {
        stepRun.admission = {
          ...binding,
          state: 'terminal',
          decision: { ...binding.decision, queueEntry: entry },
        };
        stepRun.status = 'failed';
        stepRun.error = entry.terminal?.reason ?? 'Workflow step admission queue terminated.';
        stepRun.completedAt = new Date().toISOString();
        run.status = 'failed';
        run.error = stepRun.error;
        run.completedAt = stepRun.completedAt;
        await this.saveRun(run);
        await this.releaseRootAdmission(
          run,
          'failed',
          `workflow-step-queue-terminal-restart:${run.id}:${stepRun.stepId}:${binding.sequence}`
        ).catch(() => {});
        broadcastWorkflowStatus(run);
      } else {
        this.scheduleAdmissionQueueDrain();
      }
      return true;
    }
    if (
      entry.state === 'dispatched' &&
      entry.dispatchedAttemptId === binding.attemptId &&
      entry.reservationId === binding.reservationId
    ) {
      if (!binding.reservationId) {
        throw new ConflictError('Dispatched workflow step is missing its reservation.', {
          runId: run.id,
          stepId: stepRun.stepId,
          queueId: entry.id,
        });
      }
      const persisted = await this.admission.get(binding.reservationId);
      const recovered = await this.admission.recoverVerifiedRun({
        workspaceId: persisted.request.workspaceId,
        taskId: binding.admissionTaskId,
        attemptId: binding.attemptId,
      });
      if (!recovered || recovered.id !== binding.reservationId) {
        throw new ConflictError('Dispatched workflow step admission could not be recovered.', {
          runId: run.id,
          stepId: stepRun.stepId,
          queueId: entry.id,
          expectedReservationId: binding.reservationId,
          recoveredReservationId: recovered?.id,
        });
      }
      const workflow = await this.workflowService.loadWorkflow(run.workflowId);
      if (!workflow || workflow.version !== run.workflowVersion) {
        throw new ConflictError('Dispatched workflow definition is unavailable for recovery.', {
          runId: run.id,
          workflowId: run.workflowId,
          workflowVersion: run.workflowVersion,
          currentWorkflowVersion: workflow?.version,
        });
      }
      void this.executeRun(run, workflow).catch((error) => {
        log.error(
          { err: error, runId: run.id, stepId: stepRun.stepId },
          'Recovered workflow step execution failed'
        );
      });
      return true;
    }
    if (entry.state === 'terminal') {
      stepRun.admission = {
        ...binding,
        state: 'terminal',
        reservationId: undefined,
        decision: { ...binding.decision, queueEntry: entry },
      };
      stepRun.status = 'failed';
      stepRun.error = entry.terminal?.reason ?? 'Workflow step admission queue terminated.';
      stepRun.completedAt = new Date().toISOString();
      run.status = 'failed';
      run.error = stepRun.error;
      run.completedAt = stepRun.completedAt;
      await this.saveRun(run);
      if (binding.reservationId) {
        await this.admission
          .release(
            binding.reservationId,
            'start-failed',
            `workflow-step-queue-terminal-restart:${run.id}:${stepRun.stepId}:${binding.sequence}`
          )
          .catch(() => {});
      }
      await this.releaseRootAdmission(
        run,
        'failed',
        `workflow-step-queue-terminal-root:${run.id}:${stepRun.stepId}:${binding.sequence}`
      ).catch(() => {});
      broadcastWorkflowStatus(run);
      return true;
    }
    stepRun.admission = {
      ...binding,
      state: 'waiting',
      reservationId: undefined,
    };
    stepRun.status = 'pending';
    stepRun.error = 'Workflow step is waiting for admission capacity.';
    run.status = 'pending';
    run.error = stepRun.error;
    await this.saveRun(run);
    if (binding.reservationId) {
      await this.admission.release(
        binding.reservationId,
        'start-failed',
        `workflow-step-queue-restart:${run.id}:${stepRun.stepId}:${binding.sequence}`
      );
    }
    if (entry.state === 'leased') {
      await this.admission.requeueQueueEntry(
        entry.id,
        'WORKFLOW_QUEUE_RESTART',
        'Server restarted before workflow step ownership became durable.'
      );
    }
    this.scheduleAdmissionQueueDrain();
    broadcastWorkflowStatus(run);
    return true;
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
    const budgetSources = {
      workspaceBudget: config.features?.budget?.enabled
        ? config.features.budget.defaultRunBudget
        : undefined,
      workflowBudget: workflow.config?.budget,
      runBudget,
    };
    const budgetPolicy = budgetService.resolve({
      ...budgetSources,
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
      status: 'pending',
      currentStep: workflow.steps[0]?.id,
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

    try {
      run.admission = await this.admitWorkflowRoot(run, task, budgetSources);
      const waitingForAdmission = run.admission.state === 'waiting';
      run.status = waitingForAdmission ? 'pending' : 'running';
      run.error = waitingForAdmission
        ? 'Workflow root is waiting for admission capacity.'
        : undefined;
      await this.saveRun(run);
      await this.snapshotWorkflow(run.id, workflow);
      if (waitingForAdmission) {
        this.scheduleAdmissionQueueDrain();
        broadcastWorkflowStatus(run);
        return run;
      }
    } catch (error) {
      if (run.admission) {
        if (run.revision) {
          run.status = 'failed';
          run.error = error instanceof Error ? error.message : 'Workflow start failed';
          run.completedAt = new Date().toISOString();
          await this.saveRun(run).catch((saveError) => {
            log.error({ err: saveError, runId }, 'Failed to persist workflow start failure');
          });
        }
        await this.releaseRootAdmission(run, 'start-failed', `start-failed:${run.id}`).catch(
          (releaseError) => {
            log.error({ err: releaseError, runId }, 'Failed to release workflow root admission');
          }
        );
      }
      throw error;
    }

    log.info({ runId, workflowId, workflowVersion: workflow.version }, 'Workflow run started');

    // Start execution (async — don't await)
    this.executeRun(run, workflow).catch((err) => {
      log.error({ runId, err }, 'Workflow run failed');
    });

    return run;
  }

  private scheduleAdmissionQueueDrain(): void {
    if (this.requestAdmissionQueueDrain) {
      this.requestAdmissionQueueDrain();
      return;
    }
    queueMicrotask(() => {
      void import('./clawdbot-agent-service.js')
        .then(({ clawdbotAgentService }) => clawdbotAgentService.reconcileQueuedLaunches())
        .catch((error) => {
          log.error({ err: error }, 'Workflow admission queue drain failed');
        });
    });
  }

  /**
   * Execute the workflow run (iterates through steps with retry logic)
   */
  private async executeRun(run: WorkflowRun, workflow: WorkflowDefinition): Promise<void> {
    try {
      // Build initial step queue (skip already completed/skipped steps on resume)
      const stepQueue: string[] = this.buildStepQueue(run, workflow);

      while (stepQueue.length > 0) {
        const stepId = stepQueue.shift();
        if (!stepId) break;
        const step = workflow.steps.find((s) => s.id === stepId);
        if (!step) {
          throw new Error(`Workflow definition is missing queued step ${stepId}`);
        }
        if (await this.evaluateRunBudget(run, workflow, step, 'workflow.step.start', true)) {
          await this.saveRun(run);
          broadcastWorkflowStatus(run);
          if (run.status === 'failed') {
            await this.releaseRootAdmission(
              run,
              'failed',
              `workflow-budget-start:${run.id}:${step.id}`
            );
          }
          return;
        }

        // Skip if step already completed/skipped (defensive when retry_step rebuilds queue)
        const existingStepRun = run.steps.find((s) => s.stepId === step.id);
        if (!existingStepRun) {
          throw new Error(`Workflow run is missing step state for ${step.id}`);
        }
        if (existingStepRun.status === 'completed' || existingStepRun.status === 'skipped') {
          continue;
        }

        const stepRun = existingStepRun;
        let providerDispatchStarted = false;

        try {
          // Resolve runtime, sandbox, host, and phase authority before creating
          // or mutating the executable step attempt.
          const preparation = await this.stepExecutor.prepareStep(step, run);
          if (preparation.kind === 'agent') {
            if (stepRun.admission?.state === 'dispatching') {
              this.assertQueuedWorkflowStepPreparation(run, stepRun, preparation);
              stepRun.admission = { ...stepRun.admission, state: 'active' };
            } else {
              stepRun.admission = await this.admitWorkflowStep(run, step, preparation);
            }
            if (stepRun.admission.state === 'waiting') {
              run.status = 'pending';
              run.currentStep = step.id;
              run.error = 'Workflow step is waiting for admission capacity.';
              stepRun.status = 'pending';
              stepRun.error = run.error;
              stepRun.completedAt = undefined;
              this.syncPipelineSummary(run, workflow);
              await this.saveRun(run);
              broadcastWorkflowStatus(run);
              this.scheduleAdmissionQueueDrain();
              return;
            }
          }
          run.status = 'running';
          run.currentStep = step.id;
          stepRun.agent ??= preparation.step.agent ?? step.agent;
          this.stepExecutor.applyPreparation(run, preparation);
          stepRun.status = 'running';
          stepRun.error = undefined;
          stepRun.startedAt = new Date().toISOString();
          if (stepRun.runRetry?.state === 'launching') {
            stepRun.runRetry = {
              ...stepRun.runRetry,
              state: 'launched',
              launchedAt: stepRun.startedAt,
              launchedRunId: `${run.id}:${step.id}:${stepRun.runRetry.sequence}`,
              selectedAgent: stepRun.agent ?? stepRun.runRetry.selectedAgent,
            };
          }
          this.syncPipelineSummary(run, workflow);
          try {
            await this.saveRun(run);
          } catch (error) {
            await this.releaseStepAdmission(
              stepRun,
              'start-failed',
              `workflow-step-persist-failed:${run.id}:${step.id}:${stepRun.admission?.sequence ?? 0}`
            );
            throw error;
          }
          broadcastWorkflowStatus(run);

          providerDispatchStarted = preparation.kind === 'agent';
          const result = await this.stepExecutor.executeStep(step, run, preparation);
          if (stepRun.admission?.reservationId) {
            const runtimeSeconds = stepRun.startedAt
              ? Math.max(0, Math.ceil((Date.now() - new Date(stepRun.startedAt).getTime()) / 1_000))
              : 0;
            await this.admission.recordBudgetUsage(stepRun.admission.reservationId, {
              schemaVersion: 'execution-tree-budget-event/v1',
              id: `usage_${stepRun.admission.attemptId}`,
              mode: 'snapshot',
              usage: {
                ...ZERO_AGENT_BUDGET_USAGE,
                ...result.budgetUsage,
                runtimeSeconds: Math.max(runtimeSeconds, result.budgetUsage?.runtimeSeconds ?? 0),
                fanOut: Math.max(1, step.parallel?.steps.length ?? 1),
                retries: stepRun.runRetry ? 1 : 0,
              },
              source: 'workflow-step-result',
              occurredAt: stepRun.startedAt ?? run.startedAt,
            });
          }
          await this.releaseStepAdmission(
            stepRun,
            'completed',
            `workflow-step-completed:${run.id}:${step.id}:${stepRun.admission?.sequence ?? 0}`
          );
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
              if ((run.status as WorkflowRun['status']) === 'failed') {
                await this.releaseRootAdmission(
                  run,
                  'failed',
                  `workflow-budget-usage:${run.id}:${step.id}`
                );
              }
              return;
            }
          }

          stepRun.status = 'completed';
          stepRun.completedAt = new Date().toISOString();
          if (!stepRun.startedAt) {
            throw new Error(`Workflow step ${step.id} completed without a start timestamp`);
          }
          stepRun.duration = Math.floor(
            (new Date(stepRun.completedAt).getTime() - new Date(stepRun.startedAt).getTime()) / 1000
          );
          stepRun.output = result.outputPath;

          // Merge step output into run context
          run.context[step.id] = result.output;

          this.syncPipelineSummary(run, workflow);
          await this.saveRun(run);
          broadcastWorkflowStatus(run);
        } catch (err: unknown) {
          run.currentStep = step.id;
          if (err instanceof WorkflowStepAdmissionError) {
            stepRun.admission = err.binding;
            stepRun.error = err.message;
            run.error = err.message;
            if (err.decision.outcome === 'retryable-overload') {
              stepRun.status = 'pending';
              stepRun.completedAt = undefined;
              run.status = 'blocked';
            } else {
              stepRun.status = 'failed';
              stepRun.completedAt = new Date().toISOString();
              run.status = 'failed';
              run.completedAt = stepRun.completedAt;
            }
            this.syncPipelineSummary(run, workflow);
            await this.saveRun(run);
            broadcastWorkflowStatus(run);
            if (run.status === 'failed') {
              await this.releaseRootAdmission(
                run,
                'failed',
                `workflow-step-admission-denied:${run.id}:${step.id}`
              );
            }
            return;
          }

          await this.releaseStepAdmission(
            stepRun,
            providerDispatchStarted ? 'failed' : 'start-failed',
            `workflow-step-error:${run.id}:${step.id}:${stepRun.admission?.sequence ?? 0}`
          );
          // --- Gate human-escalation (#778) ---
          // HumanGateBlockError is a clean, expected pause — not a real failure.
          // Handle it before the generic failure path so on_fail is not misapplied.
          if (err instanceof HumanGateBlockError) {
            stepRun.status = 'failed';
            stepRun.error = err.escalationMessage;
            stepRun.completedAt = new Date().toISOString();
            run.status = 'blocked';
            run.error = err.escalationMessage;
            // Persist gate blocking context for resume / approve endpoints.
            run.context._gateBlock = {
              stepId: err.stepId,
              escalationMessage: err.escalationMessage,
              blockedAt: new Date().toISOString(),
            };
            this.syncPipelineSummary(run, workflow);
            await this.saveRun(run);
            broadcastWorkflowStatus(run);
            log.warn(
              { runId: run.id, stepId: err.stepId },
              'Workflow blocked at human gate — awaiting resume'
            );
            return;
          }

          // Step failed
          stepRun.status = 'failed';
          stepRun.error = err instanceof Error ? err.message : 'Unknown error';
          stepRun.completedAt = new Date().toISOString();
          this.syncPipelineSummary(run, workflow);
          await this.saveRun(run);
          broadcastWorkflowStatus(run);

          // Handle failure policy
          const handled = await this.handleStepFailure(
            step,
            stepRun,
            stepQueue,
            workflow,
            run,
            err
          );
          if (!handled) {
            // No retry policy — fail the entire workflow
            throw err;
          }

          if (stepRun.runRetry?.state === 'scheduled') {
            log.info(
              {
                runId: run.id,
                stepId: step.id,
                action: stepRun.runRetry.action,
                notBefore: stepRun.runRetry.notBefore,
              },
              'Workflow recovery scheduled'
            );
            return;
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

      // All steps completed; clear any stale error from an earlier blocked phase.
      run.status = 'completed';
      run.error = undefined;
      run.completedAt = new Date().toISOString();
      this.syncPipelineSummary(run, workflow);
      await this.saveRun(run);
      broadcastWorkflowStatus(run);
      await this.releaseRootAdmission(run, 'completed', `workflow-completed:${run.id}`);

      log.info({ runId: run.id, workflowId: run.workflowId }, 'Workflow run completed');
    } catch (err: unknown) {
      if (err instanceof WorkflowRunChangedError) {
        log.info({ runId: run.id }, 'Workflow execution ownership changed before persistence');
        return;
      }
      run.status = 'failed';
      run.error = err instanceof Error ? err.message : 'Unknown error';
      run.completedAt = new Date().toISOString();
      this.syncPipelineSummary(run, workflow);
      try {
        await this.saveRun(run);
        broadcastWorkflowStatus(run);
      } finally {
        await this.releaseRootAdmission(run, 'failed', `workflow-failed:${run.id}`);
      }

      log.error({ runId: run.id, err }, 'Workflow run failed');
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
    run: WorkflowRun,
    error: unknown
  ): Promise<boolean> {
    const policy = step.on_fail;
    const config = await getConfigService().getConfig();
    const routingPolicy = config.agentRouting ?? DEFAULT_ROUTING_CONFIG;
    const failure = this.runRecoveryPolicy.classifyError(error);
    const selectedAgent = stepRun.agent ?? step.agent ?? step.id;
    const previousSequence = stepRun.runRetry?.sequence ?? stepRun.retries;
    const maxRetries = policy?.retry ?? (policy?.retry_step ? 0 : routingPolicy.maxRetries);
    const explicitFallback = policy?.escalate_to?.startsWith('agent:')
      ? policy.escalate_to.slice('agent:'.length)
      : undefined;
    const fallbackOnFailure = Boolean(
      explicitFallback || (!policy?.retry_step && routingPolicy.fallbackOnFailure)
    );
    let fallbackAgent: string | undefined = explicitFallback;
    let fallbackEligible: boolean | undefined;
    let fallbackReason: string | undefined;

    if (
      failure.retryable &&
      previousSequence >= maxRetries &&
      !stepRun.runRetry?.fallbackUsed &&
      fallbackOnFailure
    ) {
      if (!fallbackAgent && run.taskId && step.agent) {
        const task = await getTaskService().getTask(run.taskId);
        if (task) {
          const fallback = await getAgentRoutingService().getFallback(
            task,
            step.agent as AgentType
          );
          if (fallback && workflow.agents.some((agent) => agent.id === fallback.agent)) {
            fallbackAgent = fallback.agent;
            fallbackReason = fallback.reason;
          }
        }
      }
      if (fallbackAgent) {
        try {
          await this.stepExecutor.validateFallbackAgent(step, run, fallbackAgent);
          fallbackEligible = true;
        } catch (fallbackError) {
          fallbackEligible = false;
          fallbackReason =
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        }
      }
    }

    const decision = this.runRecoveryPolicy.decide(failure, {
      rootRunId: stepRun.runRetry?.rootRunId ?? `${run.id}:${step.id}:0`,
      parentRunId: `${run.id}:${step.id}:${previousSequence}`,
      selectedAgent,
      routingDecision: explicitFallback
        ? `Workflow failure policy selected fallback ${explicitFallback}.`
        : `Workflow step ${step.id} uses workspace recovery policy.`,
      ...(stepRun.providerRuntimeManifest?.digest
        ? { sourceManifestDigest: stepRun.providerRuntimeManifest.digest }
        : {}),
      requiredRuntimeCapabilities: [...(stepRun.requiredRuntimeCapabilities ?? [])],
      cumulativeBudget: run.budget?.usage ?? { ...ZERO_AGENT_BUDGET_USAGE },
      previousSequence,
      fallbackUsed: stepRun.runRetry?.fallbackUsed,
      maxRetries,
      fallbackOnFailure,
      ...(fallbackAgent ? { fallbackAgent } : {}),
      ...(fallbackEligible !== undefined ? { fallbackEligible } : {}),
      ...(fallbackReason ? { fallbackReason } : {}),
      ...(policy?.retry_delay_ms !== undefined
        ? { baseBackoffMs: Math.max(100, policy.retry_delay_ms) }
        : {}),
    });
    stepRun.runRetry = decision;

    if (decision.state === 'scheduled') {
      stepRun.retries = decision.sequence;
      stepRun.status = 'failed';
      stepRun.error = decision.reason;
      if (decision.action === 'fallback') {
        stepRun.agent = decision.selectedAgent;
      }
      run.status = 'pending';
      run.error = decision.reason;
      this.syncPipelineSummary(run, workflow);
      await this.saveRun(run);
      this.scheduleWorkflowRecovery(run.id, step.id, decision);
      return true;
    }

    if (decision.state === 'approval-required') {
      if (policy?.escalate_to === 'skip') {
        stepRun.status = 'skipped';
        this.syncPipelineSummary(run, workflow);
        await this.saveRun(run);
        return true;
      }
      run.status = 'blocked';
      run.error =
        policy?.escalate_to === 'human'
          ? policy.escalate_message || `Step ${step.id} failed`
          : decision.handoff?.summary || decision.reason;
      this.syncPipelineSummary(run, workflow);
      await this.saveRun(run);
      return true;
    }

    // Strategy 2: Retry a different step after automatic recovery is exhausted.
    if (
      policy?.retry_step &&
      !failure.approvalRequired &&
      failure.classification !== 'cancellation'
    ) {
      const retryStep = workflow.steps.find((s) => s.id === policy.retry_step);
      if (!retryStep) {
        throw new Error(`retry_step references unknown step: ${policy.retry_step}`);
      }

      // Enforce cross-step reroute budget (#780)
      const maxReroutes = policy.max_reroutes ?? MAX_REROUTES_DEFAULT;
      run.retryRouteCount = (run.retryRouteCount ?? 0) + 1;

      if (run.retryRouteCount > maxReroutes) {
        // Budget exhausted — apply on_exhausted policy or fail/block
        const exhausted = policy.on_exhausted;
        log.warn(
          {
            runId: run.id,
            stepId: step.id,
            retryStep: retryStep.id,
            retryRouteCount: run.retryRouteCount,
            maxReroutes,
          },
          'retry_step reroute budget exhausted'
        );

        if (exhausted?.escalate_to === 'human') {
          run.status = 'blocked';
          run.error =
            exhausted.escalate_message ||
            `retry_step budget exhausted after ${maxReroutes} reroutes`;
          this.syncPipelineSummary(run, workflow);
          await this.saveRun(run);
          log.warn({ runId: run.id, stepId: step.id }, 'Workflow blocked: retry_step exhausted');
          return true;
        }

        if (exhausted?.escalate_to === 'skip') {
          stepRun.status = 'skipped';
          this.syncPipelineSummary(run, workflow);
          await this.saveRun(run);
          return true;
        }

        // Default: fail deterministically
        throw new Error(
          `retry_step budget exhausted: step "${step.id}" has rerouted ${run.retryRouteCount - 1} times (max ${maxReroutes})`
        );
      }

      // Reset the retry step's state
      const retryStepRun = run.steps.find((s) => s.stepId === retryStep.id);
      if (!retryStepRun) {
        throw new Error(`Workflow run is missing retry step state for ${retryStep.id}`);
      }
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
        retryRouteCount: run.retryRouteCount,
      };

      this.syncPipelineSummary(run, workflow);
      await this.saveRun(run);
      log.info(
        { failedStep: step.id, retryStep: retryStep.id, retryRouteCount: run.retryRouteCount },
        'Routing to retry step'
      );
      return true;
    }

    // Strategy 3: Escalation
    if (policy?.escalate_to === 'human') {
      run.status = 'blocked';
      run.error = policy.escalate_message || `Step ${step.id} failed`;
      this.syncPipelineSummary(run, workflow);
      await this.saveRun(run);

      log.warn({ runId: run.id, stepId: step.id }, 'Workflow blocked');
      return true; // Handled (blocked, not failed)
    }

    if (policy?.escalate_to === 'skip') {
      stepRun.status = 'skipped';
      this.syncPipelineSummary(run, workflow);
      await this.saveRun(run);
      log.info({ stepId: step.id }, 'Skipping failed step');
      return true;
    }

    if (explicitFallback) {
      throw new Error(decision.reason);
    }

    return false; // No policy matched — fail the workflow
  }

  async reconcilePendingRecoveries(): Promise<void> {
    await this.admission.expireAbandoned();
    const runs = (await this.listRuns()).filter(
      (run) => run.status === 'pending' || run.status === 'running'
    );
    let scheduledCount = 0;
    for (const run of runs) {
      try {
        if (await this.reconcileWorkflowRootQueue(run)) {
          continue;
        }
        await this.ensureWorkflowRootAdmission(run);
      } catch (error) {
        run.status = 'blocked';
        run.error =
          error instanceof Error
            ? `Workflow root admission recovery failed: ${error.message}`
            : 'Workflow root admission recovery failed.';
        await this.saveRun(run);
        broadcastWorkflowStatus(run);
        continue;
      }
      const stepRun = run.steps.find((step) => step.stepId === run.currentStep);
      if (stepRun) {
        try {
          if (await this.reconcileWorkflowStepQueue(run, stepRun)) {
            continue;
          }
        } catch (error) {
          run.status = 'blocked';
          run.error =
            error instanceof Error
              ? `Workflow step admission recovery failed: ${error.message}`
              : 'Workflow step admission recovery failed.';
          await this.saveRun(run);
          broadcastWorkflowStatus(run);
          continue;
        }
      }
      const recovery = stepRun?.runRetry;
      if (stepRun?.status === 'running') {
        await this.releaseStepAdmission(
          stepRun,
          'reconciled',
          `workflow-step-restart:${run.id}:${stepRun.stepId}:${stepRun.admission?.sequence ?? 0}`
        );
        if (recovery?.state === 'launched') {
          stepRun.runRetry = {
            ...recovery,
            state: 'approval-required',
            action: 'approval',
            reason:
              'The server restarted after recovery launch and cannot prove the provider terminal state.',
            backoffMs: 0,
            handoff: {
              summary: 'Workflow recovery requires operator reconciliation after restart.',
              nextActions: [
                'Inspect the provider session and persisted step output.',
                'Confirm no provider work remains before resuming or replacing the run.',
              ],
            },
          };
        }
        stepRun.status = 'failed';
        stepRun.error =
          stepRun.runRetry?.handoff?.summary ??
          'Workflow step requires operator reconciliation after server restart.';
        run.status = 'blocked';
        run.error = stepRun.error;
        await this.saveRun(run);
        broadcastWorkflowStatus(run);
        continue;
      }
      if (!stepRun || !recovery) {
        continue;
      }
      if (!['scheduled', 'launching'].includes(recovery.state)) continue;
      const reconciledRecovery: RunRecoveryRecord =
        recovery.state === 'launching'
          ? {
              ...recovery,
              state: 'scheduled',
              notBefore: new Date().toISOString(),
              reason: `${recovery.reason} Re-queued after server restart before provider launch.`,
            }
          : recovery;
      if (recovery.state === 'launching') {
        stepRun.runRetry = reconciledRecovery;
        stepRun.status = 'failed';
        stepRun.error = reconciledRecovery.reason;
        run.status = 'pending';
        run.error = reconciledRecovery.reason;
        await this.saveRun(run);
      }
      this.scheduleWorkflowRecovery(run.id, stepRun.stepId, reconciledRecovery);
      scheduledCount += 1;
    }
    if (scheduledCount > 0) {
      log.info({ scheduledCount }, 'Workflow retry/fallback reconciliation complete');
    }
  }

  async cancelPendingRecovery(
    runId: string,
    stepId: string,
    parentRunId: string,
    actor: string
  ): Promise<WorkflowRun> {
    const run = await this.getRun(runId);
    if (!run) throw new NotFoundError(`Run ${runId} not found`);
    const stepRun = run.steps.find((step) => step.stepId === stepId);
    const recovery = stepRun?.runRetry;
    if (!stepRun || !recovery || recovery.parentRunId !== parentRunId) {
      throw new ConflictError('Recovery cancellation does not match the pending workflow step');
    }
    if (!['scheduled', 'launching'].includes(recovery.state)) {
      throw new ConflictError(`Workflow recovery is not pending (state: ${recovery.state})`);
    }
    const cancelled: RunRecoveryRecord = {
      ...recovery,
      state: 'cancelled',
      action: 'cancelled',
      reason: 'Automatic workflow recovery was cancelled by an operator.',
      backoffMs: 0,
      cancelledAt: new Date().toISOString(),
      cancelledBy: actor,
      handoff: {
        summary: 'Automatic workflow recovery was cancelled.',
        nextActions: ['Resume or restart the workflow explicitly if it should continue.'],
      },
    };
    stepRun.runRetry = cancelled;
    run.status = 'blocked';
    run.error = cancelled.handoff?.summary ?? cancelled.reason;
    await this.saveRun(run);
    await this.releaseStepAdmission(
      stepRun,
      'cancelled',
      `workflow-recovery-cancelled:${run.id}:${stepId}:${cancelled.sequence}`
    );
    this.clearScheduledWorkflowRecovery(runId, stepId);
    broadcastWorkflowStatus(run);
    return run;
  }

  private scheduleWorkflowRecovery(
    runId: string,
    stepId: string,
    recovery: RunRecoveryRecord
  ): void {
    if (recovery.state !== 'scheduled') return;
    this.clearScheduledWorkflowRecovery(runId);
    const notBefore = recovery.notBefore ? Date.parse(recovery.notBefore) : Date.now();
    const delay = Math.max(0, Math.min(2_147_483_647, notBefore - Date.now()));
    const timer = setTimeout(() => {
      const scheduled = scheduledWorkflowRecoveries.get(runId);
      if (!scheduled || scheduled.stepId !== stepId) return;
      scheduledWorkflowRecoveries.delete(runId);
      void this.resumeScheduledWorkflowRecovery(runId, stepId).catch((error) => {
        log.error({ err: error, runId, stepId }, 'Scheduled workflow recovery failed');
      });
    }, delay);
    timer.unref?.();
    scheduledWorkflowRecoveries.set(runId, { stepId, timer });
  }

  private clearScheduledWorkflowRecovery(runId: string, expectedStepId?: string): void {
    const scheduled = scheduledWorkflowRecoveries.get(runId);
    if (!scheduled || (expectedStepId && scheduled.stepId !== expectedStepId)) return;
    clearTimeout(scheduled.timer);
    scheduledWorkflowRecoveries.delete(runId);
  }

  private async resumeScheduledWorkflowRecovery(runId: string, stepId: string): Promise<void> {
    let recoveryToReschedule: RunRecoveryRecord | undefined;
    const run = await this.getRun(runId);
    const stepRun = run?.steps.find((step) => step.stepId === stepId);
    const recovery = stepRun?.runRetry;
    if (!run || !stepRun || recovery?.state !== 'scheduled' || run.status !== 'pending') {
      return;
    }
    if (recovery.notBefore && Date.parse(recovery.notBefore) > Date.now()) {
      recoveryToReschedule = recovery;
    }
    if (recoveryToReschedule) {
      this.scheduleWorkflowRecovery(runId, stepId, recoveryToReschedule);
      return;
    }
    const workflow = await this.workflowService.loadWorkflow(run.workflowId);
    if (!workflow) {
      stepRun.runRetry = {
        ...recovery,
        state: 'exhausted',
        action: 'terminal',
        reason: `Workflow ${run.workflowId} no longer exists.`,
        backoffMs: 0,
        handoff: {
          summary: 'The persisted workflow recovery cannot be resumed.',
          nextActions: ['Restore the workflow definition or start a replacement run.'],
        },
      };
      run.status = 'failed';
      run.error = stepRun.runRetry.reason;
      run.completedAt = new Date().toISOString();
      await this.saveRun(run);
      await this.releaseRootAdmission(
        run,
        'failed',
        `workflow-recovery-definition-missing:${run.id}`
      );
      broadcastWorkflowStatus(run);
      return;
    }
    try {
      await this.ensureWorkflowRootAdmission(run);
    } catch (error) {
      if (error instanceof WorkflowRunChangedError) {
        log.info({ runId, stepId }, 'Workflow recovery admission claim lost to another process');
        return;
      }
      throw error;
    }
    stepRun.runRetry = {
      ...recovery,
      state: 'launching',
      selectedAgent: stepRun.agent ?? recovery.selectedAgent,
    };
    stepRun.status = 'pending';
    stepRun.error = undefined;
    run.error = undefined;
    try {
      await this.saveRun(run);
    } catch (error) {
      if (error instanceof ConflictError) {
        log.info({ runId, stepId }, 'Workflow recovery claim lost to another process');
        return;
      }
      throw error;
    }

    void this.executeRun(run, workflow).catch((error) => {
      log.error({ err: error, runId, stepId }, 'Workflow recovery execution failed');
    });
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

    const workflow = await this.workflowService.loadWorkflow(run.workflowId);
    if (!workflow) {
      throw new NotFoundError(`Workflow ${run.workflowId} not found`);
    }
    await this.ensureWorkflowRootAdmission(run);

    // Merge resume context after rejecting attempts to replace server-owned context.
    run.context = {
      ...run.context,
      ...this.validateExternalContext(resumeContext, 'Resume context'),
    };
    // Clear gate block context and stale blocked-state errors on resume.
    delete run.context._gateBlock;
    run.status = 'running';
    run.error = undefined;
    await this.saveRun(run);

    this.syncPipelineSummary(run, workflow);
    await this.saveRun(run);

    log.info({ runId }, 'Resuming workflow run');

    this.executeRun(run, workflow).catch((err) => {
      log.error({ runId, err }, 'Workflow resume failed');
    });

    return run;
  }

  /**
   * Approve a blocked human-gate step and resume the run (#778).
   * Marks the gate step as 'completed' (human-approved) so resume skips it.
   */
  async approveGateStep(
    runId: string,
    stepId: string,
    approvedBy: string,
    resumeContext?: Record<string, unknown>
  ): Promise<WorkflowRun> {
    const run = await this.getRun(runId);
    if (!run) {
      throw new NotFoundError(`Run ${runId} not found`);
    }

    if (run.status !== 'blocked') {
      throw new ValidationError(`Run ${runId} is not blocked (status: ${run.status})`);
    }

    const blockedGateId = (run.context._gateBlock as { stepId?: string } | undefined)?.stepId;
    if (!blockedGateId) {
      throw new ValidationError(`Run ${runId} is not blocked at a human gate`);
    }
    if (blockedGateId !== stepId) {
      throw new ValidationError(
        `Run ${runId} is blocked at gate "${blockedGateId}", not "${stepId}"`
      );
    }

    const stepRun = run.steps.find((s) => s.stepId === stepId);
    if (!stepRun) {
      throw new NotFoundError(`Step ${stepId} not found in run ${runId}`);
    }

    // Mark the gate step as completed (human approved it — override the false condition).
    stepRun.status = 'completed';
    stepRun.completedAt = new Date().toISOString();
    stepRun.error = undefined;

    // Synthesize gate output for downstream templating and context consumers.
    run.context[stepId] = {
      passed: true,
      approvedBy,
      approvedAt: new Date().toISOString(),
      humanApproved: true,
    };

    // Record approval in reserved context for audit/trace.
    run.context._gateApproval = {
      stepId,
      approved: true,
      approvedBy,
      approvedAt: new Date().toISOString(),
    };

    // Persist the gate-step completion BEFORE resumeRun re-loads from storage.
    await this.saveRun(run);

    log.info({ runId, stepId, approvedBy }, 'Gate step approved — resuming run');

    return this.resumeRun(runId, resumeContext);
  }

  /**
   * Reject a blocked human-gate step — terminates the run as failed (#778).
   */
  async rejectGateStep(runId: string, stepId: string, rejectedBy: string): Promise<WorkflowRun> {
    const run = await this.getRun(runId);
    if (!run) {
      throw new NotFoundError(`Run ${runId} not found`);
    }

    if (run.status !== 'blocked') {
      throw new ValidationError(`Run ${runId} is not blocked (status: ${run.status})`);
    }

    const blockedGateId = (run.context._gateBlock as { stepId?: string } | undefined)?.stepId;
    if (!blockedGateId) {
      throw new ValidationError(`Run ${runId} is not blocked at a human gate`);
    }
    if (blockedGateId !== stepId) {
      throw new ValidationError(
        `Run ${runId} is blocked at gate "${blockedGateId}", not "${stepId}"`
      );
    }

    const stepRun = run.steps.find((s) => s.stepId === stepId);
    if (!stepRun) {
      throw new NotFoundError(`Step ${stepId} not found in run ${runId}`);
    }

    run.status = 'failed';
    run.error = `Gate step ${stepId} rejected by ${rejectedBy}`;
    run.completedAt = new Date().toISOString();
    delete run.context._gateBlock;

    const workflow = await this.workflowService.loadWorkflow(run.workflowId);
    if (workflow) {
      this.syncPipelineSummary(run, workflow);
    }
    await this.saveRun(run);
    await this.releaseRootAdmission(run, 'failed', `workflow-gate-rejected:${run.id}:${stepId}`);
    broadcastWorkflowStatus(run);

    log.warn({ runId, stepId, rejectedBy }, 'Gate step rejected — run failed');
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
    const expectedRevision = run.revision ?? 0;
    const nextRun: WorkflowRun = {
      ...run,
      revision: expectedRevision + 1,
      lastCheckpoint: new Date().toISOString(),
    };

    if (this.repository) {
      if (!this.repository.save(nextRun, expectedRevision)) {
        throw new WorkflowRunChangedError(run.id, expectedRevision);
      }
      Object.assign(run, nextRun);
      return;
    }

    const runDir = path.join(this.runsDir, run.id);
    await fs.mkdir(runDir, { recursive: true });

    const runPath = path.join(runDir, 'run.json');
    await withFileLock(runPath, async () => {
      let current: WorkflowRun | null = null;
      try {
        current = JSON.parse(await fs.readFile(runPath, 'utf-8')) as WorkflowRun;
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
          throw error;
        }
      }
      const currentRevision = current?.revision ?? 0;
      if (
        (current && currentRevision !== expectedRevision) ||
        (!current && expectedRevision !== 0)
      ) {
        throw new WorkflowRunChangedError(run.id, expectedRevision, current?.revision);
      }
      await atomicWriteFile(runPath, JSON.stringify(nextRun, null, 2));
    });
    Object.assign(run, nextRun);
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
  runRecoveryPolicy?: RunRecoveryPolicyService;
  stepExecutor?: WorkflowStepExecutor;
  admission?: AdmissionControlService;
  requestAdmissionQueueDrain?: () => void;
}

function workflowExecutionTreePolicy(
  policy: AgentBudgetPolicy | undefined,
  scope: ExecutionTreeBudgetPolicy['scope'],
  scopeId: string,
  fallbackName: string
): ExecutionTreeBudgetPolicy | undefined {
  if (
    !policy ||
    policy.enabled === false ||
    !policy.limits ||
    Object.keys(policy.limits).length === 0
  ) {
    return undefined;
  }
  return {
    id: `budget_${createHash('sha256').update(`${scope}:${scopeId}`).digest('hex').slice(0, 32)}`,
    scope,
    scopeId,
    name: policy.name?.trim() || fallbackName,
    limits: { ...policy.limits },
    hardAction: policy.hardAction ?? 'pause',
  };
}

function mergeWorkflowExecutionTreePolicies(
  policies: Array<ExecutionTreeBudgetPolicy | undefined>
): ExecutionTreeBudgetPolicy[] {
  const merged = new Map<string, ExecutionTreeBudgetPolicy>();
  for (const policy of policies) {
    if (!policy) continue;
    const current = merged.get(policy.id);
    if (!current) {
      merged.set(policy.id, policy);
      continue;
    }
    const limits = { ...current.limits };
    for (const [metric, limit] of Object.entries(policy.limits)) {
      const currentLimit = limits[metric as keyof typeof limits];
      limits[metric as keyof typeof limits] =
        currentLimit === undefined ? limit : Math.min(currentLimit, limit);
    }
    merged.set(policy.id, { ...current, limits });
  }
  return [...merged.values()];
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

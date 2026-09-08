import {
  DEFAULT_ROUTING_CONFIG,
  ZERO_AGENT_BUDGET_USAGE,
  type AgentBudgetUsage,
  type AgentType,
  type CompletionResult,
  type ExecutableAgentProvider,
  type ProviderRuntimeCapabilityId,
  type RunEventEnvelope,
  type RunEventKind,
  type RunRecoveryRecord,
  type RunSupervisorRecord,
  type RunSupervisorRecoveryRecord,
  type RunSupervisorRecoveryOperation,
  type Task,
  type TaskAttempt,
} from '@veritas-kanban/shared';
import { ConflictError, NotFoundError } from '../middleware/error-handler.js';
import {
  CompletionOwnershipError,
  type AttemptLifecycleCoordinator,
} from './attempt-lifecycle-coordinator.js';
import { providerRuntimeControls } from './provider-runtime-control-service.js';
import { createLogger } from '../lib/logger.js';
import type { AgentLaunchStatus, AgentStartOptions } from './clawdbot-agent-service.js';
import type { TaskService } from './task-service.js';
import type { AdmissionControlService } from './admission-control-service.js';
import type { RunSupervisorService } from './run-supervisor-service.js';
import type { RunEventJournalService } from './run-event-journal-service.js';
import type { RunRecoveryPolicyService } from './run-recovery-policy-service.js';
import type { AgentRoutingService } from './agent-routing-service.js';
import type { ProviderTerminalClaim } from './provider-completion-service.js';

const log = createLogger('run-recovery');
export interface RecoveryPendingRun {
  attemptId: string;
}

/** Recovery orchestrates existing authorities; it cannot reserve or finalize a run itself. */
export interface RunRecoveryHost<Pending extends RecoveryPendingRun> {
  tasks: Pick<TaskService, 'getTask' | 'listTasks'>;
  attempts: Pick<AttemptLifecycleCoordinator, 'persistActiveAttempt' | 'assertCompletionBinding'>;
  admission: Pick<AdmissionControlService, 'expireAbandoned'>;
  supervisor: Pick<
    RunSupervisorService,
    | 'findByAttempt'
    | 'register'
    | 'requireRecovery'
    | 'recover'
    | 'checkpoint'
    | 'isLocalProcessAlive'
  >;
  events: Pick<RunEventJournalService, 'list'>;
  policy: Pick<RunRecoveryPolicyService, 'decide' | 'classifyError' | 'classifyCompletion'>;
  getFallback: AgentRoutingService['getFallback'];
  executableProvider(provider: string | undefined): ExecutableAgentProvider | 'system';
  redact(text: string): string;
  launch(taskId: string, agent: AgentType, options: AgentStartOptions): Promise<AgentLaunchStatus>;
  validateFallback(taskId: string, agent: AgentType, options: AgentStartOptions): Promise<void>;
  pendingRun(taskId: string): Pending | undefined;
  attachRecoveredRun(
    task: Task,
    attempt: TaskAttempt,
    supervisor: RunSupervisorRecord
  ): Promise<{ pending: Pending; provider: ExecutableAgentProvider; adapter: string }>;
  dropPendingRun(taskId: string): void;
  finalizeRecoveredRun(taskId: string, pending: Pending): Promise<void>;
  persistSupervisorCompletion(
    task: Task,
    attempt: TaskAttempt,
    result: CompletionResult
  ): Promise<void>;
  persistRestartedCompletion(
    task: Task,
    attempt: TaskAttempt,
    claim: ProviderTerminalClaim,
    options: { preserveNonActiveTaskStatus?: boolean }
  ): Promise<void>;
  reconcileGoalContinuations(tasks: Task[]): Promise<void>;
  appendEvent(
    taskId: string,
    attemptId: string,
    kind: RunEventKind,
    payload: Record<string, unknown>,
    options: {
      provider: ExecutableAgentProvider | 'system' | 'operator';
      adapter: string;
      agent?: string;
      model?: string;
      dedupeKey?: string;
    }
  ): Promise<RunEventEnvelope>;
}

/** Owns recovery timers, restart reconciliation, and retry/fallback decisions for one orchestrator. */
export class RunRecoveryCoordinator<Pending extends RecoveryPendingRun> {
  private recoveredProcessMonitors = new Map<string, NodeJS.Timeout>();
  private scheduledRecoveries = new Map<
    string,
    { attemptId: string; timer: ReturnType<typeof setTimeout> }
  >();
  constructor(private readonly host: RunRecoveryHost<Pending>) {}

  planError(taskId: string, attempt: TaskAttempt, error: unknown) {
    return this.planTaskRecovery(taskId, attempt, this.host.policy.classifyError(error));
  }
  planCompletion(taskId: string, attempt: TaskAttempt, result: CompletionResult) {
    return this.planTaskRecovery(taskId, attempt, this.host.policy.classifyCompletion(result));
  }
  dispose(): void {
    for (const taskId of this.scheduledRecoveries.keys()) this.clearScheduledRecovery(taskId);
    for (const taskId of this.recoveredProcessMonitors.keys())
      this.clearRecoveredProcessMonitor(taskId);
  }

  /**
   * Reconcile persisted running attempts after a server restart.
   *
   * After an unexpected restart the in-memory `pendingAgents` map is empty,
   * but task files can still contain attempts with status `'running'`.
   * Attempts with complete durable supervisor bindings are recovered through
   * their supervisor. Older attempts receive a digest-bound interrupted
   * completion when possible, or are blocked for operator recovery.
   *
   * Safe to call multiple times; only tasks whose current attempt is `'running'`
   * and whose taskId is NOT in `pendingAgents` are touched.
   */
  async reconcileRunningAttempts(): Promise<void> {
    await this.host.admission.expireAbandoned();
    let tasks: Task[];
    try {
      tasks = await this.host.tasks.listTasks();
    } catch (err) {
      log.warn(
        { err },
        '[ClawdbotAgent] reconcileRunningAttempts: failed to list tasks — skipping'
      );
      return;
    }

    let recoveredCount = 0;
    let recoveryRequiredCount = 0;

    for (const task of tasks) {
      if (!task.attempt || task.attempt.status !== 'running') continue;
      if (this.host.pendingRun(task.id)) continue;

      try {
        const attempt = task.attempt;
        if (
          !attempt.taskEnvelope ||
          !attempt.runLaunchManifest ||
          !attempt.providerRuntimeManifest ||
          !attempt.harnessSupport
        ) {
          const claim: ProviderTerminalClaim = {
            terminalSource: 'operator-interruption',
            status: 'interrupted',
            summary:
              'Legacy running attempt has no durable supervisor bindings and cannot be recovered safely.',
          };
          if (attempt.taskEnvelope && attempt.providerRuntimeManifest) {
            await this.host.persistRestartedCompletion(task, attempt, claim, {
              preserveNonActiveTaskStatus: true,
            });
          } else {
            const failedAttempt: TaskAttempt = {
              ...attempt,
              status: 'failed',
              ended: new Date().toISOString(),
            };
            await this.host.attempts.persistActiveAttempt({
              task,
              attempt: failedAttempt,
              ...(task.status === 'in-progress' ? { status: 'blocked' } : {}),
            });
          }
          recoveryRequiredCount += 1;
          continue;
        }

        this.host.attempts.assertCompletionBinding(task.id, attempt);
        const provider = this.host.executableProvider(attempt.provider);
        if (provider === 'system') {
          throw new CompletionOwnershipError('Persisted attempt has no executable provider.', {
            taskId: task.id,
            attemptId: attempt.id,
          });
        }
        let supervisor = await this.host.supervisor.findByAttempt(
          attempt.taskEnvelope.workspace.workspaceId,
          task.id,
          attempt.id
        );
        let recovery: Awaited<ReturnType<RunSupervisorService['recover']>>;
        if (!supervisor) {
          const recoveryOperations = providerRuntimeControls(attempt.providerRuntimeManifest)
            .controls.filter(
              (control) =>
                control.available &&
                ['status', 'stop', 'reattach', 'resume'].includes(control.action)
            )
            .map((control) => control.action as RunSupervisorRecoveryOperation);
          supervisor = await this.host.supervisor.register({
            workspaceId: attempt.taskEnvelope.workspace.workspaceId,
            taskId: task.id,
            attemptId: attempt.id,
            provider,
            adapter: attempt.providerRuntimeManifest.adapter,
            providerVersion: attempt.providerRuntimeManifest.providerVersion,
            providerRuntimeManifestDigest: attempt.providerRuntimeManifest.digest,
            taskEnvelopeDigest: attempt.taskEnvelope.digest,
            runLaunchManifestDigest: attempt.runLaunchManifest.digest,
            worktreePath: attempt.taskEnvelope.workspace.worktreePath,
            worktreeManifestId: attempt.taskEnvelope.workspace.worktreeManifestId,
            worktreeLeaseId: attempt.taskEnvelope.workspace.ownershipLeaseId,
            recoveryOperations,
            budget: attempt.budget,
          });
          supervisor = await this.host.supervisor.requireRecovery(
            supervisor.id,
            'supervisor-record-missing',
            'The running attempt predates its durable supervisor record.',
            'Verify that no provider process or remote session remains, then launch a new attempt.'
          );
          recovery = { outcome: 'recovery-required', record: supervisor };
        } else {
          recovery = await this.host.supervisor.recover(supervisor.id, {
            provider,
            adapter: attempt.providerRuntimeManifest.adapter,
            providerRuntimeManifestDigest: attempt.providerRuntimeManifest.digest,
            taskEnvelopeDigest: attempt.taskEnvelope.digest,
            runLaunchManifestDigest: attempt.runLaunchManifest.digest,
            worktreePath: attempt.taskEnvelope.workspace.worktreePath,
            worktreeManifestId: attempt.taskEnvelope.workspace.worktreeManifestId,
            worktreeLeaseId: attempt.taskEnvelope.workspace.ownershipLeaseId,
          });
        }
        if (recovery.outcome === 'lease-held') {
          log.info(
            { taskId: task.id, attemptId: attempt.id, supervisorId: supervisor.id },
            'Skipped run recovery because another live supervisor owns the lease'
          );
          continue;
        }
        if (recovery.outcome === 'reattached') {
          await this.restoreRecoveredRun(task, attempt, recovery.record);
          recoveredCount += 1;
          continue;
        }
        if (recovery.outcome === 'terminal') {
          if (recovery.record.terminal?.completionResult) {
            await this.host.persistSupervisorCompletion(
              task,
              attempt,
              recovery.record.terminal.completionResult
            );
            recoveredCount += 1;
          } else {
            const runRecovery: RunSupervisorRecoveryRecord = {
              code: 'terminal-result-missing',
              detail: 'The supervisor is terminal but has no durable normalized completion result.',
              nextAction:
                'Inspect the terminal run event and provider log, then resolve the attempt manually.',
              recordedAt: new Date().toISOString(),
            };
            const recoveredAttempt: TaskAttempt = {
              ...attempt,
              runSupervisorId: recovery.record.id,
              runRecovery,
            };
            await this.host.attempts.persistActiveAttempt({
              task,
              attempt: recoveredAttempt,
              ...(task.status === 'in-progress' ? { status: 'blocked' } : {}),
            });
            recoveryRequiredCount += 1;
          }
          continue;
        }

        const runRecovery = recovery.recovery ?? recovery.record.recovery;
        await this.host.appendEvent(
          task.id,
          attempt.id,
          'run.recovered',
          {
            status: 'recovery-required',
            recoveryCode: runRecovery?.code,
            summary: runRecovery?.detail,
            nextAction: runRecovery?.nextAction,
            lastEventSequence: recovery.record.lastEventSequence,
          },
          {
            provider,
            adapter: attempt.providerRuntimeManifest.adapter,
            agent: attempt.agent,
            model: attempt.model,
            dedupeKey: `run.recovery-required:${recovery.record.revision}`,
          }
        );
        const recoveredAttempt: TaskAttempt = {
          ...attempt,
          runSupervisorId: recovery.record.id,
          runRecovery,
        };
        await this.host.attempts.persistActiveAttempt({
          task,
          attempt: recoveredAttempt,
          ...(task.status === 'in-progress' ? { status: 'blocked' } : {}),
        });
        recoveryRequiredCount += 1;
      } catch (err) {
        log.warn(
          { err, taskId: task.id },
          '[ClawdbotAgent] reconcileRunningAttempts: failed to update task'
        );
      }
    }

    if (recoveredCount > 0 || recoveryRequiredCount > 0) {
      log.info(
        { recoveredCount, recoveryRequiredCount },
        '[ClawdbotAgent] Durable run supervisor startup reconciliation complete'
      );
    }
    await this.host.reconcileGoalContinuations(tasks);
  }

  /**
   * Restore durable retry/fallback timers after process restart.
   *
   * A record left in `launching` has no child attempt, otherwise the child
   * would be the task's current attempt. Re-queueing that exact record is safe
   * because the task revision and parent attempt ID are claimed again before
   * launch.
   */
  async reconcilePendingRecoveries(): Promise<void> {
    let tasks: Task[];
    try {
      tasks = await this.host.tasks.listTasks();
    } catch (error) {
      log.warn({ err: error }, '[ClawdbotAgent] reconcilePendingRecoveries: failed to list tasks');
      return;
    }

    let scheduledCount = 0;
    for (const task of tasks) {
      const attempt = task.attempt;
      const recovery = attempt?.runRetry;
      if (!attempt || !recovery) continue;
      if (attempt.status === 'running' || !['scheduled', 'launching'].includes(recovery.state)) {
        continue;
      }

      try {
        let record = recovery;
        if (record.state === 'launching') {
          record = {
            ...record,
            state: 'scheduled',
            notBefore: new Date().toISOString(),
            reason: `${record.reason} Re-queued after server restart before child launch.`,
          };
          const recoveredAttempt = { ...attempt, runRetry: record };
          const updated = await this.host.attempts.persistActiveAttempt({
            task,
            attempt: recoveredAttempt,
          });
          if (!updated) continue;
          await this.host.appendEvent(
            task.id,
            attempt.id,
            'recovery.reconciled',
            {
              action: record.action,
              sequence: record.sequence,
              state: record.state,
              notBefore: record.notBefore,
            },
            {
              provider: 'system',
              adapter: 'run-recovery',
              agent: record.selectedAgent,
              dedupeKey: `recovery.reconciled:${record.sequence}`,
            }
          );
        }
        this.scheduleTaskRecovery(task.id, attempt.id, record);
        scheduledCount += 1;
      } catch (error) {
        log.warn(
          { err: error, taskId: task.id, attemptId: attempt.id },
          '[ClawdbotAgent] Failed to reconcile pending recovery'
        );
      }
    }

    if (scheduledCount > 0) {
      log.info(
        { scheduledCount },
        '[ClawdbotAgent] Durable retry/fallback reconciliation complete'
      );
    }
  }

  async getTaskRecovery(taskId: string): Promise<RunRecoveryRecord | null> {
    const task = await this.host.tasks.getTask(taskId);
    if (!task) throw new NotFoundError(`Task "${taskId}" not found`);
    if (task.attempt?.runRetry) return task.attempt.runRetry;
    return (
      [...(task.attempts ?? [])].reverse().find((attempt) => attempt.runRetry)?.runRetry ?? null
    );
  }

  async cancelTaskRecovery(
    taskId: string,
    expectedAttemptId: string,
    actor = 'operator'
  ): Promise<RunRecoveryRecord> {
    const task = await this.host.tasks.getTask(taskId);
    if (!task) throw new NotFoundError(`Task "${taskId}" not found`);
    const attempt = task.attempt;
    const recovery = attempt?.runRetry;
    if (!attempt || attempt.id !== expectedAttemptId || !recovery) {
      throw new ConflictError('Recovery cancellation does not match the active attempt', {
        activeAttemptId: attempt?.id,
        requestedAttemptId: expectedAttemptId,
      });
    }
    if (!['scheduled', 'launching'].includes(recovery.state)) {
      throw new ConflictError('Recovery is not pending cancellation', {
        attemptId: attempt.id,
        recoveryState: recovery.state,
      });
    }

    const cancelled: RunRecoveryRecord = {
      ...recovery,
      state: 'cancelled',
      action: 'cancelled',
      reason: 'Automatic recovery was cancelled by an operator.',
      backoffMs: 0,
      cancelledAt: new Date().toISOString(),
      cancelledBy: actor.trim() || 'operator',
      handoff: {
        summary: 'Automatic recovery was cancelled.',
        nextActions: ['Launch a new attempt explicitly if the objective should continue.'],
      },
    };
    const cancelledAttempt = { ...attempt, runRetry: cancelled };
    const updated = await this.host.attempts.persistActiveAttempt({
      task,
      attempt: cancelledAttempt,
    });
    if (!updated) throw new Error(`Task "${taskId}" disappeared during recovery cancellation`);
    this.clearScheduledRecovery(taskId, expectedAttemptId);
    await this.host.appendEvent(
      taskId,
      attempt.id,
      'recovery.cancelled',
      {
        action: recovery.action,
        sequence: recovery.sequence,
        actor: cancelled.cancelledBy,
      },
      {
        provider: 'operator',
        adapter: 'run-recovery',
        agent: recovery.selectedAgent,
        dedupeKey: `recovery.cancelled:${recovery.sequence}`,
      }
    );
    return cancelled;
  }

  private async planTaskRecovery(
    taskId: string,
    failedAttempt: TaskAttempt,
    failure: RunRecoveryRecord['failure']
  ): Promise<RunRecoveryRecord | null> {
    const task = await this.host.tasks.getTask(taskId);
    if (!task || task.attempt?.id !== failedAttempt.id) return null;
    const currentAttempt = task.attempt;
    const currentRecovery = currentAttempt.runRetry;
    if (
      currentRecovery &&
      ['scheduled', 'approval-required', 'exhausted', 'cancelled'].includes(currentRecovery.state)
    ) {
      return currentRecovery;
    }
    const redactedFailure = {
      ...failure,
      summary: this.host.redact(failure.summary),
    };

    const launchManifest = currentAttempt.runLaunchManifest;
    const routing = launchManifest?.routing;
    const maxRetries = routing?.maxRetries ?? DEFAULT_ROUTING_CONFIG.maxRetries;
    const fallbackOnFailure = routing?.fallbackOnFailure ?? routing?.fallbackAllowed ?? false;
    const requiredRuntimeCapabilities = [
      ...(launchManifest?.providerRequirements.required ?? []),
    ] as ProviderRuntimeCapabilityId[];
    const previousSequence = currentRecovery?.sequence ?? 0;
    const fallbackUsed = currentRecovery?.fallbackUsed ?? false;
    const cumulativeBudget =
      currentAttempt.budget?.usage ??
      currentRecovery?.cumulativeBudget ??
      ({ ...ZERO_AGENT_BUDGET_USAGE } satisfies AgentBudgetUsage);
    const preferredFallback = currentRecovery?.fallbackAgent ?? routing?.fallbackAgent ?? undefined;
    let fallbackAgent: AgentType | undefined = preferredFallback;
    let fallbackEligible: boolean | undefined;
    let fallbackReason: string | undefined;

    if (failure.retryable && previousSequence >= maxRetries && fallbackOnFailure && !fallbackUsed) {
      const fallback = await this.host.getFallback(task, currentAttempt.agent, {
        ...(preferredFallback ? { preferredFallback } : {}),
        requiredRuntimeCapabilities,
      });
      fallbackAgent = fallback?.agent ?? preferredFallback;
      fallbackEligible = Boolean(fallback);
      fallbackReason =
        fallback?.reason ??
        (fallbackAgent
          ? `Fallback ${fallbackAgent} is unavailable or lacks required runtime capabilities.`
          : 'No compatible fallback route is configured.');
    }

    const decisionInput = {
      rootRunId: currentRecovery?.rootRunId ?? currentAttempt.id,
      parentRunId: currentAttempt.id,
      selectedAgent: currentAttempt.agent,
      routingDecision:
        currentRecovery?.routingDecision ??
        routing?.reason ??
        'Legacy run without captured routing evidence.',
      ...(launchManifest?.digest ? { sourceManifestDigest: launchManifest.digest } : {}),
      requiredRuntimeCapabilities,
      cumulativeBudget,
      previousSequence,
      fallbackUsed,
      maxRetries,
      fallbackOnFailure,
      ...(fallbackAgent ? { fallbackAgent } : {}),
      ...(fallbackEligible !== undefined ? { fallbackEligible } : {}),
      ...(fallbackReason ? { fallbackReason } : {}),
    };
    let decision = this.host.policy.decide(redactedFailure, decisionInput);

    if (decision.action === 'fallback' && fallbackAgent) {
      try {
        await this.host.validateFallback(
          taskId,
          fallbackAgent,
          this.recoveryLaunchOptions(currentAttempt, decision)
        );
      } catch (error) {
        decision = this.host.policy.decide(redactedFailure, {
          ...decisionInput,
          fallbackEligible: false,
          fallbackReason: this.host.redact(error instanceof Error ? error.message : String(error)),
        });
      }
    }

    const recoveredAttempt = { ...currentAttempt, runRetry: decision };
    try {
      const updated = await this.host.attempts.persistActiveAttempt({
        task,
        attempt: recoveredAttempt,
        ...(decision.state === 'approval-required' ? { status: 'blocked' as const } : {}),
      });
      if (!updated) return null;
    } catch (error) {
      const latest = await this.host.tasks.getTask(taskId);
      if (
        latest?.attempt?.id === currentAttempt.id &&
        latest.attempt.runRetry?.state === decision.state &&
        latest.attempt.runRetry.sequence === decision.sequence
      ) {
        return latest.attempt.runRetry;
      }
      throw error;
    }

    await this.host.appendEvent(
      taskId,
      currentAttempt.id,
      `recovery.${decision.state}`,
      {
        action: decision.action,
        state: decision.state,
        sequence: decision.sequence,
        failureClass: decision.failure.classification,
        reason: decision.reason,
        backoffMs: decision.backoffMs,
        notBefore: decision.notBefore,
        selectedAgent: decision.selectedAgent,
        fallbackAgent: decision.fallbackAgent,
        cumulativeBudget: decision.cumulativeBudget,
        handoff: decision.handoff,
      },
      {
        provider: 'system',
        adapter: 'run-recovery',
        agent: decision.selectedAgent,
        dedupeKey: `recovery.${decision.state}:${decision.sequence}`,
      }
    );
    if (decision.state === 'scheduled') {
      this.scheduleTaskRecovery(taskId, currentAttempt.id, decision);
    }
    return decision;
  }

  private recoveryLaunchOptions(
    parentAttempt: TaskAttempt,
    recovery: RunRecoveryRecord
  ): AgentStartOptions {
    const retryingSameAgent = recovery.action === 'retry';
    return {
      ...(retryingSameAgent && parentAttempt.agentProfile?.id
        ? { profileId: parentAttempt.agentProfile.id }
        : {}),
      ...(parentAttempt.runLaunchManifest?.sandbox.presetId
        ? { sandboxPresetId: parentAttempt.runLaunchManifest.sandbox.presetId }
        : {}),
      ...(parentAttempt.runLaunchManifest?.budget
        ? { budget: parentAttempt.runLaunchManifest.budget }
        : {}),
      ...(parentAttempt.runLaunchManifest?.providerRequirements.required.length
        ? {
            requiredRuntimeCapabilities: [
              ...parentAttempt.runLaunchManifest.providerRequirements.required,
            ] as ProviderRuntimeCapabilityId[],
          }
        : {}),
      ...(parentAttempt.taskEnvelope?.commitPolicy
        ? { commitPolicy: parentAttempt.taskEnvelope.commitPolicy }
        : {}),
      parentAttemptId: parentAttempt.id,
      recovery,
      admissionIdempotencyKey: `recovery:${recovery.rootRunId}:${recovery.parentRunId}:${recovery.sequence}`,
    };
  }

  async claimAfterAdmission(taskId: string, task: Task, options: AgentStartOptions): Promise<Task> {
    const requested = options.recovery;
    if (!requested) return task;
    const parentAttempt = task.attempt;
    const current = parentAttempt?.runRetry;
    if (
      !parentAttempt ||
      parentAttempt.id !== options.parentAttemptId ||
      !current ||
      !['scheduled', 'launching'].includes(current.state) ||
      current.rootRunId !== requested.rootRunId ||
      current.parentRunId !== requested.parentRunId ||
      current.sequence !== requested.sequence ||
      current.action !== requested.action ||
      current.selectedAgent !== requested.selectedAgent
    ) {
      throw new ConflictError('Recovery launch no longer matches the pending parent attempt', {
        taskId,
        activeAttemptId: parentAttempt?.id,
        parentAttemptId: options.parentAttemptId,
        recoveryState: current?.state,
        recoverySequence: current?.sequence,
      });
    }
    if (current.state === 'launching') return task;

    const launching: RunRecoveryRecord = { ...current, state: 'launching' };
    const claimedAttempt = { ...parentAttempt, runRetry: launching };
    const claimed = await this.host.attempts.persistActiveAttempt({
      task,
      attempt: claimedAttempt,
    });
    if (!claimed) throw new NotFoundError(`Task "${taskId}" disappeared during recovery launch`);
    await this.host.appendEvent(
      taskId,
      parentAttempt.id,
      'recovery.launching',
      {
        action: launching.action,
        sequence: launching.sequence,
        selectedAgent: launching.selectedAgent,
      },
      {
        provider: 'system',
        adapter: 'run-recovery',
        agent: launching.selectedAgent,
        dedupeKey: `recovery.launching:${launching.sequence}`,
      }
    );
    return claimed;
  }

  private scheduleTaskRecovery(
    taskId: string,
    attemptId: string,
    recovery: RunRecoveryRecord
  ): void {
    if (recovery.state !== 'scheduled') return;
    this.clearScheduledRecovery(taskId);
    const notBefore = recovery.notBefore ? Date.parse(recovery.notBefore) : Date.now();
    const delay = Math.max(0, Math.min(2_147_483_647, notBefore - Date.now()));
    const timer = setTimeout(() => {
      const scheduled = this.scheduledRecoveries.get(taskId);
      if (!scheduled || scheduled.attemptId !== attemptId) return;
      this.scheduledRecoveries.delete(taskId);
      void this.launchScheduledTaskRecovery(taskId, attemptId).catch((error) => {
        log.error(
          { err: error, taskId, attemptId },
          '[ClawdbotAgent] Scheduled recovery launch failed'
        );
      });
    }, delay);
    timer.unref?.();
    this.scheduledRecoveries.set(taskId, { attemptId, timer });
  }

  private clearScheduledRecovery(taskId: string, expectedAttemptId?: string): void {
    const scheduled = this.scheduledRecoveries.get(taskId);
    if (!scheduled || (expectedAttemptId && scheduled.attemptId !== expectedAttemptId)) return;
    clearTimeout(scheduled.timer);
    this.scheduledRecoveries.delete(taskId);
  }

  private async launchScheduledTaskRecovery(taskId: string, attemptId: string): Promise<void> {
    const task = await this.host.tasks.getTask(taskId);
    const parentAttempt = task?.attempt;
    const recovery = parentAttempt?.runRetry;
    if (
      !task ||
      !parentAttempt ||
      parentAttempt.id !== attemptId ||
      parentAttempt.status === 'running' ||
      recovery?.state !== 'scheduled'
    ) {
      return;
    }
    if (recovery.notBefore && Date.parse(recovery.notBefore) > Date.now()) {
      this.scheduleTaskRecovery(taskId, attemptId, recovery);
      return;
    }

    try {
      const child = await this.host.launch(
        taskId,
        recovery.selectedAgent,
        this.recoveryLaunchOptions(parentAttempt, recovery)
      );
      if (child.status === 'queued') {
        await this.host.appendEvent(
          taskId,
          attemptId,
          'recovery.queued',
          {
            action: recovery.action,
            sequence: recovery.sequence,
            queueId: child.queueId,
            selectedAgent: child.agent,
            retryAfterMs: child.retryAfterMs,
          },
          {
            provider: 'system',
            adapter: 'run-recovery',
            agent: child.agent,
            dedupeKey: `recovery.queued:${recovery.sequence}`,
          }
        );
      }
    } catch (error) {
      const latest = await this.host.tasks.getTask(taskId);
      if (latest?.attempt?.id === attemptId) {
        await this.planTaskRecovery(taskId, latest.attempt, this.host.policy.classifyError(error));
      }
      throw error;
    }
  }

  private async restoreRecoveredRun(
    task: Task,
    attempt: TaskAttempt,
    supervisor: RunSupervisorRecord
  ): Promise<void> {
    const { pending, provider, adapter } = await this.host.attachRecoveredRun(
      task,
      attempt,
      supervisor
    );
    try {
      await this.reconcileRecoveredRunCursor(task.id, attempt.id, supervisor);
      await this.host.appendEvent(
        task.id,
        attempt.id,
        'run.recovered',
        {
          status: 'reattached',
          supervisorId: supervisor.id,
          controlKind: supervisor.control.kind,
          lastEventSequence: supervisor.lastEventSequence,
          summary: 'Durable run control was reattached after server restart.',
        },
        {
          provider,
          adapter,
          agent: attempt.agent,
          model: attempt.model,
          dedupeKey: `run.reattached:${supervisor.revision}`,
        }
      );
      if (supervisor.control.kind === 'local-process') {
        this.monitorRecoveredProcess(task.id, pending, supervisor);
      }
    } catch (error) {
      this.clearRecoveredProcessMonitor(task.id);
      this.host.dropPendingRun(task.id);
      throw error;
    }
  }

  private async reconcileRecoveredRunCursor(
    taskId: string,
    attemptId: string,
    supervisor: RunSupervisorRecord
  ): Promise<void> {
    let cursor = supervisor.lastEventSequence;
    for (;;) {
      const pageStart = cursor;
      const page = await this.host.events.list({
        taskId,
        attemptId,
        afterSequence: cursor,
        limit: 500,
      });
      for (const event of page.events) cursor = Math.max(cursor, event.sequence);
      if (!page.hasMore) break;
      if (cursor === pageStart) {
        throw new Error('Run event journal pagination did not advance during recovery.');
      }
    }
    if (cursor > supervisor.lastEventSequence) {
      await this.host.supervisor.checkpoint(supervisor.id, {
        lastEventSequence: cursor,
      });
    }
  }

  private monitorRecoveredProcess(
    taskId: string,
    pending: Pending,
    supervisor: RunSupervisorRecord
  ): void {
    this.clearRecoveredProcessMonitor(taskId);
    let checking = false;
    const timer = setInterval(() => {
      if (checking) return;
      if (this.host.pendingRun(taskId) !== pending) {
        this.clearRecoveredProcessMonitor(taskId);
        return;
      }
      if (this.host.supervisor.isLocalProcessAlive(supervisor)) return;
      checking = true;
      this.clearRecoveredProcessMonitor(taskId);
      void (async () => {
        await this.host.supervisor.requireRecovery(
          supervisor.id,
          'process-exited',
          'The reattached provider process exited without a recoverable terminal stream.',
          'Review output through the last durable event cursor and launch a new attempt if work remains.'
        );
        await this.host.finalizeRecoveredRun(taskId, pending);
      })().catch((error) => {
        log.error(
          { err: error, taskId, attemptId: pending.attemptId, supervisorId: supervisor.id },
          'Failed to finalize a recovered provider process after exit'
        );
      });
    }, 1_000);
    timer.unref();
    this.recoveredProcessMonitors.set(taskId, timer);
  }

  clearRecoveredProcessMonitor(taskId: string): void {
    const timer = this.recoveredProcessMonitors.get(taskId);
    if (timer) clearInterval(timer);
    this.recoveredProcessMonitors.delete(taskId);
  }
}

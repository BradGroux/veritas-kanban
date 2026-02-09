/**
 * WorkflowRunService — Executes workflows, manages run state, orchestrates step execution
 * Phase 1: Core Engine (sequential steps, basic retry logic)
 */

import fs from 'fs/promises';
import path from 'path';
import { nanoid } from 'nanoid';
import type { WorkflowRun, StepRun, WorkflowDefinition, WorkflowStep } from '../types/workflow.js';
import { getWorkflowService } from './workflow-service.js';
import { WorkflowStepExecutor } from './workflow-step-executor.js';
import { getWorkflowRunsDir } from '../utils/paths.js';
import { createLogger } from '../lib/logger.js';
import { broadcastWorkflowStatus } from './broadcast-service.js';
import { getTaskService } from './task-service.js';

const log = createLogger('workflow-run');

// Concurrency limits
const MAX_CONCURRENT_RUNS = 10;
let activeRunCount = 0;
const RUN_ID_PATTERN = /^run_\d{10,}_[a-zA-Z0-9_-]{6,}$/;

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

  constructor(runsDir?: string) {
    this.runsDir = runsDir || getWorkflowRunsDir();
    this.workflowService = getWorkflowService();
    this.stepExecutor = new WorkflowStepExecutor();
    this.ensureDirectories();
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

  /**
   * Start a new workflow run
   */
  async startRun(
    workflowId: string,
    taskId?: string,
    initialContext?: Record<string, unknown>
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

        // Task payload (if provided)
        ...(task ? { task } : {}),

        // Custom initial context (from API caller)
        ...initialContext,

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
        await this.saveRun(run);

        try {
          const result = await this.stepExecutor.executeStep(step, run);

          stepRun.status = 'completed';
          stepRun.completedAt = new Date().toISOString();
          stepRun.duration = Math.floor(
            (new Date(stepRun.completedAt).getTime() - new Date(stepRun.startedAt!).getTime()) /
              1000
          );
          stepRun.output = result.outputPath;

          // Merge step output into run context
          run.context[step.id] = result.output;

          await this.saveRun(run);
          broadcastWorkflowStatus(run);
        } catch (err: unknown) {
          // Step failed
          stepRun.status = 'failed';
          stepRun.error = err instanceof Error ? err.message : 'Unknown error';
          stepRun.completedAt = new Date().toISOString();
          await this.saveRun(run);
          broadcastWorkflowStatus(run);

          // Handle failure policy
          const handled = await this.handleStepFailure(step, stepRun, stepQueue, workflow, run);
          if (!handled) {
            // No retry policy — fail the entire workflow
            throw err;
          }

          if (run.status === 'blocked') {
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
      await this.saveRun(run);
      broadcastWorkflowStatus(run);

      log.info({ runId: run.id, workflowId: run.workflowId }, 'Workflow run completed');
    } catch (err: unknown) {
      run.status = 'failed';
      run.error = err instanceof Error ? err.message : 'Unknown error';
      run.completedAt = new Date().toISOString();
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

      await this.saveRun(run);
      log.info({ failedStep: step.id, retryStep: retryStep.id }, 'Routing to retry step');
      return true;
    }

    // Strategy 3: Escalation
    if (policy.escalate_to === 'human') {
      run.status = 'blocked';
      run.error = policy.escalate_message || `Step ${step.id} failed`;
      await this.saveRun(run);

      log.warn({ runId: run.id, stepId: step.id }, 'Workflow blocked');
      return true; // Handled (blocked, not failed)
    }

    if (policy.escalate_to === 'skip') {
      stepRun.status = 'skipped';
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
    const runDirs = await fs.readdir(this.runsDir).catch(() => []);
    const runs: WorkflowRun[] = [];

    for (const dir of runDirs) {
      if (!dir.startsWith('run_')) continue;

      let run: WorkflowRun | null = null;
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
    runs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

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
    metadata.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

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

    // Merge resume context
    run.context = { ...run.context, ...resumeContext };
    run.status = 'running';
    await this.saveRun(run);

    // Resume execution
    const workflow = await this.workflowService.loadWorkflow(run.workflowId);
    if (!workflow) {
      throw new NotFoundError(`Workflow ${run.workflowId} not found`);
    }

    log.info({ runId }, 'Resuming workflow run');

    this.executeRun(run, workflow).catch((err) => {
      log.error({ runId, err }, 'Workflow resume failed');
    });

    return run;
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
    const runDir = path.join(this.runsDir, run.id);
    await fs.mkdir(runDir, { recursive: true });

    // Update checkpoint timestamp
    run.lastCheckpoint = new Date().toISOString();

    const runPath = path.join(runDir, 'run.json');
    await fs.writeFile(runPath, JSON.stringify(run, null, 2), 'utf-8');
  }

  /**
   * Snapshot workflow YAML into run directory (for version immutability)
   */
  private async snapshotWorkflow(runId: string, workflow: WorkflowDefinition): Promise<void> {
    const runDir = path.join(this.runsDir, runId);
    await fs.mkdir(runDir, { recursive: true });

    const snapshotPath = path.join(runDir, 'workflow.yml');
    const yaml = await import('yaml');
    await fs.writeFile(snapshotPath, yaml.stringify(workflow), 'utf-8');
  }
}

// Singleton
let workflowRunServiceInstance: WorkflowRunService | null = null;

export function getWorkflowRunService(): WorkflowRunService {
  if (!workflowRunServiceInstance) {
    workflowRunServiceInstance = new WorkflowRunService();
  }
  return workflowRunServiceInstance;
}

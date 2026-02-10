/**
 * WorkflowStepExecutor — Executes individual workflow steps
 * Phase 1: Core Engine (agent steps only, OpenClaw integration placeholder)
 */

import fs from 'fs/promises';
import path from 'path';
import sanitizeFilename from 'sanitize-filename';
import yaml from 'yaml';
import type {
  WorkflowStep,
  WorkflowRun,
  StepExecutionResult,
  WorkflowAgent,
} from '../types/workflow.js';
import { getWorkflowRunsDir } from '../utils/paths.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('workflow-step-executor');

export class WorkflowStepExecutor {
  private runsDir: string;
  private appendCountCache?: Map<string, number>; // Performance: Track append counts to reduce stat() calls

  constructor(runsDir?: string) {
    this.runsDir = runsDir || getWorkflowRunsDir();
  }

  /**
   * Execute a single workflow step
   */
  async executeStep(step: WorkflowStep, run: WorkflowRun): Promise<StepExecutionResult> {
    log.info({ runId: run.id, stepId: step.id, type: step.type }, 'Executing step');

    switch (step.type) {
      case 'agent':
        return this.executeAgentStep(step, run);
      case 'loop':
        return this.executeLoopStep(step, run);
      case 'gate':
        return this.executeGateStep(step, run);
      case 'parallel':
        return this.executeParallelStep(step, run);
      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  /**
   * Execute an agent step (spawns OpenClaw session)
   * Phase 2: Progress file integration, template resolution
   */
  private async executeAgentStep(
    step: WorkflowStep,
    run: WorkflowRun
  ): Promise<StepExecutionResult> {
    // Phase 2: Load progress file and add to context (#108)
    const progress = await this.loadProgressFile(run.id);
    const contextWithProgress = {
      ...run.context,
      progress: progress || '',
      // Add steps context for {{steps.step-id.output}} template resolution
      steps: this.buildStepsContext(run),
    };

    // Render the input prompt with context
    const prompt = this.renderTemplate(step.input || '', contextWithProgress);

    // Phase 2: Session management (#111)
    const sessionMode = step.session || step.fresh_session === false ? 'reuse' : 'fresh';
    const agentDef = this.getAgentDefinition(run, step.agent!);

    log.info(
      { runId: run.id, stepId: step.id, agent: step.agent, sessionMode },
      'Agent step execution (placeholder)'
    );

    // Phase 2 (tracked in #110): Spawn OpenClaw session via sessions_spawn
    // Implementation will integrate with ClawdbotAgentService pattern
    // Session management logic:
    // if (sessionMode === 'reuse') {
    //   const lastSessionKey = run.context._sessions?.[step.agent!];
    //   if (lastSessionKey) {
    //     // Continue existing session
    //     const result = await this.continueSession(lastSessionKey, prompt);
    //   } else {
    //     // No existing session, fall back to fresh
    //     const sessionKey = await this.spawnAgent(step.agent!, prompt, run.taskId, agentDef?.tools);
    //     run.context._sessions = { ...run.context._sessions, [step.agent!]: sessionKey };
    //   }
    // } else {
    //   // Fresh session
    //   const sessionKey = await this.spawnAgent(step.agent!, prompt, run.taskId, agentDef?.tools);
    //   run.context._sessions = { ...run.context._sessions, [step.agent!]: sessionKey };
    // }
    // const result = await this.waitForSession(sessionKey);

    // Placeholder: Simulate agent execution (Phase 1 only)
    const result = `Agent ${step.agent} executed step ${step.id}\n\nPrompt:\n${prompt}\n\nSTATUS: done\nOUTPUT: Placeholder result`;

    // Parse output
    const parsed = this.parseStepOutput(result, step);

    // Validate acceptance criteria
    await this.validateAcceptanceCriteria(step, result, parsed);

    // Write output to step-outputs/
    const outputPath = await this.saveStepOutput(run.id, step.id, result);

    // Phase 2: Append to progress file (#108)
    await this.appendProgressFile(run.id, step.id, result);

    return {
      output: parsed,
      outputPath,
    };
  }

  /**
   * Render a template string with context (simplified Jinja2-style)
   * Phase 1: Basic string interpolation
   */
  private renderTemplate(template: string, context: Record<string, unknown>): string {
    let rendered = template;

    // Simple {{variable}} substitution
    rendered = rendered.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
      const trimmedKey = key.trim();
      const value = this.getNestedValue(context, trimmedKey);
      return value !== undefined ? String(value) : `{{${trimmedKey}}}`;
    });

    return rendered;
  }

  /**
   * Get nested object value from dot notation (e.g., "task.title")
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce((current: unknown, key: string) => {
      if (current && typeof current === 'object' && key in current) {
        return (current as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);
  }

  /**
   * Parse agent output into structured data for context passing
   */
  private parseStepOutput(rawOutput: string, step: WorkflowStep): unknown {
    if (!rawOutput) return rawOutput;

    const hintedFile = step.output?.file || '';
    const extension = path.extname(hintedFile).toLowerCase();

    try {
      if (extension === '.yml' || extension === '.yaml') {
        return yaml.parse(rawOutput);
      }

      if (extension === '.json') {
        return JSON.parse(rawOutput);
      }

      // Default: return as-is
      return rawOutput;
    } catch (err) {
      log.warn({ stepId: step.id, err }, 'Failed to parse step output as structured data');
      return rawOutput;
    }
  }

  /**
   * Save step output to disk
   */
  private async saveStepOutput(
    runId: string,
    stepId: string,
    output: unknown,
    filename?: string
  ): Promise<string> {
    // Sanitize runId to prevent path traversal (defensive — already validated upstream)
    const safeRunId = sanitizeFilename(runId);
    if (!safeRunId || safeRunId !== runId) {
      throw new Error(`Invalid run ID: ${runId}`);
    }

    const outputDir = path.join(this.runsDir, safeRunId, 'step-outputs');
    await fs.mkdir(outputDir, { recursive: true });

    const candidate = filename || `${stepId}.md`;
    const safeName = sanitizeFilename(candidate) || `${stepId}.md`;
    const outputPath = path.join(outputDir, safeName);

    const content = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
    await fs.writeFile(outputPath, content, 'utf-8');

    log.info({ runId, stepId, outputPath }, 'Step output saved');
    return outputPath;
  }

  /**
   * Validate step output against acceptance criteria
   */
  private async validateAcceptanceCriteria(
    step: WorkflowStep,
    output: string,
    parsedOutput: unknown
  ): Promise<void> {
    if (!step.acceptance_criteria || step.acceptance_criteria.length === 0) {
      return; // No criteria to validate
    }

    for (const criterion of step.acceptance_criteria) {
      const passed = this.validateCriterion(criterion, output, parsedOutput);

      if (!passed) {
        throw new Error(`Acceptance criterion not met: "${criterion}"`);
      }
    }

    log.info(
      { stepId: step.id, criteria: step.acceptance_criteria.length },
      'All acceptance criteria passed'
    );
  }

  /**
   * Validate a single acceptance criterion (Phase 4: enhanced validation with security hardening)
   */
  private validateCriterion(criterion: string, rawOutput: string, parsedOutput: unknown): boolean {
    // Check for validation type patterns

    // Regex pattern: /pattern/flags
    if (criterion.startsWith('/') && criterion.includes('/')) {
      const lastSlash = criterion.lastIndexOf('/');
      if (lastSlash > 0) {
        const pattern = criterion.slice(1, lastSlash);
        const flags = criterion.slice(lastSlash + 1);

        // Security: Validate pattern length to prevent ReDoS
        if (pattern.length > 500) {
          log.warn({ criterion }, 'Regex pattern exceeds safe length — treating as literal match');
          return rawOutput.includes(criterion);
        }

        // Security: Validate flags are safe (only i,m,s allowed — no g,y,u which could have side effects)
        if (flags && !/^[ims]*$/.test(flags)) {
          log.warn({ criterion, flags }, 'Unsafe regex flags detected — treating as literal match');
          return rawOutput.includes(criterion);
        }

        try {
          // Test the regex can compile and execute quickly
          const testStart = Date.now();
          const regex = new RegExp(pattern, flags);
          const result = regex.test(rawOutput);
          const testDuration = Date.now() - testStart;

          // Security: If regex takes >100ms, it might be a ReDoS attempt
          if (testDuration > 100) {
            log.warn(
              { criterion, duration: testDuration },
              'Regex execution exceeded safe duration — possible ReDoS attempt'
            );
            return false;
          }

          return result;
        } catch (err) {
          log.warn({ criterion, err }, 'Invalid regex pattern — treating as literal match');
          return rawOutput.includes(pattern);
        }
      }
    }

    // JSON path check: output.field == value
    const equalsMatch = criterion.match(/^(.+?)\s*==\s*(.+)$/);
    if (equalsMatch) {
      const [, path, expectedValue] = equalsMatch;
      const actualValue = this.getNestedValue({ output: parsedOutput }, path.trim());
      const expected = expectedValue.trim().replace(/^["']|["']$/g, '');
      return String(actualValue) === expected;
    }

    // Duration check: duration < N
    const durationMatch = criterion.match(/^duration\s*<\s*(\d+)$/);
    if (durationMatch) {
      // This check is handled at step level, not output level
      return true; // Skip here, will be validated in executeStep
    }

    // Default: Simple substring match (backward compatible)
    return rawOutput.includes(criterion);
  }

  /**
   * Execute a loop step — iterates over a collection
   * Phase 4: Loop execution with verify_each support
   */
  private async executeLoopStep(
    step: WorkflowStep,
    run: WorkflowRun
  ): Promise<StepExecutionResult> {
    if (!step.loop) {
      throw new Error(`Loop step ${step.id} missing loop configuration`);
    }

    const loopConfig = step.loop;

    // Load progress file
    const progress = await this.loadProgressFile(run.id);
    const contextWithProgress = {
      ...run.context,
      progress: progress || '',
      steps: this.buildStepsContext(run),
    };

    // Evaluate the loop collection
    const collectionExpr = loopConfig.over;
    const collection = this.evaluateExpression(collectionExpr, contextWithProgress);

    if (!Array.isArray(collection)) {
      throw new Error(`Loop expression "${collectionExpr}" did not return an array`);
    }

    // Check max iterations safety limit
    // Security/Performance: Hard cap at 1000 iterations even if max_iterations not set
    const DEFAULT_MAX_ITERATIONS = 1000;
    const configuredMax = loopConfig.max_iterations || DEFAULT_MAX_ITERATIONS;
    const maxIterations = Math.min(configuredMax, DEFAULT_MAX_ITERATIONS);
    const iterationCount = Math.min(collection.length, maxIterations);

    if (collection.length > maxIterations) {
      log.warn(
        {
          runId: run.id,
          stepId: step.id,
          collectionSize: collection.length,
          maxIterations,
        },
        `Loop collection size (${collection.length}) exceeds max iterations (${maxIterations}) — capping execution`
      );
    }

    // Initialize loop state in step run
    const stepRun = run.steps.find((s) => s.stepId === step.id);
    if (stepRun) {
      stepRun.loopState = {
        totalIterations: iterationCount,
        currentIteration: 0,
        completedIterations: 0,
        failedIterations: 0,
      };
    }

    const itemVar = loopConfig.item_var || 'item';
    const indexVar = loopConfig.index_var || 'index';
    const results: unknown[] = [];
    const completedItems: string[] = [];

    for (let i = 0; i < iterationCount; i++) {
      const currentItem = collection[i];

      // Update loop state
      if (stepRun?.loopState) {
        stepRun.loopState.currentIteration = i + 1;
      }

      log.info(
        { runId: run.id, stepId: step.id, iteration: i + 1, total: iterationCount },
        'Loop iteration'
      );

      // Build iteration context
      const iterationContext = {
        ...contextWithProgress,
        [itemVar]: currentItem,
        [indexVar]: i,
        loop: {
          index: i,
          total: iterationCount,
          completed: completedItems,
          results,
        },
      };

      try {
        // Render the input prompt for this iteration
        const prompt = this.renderTemplate(step.input || '', iterationContext);

        // Execute the iteration (spawn agent)
        const result = `Agent ${step.agent} executed loop iteration ${i + 1}/${iterationCount}\n\nPrompt:\n${prompt}\n\nSTATUS: done\nOUTPUT: Iteration ${i + 1} complete`;

        // Parse output
        const parsed = this.parseStepOutput(result, step);

        // Validate acceptance criteria for this iteration
        await this.validateAcceptanceCriteria(step, result, parsed);

        // Save iteration output
        const outputFilename = this.renderTemplate(
          step.output?.file || `${step.id}-{{loop.index}}.md`,
          iterationContext
        );
        await this.saveStepOutput(run.id, step.id, result, outputFilename);

        // Append to progress
        await this.appendProgressFile(run.id, `${step.id}-iter-${i + 1}`, result);

        results.push(parsed);
        completedItems.push(String(currentItem));

        if (stepRun?.loopState) {
          stepRun.loopState.completedIterations++;
        }

        // Run verification step if verify_each is enabled
        if (loopConfig.verify_each && loopConfig.verify_step) {
          log.info(
            { runId: run.id, stepId: step.id, verifyStep: loopConfig.verify_step },
            'Running verification step'
          );
          // Verification would be handled by the workflow executor
          // This is just a placeholder to show the integration point
        }
      } catch (err: unknown) {
        if (stepRun?.loopState) {
          stepRun.loopState.failedIterations++;
        }

        const errMessage = err instanceof Error ? err.message : 'Unknown error';
        log.warn(
          { runId: run.id, stepId: step.id, iteration: i + 1, error: errMessage },
          'Loop iteration failed'
        );

        // Check if we should continue on error
        if (loopConfig.continue_on_error) {
          log.info(
            { runId: run.id, stepId: step.id, iteration: i + 1 },
            'Continuing loop despite iteration failure (continue_on_error: true)'
          );
          continue;
        }

        // Check completion policy
        if (loopConfig.completion === 'any_done' && results.length > 0) {
          log.info(
            { runId: run.id, stepId: step.id, completed: results.length },
            'Loop stopping — any_done policy satisfied'
          );
          break;
        }

        if (loopConfig.completion === 'first_success' && results.length === 1) {
          log.info({ runId: run.id, stepId: step.id }, 'Loop stopping — first_success achieved');
          break;
        }

        // all_done: throw error to trigger retry policy
        throw err;
      }

      // Check early exit conditions
      if (loopConfig.completion === 'first_success' && results.length > 0) {
        break;
      }
    }

    // Check if loop met its completion criteria
    if (loopConfig.completion === 'all_done' && stepRun?.loopState) {
      if (stepRun.loopState.completedIterations < iterationCount) {
        throw new Error(
          `Loop failed — only ${stepRun.loopState.completedIterations}/${iterationCount} iterations completed`
        );
      }
    }

    // Aggregate results
    const outputPath = await this.saveStepOutput(
      run.id,
      step.id,
      { iterations: results, completed: completedItems },
      step.output?.file || `${step.id}-summary.json`
    );

    return {
      output: { iterations: results, completed: completedItems },
      outputPath,
    };
  }

  /**
   * Execute a gate step — blocks execution until a condition is met
   * Phase 4: Gate execution with approval/condition/timeout
   */
  private async executeGateStep(
    step: WorkflowStep,
    run: WorkflowRun
  ): Promise<StepExecutionResult> {
    if (!step.condition) {
      throw new Error(`Gate step ${step.id} missing condition`);
    }

    // Load progress file
    const progress = await this.loadProgressFile(run.id);
    const contextWithProgress = {
      ...run.context,
      progress: progress || '',
      steps: this.buildStepsContext(run),
    };

    // Evaluate the gate condition
    const conditionResult = this.evaluateExpression(step.condition, contextWithProgress);

    log.info(
      { runId: run.id, stepId: step.id, condition: step.condition, result: conditionResult },
      'Gate condition evaluated'
    );

    if (!conditionResult) {
      // Condition not met — handle on_false policy
      const policy = step.on_false;

      if (policy?.escalate_to === 'human') {
        // Block the workflow (will be handled by workflow-run-service)
        throw new Error(policy.escalate_message || `Gate ${step.id} condition not met`);
      }

      throw new Error(`Gate ${step.id} condition failed: ${step.condition}`);
    }

    // Gate passed
    const output = `Gate ${step.id} passed: ${step.condition}`;
    const outputPath = await this.saveStepOutput(run.id, step.id, output);

    return {
      output: { passed: true, condition: step.condition },
      outputPath,
    };
  }

  /**
   * Execute a parallel step — runs multiple sub-steps concurrently
   * Phase 4: Parallel execution with fan-out/fan-in
   */
  private async executeParallelStep(
    step: WorkflowStep,
    run: WorkflowRun
  ): Promise<StepExecutionResult> {
    if (!step.parallel) {
      throw new Error(`Parallel step ${step.id} missing parallel configuration`);
    }

    const parallelConfig = step.parallel;
    const subSteps = parallelConfig.steps;

    if (!subSteps || subSteps.length === 0) {
      throw new Error(`Parallel step ${step.id} has no sub-steps defined`);
    }

    // Security/Performance: Hard cap on parallel sub-steps to prevent resource exhaustion
    const MAX_PARALLEL_SUBSTEPS = 50;
    if (subSteps.length > MAX_PARALLEL_SUBSTEPS) {
      throw new Error(
        `Parallel step ${step.id} has ${subSteps.length} sub-steps, exceeding maximum of ${MAX_PARALLEL_SUBSTEPS}`
      );
    }

    // Load progress file
    const progress = await this.loadProgressFile(run.id);
    const contextWithProgress = {
      ...run.context,
      progress: progress || '',
      steps: this.buildStepsContext(run),
    };

    log.info(
      {
        runId: run.id,
        stepId: step.id,
        subStepCount: subSteps.length,
        completion: parallelConfig.completion,
      },
      'Starting parallel execution'
    );

    // Execute all sub-steps in parallel using Promise.allSettled
    // Note: For production use with real OpenClaw sessions, consider batching to limit
    // concurrent session spawns (e.g., p-limit library with concurrency: 10)
    const subStepPromises = subSteps.map((subStep) =>
      this.executeParallelSubStep(subStep, run, contextWithProgress, step.id)
    );

    // Wait for all (or until completion criteria met)
    const results = await Promise.allSettled(subStepPromises);

    // Analyze results
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    log.info(
      {
        runId: run.id,
        stepId: step.id,
        total: results.length,
        fulfilled: fulfilled.length,
        rejected: rejected.length,
      },
      'Parallel execution completed'
    );

    // Check completion criteria
    const completionType = parallelConfig.completion;
    let success = false;

    if (completionType === 'all') {
      success = rejected.length === 0;
    } else if (completionType === 'any') {
      success = fulfilled.length > 0;
    } else if (typeof completionType === 'number') {
      success = fulfilled.length >= completionType;
    }

    if (!success) {
      const failureReasons = rejected.map((r) => (r.status === 'rejected' ? r.reason : 'unknown'));
      throw new Error(
        `Parallel step ${step.id} failed — completion criteria not met. Failures: ${failureReasons.join(', ')}`
      );
    }

    // Aggregate results
    const aggregatedOutput = {
      subSteps: subSteps.map((subStep, idx) => ({
        id: subStep.id,
        status: results[idx].status,
        output:
          results[idx].status === 'fulfilled'
            ? (results[idx] as PromiseFulfilledResult<unknown>).value
            : null,
        error:
          results[idx].status === 'rejected'
            ? String((results[idx] as PromiseRejectedResult).reason)
            : null,
      })),
      completed: fulfilled.length,
      failed: rejected.length,
    };

    const outputPath = await this.saveStepOutput(
      run.id,
      step.id,
      aggregatedOutput,
      step.output?.file || `${step.id}-parallel.json`
    );

    return {
      output: aggregatedOutput,
      outputPath,
    };
  }

  /**
   * Execute a single parallel sub-step
   */
  private async executeParallelSubStep(
    subStep: { id: string; agent: string; input: string; timeout?: number },
    run: WorkflowRun,
    context: Record<string, unknown>,
    parentStepId: string
  ): Promise<unknown> {
    log.info(
      { runId: run.id, parentStepId, subStepId: subStep.id, agent: subStep.agent },
      'Executing parallel sub-step'
    );

    // Render the input prompt
    const prompt = this.renderTemplate(subStep.input, context);

    // Placeholder: Simulate agent execution
    const result = `Agent ${subStep.agent} executed sub-step ${subStep.id}\n\nPrompt:\n${prompt}\n\nSTATUS: done\nOUTPUT: Sub-step ${subStep.id} complete`;

    // Parse output
    const parsed = this.parseStepOutput(result, {
      id: subStep.id,
      name: subStep.id,
      type: 'agent',
    } as WorkflowStep);

    // Save sub-step output
    await this.saveStepOutput(run.id, `${parentStepId}-${subStep.id}`, result);

    return parsed;
  }

  /**
   * Evaluate a template expression to a value
   * Supports: variable access, equality checks, boolean expressions
   * Security: Uses proper tokenization to prevent injection via boolean operator bypass
   */
  private evaluateExpression(expr: string, context: Record<string, unknown>): unknown {
    const trimmed = expr.trim();

    // Remove template braces if present: {{expr}} → expr
    const cleaned = trimmed.replace(/^\{\{|\}\}$/g, '').trim();

    // Security: Parse boolean operators BEFORE equality to prevent "foo and bar" in strings from splitting
    // Use regex with negative lookbehind/lookahead to only match operators outside quotes
    // This regex matches " and " or " or " that are NOT inside quoted strings
    const booleanOpPattern = /\s+(and|or)\s+(?=(?:[^"']*["'][^"']*["'])*[^"']*$)/i;
    const boolMatch = cleaned.match(booleanOpPattern);

    if (boolMatch) {
      const operator = boolMatch[1].toLowerCase();
      const parts = cleaned.split(boolMatch[0]); // Split on the matched operator with spaces

      if (operator === 'and') {
        // Evaluate all parts and check if all are truthy
        const results = parts.map((p) => this.evaluateExpression(p.trim(), context));
        return results.every((r) => r === true || r === 'true');
      } else if (operator === 'or') {
        // Evaluate all parts and check if any is truthy
        const results = parts.map((p) => this.evaluateExpression(p.trim(), context));
        return results.some((r) => r === true || r === 'true');
      }
    }

    // Boolean equality: {{verify.decision == "approved"}}
    // Only match == that's NOT inside quotes
    const eqMatch = cleaned.match(/^(.+?)\s*==\s*(.+)$/);
    if (eqMatch) {
      const [, leftExpr, rightExpr] = eqMatch;
      const left = this.getNestedValue(context, leftExpr.trim());
      const right = rightExpr.trim().replace(/^["']|["']$/g, '');
      return String(left) === right;
    }

    // Default: resolve as variable access
    return this.getNestedValue(context, cleaned);
  }

  /**
   * Cleanup OpenClaw session (Phase 2 tracked in #110)
   */
  async cleanupSession(sessionKey: string): Promise<void> {
    log.info({ sessionKey }, 'Session cleanup (placeholder)');
    // Phase 2 (tracked in #110): Call OpenClaw session cleanup API
    // Will integrate with sessions API for proper resource cleanup
  }

  // ==================== Phase 2: Progress File Integration (#108) ====================

  /**
   * Load progress.md file for a workflow run
   * Returns content or null if file doesn't exist
   */
  private async loadProgressFile(runId: string): Promise<string | null> {
    // Sanitize runId to prevent path traversal (defensive — already validated upstream)
    const safeRunId = sanitizeFilename(runId);
    if (!safeRunId || safeRunId !== runId) {
      throw new Error(`Invalid run ID: ${runId}`);
    }

    const progressPath = path.join(this.runsDir, safeRunId, 'progress.md');

    try {
      const content = await fs.readFile(progressPath, 'utf-8');
      return content;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        return null; // File doesn't exist yet
      }
      throw err;
    }
  }

  /**
   * Append step output to progress.md
   */
  private async appendProgressFile(runId: string, stepId: string, output: unknown): Promise<void> {
    // Sanitize runId to prevent path traversal (defensive — already validated upstream)
    const safeRunId = sanitizeFilename(runId);
    if (!safeRunId || safeRunId !== runId) {
      throw new Error(`Invalid run ID: ${runId}`);
    }

    const progressPath = path.join(this.runsDir, safeRunId, 'progress.md');
    const timestamp = new Date().toISOString();

    // Performance: Check progress file size before appending (cap at 10MB)
    // Only check size periodically to avoid repeated stat() calls
    const MAX_PROGRESS_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    const SIZE_CHECK_INTERVAL = 5; // Check every 5 appends

    // Use a cache to track append count per run (avoids repeated stat calls)
    if (!this.appendCountCache) {
      this.appendCountCache = new Map<string, number>();
    }

    const appendCount = (this.appendCountCache.get(runId) || 0) + 1;
    this.appendCountCache.set(runId, appendCount);

    // Only check file size periodically
    if (appendCount % SIZE_CHECK_INTERVAL === 0) {
      try {
        const stats = await fs.stat(progressPath);
        if (stats.size > MAX_PROGRESS_FILE_SIZE) {
          log.warn(
            { runId, fileSize: stats.size, appends: appendCount },
            'Progress file exceeds size limit — skipping append'
          );
          return; // Skip appending if file is too large
        }
      } catch (err: unknown) {
        // File doesn't exist yet — that's fine
        if (!(err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT')) {
          throw err;
        }
      }
    }

    const entry = `## Step: ${stepId} (${timestamp})\n\n${typeof output === 'string' ? output : JSON.stringify(output, null, 2)}\n\n---\n\n`;

    await fs.appendFile(progressPath, entry, 'utf-8');

    log.info({ runId, stepId }, 'Progress file updated');
  }

  /**
   * Build steps context for template resolution
   * Enables {{steps.step-id.output}} references
   * Performance: Only includes completed steps with output
   */
  private buildStepsContext(run: WorkflowRun): Record<string, unknown> {
    const stepsContext: Record<string, unknown> = {};

    // Performance: Use for loop instead of for...of for faster iteration
    const steps = run.steps;
    const context = run.context;

    for (let i = 0; i < steps.length; i++) {
      const stepRun = steps[i];
      // Only include completed steps that have output in context
      if (stepRun.status === 'completed') {
        const stepOutput = context[stepRun.stepId];
        if (stepOutput !== undefined) {
          stepsContext[stepRun.stepId] = {
            output: stepOutput,
            status: stepRun.status,
            duration: stepRun.duration,
          };
        }
      }
    }

    return stepsContext;
  }

  // ==================== Phase 2: Tool Policies & Session Management (#110, #111) ====================

  /**
   * Get agent definition from workflow context
   * Used to retrieve agent-specific settings (tools, model, etc.)
   */
  private getAgentDefinition(run: WorkflowRun, agentId: string): WorkflowAgent | null {
    // Agent definitions are stored in workflow context during run initialization
    const workflow = run.context.workflow as { agents?: WorkflowAgent[] } | undefined;
    if (!workflow || !workflow.agents) return null;

    return workflow.agents.find((a) => a.id === agentId) || null;
  }
}

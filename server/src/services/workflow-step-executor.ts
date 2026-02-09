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
        throw new Error('Loop steps not yet implemented (Phase 4)');
      case 'gate':
        throw new Error('Gate steps not yet implemented (Phase 4)');
      case 'parallel':
        throw new Error('Parallel steps not yet implemented (Phase 4)');
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
   * Validate a single acceptance criterion (Phase 1: simple substring match)
   */
  private validateCriterion(criterion: string, rawOutput: string, parsedOutput: unknown): boolean {
    // Phase 1: Simple substring match
    // Phase 4 will add regex, JSON Schema, custom functions
    return rawOutput.includes(criterion);
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

    // Check progress file size before appending (cap at 10MB)
    const MAX_PROGRESS_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    try {
      const stats = await fs.stat(progressPath);
      if (stats.size > MAX_PROGRESS_FILE_SIZE) {
        log.warn(
          { runId, fileSize: stats.size },
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

    const entry = `## Step: ${stepId} (${timestamp})\n\n${typeof output === 'string' ? output : JSON.stringify(output, null, 2)}\n\n---\n\n`;

    await fs.appendFile(progressPath, entry, 'utf-8');

    log.info({ runId, stepId }, 'Progress file updated');
  }

  /**
   * Build steps context for template resolution
   * Enables {{steps.step-id.output}} references
   */
  private buildStepsContext(run: WorkflowRun): Record<string, unknown> {
    const stepsContext: Record<string, unknown> = {};

    for (const stepRun of run.steps) {
      if (stepRun.status === 'completed' && run.context[stepRun.stepId]) {
        stepsContext[stepRun.stepId] = {
          output: run.context[stepRun.stepId],
          status: stepRun.status,
          duration: stepRun.duration,
        };
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

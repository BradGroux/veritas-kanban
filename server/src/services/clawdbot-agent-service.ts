/**
 * ClawdbotAgentService - Delegates agent work to Clawdbot's sessions_spawn
 *
 * Instead of managing PTY processes directly, this service:
 * 1. Sends a task request to the main Veritas session
 * 2. Veritas spawns a sub-agent with proper PTY handling
 * 3. Sub-agent works in the task's worktree
 * 4. On completion, Veritas calls back to update the task
 *
 * This keeps agent management simple and leverages Clawdbot's existing infrastructure.
 */

import { EventEmitter } from 'events';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { nanoid } from 'nanoid';
import fs from 'fs/promises';
import path from 'path';
import { ConfigService } from './config-service.js';
import { TaskService } from './task-service.js';
import { getTelemetryService } from './telemetry-service.js';
import { getAgentRoutingService } from './agent-routing-service.js';
import { getBreaker } from './circuit-registry.js';
import { validatePathSegment, ensureWithinBase } from '../utils/sanitize.js';
import type { ThreadEvent } from '@openai/codex-sdk';
import type {
  Task,
  AgentType,
  AgentConfig,
  TaskAttempt,
  AttemptStatus,
  RunStartedEvent,
  RunCompletedEvent,
  RunErrorEvent,
  TokenTelemetryEvent,
} from '@veritas-kanban/shared';
import { createLogger } from '../lib/logger.js';
const log = createLogger('clawdbot-agent-service');

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const LOGS_DIR = path.join(PROJECT_ROOT, '.veritas-kanban', 'logs');
const CLAWDBOT_GATEWAY = process.env.CLAWDBOT_GATEWAY || 'http://127.0.0.1:18789';
type AgentProvider = 'openclaw' | 'codex-cli' | 'codex-sdk';

export interface AgentStatus {
  taskId: string;
  attemptId: string;
  agent: AgentType;
  status: AttemptStatus;
  startedAt?: string;
  endedAt?: string;
}

export interface AgentOutput {
  type: 'stdout' | 'stderr' | 'stdin' | 'system';
  content: string;
  timestamp: string;
}

// Track pending agent requests
const pendingAgents = new Map<
  string,
  {
    taskId: string;
    attemptId: string;
    agent: AgentType;
    startedAt: string;
    emitter: EventEmitter;
    provider: AgentProvider;
    model?: string;
    threadId?: string;
    abortController?: AbortController;
    process?: ChildProcessWithoutNullStreams;
  }
>();

export class ClawdbotAgentService {
  private configService: ConfigService;
  private taskService: TaskService;
  private logsDir: string;

  constructor() {
    this.configService = new ConfigService();
    this.taskService = new TaskService();
    this.logsDir = LOGS_DIR;
    this.ensureLogsDir();
  }

  private async ensureLogsDir(): Promise<void> {
    await fs.mkdir(this.logsDir, { recursive: true });
  }

  private expandPath(p: string): string {
    return p.replace(/^~/, process.env.HOME || '');
  }

  /**
   * Start an agent on a task by delegating to Clawdbot
   */
  async startAgent(taskId: string, agentType?: AgentType): Promise<AgentStatus> {
    // Get task
    const task = await this.taskService.getTask(taskId);
    if (!task) {
      throw new Error(`Task "${taskId}" not found`);
    }

    if (task.type !== 'code') {
      throw new Error('Agents can only be started on code tasks');
    }

    if (!task.git?.worktreePath) {
      throw new Error('Task must have an active worktree to start an agent');
    }

    // Check if agent already running for this task
    if (pendingAgents.has(taskId)) {
      throw new Error('An agent is already running for this task');
    }

    // Get agent config — use routing engine when agent is "auto" or not specified
    const config = await this.configService.getConfig();
    let agent: AgentType;
    let routingReason: string | undefined;

    if (!agentType || agentType === 'auto') {
      const routing = getAgentRoutingService();
      const result = await routing.resolveAgent(task);
      agent = result.agent;
      routingReason = result.reason;
      log.info(
        `[ClawdbotAgent] Routing resolved agent for task ${taskId}: ${agent} (${routingReason})`
      );
    } else {
      agent = agentType;
    }

    const agentConfig = this.resolveAgentConfig(config.agents, agent);
    const provider = this.resolveAgentProvider(agentConfig, agent);

    // Create attempt
    const attemptId = `attempt_${nanoid(8)}`;
    const startedAt = new Date().toISOString();
    const logPath = path.join(this.logsDir, `${taskId}_${attemptId}.md`);

    // Create event emitter for status updates
    const emitter = new EventEmitter();

    // Store pending agent
    pendingAgents.set(taskId, {
      taskId,
      attemptId,
      agent,
      startedAt,
      emitter,
      provider,
      model: agentConfig?.model,
    });

    // Validate path segments for log file
    validatePathSegment(taskId);
    validatePathSegment(attemptId);

    // Build the task prompt for Clawdbot
    const worktreePath = this.expandPath(task.git.worktreePath);
    const taskPrompt = this.buildTaskPrompt(task, worktreePath, attemptId);

    // Initialize log file (ensure it stays within logs dir)
    ensureWithinBase(this.logsDir, logPath);
    await this.initLogFile(logPath, task, agent, taskPrompt);

    // Update task with attempt info
    const attempt: TaskAttempt = {
      id: attemptId,
      agent,
      status: 'running',
      started: startedAt,
      provider,
      model: agentConfig?.model,
    };

    await this.taskService.updateTask(taskId, {
      status: 'in-progress',
      attempt,
    });

    const telemetry = getTelemetryService();
    await telemetry.emit<RunStartedEvent>({
      type: 'run.started',
      taskId,
      attemptId,
      agent,
      model: agentConfig?.model,
      project: task.project,
    });

    if (provider === 'codex-cli') {
      try {
        this.startCodexCli(task, agentConfig, taskPrompt, logPath, attemptId, startedAt, emitter);
      } catch (error: any) {
        pendingAgents.delete(taskId);
        await this.taskService.updateTask(taskId, {
          status: 'todo',
          attempt: { ...attempt, status: 'failed', ended: new Date().toISOString() },
        });
        await telemetry.emit<RunErrorEvent>({
          type: 'run.error',
          taskId,
          attemptId,
          agent,
          project: task.project,
          error: error.message || 'Failed to start Codex CLI',
          stackTrace: error.stack,
        });
        throw new Error(`Failed to start agent via Codex CLI: ${error.message}`);
      }

      return {
        taskId,
        attemptId,
        agent,
        status: 'running',
        startedAt,
      };
    }

    if (provider === 'codex-sdk') {
      const abortController = new AbortController();
      const pending = pendingAgents.get(taskId);
      if (pending) {
        pending.abortController = abortController;
      }

      void this.startCodexSdk(
        task,
        agentConfig,
        taskPrompt,
        logPath,
        attemptId,
        startedAt,
        emitter,
        abortController
      ).catch(async (error: any) => {
        if (!pendingAgents.has(task.id)) return;
        await this.appendLog(
          logPath,
          `\n## Codex SDK Error\n\n${error.message || 'Codex SDK attempt failed'}\n`
        );
        await this.completeAgent(task.id, {
          success: false,
          error: error.message || 'Codex SDK attempt failed',
        });
      });

      return {
        taskId,
        attemptId,
        agent,
        status: 'running',
        startedAt,
      };
    }

    // Send request to Clawdbot main session (wrapped in circuit breaker)
    // This will be picked up by Veritas who will spawn the actual sub-agent
    const agentBreaker = getBreaker('agent');
    try {
      await agentBreaker.execute(() => this.sendToClawdbot(taskPrompt, taskId, attemptId));
    } catch (error: any) {
      // Clean up on failure
      pendingAgents.delete(taskId);
      await this.taskService.updateTask(taskId, {
        status: 'todo',
        attempt: { ...attempt, status: 'failed', ended: new Date().toISOString() },
      });
      await telemetry.emit<RunErrorEvent>({
        type: 'run.error',
        taskId,
        attemptId,
        agent,
        project: task.project,
        error: error.message || 'Failed to start OpenClaw request',
        stackTrace: error.stack,
      });
      throw new Error(`Failed to start agent via OpenClaw: ${error.message}`);
    }

    return {
      taskId,
      attemptId,
      agent,
      status: 'running',
      startedAt,
    };
  }

  /**
   * Send task request to Clawdbot main session
   * Uses the webchat API endpoint
   */
  private async sendToClawdbot(prompt: string, taskId: string, attemptId: string): Promise<void> {
    // Validate path segments to prevent directory traversal
    validatePathSegment(taskId);
    validatePathSegment(attemptId);

    // Write the task request to a well-known location that Veritas monitors
    // This is simpler than trying to hit the WebSocket API
    const requestsDir = path.join(PROJECT_ROOT, '.veritas-kanban', 'agent-requests');
    const requestFile = path.join(requestsDir, `${taskId}.json`);
    ensureWithinBase(requestsDir, requestFile);

    await fs.mkdir(path.dirname(requestFile), { recursive: true });

    await fs.writeFile(
      requestFile,
      JSON.stringify(
        {
          taskId,
          attemptId,
          prompt,
          requestedAt: new Date().toISOString(),
          callbackUrl: `http://localhost:3001/api/agents/${taskId}/complete`,
        },
        null,
        2
      )
    );

    log.info(`[ClawdbotAgent] Wrote agent request for task ${taskId} to ${requestFile}`);
    log.info(
      `[ClawdbotAgent] Veritas should pick this up on next heartbeat or you can trigger manually`
    );
  }

  /**
   * Handle completion callback from Clawdbot sub-agent
   */
  async completeAgent(
    taskId: string,
    result: { success: boolean; summary?: string; error?: string }
  ): Promise<void> {
    const pending = pendingAgents.get(taskId);
    if (!pending) {
      log.warn(`[ClawdbotAgent] Received completion for unknown task ${taskId}`);
      return;
    }

    const { attemptId, emitter } = pending;
    const endedAt = new Date().toISOString();
    const status: AttemptStatus = result.success ? 'complete' : 'failed';
    const durationMs = new Date(endedAt).getTime() - new Date(pending.startedAt).getTime();

    // Update task
    await this.taskService.updateTask(taskId, {
      status: result.success ? 'done' : 'in-progress',
      attempt: {
        id: attemptId,
        agent: pending.agent,
        status,
        started: pending.startedAt,
        ended: endedAt,
        provider: pending.provider,
        model: pending.model,
        threadId: pending.threadId,
      },
    });

    // Append to log
    const logPath = path.join(this.logsDir, `${taskId}_${attemptId}.md`);
    const summary = result.summary || result.error || 'No summary provided';
    await fs.appendFile(logPath, `\n\n---\n\n## Result\n\n**Status:** ${status}\n\n${summary}\n`);

    // Emit completion
    emitter.emit('complete', { status, summary });

    const task = await this.taskService.getTask(taskId);
    await getTelemetryService().emit<RunCompletedEvent>({
      type: 'run.completed',
      taskId,
      attemptId,
      agent: pending.agent,
      project: task?.project,
      durationMs,
      success: result.success,
      error: result.error,
    });

    // Clean up
    pendingAgents.delete(taskId);

    // Remove request file
    const requestFile = path.join(
      PROJECT_ROOT,
      '.veritas-kanban',
      'agent-requests',
      `${taskId}.json`
    );
    try {
      await fs.unlink(requestFile);
    } catch {
      // Ignore if already deleted
    }

    log.info(`[ClawdbotAgent] Task ${taskId} completed with status: ${status}`);
  }

  /**
   * Stop a running agent
   */
  async stopAgent(taskId: string): Promise<void> {
    const pending = pendingAgents.get(taskId);
    if (!pending) {
      throw new Error('No agent running for this task');
    }

    if (pending.provider === 'codex-cli' && pending.process && !pending.process.killed) {
      pending.process.kill('SIGTERM');
    }
    if (pending.provider === 'codex-sdk') {
      pending.abortController?.abort();
    }

    // Mark as failed/stopped
    await this.completeAgent(taskId, {
      success: false,
      error: 'Stopped by user',
    });
  }

  private resolveAgentConfig(agents: AgentConfig[], agent: AgentType): AgentConfig | undefined {
    return agents.find((a) => a.type === agent);
  }

  private resolveAgentProvider(
    agentConfig: AgentConfig | undefined,
    agent: AgentType
  ): AgentProvider {
    if (agentConfig?.provider === 'codex-sdk') return 'codex-sdk';
    if (agentConfig?.provider === 'codex-cli') return 'codex-cli';
    if (agent === 'codex') return 'codex-cli';
    if (agentConfig?.command === 'codex') return 'codex-cli';
    return 'openclaw';
  }

  private startCodexCli(
    task: Task,
    agentConfig: AgentConfig | undefined,
    prompt: string,
    logPath: string,
    attemptId: string,
    startedAt: string,
    emitter: EventEmitter
  ): void {
    const worktreePath = this.expandPath(task.git?.worktreePath || '');
    if (!worktreePath) {
      throw new Error('Task worktree path is required for Codex CLI');
    }

    const command = agentConfig?.command || 'codex';
    const args = this.buildCodexArgs(agentConfig, prompt, logPath, attemptId);
    const child = spawn(command, args, {
      cwd: worktreePath,
      env: {
        ...process.env,
        VK_API_URL: process.env.VK_API_URL || 'http://localhost:3001',
      },
      shell: false,
    });

    const pending = pendingAgents.get(task.id);
    if (pending) {
      pending.process = child;
    }

    void this.appendLog(
      logPath,
      `\n## Codex CLI\n\n**Command:** \`${[command, ...args.map((a) => (a === prompt ? '<prompt>' : a))].join(' ')}\`\n**PID:** ${child.pid ?? 'unknown'}\n\n`
    );

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let finalSummary = '';
    let tokenUsage:
      | { inputTokens: number; outputTokens: number; totalTokens?: number; model?: string }
      | undefined;

    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        const parsed = this.handleCodexJsonLine(line, logPath);
        if (parsed.summary) finalSummary = parsed.summary;
        if (parsed.usage) tokenUsage = parsed.usage;
      }
    });

    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
      stderrBuffer += chunk;
      void this.appendLog(logPath, `\n### stderr\n\n\`\`\`\n${chunk.trimEnd()}\n\`\`\`\n`);
    });

    child.on('error', (error) => {
      void this.appendLog(logPath, `\n## Codex Process Error\n\n${error.message}\n`);
      emitter.emit('error', error);
    });

    child.on('close', (code, signal) => {
      void (async () => {
        if (stdoutBuffer.trim()) {
          const parsed = this.handleCodexJsonLine(stdoutBuffer, logPath);
          if (parsed.summary) finalSummary = parsed.summary;
          if (parsed.usage) tokenUsage = parsed.usage;
        }

        const finalPath = this.getCodexFinalPath(logPath, attemptId);
        finalSummary ||= await this.readOptionalFile(finalPath);
        finalSummary ||=
          code === 0 ? 'Codex completed without a final summary.' : stderrBuffer.trim();

        if (tokenUsage) {
          await getTelemetryService().emit<TokenTelemetryEvent>({
            type: 'run.tokens',
            taskId: task.id,
            attemptId,
            agent: agentConfig?.type || 'codex',
            project: task.project,
            inputTokens: tokenUsage.inputTokens,
            outputTokens: tokenUsage.outputTokens,
            totalTokens: tokenUsage.totalTokens,
            model: tokenUsage.model || agentConfig?.model,
          });
        }

        await this.appendLog(
          logPath,
          `\n## Codex Exit\n\n**Exit code:** ${code ?? 'none'}\n**Signal:** ${signal ?? 'none'}\n**Duration:** ${Date.now() - new Date(startedAt).getTime()}ms\n`
        );

        await this.completeAgent(task.id, {
          success: code === 0,
          summary: finalSummary,
          error: code === 0 ? undefined : finalSummary || `Codex exited with code ${code}`,
        });
      })().catch((error) => {
        log.error({ err: error, taskId: task.id }, 'Failed to finalize Codex attempt');
      });
    });
  }

  private buildCodexArgs(
    agentConfig: AgentConfig | undefined,
    prompt: string,
    logPath: string,
    attemptId: string
  ): string[] {
    const configured = agentConfig?.args?.length ? [...agentConfig.args] : ['exec'];
    const args = configured.includes('exec') ? configured : ['exec', ...configured];
    if (!args.includes('--sandbox')) args.push('--sandbox', 'workspace-write');
    if (!args.includes('--json')) args.push('--json');
    if (!args.includes('--output-last-message')) {
      args.push('--output-last-message', this.getCodexFinalPath(logPath, attemptId));
    }
    args.push(prompt);
    return args;
  }

  private getCodexFinalPath(logPath: string, attemptId: string): string {
    return path.join(path.dirname(logPath), `${attemptId}.codex-final.md`);
  }

  private async startCodexSdk(
    task: Task,
    agentConfig: AgentConfig | undefined,
    prompt: string,
    logPath: string,
    attemptId: string,
    startedAt: string,
    emitter: EventEmitter,
    abortController: AbortController
  ): Promise<void> {
    const worktreePath = this.expandPath(task.git?.worktreePath || '');
    if (!worktreePath) {
      throw new Error('Task worktree path is required for Codex SDK');
    }

    const { Codex } = await import('@openai/codex-sdk');
    const codex = new Codex({
      codexPathOverride:
        agentConfig?.command && agentConfig.command !== 'codex' ? agentConfig.command : undefined,
      env: this.buildCodexEnv(),
    });

    const thread = codex.startThread({
      workingDirectory: worktreePath,
      skipGitRepoCheck: true,
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never',
      networkAccessEnabled: true,
      model: agentConfig?.model,
    });

    await this.appendLog(
      logPath,
      `\n## Codex SDK\n\n**Worktree:** \`${worktreePath}\`\n**Model:** ${agentConfig?.model || 'default'}\n\n`
    );

    const streamed = await thread.runStreamed(prompt, { signal: abortController.signal });
    let finalSummary = '';
    let failureMessage = '';
    let tokenUsage:
      | { inputTokens: number; outputTokens: number; totalTokens?: number; model?: string }
      | undefined;

    for await (const event of streamed.events) {
      const parsed = this.handleCodexEvent(event, logPath);
      if (parsed.summary) finalSummary = parsed.summary;
      if (parsed.usage) tokenUsage = parsed.usage;

      if (event.type === 'thread.started') {
        await this.recordCodexThread(task, attemptId, event.thread_id);
      }
      if (event.type === 'turn.failed') {
        failureMessage = event.error.message;
      }
      if (event.type === 'error') {
        failureMessage = event.message;
      }
    }

    if (tokenUsage) {
      await getTelemetryService().emit<TokenTelemetryEvent>({
        type: 'run.tokens',
        taskId: task.id,
        attemptId,
        agent: agentConfig?.type || 'codex-sdk',
        project: task.project,
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        totalTokens: tokenUsage.totalTokens,
        model: tokenUsage.model || agentConfig?.model,
      });
    }

    await this.appendLog(
      logPath,
      `\n## Codex SDK Complete\n\n**Duration:** ${Date.now() - new Date(startedAt).getTime()}ms\n`
    );

    await this.completeAgent(task.id, {
      success: !failureMessage,
      summary: finalSummary || failureMessage || 'Codex SDK completed without a final summary.',
      error: failureMessage || undefined,
    });
    emitter.emit('sdk.complete', { taskId: task.id, attemptId });
  }

  private handleCodexJsonLine(
    line: string,
    logPath: string
  ): {
    summary?: string;
    usage?: { inputTokens: number; outputTokens: number; totalTokens?: number; model?: string };
  } {
    const trimmed = line.trim();
    if (!trimmed) return {};

    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      return this.handleCodexEvent(event, logPath);
    } catch {
      void this.appendLog(logPath, `\n### stdout\n\n\`\`\`\n${trimmed}\n\`\`\`\n`);
      return { summary: trimmed };
    }
  }

  private handleCodexEvent(
    event: ThreadEvent | Record<string, unknown>,
    logPath: string
  ): {
    summary?: string;
    usage?: { inputTokens: number; outputTokens: number; totalTokens?: number; model?: string };
  } {
    const record = event as Record<string, unknown>;
    const type = String(record.type || record.event || 'codex.event');
    const summary = this.extractCodexSummary(record);
    const usage = this.extractCodexUsage(record);
    void this.appendLog(
      logPath,
      `\n### ${type}\n\n${summary ? `${summary}\n\n` : ''}<details><summary>Raw event</summary>\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n\n</details>\n`
    );
    return { summary, usage };
  }

  private async recordCodexThread(task: Task, attemptId: string, threadId: string): Promise<void> {
    const pending = pendingAgents.get(task.id);
    if (pending) {
      pending.threadId = threadId;
    }

    await this.taskService.updateTask(task.id, {
      status: 'in-progress',
      attempt: {
        id: attemptId,
        agent: pending?.agent || 'codex-sdk',
        status: 'running',
        started: pending?.startedAt,
        provider: pending?.provider || 'codex-sdk',
        model: pending?.model,
        threadId,
      },
    });
  }

  private buildCodexEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') env[key] = value;
    }
    env.VK_API_URL = process.env.VK_API_URL || 'http://localhost:3001';
    return env;
  }

  private extractCodexSummary(event: unknown): string | undefined {
    const seen = new Set<unknown>();
    const visit = (value: unknown): string | undefined => {
      if (!value || typeof value !== 'object') return undefined;
      if (seen.has(value)) return undefined;
      seen.add(value);
      const record = value as Record<string, unknown>;
      for (const key of [
        'final_response',
        'finalMessage',
        'final_message',
        'message',
        'text',
        'output',
      ]) {
        const candidate = record[key];
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
      }
      for (const child of Object.values(record)) {
        const result = visit(child);
        if (result) return result;
      }
      return undefined;
    };
    return visit(event);
  }

  private extractCodexUsage(
    event: unknown
  ):
    | { inputTokens: number; outputTokens: number; totalTokens?: number; model?: string }
    | undefined {
    const seen = new Set<unknown>();
    const visit = (value: unknown): Record<string, unknown> | undefined => {
      if (!value || typeof value !== 'object') return undefined;
      if (seen.has(value)) return undefined;
      seen.add(value);
      const record = value as Record<string, unknown>;
      const input =
        record.input_tokens ?? record.inputTokens ?? record.prompt_tokens ?? record.promptTokens;
      const output =
        record.output_tokens ??
        record.outputTokens ??
        record.completion_tokens ??
        record.completionTokens;
      if (typeof input === 'number' && typeof output === 'number') return record;
      for (const child of Object.values(record)) {
        const result = visit(child);
        if (result) return result;
      }
      return undefined;
    };

    const usage = visit(event);
    if (!usage) return undefined;
    const input = (usage.input_tokens ??
      usage.inputTokens ??
      usage.prompt_tokens ??
      usage.promptTokens) as number;
    const output = (usage.output_tokens ??
      usage.outputTokens ??
      usage.completion_tokens ??
      usage.completionTokens) as number;
    const total = usage.total_tokens ?? usage.totalTokens;
    return {
      inputTokens: input,
      outputTokens: output,
      totalTokens: typeof total === 'number' ? total : input + output,
      model: typeof usage.model === 'string' ? usage.model : undefined,
    };
  }

  private async appendLog(logPath: string, content: string): Promise<void> {
    ensureWithinBase(this.logsDir, logPath);
    await fs.appendFile(logPath, content, 'utf-8');
  }

  private async readOptionalFile(filePath: string): Promise<string> {
    try {
      return (await fs.readFile(filePath, 'utf-8')).trim();
    } catch {
      return '';
    }
  }

  /**
   * Get agent status
   */
  getAgentStatus(taskId: string): AgentStatus | null {
    const pending = pendingAgents.get(taskId);
    if (!pending) {
      return null;
    }

    return {
      taskId,
      attemptId: pending.attemptId,
      agent: pending.agent,
      status: 'running',
      startedAt: pending.startedAt,
    };
  }

  /**
   * Get event emitter for a running agent
   */
  getAgentEmitter(taskId: string): EventEmitter | null {
    return pendingAgents.get(taskId)?.emitter || null;
  }

  /**
   * List all pending agent requests (for Veritas to poll)
   */
  async listPendingRequests(): Promise<
    Array<{
      taskId: string;
      attemptId: string;
      prompt: string;
      requestedAt: string;
      callbackUrl: string;
    }>
  > {
    const requestsDir = path.join(PROJECT_ROOT, '.veritas-kanban', 'agent-requests');

    try {
      const files = await fs.readdir(requestsDir);
      const requests = await Promise.all(
        files
          .filter((f) => f.endsWith('.json'))
          .map(async (f) => {
            const content = await fs.readFile(path.join(requestsDir, f), 'utf-8');
            return JSON.parse(content);
          })
      );
      return requests;
    } catch {
      // Intentionally silent: requests directory may not exist — return empty list
      return [];
    }
  }

  async getAttemptLog(taskId: string, attemptId: string): Promise<string> {
    validatePathSegment(taskId);
    validatePathSegment(attemptId);
    const logPath = path.join(this.logsDir, `${taskId}_${attemptId}.md`);
    ensureWithinBase(this.logsDir, logPath);
    try {
      return await fs.readFile(logPath, 'utf-8');
    } catch {
      throw new Error('Log file not found');
    }
  }

  async listAttempts(taskId: string): Promise<string[]> {
    const files = await fs.readdir(this.logsDir);
    return files
      .filter((f) => f.startsWith(`${taskId}_`) && f.endsWith('.md'))
      .map((f) => f.replace(`${taskId}_`, '').replace('.md', ''));
  }

  private buildTaskPrompt(task: Task, worktreePath: string, attemptId: string): string {
    // Build checkpoint context if available
    let checkpointSection = '';
    if (task.checkpoint) {
      const resumeCount = task.checkpoint.resumeCount || 0;
      const checkpointAge = Math.floor(
        (Date.now() - new Date(task.checkpoint.timestamp).getTime()) / 1000 / 60
      );
      checkpointSection = `
## ⚠️ CHECKPOINT DETECTED — This is a RESUME (not a fresh start)

**Resume Count:** ${resumeCount} time(s)
**Last Checkpoint:** ${task.checkpoint.timestamp} (${checkpointAge} minutes ago)
**Last Step:** ${task.checkpoint.step}

### Saved State:
\`\`\`json
${JSON.stringify(task.checkpoint.state, null, 2)}
\`\`\`

**IMPORTANT:** Continue from where you left off. Review the saved state above to understand what was already done.
`;
    }

    return `# Agent Task Request

**Task ID:** ${task.id}
**Attempt ID:** ${attemptId}
**Worktree:** ${worktreePath}
${checkpointSection}
## Task: ${task.title}

${task.description || 'No description provided.'}

## Instructions

1. Work in the directory: \`${worktreePath}\`
2. Complete the task described above
3. Commit your changes with a descriptive message
4. When done, call the completion endpoint:
   \`\`\`bash
   curl -X POST http://localhost:3001/api/agents/${task.id}/complete \\
     -H "Content-Type: application/json" \\
     -d '{"success": true, "summary": "Brief description of what was done"}'
   \`\`\`

If you encounter errors, call with \`success: false\` and include the error message.
`;
  }

  private async initLogFile(
    logPath: string,
    task: Task,
    agent: AgentType,
    prompt: string
  ): Promise<void> {
    const header = `# Agent Log: ${task.title}

**Task ID:** ${task.id}
**Agent:** ${agent}
**Started:** ${new Date().toISOString()}
**Worktree:** ${task.git?.worktreePath}

## Task Prompt

\`\`\`
${prompt}
\`\`\`

## Progress

*Agent is working...*

`;
    await fs.writeFile(logPath, header, 'utf-8');
  }
}

// Export singleton
export const clawdbotAgentService = new ClawdbotAgentService();

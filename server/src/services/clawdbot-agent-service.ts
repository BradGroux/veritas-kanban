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
import { activityService } from './activity-service.js';
import { getTraceService } from './trace-service.js';
import { validatePathSegment, ensureWithinBase } from '../utils/sanitize.js';
import type { ThreadEvent } from '@openai/codex-sdk';
import type {
  Task,
  AgentType,
  AgentConfig,
  TaskAttempt,
  AttemptStatus,
  Deliverable,
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
export type AgentProvider = 'openclaw' | 'codex-cli' | 'codex-sdk';

export interface AgentProviderStartContext {
  task: Task;
  agentConfig?: AgentConfig;
  prompt: string;
  logPath: string;
  attemptId: string;
  startedAt: string;
  emitter: EventEmitter;
  attempt: TaskAttempt;
}

export interface AgentProviderStopContext {
  taskId: string;
  pending: PendingAgent;
}

export interface AgentProviderAdapter {
  id: AgentProvider;
  label: string;
  capabilities: {
    start: true;
    stop: boolean;
    status: true;
    logs: boolean;
    complete: true;
    resume: boolean;
  };
  start(context: AgentProviderStartContext): Promise<void> | void;
  stop(context: AgentProviderStopContext): Promise<void> | void;
}

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
interface PendingAgent {
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

const pendingAgents = new Map<string, PendingAgent>();

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

    const adapter = this.resolveProviderAdapter(provider);
    try {
      await adapter.start({
        task,
        agentConfig,
        prompt: taskPrompt,
        logPath,
        attemptId,
        startedAt,
        emitter,
        attempt,
      });
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
        error: error.message || `Failed to start ${adapter.label}`,
        stackTrace: error.stack,
      });
      throw new Error(`Failed to start agent via ${adapter.label}: ${error.message}`);
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
    await getTraceService().completeTrace(attemptId, result.success ? 'completed' : 'failed');
    await activityService.logActivity(
      'agent_completed',
      taskId,
      task?.title || taskId,
      {
        attemptId,
        provider: pending.provider,
        model: pending.model,
        success: result.success,
        summary,
      },
      pending.agent
    );

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

    await this.resolveProviderAdapter(pending.provider).stop({ taskId, pending });

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

  private resolveProviderAdapter(provider: AgentProvider): AgentProviderAdapter {
    const commonCapabilities = {
      start: true as const,
      status: true as const,
      logs: true,
      complete: true as const,
    };

    if (provider === 'codex-cli') {
      return {
        id: 'codex-cli',
        label: 'Codex CLI',
        capabilities: { ...commonCapabilities, stop: true, resume: false },
        start: ({ task, agentConfig, prompt, logPath, attemptId, startedAt, emitter }) => {
          this.startCodexCli(task, agentConfig, prompt, logPath, attemptId, startedAt, emitter);
        },
        stop: ({ pending }) => {
          if (pending.process && !pending.process.killed) pending.process.kill('SIGTERM');
        },
      };
    }

    if (provider === 'codex-sdk') {
      return {
        id: 'codex-sdk',
        label: 'Codex SDK',
        capabilities: { ...commonCapabilities, stop: true, resume: true },
        start: ({ task, agentConfig, prompt, logPath, attemptId, startedAt, emitter }) => {
          const abortController = new AbortController();
          const pending = pendingAgents.get(task.id);
          if (pending) pending.abortController = abortController;
          void this.startCodexSdk(
            task,
            agentConfig,
            prompt,
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
        },
        stop: ({ pending }) => {
          pending.abortController?.abort();
        },
      };
    }

    return {
      id: 'openclaw',
      label: 'OpenClaw',
      capabilities: { ...commonCapabilities, stop: false, resume: false },
      start: async ({ prompt, task, attemptId }) => {
        const agentBreaker = getBreaker('agent');
        await agentBreaker.execute(() => this.sendToClawdbot(prompt, task.id, attemptId));
      },
      stop: () => {},
    };
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
    void this.recordAgentStarted(task, attemptId, agentConfig?.type || 'codex', 'codex-cli');

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
        const parsed = this.handleCodexJsonLine(line, logPath, task, attemptId, agentConfig);
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
          const parsed = this.handleCodexJsonLine(
            stdoutBuffer,
            logPath,
            task,
            attemptId,
            agentConfig
          );
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
    await this.recordAgentStarted(task, attemptId, agentConfig?.type || 'codex-sdk', 'codex-sdk');

    const streamed = await thread.runStreamed(prompt, { signal: abortController.signal });
    let finalSummary = '';
    let failureMessage = '';
    let tokenUsage:
      | { inputTokens: number; outputTokens: number; totalTokens?: number; model?: string }
      | undefined;

    for await (const event of streamed.events) {
      const parsed = this.handleCodexEvent(event, logPath, task, attemptId, agentConfig);
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
    logPath: string,
    task?: Task,
    attemptId?: string,
    agentConfig?: AgentConfig
  ): {
    summary?: string;
    usage?: { inputTokens: number; outputTokens: number; totalTokens?: number; model?: string };
  } {
    const trimmed = line.trim();
    if (!trimmed) return {};

    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      return this.handleCodexEvent(event, logPath, task, attemptId, agentConfig);
    } catch {
      void this.appendLog(logPath, `\n### stdout\n\n\`\`\`\n${trimmed}\n\`\`\`\n`);
      return { summary: trimmed };
    }
  }

  private handleCodexEvent(
    event: ThreadEvent | Record<string, unknown>,
    logPath: string,
    task?: Task,
    attemptId?: string,
    agentConfig?: AgentConfig
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
    if (task && attemptId) {
      void this.recordCodexEvent(task, attemptId, agentConfig, type, record, summary);
    }
    return { summary, usage };
  }

  private async recordAgentStarted(
    task: Task,
    attemptId: string,
    agent: string,
    provider: AgentProvider
  ): Promise<void> {
    getTraceService().startTrace(attemptId, task.id, agent as AgentType, task.project);
    getTraceService().startStep(attemptId, 'init', { provider });
    getTraceService().endStep(attemptId, 'init');
    await activityService.logActivity(
      'agent_started',
      task.id,
      task.title,
      { attemptId, provider },
      agent
    );
  }

  private async recordCodexEvent(
    task: Task,
    attemptId: string,
    agentConfig: AgentConfig | undefined,
    type: string,
    event: Record<string, unknown>,
    summary?: string
  ): Promise<void> {
    const agent =
      agentConfig?.type || (agentConfig?.provider === 'codex-sdk' ? 'codex-sdk' : 'codex');
    getTraceService().startStep(attemptId, this.codexTraceStepType(type), {
      provider: agentConfig?.provider || 'codex-cli',
      eventType: type,
      summary,
    });
    getTraceService().endStep(attemptId, this.codexTraceStepType(type));

    if (this.shouldLogCodexActivity(type)) {
      await activityService.logActivity(
        'agent_event',
        task.id,
        task.title,
        {
          attemptId,
          provider: agentConfig?.provider || 'codex-cli',
          eventType: type,
          summary,
        },
        agent
      );
    }

    const files = this.extractCodexFiles(event);
    if (files.length > 0) {
      await this.attachCodexDeliverables(task, attemptId, agent, files);
    }
  }

  private codexTraceStepType(type: string): 'execute' | 'complete' | 'error' {
    if (type.includes('failed') || type === 'error') return 'error';
    if (type.includes('completed')) return 'complete';
    return 'execute';
  }

  private shouldLogCodexActivity(type: string): boolean {
    return (
      type.includes('command') ||
      type.includes('tool') ||
      type.includes('file') ||
      type.includes('completed') ||
      type.includes('failed') ||
      type === 'error'
    );
  }

  private extractCodexFiles(event: unknown): string[] {
    const files = new Set<string>();
    const seen = new Set<unknown>();
    const fileKeys = new Set([
      'file',
      'file_path',
      'filePath',
      'path',
      'relative_path',
      'relativePath',
      'absolute_path',
      'absolutePath',
    ]);

    const visit = (value: unknown, key?: string): void => {
      if (!value) return;
      if (typeof value === 'string') {
        if (key && fileKeys.has(key) && this.looksLikeFilePath(value)) files.add(value);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) visit(item, key);
        return;
      }
      if (typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        visit(childValue, childKey);
      }
    };

    visit(event);
    return [...files].slice(0, 25);
  }

  private looksLikeFilePath(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed || trimmed.includes('\n')) return false;
    if (/^https?:\/\//i.test(trimmed)) return true;
    if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../'))
      return true;
    return /^[\w.-]+\/[\w./-]+$/.test(trimmed) || /\.[a-z0-9]{1,12}$/i.test(trimmed);
  }

  private async attachCodexDeliverables(
    task: Task,
    attemptId: string,
    agent: string,
    files: string[]
  ): Promise<void> {
    const freshTask = await this.taskService.getTask(task.id);
    if (!freshTask) return;

    const existing = freshTask.deliverables || [];
    const existingKeys = new Set(
      existing.map((deliverable) => `${deliverable.path || ''}:${deliverable.agent || ''}`)
    );
    const created = new Date().toISOString();
    const additions: Deliverable[] = [];

    for (const file of files) {
      const key = `${file}:${agent}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      additions.push({
        id: `deliverable_${nanoid(8)}`,
        title: path.basename(file) || file,
        type: this.inferDeliverableType(file),
        path: file,
        status: 'attached',
        agent,
        created,
        description: `Codex event artifact from attempt ${attemptId}`,
      });
    }

    if (additions.length === 0) return;

    await this.taskService.updateTask(task.id, {
      deliverables: [...existing, ...additions],
    });
    await activityService.logActivity(
      'deliverable_added',
      task.id,
      task.title,
      {
        attemptId,
        provider: 'codex',
        deliverableCount: additions.length,
        paths: additions.map((deliverable) => deliverable.path),
      },
      agent
    );
  }

  private inferDeliverableType(file: string): Deliverable['type'] {
    const lower = file.toLowerCase();
    if (/\.(ts|tsx|js|jsx|py|go|rs|java|cs|rb|php|css|scss|html)$/.test(lower)) return 'code';
    if (/\.(md|txt|docx|pdf)$/.test(lower)) return 'document';
    if (/\.(json|yaml|yml|xml|csv|png|jpg|jpeg|gif|svg)$/.test(lower)) return 'artifact';
    return 'other';
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

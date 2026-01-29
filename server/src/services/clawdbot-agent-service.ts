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
import { nanoid } from 'nanoid';
import fs from 'fs/promises';
import path from 'path';
import { ConfigService } from './config-service.js';
import { TaskService } from './task-service.js';
import { getBreaker } from './circuit-registry.js';
import type { Task, AgentType, TaskAttempt, AttemptStatus } from '@veritas-kanban/shared';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const LOGS_DIR = path.join(PROJECT_ROOT, '.veritas-kanban', 'logs');
const CLAWDBOT_GATEWAY = process.env.CLAWDBOT_GATEWAY || 'http://127.0.0.1:18789';

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

    // Get agent config
    const config = await this.configService.getConfig();
    const agent = agentType || config.defaultAgent;

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
    });

    // Build the task prompt for Clawdbot
    const worktreePath = this.expandPath(task.git.worktreePath);
    const taskPrompt = this.buildTaskPrompt(task, worktreePath, attemptId);

    // Initialize log file
    await this.initLogFile(logPath, task, agent, taskPrompt);

    // Update task with attempt info
    const attempt: TaskAttempt = {
      id: attemptId,
      agent,
      status: 'running',
      started: startedAt,
    };

    await this.taskService.updateTask(taskId, {
      status: 'in-progress',
      attempt,
    });

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
      throw new Error(`Failed to start agent via Clawdbot: ${error.message}`);
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
    // Write the task request to a well-known location that Veritas monitors
    // This is simpler than trying to hit the WebSocket API
    const requestFile = path.join(
      PROJECT_ROOT,
      '.veritas-kanban',
      'agent-requests',
      `${taskId}.json`
    );

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

    console.log(`[ClawdbotAgent] Wrote agent request for task ${taskId} to ${requestFile}`);
    console.log(
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
      console.warn(`[ClawdbotAgent] Received completion for unknown task ${taskId}`);
      return;
    }

    const { attemptId, emitter } = pending;
    const endedAt = new Date().toISOString();
    const status: AttemptStatus = result.success ? 'complete' : 'failed';

    // Update task
    await this.taskService.updateTask(taskId, {
      status: result.success ? 'done' : 'in-progress',
      attempt: {
        id: attemptId,
        agent: pending.agent,
        status,
        started: pending.startedAt,
        ended: endedAt,
      },
    });

    // Append to log
    const logPath = path.join(this.logsDir, `${taskId}_${attemptId}.md`);
    const summary = result.summary || result.error || 'No summary provided';
    await fs.appendFile(logPath, `\n\n---\n\n## Result\n\n**Status:** ${status}\n\n${summary}\n`);

    // Emit completion
    emitter.emit('complete', { status, summary });

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

    console.log(`[ClawdbotAgent] Task ${taskId} completed with status: ${status}`);
  }

  /**
   * Stop a running agent
   */
  async stopAgent(taskId: string): Promise<void> {
    const pending = pendingAgents.get(taskId);
    if (!pending) {
      throw new Error('No agent running for this task');
    }

    // Mark as failed/stopped
    await this.completeAgent(taskId, {
      success: false,
      error: 'Stopped by user',
    });
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
    const logPath = path.join(this.logsDir, `${taskId}_${attemptId}.md`);
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
    return `# Agent Task Request

**Task ID:** ${task.id}
**Attempt ID:** ${attemptId}
**Worktree:** ${worktreePath}

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
**Agent:** ${agent} (via Clawdbot)
**Started:** ${new Date().toISOString()}
**Worktree:** ${task.git?.worktreePath}

## Task Prompt

\`\`\`
${prompt}
\`\`\`

## Progress

*Agent is working via Clawdbot sub-agent...*

`;
    await fs.writeFile(logPath, header, 'utf-8');
  }
}

// Export singleton
export const clawdbotAgentService = new ClawdbotAgentService();

import { spawn, ChildProcess } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import { ConfigService } from './config-service.js';
import { TaskService } from './task-service.js';
import type { Task, AgentType, TaskAttempt, AttemptStatus } from '@veritas-kanban/shared';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const LOGS_DIR = path.join(PROJECT_ROOT, '.veritas-kanban', 'logs');

export interface AgentOutput {
  type: 'stdout' | 'stderr' | 'stdin' | 'system';
  content: string;
  timestamp: string;
}

export interface AgentStatus {
  taskId: string;
  attemptId: string;
  agent: AgentType;
  status: AttemptStatus;
  pid?: number;
  startedAt?: string;
  endedAt?: string;
}

// Global map of running agents
const runningAgents = new Map<string, {
  process: ChildProcess;
  taskId: string;
  attemptId: string;
  agent: AgentType;
  logPath: string;
  emitter: EventEmitter;
}>();

export class AgentService {
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
    if (runningAgents.has(taskId)) {
      throw new Error('An agent is already running for this task');
    }

    // Get agent config
    const config = await this.configService.getConfig();
    const agent = agentType || config.defaultAgent;
    const agentConfig = config.agents.find(a => a.type === agent);

    if (!agentConfig) {
      throw new Error(`Agent "${agent}" not found in config`);
    }

    if (!agentConfig.enabled) {
      throw new Error(`Agent "${agent}" is not enabled`);
    }

    // Create attempt
    const attemptId = `attempt_${nanoid(8)}`;
    const startedAt = new Date().toISOString();
    const logPath = path.join(this.logsDir, `${taskId}_${attemptId}.md`);

    // Build prompt from task
    const prompt = this.buildPrompt(task);

    // Create event emitter for this agent
    const emitter = new EventEmitter();

    // Spawn agent process
    const worktreePath = this.expandPath(task.git.worktreePath);
    const args = [...agentConfig.args];
    
    // Add prompt for certain agents
    if (agent === 'claude-code' || agent === 'amp') {
      args.push(prompt);
    }

    const childProcess = spawn(agentConfig.command, args, {
      cwd: worktreePath,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '1',
        TERM: 'xterm-256color',
      },
    });

    // Store in running agents
    runningAgents.set(taskId, {
      process: childProcess,
      taskId,
      attemptId,
      agent,
      logPath,
      emitter,
    });

    // Initialize log file
    await this.initLogFile(logPath, task, agent, prompt);

    // Handle stdout
    childProcess.stdout?.on('data', async (data: Buffer) => {
      const content = data.toString();
      const output: AgentOutput = {
        type: 'stdout',
        content,
        timestamp: new Date().toISOString(),
      };
      emitter.emit('output', output);
      await this.appendToLog(logPath, 'stdout', content);
    });

    // Handle stderr
    childProcess.stderr?.on('data', async (data: Buffer) => {
      const content = data.toString();
      const output: AgentOutput = {
        type: 'stderr',
        content,
        timestamp: new Date().toISOString(),
      };
      emitter.emit('output', output);
      await this.appendToLog(logPath, 'stderr', content);
    });

    // Handle process exit
    childProcess.on('exit', async (code, signal) => {
      const endedAt = new Date().toISOString();
      const status: AttemptStatus = code === 0 ? 'complete' : 'failed';

      // Update task attempt
      await this.updateTaskAttempt(taskId, attemptId, {
        status,
        ended: endedAt,
      });

      // Update task status
      await this.taskService.updateTask(taskId, {
        status: 'review',
      });

      // Emit completion
      emitter.emit('complete', { code, signal, status });

      // Finalize log
      await this.appendToLog(logPath, 'system', `\n---\nAgent exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`);

      // Remove from running agents
      runningAgents.delete(taskId);
    });

    // Handle errors
    childProcess.on('error', async (error) => {
      emitter.emit('error', error);
      await this.appendToLog(logPath, 'system', `\n---\nAgent error: ${error.message}`);
      runningAgents.delete(taskId);
    });

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
      // Add to attempts history
    });

    return {
      taskId,
      attemptId,
      agent,
      status: 'running',
      pid: childProcess.pid,
      startedAt,
    };
  }

  async sendMessage(taskId: string, message: string): Promise<void> {
    const running = runningAgents.get(taskId);
    if (!running) {
      throw new Error('No agent running for this task');
    }

    const { process: childProcess, logPath, emitter } = running;

    if (!childProcess.stdin?.writable) {
      throw new Error('Agent stdin is not writable');
    }

    // Send to agent stdin
    childProcess.stdin.write(message + '\n');

    // Log the input
    await this.appendToLog(logPath, 'stdin', message);

    // Emit for UI
    emitter.emit('output', {
      type: 'stdin',
      content: message,
      timestamp: new Date().toISOString(),
    });
  }

  async stopAgent(taskId: string): Promise<void> {
    const running = runningAgents.get(taskId);
    if (!running) {
      throw new Error('No agent running for this task');
    }

    const { process: childProcess, attemptId, logPath } = running;

    // Try graceful shutdown first
    childProcess.kill('SIGTERM');

    // Force kill after 5 seconds
    setTimeout(() => {
      if (runningAgents.has(taskId)) {
        childProcess.kill('SIGKILL');
      }
    }, 5000);

    // Update attempt status
    await this.updateTaskAttempt(taskId, attemptId, {
      status: 'failed',
      ended: new Date().toISOString(),
    });

    await this.appendToLog(logPath, 'system', '\n---\nAgent stopped by user');
  }

  getAgentStatus(taskId: string): AgentStatus | null {
    const running = runningAgents.get(taskId);
    if (!running) {
      return null;
    }

    return {
      taskId,
      attemptId: running.attemptId,
      agent: running.agent,
      status: 'running',
      pid: running.process.pid,
    };
  }

  getAgentEmitter(taskId: string): EventEmitter | null {
    return runningAgents.get(taskId)?.emitter || null;
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
      .filter(f => f.startsWith(`${taskId}_`) && f.endsWith('.md'))
      .map(f => f.replace(`${taskId}_`, '').replace('.md', ''));
  }

  private buildPrompt(task: Task): string {
    let prompt = `# Task: ${task.title}\n\n`;
    
    if (task.description) {
      prompt += `## Description\n\n${task.description}\n\n`;
    }

    prompt += `## Instructions\n\n`;
    prompt += `Work in this directory to complete the task above.\n`;
    prompt += `When you're done, commit your changes with a descriptive message.\n`;

    return prompt;
  }

  private async initLogFile(logPath: string, task: Task, agent: AgentType, prompt: string): Promise<void> {
    const header = `# Agent Log: ${task.title}

**Task ID:** ${task.id}
**Agent:** ${agent}
**Started:** ${new Date().toISOString()}
**Worktree:** ${task.git?.worktreePath}

## Prompt

\`\`\`
${prompt}
\`\`\`

## Output

`;
    await fs.writeFile(logPath, header, 'utf-8');
  }

  private async appendToLog(logPath: string, type: string, content: string): Promise<void> {
    const prefix = type === 'stdin' ? '\n**You:**\n' : '';
    const formatted = type === 'stdin' 
      ? `${prefix}${content}\n`
      : content;
    await fs.appendFile(logPath, formatted, 'utf-8');
  }

  private async updateTaskAttempt(
    taskId: string, 
    attemptId: string, 
    updates: Partial<TaskAttempt>
  ): Promise<void> {
    const task = await this.taskService.getTask(taskId);
    if (!task?.attempt || task.attempt.id !== attemptId) return;

    await this.taskService.updateTask(taskId, {
      attempt: {
        ...task.attempt,
        ...updates,
      },
    });
  }
}

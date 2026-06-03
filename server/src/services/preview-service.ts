import { spawn, ChildProcess } from 'child_process';
import { ConfigService } from './config-service.js';
import { TaskService } from './task-service.js';
import { expandPath } from '@veritas-kanban/shared';
import { redactString } from '../lib/redact.js';

export interface PreviewServer {
  taskId: string;
  repoName: string;
  pid: number;
  port: number;
  url: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  startedAt: string;
  output: string[];
  error?: string;
}

// Store running servers by taskId
const runningServers = new Map<
  string,
  {
    process: ChildProcess;
    info: PreviewServer;
  }
>();

// Maximum concurrent preview servers to prevent resource exhaustion
const MAX_PREVIEW_SERVERS = 5;

// Register cleanup on process signals (runs once)
let cleanupRegistered = false;
function registerCleanup() {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  const cleanup = () => {
    for (const [, entry] of runningServers) {
      try {
        entry.process.kill('SIGTERM');
      } catch {
        /* already dead */
      }
    }
    runningServers.clear();
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

export class PreviewService {
  private configService: ConfigService;
  private taskService: TaskService;
  private readonly MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB limit for output

  constructor() {
    this.configService = new ConfigService();
    this.taskService = new TaskService();
    registerCleanup();
  }

  /**
   * Extract port from output using common patterns
   */
  private extractPort(output: string): number | null {
    // Common patterns for dev servers
    const patterns = [
      /localhost:(\d+)/i,
      /127\.0\.0\.1:(\d+)/i,
      /port\s+(\d+)/i,
      /listening on.*:(\d+)/i,
      /http:\/\/[^:]+:(\d+)/i,
      /:(\d{4,5})/, // Any 4-5 digit port
    ];

    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
    return null;
  }

  /**
   * Check if output indicates server is ready
   */
  private isServerReady(output: string, customPattern?: string): boolean {
    if (customPattern) {
      return new RegExp(customPattern).test(output);
    }

    // Common ready patterns
    const readyPatterns = [
      /ready/i,
      /started/i,
      /listening/i,
      /compiled/i,
      /localhost:\d+/i,
      /server running/i,
    ];

    return readyPatterns.some((p) => p.test(output));
  }

  private recordOutput(info: PreviewServer, output: string): void {
    info.output.push(redactString(output));

    // Calculate total output size
    const totalSize = info.output.reduce((sum, line) => sum + line.length, 0);

    // Enforce size limit
    if (totalSize > this.MAX_OUTPUT_SIZE) {
      // Truncate from the beginning, keep recent output
      while (
        info.output.length > 0 &&
        info.output.reduce((sum, line) => sum + line.length, 0) > this.MAX_OUTPUT_SIZE * 0.8
      ) {
        info.output.shift();
      }
      info.output.unshift('...[output truncated due to size limit]...\n');
    }

    // Keep only last 100 lines as secondary limit
    if (info.output.length > 100) {
      info.output = info.output.slice(-100);
    }
  }

  /**
   * Start a preview server for a task
   */
  async startPreview(taskId: string): Promise<PreviewServer> {
    // Check if already running
    const existing = runningServers.get(taskId);
    if (existing && existing.info.status === 'running') {
      return existing.info;
    }

    // Enforce max concurrent servers
    if (runningServers.size >= MAX_PREVIEW_SERVERS) {
      throw new Error(
        `Maximum concurrent preview servers (${MAX_PREVIEW_SERVERS}) reached. Stop an existing server first.`
      );
    }

    // Get task
    const task = await this.taskService.getTask(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    if (!task.git?.repo) {
      throw new Error('Task must have a repository configured');
    }

    // Get repo config
    const config = await this.configService.getConfig();
    const repoConfig = config.repos.find(
      (r: { name: string; path: string; defaultBranch: string; devServer?: any }) =>
        r.name === task.git!.repo
    );
    if (!repoConfig) {
      throw new Error(`Repository "${task.git.repo}" not found in config`);
    }

    if (!repoConfig.devServer) {
      throw new Error(
        `No dev server configured for repository "${task.git.repo}". Configure it in Settings.`
      );
    }

    // Determine working directory (worktree or main repo)
    const workDir = task.git.worktreePath || expandPath(repoConfig.path);

    // Parse command safely — split on whitespace (no shell interpretation)
    const parts = repoConfig.devServer.command.trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    const info: PreviewServer = {
      taskId,
      repoName: task.git.repo,
      pid: 0,
      port: repoConfig.devServer.port || 0,
      url: '',
      status: 'starting',
      startedAt: new Date().toISOString(),
      output: [],
    };

    return new Promise((resolve, reject) => {
      try {
        const proc = spawn(cmd, args, {
          cwd: workDir,
          shell: false,
          env: { ...process.env, FORCE_COLOR: '1' },
        });

        info.pid = proc.pid || 0;

        // Collect output
        const handleOutput = (data: Buffer) => {
          const text = data.toString();
          this.recordOutput(info, text);

          // Try to extract port if not set
          if (!info.port) {
            const port = this.extractPort(text);
            if (port) {
              info.port = port;
              info.url = `http://localhost:${port}`;
            }
          }

          // Check if ready
          if (
            info.status === 'starting' &&
            this.isServerReady(text, repoConfig.devServer?.readyPattern)
          ) {
            info.status = 'running';

            // If port still not detected, use configured or default
            if (!info.port) {
              info.port = repoConfig.devServer?.port || 3000;
              info.url = `http://localhost:${info.port}`;
            }
          }
        };

        proc.stdout?.on('data', handleOutput);
        proc.stderr?.on('data', handleOutput);

        proc.on('error', (err) => {
          info.status = 'error';
          info.error = redactString(err.message);
          runningServers.delete(taskId);
          reject(new Error(`Failed to start dev server: ${redactString(err.message)}`));
        });

        proc.on('exit', (code) => {
          info.status = 'stopped';
          if (code !== 0 && code !== null) {
            info.error = `Process exited with code ${code}`;
          }
          runningServers.delete(taskId);
        });

        runningServers.set(taskId, { process: proc, info });

        // Wait for server to be ready (with timeout)
        const startTime = Date.now();
        const timeout = 30000; // 30 seconds

        const checkReady = () => {
          if (info.status === 'running') {
            resolve(info);
          } else if (info.status === 'error' || info.status === 'stopped') {
            reject(new Error(info.error || 'Server failed to start'));
          } else if (Date.now() - startTime > timeout) {
            // Timeout - assume it's running if we got a port
            if (info.port) {
              info.status = 'running';
              resolve(info);
            } else {
              info.status = 'error';
              info.error = 'Timeout waiting for server to start';
              this.stopPreview(taskId);
              reject(new Error('Timeout waiting for dev server to start'));
            }
          } else {
            setTimeout(checkReady, 500);
          }
        };

        setTimeout(checkReady, 1000);
      } catch (error: any) {
        info.status = 'error';
        info.error = error.message;
        reject(error);
      }
    });
  }

  /**
   * Stop a preview server
   */
  async stopPreview(taskId: string): Promise<void> {
    const server = runningServers.get(taskId);
    if (!server) {
      return; // Already stopped
    }

    try {
      // Kill the process and all children
      server.process.kill('SIGTERM');

      // Force kill after 5 seconds if not dead
      setTimeout(() => {
        try {
          server.process.kill('SIGKILL');
        } catch {
          // Already dead
        }
      }, 5000);
    } finally {
      runningServers.delete(taskId);
    }
  }

  /**
   * Get status of a preview server
   */
  getPreviewStatus(taskId: string): PreviewServer | null {
    const server = runningServers.get(taskId);
    return server?.info || null;
  }

  /**
   * Get all running preview servers
   */
  getAllPreviews(): PreviewServer[] {
    return Array.from(runningServers.values()).map((s) => s.info);
  }

  /**
   * Get recent output from a preview server
   */
  getPreviewOutput(taskId: string, lines: number = 50): string[] {
    const server = runningServers.get(taskId);
    if (!server) {
      return [];
    }
    return server.info.output.slice(-lines);
  }
}

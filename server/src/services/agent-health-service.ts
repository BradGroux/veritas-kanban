import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { AgentConfig } from '@veritas-kanban/shared';

const execFileAsync = promisify(execFile);

export interface AgentHealthStatus {
  type: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  command: string;
  executableFound: boolean;
  executablePath?: string;
  authenticated: boolean | null;
  healthy: boolean;
  checkedAt: string;
  reason?: string;
}

export interface AgentHealthChecker {
  checkAgent(agent: AgentConfig): Promise<AgentHealthStatus>;
}

export class AgentHealthService implements AgentHealthChecker {
  async checkAgent(agent: AgentConfig): Promise<AgentHealthStatus> {
    const checkedAt = new Date().toISOString();
    const executable = await this.findExecutable(agent.command);
    const auth = executable.found ? await this.checkAuth(agent) : { authenticated: null };
    const reason = this.buildReason(agent, executable.found, auth.authenticated, auth.error);

    return {
      type: agent.type,
      name: agent.name,
      enabled: agent.enabled,
      configured: true,
      command: agent.command,
      executableFound: executable.found,
      executablePath: executable.path,
      authenticated: auth.authenticated,
      healthy: agent.enabled && executable.found && auth.authenticated !== false,
      checkedAt,
      reason,
    };
  }

  private async findExecutable(command: string): Promise<{ found: boolean; path?: string }> {
    if (!command.trim()) return { found: false };

    if (command.includes(path.sep)) {
      try {
        await fs.access(command, fsConstants.X_OK);
        return { found: true, path: command };
      } catch {
        return { found: false };
      }
    }

    try {
      const { stdout } = await execFileAsync('which', [command]);
      return { found: true, path: stdout.trim() };
    } catch {
      return { found: false };
    }
  }

  private async checkAuth(
    agent: AgentConfig
  ): Promise<{ authenticated: boolean | null; error?: string }> {
    const command = path.basename(agent.command);
    const provider = agent.provider ?? '';

    if (provider === 'codex-cloud' || command === 'gh') {
      return this.runAuthProbe(agent.command, ['auth', 'status'], /logged in/i);
    }

    if (provider.startsWith('codex') || command === 'codex') {
      return this.runAuthProbe(agent.command, ['login', 'status'], /logged in/i);
    }

    return { authenticated: null };
  }

  private async runAuthProbe(
    command: string,
    args: string[],
    successPattern: RegExp
  ): Promise<{ authenticated: boolean; error?: string }> {
    try {
      const { stdout, stderr } = await execFileAsync(command, args);
      const output = `${stdout}${stderr}`.trim();
      return {
        authenticated: successPattern.test(output),
        error: successPattern.test(output) ? undefined : output || 'Authentication status unknown',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authentication probe failed';
      return { authenticated: false, error: message };
    }
  }

  private buildReason(
    agent: AgentConfig,
    executableFound: boolean,
    authenticated: boolean | null,
    authError?: string
  ): string | undefined {
    if (!agent.enabled) return 'Agent is disabled';
    if (!executableFound) return `Executable "${agent.command}" was not found on PATH`;
    if (authenticated === false) {
      return authError ? `Authentication check failed: ${authError}` : 'Authentication required';
    }
    return undefined;
  }
}

import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { AgentConfig } from '@veritas-kanban/shared';

const execFileAsync = promisify(execFile);
const PROVIDER_VERSION_TIMEOUT_MS = 5_000;
const PROVIDER_VERSION_MAX_BUFFER_BYTES = 8 * 1024;

interface CommandOptions {
  timeout?: number;
  maxBuffer?: number;
  shell?: boolean;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

export type AgentHealthCommandRunner = (
  command: string,
  args: string[],
  options?: CommandOptions
) => Promise<CommandResult>;

interface ProviderVersionProbe {
  attempted: boolean;
  output?: string;
  source?: string;
  error?: string;
}

const defaultCommandRunner: AgentHealthCommandRunner = async (command, args, options) => {
  const { stdout, stderr } = await execFileAsync(command, args, {
    ...options,
    encoding: 'utf8',
  });
  return { stdout: String(stdout), stderr: String(stderr) };
};

export interface AgentHealthStatus {
  type: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  command: string;
  executableFound: boolean;
  executablePath?: string;
  providerVersion?: string;
  providerVersionSource?: string;
  authenticated: boolean | null;
  healthy: boolean;
  checkedAt: string;
  reason?: string;
}

export interface AgentHealthChecker {
  checkAgent(agent: AgentConfig): Promise<AgentHealthStatus>;
}

export class AgentHealthService implements AgentHealthChecker {
  constructor(private readonly runCommand: AgentHealthCommandRunner = defaultCommandRunner) {}

  async checkAgent(agent: AgentConfig): Promise<AgentHealthStatus> {
    const checkedAt = new Date().toISOString();
    const executable = await this.findExecutable(agent.command);
    const version = executable.found
      ? await this.probeProviderVersion(agent.command)
      : { attempted: false };
    const auth = executable.found ? await this.checkAuth(agent, version) : { authenticated: null };
    const reason = this.buildReason(agent, executable.found, auth.authenticated, auth.error);

    return {
      type: agent.type,
      name: agent.name,
      enabled: agent.enabled,
      configured: true,
      command: agent.command,
      executableFound: executable.found,
      executablePath: executable.path,
      providerVersion: version.output,
      providerVersionSource: version.source,
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
      const { stdout } = await this.runCommand('which', [command]);
      return { found: true, path: stdout.trim() };
    } catch {
      return { found: false };
    }
  }

  private async checkAuth(
    agent: AgentConfig,
    versionProbe: ProviderVersionProbe
  ): Promise<{ authenticated: boolean | null; error?: string }> {
    const command = path.basename(agent.command);
    const provider = agent.provider ?? '';

    if (provider === 'codex-cloud' || command === 'gh') {
      return this.runAuthProbe(agent.command, ['auth', 'status'], /logged in/i);
    }

    if (provider === 'ollama-local') {
      return this.runAuthProbe(agent.command, ['list'], /name|model/i);
    }

    if (provider === 'ollama-cloud') {
      if (process.env.OLLAMA_API_KEY) return { authenticated: true };
      return { authenticated: null };
    }

    if (provider === 'lm-studio-local') {
      return this.runAuthProbe(
        agent.command,
        ['server', 'status', '--json', '--quiet'],
        /"running"\s*:\s*true|server is running/i
      );
    }

    if (provider === 'hermes-cli' || command === 'hermes') {
      // Hermes v2026.7.7.2: binary existence + version probe. API key is optional at
      // probe time; the actual run will fail if no key is configured.
      const versionAuth = this.authResultFromVersionProbe(versionProbe, /hermes|version|\d+\.\d+/i);
      if (!versionAuth.authenticated) return versionAuth;
      // Check for at least one supported API key in the environment
      const hasKey = Boolean(process.env.HERMES_API_KEY || process.env.ANTHROPIC_API_KEY);
      if (!hasKey) {
        return {
          authenticated: null,
          error: 'No HERMES_API_KEY or ANTHROPIC_API_KEY found in environment',
        };
      }
      return { authenticated: true };
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
      const { stdout, stderr } = await this.runCommand(command, args);
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

  private async probeProviderVersion(command: string): Promise<ProviderVersionProbe> {
    const source = `${path.basename(command)} --version`;
    try {
      const { stdout, stderr } = await this.runCommand(command, ['--version'], {
        timeout: PROVIDER_VERSION_TIMEOUT_MS,
        maxBuffer: PROVIDER_VERSION_MAX_BUFFER_BYTES,
        shell: false,
      });
      const output = boundUtf8(`${stdout}${stderr}`.trim(), PROVIDER_VERSION_MAX_BUFFER_BYTES);
      return {
        attempted: true,
        output: output || undefined,
        source: output ? source : undefined,
        error: output ? undefined : 'Provider version output was empty',
      };
    } catch (error) {
      return {
        attempted: true,
        error: error instanceof Error ? error.message : 'Provider version probe failed',
      };
    }
  }

  private authResultFromVersionProbe(
    probe: ProviderVersionProbe,
    successPattern: RegExp
  ): { authenticated: boolean; error?: string } {
    const output = probe.output ?? '';
    const authenticated = successPattern.test(output);
    return {
      authenticated,
      error: authenticated
        ? undefined
        : probe.error || output || (probe.attempted ? 'Authentication status unknown' : undefined),
    };
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

function boundUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.byteLength <= maxBytes) return value;
  return bytes
    .subarray(0, maxBytes)
    .toString('utf8')
    .replace(/\uFFFD$/u, '');
}

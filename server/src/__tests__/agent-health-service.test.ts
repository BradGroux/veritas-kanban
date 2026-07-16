import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '@veritas-kanban/shared';
import {
  AgentHealthService,
  type AgentHealthCommandRunner,
} from '../services/agent-health-service.js';

const baseAgent: AgentConfig = {
  type: 'fixture-agent',
  name: 'Fixture Agent',
  command: process.execPath,
  args: [],
  enabled: true,
  provider: 'custom',
};

const originalHermesApiKey = process.env.HERMES_API_KEY;
const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  vi.restoreAllMocks();
  restoreEnv('HERMES_API_KEY', originalHermesApiKey);
  restoreEnv('ANTHROPIC_API_KEY', originalAnthropicApiKey);
});

describe('AgentHealthService provider version evidence', () => {
  it('captures version evidence with a bounded no-shell probe', async () => {
    const runCommand = vi.fn<AgentHealthCommandRunner>().mockResolvedValue({
      stdout: 'fixture-provider 1.2.3\n',
      stderr: '',
    });

    const result = await new AgentHealthService(runCommand).checkAgent(baseAgent);

    expect(result).toMatchObject({
      healthy: true,
      authenticated: null,
      providerVersion: 'fixture-provider 1.2.3',
      providerVersionSource: `${process.platform === 'win32' ? 'node.exe' : 'node'} --version`,
    });
    expect(runCommand).toHaveBeenCalledOnce();
    expect(runCommand).toHaveBeenCalledWith(process.execPath, ['--version'], {
      timeout: 5_000,
      maxBuffer: 8 * 1024,
      shell: false,
    });
  });

  it('keeps version probe failures advisory for providers without version-based auth', async () => {
    const runCommand = vi
      .fn<AgentHealthCommandRunner>()
      .mockRejectedValue(new Error('version command failed'));

    const result = await new AgentHealthService(runCommand).checkAgent(baseAgent);

    expect(result.healthy).toBe(true);
    expect(result.authenticated).toBeNull();
    expect(result.providerVersion).toBeUndefined();
    expect(result.providerVersionSource).toBeUndefined();
    expect(result.reason).toBeUndefined();
  });

  it('caps recorded version evidence at 8 KiB even when a runner exceeds its contract', async () => {
    const runCommand = vi.fn<AgentHealthCommandRunner>().mockResolvedValue({
      stdout: 'v'.repeat(9 * 1024),
      stderr: '',
    });

    const result = await new AgentHealthService(runCommand).checkAgent(baseAgent);

    expect(Buffer.byteLength(result.providerVersion ?? '', 'utf8')).toBe(8 * 1024);
  });

  it('reuses the version evidence for Hermes authentication instead of probing twice', async () => {
    process.env.HERMES_API_KEY = 'test-only';
    delete process.env.ANTHROPIC_API_KEY;
    const runCommand = vi.fn<AgentHealthCommandRunner>().mockResolvedValue({
      stdout: 'Hermes Agent 2026.7.7.2\n',
      stderr: '',
    });
    const hermesAgent: AgentConfig = {
      ...baseAgent,
      type: 'hermes',
      name: 'Hermes',
      provider: 'hermes-cli',
    };

    const result = await new AgentHealthService(runCommand).checkAgent(hermesAgent);

    expect(result).toMatchObject({
      healthy: true,
      authenticated: true,
      providerVersion: 'Hermes Agent 2026.7.7.2',
    });
    expect(runCommand).toHaveBeenCalledOnce();
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

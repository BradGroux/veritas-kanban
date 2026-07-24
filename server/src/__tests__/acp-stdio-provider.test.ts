import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  BUZZ_AGENT_TESTED_COMMIT,
  BUZZ_AGENT_TESTED_RELEASE,
  buildCopilotAcpArgs,
  COPILOT_ACP_REQUIRED_ARGS,
  COPILOT_ACP_RUNTIME_PROFILE_ID,
  COPILOT_ACP_TESTED_COMMIT,
  COPILOT_ACP_TESTED_RELEASE,
  openAcpStdio,
  probeAcpStdioRuntime,
} from '../services/acp-stdio-adapter.js';
import { ClawdbotAgentService } from '../services/clawdbot-agent-service.js';
import { AgentHealthService } from '../services/agent-health-service.js';
import { normalizeHarnessSupportProfile } from '../services/harness-support-profile-registry.js';
import { getProviderRuntimeAdapterDefinition } from '../services/provider-runtime-adapter-registry.js';

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/acp-v1-agent.mjs', import.meta.url));

function options(mode = 'complete') {
  return {
    command: process.execPath,
    args: [FIXTURE_PATH, mode],
    cwd: process.cwd(),
    environment: process.env,
  };
}

describe('ACP v1 stdio provider adapter', () => {
  it('registers an explicit configured runtime with negotiated manifest evidence', async () => {
    const service = new ClawdbotAgentService({
      async checkAgent(agent) {
        return {
          type: agent.type,
          name: agent.name,
          enabled: true,
          configured: true,
          command: agent.command,
          executableFound: true,
          executablePath: process.execPath,
          authenticated: null,
          healthy: true,
          checkedAt: '2026-07-24T12:00:00.000Z',
        };
      },
    });

    const manifest = await service.probeProviderRuntime({
      type: 'fixture-acp',
      name: 'Fixture ACP',
      command: process.execPath,
      args: [FIXTURE_PATH],
      enabled: true,
      provider: 'acp-stdio',
    });

    expect(manifest).toMatchObject({
      provider: 'acp-stdio',
      adapter: 'acp-stdio',
      protocolVersion: 'acp/v1',
      providerVersion: 'VK ACP fixture 1.3.0',
      providerBuild: expect.stringMatching(/^acp-v1:sha256:[a-f0-9]{64}$/),
      probeRevision: 12,
    });
    expect(manifest.capabilities.find((capability) => capability.id === 'run.resume')?.state).toBe(
      'supported'
    );
    expect(manifest.capabilities.find((capability) => capability.id === 'run.fork')?.state).toBe(
      'supported'
    );
  });

  it('recognizes the pinned Buzz agent profile without creating a Buzz provider', async () => {
    const agent = {
      type: 'buzz-agent',
      name: 'Buzz Agent',
      command: process.execPath,
      args: [FIXTURE_PATH, 'buzz'],
      enabled: true,
      provider: 'acp-stdio' as const,
    };
    const supportProfile = normalizeHarnessSupportProfile(agent);
    expect(supportProfile).toMatchObject({
      id: 'buzz-agent',
      adapterId: 'acp-stdio',
      transport: 'acp',
      executable: { versionArgs: [] },
      compatibility: { testedVersions: ['buzz-agent 0.1.0'] },
    });

    const service = new ClawdbotAgentService({
      async checkAgent() {
        return {
          type: agent.type,
          name: agent.name,
          enabled: true,
          configured: true,
          command: agent.command,
          executableFound: true,
          executablePath: process.execPath,
          authenticated: null,
          healthy: true,
          checkedAt: '2026-07-24T12:00:00.000Z',
        };
      },
    });
    const manifest = await service.probeProviderRuntime(agent);

    expect(manifest).toMatchObject({
      provider: 'acp-stdio',
      adapter: 'acp-stdio',
      providerVersion: 'buzz-agent 0.1.0',
      providerBuild: expect.stringMatching(/profile:buzz-agent@1:sha256:/),
      probeRevision: 12,
      probe: {
        diagnostics: expect.arrayContaining([
          expect.stringContaining(BUZZ_AGENT_TESTED_RELEASE),
          expect.stringContaining(BUZZ_AGENT_TESTED_COMMIT),
        ]),
      },
    });
    expect(manifest.capabilities.find((capability) => capability.id === 'run.resume')?.state).toBe(
      'unsupported'
    );
  });

  it('fails Buzz profile identity and version mismatches closed', async () => {
    await expect(
      probeAcpStdioRuntime({
        ...options('buzz-wrong-name'),
        runtimeProfileId: 'buzz-agent',
      })
    ).rejects.toThrow(/outside the tested compatibility profile/i);
    await expect(
      probeAcpStdioRuntime({
        ...options('buzz-wrong-version'),
        runtimeProfileId: 'buzz-agent',
      })
    ).rejects.toThrow(/outside the tested compatibility profile/i);
  });

  it('uses ACP initialize instead of a hanging buzz-agent --version health probe', async () => {
    const agent = {
      type: 'buzz-agent',
      name: 'Buzz Agent',
      command: 'buzz-agent',
      args: [],
      enabled: true,
      provider: 'acp-stdio' as const,
    };
    const runCommand = vi.fn(async (command: string) => {
      if (command === 'which') return { stdout: '/usr/local/bin/buzz-agent\n', stderr: '' };
      throw new Error(`Unexpected command: ${command}`);
    });
    const health = await new AgentHealthService(runCommand).checkAgent({
      ...agent,
      supportProfile: normalizeHarnessSupportProfile(agent),
    });

    expect(health).toMatchObject({
      executableFound: true,
      providerVersion: undefined,
      authenticated: null,
      healthy: true,
    });
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it('recognizes the pinned Copilot CLI profile through the generic ACP provider', async () => {
    const agent = {
      type: 'copilot',
      name: 'GitHub Copilot CLI',
      command: FIXTURE_PATH,
      args: ['--effort=high', '--deny-url=example.invalid'],
      enabled: true,
      provider: 'acp-stdio' as const,
      model: 'gpt-5.6-sol',
    };
    const supportProfile = normalizeHarnessSupportProfile(agent);
    expect(supportProfile).toMatchObject({
      id: COPILOT_ACP_RUNTIME_PROFILE_ID,
      adapterId: 'acp-stdio',
      transport: 'acp',
      authentication: { kind: 'provider-managed', nonMutating: true },
      compatibility: { testedVersions: ['Copilot 1.0.74'] },
      launch: {
        args: expect.arrayContaining([
          '--acp',
          '--stdio',
          '--no-auto-update',
          '--disable-builtin-mcps',
          '--model=gpt-5.6-sol',
          '--effort=high',
          '--deny-url=example.invalid',
        ]),
      },
    });

    const service = new ClawdbotAgentService({
      async checkAgent() {
        return {
          type: agent.type,
          name: agent.name,
          enabled: true,
          configured: true,
          command: agent.command,
          executableFound: true,
          executablePath: agent.command,
          providerVersion: 'GitHub Copilot CLI 1.0.74',
          providerVersionSource: 'copilot --version',
          authenticated: null,
          healthy: true,
          checkedAt: '2026-07-24T12:00:00.000Z',
        };
      },
    });
    const manifest = await service.probeProviderRuntime(agent);

    expect(manifest).toMatchObject({
      provider: 'acp-stdio',
      adapter: 'acp-stdio',
      providerVersion: 'Copilot 1.0.74',
      providerBuild: expect.stringMatching(/profile:github-copilot-cli@1:sha256:/),
      probeRevision: 12,
      probe: {
        diagnostics: expect.arrayContaining([
          expect.stringContaining(COPILOT_ACP_TESTED_RELEASE),
          expect.stringContaining(COPILOT_ACP_TESTED_COMMIT),
          expect.stringContaining('public-preview-acp'),
        ]),
      },
    });
    expect(manifest.capabilities.find((capability) => capability.id === 'run.resume')?.state).toBe(
      'supported'
    );
  });

  it('uses the safe Copilot version probe without attempting authentication', async () => {
    const agent = {
      type: 'copilot',
      name: 'GitHub Copilot CLI',
      command: 'copilot',
      args: [],
      enabled: true,
      provider: 'acp-stdio' as const,
    };
    const runCommand = vi.fn(async (command: string, args: string[]) => {
      if (command === 'which') return { stdout: '/usr/local/bin/copilot\n', stderr: '' };
      if (command === 'copilot' && args.join(' ') === '--version') {
        return { stdout: 'GitHub Copilot CLI 1.0.74\n', stderr: '' };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    });
    const health = await new AgentHealthService(runCommand).checkAgent({
      ...agent,
      supportProfile: normalizeHarnessSupportProfile(agent),
    });

    expect(health).toMatchObject({
      executableFound: true,
      providerVersion: 'GitHub Copilot CLI 1.0.74',
      providerVersionSource: 'copilot --version',
      authenticated: null,
      healthy: true,
    });
    expect(runCommand).toHaveBeenCalledTimes(2);
  });

  it('fails Copilot identity, version, and capability drift closed', async () => {
    for (const mode of [
      'copilot-wrong-name',
      'copilot-wrong-version',
      'copilot-wrong-capabilities',
    ]) {
      await expect(
        probeAcpStdioRuntime({
          ...options(mode),
          runtimeProfileId: COPILOT_ACP_RUNTIME_PROFILE_ID,
        })
      ).rejects.toThrow(/outside the tested compatibility profile/i);
    }
  });

  it('compiles only the tested Copilot process-wide policy arguments', () => {
    expect(
      buildCopilotAcpArgs({
        model: 'gpt-5.6-sol',
        extraArgs: [
          '--reasoning-effort',
          'xhigh',
          '--available-tools=view,bash',
          '--excluded-tools=write',
          '--deny-tool=bash(rm)',
          '--deny-url',
          'example.invalid',
          '--context=long_context',
          '--max-ai-credits=30',
        ],
      })
    ).toEqual([
      ...COPILOT_ACP_REQUIRED_ARGS,
      '--model=gpt-5.6-sol',
      '--effort=xhigh',
      '--available-tools=view,bash',
      '--excluded-tools=write',
      '--deny-tool=bash(rm)',
      '--deny-url=example.invalid',
      '--context=long_context',
      '--max-ai-credits=30',
    ]);

    for (const argument of [
      '-p',
      '--allow-all',
      '--allow-all-tools',
      '--allow-url=example.com',
      '--port=3000',
      '--remote',
      '--plugin-dir=/tmp/plugin',
      '--additional-mcp-config={}',
      '--resume=session',
    ]) {
      expect(() => buildCopilotAcpArgs({ extraArgs: [argument] })).toThrow(
        /not governed by Veritas/i
      );
    }
  });

  it('negotiates, prompts, streams tool updates, and resolves permission requests', async () => {
    const updates: string[] = [];
    const permissions: string[] = [];
    const control = await openAcpStdio({
      ...options(),
      onNotification: (notification) => {
        updates.push(notification.update.sessionUpdate);
      },
      onPermissionRequest: (request) => {
        permissions.push(request.toolCall.toolCallId);
        return { outcome: { outcome: 'selected', optionId: 'allow' } };
      },
    });

    try {
      expect(control.probe).toMatchObject({
        protocolVersion: 1,
        agentInfo: { name: 'VK ACP fixture', version: '1.3.0' },
      });
      expect(control.probe.capabilityDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      await expect(
        control.openSession({ mode: 'fresh', cwd: process.cwd(), mcpServers: [] })
      ).resolves.toBe('session-new');
      await expect(control.prompt('Complete the task.')).resolves.toEqual({
        stopReason: 'end_turn',
      });
      expect(updates).toEqual(['agent_message_chunk', 'tool_call', 'tool_call_update']);
      expect(permissions).toEqual(['tool-1']);
    } finally {
      await control.close();
    }
  });

  it('resumes and forks only when the runtime negotiated those capabilities', async () => {
    const resumable = await openAcpStdio(options());
    try {
      await expect(
        resumable.openSession({
          mode: 'resume',
          cwd: process.cwd(),
          mcpServers: [],
          conversationId: 'session-existing',
        })
      ).resolves.toBe('session-existing');
    } finally {
      await resumable.close();
    }

    const unsupported = await openAcpStdio(options('no-resume'));
    try {
      await expect(
        unsupported.openSession({
          mode: 'fresh',
          cwd: process.cwd(),
          mcpServers: [
            {
              type: 'http',
              name: 'fixture-http',
              url: 'https://example.test/mcp',
              headers: [],
            },
          ],
        })
      ).rejects.toThrow(/did not negotiate http MCP transport support/i);
      await expect(
        unsupported.openSession({
          mode: 'resume',
          cwd: process.cwd(),
          mcpServers: [],
          conversationId: 'session-existing',
        })
      ).rejects.toThrow(/did not negotiate session\/resume or session\/load/i);
    } finally {
      await unsupported.close();
    }
  });

  it('cancels the exact active session without waiting for process termination', async () => {
    const control = await openAcpStdio(options('cancel'));
    try {
      await control.openSession({ mode: 'fresh', cwd: process.cwd(), mcpServers: [] });
      const prompt = control.prompt('Wait for cancellation.');
      await control.cancel();
      await expect(prompt).resolves.toEqual({ stopReason: 'cancelled' });
    } finally {
      await control.close();
    }
  });

  it('fails the active prompt when a session update violates its causal binding', async () => {
    const control = await openAcpStdio({
      ...options('wrong-session'),
      onNotification(notification) {
        if (notification.sessionId !== 'session-new') {
          throw new Error('ACP update session does not match the active session.');
        }
      },
    });
    try {
      await control.openSession({ mode: 'fresh', cwd: process.cwd(), mcpServers: [] });
      await expect(control.prompt('Reject mismatched output.')).rejects.toThrow(
        /does not match the active session/i
      );
    } finally {
      await control.close();
    }
  });

  it('fails malformed protocol output closed and publishes bounded adapter capabilities', async () => {
    await expect(probeAcpStdioRuntime(options('malformed'))).rejects.toThrow(
      /ACP stdio process exited/i
    );
    await expect(probeAcpStdioRuntime(options('no-info'))).resolves.toMatchObject({
      agentInfo: { name: path.basename(process.execPath) },
    });
    const capabilities = getProviderRuntimeAdapterDefinition('acp-stdio').capabilities;
    const state = (id: string) => capabilities.find((capability) => capability.id === id)?.state;

    expect(state('run.streaming')).toBe('supported');
    expect(state('run.approvals')).toBe('supported');
    expect(state('tool.mcp')).toBe('supported');
    expect(state('credential.broker')).toBe('unsupported');
  });
});

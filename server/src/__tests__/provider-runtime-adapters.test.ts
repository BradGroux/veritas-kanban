import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '@veritas-kanban/shared';
import { ClawdbotAgentService } from '../services/clawdbot-agent-service.js';
import type { AgentHealthChecker } from '../services/agent-health-service.js';
import { normalizeHarnessSupportProfile } from '../services/harness-support-profile-registry.js';

const originalOpenClawVersion = process.env.OPENCLAW_GATEWAY_VERSION;

afterEach(() => {
  if (originalOpenClawVersion === undefined) {
    delete process.env.OPENCLAW_GATEWAY_VERSION;
  } else {
    process.env.OPENCLAW_GATEWAY_VERSION = originalOpenClawVersion;
  }
});

const health: AgentHealthChecker = {
  async checkAgent(agent) {
    return {
      type: agent.type,
      name: agent.name,
      enabled: agent.enabled,
      configured: true,
      command: agent.command,
      executableFound: true,
      executablePath: `/usr/local/bin/${agent.command}`,
      providerVersion: `${agent.provider ?? 'openclaw'} 1.0.0`,
      providerVersionSource: `${agent.command} --version`,
      authenticated: true,
      healthy: true,
      checkedAt: '2026-07-16T00:00:00.000Z',
    };
  },
};

function config(provider: AgentConfig['provider']): AgentConfig {
  return {
    type: provider ?? 'fixture',
    name: provider ?? 'Fixture',
    command: provider === 'hermes-cli' ? 'hermes' : 'codex',
    args: [],
    enabled: true,
    provider,
    model: 'fixture-model',
  };
}

describe('ClawdbotAgentService provider runtime adapters', () => {
  it.each([
    ['claude-code', 'claude'],
    ['copilot', 'copilot'],
  ] as const)(
    'fails closed when the provider-less %s display profile is probed',
    async (type, command) => {
      await expect(
        new ClawdbotAgentService(health).probeProviderRuntime({
          type,
          name: type,
          command,
          args: [],
          enabled: true,
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'CONFLICT',
        details: expect.objectContaining({
          agent: type,
          reason: 'No executable provider adapter is configured',
        }),
      });
    }
  );

  it('rejects a configured provider that does not match the normalized support profile', async () => {
    const displayOnly: AgentConfig = {
      type: 'claude-code',
      name: 'Claude Code',
      command: 'claude',
      args: [],
      enabled: true,
    };

    await expect(
      new ClawdbotAgentService(health).probeProviderRuntime({
        ...displayOnly,
        provider: 'codex-cli',
        supportProfile: normalizeHarnessSupportProfile(displayOnly),
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
      details: expect.objectContaining({
        profileId: 'claude-code',
        provider: 'codex-cli',
      }),
    });
  });

  it('does not trust a caller-supplied profile to authorize an unsupported built-in adapter', async () => {
    const openClawProfile = normalizeHarnessSupportProfile({
      type: 'custom-openclaw',
      name: 'Custom OpenClaw',
      command: 'openclaw',
      args: [],
      enabled: true,
      provider: 'openclaw',
    });

    await expect(
      new ClawdbotAgentService(health).probeProviderRuntime({
        type: 'claude-code',
        name: 'Claude Code',
        command: 'claude',
        args: [],
        enabled: true,
        provider: 'openclaw',
        supportProfile: openClawProfile,
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
      details: expect.objectContaining({
        profileId: 'claude-code',
        provider: 'openclaw',
        reason: 'Harness support profile has no executable adapter',
      }),
    });
  });

  it('fails closed when launch arguments contain credential material', async () => {
    const checkAgent = vi.fn(health.checkAgent);

    await expect(
      new ClawdbotAgentService({ checkAgent }).probeProviderRuntime({
        type: 'custom-secure-runner',
        name: 'Secure Runner',
        command: 'codex',
        args: ['--api-key', 'sensitive-launch-value'],
        enabled: true,
        provider: 'codex-cli',
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
      details: expect.objectContaining({
        profileId: 'openai-codex-cli',
        reason: 'Credential material is not allowed in harness launch commands or arguments',
      }),
    });
    expect(checkAgent).not.toHaveBeenCalled();
  });

  it('rejects a new custom provider-less profile even when its command is codex', async () => {
    await expect(
      new ClawdbotAgentService(health).probeProviderRuntime({
        type: 'custom-codex-wrapper',
        name: 'Custom Codex Wrapper',
        command: 'codex',
        args: [],
        enabled: true,
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
      details: expect.objectContaining({
        agent: 'custom-codex-wrapper',
        reason: 'No executable provider adapter is configured',
      }),
    });
  });

  it.each([
    ['codex-cli', 'codex-exec-json/v1', 'supported', 'ready'],
    ['codex-sdk', 'openai-codex-sdk/v1', 'supported', 'ready'],
    ['hermes-cli', 'hermes-one-shot/v1', 'supported', 'ready'],
    ['openclaw', 'openclaw-tools/v1', 'unsupported', 'degraded'],
  ] as const)(
    'probes the %s adapter manifest',
    async (provider, protocolVersion, stopState, probeState) => {
      process.env.OPENCLAW_GATEWAY_VERSION = 'openclaw 2026.6.11';
      const manifest = await new ClawdbotAgentService(health).probeProviderRuntime(
        config(provider)
      );

      expect(manifest.provider).toBe(provider);
      expect(manifest.protocolVersion).toBe(protocolVersion);
      expect(manifest.probe.state).toBe(probeState);
      expect(manifest.models).toEqual(['fixture-model']);
      expect(manifest.capabilities.find((item) => item.id === 'run.start')?.state).toBe(
        'supported'
      );
      expect(manifest.capabilities.find((item) => item.id === 'run.stop')?.state).toBe(stopState);
    }
  );

  it.each(['codex-cloud', 'ollama-local', 'ollama-cloud', 'lm-studio-local', 'custom'] as const)(
    'fails closed instead of routing the configured %s provider through OpenClaw',
    async (provider) => {
      await expect(
        new ClawdbotAgentService(health).probeProviderRuntime(config(provider))
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'CONFLICT',
        details: expect.objectContaining({ provider }),
      });
    }
  );

  it('separates OpenClaw task evidence from workflow-only controls and artifacts', async () => {
    process.env.OPENCLAW_GATEWAY_VERSION = 'openclaw 2026.6.11';
    const service = new ClawdbotAgentService(health);

    const taskManifest = await service.probeProviderRuntime(config('openclaw'));
    const workflowManifest = await service.probeProviderRuntime(
      config('openclaw'),
      'openclaw',
      'workflow'
    );

    expect(taskManifest.protocolVersion).toBe('openclaw-tools/v1');
    expect(
      taskManifest.capabilities.find((capability) => capability.id === 'run.follow-up')?.state
    ).toBe('unsupported');
    expect(
      taskManifest.capabilities.find((capability) => capability.id === 'artifact.write')?.state
    ).toBe('unknown');
    expect(workflowManifest.protocolVersion).toBe('openclaw-workflow-session/v1');
    expect(
      workflowManifest.capabilities.find((capability) => capability.id === 'run.follow-up')?.state
    ).toBe('supported');
    expect(
      workflowManifest.capabilities.find((capability) => capability.id === 'artifact.write')?.state
    ).toBe('supported');
    expect(workflowManifest.digest).not.toBe(taskManifest.digest);
  });
});

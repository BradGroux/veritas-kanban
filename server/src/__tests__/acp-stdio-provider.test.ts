import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openAcpStdio, probeAcpStdioRuntime } from '../services/acp-stdio-adapter.js';
import { ClawdbotAgentService } from '../services/clawdbot-agent-service.js';
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
      probeRevision: 10,
    });
    expect(manifest.capabilities.find((capability) => capability.id === 'run.resume')?.state).toBe(
      'supported'
    );
    expect(manifest.capabilities.find((capability) => capability.id === 'run.fork')?.state).toBe(
      'supported'
    );
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

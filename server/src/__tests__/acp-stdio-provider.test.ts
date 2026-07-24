import path from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  BUZZ_AGENT_TESTED_COMMIT,
  BUZZ_AGENT_TESTED_RELEASE,
  buildCopilotAcpArgs,
  buildGrokBuildAcpArgs,
  COPILOT_ACP_REQUIRED_ARGS,
  COPILOT_ACP_RUNTIME_PROFILE_ID,
  COPILOT_ACP_TESTED_COMMIT,
  COPILOT_ACP_TESTED_RELEASE,
  GROK_BUILD_ACP_VERSION,
  GROK_BUILD_REQUIRED_ARGS,
  GROK_BUILD_RUNTIME_PROFILE_ID,
  GROK_BUILD_TESTED_BUILD,
  GROK_BUILD_TESTED_RELEASE,
  GROK_BUILD_VERSION_OUTPUT,
  openAcpStdio,
  probeAcpStdioRuntime,
} from '../services/acp-stdio-adapter.js';
import { ClawdbotAgentService } from '../services/clawdbot-agent-service.js';
import { AgentHealthService } from '../services/agent-health-service.js';
import {
  harnessToolCatalogDelivery,
  normalizeHarnessSupportProfile,
} from '../services/harness-support-profile-registry.js';
import { getProviderRuntimeAdapterDefinition } from '../services/provider-runtime-adapter-registry.js';
import { RunToolBridgeService } from '../services/run-tool-bridge-service.js';

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/acp-v1-agent.mjs', import.meta.url));
const BRIDGE_RUNTIME_PATH = fileURLToPath(
  new URL('../../runtime/run-tool-bridge.mjs', import.meta.url)
);
const BRIDGE_HANDLE = `vkbridge_${'b'.repeat(43)}`;
const DIGEST = `sha256:${'a'.repeat(64)}`;

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
      probeRevision: 14,
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
    expect(harnessToolCatalogDelivery(supportProfile.id)).toBe('veritas-bridge');
    expect(harnessToolCatalogDelivery(COPILOT_ACP_RUNTIME_PROFILE_ID)).toBe('native');

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
      probeRevision: 14,
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

  it('composes Buzz ACP with only the run-scoped Veritas bridge', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const api = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        response.setHeader('content-type', 'application/json');
        if (request.url?.endsWith('/catalog')) {
          response.end(
            JSON.stringify({
              digest: DIGEST,
              entries: [
                {
                  serverId: 'veritas',
                  tools: [
                    { name: 'read_task', decision: 'allow' },
                    { name: 'update_task', decision: 'approval' },
                  ],
                },
              ],
            })
          );
          return;
        }
        const call = JSON.parse(body) as Record<string, unknown>;
        calls.push(call);
        if (call.tool === 'delete_task') {
          response.statusCode = 403;
          response.end(JSON.stringify({ error: { message: 'Tool denied by immutable catalog.' } }));
          return;
        }
        response.end(JSON.stringify({ success: true, operationId: call.operationId }));
      });
    });
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
    const port = (api.address() as AddressInfo).port;
    const bridge = new RunToolBridgeService({
      apiUrl: `http://127.0.0.1:${port}`,
      entrypoint: BRIDGE_RUNTIME_PATH,
      randomHandle: () => BRIDGE_HANDLE,
    });
    const launch = bridge.issue({
      taskId: 'task-buzz',
      attemptId: 'attempt-buzz',
      catalogDigest: DIGEST,
      runLaunchManifestDigest: `sha256:${'b'.repeat(64)}`,
    });
    const messages: string[] = [];
    const control = await openAcpStdio({
      ...options('buzz-bridge'),
      onNotification(notification) {
        if (
          notification.update.sessionUpdate === 'agent_message_chunk' &&
          notification.update.content.type === 'text'
        ) {
          messages.push(notification.update.content.text);
        }
      },
    });

    try {
      await expect(
        control.openSession({
          mode: 'fresh',
          cwd: process.cwd(),
          mcpServers: [bridge.acpServer(launch)],
        })
      ).resolves.toBe('session-new');
      await expect(control.prompt('Use only the selected Veritas tools.')).resolves.toEqual({
        stopReason: 'end_turn',
      });
      expect(JSON.parse(messages[0])).toEqual({
        serverCount: 1,
        toolNames: ['get_run_tool_catalog', 'call_run_tool'],
        catalogVisible: true,
        allowed: true,
        denied: true,
        approved: true,
      });
      expect(calls).toEqual([
        {
          serverId: 'veritas',
          tool: 'read_task',
          arguments: { task: 'selected' },
          operationId: 'buzz-read-1',
        },
        {
          serverId: 'veritas',
          tool: 'delete_task',
          arguments: { task: 'unrelated' },
          operationId: 'buzz-denied-1',
        },
        {
          serverId: 'veritas',
          tool: 'update_task',
          arguments: { task: 'selected', status: 'done' },
          operationId: 'buzz-write-1',
          approvalId: 'approval-buzz-write-1',
        },
      ]);
    } finally {
      await control.close();
      await new Promise<void>((resolve, reject) =>
        api.close((error) => (error ? reject(error) : resolve()))
      );
    }
    expect(bridge.revokeRun('task-buzz', 'attempt-buzz')).toBe(1);
    expect(() => bridge.authorize(launch.handle, 'catalog.read')).toThrow(/stale or revoked/);
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
      probeRevision: 14,
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

  it('recognizes the exact Grok Build profile through the generic ACP provider', async () => {
    const agent = {
      type: 'grok-build',
      name: 'Grok Build',
      command: FIXTURE_PATH,
      args: ['--reasoning-effort=high', '--deny=bash(rm)', '--no-memory'],
      enabled: true,
      provider: 'acp-stdio' as const,
      model: 'grok-4.5',
    };
    const supportProfile = normalizeHarnessSupportProfile(agent);
    expect(supportProfile).toMatchObject({
      id: GROK_BUILD_RUNTIME_PROFILE_ID,
      adapterId: 'acp-stdio',
      transport: 'acp',
      authentication: { kind: 'provider-managed', nonMutating: true },
      compatibility: { testedVersions: [`Grok Build ${GROK_BUILD_ACP_VERSION}`] },
      launch: {
        args: [
          '--deny=bash(rm)',
          '--no-memory',
          ...GROK_BUILD_REQUIRED_ARGS,
          '--model=grok-4.5',
          '--reasoning-effort=high',
          'stdio',
        ],
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
          providerVersion: GROK_BUILD_VERSION_OUTPUT,
          providerVersionSource: 'grok --version',
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
      providerVersion: `Grok Build ${GROK_BUILD_ACP_VERSION}`,
      providerBuild: expect.stringMatching(/profile:grok-build@1:sha256:/),
      probeRevision: 14,
      probe: {
        diagnostics: expect.arrayContaining([
          expect.stringContaining(GROK_BUILD_TESTED_RELEASE),
          expect.stringContaining(GROK_BUILD_TESTED_BUILD),
          expect.stringContaining('stable-artifact-reports-alpha-channel'),
        ]),
      },
    });
    expect(manifest.capabilities.find((capability) => capability.id === 'run.resume')?.state).toBe(
      'supported'
    );
  });

  it('uses the safe Grok Build version probe without attempting authentication', async () => {
    const agent = {
      type: 'grok-build',
      name: 'Grok Build',
      command: 'grok',
      args: [],
      enabled: true,
      provider: 'acp-stdio' as const,
    };
    const runCommand = vi.fn(async (command: string, args: string[]) => {
      if (command === 'which') return { stdout: '/usr/local/bin/grok\n', stderr: '' };
      if (command === 'grok' && args.join(' ') === '--version') {
        return { stdout: `${GROK_BUILD_VERSION_OUTPUT}\n`, stderr: '' };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    });
    const health = await new AgentHealthService(runCommand).checkAgent({
      ...agent,
      supportProfile: normalizeHarnessSupportProfile(agent),
    });

    expect(health).toMatchObject({
      executableFound: true,
      providerVersion: GROK_BUILD_VERSION_OUTPUT,
      providerVersionSource: 'grok --version',
      authenticated: null,
      healthy: true,
    });
    expect(runCommand).toHaveBeenCalledTimes(2);
  });

  it('fails Grok Build identity, version, capability, and extension drift closed', async () => {
    for (const mode of [
      'grok-wrong-name',
      'grok-wrong-version',
      'grok-wrong-capabilities',
      'grok-wrong-extension',
    ]) {
      await expect(
        probeAcpStdioRuntime({
          ...options(mode),
          runtimeProfileId: GROK_BUILD_RUNTIME_PROFILE_ID,
        })
      ).rejects.toThrow(/outside the tested compatibility profile/i);
    }
  });

  it('fails an untested Grok Build executable version before ACP launch', async () => {
    const service = new ClawdbotAgentService({
      async checkAgent() {
        return {
          type: 'grok-build',
          name: 'Grok Build',
          enabled: true,
          configured: true,
          command: FIXTURE_PATH,
          executableFound: true,
          executablePath: FIXTURE_PATH,
          providerVersion: 'grok 0.2.110 (older) [stable]',
          providerVersionSource: 'grok --version',
          authenticated: null,
          healthy: true,
          checkedAt: '2026-07-24T12:00:00.000Z',
        };
      },
    });

    await expect(
      service.probeProviderRuntime({
        type: 'grok-build',
        name: 'Grok Build',
        command: FIXTURE_PATH,
        args: [],
        enabled: true,
        provider: 'acp-stdio',
      })
    ).rejects.toThrow(/outside the tested compatibility profile/i);
  });

  it('compiles only tested Grok Build process and restrictive policy arguments', () => {
    expect(
      buildGrokBuildAcpArgs({
        model: 'grok-4.5',
        extraArgs: [
          '--effort',
          'medium',
          '--deny=bash(rm)',
          '--disable-web-search',
          '--disallowed-tools=web_fetch',
          '--no-memory',
          '--no-subagents',
          '--sandbox=workspace',
          '--tools=view,bash',
        ],
      })
    ).toEqual([
      '--deny=bash(rm)',
      '--disable-web-search',
      '--disallowed-tools=web_fetch',
      '--no-memory',
      '--no-subagents',
      '--sandbox=workspace',
      '--tools=view,bash',
      ...GROK_BUILD_REQUIRED_ARGS,
      '--model=grok-4.5',
      '--reasoning-effort=medium',
      'stdio',
    ]);

    for (const argument of [
      '--always-approve',
      '--permission-mode=bypassPermissions',
      '--allow=bash',
      '--reauth',
      '--agent-profile=/tmp/profile',
      '--plugin-dir=/tmp/plugin',
      '--leader',
      '--grok-ws-url=wss://example.invalid',
      '--resume=session',
      '--rules=ignore Veritas',
      '--sandbox=off',
      '--sandbox=custom-profile',
    ]) {
      expect(() => buildGrokBuildAcpArgs({ extraArgs: [argument] })).toThrow(
        /not governed by Veritas|outside the tested profile/i
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
    expect(state('credential.broker')).toBe('supported');
  });

  it('reports the shared bridge capabilities for every supported executable adapter', () => {
    for (const provider of [
      'codex-cli',
      'codex-sdk',
      'codex-app-server',
      'claude-code',
      'acp-stdio',
    ] as const) {
      const capabilities = getProviderRuntimeAdapterDefinition(provider).capabilities;
      expect(capabilities.find((item) => item.id === 'tool.mcp')?.state, provider).toBe(
        'supported'
      );
      expect(capabilities.find((item) => item.id === 'credential.broker')?.state, provider).toBe(
        'supported'
      );
    }
  });
});

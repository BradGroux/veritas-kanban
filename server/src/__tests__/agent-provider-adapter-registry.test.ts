import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { EXECUTABLE_AGENT_PROVIDERS, type ExecutableAgentProvider } from '@veritas-kanban/shared';
import {
  AgentProviderAdapterRegistry,
  type AgentProviderAdapterHost,
  type AgentProviderStartContext,
} from '../services/agent-provider-adapter-registry.js';
import { providerRuntimeManifestFixture } from './fixtures/provider-runtime-manifest.js';

const RENDERER_NAMES: Record<ExecutableAgentProvider, string> = {
  'codex-cli': 'renderCodexCliTaskEnvelope',
  'codex-sdk': 'renderCodexSdkTaskEnvelope',
  'codex-app-server': 'renderCodexAppServerTaskEnvelope',
  'acp-stdio': 'renderAcpStdioTaskEnvelope',
  'claude-code': 'renderClaudeCodeTaskEnvelope',
  'hermes-cli': 'renderHermesTaskEnvelope',
  openclaw: 'renderOpenClawTaskEnvelope',
};

function createHost(): AgentProviderAdapterHost {
  return {
    probe: vi.fn(async (provider) =>
      providerRuntimeManifestFixture({ provider, adapter: provider })
    ),
    probeAcp: vi.fn(async () =>
      providerRuntimeManifestFixture({ provider: 'acp-stdio', adapter: 'acp-stdio' })
    ),
    assertTransport: vi.fn(),
    getPending: vi.fn(),
    startCodexCli: vi.fn(async () => undefined),
    startCodexSdk: vi.fn(async () => undefined),
    handleCodexSdkError: vi.fn(async () => undefined),
    startCodexAppServer: vi.fn(async () => undefined),
    startAcpStdio: vi.fn(async () => undefined),
    startClaudeCode: vi.fn(async () => undefined),
    startHermesCli: vi.fn(async () => undefined),
    startOpenClaw: vi.fn(async () => undefined),
    warn: vi.fn(),
  };
}

function startContext(provider: ExecutableAgentProvider): AgentProviderStartContext {
  return {
    task: { id: 'task_provider_registry' },
    transport: {
      schemaVersion: 'provider-task-envelope-transport/v1',
      provider,
      taskEnvelopeDigest: 'task-envelope-digest',
      callbackPosture: provider === 'openclaw' ? 'veritas-http' : 'harness-owned',
      completionNormalization: 'harness',
      content: 'Run the task.',
    },
    logPath: '/tmp/provider-registry.log',
    attemptId: 'attempt_provider_registry',
    startedAt: '2026-08-24T06:00:00.000Z',
    emitter: new EventEmitter(),
    attempt: { id: 'attempt_provider_registry', status: 'running', agent: 'codex' },
    runLaunchManifest: { digest: 'run-launch-digest' },
    conversation: {
      schemaVersion: 'conversation-lifecycle/v1',
      mode: 'fresh',
      intent: 'fresh',
      state: 'active',
      contextWindow: { posture: 'unknown', measuredAt: '2026-08-24T06:00:00.000Z' },
      createdAt: '2026-08-24T06:00:00.000Z',
      updatedAt: '2026-08-24T06:00:00.000Z',
    },
    admission: {
      schemaVersion: 'provider-admission-evidence/v1',
      source: 'direct',
      outcome: 'admitted',
      reservationId: 'reservation_provider_registry',
      executionTree: {
        rootObjectiveId: 'objective_provider_registry',
        nodeId: 'node_provider_registry',
        depth: 0,
        edge: 'root',
      },
    },
  } as AgentProviderStartContext;
}

describe('AgentProviderAdapterRegistry', () => {
  it('resolves every executable provider without an implicit fallback', async () => {
    const host = createHost();
    const registry = new AgentProviderAdapterRegistry(host);

    for (const provider of EXECUTABLE_AGENT_PROVIDERS) {
      const adapter = registry.resolve(provider);

      expect(adapter.id).toBe(provider);
      expect(adapter.renderTaskEnvelope.name).toBe(RENDERER_NAMES[provider]);
      expect(adapter.runEventMapper.mapEvent).toEqual(expect.any(Function));
      await expect(
        adapter.probe({
          health: {
            type: provider,
            name: provider,
            enabled: true,
            configured: true,
            command: provider,
            executableFound: true,
            authenticated: true,
            healthy: true,
            checkedAt: '2026-08-24T06:00:00.000Z',
          },
        })
      ).resolves.toMatchObject({ provider, adapter: provider });
    }

    expect(host.probeAcp).toHaveBeenCalledOnce();
    expect(host.probe).toHaveBeenCalledTimes(EXECUTABLE_AGENT_PROVIDERS.length - 1);
  });

  it('dispatches starts through the exact provider operation', async () => {
    const host = createHost();
    const registry = new AgentProviderAdapterRegistry(host);
    const startOperations: Record<ExecutableAgentProvider, ReturnType<typeof vi.fn>> = {
      'codex-cli': host.startCodexCli,
      'codex-sdk': host.startCodexSdk,
      'codex-app-server': host.startCodexAppServer,
      'acp-stdio': host.startAcpStdio,
      'claude-code': host.startClaudeCode,
      'hermes-cli': host.startHermesCli,
      openclaw: host.startOpenClaw,
    };

    for (const provider of EXECUTABLE_AGENT_PROVIDERS) {
      await registry.resolve(provider).start(startContext(provider));
      expect(startOperations[provider]).toHaveBeenCalledOnce();
    }

    expect(host.assertTransport).toHaveBeenCalledTimes(EXECUTABLE_AGENT_PROVIDERS.length);
  });

  it('keeps stop behavior behind the adapter seam', async () => {
    const host = createHost();
    const registry = new AgentProviderAdapterRegistry(host);
    const abortController = new AbortController();
    const cancel = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);

    await registry.resolve('codex-sdk').stop({
      taskId: 'task_provider_registry',
      pending: {
        taskId: 'task_provider_registry',
        attemptId: 'attempt_provider_registry',
        abortController,
      },
    });
    await registry.resolve('acp-stdio').stop({
      taskId: 'task_provider_registry',
      pending: {
        taskId: 'task_provider_registry',
        attemptId: 'attempt_provider_registry',
        acpControl: { cancel, close },
      },
    });
    await registry.resolve('openclaw').stop({
      taskId: 'task_provider_registry',
      pending: {
        taskId: 'task_provider_registry',
        attemptId: 'attempt_provider_registry',
        openclawSessionKey: 'session_provider_registry',
      },
    });

    expect(abortController.signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(host.warn).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: 'session_provider_registry' }),
      expect.stringContaining('OpenClaw stop requested')
    );
  });
});

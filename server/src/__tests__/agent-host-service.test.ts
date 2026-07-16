import { describe, expect, it } from 'vitest';
import { AgentHostService } from '../services/agent-host-service';
import type { RegisteredAgent } from '../services/agent-registry-service';
import { providerRuntimeManifestFixture } from './fixtures/provider-runtime-manifest.js';

function agent(
  id: string,
  overrides: Partial<RegisteredAgent> = {},
  metadata: Record<string, unknown> = {}
): RegisteredAgent {
  return {
    id,
    name: id,
    model: 'gpt-5',
    provider: 'codex-cli',
    capabilities: [{ name: 'code' }],
    providerRuntimeManifest: providerRuntimeManifestFixture(),
    status: 'idle',
    registeredAt: '2026-06-01T12:00:00.000Z',
    lastHeartbeat: '2026-06-01T12:00:00.000Z',
    metadata: {
      hostId: `host-${id}`,
      hostName: `${id} host`,
      authState: 'authenticated',
      workspaceRoots: ['/Users/bradgroux/Projects/veritas-kanban'],
      maxQueueDepth: 2,
      ...metadata,
    },
    ...overrides,
  };
}

function serviceFor(agents: RegisteredAgent[]): AgentHostService {
  return new AgentHostService({
    list: () => agents,
  });
}

describe('AgentHostService', () => {
  const now = new Date('2026-06-01T12:05:00.000Z');

  it('derives public host health without exposing raw workspace roots', () => {
    const service = serviceFor([agent('codex')]);

    const health = service.getHealth(now);

    expect(health.summary.connected).toBe(1);
    expect(health.hosts[0]).toMatchObject({
      id: 'host-codex',
      name: 'codex host',
      posture: 'connected',
      workspaceLabels: ['workspace:veritas-kanban'],
    });
    expect(health.hosts[0].sandboxCapabilities).toEqual([
      'environment.allowlist',
      'filesystem.read',
      'filesystem.write',
    ]);
    expect(health.hosts[0].sandboxCapabilities).not.toContain('network.disable');
    expect(JSON.stringify(health.hosts)).not.toContain('/Users/bradgroux');
  });

  it('selects the first connected compatible host and excludes stale, overloaded, and incompatible hosts', () => {
    const service = serviceFor([
      agent('codex', {}, { hostId: 'host-a', hostName: 'A Host' }),
      agent(
        'stale-codex',
        { lastHeartbeat: '2026-06-01T11:40:00.000Z' },
        { hostId: 'host-b', hostName: 'B Host', supportedAgents: ['codex'] }
      ),
      agent(
        'busy-codex',
        { status: 'busy' },
        { hostId: 'host-c', hostName: 'C Host', supportedAgents: ['codex'], maxQueueDepth: 1 }
      ),
      agent(
        'other',
        {
          provider: 'openclaw',
          model: 'other-model',
          providerRuntimeManifest: providerRuntimeManifestFixture({
            provider: 'openclaw',
            models: ['other-model'],
          }),
        },
        { hostId: 'host-d', hostName: 'D Host', supportedAgents: ['other'] }
      ),
    ]);

    const preview = service.preview(
      {
        agent: 'codex',
        provider: 'codex-cli',
        model: 'gpt-5',
        workspacePath: '/Users/bradgroux/Projects/veritas-kanban/server',
        requiredTools: ['tool.calls'],
      },
      now
    );

    expect(preview.decision).toMatchObject({
      policy: 'first-capable-healthy',
      selectedHostId: 'host-a',
    });
    expect(preview.decision.excludedHostIds).toHaveLength(3);
    expect(preview.decision.excludedHostIds).toEqual(
      expect.arrayContaining(['host-b', 'host-c', 'host-d'])
    );
    expect(preview.previews.find((item) => item.hostId === 'host-c')?.reasons).toContain(
      'Host posture is degraded.'
    );
    expect(preview.previews.find((item) => item.hostId === 'host-d')?.reasons).toContain(
      'Provider "codex-cli" is not registered on this host.'
    );
  });

  it('does not select an incompatible manual host', () => {
    const service = serviceFor([
      agent(
        'codex',
        { lastHeartbeat: '2026-06-01T11:40:00.000Z' },
        { hostId: 'host-stale', hostName: 'Stale Host' }
      ),
    ]);

    const preview = service.preview({ agent: 'codex', manualHostId: 'host-stale' }, now);

    expect(preview.decision.policy).toBe('manual');
    expect(preview.decision.selectedHostId).toBeUndefined();
    expect(preview.decision.reason).toContain('not compatible');
  });

  it('marks hosts without sandbox capability signals incompatible when a preset is requested', () => {
    const service = serviceFor([
      agent(
        'custom',
        { provider: 'custom', providerRuntimeManifest: undefined },
        { hostId: 'host-custom', hostName: 'Custom Host', providers: ['custom'] }
      ),
    ]);

    const preview = service.preview(
      {
        agent: 'custom',
        provider: 'custom',
        sandboxPresetId: 'codex-repo-contained',
      },
      now
    );

    expect(preview.decision.selectedHostId).toBeUndefined();
    expect(preview.decision.excludedHostIds).toContain('host-custom');
    expect(preview.previews[0].checks.find((check) => check.id === 'sandbox-policy')).toMatchObject(
      {
        passed: false,
        detail:
          'Sandbox preset codex-repo-contained cannot qualify a host until its required controls are resolved into requiredRuntimeCapabilities.',
      }
    );
  });

  it('does not let another manifest or a single sandbox signal qualify an unresolved preset', () => {
    const service = serviceFor([
      agent(
        'codex',
        {
          providerRuntimeManifest: providerRuntimeManifestFixture({
            capabilityStates: { 'filesystem.read': 'unsupported' },
          }),
        },
        { hostId: 'shared-host' }
      ),
      agent(
        'other',
        {
          providerRuntimeManifest: providerRuntimeManifestFixture({
            provider: 'other-provider',
            capabilityStates: { 'filesystem.read': 'supported' },
          }),
        },
        { hostId: 'shared-host' }
      ),
    ]);

    const preview = service.preview(
      { agent: 'codex', sandboxPresetId: 'codex-repo-contained' },
      now
    );

    expect(preview.previews[0]?.runtimeSelection?.selectedManifest?.provider).toBe('codex-cli');
    expect(preview.previews[0]?.checks.find((check) => check.id === 'sandbox-policy')?.passed).toBe(
      false
    );
    expect(preview.decision.selectedHostId).toBeUndefined();
  });

  it('uses a custom provider manifest without a central provider branch', () => {
    const service = serviceFor([
      agent('custom', {
        provider: 'custom-runtime',
        model: 'custom-model',
        providerRuntimeManifest: providerRuntimeManifestFixture({
          provider: 'custom-runtime',
          models: ['custom-model'],
          capabilityStates: { 'run.resume': 'supported' },
        }),
      }),
    ]);

    const preview = service.preview(
      {
        agent: 'custom',
        provider: 'custom-runtime',
        model: 'custom-model',
        requiredRuntimeCapabilities: ['run.resume'],
      },
      now
    );

    expect(preview.decision.selectedHostId).toBe('host-custom');
    expect(preview.previews[0]?.runtimeSelection?.selectedManifest?.provider).toBe(
      'custom-runtime'
    );
  });

  it('does not compose provider, model, or tool requirements across manifests', () => {
    const service = serviceFor([
      agent(
        'provider-a',
        {
          providerRuntimeManifest: providerRuntimeManifestFixture({
            provider: 'provider-a',
            models: ['model-a'],
            capabilityStates: { 'tool.mcp': 'unsupported' },
          }),
        },
        { hostId: 'shared-host' }
      ),
      agent(
        'provider-b',
        {
          providerRuntimeManifest: providerRuntimeManifestFixture({
            provider: 'provider-b',
            models: ['model-b'],
            capabilityStates: { 'tool.mcp': 'supported' },
          }),
        },
        { hostId: 'shared-host' }
      ),
    ]);

    const providerModelPreview = service.preview({ provider: 'provider-a', model: 'model-b' }, now);
    const providerToolPreview = service.preview(
      { provider: 'provider-a', requiredTools: ['tool.mcp'] },
      now
    );

    expect(providerModelPreview.decision.selectedHostId).toBeUndefined();
    expect(providerModelPreview.previews[0]?.runtimeSelection?.compatible).toBe(false);
    expect(providerToolPreview.decision.selectedHostId).toBeUndefined();
    expect(providerToolPreview.previews[0]?.runtimeSelection?.compatible).toBe(false);
  });

  it('accepts advisory tool capability evidence with a warning', () => {
    const service = serviceFor([
      agent('codex', {
        providerRuntimeManifest: providerRuntimeManifestFixture({
          capabilityStates: { 'tool.mcp': 'advisory' },
        }),
      }),
    ]);

    const preview = service.preview({ agent: 'codex', requiredTools: ['tool.mcp'] }, now);

    expect(preview.decision.selectedHostId).toBe('host-codex');
    expect(preview.previews[0]?.warnings).toContain(
      'Required runtime capabilities have advisory evidence: tool.mcp.'
    );
  });

  it('normalizes tool capability requirements before manifest evaluation', () => {
    const service = serviceFor([
      agent('codex', {
        providerRuntimeManifest: providerRuntimeManifestFixture({
          capabilityStates: { 'tool.mcp': 'unsupported' },
        }),
      }),
    ]);

    const preview = service.preview({ agent: 'codex', requiredTools: [' tool.mcp '] }, now);

    expect(preview.request.requiredTools).toEqual(['tool.mcp']);
    expect(preview.previews[0]?.runtimeSelection?.requiredCapabilities).toEqual(['tool.mcp']);
    expect(preview.previews[0]?.runtimeSelection?.compatible).toBe(false);
    expect(preview.decision.selectedHostId).toBeUndefined();
  });

  it('does not let legacy named tools qualify a host', () => {
    const service = serviceFor([
      agent(
        'legacy',
        { providerRuntimeManifest: undefined },
        { hostId: 'legacy-host', tools: ['code'] }
      ),
    ]);

    const preview = service.preview({ agent: 'legacy', requiredTools: ['code'] }, now);

    expect(preview.decision.selectedHostId).toBeUndefined();
    expect(preview.previews[0]?.reasons).toContain(
      'Legacy named tool requirements cannot qualify host runtime posture: code. Use requiredRuntimeCapabilities with a tool.* identifier.'
    );
  });

  it('does not let an offline sibling lend runtime evidence to a live host', () => {
    const service = serviceFor([
      agent(
        'live',
        { providerRuntimeManifest: undefined },
        { hostId: 'shared-host', hostName: 'Shared Host' }
      ),
      agent('offline', { status: 'offline' }, { hostId: 'shared-host', hostName: 'Shared Host' }),
    ]);

    const preview = service.preview(
      { provider: 'codex-cli', requiredRuntimeCapabilities: ['run.start'] },
      now
    );

    expect(preview.previews[0]?.posture).toBe('connected');
    expect(preview.previews[0]?.runtimeSelection?.candidates).toHaveLength(0);
    expect(preview.previews[0]?.warnings).toContain(
      'Runtime manifest from agent offline was excluded because its registration is offline or outside the five-minute heartbeat window.'
    );
    expect(preview.decision.selectedHostId).toBeUndefined();
  });

  it('allows advisory runtime evidence with a concrete warning', () => {
    const service = serviceFor([
      agent('codex', {
        providerRuntimeManifest: providerRuntimeManifestFixture({
          capabilityStates: { 'run.resume': 'advisory' },
        }),
      }),
    ]);

    const preview = service.preview(
      { agent: 'codex', requiredRuntimeCapabilities: ['run.resume'] },
      now
    );

    expect(preview.decision.selectedHostId).toBe('host-codex');
    expect(preview.previews[0]?.warnings).toContain(
      'Required runtime capabilities have advisory evidence: run.resume.'
    );
  });

  it.each(['unsupported', 'unknown'] as const)(
    'rejects %s required runtime capability evidence',
    (state) => {
      const service = serviceFor([
        agent('codex', {
          providerRuntimeManifest: providerRuntimeManifestFixture({
            capabilityStates: { 'run.resume': state },
          }),
        }),
      ]);

      const preview = service.preview(
        { agent: 'codex', requiredRuntimeCapabilities: ['run.resume'] },
        now
      );

      expect(preview.decision.selectedHostId).toBeUndefined();
      expect(preview.previews[0]?.runtimeSelection?.candidates[0]?.capabilities[0]).toMatchObject({
        state,
        satisfied: false,
      });
    }
  );

  it('keeps legacy posture visible without letting it satisfy runtime requirements', () => {
    const service = serviceFor([
      agent(
        'legacy',
        { provider: 'custom', model: 'legacy-model', providerRuntimeManifest: undefined },
        {
          providers: ['custom'],
          models: ['legacy-model'],
          tools: ['tool.calls'],
          sandboxCapabilities: ['filesystem.write'],
        }
      ),
    ]);

    const health = service.getHealth(now);
    const preview = service.preview(
      {
        agent: 'legacy',
        provider: 'custom',
        model: 'legacy-model',
        requiredRuntimeCapabilities: ['tool.calls'],
      },
      now
    );

    expect(health.hosts[0]).toMatchObject({
      supportedProviders: [],
      supportedModels: [],
      supportedTools: [],
      legacyRuntimePosture: {
        providers: ['custom'],
        models: ['legacy-model'],
        tools: expect.arrayContaining(['code', 'tool.calls']),
      },
    });
    expect(preview.decision.selectedHostId).toBeUndefined();
  });

  it('disables auto-routing when no host is registered', () => {
    const service = serviceFor([]);

    const preview = service.preview({ agent: 'codex' }, now);

    expect(preview.decision).toMatchObject({
      policy: 'disabled',
      reason: 'No agent hosts are registered.',
    });
  });
});

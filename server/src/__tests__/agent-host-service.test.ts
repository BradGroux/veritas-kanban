import { describe, expect, it } from 'vitest';
import { AgentHostService } from '../services/agent-host-service';
import type { RegisteredAgent } from '../services/agent-registry-service';

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
        { provider: 'openclaw', model: 'other-model' },
        { hostId: 'host-d', hostName: 'D Host', supportedAgents: ['other'] }
      ),
    ]);

    const preview = service.preview(
      {
        agent: 'codex',
        provider: 'codex-cli',
        model: 'gpt-5',
        workspacePath: '/Users/bradgroux/Projects/veritas-kanban/server',
        requiredTools: ['code'],
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

  it('disables auto-routing when no host is registered', () => {
    const service = serviceFor([]);

    const preview = service.preview({ agent: 'codex' }, now);

    expect(preview.decision).toMatchObject({
      policy: 'disabled',
      reason: 'No agent hosts are registered.',
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRoutingService } from '../services/agent-routing-service';
import {
  DEFAULT_ROUTING_CONFIG,
  type AgentConfig,
  type AgentRoutingConfig,
  type AppConfig,
} from '@veritas-kanban/shared';
import type { AgentHealthStatus } from '../services/agent-health-service';
import type { RegisteredAgent } from '../services/agent-registry-service.js';
import { providerRuntimeManifestFixture } from './fixtures/provider-runtime-manifest.js';

// Mock ConfigService
const mockGetConfig = vi.fn();
const mockSaveConfig = vi.fn();
const mockCheckAgent = vi.fn();

vi.mock('../services/config-service.js', () => {
  return {
    ConfigService: class MockConfigService {
      getConfig = mockGetConfig;
      saveConfig = mockSaveConfig;
    },
  };
});

const BASE_CONFIG: AppConfig = {
  repos: [],
  agents: [
    { type: 'claude-code', name: 'Claude Code', command: 'claude', args: [], enabled: true },
    { type: 'amp', name: 'Amp', command: 'amp', args: [], enabled: true },
    { type: 'copilot', name: 'GitHub Copilot', command: 'copilot', args: [], enabled: true },
    { type: 'gemini', name: 'Gemini CLI', command: 'gemini', args: [], enabled: false },
  ],
  defaultAgent: 'claude-code',
  agentRouting: {
    enabled: true,
    rules: [
      {
        id: 'code-high',
        name: 'High-priority code',
        match: { type: 'code', priority: 'high' },
        agent: 'claude-code',
        model: 'opus',
        fallback: 'amp',
        enabled: true,
      },
      {
        id: 'code-default',
        name: 'Code tasks',
        match: { type: 'code' },
        agent: 'claude-code',
        model: 'sonnet',
        fallback: 'copilot',
        enabled: true,
      },
      {
        id: 'docs',
        name: 'Documentation',
        match: { type: 'docs' },
        agent: 'claude-code',
        model: 'haiku',
        enabled: true,
      },
      {
        id: 'disabled-rule',
        name: 'Disabled rule',
        match: { type: 'feature' },
        agent: 'amp',
        enabled: false,
      },
    ],
    defaultAgent: 'claude-code',
    defaultModel: 'sonnet',
    fallbackOnFailure: true,
    maxRetries: 1,
  },
};

function healthyAgent(agent: AgentConfig): AgentHealthStatus {
  return {
    type: agent.type,
    name: agent.name,
    enabled: agent.enabled,
    configured: true,
    command: agent.command,
    executableFound: true,
    executablePath: `/usr/local/bin/${agent.command}`,
    authenticated: null,
    healthy: agent.enabled,
    checkedAt: '2026-06-03T00:00:00.000Z',
    reason: agent.enabled ? undefined : 'Agent is disabled',
  };
}

function unhealthyAgent(agent: AgentConfig, reason: string): AgentHealthStatus {
  return {
    ...healthyAgent(agent),
    executableFound: !reason.includes('Executable'),
    authenticated: reason.includes('Authentication') ? false : null,
    healthy: false,
    reason,
  };
}

function requireRouting(config: AppConfig): AgentRoutingConfig {
  if (!config.agentRouting) throw new Error('Expected routing config in test fixture');
  return config.agentRouting;
}

function requireAgent(config: AppConfig, type: string): AgentConfig {
  const agent = config.agents.find((candidate) => candidate.type === type);
  if (!agent) throw new Error(`Expected ${type} agent in test fixture`);
  return agent;
}

function requireFallbackResult(
  result: Awaited<ReturnType<AgentRoutingService['getFallback']>>
): NonNullable<typeof result> {
  expect(result).not.toBeNull();
  if (!result) throw new Error('Expected fallback result');
  return result;
}

function registeredAgent(
  id: string,
  providerRuntimeManifest = providerRuntimeManifestFixture()
): RegisteredAgent {
  return {
    id,
    name: id,
    capabilities: [],
    providerRuntimeManifest,
    status: 'idle',
    registeredAt: '2026-07-15T12:00:00.000Z',
    lastHeartbeat: new Date().toISOString(),
  };
}

describe('AgentRoutingService', () => {
  let service: AgentRoutingService;

  beforeEach(() => {
    mockGetConfig.mockResolvedValue(structuredClone(BASE_CONFIG));
    mockSaveConfig.mockResolvedValue(undefined);
    mockCheckAgent.mockImplementation(async (agent: AgentConfig) => healthyAgent(agent));
    service = new AgentRoutingService(undefined, { checkAgent: mockCheckAgent });
  });

  describe('resolveAgent', () => {
    it('routes default built-in rules to Codex first', async () => {
      const config: AppConfig = {
        ...structuredClone(BASE_CONFIG),
        agents: [
          { type: 'codex', name: 'OpenAI Codex', command: 'codex', args: [], enabled: true },
          { type: 'claude-code', name: 'Claude Code', command: 'claude', args: [], enabled: false },
          { type: 'amp', name: 'Amp', command: 'amp', args: [], enabled: false },
        ],
        defaultAgent: 'codex',
        agentRouting: structuredClone(DEFAULT_ROUTING_CONFIG),
      };
      mockGetConfig.mockResolvedValue(config);

      const result = await service.resolveAgent({
        type: 'code',
        priority: 'high',
      });

      expect(result.agent).toBe('codex');
      expect(result.fallback).toBe('claude-code');
      expect(result.rule).toBe('code-high');
    });

    it('matches high-priority code task to first rule', async () => {
      const result = await service.resolveAgent({
        type: 'code',
        priority: 'high',
      });

      expect(result.agent).toBe('claude-code');
      expect(result.model).toBe('opus');
      expect(result.fallback).toBe('amp');
      expect(result.rule).toBe('code-high');
      expect(result.reason).toContain('High-priority code');
    });

    it('routes to a manifest that supports every required runtime capability', async () => {
      service = new AgentRoutingService(
        undefined,
        { checkAgent: mockCheckAgent },
        {
          list: () => [
            registeredAgent(
              'claude-code',
              providerRuntimeManifestFixture({
                models: ['opus'],
                capabilityStates: { 'run.resume': 'supported' },
              })
            ),
          ],
        }
      );

      const result = await service.resolveAgentWithTrace(
        { type: 'code', priority: 'high' },
        { requiredRuntimeCapabilities: ['run.start', 'run.resume'] }
      );

      expect(result.result.agent).toBe('claude-code');
      expect(result.result.runtimeSelection).toMatchObject({
        compatible: true,
        selectedManifest: { advisory: false },
      });
    });

    it('routes with a warning when the only matching evidence is advisory', async () => {
      service = new AgentRoutingService(
        undefined,
        { checkAgent: mockCheckAgent },
        {
          list: () => [
            registeredAgent(
              'claude-code',
              providerRuntimeManifestFixture({
                models: ['opus'],
                capabilityStates: { 'run.resume': 'advisory' },
              })
            ),
          ],
        }
      );

      const result = await service.resolveAgentWithTrace(
        { type: 'code', priority: 'high' },
        { requiredRuntimeCapabilities: ['run.resume'] }
      );

      expect(result.result.agent).toBe('claude-code');
      expect(result.result.runtimeSelection?.selectedManifest?.advisory).toBe(true);
      expect(result.result.reason).toContain('advisory capability evidence');
    });

    it('rejects an unsupported primary and selects a capable fallback', async () => {
      service = new AgentRoutingService(
        undefined,
        { checkAgent: mockCheckAgent },
        {
          list: () => [
            registeredAgent(
              'claude-code',
              providerRuntimeManifestFixture({
                models: ['opus'],
                capabilityStates: { 'run.resume': 'unsupported' },
              })
            ),
            registeredAgent(
              'amp',
              providerRuntimeManifestFixture({
                provider: 'custom-amp',
                capabilityStates: { 'run.resume': 'supported' },
              })
            ),
          ],
        }
      );

      const result = await service.resolveAgentWithTrace(
        { type: 'code', priority: 'high' },
        { requiredRuntimeCapabilities: ['run.resume'] }
      );

      expect(result.result.agent).toBe('amp');
      expect(result.result.reason).toContain('unavailable');
      expect(result.result.runtimeSelection?.compatible).toBe(true);
      expect(result.result.runtimeCandidates).toHaveLength(2);
      expect(result.result.runtimeCandidates).toEqual([
        expect.objectContaining({ agent: 'claude-code', available: false, selected: false }),
        expect.objectContaining({ agent: 'amp', available: true, selected: true }),
      ]);
    });

    it('routes a directly registered concrete custom manifest for a custom provider category', async () => {
      const config = structuredClone(BASE_CONFIG);
      const claude = requireAgent(config, 'claude-code');
      claude.provider = 'custom';
      mockGetConfig.mockResolvedValue(config);
      service = new AgentRoutingService(
        undefined,
        { checkAgent: mockCheckAgent },
        {
          list: () => [
            registeredAgent(
              'claude-code',
              providerRuntimeManifestFixture({
                provider: 'custom-runtime',
                models: ['opus'],
                capabilityStates: { 'run.resume': 'supported' },
              })
            ),
          ],
        }
      );

      const result = await service.resolveAgentWithTrace(
        { type: 'code', priority: 'high' },
        { requiredRuntimeCapabilities: ['run.resume'] }
      );

      expect(result.result.agent).toBe('claude-code');
      expect(result.result.runtimeSelection?.selectedManifest?.provider).toBe('custom-runtime');
    });

    it('does not borrow runtime evidence from another agent sharing a provider', async () => {
      const config = structuredClone(BASE_CONFIG);
      requireAgent(config, 'claude-code').provider = 'codex-cli';
      mockGetConfig.mockResolvedValue(config);
      service = new AgentRoutingService(
        undefined,
        { checkAgent: mockCheckAgent },
        {
          list: () => [
            registeredAgent(
              'unrelated-agent',
              providerRuntimeManifestFixture({
                provider: 'codex-cli',
                models: ['opus'],
                capabilityStates: { 'run.resume': 'supported' },
              })
            ),
          ],
        }
      );

      const error = (await service
        .resolveAgentWithTrace(
          { type: 'code', priority: 'high' },
          { requiredRuntimeCapabilities: ['run.resume'] }
        )
        .catch((caught: unknown) => caught)) as {
        statusCode: number;
        details: {
          runtimeCandidates: Array<{ selected: boolean; selection: { compatible: boolean } }>;
        };
      };

      expect(error.statusCode).toBe(409);
      expect(error.details.runtimeCandidates.length).toBeGreaterThan(0);
      expect(error.details.runtimeCandidates.every((candidate) => !candidate.selected)).toBe(true);
      expect(
        error.details.runtimeCandidates.every((candidate) => !candidate.selection.compatible)
      ).toBe(true);
    });

    it('fails closed on ambiguous name matches and stale registrations', async () => {
      const duplicateName = 'Claude Code';
      const stale = registeredAgent('claude-code');
      stale.lastHeartbeat = '2026-01-01T00:00:00.000Z';
      service = new AgentRoutingService(
        undefined,
        { checkAgent: mockCheckAgent },
        {
          list: () => [
            stale,
            { ...registeredAgent('duplicate-a'), name: duplicateName },
            { ...registeredAgent('duplicate-b'), name: duplicateName },
          ],
        }
      );

      await expect(
        service.resolveAgentWithTrace(
          { type: 'code', priority: 'high' },
          { requiredRuntimeCapabilities: ['run.start'] }
        )
      ).rejects.toMatchObject({
        statusCode: 409,
        details: expect.objectContaining({
          runtimeCandidates: expect.arrayContaining([
            expect.objectContaining({
              reason:
                'Registered agent "claude-code" is offline or outside the five-minute heartbeat window.',
            }),
          ]),
        }),
      });
    });

    it('fails closed when no candidate has a registered runtime manifest', async () => {
      service = new AgentRoutingService(
        undefined,
        { checkAgent: mockCheckAgent },
        { list: () => [] }
      );

      const error = (await service
        .resolveAgentWithTrace(
          { type: 'code', priority: 'high' },
          { requiredRuntimeCapabilities: ['run.resume'] }
        )
        .catch((caught: unknown) => caught)) as {
        statusCode: number;
        details: {
          reason: string;
          runtimeCandidates: Array<{ selected: boolean }>;
        };
      };

      expect(error.statusCode).toBe(409);
      expect(error.details.reason).toBe(
        'No registry identity matches configured agent "claude-code".'
      );
      expect(error.details.runtimeCandidates.every((candidate) => !candidate.selected)).toBe(true);
    });

    it('returns a governance trace with evaluated and matched routing rules', async () => {
      const result = await service.resolveAgentWithTrace(
        {
          type: 'code',
          priority: 'high',
          project: 'core',
        },
        { taskId: 'task_1' }
      );

      expect(result.result.rule).toBe('code-high');
      expect(result.trace).toMatchObject({
        kind: 'routing',
        outcome: 'routed',
        subject: {
          agentId: 'claude-code',
          taskId: 'task_1',
          actionType: 'agent.route',
          project: 'core',
        },
      });
      expect(result.trace.evaluatedRules?.map((rule) => rule.id)).toContain('routing:code-high');
      expect(result.trace.matchedRules?.map((rule) => rule.id)).toEqual(['routing:code-high']);
    });

    it('uses the enabled team roster before legacy routing rules', async () => {
      mockGetConfig.mockResolvedValue({
        ...structuredClone(BASE_CONFIG),
        teamRoster: {
          id: 'core-team',
          schemaVersion: 'team-roster/v1',
          workspaceId: 'local',
          name: 'Core Team',
          enabled: true,
          members: [
            {
              id: 'ops-lead',
              displayName: 'Ops Lead',
              role: 'Coordinates high-risk work',
              agent: 'amp',
              status: 'enabled',
              capabilities: ['ops'],
              defaultTaskTypes: ['code'],
            },
          ],
          routingRules: [
            {
              id: 'high-code',
              name: 'High-priority code owner',
              enabled: true,
              match: { type: 'code', priority: 'high' },
              memberId: 'ops-lead',
            },
          ],
        },
      });

      const result = await service.resolveAgentWithTrace({
        type: 'code',
        priority: 'high',
      });

      expect(result.result.agent).toBe('amp');
      expect(result.result.rule).toBe('team-roster:high-code');
      expect(result.trace.matchedRules?.[0]?.id).toBe('team-roster:high-code');
    });

    it('matches medium-priority code task to second rule', async () => {
      const result = await service.resolveAgent({
        type: 'code',
        priority: 'medium',
      });

      expect(result.agent).toBe('claude-code');
      expect(result.model).toBe('sonnet');
      expect(result.fallback).toBe('copilot');
      expect(result.rule).toBe('code-default');
    });

    it('matches docs to docs rule', async () => {
      const result = await service.resolveAgent({
        type: 'docs',
        priority: 'low',
      });

      expect(result.agent).toBe('claude-code');
      expect(result.model).toBe('haiku');
      expect(result.rule).toBe('docs');
    });

    it('skips disabled rules', async () => {
      const result = await service.resolveAgent({
        type: 'feature',
        priority: 'medium',
      });

      // disabled-rule matches feature but is disabled, so falls through to default
      expect(result.rule).toBeUndefined();
      expect(result.agent).toBe('claude-code');
      expect(result.model).toBe('sonnet');
      expect(result.reason).toContain('No routing rules matched');
    });

    it('falls back to default when no rules match', async () => {
      const result = await service.resolveAgent({
        type: 'design',
        priority: 'low',
      });

      expect(result.agent).toBe('claude-code');
      expect(result.model).toBe('sonnet');
      expect(result.rule).toBeUndefined();
      expect(result.reason).toContain('No routing rules matched');
    });

    it('returns default agent when routing is disabled', async () => {
      const config = structuredClone(BASE_CONFIG);
      requireRouting(config).enabled = false;
      mockGetConfig.mockResolvedValue(config);

      const result = await service.resolveAgent({
        type: 'code',
        priority: 'high',
      });

      expect(result.agent).toBe('claude-code');
      expect(result.reason).toContain('Routing disabled');
    });

    it('skips rules where agent is disabled', async () => {
      const config = structuredClone(BASE_CONFIG);
      // Disable claude-code so the first two rules are skipped
      config.agents[0].enabled = false;
      mockGetConfig.mockResolvedValue(config);

      const result = await service.resolveAgent({
        type: 'code',
        priority: 'high',
      });

      expect(result.agent).toBe('amp');
      expect(result.reason).toContain('unavailable');
      expect(result.reason).toContain('Using fallback');
    });

    it('uses a healthy fallback when a matched rule target is missing its executable', async () => {
      mockCheckAgent.mockImplementation(async (agent: AgentConfig) =>
        agent.type === 'claude-code'
          ? unhealthyAgent(agent, 'Executable "claude" was not found on PATH')
          : healthyAgent(agent)
      );

      const result = await service.resolveAgent({
        type: 'code',
        priority: 'high',
      });

      expect(result.agent).toBe('amp');
      expect(result.rule).toBe('code-high');
      expect(result.reason).toContain('Executable "claude" was not found on PATH');
    });

    it('throws a clear conflict when the primary and fallback agents are unavailable', async () => {
      const config = structuredClone(BASE_CONFIG);
      const routing = requireRouting(config);
      routing.rules = [
        {
          id: 'only-code',
          name: 'Only code route',
          match: { type: 'code' },
          agent: 'claude-code',
          fallback: 'amp',
          enabled: true,
        },
      ];
      routing.defaultAgent = 'amp';
      requireAgent(config, 'amp').enabled = false;
      mockGetConfig.mockResolvedValue(config);
      mockCheckAgent.mockImplementation(async (agent: AgentConfig) =>
        agent.type === 'claude-code'
          ? unhealthyAgent(agent, 'Executable "claude" was not found on PATH')
          : healthyAgent(agent)
      );

      await expect(
        service.resolveAgent({
          type: 'code',
          priority: 'high',
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'CONFLICT',
        details: expect.objectContaining({
          agent: 'amp',
          reason: 'Agent is disabled',
        }),
      });
    });

    it('routes around an unauthenticated provider when a healthy fallback exists', async () => {
      const config = structuredClone(BASE_CONFIG);
      config.agents.push({
        type: 'codex',
        name: 'OpenAI Codex',
        command: 'codex',
        args: [],
        enabled: true,
        provider: 'codex-cli',
      });
      requireRouting(config).rules = [
        {
          id: 'codex-code',
          name: 'Codex code route',
          match: { type: 'code' },
          agent: 'codex',
          fallback: 'amp',
          enabled: true,
        },
      ];
      mockGetConfig.mockResolvedValue(config);
      mockCheckAgent.mockImplementation(async (agent: AgentConfig) =>
        agent.type === 'codex'
          ? unhealthyAgent(agent, 'Authentication check failed: not logged in')
          : healthyAgent(agent)
      );

      const result = await service.resolveAgent({
        type: 'code',
        priority: 'medium',
      });

      expect(result.agent).toBe('amp');
      expect(result.reason).toContain('Authentication check failed');
    });

    it('matches array criteria', async () => {
      const config = structuredClone(BASE_CONFIG);
      requireRouting(config).rules = [
        {
          id: 'multi-type',
          name: 'Multiple types',
          match: { type: ['bug', 'hotfix'], priority: ['high', 'medium'] },
          agent: 'amp',
          enabled: true,
        },
      ];
      mockGetConfig.mockResolvedValue(config);

      const result = await service.resolveAgent({
        type: 'bug',
        priority: 'medium',
      });
      expect(result.agent).toBe('amp');
      expect(result.rule).toBe('multi-type');
    });

    it('matches minSubtasks criteria', async () => {
      const config = structuredClone(BASE_CONFIG);
      requireRouting(config).rules = [
        {
          id: 'complex',
          name: 'Complex tasks',
          match: { minSubtasks: 5 },
          agent: 'amp',
          enabled: true,
        },
      ];
      mockGetConfig.mockResolvedValue(config);

      const result = await service.resolveAgent({
        type: 'feature',
        priority: 'medium',
        subtasks: Array.from({ length: 6 }, (_, i) => ({
          id: `s${i}`,
          title: `Sub ${i}`,
          completed: false,
          created: new Date().toISOString(),
        })),
      });
      expect(result.agent).toBe('amp');
      expect(result.rule).toBe('complex');
    });

    it('does NOT match when subtasks below threshold', async () => {
      const config = structuredClone(BASE_CONFIG);
      requireRouting(config).rules = [
        {
          id: 'complex',
          name: 'Complex tasks',
          match: { minSubtasks: 5 },
          agent: 'amp',
          enabled: true,
        },
      ];
      mockGetConfig.mockResolvedValue(config);

      const result = await service.resolveAgent({
        type: 'feature',
        priority: 'medium',
        subtasks: [
          { id: 's1', title: 'Sub 1', completed: false, created: new Date().toISOString() },
        ],
      });
      expect(result.rule).toBeUndefined(); // No match
    });
  });

  describe('getFallback', () => {
    it('returns fallback agent from matched rule', async () => {
      const result = await service.getFallback({ type: 'code', priority: 'high' }, 'claude-code');
      const fallback = requireFallbackResult(result);

      expect(fallback.agent).toBe('amp');
      expect(fallback.reason).toContain('Fallback');
    });

    it('returns null when fallback is disabled', async () => {
      const config = structuredClone(BASE_CONFIG);
      requireRouting(config).fallbackOnFailure = false;
      mockGetConfig.mockResolvedValue(config);

      const result = await service.getFallback({ type: 'code', priority: 'high' }, 'claude-code');
      expect(result).toBeNull();
    });

    it('returns null when the matched fallback profile is disabled', async () => {
      const config = structuredClone(BASE_CONFIG);
      const routing = requireRouting(config);
      const [firstRule] = routing.rules;
      if (!firstRule) throw new Error('Expected first routing rule in test fixture');
      routing.rules = [firstRule];
      requireAgent(config, 'amp').enabled = false;
      mockGetConfig.mockResolvedValue(config);

      const result = await service.getFallback({ type: 'code', priority: 'high' }, 'claude-code');

      expect(result).toBeNull();
    });

    it('returns default agent as fallback when no specific fallback', async () => {
      const result = await service.getFallback(
        { type: 'docs', priority: 'low' },
        'claude-code' // docs rule has no fallback, and default is claude-code (same)
      );
      // claude-code === failedAgent, so no fallback
      expect(result).toBeNull();
    });

    it('returns default agent when it differs from failed', async () => {
      const result = await service.getFallback(
        { type: 'docs', priority: 'low' },
        'amp' // Failed agent is amp, default is claude-code → valid fallback
      );
      const fallback = requireFallbackResult(result);
      expect(fallback.agent).toBe('claude-code');
    });
  });

  describe('updateRoutingConfig', () => {
    it('saves valid config', async () => {
      const newConfig: AgentRoutingConfig = {
        enabled: true,
        rules: [],
        defaultAgent: 'amp',
        fallbackOnFailure: false,
        maxRetries: 0,
      };

      await service.updateRoutingConfig(newConfig);
      expect(mockSaveConfig).toHaveBeenCalled();
    });

    it('rejects duplicate rule IDs', async () => {
      const newConfig: AgentRoutingConfig = {
        enabled: true,
        rules: [
          { id: 'dup', name: 'A', match: {}, agent: 'amp', enabled: true },
          { id: 'dup', name: 'B', match: {}, agent: 'amp', enabled: true },
        ],
        defaultAgent: 'amp',
        fallbackOnFailure: false,
        maxRetries: 0,
      };

      await expect(service.updateRoutingConfig(newConfig)).rejects.toThrow('unique');
    });

    it('rejects maxRetries > 3', async () => {
      const newConfig: AgentRoutingConfig = {
        enabled: true,
        rules: [],
        defaultAgent: 'amp',
        fallbackOnFailure: false,
        maxRetries: 5,
      };

      await expect(service.updateRoutingConfig(newConfig)).rejects.toThrow('maxRetries');
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { AgentsTab } from '@/components/settings/tabs/AgentsTab';
import { renderWithProviders } from './test-utils';
import type { AgentConfig, AgentRoutingConfig, AgentType } from '@veritas-kanban/shared';

const agents: AgentConfig[] = [
  {
    type: 'codex' as AgentType,
    name: 'Codex',
    command: 'codex',
    args: ['exec'],
    enabled: true,
    provider: 'codex-cli',
  },
  {
    type: 'claude-code' as AgentType,
    name: 'Claude Code',
    command: 'claude',
    args: ['--dangerously-skip-permissions'],
    enabled: false,
    provider: 'custom',
  },
];

const routingConfig: AgentRoutingConfig = {
  enabled: true,
  defaultAgent: 'codex' as AgentType,
  defaultModel: 'gpt-5',
  fallbackOnFailure: true,
  maxRetries: 2,
  rules: [
    {
      id: 'high-code',
      name: 'High Code',
      match: { type: 'code', priority: 'high' },
      agent: 'codex' as AgentType,
      fallback: 'claude-code' as AgentType,
      model: 'gpt-5',
      enabled: true,
    },
  ],
};

const mocks = vi.hoisted(() => ({
  debouncedUpdate: vi.fn(),
  refetchCodexHealth: vi.fn(),
  refetchProviderHealth: vi.fn(),
  refetchHostHealth: vi.fn(),
  updateAgents: vi.fn(),
  updateRouting: vi.fn(),
}));

vi.mock('@/hooks/useConfig', () => ({
  useConfig: () => ({
    data: {
      agents,
      defaultAgent: 'codex',
    },
    isLoading: false,
  }),
  useCodexHealth: () => ({
    data: {
      checkedAt: '2026-06-01T12:00:00.000Z',
      cli: {
        installed: true,
        authenticated: true,
        version: 'codex 1.0.0',
        authMode: 'api-key',
      },
      sdk: { available: true },
      ready: { cli: true, sdk: true, cloud: false },
      recommendations: [],
    },
    isFetching: false,
    refetch: mocks.refetchCodexHealth,
  }),
  useProviderHealth: () => ({
    data: {
      checkedAt: '2026-06-01T12:01:00.000Z',
      summary: {
        total: 2,
        connected: 1,
        degraded: 1,
        stale: 0,
        disconnected: 0,
        unknown: 0,
        risky: 1,
        writeCapable: 2,
      },
      providers: [
        {
          id: 'codex',
          name: 'Codex',
          provider: 'codex',
          state: 'connected',
          risk: 'normal',
          boundary: 'mixed',
          readCapability: true,
          writeCapability: true,
          privacyScope: 'Local CLI/SDK profile with model-provider requests when agents run.',
          lastCheckedAt: '2026-06-01T12:00:00.000Z',
          detail: 'At least one Codex agent profile is ready.',
          tools: ['codex-cli'],
          postureFlags: ['CLI authenticated'],
          recommendations: [],
        },
        {
          id: 'openclaw',
          name: 'OpenClaw',
          provider: 'openclaw',
          state: 'degraded',
          risk: 'risky',
          boundary: 'local',
          readCapability: true,
          writeCapability: true,
          privacyScope: 'Local gateway posture only; tokens and gateway secrets are redacted.',
          lastCheckedAt: '2026-06-01T12:01:00.000Z',
          detail: '1 enabled OpenClaw agent profile(s) detected.',
          tools: ['gateway', 'plugin:browser', 'agent:openclaw'],
          postureFlags: [
            'Gateway configured',
            'Write-capable agent profile enabled',
            '2 high-impact plugin opt-in(s) detected.',
            '1 exec/elevated allowance signal(s) detected; identities are redacted.',
          ],
          recommendations: ['Review OpenClaw exec/elevated posture before autonomous runs.'],
          postureChecks: [
            {
              id: 'openclaw.plugins',
              label: 'OpenClaw plugins',
              status: 'risky',
              detail: '2 high-impact plugin opt-in(s) detected.',
              items: ['browser', 'memory'],
            },
            {
              id: 'openclaw.exec',
              label: 'Exec and elevated posture',
              status: 'risky',
              detail: '1 exec/elevated allowance signal(s) detected; identities are redacted.',
            },
            {
              id: 'openclaw.privacy',
              label: 'Node privacy posture',
              status: 'risky',
              detail: '1 node/camera/screen/file-transfer opt-in(s) detected.',
              items: ['screen'],
            },
            {
              id: 'openclaw.doctor',
              label: 'Doctor check',
              status: 'normal',
              detail: 'Doctor checks passed.',
              checkedAt: '2026-06-01T12:01:00.000Z',
            },
            {
              id: 'openclaw.policy',
              label: 'Policy check',
              status: 'degraded',
              detail: 'Policy check found review items.',
              checkedAt: '2026-06-01T12:01:00.000Z',
            },
          ],
        },
      ],
    },
    isFetching: false,
    refetch: mocks.refetchProviderHealth,
  }),
  useUpdateAgents: () => ({
    mutate: mocks.updateAgents,
  }),
}));

vi.mock('@/hooks/useFeatureSettings', () => ({
  useFeatureSettings: () => ({
    settings: {
      agents: {
        timeoutMinutes: 30,
        autoCommitOnComplete: true,
        autoCleanupWorktrees: false,
        enablePreview: true,
      },
    },
  }),
  useDebouncedFeatureUpdate: () => ({
    debouncedUpdate: mocks.debouncedUpdate,
    isPending: false,
  }),
}));

vi.mock('@/hooks/useRouting', () => ({
  useRoutingConfig: () => ({
    data: routingConfig,
    isLoading: false,
  }),
  useUpdateRoutingConfig: () => ({
    mutate: mocks.updateRouting,
    isPending: false,
  }),
}));

vi.mock('@/hooks/useAgent', () => ({
  useAgentHosts: () => ({
    data: {
      generatedAt: '2026-06-01T12:02:00.000Z',
      summary: {
        total: 1,
        connected: 1,
        degraded: 0,
        stale: 0,
        disconnected: 0,
        risky: 0,
        unknown: 0,
        overloaded: 0,
      },
      hosts: [
        {
          id: 'host-local',
          name: 'Local Supervisor',
          supervisorType: 'local-agent',
          os: 'darwin',
          posture: 'connected',
          authState: 'authenticated',
          supportedAgents: ['codex'],
          supportedProviders: ['codex-cli'],
          supportedModels: ['gpt-5'],
          supportedTools: ['code'],
          workspaceLabels: ['workspace:veritas-kanban'],
          activeSessions: 0,
          queueDepth: 0,
          maxQueueDepth: 2,
          overloaded: false,
          lastHeartbeat: '2026-06-01T12:01:59.000Z',
          diagnostics: [],
          registeredAgentIds: ['codex'],
        },
      ],
    },
    isFetching: false,
    refetch: mocks.refetchHostHealth,
  }),
  useAgentHostPreview: () => ({
    data: {
      generatedAt: '2026-06-01T12:02:00.000Z',
      request: { agent: 'codex', provider: 'codex-cli' },
      decision: {
        policy: 'first-capable-healthy',
        selectedHostId: 'host-local',
        selectedHostName: 'Local Supervisor',
        reason: 'Selected first capable connected host.',
        excludedHostIds: [],
      },
      previews: [
        {
          hostId: 'host-local',
          hostName: 'Local Supervisor',
          posture: 'connected',
          compatible: true,
          reasons: [],
          warnings: [],
          checks: [
            {
              id: 'heartbeat',
              label: 'Heartbeat',
              passed: true,
              detail: 'Host has a current heartbeat.',
            },
          ],
        },
      ],
    },
    isFetching: false,
  }),
}));

describe('Agents settings Mantine migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders installed agents, health, and routing controls through direct Mantine primitives', () => {
    const { baseElement } = renderWithProviders(<AgentsTab />);

    expect(screen.getByText('Installed Agents')).toBeDefined();
    expect(screen.getByText('Codex Health')).toBeDefined();
    expect(screen.getByText('Context Provider Health')).toBeDefined();
    expect(screen.getByText('Agent Host Health')).toBeDefined();
    expect(screen.getByText('Launch Compatibility')).toBeDefined();
    expect(screen.getAllByText('Local Supervisor').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('OpenClaw')).toBeDefined();
    expect(screen.getAllByText('Risky').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('OpenClaw plugins')).toBeDefined();
    expect(screen.getByText('Exec and elevated posture')).toBeDefined();
    expect(screen.getByText('Node privacy posture')).toBeDefined();
    expect(screen.getByText('Doctor check')).toBeDefined();
    expect(screen.getByText('Policy check')).toBeDefined();
    expect(screen.getByText('Agent Routing')).toBeDefined();
    expect(screen.getByText('CLI installed')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Refresh Codex health' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Refresh host health' })).toBeDefined();
    expect(screen.getByRole('switch', { name: 'Enable Claude Code' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Default Agent' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Default Model' })).toBeDefined();

    expect(baseElement.querySelectorAll('.mantine-Badge-root').length).toBeGreaterThanOrEqual(6);
    expect(baseElement.querySelectorAll('.mantine-Button-root').length).toBeGreaterThanOrEqual(3);
    expect(baseElement.querySelectorAll('.mantine-ActionIcon-root').length).toBeGreaterThanOrEqual(
      5
    );
    expect(baseElement.querySelectorAll('.mantine-Switch-root').length).toBeGreaterThanOrEqual(5);
    expect(baseElement.querySelector('.mantine-Select-root')).toBeDefined();
    expect(baseElement.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="input"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="select-trigger"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="switch"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="badge"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh Codex health' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh provider health' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh host health' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Enable Claude Code' }));

    expect(mocks.refetchCodexHealth).toHaveBeenCalledTimes(1);
    expect(mocks.refetchProviderHealth).toHaveBeenCalledTimes(1);
    expect(mocks.refetchHostHealth).toHaveBeenCalledTimes(1);
    expect(mocks.updateAgents).toHaveBeenCalledWith([
      agents[0],
      expect.objectContaining({ type: 'claude-code', enabled: true }),
    ]);
  });

  it('adds custom agents through Mantine text inputs and buttons', () => {
    const { baseElement } = renderWithProviders(<AgentsTab />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Agent' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Display Name' }), {
      target: { value: 'Gemini Runner' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Command' }), {
      target: { value: 'gemini' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Arguments' }), {
      target: { value: 'run --fast' },
    });
    expect(baseElement.querySelectorAll('.mantine-TextInput-root').length).toBeGreaterThanOrEqual(
      5
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add Agent' }));

    expect(mocks.updateAgents).toHaveBeenCalledWith([
      ...agents,
      expect.objectContaining({
        type: 'gemini-runner',
        name: 'Gemini Runner',
        command: 'gemini',
        args: ['run', '--fast'],
        enabled: true,
      }),
    ]);
  });

  it('adds routing rules through direct Mantine form controls', () => {
    const { baseElement } = renderWithProviders(<AgentsTab />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Rule' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Rule Name' }), {
      target: { value: 'Docs Work' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Match Type(s)' }), {
      target: { value: 'docs' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Match Priority' }), {
      target: { value: 'medium' },
    });
    expect(baseElement.querySelectorAll('.mantine-Select-root').length).toBeGreaterThanOrEqual(3);

    fireEvent.click(screen.getByRole('button', { name: 'Add Rule' }));

    expect(mocks.updateRouting).toHaveBeenCalledWith(
      expect.objectContaining({
        rules: [
          routingConfig.rules[0],
          expect.objectContaining({
            id: 'docs-work',
            name: 'Docs Work',
            match: expect.objectContaining({ type: 'docs', priority: 'medium' }),
            agent: 'codex',
            enabled: true,
          }),
        ],
      })
    );
  });
});

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
        degraded: 0,
        stale: 0,
        disconnected: 0,
        unknown: 1,
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
          state: 'unknown',
          risk: 'risky',
          boundary: 'local',
          readCapability: true,
          writeCapability: true,
          privacyScope: 'Local gateway posture only; tokens and gateway secrets are redacted.',
          lastCheckedAt: '2026-06-01T12:01:00.000Z',
          detail: '1 enabled OpenClaw agent profile(s) detected.',
          tools: ['gateway', 'agent:openclaw'],
          postureFlags: ['Risky exec/elevated argument detected'],
          recommendations: ['Review OpenClaw exec/elevated arguments before autonomous runs.'],
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
    expect(screen.getByText('OpenClaw')).toBeDefined();
    expect(screen.getByText('Risky')).toBeDefined();
    expect(screen.getByText('Agent Routing')).toBeDefined();
    expect(screen.getByText('CLI installed')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Refresh Codex health' })).toBeDefined();
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
    fireEvent.click(screen.getByRole('switch', { name: 'Enable Claude Code' }));

    expect(mocks.refetchCodexHealth).toHaveBeenCalledTimes(1);
    expect(mocks.refetchProviderHealth).toHaveBeenCalledTimes(1);
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

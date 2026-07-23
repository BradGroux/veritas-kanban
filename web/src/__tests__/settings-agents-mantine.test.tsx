import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    model: 'gpt-5',
    sandboxPresetId: 'codex-repo-contained',
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
  updateProfile: vi.fn(),
  importProfile: vi.fn(),
  validateProfile: vi.fn(),
  exportProfile: vi.fn(),
  deleteProfile: vi.fn(),
  startAgent: vi.fn(),
  validateSandboxPolicy: vi.fn(),
  providerRuntimeManifests: [] as Array<Record<string, unknown>>,
  additionalAgentHosts: [] as Array<Record<string, unknown>>,
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
  useHarnessSupport: () => ({
    data: [
      {
        agentType: 'codex',
        profileId: 'openai-codex-cli',
        adapterId: 'codex-cli',
        transport: 'process-jsonl',
        supportTier: 'configured',
        reason: 'Certification evidence is not current.',
        failureClass: 'none',
        checkedAt: '2026-06-01T12:00:00.000Z',
        enabled: true,
        executableFound: true,
        authenticated: true,
        diagnosticCommands: ['codex --version', 'codex login status'],
        remediation: ['Run vk doctor.'],
      },
      {
        agentType: 'claude-code',
        profileId: 'claude-code',
        transport: 'process-jsonl',
        supportTier: 'unsupported',
        reason: 'No executable Claude Code adapter is registered.',
        failureClass: 'adapter-unavailable',
        checkedAt: '2026-06-01T12:00:00.000Z',
        enabled: false,
        executableFound: true,
        authenticated: true,
        diagnosticCommands: ['claude --version'],
        remediation: ['Use a supported adapter.'],
      },
    ],
    isFetching: false,
    refetch: vi.fn(),
  }),
  useUpdateAgents: () => ({
    mutate: mocks.updateAgents,
  }),
  useAgentProfiles: () => ({
    data: [
      {
        id: 'qa-reviewer',
        version: '1.0.0',
        displayName: 'QA Reviewer',
        role: 'Reviews QA evidence',
        enabled: true,
        capabilities: ['qa'],
        defaultTaskTypes: ['review'],
        runtime: { agent: 'codex', provider: 'codex-cli', model: 'gpt-5' },
        policy: { sandboxPresetId: 'codex-repo-contained' },
      },
    ],
    isLoading: false,
  }),
  useValidateAgentProfile: () => ({
    mutateAsync: mocks.validateProfile.mockResolvedValue({
      valid: true,
      profile: { id: 'qa-reviewer', displayName: 'QA Reviewer' },
      issues: [],
    }),
    isPending: false,
  }),
  useImportAgentProfile: () => ({
    mutateAsync: mocks.importProfile.mockResolvedValue({
      created: true,
      profile: { id: 'qa-reviewer', displayName: 'QA Reviewer', version: '1.0.0' },
    }),
    isPending: false,
  }),
  useUpdateAgentProfile: () => ({
    mutate: mocks.updateProfile,
    isPending: false,
  }),
  useDeleteAgentProfile: () => ({
    mutate: mocks.deleteProfile,
    isPending: false,
  }),
  useExportAgentProfile: () => ({
    mutateAsync: mocks.exportProfile.mockResolvedValue({
      id: 'qa-reviewer',
      format: 'yaml',
      content: 'id: qa-reviewer\n',
    }),
    isPending: false,
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
          supportedTools: ['tool.calls'],
          sandboxCapabilities: ['filesystem.read', 'filesystem.write', 'environment.allowlist'],
          providerRuntimeManifests: mocks.providerRuntimeManifests,
          legacyRuntimePosture: {
            providers: ['codex-cli'],
            models: ['gpt-5'],
            tools: ['code'],
            sandboxCapabilities: [],
          },
          workspaceLabels: ['workspace:veritas-kanban'],
          activeSessions: 0,
          queueDepth: 0,
          maxQueueDepth: 2,
          overloaded: false,
          lastHeartbeat: '2026-06-01T12:01:59.000Z',
          diagnostics: [],
          registeredAgentIds: ['codex'],
        },
        ...mocks.additionalAgentHosts,
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
  useStartAgent: () => ({
    mutate: mocks.startAgent,
    isPending: false,
  }),
}));

vi.mock('@/hooks/useSandboxPolicies', () => ({
  useSandboxPolicies: () => ({
    data: [
      {
        id: 'legacy-permissive',
        name: 'Legacy permissive',
        enabled: true,
        builtIn: true,
        enforcement: 'advisory',
        requiredCapabilities: [],
        filesystem: {
          readPaths: ['<workspace>'],
          writePaths: ['<workspace>'],
          deniedPaths: [],
          dotfileMasking: false,
          localOnlyHandles: false,
        },
        network: {
          defaultEgress: 'allow',
          allowedHosts: [],
          allowedMethods: [],
          allowedPathPrefixes: [],
          blockPrivateNetwork: false,
          blockMetadataEndpoints: false,
          blockLoopback: false,
        },
        environment: {
          passthrough: ['PATH', 'OPENAI_API_KEY'],
          redactDisplay: true,
        },
        credentials: {
          mode: 'env-passthrough',
          brokerRefs: [],
        },
        createdAt: '2026-06-18T00:00:00.000Z',
        updatedAt: '2026-06-18T00:00:00.000Z',
      },
      {
        id: 'codex-repo-contained',
        name: 'Codex repo contained',
        enabled: true,
        builtIn: true,
        enforcement: 'required',
        requiredCapabilities: [],
        filesystem: {
          readPaths: ['<workspace>'],
          writePaths: ['<workspace>'],
          deniedPaths: [],
          dotfileMasking: false,
          localOnlyHandles: true,
        },
        network: {
          defaultEgress: 'deny',
          allowedHosts: [],
          allowedMethods: [],
          allowedPathPrefixes: [],
          blockPrivateNetwork: true,
          blockMetadataEndpoints: true,
          blockLoopback: true,
        },
        environment: {
          passthrough: ['PATH', 'OPENAI_API_KEY'],
          redactDisplay: true,
        },
        credentials: {
          mode: 'none',
          brokerRefs: [],
        },
        createdAt: '2026-06-18T00:00:00.000Z',
        updatedAt: '2026-06-18T00:00:00.000Z',
      },
    ],
    isLoading: false,
  }),
  useCreateSandboxPolicy: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSandboxPolicy: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteSandboxPolicy: () => ({ mutate: vi.fn(), isPending: false }),
  useValidateSandboxPolicy: () => ({
    mutate: mocks.validateSandboxPolicy,
    mutateAsync: mocks.validateSandboxPolicy,
    isPending: false,
    data: undefined,
    error: null,
  }),
}));

describe('Agents settings Mantine migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mocks.providerRuntimeManifests.length = 0;
    mocks.additionalAgentHosts.length = 0;
    mocks.validateSandboxPolicy.mockResolvedValue({
      decision: 'allow',
      effective: { sandboxMode: 'workspace-write', networkAccessEnabled: false },
      unsupportedRules: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders installed agents, health, and routing controls through direct Mantine primitives', () => {
    const { baseElement } = renderWithProviders(<AgentsTab />);

    expect(screen.getByText('Installed Agents')).toBeDefined();
    expect(screen.getAllByText('Codex CLI').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('gpt-5').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Codex Health')).toBeDefined();
    expect(screen.getByText('Context Provider Health')).toBeDefined();
    expect(screen.getByText('Agent Host Health')).toBeDefined();
    expect(screen.getByText('Agent Profile Packages')).toBeDefined();
    expect(screen.getByText('QA Reviewer')).toBeDefined();
    expect(screen.getByText('Launch Compatibility')).toBeDefined();
    expect(screen.getAllByText('Local Supervisor').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('OpenClaw').length).toBeGreaterThanOrEqual(1);
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
    expect(screen.getByText('Configured')).toBeDefined();
    expect(screen.getByText('Unsupported')).toBeDefined();
    expect(screen.getByText('Certification evidence is not current.')).toBeDefined();
    expect(screen.getByText('No executable Claude Code adapter is registered.')).toBeDefined();
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

  it('dry-runs sandbox policy against the newest live registered manifest', async () => {
    const olderReadyDigest = `sha256:${'a'.repeat(64)}`;
    const newerFailedDigest = `sha256:${'b'.repeat(64)}`;
    const newestDisconnectedDigest = `sha256:${'c'.repeat(64)}`;
    mocks.providerRuntimeManifests.push(
      {
        provider: 'codex-sdk',
        adapter: 'codex-sdk',
        digest: olderReadyDigest,
        probe: { state: 'ready', probedAt: '2026-06-01T12:00:00.000Z' },
      },
      {
        provider: 'codex-sdk',
        adapter: 'codex-sdk',
        digest: newerFailedDigest,
        probe: { state: 'failed', probedAt: '2026-06-01T12:05:00.000Z' },
      }
    );
    mocks.additionalAgentHosts.push({
      id: 'host-disconnected',
      name: 'Disconnected Supervisor',
      supervisorType: 'remote-agent',
      os: 'linux',
      posture: 'disconnected',
      authState: 'unknown',
      supportedAgents: ['codex'],
      supportedProviders: ['codex-sdk'],
      supportedModels: ['gpt-5'],
      supportedTools: ['tool.calls'],
      sandboxCapabilities: ['filesystem.read'],
      providerRuntimeManifests: [
        {
          provider: 'codex-sdk',
          adapter: 'codex-sdk',
          digest: newestDisconnectedDigest,
          probe: { state: 'ready', probedAt: '2026-06-01T12:10:00.000Z' },
        },
      ],
      legacyRuntimePosture: {
        providers: ['codex-sdk'],
        models: ['gpt-5'],
        tools: ['code'],
        sandboxCapabilities: [],
      },
      workspaceLabels: ['workspace:veritas-kanban'],
      activeSessions: 0,
      queueDepth: 0,
      maxQueueDepth: 2,
      overloaded: false,
      lastHeartbeat: '2026-06-01T11:50:00.000Z',
      diagnostics: ['Heartbeat expired.'],
      registeredAgentIds: ['codex'],
    });

    renderWithProviders(<AgentsTab />);

    const runCheck = screen.getByRole('button', { name: 'Run Dry Check' });
    await waitFor(() => expect(runCheck.getAttribute('disabled')).toBeNull());
    fireEvent.click(runCheck);

    expect(mocks.validateSandboxPolicy).toHaveBeenCalledWith({
      presetId: 'legacy-permissive',
      provider: 'codex-sdk',
      providerRuntimeManifestDigest: newerFailedDigest,
    });
  });

  it('ignores stale dry-run responses after the provider selection changes away and back', async () => {
    const user = userEvent.setup();
    const digest = `sha256:${'d'.repeat(64)}`;
    mocks.providerRuntimeManifests.push({
      provider: 'codex-sdk',
      adapter: 'codex-sdk',
      digest,
      probe: { state: 'ready', probedAt: '2026-06-01T12:00:00.000Z' },
    });
    let resolveOld: ((value: unknown) => void) | undefined;
    mocks.validateSandboxPolicy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        })
    );

    renderWithProviders(<AgentsTab />);
    await user.click(screen.getByRole('button', { name: 'Run Dry Check' }));
    const provider = screen.getByRole('combobox', { name: 'Provider' });
    await user.click(provider);
    await user.click(await screen.findByRole('option', { name: 'OpenClaw' }));
    await user.click(provider);
    await user.click(await screen.findByRole('option', { name: 'Codex SDK' }));

    resolveOld?.({
      decision: 'allow',
      effective: { sandboxMode: 'workspace-write', networkAccessEnabled: false },
      unsupportedRules: [],
      traceId: 'trace-stale',
    });
    await waitFor(() => expect(screen.queryByText('Trace trace-stale')).toBeNull());

    mocks.validateSandboxPolicy.mockResolvedValueOnce({
      decision: 'allow',
      effective: { sandboxMode: 'workspace-write', networkAccessEnabled: false },
      unsupportedRules: [],
      traceId: 'trace-current',
    });
    await user.click(screen.getByRole('button', { name: 'Run Dry Check' }));
    expect(await screen.findByText('Trace trace-current')).toBeDefined();
  });

  it('shows live-manifest validation conflicts to the operator', async () => {
    const user = userEvent.setup();
    mocks.providerRuntimeManifests.push({
      provider: 'codex-sdk',
      adapter: 'codex-sdk',
      digest: `sha256:${'e'.repeat(64)}`,
      probe: { state: 'ready', probedAt: '2026-06-01T12:00:00.000Z' },
    });
    mocks.validateSandboxPolicy.mockRejectedValueOnce(
      new Error('The requested provider runtime manifest is not registered on a live agent host')
    );

    renderWithProviders(<AgentsTab />);
    await user.click(screen.getByRole('button', { name: 'Run Dry Check' }));

    expect(
      await screen.findByText(
        'The requested provider runtime manifest is not registered on a live agent host'
      )
    ).toBeDefined();
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
    fireEvent.change(screen.getByRole('textbox', { name: 'Model' }), {
      target: { value: 'gemini-2.5-pro' },
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
        model: 'gemini-2.5-pro',
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

  it('imports profile packages and launches a profile from a task id', async () => {
    renderWithProviders(<AgentsTab />);

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => {
      expect(mocks.importProfile).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'yaml', source: 'settings' })
      );
    });

    fireEvent.change(screen.getByRole('textbox', { name: 'Launch Task' }), {
      target: { value: 'task_123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }));

    expect(mocks.startAgent).toHaveBeenCalledWith({
      taskId: 'task_123',
      profileId: 'qa-reviewer',
    });
  });
});

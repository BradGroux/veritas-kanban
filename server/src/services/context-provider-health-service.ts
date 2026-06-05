import type { AgentConfig, FeatureSettings } from '@veritas-kanban/shared';
import { ConfigService } from './config-service.js';
import { CodexHealthService, type CodexHealthStatus } from './codex-health-service.js';
import { getAgentRegistryService, type RegisteredAgent } from './agent-registry-service.js';

export type ContextProviderState = 'connected' | 'degraded' | 'stale' | 'disconnected' | 'unknown';

export type ContextProviderRisk = 'safe' | 'normal' | 'risky';
export type ContextProviderBoundary = 'local' | 'cloud' | 'mixed' | 'unknown';
export type ContextProviderPostureStatus =
  | 'safe'
  | 'normal'
  | 'risky'
  | 'degraded'
  | 'stale'
  | 'disconnected'
  | 'unknown';

export interface ContextProviderPostureCheck {
  id: string;
  label: string;
  status: ContextProviderPostureStatus;
  detail: string;
  checkedAt?: string;
  items?: string[];
}

export interface ContextProviderHealth {
  id: string;
  name: string;
  provider: 'codex' | 'openclaw' | 'custom';
  state: ContextProviderState;
  risk: ContextProviderRisk;
  boundary: ContextProviderBoundary;
  readCapability: boolean;
  writeCapability: boolean;
  privacyScope: string;
  lastCheckedAt: string;
  detail: string;
  tools: string[];
  postureFlags: string[];
  recommendations: string[];
  postureChecks?: ContextProviderPostureCheck[];
}

export interface ContextProviderHealthResponse {
  checkedAt: string;
  summary: {
    total: number;
    connected: number;
    degraded: number;
    stale: number;
    disconnected: number;
    unknown: number;
    risky: number;
    writeCapable: number;
  };
  providers: ContextProviderHealth[];
}

export interface ContextProviderHealthServiceOptions {
  configService?: Pick<ConfigService, 'getConfig' | 'getFeatureSettings'>;
  codexHealthService?: Pick<CodexHealthService, 'getHealth'>;
  agentRegistry?: { list(): RegisteredAgent[] };
}

export class ContextProviderHealthService {
  private configService: Pick<ConfigService, 'getConfig' | 'getFeatureSettings'>;
  private codexHealthService: Pick<CodexHealthService, 'getHealth'>;
  private agentRegistry: { list(): RegisteredAgent[] };

  constructor(options: ContextProviderHealthServiceOptions = {}) {
    this.configService = options.configService ?? new ConfigService();
    this.codexHealthService = options.codexHealthService ?? new CodexHealthService();
    this.agentRegistry = options.agentRegistry ?? getAgentRegistryService();
  }

  async getHealth(): Promise<ContextProviderHealthResponse> {
    const checkedAt = new Date().toISOString();
    const [config, featureSettings, codexHealth] = await Promise.all([
      this.configService.getConfig(),
      this.configService.getFeatureSettings(),
      this.codexHealthService.getHealth(),
    ]);

    const registeredAgents = this.agentRegistry.list();
    const providers = [
      this.codexProvider(codexHealth, checkedAt),
      this.openClawProvider(config.agents, featureSettings, registeredAgents, checkedAt),
    ];

    return {
      checkedAt,
      summary: this.summary(providers),
      providers,
    };
  }

  private codexProvider(health: CodexHealthStatus, checkedAt: string): ContextProviderHealth {
    const state: ContextProviderState = health.ready.overall
      ? 'connected'
      : health.cli.installed
        ? 'degraded'
        : 'disconnected';
    const tools = [
      health.ready.cli ? 'codex-cli' : undefined,
      health.ready.sdk ? 'codex-sdk' : undefined,
      health.ready.cloud ? 'codex-cloud' : undefined,
    ].filter((tool): tool is string => Boolean(tool));

    return {
      id: 'codex',
      name: 'Codex',
      provider: 'codex',
      state,
      risk: 'normal',
      boundary: health.ready.cloud ? 'mixed' : 'local',
      readCapability: true,
      writeCapability: tools.length > 0,
      privacyScope: 'Local CLI/SDK profile with model-provider requests when agents run.',
      lastCheckedAt: health.checkedAt || checkedAt,
      detail: health.ready.overall
        ? 'At least one Codex agent profile is ready.'
        : 'Codex is configured but not fully ready.',
      tools,
      postureFlags: [
        health.cli.authenticated ? 'CLI authenticated' : 'CLI not authenticated',
        health.sdk.available ? 'SDK available' : 'SDK unavailable',
        ...health.agents.enabled.map((agent) => `Enabled profile: ${agent}`),
      ],
      recommendations: health.recommendations,
    };
  }

  private openClawProvider(
    agents: AgentConfig[],
    featureSettings: FeatureSettings,
    registeredAgents: RegisteredAgent[],
    checkedAt: string
  ): ContextProviderHealth {
    const openClawAgents = agents.filter((agent) => agent.provider === 'openclaw');
    const enabledAgents = openClawAgents.filter((agent) => agent.enabled);
    const registeredOpenClawAgents = registeredAgents.filter((agent) =>
      this.isRegisteredOpenClawAgent(agent)
    );
    const gatewayConfigured =
      featureSettings.squadWebhook.mode === 'openclaw' &&
      Boolean(featureSettings.squadWebhook.openclawGatewayUrl);
    const riskyArgs = openClawAgents.flatMap((agent) =>
      [agent.command, ...agent.args].filter((value) => this.isRiskyOpenClawArg(value))
    );
    const pluginPosture = this.openClawPluginPosture(openClawAgents, registeredOpenClawAgents);
    const execPosture = this.openClawExecPosture(openClawAgents, registeredOpenClawAgents);
    const privacyPosture = this.openClawPrivacyPosture(openClawAgents, registeredOpenClawAgents);
    const doctorPosture = this.openClawRuntimeCheck('doctor', registeredOpenClawAgents, checkedAt);
    const policyPosture = this.openClawRuntimeCheck('policy', registeredOpenClawAgents, checkedAt);
    const postureChecks = [
      pluginPosture,
      execPosture,
      privacyPosture,
      doctorPosture,
      policyPosture,
    ];
    const configured =
      enabledAgents.length > 0 || gatewayConfigured || registeredOpenClawAgents.length > 0;
    const state = this.openClawState(configured, postureChecks);
    const risk: ContextProviderRisk =
      postureChecks.some((check) => check.status === 'risky') || riskyArgs.length > 0
        ? 'risky'
        : configured
          ? 'normal'
          : 'safe';

    return {
      id: 'openclaw',
      name: 'OpenClaw',
      provider: 'openclaw',
      state,
      risk,
      boundary: gatewayConfigured ? 'local' : 'unknown',
      readCapability: openClawAgents.length > 0 || gatewayConfigured,
      writeCapability: enabledAgents.length > 0 || gatewayConfigured,
      privacyScope: gatewayConfigured
        ? 'Local gateway posture only; tokens and gateway secrets are redacted.'
        : 'No OpenClaw gateway status is configured.',
      lastCheckedAt: checkedAt,
      detail: this.openClawDetail(
        enabledAgents.length,
        registeredOpenClawAgents.length,
        gatewayConfigured
      ),
      tools: [
        gatewayConfigured ? 'gateway' : undefined,
        ...(pluginPosture.items?.map((plugin) => `plugin:${plugin}`) ?? []),
        ...openClawAgents.map((agent) => `agent:${agent.type}`),
      ].filter((tool): tool is string => Boolean(tool)),
      postureFlags: [
        gatewayConfigured ? 'Gateway configured' : 'Gateway not configured',
        enabledAgents.length > 0 ? 'Write-capable agent profile enabled' : 'No enabled profile',
        pluginPosture.detail,
        execPosture.detail,
        privacyPosture.detail,
        doctorPosture.detail,
        policyPosture.detail,
      ],
      recommendations: [
        !configured
          ? 'Add an OpenClaw profile or gateway before expecting posture checks.'
          : doctorPosture.status === 'unknown' || policyPosture.status === 'unknown'
            ? 'Register redacted OpenClaw doctor/policy summaries to replace unknown posture.'
            : undefined,
        execPosture.status === 'risky'
          ? 'Review OpenClaw exec/elevated posture before autonomous runs.'
          : undefined,
        privacyPosture.status === 'risky'
          ? 'Review node/camera/screen/file-transfer opt-ins before enabling autonomous runs.'
          : undefined,
      ].filter((item): item is string => Boolean(item)),
      postureChecks,
    };
  }

  private summary(providers: ContextProviderHealth[]): ContextProviderHealthResponse['summary'] {
    return {
      total: providers.length,
      connected: providers.filter((provider) => provider.state === 'connected').length,
      degraded: providers.filter((provider) => provider.state === 'degraded').length,
      stale: providers.filter((provider) => provider.state === 'stale').length,
      disconnected: providers.filter((provider) => provider.state === 'disconnected').length,
      unknown: providers.filter((provider) => provider.state === 'unknown').length,
      risky: providers.filter((provider) => provider.risk === 'risky').length,
      writeCapable: providers.filter((provider) => provider.writeCapability).length,
    };
  }

  private isRiskyOpenClawArg(value: string): boolean {
    return /dangerously|skip[-_]?permissions|approval[-_]?never|elevated|allow[-_]?exec/i.test(
      value
    );
  }

  private openClawDetail(
    enabledAgentCount: number,
    registeredAgentCount: number,
    gatewayConfigured: boolean
  ): string {
    if (enabledAgentCount > 0) {
      return `${enabledAgentCount} enabled OpenClaw agent profile(s) detected.`;
    }
    if (registeredAgentCount > 0) {
      return `${registeredAgentCount} registered OpenClaw supervisor(s) detected.`;
    }
    if (gatewayConfigured) {
      return 'OpenClaw gateway is configured for squad wakeups.';
    }
    return 'No enabled OpenClaw agent profile or gateway was found.';
  }

  private isRegisteredOpenClawAgent(agent: RegisteredAgent): boolean {
    const metadata = this.metadata(agent);
    return (
      agent.provider === 'openclaw' ||
      String(metadata.provider ?? '').toLowerCase() === 'openclaw' ||
      Boolean(metadata.openclaw)
    );
  }

  private openClawPluginPosture(
    agents: AgentConfig[],
    registeredAgents: RegisteredAgent[]
  ): ContextProviderPostureCheck {
    const reportedPlugins = new Set<string>();
    for (const agent of agents) {
      for (const plugin of this.pluginsFromArgs([agent.command, ...agent.args])) {
        reportedPlugins.add(plugin);
      }
    }
    for (const agent of registeredAgents) {
      for (const plugin of [
        ...this.stringArray(this.metadata(agent).openclawPlugins),
        ...this.stringArray(this.metadata(agent).plugins),
        ...this.stringArray(this.metadata(agent).enabledPlugins),
      ]) {
        reportedPlugins.add(this.safePluginName(plugin));
      }
    }

    const plugins = Array.from(reportedPlugins).filter(Boolean).sort();
    const sensitive = plugins.filter((plugin) =>
      /browser|canvas|node|file-transfer|webhook|screen|camera|acp|codex-supervisor/i.test(plugin)
    );
    if (plugins.length === 0) {
      return {
        id: 'openclaw.plugins',
        label: 'OpenClaw plugins',
        status: 'unknown',
        detail: 'High-impact plugin posture is not reported.',
      };
    }
    return {
      id: 'openclaw.plugins',
      label: 'OpenClaw plugins',
      status: sensitive.length > 0 ? 'risky' : 'normal',
      detail:
        sensitive.length > 0
          ? `${sensitive.length} high-impact plugin opt-in(s) detected.`
          : `${plugins.length} plugin opt-in(s) detected without high-impact flags.`,
      items: plugins,
    };
  }

  private openClawExecPosture(
    agents: AgentConfig[],
    registeredAgents: RegisteredAgent[]
  ): ContextProviderPostureCheck {
    const riskyArgCount = agents.reduce(
      (count, agent) =>
        count +
        [agent.command, ...agent.args].filter((value) => this.isRiskyOpenClawArg(value)).length,
      0
    );
    const metadataExecSignals = registeredAgents.filter((agent) => {
      const metadata = this.metadata(agent);
      return (
        this.booleanValue(metadata.execAllowed) ||
        this.booleanValue(metadata.elevatedAllowed) ||
        this.booleanValue(metadata.hostSecurityAsk) ||
        this.numberValue(metadata.allowedSenderCount) > 0
      );
    }).length;
    const riskyCount = riskyArgCount + metadataExecSignals;

    return {
      id: 'openclaw.exec',
      label: 'Exec and elevated posture',
      status:
        riskyCount > 0
          ? 'risky'
          : agents.length > 0 || registeredAgents.length > 0
            ? 'safe'
            : 'unknown',
      detail:
        riskyCount > 0
          ? `${riskyCount} exec/elevated allowance signal(s) detected; identities are redacted.`
          : agents.length > 0 || registeredAgents.length > 0
            ? 'No exec/elevated allowance signal detected.'
            : 'Exec/elevated posture is not reported.',
    };
  }

  private openClawPrivacyPosture(
    agents: AgentConfig[],
    registeredAgents: RegisteredAgent[]
  ): ContextProviderPostureCheck {
    const argText = agents.map((agent) => [agent.command, ...agent.args].join(' ')).join(' ');
    const optIns = new Set<string>();
    for (const [label, pattern] of [
      ['node', /\bnode(?:s)?\b/i],
      ['camera', /\bcamera\b/i],
      ['screen', /\bscreen(?:-share|-capture)?\b/i],
      ['file-transfer', /\bfile[-_]?transfer\b/i],
    ] as const) {
      if (pattern.test(argText)) optIns.add(label);
    }
    for (const agent of registeredAgents) {
      const metadata = this.metadata(agent);
      if (this.booleanValue(metadata.nodeAccess)) optIns.add('node');
      if (this.booleanValue(metadata.cameraAccess)) optIns.add('camera');
      if (this.booleanValue(metadata.screenAccess)) optIns.add('screen');
      if (this.booleanValue(metadata.fileTransferAccess)) optIns.add('file-transfer');
      for (const item of this.stringArray(metadata.privacyOptIns)) {
        optIns.add(this.safePluginName(item));
      }
    }

    const items = Array.from(optIns).sort();
    return {
      id: 'openclaw.privacy',
      label: 'Node privacy posture',
      status:
        items.length > 0
          ? 'risky'
          : agents.length > 0 || registeredAgents.length > 0
            ? 'safe'
            : 'unknown',
      detail:
        items.length > 0
          ? `${items.length} node/camera/screen/file-transfer opt-in(s) detected.`
          : agents.length > 0 || registeredAgents.length > 0
            ? 'No node/camera/screen/file-transfer opt-in signal detected.'
            : 'Node privacy posture is not reported.',
      items: items.length > 0 ? items : undefined,
    };
  }

  private openClawRuntimeCheck(
    kind: 'doctor' | 'policy',
    registeredAgents: RegisteredAgent[],
    checkedAt: string
  ): ContextProviderPostureCheck {
    const candidates = registeredAgents
      .map((agent) =>
        this.runtimeCheckFromMetadata(kind, this.metadata(agent), agent.lastHeartbeat)
      )
      .filter((check): check is ContextProviderPostureCheck => Boolean(check))
      .sort((a, b) => Date.parse(b.checkedAt ?? '') - Date.parse(a.checkedAt ?? ''));

    if (candidates[0]) return candidates[0];

    return {
      id: `openclaw.${kind}`,
      label: kind === 'doctor' ? 'Doctor check' : 'Policy check',
      status: 'unknown',
      checkedAt,
      detail: `OpenClaw ${kind} status is not reported.`,
    };
  }

  private runtimeCheckFromMetadata(
    kind: 'doctor' | 'policy',
    metadata: Record<string, unknown>,
    fallbackCheckedAt: string
  ): ContextProviderPostureCheck | null {
    const direct = metadata[`openclaw${this.capitalize(kind)}`];
    const directObject =
      direct && typeof direct === 'object' ? (direct as Record<string, unknown>) : {};
    const status =
      this.postureStatus(directObject.status) ??
      this.postureStatus(metadata[`${kind}Status`]) ??
      this.postureStatus(metadata[`openclaw${this.capitalize(kind)}Status`]);
    if (!status) return null;

    const detail =
      this.stringValue(directObject.detail) ??
      this.stringValue(directObject.error) ??
      this.stringValue(metadata[`${kind}Detail`]) ??
      this.stringValue(metadata[`${kind}Error`]) ??
      `OpenClaw ${kind} reported ${status}.`;
    const checkedAt =
      this.stringValue(directObject.checkedAt) ??
      this.stringValue(metadata[`${kind}CheckedAt`]) ??
      fallbackCheckedAt;

    return {
      id: `openclaw.${kind}`,
      label: kind === 'doctor' ? 'Doctor check' : 'Policy check',
      status,
      checkedAt,
      detail,
    };
  }

  private openClawState(
    configured: boolean,
    checks: ContextProviderPostureCheck[]
  ): ContextProviderState {
    if (!configured) return 'disconnected';
    if (checks.some((check) => check.status === 'disconnected')) return 'disconnected';
    if (checks.some((check) => check.status === 'stale')) return 'stale';
    if (checks.some((check) => check.status === 'risky' || check.status === 'degraded')) {
      return 'degraded';
    }
    if (checks.some((check) => check.status === 'unknown')) return 'degraded';
    return 'connected';
  }

  private pluginsFromArgs(args: string[]): string[] {
    const text = args.join(' ');
    const plugins = new Set<string>();
    for (const plugin of [
      'memory',
      'web-search',
      'web-extraction',
      'browser',
      'canvas',
      'nodes',
      'file-transfer',
      'webhooks',
      'skill-workshop',
      'policy',
      'workboard',
      'acp',
      'codex-supervisor',
    ]) {
      const pattern = new RegExp(`\\b${plugin.replace('-', '[-_]')}\\b`, 'i');
      if (pattern.test(text)) plugins.add(plugin);
    }
    return Array.from(plugins);
  }

  private metadata(agent: RegisteredAgent): Record<string, unknown> {
    return agent.metadata && typeof agent.metadata === 'object' ? agent.metadata : {};
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
  }

  private stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private booleanValue(value: unknown): boolean {
    return value === true || value === 'true';
  }

  private numberValue(value: unknown): number {
    const parsed =
      typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private postureStatus(value: unknown): ContextProviderPostureStatus | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().toLowerCase();
    if (
      normalized === 'safe' ||
      normalized === 'normal' ||
      normalized === 'risky' ||
      normalized === 'degraded' ||
      normalized === 'stale' ||
      normalized === 'disconnected' ||
      normalized === 'unknown'
    ) {
      return normalized;
    }
    if (normalized === 'ok' || normalized === 'pass' || normalized === 'passed') return 'normal';
    if (normalized === 'fail' || normalized === 'failed' || normalized === 'error') {
      return 'degraded';
    }
    return undefined;
  }

  private safePluginName(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '-')
      .slice(0, 80);
  }

  private capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
}

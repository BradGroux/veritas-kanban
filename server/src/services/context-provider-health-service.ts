import type { AgentConfig, FeatureSettings } from '@veritas-kanban/shared';
import { ConfigService } from './config-service.js';
import { CodexHealthService, type CodexHealthStatus } from './codex-health-service.js';

export type ContextProviderState = 'connected' | 'degraded' | 'stale' | 'disconnected' | 'unknown';

export type ContextProviderRisk = 'safe' | 'normal' | 'risky';
export type ContextProviderBoundary = 'local' | 'cloud' | 'mixed' | 'unknown';

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
}

export class ContextProviderHealthService {
  private configService: Pick<ConfigService, 'getConfig' | 'getFeatureSettings'>;
  private codexHealthService: Pick<CodexHealthService, 'getHealth'>;

  constructor(options: ContextProviderHealthServiceOptions = {}) {
    this.configService = options.configService ?? new ConfigService();
    this.codexHealthService = options.codexHealthService ?? new CodexHealthService();
  }

  async getHealth(): Promise<ContextProviderHealthResponse> {
    const checkedAt = new Date().toISOString();
    const [config, featureSettings, codexHealth] = await Promise.all([
      this.configService.getConfig(),
      this.configService.getFeatureSettings(),
      this.codexHealthService.getHealth(),
    ]);

    const providers = [
      this.codexProvider(codexHealth, checkedAt),
      this.openClawProvider(config.agents, featureSettings, checkedAt),
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
    checkedAt: string
  ): ContextProviderHealth {
    const openClawAgents = agents.filter((agent) => agent.provider === 'openclaw');
    const enabledAgents = openClawAgents.filter((agent) => agent.enabled);
    const gatewayConfigured =
      featureSettings.squadWebhook.mode === 'openclaw' &&
      Boolean(featureSettings.squadWebhook.openclawGatewayUrl);
    const riskyArgs = openClawAgents.flatMap((agent) =>
      [agent.command, ...agent.args].filter((value) => this.isRiskyOpenClawArg(value))
    );
    const state: ContextProviderState =
      enabledAgents.length > 0 || gatewayConfigured
        ? 'unknown'
        : openClawAgents.length > 0
          ? 'degraded'
          : 'disconnected';
    const risk: ContextProviderRisk = riskyArgs.length > 0 ? 'risky' : 'normal';

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
      detail:
        enabledAgents.length > 0
          ? `${enabledAgents.length} enabled OpenClaw agent profile(s) detected.`
          : gatewayConfigured
            ? 'OpenClaw gateway is configured for squad wakeups.'
            : 'No enabled OpenClaw agent profile or gateway was found.',
      tools: [
        gatewayConfigured ? 'gateway' : undefined,
        ...openClawAgents.map((agent) => `agent:${agent.type}`),
      ].filter((tool): tool is string => Boolean(tool)),
      postureFlags: [
        gatewayConfigured ? 'Gateway configured' : 'Gateway not configured',
        enabledAgents.length > 0 ? 'Write-capable agent profile enabled' : 'No enabled profile',
        riskyArgs.length > 0 ? 'Risky exec/elevated argument detected' : 'No risky args detected',
        'Doctor/policy check not yet connected',
      ],
      recommendations: [
        gatewayConfigured || openClawAgents.length > 0
          ? 'Connect OpenClaw doctor/policy output to replace unknown posture.'
          : 'Add an OpenClaw profile or gateway before expecting posture checks.',
        riskyArgs.length > 0
          ? 'Review OpenClaw exec/elevated arguments before autonomous runs.'
          : undefined,
      ].filter((item): item is string => Boolean(item)),
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
}

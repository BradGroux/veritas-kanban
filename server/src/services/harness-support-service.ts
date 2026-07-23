import type {
  AgentConfig,
  HarnessSupportFailureClass,
  HarnessSupportStatus,
  HarnessSupportTier,
  ProviderRuntimeManifest,
} from '@veritas-kanban/shared';
import {
  AgentHealthService,
  type AgentHealthChecker,
  type AgentHealthStatus,
} from './agent-health-service.js';
import { ConfigService } from './config-service.js';
import { normalizeHarnessSupportProfile } from './harness-support-profile-registry.js';
import { sanitizeProviderRuntimeDiagnostic } from '../utils/provider-runtime-manifest-sanitize.js';

export type HarnessRuntimeProbe = (
  agent: AgentConfig
) => Promise<ProviderRuntimeManifest | undefined>;

export interface HarnessSupportServiceOptions {
  configService?: ConfigService;
  health?: AgentHealthChecker;
  runtimeProbe?: HarnessRuntimeProbe;
  platform?: NodeJS.Platform;
}

export class HarnessSupportService {
  private readonly configService: ConfigService;
  private readonly health: AgentHealthChecker;
  private readonly runtimeProbe?: HarnessRuntimeProbe;
  private readonly platform: NodeJS.Platform;

  constructor(options: HarnessSupportServiceOptions = {}) {
    this.configService = options.configService ?? new ConfigService();
    this.health = options.health ?? new AgentHealthService();
    this.runtimeProbe =
      options.runtimeProbe ??
      (async (agent) => {
        const { clawdbotAgentService } = await import('./clawdbot-agent-service.js');
        return clawdbotAgentService.probeProviderRuntime(agent);
      });
    this.platform = options.platform ?? process.platform;
  }

  async list(): Promise<HarnessSupportStatus[]> {
    const config = await this.configService.getConfig();
    return Promise.all(
      config.agents.map(async (agent) => {
        const health = await this.health.checkAgent(agent);
        let manifest: ProviderRuntimeManifest | undefined;
        let probeError: string | undefined;
        if (agent.supportProfile?.adapterId && health.healthy && this.runtimeProbe) {
          try {
            manifest = await this.runtimeProbe(agent);
          } catch (error) {
            probeError = error instanceof Error ? error.message : 'Provider runtime probe failed.';
          }
        }
        return evaluateHarnessSupportStatus(agent, health, manifest, this.platform, probeError);
      })
    );
  }
}

export function evaluateHarnessSupportStatus(
  agent: AgentConfig,
  health: AgentHealthStatus,
  manifest?: ProviderRuntimeManifest,
  platform: NodeJS.Platform = process.platform,
  probeError?: string
): HarnessSupportStatus {
  const profile = agent.supportProfile ?? normalizeHarnessSupportProfile(agent);
  const providerVersion = manifest?.providerVersion ?? health.providerVersion;
  const base = {
    agentType: agent.type,
    enabled: agent.enabled,
    profileId: profile.id,
    ...(profile.adapterId ? { adapterId: profile.adapterId } : {}),
    transport: profile.transport,
    checkedAt: health.checkedAt,
    executableFound: health.executableFound,
    authenticated: health.authenticated,
    ...(providerVersion ? { providerVersion: sanitized(providerVersion) } : {}),
    ...(manifest?.providerBuild ? { providerBuild: sanitized(manifest.providerBuild) } : {}),
    ...(manifest?.digest ? { manifestDigest: manifest.digest } : {}),
    diagnosticCommands: buildDiagnosticCommands(profile),
    remediation: profile.remediation.map(sanitized),
  };

  if (!profile.platforms.includes(platform as 'darwin' | 'linux' | 'win32')) {
    return status(
      base,
      'unsupported',
      'unsupported-platform',
      `The ${profile.displayName} support profile does not support ${platform}.`
    );
  }

  if (!profile.adapterId) {
    return status(base, 'unsupported', 'adapter-unavailable', profile.supportReason);
  }

  if (agent.provider && agent.provider !== profile.adapterId) {
    return status(
      base,
      'unsupported',
      'adapter-unavailable',
      `Configured provider ${agent.provider} does not match support adapter ${profile.adapterId}.`
    );
  }

  if (profile.supportTier === 'degraded') {
    return status(base, 'degraded', 'unsafe-configuration', profile.supportReason);
  }

  if (!health.executableFound) {
    return status(
      base,
      'degraded',
      'not-installed',
      `Executable ${profile.executable.command} was not found.`
    );
  }

  if (!agent.enabled) {
    return status(
      base,
      'detected',
      'disabled',
      'The executable is installed but the agent is disabled.'
    );
  }

  if (health.authenticated === false) {
    return status(
      base,
      'degraded',
      'unauthenticated',
      health.reason ?? 'The non-mutating authentication probe failed.'
    );
  }

  if (probeError) {
    return status(base, 'degraded', 'probe-failed', probeError);
  }

  if (manifest?.probe.state === 'failed' || manifest?.probe.state === 'degraded') {
    return status(
      base,
      'degraded',
      'probe-failed',
      manifest.probe.diagnostics[0] ?? 'The provider runtime probe did not return ready evidence.'
    );
  }

  const installedVersion = manifest?.providerVersion ?? health.providerVersion;
  if (
    (manifest && manifest.adapter !== profile.adapterId) ||
    (profile.compatibility.testedVersions.length > 0 &&
      (!installedVersion || !profile.compatibility.testedVersions.includes(installedVersion)))
  ) {
    return status(
      base,
      'degraded',
      'incompatible-build',
      manifest && manifest.adapter !== profile.adapterId
        ? `Runtime adapter ${manifest.adapter} does not match support adapter ${profile.adapterId}.`
        : `Provider version ${installedVersion ?? 'unknown'} is outside the tested compatibility policy.`
    );
  }

  const certification = profile.conformance;
  if (certification.status === 'failed') {
    return status(
      base,
      'degraded',
      'probe-failed',
      'The most recent harness conformance certification failed.'
    );
  }

  const certificationMatches =
    certification.status === 'passed' &&
    Boolean(manifest) &&
    certification.manifestDigest === manifest?.digest &&
    (!profile.compatibility.invalidateOn.includes('provider-version') ||
      certification.providerVersion === manifest?.providerVersion) &&
    (!profile.compatibility.invalidateOn.includes('provider-build') ||
      certification.providerBuild === manifest?.providerBuild) &&
    (!profile.compatibility.invalidateOn.includes('configuration-digest') ||
      certification.configurationDigest === profile.compatibility.configurationDigest) &&
    (!profile.compatibility.invalidateOn.includes('probe-revision') ||
      certification.probeRevision === manifest?.probeRevision);
  if (
    certification.status === 'stale' ||
    (certification.status === 'passed' && !certificationMatches)
  ) {
    return status(
      base,
      'degraded',
      'certification-stale',
      'The certified provider evidence no longer matches the installed runtime.'
    );
  }

  if (certificationMatches) {
    return status(
      base,
      'certified',
      'none',
      'The installed runtime matches the most recent passing conformance evidence.'
    );
  }

  return status(
    base,
    'configured',
    'none',
    'The executable adapter is configured; certification evidence is not current.'
  );
}

function status(
  base: Omit<HarnessSupportStatus, 'supportTier' | 'failureClass' | 'reason'>,
  supportTier: HarnessSupportTier,
  failureClass: HarnessSupportFailureClass,
  reason: string
): HarnessSupportStatus {
  return {
    ...base,
    supportTier,
    failureClass,
    reason: sanitized(reason),
  };
}

function sanitized(value: string): string {
  return sanitizeProviderRuntimeDiagnostic(value);
}

function buildDiagnosticCommands(profile: NonNullable<AgentConfig['supportProfile']>): string[] {
  const executable = profile.executable.command.trim().split(/\s+/)[0]?.split(/[\\/]/).pop();
  if (!executable) return [];

  const commands = [
    [executable, ...profile.executable.versionArgs],
    ...(profile.authentication.kind === 'command' && profile.authentication.commandArgs
      ? [[executable, ...profile.authentication.commandArgs]]
      : []),
  ];
  return commands.map((parts) => sanitized(parts.join(' ')));
}

import path from 'node:path';
import {
  EXECUTABLE_AGENT_PROVIDERS,
  type AgentConfig,
  type AgentType,
  type ExecutableAgentProvider,
} from '@veritas-kanban/shared';
import { ConflictError } from '../middleware/error-handler.js';
import { getInstalledPackageVersion } from '../utils/package-version.js';
import type { AgentHealthStatus } from './agent-health-service.js';
import { CODEX_APP_SERVER_CERTIFIED_BUILD } from './codex-app-server-adapter.js';
import { normalizeHarnessSupportProfile } from './harness-support-profile-registry.js';
import type { ProviderRuntimeAdapterDefinition } from './provider-runtime-adapter-registry.js';
import type { ProviderRuntimeProbeRequest } from './provider-runtime-manifest-service.js';

const EXECUTABLE_PROVIDERS = new Set<ExecutableAgentProvider>(EXECUTABLE_AGENT_PROVIDERS);

const LEGACY_PROVIDER_INFERENCE: Partial<
  Record<AgentType, { command: string; provider: ExecutableAgentProvider }>
> = {
  'codex-app-server': { command: 'codex', provider: 'codex-app-server' },
  'claude-code': { command: 'claude', provider: 'claude-code' },
  codex: { command: 'codex', provider: 'codex-cli' },
  hermes: { command: 'hermes', provider: 'hermes-cli' },
};

export interface AgentProviderProbeContext {
  agentConfig?: AgentConfig;
  health: AgentHealthStatus;
  cwd?: string;
}

export function buildProviderRuntimeProbeRequest(
  provider: ExecutableAgentProvider,
  context: AgentProviderProbeContext,
  definition: ProviderRuntimeAdapterDefinition
): ProviderRuntimeProbeRequest {
  const sdkVersion =
    provider === 'codex-sdk' ? getInstalledPackageVersion('@openai/codex-sdk') : undefined;
  const configuredOpenClawVersion =
    provider === 'openclaw' ? process.env.OPENCLAW_GATEWAY_VERSION?.trim() : undefined;
  const providerVersion =
    sdkVersion ||
    configuredOpenClawVersion ||
    (provider === 'openclaw' ? undefined : context.health.providerVersion);
  const providerBuild =
    provider === 'codex-sdk' && context.health.providerVersion
      ? `codex-cli:${context.health.providerVersion}`
      : provider === 'codex-app-server'
        ? CODEX_APP_SERVER_CERTIFIED_BUILD
        : undefined;
  const diagnostics: string[] = [...(context.health.diagnostics ?? [])];

  if (!providerVersion) {
    diagnostics.push(
      provider === 'openclaw'
        ? 'OpenClaw runtime version was not registered; set OPENCLAW_GATEWAY_VERSION or register a host manifest.'
        : 'The provider version command did not return verifiable output.'
    );
  }

  return {
    provider,
    adapter: definition.id,
    protocolVersion: definition.protocolVersion,
    command:
      provider === 'openclaw'
        ? process.env.OPENCLAW_GATEWAY_URL ||
          process.env.CLAWDBOT_GATEWAY ||
          process.env.CLAWDBOT_GATEWAY_URL ||
          'openclaw'
        : context.agentConfig?.command,
    models: context.agentConfig?.model ? [context.agentConfig.model] : [],
    identity: {
      providerVersion,
      providerBuild,
      verified: provider === 'openclaw' ? false : Boolean(providerVersion),
      source:
        provider === 'codex-sdk'
          ? 'installed-package:@openai/codex-sdk'
          : configuredOpenClawVersion
            ? 'environment:OPENCLAW_GATEWAY_VERSION'
            : context.health.providerVersionSource || 'agent-health',
      authenticated: context.health.authenticated,
      executableFingerprint: context.health.executablePath,
      diagnostics,
    },
    capabilities: definition.capabilities,
  };
}

export function resolveExecutableAgentProvider(
  agentConfig: AgentConfig | undefined,
  agent: AgentType
): ExecutableAgentProvider {
  let provider: ExecutableAgentProvider | undefined;
  if (agentConfig?.provider) {
    if (EXECUTABLE_PROVIDERS.has(agentConfig.provider as ExecutableAgentProvider)) {
      provider = agentConfig.provider as ExecutableAgentProvider;
    } else {
      throw new ConflictError(
        `Provider "${agentConfig.provider}" is configured but has no execution adapter`,
        {
          agent,
          provider: agentConfig.provider,
          reason: 'No executable provider adapter is registered',
        }
      );
    }
  } else {
    const legacyInference = LEGACY_PROVIDER_INFERENCE[agent];
    const command = path.basename(agentConfig?.command.trim().split(/\s+/)[0] ?? '');
    if (legacyInference?.command === command) {
      provider = legacyInference.provider;
    }
  }

  if (!provider) {
    throw new ConflictError(`Agent "${agent}" has no executable provider adapter`, {
      agent,
      command: agentConfig?.command,
      reason: 'No executable provider adapter is configured',
      remediation:
        'Select an agent profile with an explicit executable provider or configure a supported adapter.',
    });
  }

  // Adapter identity is derived from system-owned profile definitions at the
  // dispatch boundary. A caller-provided supportProfile may carry future
  // certification evidence, but it cannot authorize a different adapter.
  const profile = agentConfig ? normalizeHarnessSupportProfile(agentConfig) : undefined;
  if (profile?.supportTier === 'degraded') {
    throw new ConflictError(
      `Harness support profile "${profile.id}" has an unsafe launch configuration`,
      {
        agent,
        profileId: profile.id,
        adapterId: profile.adapterId,
        provider,
        reason: 'Credential material is not allowed in harness launch commands or arguments',
        remediation: profile.remediation,
      }
    );
  }
  if (profile && profile.adapterId !== provider) {
    throw new ConflictError(
      `Harness support profile "${profile.id}" cannot dispatch through "${provider}"`,
      {
        agent,
        profileId: profile.id,
        adapterId: profile.adapterId,
        provider,
        reason: profile.adapterId
          ? 'Harness support profile adapter does not match the configured provider'
          : 'Harness support profile has no executable adapter',
        remediation: profile.remediation,
      }
    );
  }

  return provider;
}

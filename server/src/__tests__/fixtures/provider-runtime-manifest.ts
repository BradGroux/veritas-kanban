import {
  KNOWN_PROVIDER_RUNTIME_CAPABILITY_IDS,
  PROVIDER_RUNTIME_MANIFEST_SCHEMA_VERSION,
  PROVIDER_RUNTIME_PROBE_REVISION,
  type ProviderRuntimeCapabilityId,
  type ProviderRuntimeCapabilityState,
  type ProviderRuntimeManifest,
  type ProviderRuntimeProbeState,
} from '@veritas-kanban/shared';
import { calculateProviderRuntimeManifestDigest } from '../../utils/provider-runtime-manifest-digest.js';

interface ProviderRuntimeManifestFixtureOptions {
  provider?: string;
  adapter?: string;
  providerVersion?: string;
  providerBuild?: string;
  models?: string[];
  probeState?: ProviderRuntimeProbeState;
  capabilityStates?: Partial<Record<ProviderRuntimeCapabilityId, ProviderRuntimeCapabilityState>>;
}

export function providerRuntimeManifestFixture(
  options: ProviderRuntimeManifestFixtureOptions = {}
): ProviderRuntimeManifest {
  const provider = options.provider ?? 'codex-cli';
  const defaultSupported = new Set<ProviderRuntimeCapabilityId>([
    'run.start',
    'run.status',
    'tool.calls',
    'filesystem.read',
    'filesystem.write',
    'environment.allowlist',
  ]);
  const payload: Omit<ProviderRuntimeManifest, 'digest'> = {
    schemaVersion: PROVIDER_RUNTIME_MANIFEST_SCHEMA_VERSION,
    probeRevision: PROVIDER_RUNTIME_PROBE_REVISION,
    provider,
    adapter: options.adapter ?? provider,
    protocolVersion: 'fixture-runtime/v1',
    providerVersion: options.providerVersion ?? `${provider} 1.0.0`,
    ...(options.providerBuild ? { providerBuild: options.providerBuild } : {}),
    models: options.models ?? ['gpt-5'],
    capabilities: KNOWN_PROVIDER_RUNTIME_CAPABILITY_IDS.map((id) => {
      const state =
        options.capabilityStates?.[id] ?? (defaultSupported.has(id) ? 'supported' : 'unknown');
      return {
        id,
        state,
        source: 'contract-test' as const,
        reason: `Fixture reports ${id} as ${state}.`,
      };
    }),
    probe: {
      state: options.probeState ?? 'ready',
      probedAt: '2026-07-15T12:00:00.000Z',
      source: 'fixture',
      diagnostics: [],
    },
  };
  return {
    ...payload,
    digest: calculateProviderRuntimeManifestDigest(payload),
  };
}

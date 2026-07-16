import { createHash } from 'node:crypto';
import type { ProviderRuntimeManifest } from '@veritas-kanban/shared';

export type ProviderRuntimeManifestPayload = Omit<ProviderRuntimeManifest, 'digest'>;

export function calculateProviderRuntimeManifestDigest(
  manifest: ProviderRuntimeManifestPayload
): string {
  const payload = {
    schemaVersion: manifest.schemaVersion,
    probeRevision: manifest.probeRevision,
    provider: manifest.provider,
    adapter: manifest.adapter,
    protocolVersion: manifest.protocolVersion,
    providerVersion: manifest.providerVersion,
    ...(manifest.providerBuild ? { providerBuild: manifest.providerBuild } : {}),
    models: uniqueSorted(manifest.models),
    capabilities: [...manifest.capabilities]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((capability) => ({
        id: capability.id,
        state: capability.state,
        source: capability.source,
        reason: capability.reason,
      })),
    probe: {
      state: manifest.probe.state,
      probedAt: manifest.probe.probedAt,
      source: manifest.probe.source,
      diagnostics: [...manifest.probe.diagnostics],
    },
  };
  return `sha256:${hashJson(payload)}`;
}

export function verifyProviderRuntimeManifestDigest(manifest: ProviderRuntimeManifest): boolean {
  return manifest.digest === calculateProviderRuntimeManifestDigest(manifest);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

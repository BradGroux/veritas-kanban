import type {
  ProviderRuntimeCapabilityAssessment,
  ProviderRuntimeCapabilityId,
  ProviderRuntimeManifest,
  ProviderRuntimeManifestAssessment,
  ProviderRuntimeSelection,
} from '@veritas-kanban/shared';

export interface ProviderRuntimeSelectionRequest {
  manifests: ProviderRuntimeManifest[];
  provider?: string;
  model?: string;
  requiredCapabilities?: ProviderRuntimeCapabilityId[];
}

export function selectProviderRuntimeManifest(
  request: ProviderRuntimeSelectionRequest
): ProviderRuntimeSelection {
  const requiredCapabilities = uniqueSorted(request.requiredCapabilities ?? []);
  const candidates = request.manifests
    .map((manifest) => assessManifest(manifest, request, requiredCapabilities))
    .sort(compareAssessments);
  const selectedManifest = candidates.find((candidate) => candidate.compatible);

  return {
    requiredCapabilities,
    compatible: selectedManifest !== undefined,
    selectedManifest,
    candidates,
    reason: selectedManifest
      ? selectedManifest.advisory
        ? `Selected manifest ${selectedManifest.manifestDigest} with advisory capability evidence.`
        : `Selected manifest ${selectedManifest.manifestDigest} with supported capability evidence.`
      : candidates.length === 0
        ? 'No validated provider runtime manifest is registered.'
        : 'No single validated provider runtime manifest satisfies the provider, model, and capability requirements.',
  };
}

function assessManifest(
  manifest: ProviderRuntimeManifest,
  request: ProviderRuntimeSelectionRequest,
  requiredCapabilities: ProviderRuntimeCapabilityId[]
): ProviderRuntimeManifestAssessment {
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (manifest.probe.state === 'failed') {
    reasons.push('The manifest readiness probe failed.');
  } else if (manifest.probe.state === 'degraded') {
    warnings.push('The manifest readiness probe is degraded.');
  }

  if (
    request.provider &&
    normalize(request.provider) !== normalize(manifest.provider) &&
    normalize(request.provider) !== normalize(manifest.adapter)
  ) {
    reasons.push(`Provider ${request.provider} does not match this manifest.`);
  }

  if (
    request.model &&
    !manifest.models.some(
      (candidate) => normalize(candidate) === normalize(request.model as string)
    )
  ) {
    reasons.push(`Model ${request.model} is not reported by this manifest.`);
  }

  const capabilities = requiredCapabilities.map((capabilityId) =>
    assessCapability(manifest, capabilityId)
  );
  for (const capability of capabilities) {
    if (!capability.satisfied) {
      reasons.push(`${capability.id}: ${capability.reason}`);
    } else if (capability.advisory) {
      warnings.push(`${capability.id}: ${capability.reason}`);
    }
  }

  return {
    manifestDigest: manifest.digest,
    provider: manifest.provider,
    adapter: manifest.adapter,
    providerVersion: manifest.providerVersion,
    models: [...manifest.models],
    probeState: manifest.probe.state,
    compatible: reasons.length === 0,
    advisory: warnings.length > 0,
    capabilities,
    reasons,
    warnings,
  };
}

function assessCapability(
  manifest: ProviderRuntimeManifest,
  capabilityId: ProviderRuntimeCapabilityId
): ProviderRuntimeCapabilityAssessment {
  const evidence = manifest.capabilities.find((capability) => capability.id === capabilityId);
  if (!evidence) {
    return {
      id: capabilityId,
      state: 'unknown',
      satisfied: false,
      advisory: false,
      reason: 'No capability evidence is present.',
    };
  }

  return {
    id: capabilityId,
    state: evidence.state,
    satisfied: evidence.state === 'supported' || evidence.state === 'advisory',
    advisory: evidence.state === 'advisory',
    reason: evidence.reason,
  };
}

function compareAssessments(
  left: ProviderRuntimeManifestAssessment,
  right: ProviderRuntimeManifestAssessment
): number {
  if (left.compatible !== right.compatible) return left.compatible ? -1 : 1;
  if (left.advisory !== right.advisory) return left.advisory ? 1 : -1;
  if (left.probeState !== right.probeState) {
    return PROBE_STATE_RANK[left.probeState] - PROBE_STATE_RANK[right.probeState];
  }
  return (
    left.provider.localeCompare(right.provider) ||
    left.manifestDigest.localeCompare(right.manifestDigest)
  );
}

const PROBE_STATE_RANK: Record<ProviderRuntimeManifestAssessment['probeState'], number> = {
  ready: 0,
  degraded: 1,
  failed: 2,
};

function uniqueSorted(values: ProviderRuntimeCapabilityId[]): ProviderRuntimeCapabilityId[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

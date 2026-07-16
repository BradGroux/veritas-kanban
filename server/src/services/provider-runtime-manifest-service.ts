import { createHash } from 'node:crypto';
import {
  KNOWN_PROVIDER_RUNTIME_CAPABILITY_IDS,
  PROVIDER_RUNTIME_MANIFEST_SCHEMA_VERSION,
  PROVIDER_RUNTIME_PROBE_REVISION,
  type KnownProviderRuntimeCapabilityId,
  type ProviderRuntimeCapabilityEvidence,
  type ProviderRuntimeCapabilityState,
  type ProviderRuntimeEvidenceSource,
  type ProviderRuntimeManifest,
} from '@veritas-kanban/shared';
import { parseProviderRuntimeManifest } from '../schemas/provider-runtime-manifest-schemas.js';
import { calculateProviderRuntimeManifestDigest } from '../utils/provider-runtime-manifest-digest.js';
import { sanitizeProviderRuntimeDiagnostic } from '../utils/provider-runtime-manifest-sanitize.js';

export {
  calculateProviderRuntimeManifestDigest,
  verifyProviderRuntimeManifestDigest,
} from '../utils/provider-runtime-manifest-digest.js';
export type { ProviderRuntimeManifestPayload } from '../utils/provider-runtime-manifest-digest.js';

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CONFORMANCE_PROBE_TIMEOUT_MS = 5_000;
const MAX_DIAGNOSTIC_BYTES = 8 * 1024;

export interface ProviderRuntimeIdentityEvidence {
  providerVersion?: string;
  providerBuild?: string;
  source: string;
  verified?: boolean;
  authenticated?: boolean | null;
  executableFingerprint?: string;
  diagnostics?: string[];
}

export interface ProviderRuntimeProbeRequest {
  provider: string;
  adapter: string;
  protocolVersion: string;
  command?: string;
  models?: string[];
  identity: ProviderRuntimeIdentityEvidence;
  capabilities: ProviderRuntimeCapabilityEvidence[];
}

export interface ProviderRuntimeManifestServiceOptions {
  cacheTtlMs?: number;
  conformanceProbeTimeoutMs?: number;
  now?: () => Date;
  conformanceProbe?: (
    request: ProviderRuntimeProbeRequest
  ) => Promise<ProviderRuntimeCapabilityEvidence[]>;
}

interface CacheEntry {
  fullKey: string;
  cachedAt: number;
  manifest: ProviderRuntimeManifest;
}

export interface ProviderRuntimeCapabilityOverride {
  state: ProviderRuntimeCapabilityState;
  reason: string;
  source?: ProviderRuntimeEvidenceSource;
}

export type ProviderRuntimeCapabilityOverrides = Partial<
  Record<KnownProviderRuntimeCapabilityId, ProviderRuntimeCapabilityOverride>
>;

export function buildProviderRuntimeCapabilities(
  overrides: ProviderRuntimeCapabilityOverrides
): ProviderRuntimeCapabilityEvidence[] {
  return KNOWN_PROVIDER_RUNTIME_CAPABILITY_IDS.map((id) => {
    const override = overrides[id];
    return {
      id,
      state: override?.state ?? 'unknown',
      source: override?.source ?? 'contract-test',
      reason: override?.reason ?? 'No adapter conformance evidence is available yet.',
    };
  });
}

export class ProviderRuntimeManifestService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<ProviderRuntimeManifest>>();
  private readonly latestFullKeyByScope = new Map<string, string>();
  private readonly cacheTtlMs: number;
  private readonly conformanceProbeTimeoutMs: number;
  private readonly now: () => Date;
  private cacheGeneration = 0;
  private readonly conformanceProbe: NonNullable<
    ProviderRuntimeManifestServiceOptions['conformanceProbe']
  >;

  constructor(options: ProviderRuntimeManifestServiceOptions = {}) {
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.conformanceProbeTimeoutMs =
      options.conformanceProbeTimeoutMs ?? DEFAULT_CONFORMANCE_PROBE_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
    this.conformanceProbe =
      options.conformanceProbe ?? (async (request) => structuredClone(request.capabilities));
  }

  async probe(request: ProviderRuntimeProbeRequest): Promise<ProviderRuntimeManifest> {
    const scopeKey = hashJson({
      schemaVersion: PROVIDER_RUNTIME_MANIFEST_SCHEMA_VERSION,
      probeRevision: PROVIDER_RUNTIME_PROBE_REVISION,
      provider: request.provider,
      adapter: request.adapter,
      protocolVersion: request.protocolVersion,
      command: request.command ?? '',
      models: uniqueSorted(request.models ?? []),
    });
    const providerVersion = normalizedIdentityValue(request.identity.providerVersion, 200);
    const providerBuild = normalizedOptionalIdentityValue(request.identity.providerBuild, 300);
    const fullKey = hashJson({
      scopeKey,
      providerVersion,
      providerBuild,
      verified: request.identity.verified ?? false,
      authenticated: request.identity.authenticated ?? null,
      executableFingerprint: request.identity.executableFingerprint ?? '',
    });
    const nowMs = this.now().getTime();
    const cached = this.cache.get(scopeKey);

    if (
      providerVersion !== 'unknown' &&
      cached !== undefined &&
      cached.fullKey === fullKey &&
      nowMs - cached.cachedAt < this.cacheTtlMs
    ) {
      return immutableClone(cached.manifest);
    }

    if (cached && cached.fullKey !== fullKey) this.cache.delete(scopeKey);

    const existingProbe = this.inFlight.get(fullKey);
    if (existingProbe) return immutableClone(await existingProbe);

    const cacheGeneration = this.cacheGeneration;
    this.latestFullKeyByScope.set(scopeKey, fullKey);
    const probe = this.buildManifest(request, providerVersion, providerBuild);
    this.inFlight.set(fullKey, probe);

    try {
      const manifest = await probe;
      if (
        providerVersion !== 'unknown' &&
        manifest.probe.state !== 'failed' &&
        this.cacheGeneration === cacheGeneration &&
        this.latestFullKeyByScope.get(scopeKey) === fullKey
      ) {
        this.cache.set(scopeKey, {
          fullKey,
          cachedAt: this.now().getTime(),
          manifest,
        });
      }
      return immutableClone(manifest);
    } finally {
      if (this.inFlight.get(fullKey) === probe) this.inFlight.delete(fullKey);
      if (
        this.cacheGeneration === cacheGeneration &&
        this.latestFullKeyByScope.get(scopeKey) === fullKey &&
        !this.cache.has(scopeKey)
      ) {
        this.latestFullKeyByScope.delete(scopeKey);
      }
    }
  }

  clear(): void {
    this.cacheGeneration += 1;
    this.cache.clear();
    this.inFlight.clear();
    this.latestFullKeyByScope.clear();
  }

  private async buildManifest(
    request: ProviderRuntimeProbeRequest,
    providerVersion: string,
    providerBuild: string | undefined
  ): Promise<ProviderRuntimeManifest> {
    const probedAt = this.now().toISOString();
    const diagnostics = sanitizeDiagnostics(request.identity.diagnostics ?? []);
    let capabilities: ProviderRuntimeCapabilityEvidence[];
    let probeState: ProviderRuntimeManifest['probe']['state'] =
      providerVersion === 'unknown' || request.identity.verified === false ? 'degraded' : 'ready';

    if (providerVersion === 'unknown') {
      diagnostics.unshift('Provider version could not be verified; this manifest is not cached.');
    } else if (request.identity.verified === false) {
      diagnostics.unshift('Provider version is operator-declared and was not runtime-verified.');
    }

    try {
      capabilities = normalizeCapabilities(
        await withTimeout(
          this.conformanceProbe(request),
          this.conformanceProbeTimeoutMs,
          'Provider conformance probe timed out.'
        )
      );
    } catch (error) {
      probeState = 'failed';
      capabilities = normalizeCapabilities(
        request.capabilities.map((capability) => ({
          ...capability,
          state: 'unknown',
          source: 'runtime-probe',
          reason: 'The provider conformance probe failed before this capability was verified.',
        }))
      );
      diagnostics.push(
        sanitizeDiagnostic(
          error instanceof Error ? error.message : 'Provider conformance probe failed.'
        )
      );
    }

    const payload = {
      schemaVersion: PROVIDER_RUNTIME_MANIFEST_SCHEMA_VERSION,
      probeRevision: PROVIDER_RUNTIME_PROBE_REVISION,
      provider: request.provider,
      adapter: request.adapter,
      protocolVersion: request.protocolVersion,
      providerVersion,
      ...(providerBuild ? { providerBuild } : {}),
      models: uniqueSorted(request.models ?? []),
      capabilities,
      probe: {
        state: probeState,
        probedAt,
        source: sanitizeProviderRuntimeDiagnostic(request.identity.source),
        diagnostics: sanitizeDiagnostics(diagnostics),
      },
    };
    const manifest = {
      ...payload,
      digest: calculateProviderRuntimeManifestDigest(payload),
    };

    return immutableClone(parseProviderRuntimeManifest(manifest));
  }
}

function normalizeCapabilities(
  capabilities: ProviderRuntimeCapabilityEvidence[]
): ProviderRuntimeCapabilityEvidence[] {
  const byId = new Map<string, ProviderRuntimeCapabilityEvidence>();
  for (const capability of capabilities) {
    if (byId.has(capability.id)) {
      throw new Error(`Duplicate provider runtime capability: ${capability.id}`);
    }
    byId.set(capability.id, {
      ...capability,
      reason: sanitizeDiagnostic(capability.reason),
    });
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function normalizedIdentityValue(value: string | undefined, maxLength: number): string {
  return normalizedOptionalIdentityValue(value, maxLength) ?? 'unknown';
}

function normalizedOptionalIdentityValue(
  value: string | undefined,
  maxLength: number
): string | undefined {
  const normalized = value ? sanitizeDiagnostic(value).slice(0, maxLength) : undefined;
  return normalized || undefined;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sanitizeDiagnostics(values: string[]): string[] {
  const diagnostics: string[] = [];
  let bytes = 0;
  for (const value of values) {
    const diagnostic = sanitizeDiagnostic(value);
    if (!diagnostic) continue;
    const size = Buffer.byteLength(diagnostic, 'utf8');
    if (bytes + size > MAX_DIAGNOSTIC_BYTES) break;
    diagnostics.push(diagnostic);
    bytes += size;
  }
  return diagnostics;
}

function sanitizeDiagnostic(value: string): string {
  return sanitizeProviderRuntimeDiagnostic(value);
}

function immutableClone<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), Math.max(1, timeoutMs));
    timer.unref?.();
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

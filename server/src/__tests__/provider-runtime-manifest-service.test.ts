import { describe, expect, it, vi } from 'vitest';
import {
  KNOWN_PROVIDER_RUNTIME_CAPABILITY_IDS,
  PROVIDER_RUNTIME_MANIFEST_SCHEMA_VERSION,
} from '@veritas-kanban/shared';
import {
  buildProviderRuntimeCapabilities,
  ProviderRuntimeManifestService,
  verifyProviderRuntimeManifestDigest,
  type ProviderRuntimeProbeRequest,
} from '../services/provider-runtime-manifest-service.js';
import { ProviderRuntimeManifestSchema } from '../schemas/provider-runtime-manifest-schemas.js';

function request(version = 'fixture 1.0.0'): ProviderRuntimeProbeRequest {
  return {
    provider: 'fixture',
    adapter: 'fixture-adapter',
    protocolVersion: 'fixture/v1',
    command: 'fixture',
    models: ['model-b', 'model-a', 'model-a'],
    identity: {
      providerVersion: version,
      source: 'fixture --version',
      verified: true,
      authenticated: true,
      executableFingerprint: '/private/fixture',
      diagnostics: ['Authorization=super-secret-value'],
    },
    capabilities: buildProviderRuntimeCapabilities({
      'run.start': {
        state: 'supported',
        reason: 'The fixture launch contract passed.',
      },
      'run.stop': {
        state: 'advisory',
        reason: 'The fixture exposes a best-effort stop.',
      },
      'run.resume': {
        state: 'unsupported',
        reason: 'The fixture cannot resume.',
      },
    }),
  };
}

describe('ProviderRuntimeManifestService', () => {
  it('builds a complete, validated, immutable, and redacted v1 manifest', async () => {
    const manifest = await new ProviderRuntimeManifestService().probe(request());

    expect(manifest.schemaVersion).toBe(PROVIDER_RUNTIME_MANIFEST_SCHEMA_VERSION);
    expect(manifest.probe.state).toBe('ready');
    expect(manifest.models).toEqual(['model-a', 'model-b']);
    expect(manifest.capabilities).toHaveLength(KNOWN_PROVIDER_RUNTIME_CAPABILITY_IDS.length);
    expect(manifest.capabilities.find((item) => item.id === 'run.start')?.state).toBe('supported');
    expect(manifest.capabilities.find((item) => item.id === 'run.stop')?.state).toBe('advisory');
    expect(manifest.capabilities.find((item) => item.id === 'run.resume')?.state).toBe(
      'unsupported'
    );
    expect(manifest.probe.diagnostics).toEqual(['Authorization=[REDACTED]']);
    expect(manifest.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(verifyProviderRuntimeManifestDigest(manifest)).toBe(true);
    expect(ProviderRuntimeManifestSchema.safeParse(manifest).success).toBe(true);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.capabilities)).toBe(true);
    expect(
      verifyProviderRuntimeManifestDigest({
        ...structuredClone(manifest),
        providerVersion: 'tampered',
      })
    ).toBe(false);
    expect(
      ProviderRuntimeManifestSchema.safeParse({
        ...structuredClone(manifest),
        providerVersion: 'tampered',
      }).success
    ).toBe(false);
  });

  it('serves the same version from cache and reruns conformance after version skew', async () => {
    const conformanceProbe = vi.fn(
      async (input: ProviderRuntimeProbeRequest) => input.capabilities
    );
    const service = new ProviderRuntimeManifestService({ conformanceProbe });

    const first = await service.probe(request('fixture 1.0.0'));
    const second = await service.probe(request('fixture 1.0.0'));
    const upgraded = await service.probe(request('fixture 2.0.0'));

    expect(conformanceProbe).toHaveBeenCalledTimes(2);
    expect(first).not.toBe(second);
    expect(first.digest).toBe(second.digest);
    expect(upgraded.digest).not.toBe(first.digest);
    expect(upgraded.providerVersion).toBe('fixture 2.0.0');
  });

  it('deduplicates concurrent conformance probes for the same provider identity', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const conformanceProbe = vi.fn(async (input: ProviderRuntimeProbeRequest) => {
      await gate;
      return input.capabilities;
    });
    const service = new ProviderRuntimeManifestService({ conformanceProbe });

    const first = service.probe(request());
    const second = service.probe(request());
    release();

    const [firstManifest, secondManifest] = await Promise.all([first, second]);
    expect(conformanceProbe).toHaveBeenCalledOnce();
    expect(firstManifest.digest).toBe(secondManifest.digest);
  });

  it('expires cached conformance evidence after the bounded TTL', async () => {
    let now = new Date('2026-07-16T00:00:00.000Z');
    const conformanceProbe = vi.fn(
      async (input: ProviderRuntimeProbeRequest) => input.capabilities
    );
    const service = new ProviderRuntimeManifestService({
      cacheTtlMs: 100,
      now: () => now,
      conformanceProbe,
    });

    await service.probe(request());
    now = new Date('2026-07-16T00:00:00.050Z');
    await service.probe(request());
    now = new Date('2026-07-16T00:00:00.101Z');
    await service.probe(request());

    expect(conformanceProbe).toHaveBeenCalledTimes(2);
  });

  it('does not positively cache a manifest with an unknown provider version', async () => {
    const conformanceProbe = vi.fn(
      async (input: ProviderRuntimeProbeRequest) => input.capabilities
    );
    const service = new ProviderRuntimeManifestService({ conformanceProbe });
    const unknown = request('');

    const first = await service.probe(unknown);
    const second = await service.probe(unknown);

    expect(first.providerVersion).toBe('unknown');
    expect(first.probe.state).toBe('degraded');
    expect(second.probe.state).toBe('degraded');
    expect(conformanceProbe).toHaveBeenCalledTimes(2);
  });

  it('returns a failed, non-cached manifest when conformance throws', async () => {
    const conformanceProbe = vi.fn(async () => {
      throw new Error('probe failed with token=private-value');
    });
    const service = new ProviderRuntimeManifestService({ conformanceProbe });

    const first = await service.probe(request());
    const second = await service.probe(request());

    expect(first.probe.state).toBe('failed');
    expect(first.probe.diagnostics).toContain('probe failed with token=[REDACTED]');
    expect(first.capabilities.every((capability) => capability.state === 'unknown')).toBe(true);
    expect(second.probe.state).toBe('failed');
    expect(conformanceProbe).toHaveBeenCalledTimes(2);
  });

  it('bounds conformance probes and does not cache timeouts', async () => {
    const conformanceProbe = vi.fn(() => new Promise<never>(() => undefined));
    const service = new ProviderRuntimeManifestService({
      conformanceProbe,
      conformanceProbeTimeoutMs: 5,
    });

    const first = await service.probe(request());
    const second = await service.probe(request());

    expect(first.probe.state).toBe('failed');
    expect(first.probe.diagnostics).toContain('Provider conformance probe timed out.');
    expect(second.probe.state).toBe('failed');
    expect(conformanceProbe).toHaveBeenCalledTimes(2);
  });

  it('does not let a slower stale-version probe replace the latest cache entry', async () => {
    const releases = new Map<string, () => void>();
    const conformanceProbe = vi.fn(
      (input: ProviderRuntimeProbeRequest) =>
        new Promise<ProviderRuntimeProbeRequest['capabilities']>((resolve) => {
          releases.set(input.identity.providerVersion ?? 'unknown', () =>
            resolve(input.capabilities)
          );
        })
    );
    const service = new ProviderRuntimeManifestService({ conformanceProbe });

    const stale = service.probe(request('fixture 1.0.0'));
    const latest = service.probe(request('fixture 2.0.0'));
    releases.get('fixture 2.0.0')?.();
    await latest;
    releases.get('fixture 1.0.0')?.();
    await stale;
    await service.probe(request('fixture 2.0.0'));

    expect(conformanceProbe).toHaveBeenCalledTimes(2);
  });

  it('calculates the digest from canonical field order', async () => {
    const manifest = await new ProviderRuntimeManifestService().probe(request());
    const reordered = {
      ...structuredClone(manifest),
      capabilities: manifest.capabilities.map((capability) => ({
        reason: capability.reason,
        source: capability.source,
        state: capability.state,
        id: capability.id,
      })),
      probe: {
        diagnostics: [...manifest.probe.diagnostics],
        source: manifest.probe.source,
        probedAt: manifest.probe.probedAt,
        state: manifest.probe.state,
      },
    };

    expect(verifyProviderRuntimeManifestDigest(reordered)).toBe(true);
  });

  it('redacts provider identity output before it enters the immutable snapshot', async () => {
    const manifest = await new ProviderRuntimeManifestService().probe(
      request('fixture 1.0.0 token=private-value sk-proj-abcdefghijklmnopqrstuvwxyz')
    );

    expect(manifest.providerVersion).toBe('fixture 1.0.0 token=[REDACTED] [REDACTED]');
    expect(JSON.stringify(manifest)).not.toContain('private-value');
    expect(JSON.stringify(manifest)).not.toContain('sk-proj-');
  });

  it('rejects duplicate capabilities and unknown top-level fields', async () => {
    const manifest = await new ProviderRuntimeManifestService().probe(request());
    const duplicate = {
      ...structuredClone(manifest),
      capabilities: [manifest.capabilities[0], manifest.capabilities[0]],
    };
    const extra = { ...structuredClone(manifest), unexpected: true };

    expect(ProviderRuntimeManifestSchema.safeParse(duplicate).success).toBe(false);
    expect(ProviderRuntimeManifestSchema.safeParse(extra).success).toBe(false);
  });
});

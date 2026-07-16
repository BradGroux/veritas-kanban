import { describe, expect, it } from 'vitest';
import {
  assertProviderRuntimeCapabilities,
  assertProviderRuntimeControl,
  assertProviderRuntimeManifestSnapshot,
  providerRuntimeControl,
  providerRuntimeControls,
  sandboxCapabilitiesFromManifest,
} from '../services/provider-runtime-control-service.js';
import { providerRuntimeManifestFixture } from './fixtures/provider-runtime-manifest.js';

describe('provider runtime control enforcement', () => {
  it.each([
    ['supported', true, false],
    ['advisory', true, true],
    ['unsupported', false, false],
    ['unknown', false, false],
  ] as const)('maps %s evidence into one authoritative control', (state, available, advisory) => {
    const manifest = providerRuntimeManifestFixture({
      capabilityStates: { 'run.stop': state },
    });

    expect(providerRuntimeControl(manifest, 'stop')).toMatchObject({
      capabilityId: 'run.stop',
      state,
      available,
      advisory,
      reason: `Fixture reports run.stop as ${state}.`,
    });
  });

  it('fails closed for missing, failed, and invalid persisted manifests', () => {
    const failed = providerRuntimeManifestFixture({
      probeState: 'failed',
      capabilityStates: { 'run.stop': 'supported' },
    });
    const invalid = { ...providerRuntimeManifestFixture(), digest: 'sha256:'.padEnd(71, '0') };

    expect(providerRuntimeControl(undefined, 'stop').available).toBe(false);
    expect(providerRuntimeControl(failed, 'stop')).toMatchObject({
      available: false,
      reason: 'The manifest readiness probe failed.',
    });
    expect(providerRuntimeControl(invalid, 'stop')).toMatchObject({
      available: false,
      state: 'unknown',
      reason: expect.stringContaining('failed schema or digest validation'),
    });
    expect(() => assertProviderRuntimeControl(invalid, 'stop')).toThrow('stale or invalid');
  });

  it('rejects stale active and persisted snapshot digests', () => {
    const manifest = providerRuntimeManifestFixture();

    expect(() =>
      assertProviderRuntimeManifestSnapshot(manifest, 'sha256:'.padEnd(71, 'f'))
    ).toThrow('digest mismatch');
  });

  it('enforces arbitrary launch requirements without cross-capability inference', () => {
    const manifest = providerRuntimeManifestFixture({
      capabilityStates: {
        'run.start': 'supported',
        'tool.mcp': 'unsupported',
      },
    });

    expect(() =>
      assertProviderRuntimeCapabilities(manifest, ['run.start', 'tool.mcp'], 'test launch')
    ).toThrow('tool.mcp');
  });

  it('returns capability-derived controls and sandbox posture from the same snapshot', () => {
    const manifest = providerRuntimeManifestFixture({
      capabilityStates: {
        'run.stop': 'supported',
        'filesystem.read': 'supported',
        'network.allowlist': 'advisory',
        'network.disable': 'unsupported',
      },
    });

    expect(providerRuntimeControls(manifest)).toMatchObject({
      manifestDigest: manifest.digest,
      provider: manifest.provider,
      controls: expect.arrayContaining([
        expect.objectContaining({ action: 'stop', available: true }),
      ]),
    });
    expect(sandboxCapabilitiesFromManifest(manifest)).toEqual({
      provider: manifest.provider,
      supported: expect.arrayContaining(['filesystem.read']),
      advisory: ['network.allowlist'],
    });
  });
});

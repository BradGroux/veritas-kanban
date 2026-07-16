import { describe, expect, it } from 'vitest';
import { selectProviderRuntimeManifest } from '../services/provider-runtime-capability-service.js';
import { providerRuntimeManifestFixture } from './fixtures/provider-runtime-manifest.js';

describe('selectProviderRuntimeManifest', () => {
  it('selects one manifest with supported required capabilities', () => {
    const selection = selectProviderRuntimeManifest({
      manifests: [providerRuntimeManifestFixture()],
      provider: 'codex-cli',
      model: 'gpt-5',
      requiredCapabilities: ['run.start', 'tool.calls'],
    });

    expect(selection.compatible).toBe(true);
    expect(selection.selectedManifest).toMatchObject({
      provider: 'codex-cli',
      advisory: false,
    });
  });

  it('allows advisory evidence and surfaces a warning', () => {
    const selection = selectProviderRuntimeManifest({
      manifests: [
        providerRuntimeManifestFixture({
          capabilityStates: { 'run.resume': 'advisory' },
        }),
      ],
      requiredCapabilities: ['run.resume'],
    });

    expect(selection.compatible).toBe(true);
    expect(selection.selectedManifest?.advisory).toBe(true);
    expect(selection.selectedManifest?.warnings[0]).toContain('run.resume');
  });

  it.each(['unsupported', 'unknown'] as const)('rejects %s capability evidence', (state) => {
    const selection = selectProviderRuntimeManifest({
      manifests: [
        providerRuntimeManifestFixture({
          capabilityStates: { 'run.resume': state },
        }),
      ],
      requiredCapabilities: ['run.resume'],
    });

    expect(selection.compatible).toBe(false);
    expect(selection.candidates[0]?.capabilities[0]).toMatchObject({ state, satisfied: false });
  });

  it('does not compose required capabilities across manifests', () => {
    const selection = selectProviderRuntimeManifest({
      manifests: [
        providerRuntimeManifestFixture({
          provider: 'custom-a',
          capabilityStates: { 'run.start': 'supported', 'run.resume': 'unsupported' },
        }),
        providerRuntimeManifestFixture({
          provider: 'custom-b',
          capabilityStates: { 'run.start': 'unsupported', 'run.resume': 'supported' },
        }),
      ],
      requiredCapabilities: ['run.start', 'run.resume'],
    });

    expect(selection.compatible).toBe(false);
    expect(selection.candidates).toHaveLength(2);
  });

  it('rejects failed probes and provider or model mismatches', () => {
    const selection = selectProviderRuntimeManifest({
      manifests: [
        providerRuntimeManifestFixture({ probeState: 'failed' }),
        providerRuntimeManifestFixture({ provider: 'custom', models: ['other-model'] }),
      ],
      provider: 'custom',
      model: 'gpt-5',
      requiredCapabilities: ['run.start'],
    });

    expect(selection.compatible).toBe(false);
    expect(selection.candidates.flatMap((candidate) => candidate.reasons).join(' ')).toContain(
      'not reported'
    );
  });

  it('orders mixed probe states deterministically', () => {
    const manifests = (['failed', 'degraded', 'ready'] as const).map((probeState) =>
      providerRuntimeManifestFixture({
        provider: `provider-${probeState}`,
        probeState,
        capabilityStates: { 'run.resume': 'advisory' },
      })
    );

    const first = selectProviderRuntimeManifest({
      manifests,
      provider: 'non-matching-provider',
      requiredCapabilities: ['run.resume'],
    });
    const second = selectProviderRuntimeManifest({
      manifests: [...manifests].reverse(),
      provider: 'non-matching-provider',
      requiredCapabilities: ['run.resume'],
    });

    expect(first.candidates.map((candidate) => candidate.probeState)).toEqual([
      'ready',
      'degraded',
      'failed',
    ]);
    expect(second.candidates.map((candidate) => candidate.manifestDigest)).toEqual(
      first.candidates.map((candidate) => candidate.manifestDigest)
    );
  });
});

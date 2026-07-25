import { describe, expect, it } from 'vitest';
import type { ProviderRuntimeManifest, SandboxPolicyDryRunResult } from '@veritas-kanban/shared';
import { PhaseLaunchAuthorityService } from '../services/phase-launch-authority-service.js';
import { providerRuntimeManifestFixture } from './fixtures/provider-runtime-manifest.js';

const sandboxPolicy: SandboxPolicyDryRunResult = {
  decision: 'allow',
  provider: 'codex-sdk',
  preset: {
    id: 'workflow-default',
    name: 'Workflow default',
    enabled: true,
    enforcement: 'required',
    requiredCapabilities: [],
    filesystem: {
      readPaths: ['<workspace>'],
      writePaths: ['<workspace>'],
      deniedPaths: [],
      dotfileMasking: false,
      localOnlyHandles: true,
    },
    network: {
      defaultEgress: 'allow',
      allowedHosts: [],
      allowedMethods: [],
      allowedPathPrefixes: [],
      blockPrivateNetwork: true,
      blockMetadataEndpoints: true,
      blockLoopback: false,
    },
    environment: {
      passthrough: ['PATH', 'OPENAI_API_KEY'],
      redactDisplay: true,
    },
    credentials: {
      mode: 'env-passthrough',
      brokerRefs: [],
    },
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
  },
  effective: {
    sandboxMode: 'workspace-write',
    networkAccessEnabled: true,
    envPassthrough: ['PATH', 'OPENAI_API_KEY'],
    credentialRefs: [],
    filesystemBackend: {
      backend: 'codex-sandbox',
      state: 'available',
      capabilityVersion: 'codex-sandbox-state/v1',
      backendVersion: '1.0.0',
      platformBackend: 'seatbelt',
      supported: ['filesystem.read', 'filesystem.write'],
      reason: 'Fixture filesystem boundary is available.',
    },
  },
  evaluations: [],
  unsupportedRules: [],
  warnings: [],
};

function runtime(provider = 'codex-sdk'): ProviderRuntimeManifest {
  return providerRuntimeManifestFixture({
    provider,
    capabilityStates: {
      'filesystem.read': 'supported',
      'filesystem.write': 'supported',
      'network.disable': 'supported',
      'network.allowlist': 'supported',
      'environment.allowlist': 'supported',
      'credential.broker': 'supported',
    },
  });
}

const enforcedExecution = {
  commandExecute: 'enforced',
  externalAction: 'enforced',
  planArtifactWrite: 'enforced',
} as const;

describe('PhaseLaunchAuthorityService', () => {
  it('records explicit legacy evidence without inventing phase restrictions', () => {
    const phase = new PhaseLaunchAuthorityService().compile({
      sandboxPolicy,
      providerRuntimeManifest: runtime(),
      selectedHost: 'local-process',
    });

    expect(phase.evidence.identity).toEqual({ mode: 'legacy', phase: 'legacy' });
    expect(phase.evidence.status).not.toBe('blocked');
    expect(phase.evidence.warnings).toContain(
      'Legacy mode applies no phase profile; existing parent, agent, sandbox, tool, and launch policies remain authoritative.'
    );
    expect(phase.sourceReferences.map((reference) => reference.kind).sort()).toEqual([
      'agent-profile',
      'launch-policy',
      'parent',
      'sandbox',
      'tool-catalog',
    ]);
  });

  it('returns typed blockers when command and external enforcement are unavailable', () => {
    const phase = new PhaseLaunchAuthorityService().compile({
      requestedPhase: 'explore',
      sandboxPolicy,
      providerRuntimeManifest: runtime(),
      selectedHost: 'local-process',
    });

    expect(phase.evidence.status).toBe('blocked');
    expect(phase.evidence.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'required-authority-unsupported',
          dimension: 'command.execute',
          sourceId: 'tool-catalog:none',
        }),
        expect.objectContaining({
          code: 'required-authority-unsupported',
          dimension: 'external.action',
          sourceId: 'tool-catalog:none',
        }),
      ])
    );
    expect(() => new PhaseLaunchAuthorityService().assertEnforceable(phase)).toThrow(
      'effective phase authority cannot be enforced'
    );
  });

  it('intersects descendants with the exact parent snapshot across provider changes', () => {
    const service = new PhaseLaunchAuthorityService();
    const parent = service.compile({
      requestedPhase: 'implement',
      sandboxPolicy,
      providerRuntimeManifest: runtime('codex-sdk'),
      selectedHost: 'local-process',
      executionEnforcement: enforcedExecution,
    });
    const child = service.compile({
      requestedPhase: 'publish',
      parent: {
        attemptId: 'run_parent:step:0',
        manifestDigest: `sha256:${'a'.repeat(64)}`,
        evidence: parent.evidence,
      },
      sandboxPolicy,
      providerRuntimeManifest: runtime('openclaw'),
      selectedHost: 'openclaw-gateway',
      executionEnforcement: enforcedExecution,
    });

    expect(child.evidence.status).not.toBe('blocked');
    expect(child.evidence.effectiveAuthority['external.action']).toEqual(['read']);
    expect(child.evidence.effectiveAuthority['credential.access']).toEqual(
      parent.evidence.effectiveAuthority['credential.access']
    );
    expect(child.sourceReferences.find((reference) => reference.kind === 'parent')).toMatchObject({
      originScope: 'parent',
      parentAttemptId: 'run_parent:step:0',
      parentManifestDigest: `sha256:${'a'.repeat(64)}`,
      parentEvidenceDigest: parent.evidence.digest,
    });
  });

  it('blocks a wider publish retry when the parent denied credential authority', () => {
    const service = new PhaseLaunchAuthorityService();
    const parent = service.compile({
      requestedPhase: 'verify',
      sandboxPolicy,
      providerRuntimeManifest: runtime(),
      selectedHost: 'local-process',
      executionEnforcement: enforcedExecution,
    });
    const child = service.compile({
      requestedPhase: 'publish',
      parent: {
        attemptId: 'run_parent:verify:0',
        manifestDigest: `sha256:${'b'.repeat(64)}`,
        evidence: parent.evidence,
      },
      sandboxPolicy,
      providerRuntimeManifest: runtime('openclaw'),
      selectedHost: 'openclaw-gateway',
      executionEnforcement: enforcedExecution,
    });

    expect(child.evidence.status).toBe('blocked');
    expect(child.evidence.blockers).toContainEqual(
      expect.objectContaining({
        code: 'required-authority-denied',
        dimension: 'credential.access',
      })
    );
    expect(child.evidence.effectiveAuthority['credential.access']).toEqual([]);
  });

  it('rejects tampered parent evidence before compiling a continuation', () => {
    const service = new PhaseLaunchAuthorityService();
    const parent = service.compile({
      requestedPhase: 'verify',
      sandboxPolicy,
      providerRuntimeManifest: runtime(),
      selectedHost: 'local-process',
      executionEnforcement: enforcedExecution,
    });

    expect(() =>
      service.compile({
        parent: {
          attemptId: 'run_parent:verify:0',
          manifestDigest: `sha256:${'c'.repeat(64)}`,
          evidence: {
            ...parent.evidence,
            warnings: [...parent.evidence.warnings, 'tampered'],
          },
        },
        sandboxPolicy,
        providerRuntimeManifest: runtime(),
        selectedHost: 'local-process',
        executionEnforcement: enforcedExecution,
      })
    ).toThrow('Parent phase evidence digest does not match its content');
  });

  it('narrows concrete sandbox rules before provider launch', () => {
    const narrowed = new PhaseLaunchAuthorityService().narrowSandboxPreset(
      sandboxPolicy.preset,
      'explore'
    );

    expect(narrowed.filesystem.writePaths).toEqual([]);
    expect(narrowed.network).toMatchObject({
      defaultEgress: 'deny',
      allowedHosts: [],
      blockLoopback: true,
    });
    expect(narrowed.credentials).toEqual({
      mode: 'none',
      brokerRefs: [],
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  PHASE_AUTHORITY_DIMENSIONS,
  PHASE_TRANSITION_INTENT_SCHEMA_VERSION,
  type PhaseAuthorityDimension,
  type PhaseAuthoritySource,
  type PhaseCapabilityCompilerInput,
} from '@veritas-kanban/shared';
import {
  phaseCapabilityCompilerInputSchema,
  phaseCapabilityEvidenceSchema,
  phaseCapabilityProfileSchema,
  phaseTransitionIntentSchema,
} from '../schemas/phase-capability-schemas.js';
import {
  compilePhaseCapabilityAuthority,
  getBuiltInPhaseCapabilityProfile,
  listBuiltInPhaseCapabilityProfiles,
} from '../services/phase-capability-service.js';

describe('phase capability profiles', () => {
  it('ships schema-valid built-in profiles for every phase', () => {
    const profiles = listBuiltInPhaseCapabilityProfiles();

    expect(profiles.map((profile) => profile.phase)).toEqual([
      'explore',
      'plan',
      'implement',
      'verify',
      'publish',
    ]);
    for (const profile of profiles) {
      expect(() => phaseCapabilityProfileSchema.parse(profile)).not.toThrow();
      expect(profile.requiredDimensions).toEqual(PHASE_AUTHORITY_DIMENSIONS);
    }
  });

  it.each(['explore', 'plan'] as const)(
    '%s grants no general workspace mutation, task credentials, or external mutation',
    (phase) => {
      const evidence = compilePhaseCapabilityAuthority(
        compilerInput(getBuiltInPhaseCapabilityProfile(phase))
      );

      expect(evidence.status).toBe('allowed');
      expect(evidence.effectiveAuthority['filesystem.write']).toEqual([]);
      expect(evidence.effectiveAuthority['credential.access']).toEqual([]);
      expect(evidence.effectiveAuthority['external.action']).not.toContain('mutate');
      expect(evidence.planArtifact).toBeUndefined();
      expect(() => phaseCapabilityEvidenceSchema.parse(evidence)).not.toThrow();
    }
  );

  it('binds the plan exception to one exact harness-owned path', () => {
    const evidence = compilePhaseCapabilityAuthority({
      ...compilerInput(getBuiltInPhaseCapabilityProfile('plan')),
      planArtifact: {
        exactPath: '.veritas-kanban/plans/task-1034.md',
        owner: 'veritas-kanban',
        transport: 'harness-api',
      },
    });

    expect(evidence.status).toBe('allowed');
    expect(evidence.effectiveAuthority['filesystem.write']).toEqual([]);
    expect(evidence.effectiveAuthority['artifact.plan.write']).toEqual([
      '.veritas-kanban/plans/task-1034.md',
    ]);
    expect(evidence.planArtifact).toEqual({
      exactPath: '.veritas-kanban/plans/task-1034.md',
      owner: 'veritas-kanban',
      transport: 'harness-api',
      shellRedirection: false,
      indirectWrites: false,
    });
  });

  it.each([
    '../plan.md',
    'plans/../plan.md',
    '/tmp/plan.md',
    'C:/tmp/plan.md',
    'plans\\plan.md',
    'plans/plan.md;touch-pwned',
    'plans/$OUTPUT',
  ])('blocks unsafe or indirect plan-artifact path %s', (exactPath) => {
    const evidence = compilePhaseCapabilityAuthority({
      ...compilerInput(getBuiltInPhaseCapabilityProfile('plan')),
      planArtifact: { exactPath, owner: 'veritas-kanban', transport: 'harness-api' },
    });

    expect(evidence.status).toBe('blocked');
    expect(evidence.blockers).toContainEqual(
      expect.objectContaining({ code: 'plan-artifact-path-invalid' })
    );
    expect(evidence.planArtifact).toBeUndefined();
  });

  it('does not generalize the plan-artifact exception to another phase', () => {
    const evidence = compilePhaseCapabilityAuthority({
      ...compilerInput(getBuiltInPhaseCapabilityProfile('implement')),
      planArtifact: {
        exactPath: 'plans/task-1034.md',
        owner: 'veritas-kanban',
        transport: 'harness-api',
      },
    });

    expect(evidence.status).toBe('blocked');
    expect(evidence.blockers).toContainEqual(
      expect.objectContaining({ code: 'plan-artifact-not-allowed' })
    );
    expect(evidence.effectiveAuthority['artifact.plan.write']).toEqual([]);
  });

  it('keeps implement, verify, and publish authority dimensions independent', () => {
    const implement = compilePhaseCapabilityAuthority(
      compilerInput(getBuiltInPhaseCapabilityProfile('implement'))
    );
    const verify = compilePhaseCapabilityAuthority(
      compilerInput(getBuiltInPhaseCapabilityProfile('verify'))
    );
    const publish = compilePhaseCapabilityAuthority(
      compilerInput(getBuiltInPhaseCapabilityProfile('publish'))
    );

    expect(implement.effectiveAuthority['filesystem.write']).toEqual(['<workspace>']);
    expect(implement.effectiveAuthority['credential.access']).toEqual(['*']);
    expect(implement.effectiveAuthority['external.action']).not.toContain('mutate');
    expect(verify.effectiveAuthority['credential.access']).toEqual([]);
    expect(verify.effectiveAuthority['external.action']).not.toContain('mutate');
    expect(publish.effectiveAuthority['external.action']).toContain('mutate');
    expect(publish.approvalRequiredDimensions).toEqual(['credential.access', 'external.action']);
  });

  it('intersects every source monotonically and records narrowing', () => {
    const input = compilerInput(getBuiltInPhaseCapabilityProfile('implement'));
    input.sources.parent.authority['command.execute'] = ['inspect', 'test'];
    input.sources.sandbox.authority['network.egress'] = ['registry.npmjs.org'];
    input.sources.launchPolicy.authority['credential.access'] = ['npm-publish'];

    const evidence = compilePhaseCapabilityAuthority(input);

    expect(evidence.status).toBe('narrowed');
    expect(evidence.effectiveAuthority['command.execute']).toEqual(['inspect', 'test']);
    expect(evidence.effectiveAuthority['network.egress']).toEqual(['registry.npmjs.org']);
    expect(evidence.effectiveAuthority['credential.access']).toEqual(['npm-publish']);
    for (const dimension of PHASE_AUTHORITY_DIMENSIONS) {
      expect(
        isSubset(evidence.effectiveAuthority[dimension], input.sources.parent.authority[dimension])
      ).toBe(true);
    }
  });

  it('returns a typed blocker when a required scope is denied', () => {
    const input = compilerInput(getBuiltInPhaseCapabilityProfile('implement'));
    input.sources.parent.authority['filesystem.write'] = [];

    const evidence = compilePhaseCapabilityAuthority(input);

    expect(evidence.status).toBe('blocked');
    expect(evidence.blockers).toContainEqual(
      expect.objectContaining({
        code: 'required-authority-denied',
        dimension: 'filesystem.write',
      })
    );
  });

  it.each([
    ['unsupported', 'required-authority-unsupported'],
    ['unenforceable', 'required-authority-unenforceable'],
  ] as const)('fails closed when required authority is %s', (state, code) => {
    const input = compilerInput(getBuiltInPhaseCapabilityProfile('explore'));
    input.sources.toolCatalog.enforcement['external.action'] = state;

    const evidence = compilePhaseCapabilityAuthority(input);

    expect(evidence.status).toBe('blocked');
    expect(evidence.blockers).toContainEqual(
      expect.objectContaining({
        code,
        dimension: 'external.action',
        sourceId: 'tool-catalog',
      })
    );
    expect(evidence.effectiveAuthority['external.action']).toEqual([]);
  });

  it('makes legacy behavior explicit without inventing a phase profile', () => {
    const input = compilerInput();
    input.sources.parent.authority['filesystem.write'] = ['<workspace>'];
    input.sources.launchPolicy.authority['filesystem.write'] = ['<workspace>'];

    const evidence = compilePhaseCapabilityAuthority(input);

    expect(evidence.identity).toEqual({ mode: 'legacy', phase: 'legacy' });
    expect(evidence.warnings).toContain(
      'Legacy mode applies no phase profile; existing parent, agent, sandbox, tool, and launch policies remain authoritative.'
    );
    expect(evidence.effectiveAuthority['filesystem.write']).toEqual(['<workspace>']);
    expect(evidence.effectiveAuthority['artifact.plan.write']).toEqual([]);
  });

  it('rejects unknown authority dimensions instead of silently widening', () => {
    const input = compilerInput(getBuiltInPhaseCapabilityProfile('explore')) as unknown as {
      sources: { parent: { authority: Record<string, string[]> } };
    };
    input.sources.parent.authority['future.unenforced'] = ['*'];

    expect(() => phaseCapabilityCompilerInputSchema.parse(input)).toThrow();
    expect(() => compilePhaseCapabilityAuthority(input as never)).toThrow();
  });

  it('validates versioned transition intent without implementing transitions', () => {
    const plan = getBuiltInPhaseCapabilityProfile('plan');
    const implement = getBuiltInPhaseCapabilityProfile('implement');

    expect(
      phaseTransitionIntentSchema.parse({
        schemaVersion: PHASE_TRANSITION_INTENT_SCHEMA_VERSION,
        from: {
          mode: 'profile',
          phase: plan.phase,
          profileId: plan.id,
          profileVersion: plan.version,
        },
        to: {
          mode: 'profile',
          phase: implement.phase,
          profileId: implement.id,
          profileVersion: implement.version,
        },
        actor: 'operator:brad',
        reason: 'The approved plan is ready for implementation.',
        requestedAt: '2026-07-25T00:00:00.000Z',
      })
    ).toBeDefined();
  });
});

function compilerInput(
  profile?: PhaseCapabilityCompilerInput['profile']
): PhaseCapabilityCompilerInput {
  return {
    ...(profile ? { profile } : {}),
    sources: {
      parent: source('parent', 'parent'),
      agentProfile: source('agent-profile', 'agent-profile'),
      sandbox: source('sandbox', 'sandbox'),
      toolCatalog: source('tool-catalog', 'tool-catalog'),
      launchPolicy: source('launch-policy', 'launch-policy'),
    },
  };
}

function source<K extends PhaseAuthoritySource['kind']>(
  id: string,
  kind: K
): PhaseAuthoritySource & { kind: K } {
  return {
    id,
    kind,
    authority: recordForDimensions(() => ['*']),
    enforcement: recordForDimensions(() => 'enforced'),
  };
}

function recordForDimensions<T>(
  value: (dimension: PhaseAuthorityDimension) => T
): Record<PhaseAuthorityDimension, T> {
  return Object.fromEntries(
    PHASE_AUTHORITY_DIMENSIONS.map((dimension) => [dimension, value(dimension)])
  ) as Record<PhaseAuthorityDimension, T>;
}

function isSubset(scopes: string[], parentScopes: string[]): boolean {
  if (parentScopes.includes('*')) return true;
  return scopes.every((scope) => parentScopes.includes(scope));
}

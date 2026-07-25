import { describe, expect, it, vi } from 'vitest';
import {
  PHASE_AUTHORITY_DIMENSIONS,
  type PhaseAuthorityDimension,
  type PhaseAuthoritySource,
  type Task,
} from '@veritas-kanban/shared';
import {
  compilePhaseCapabilityAuthority,
  getBuiltInPhaseCapabilityProfile,
} from '../services/phase-capability-service.js';
import { RunPhaseAuthorityService } from '../services/run-phase-authority-service.js';

const MANIFEST_DIGEST = `sha256:${'1'.repeat(64)}`;

describe('RunPhaseAuthorityService', () => {
  it('keeps a legacy attempt readable without inventing phase or transition evidence', async () => {
    const task = {
      id: 'task-legacy',
      attempt: {
        id: 'attempt-legacy',
        status: 'complete',
      },
    } as unknown as Task;
    const getCurrent = vi.fn();
    const list = vi.fn();
    const service = new RunPhaseAuthorityService({
      tasks: { findById: vi.fn(async () => task) },
      transitions: { getCurrent, list },
    });

    await expect(service.get('local', task.id, 'attempt-legacy')).resolves.toBeNull();
    expect(getCurrent).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it('projects launch authority and binds exact action requirements', async () => {
    const launchEvidence = evidence('implement');
    const task = {
      id: 'task-phase',
      attempt: {
        id: 'attempt-phase',
        status: 'running',
        runLaunchManifest: {
          digest: MANIFEST_DIGEST,
          phase: {
            evidence: launchEvidence,
            sourceReferences: [
              {
                sourceId: 'parent:none',
                kind: 'parent',
                originScope: 'system-default',
                sourceDigest: `sha256:${'2'.repeat(64)}`,
              },
            ],
          },
        },
      },
    } as unknown as Task;
    const service = new RunPhaseAuthorityService({
      tasks: { findById: vi.fn(async () => task) },
      transitions: {
        getCurrent: vi.fn(async () => null),
        list: vi.fn(async () => []),
      },
    });

    const snapshot = await service.getActive('local', task.id, 'attempt-phase');
    if (!snapshot) throw new Error('Expected phase authority snapshot');
    expect(snapshot).toMatchObject({
      manifestDigest: MANIFEST_DIGEST,
      transitionSequence: 0,
      effectiveEvidence: { digest: launchEvidence.digest },
    });
    expect(
      service.binding(snapshot, [
        { dimension: 'command.execute', requestedScopes: ['test'] },
        { dimension: 'external.action', requestedScopes: ['read'] },
      ])
    ).toMatchObject({
      evidenceDigest: launchEvidence.digest,
      transitionSequence: 0,
      requirements: [
        { dimension: 'command.execute', requestedScopes: ['test'] },
        { dimension: 'external.action', requestedScopes: ['read'] },
      ],
    });
    expect(() => service.assertScopes(snapshot, 'external.action', ['mutate'])).toThrow(
      'Active phase authority denies this action.'
    );
  });
});

function evidence(phase: 'implement') {
  return compilePhaseCapabilityAuthority({
    profile: getBuiltInPhaseCapabilityProfile(phase),
    sources: {
      parent: source('parent', 'parent'),
      agentProfile: source('agent-profile', 'agent-profile'),
      sandbox: source('sandbox', 'sandbox'),
      toolCatalog: source('tool-catalog', 'tool-catalog'),
      launchPolicy: source('launch-policy', 'launch-policy'),
    },
  });
}

function source<K extends PhaseAuthoritySource['kind']>(
  id: string,
  kind: K
): PhaseAuthoritySource & { kind: K } {
  return {
    id,
    kind,
    authority: dimensions(() => ['*']),
    enforcement: dimensions(() => 'enforced' as const),
  };
}

function dimensions<T>(
  value: (dimension: PhaseAuthorityDimension) => T
): Record<PhaseAuthorityDimension, T> {
  return Object.fromEntries(
    PHASE_AUTHORITY_DIMENSIONS.map((dimension) => [dimension, value(dimension)])
  ) as Record<PhaseAuthorityDimension, T>;
}

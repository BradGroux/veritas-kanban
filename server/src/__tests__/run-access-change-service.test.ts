import { describe, expect, it, vi } from 'vitest';
import {
  PHASE_AUTHORITY_DIMENSIONS,
  type PhaseAuthority,
  type PhaseCapabilityCompilerSources,
  type PhaseName,
  type RunAccessSummaryResponse,
  type RunPhaseAuthoritySnapshot,
} from '@veritas-kanban/shared';
import {
  compilePhaseCapabilityAuthority,
  getBuiltInPhaseCapabilityProfile,
} from '../services/phase-capability-service.js';
import { RunAccessChangeService } from '../services/run-access-change-service.js';

const MANIFEST_DIGEST = `sha256:${'1'.repeat(64)}`;
const ACCESS_DIGEST = `sha256:${'4'.repeat(64)}`;

describe('RunAccessChangeService', () => {
  it('previews an exact-action ACP expansion from immutable launch authority', async () => {
    const fixture = service({ provider: 'acp-stdio', current: 'implement', launch: 'publish' });

    const preview = await fixture.service.preview(
      'local',
      'task-1',
      request(fixture.snapshot, 'publish')
    );

    expect(preview).toMatchObject({
      schemaVersion: 'run-access-change-preview/v1',
      operation: 'transition-phase',
      targetPhase: 'publish',
      expectedAccessSummaryDigest: ACCESS_DIGEST,
      budgetImpact: {
        classification: 'unchanged',
        before: { reservationState: 'active' },
        after: { reservationState: 'active' },
      },
      approval: { required: true, class: 'exact-action' },
      enforcement: {
        state: 'ready',
        provider: 'acp-stdio',
        requiresRelaunch: false,
      },
    });
    expect(preview.authorityDelta.entries).toContainEqual({
      dimension: 'external.action',
      addedScopes: ['mutate'],
      removedScopes: [],
    });
    expect(preview.requestRevision).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('returns a relaunch blocker when ACP cannot atomically replace a process boundary', async () => {
    const fixture = service({ provider: 'acp-stdio', current: 'implement', launch: 'publish' });

    const preview = await fixture.service.preview(
      'local',
      'task-1',
      request(fixture.snapshot, 'verify')
    );

    expect(preview.enforcement).toMatchObject({
      state: 'blocked',
      safeBoundary: 'pause-before-relaunch',
      requiresRelaunch: true,
    });
    expect(preview.enforcement.blockers[0]).toMatchObject({
      code: 'provider-boundary-relaunch-required',
      dimensions: ['credential.access'],
    });
  });

  it('fails closed when the provider cannot prove a live transition', async () => {
    const fixture = service({ provider: 'codex-cli', current: 'implement', launch: 'publish' });

    const preview = await fixture.service.preview(
      'local',
      'task-1',
      request(fixture.snapshot, 'publish')
    );

    expect(preview.enforcement.blockers[0]?.code).toBe('provider-live-transition-unsupported');
  });

  it('does not permit a target beyond the immutable launch ceiling', async () => {
    const fixture = service({ provider: 'acp-stdio', current: 'implement', launch: 'implement' });

    const preview = await fixture.service.preview(
      'local',
      'task-1',
      request(fixture.snapshot, 'publish')
    );

    expect(preview.targetEvidence.status).toBe('narrowed');
    expect(preview.enforcement.blockers[0]?.code).toBe('target-authority-denied');
  });

  it('binds apply to the exact preview revision and delegates the governed transition', async () => {
    const fixture = service({ provider: 'acp-stdio', current: 'implement', launch: 'publish' });
    const input = request(fixture.snapshot, 'publish');
    const preview = await fixture.service.preview('local', 'task-1', input);

    await expect(
      fixture.service.apply(
        'local',
        'task-1',
        { ...input, requestRevision: `sha256:${'9'.repeat(64)}` },
        actor()
      )
    ).rejects.toThrow('preview is stale');

    const applied = await fixture.service.apply(
      'local',
      'task-1',
      { ...input, requestRevision: preview.requestRevision },
      actor()
    );

    expect(applied.transition.status).toBe('approval-required');
    expect(fixture.transition).toHaveBeenCalledWith(
      'local',
      'task-1',
      expect.objectContaining({
        operationId: 'access-change-1',
        expectedSequence: 0,
        targetEvidence: expect.objectContaining({
          digest: preview.targetEvidence.digest,
        }),
      }),
      actor()
    );
  });

  it('rejects stale sequence, evidence, or manifest before creating a preview', async () => {
    const fixture = service({ provider: 'acp-stdio', current: 'implement', launch: 'publish' });
    const input = request(fixture.snapshot, 'publish');

    await expect(
      fixture.service.preview('local', 'task-1', { ...input, expectedSequence: 1 })
    ).rejects.toThrow('compare-and-set evidence is stale');
  });

  it('rejects a stale Run Access summary version', async () => {
    const fixture = service({ provider: 'acp-stdio', current: 'implement', launch: 'publish' });
    const input = request(fixture.snapshot, 'publish');

    await expect(
      fixture.service.preview('local', 'task-1', {
        ...input,
        expectedAccessSummaryDigest: `sha256:${'9'.repeat(64)}`,
      })
    ).rejects.toThrow('summary evidence is stale');
  });

  it('binds approval lifetime to the reviewed request revision', async () => {
    const fixture = service({ provider: 'acp-stdio', current: 'implement', launch: 'publish' });
    const input = request(fixture.snapshot, 'publish');

    const defaultPreview = await fixture.service.preview('local', 'task-1', input);
    const boundedPreview = await fixture.service.preview('local', 'task-1', {
      ...input,
      approvalTtlMs: 60_000,
    });

    expect(boundedPreview.requestRevision).not.toBe(defaultPreview.requestRevision);
  });
});

function service(options: { provider: string; current: PhaseName; launch: PhaseName }) {
  const launchEvidence = evidence(options.launch);
  const currentEvidence = evidence(options.current);
  const snapshot: RunPhaseAuthoritySnapshot = {
    taskId: 'task-1',
    attemptId: 'attempt-1',
    manifestDigest: MANIFEST_DIGEST,
    launch: { evidence: launchEvidence, sourceReferences: [] },
    effectiveEvidence: currentEvidence,
    transitionSequence: 0,
    current: null,
    history: [],
  };
  const transition = vi.fn().mockResolvedValue({
    status: 'approval-required',
    current: null,
    targetEvidenceDigest: evidence('publish').digest,
  });
  return {
    snapshot,
    transition,
    service: new RunAccessChangeService({
      phases: { getActive: vi.fn().mockResolvedValue(snapshot) },
      access: {
        get: vi.fn().mockResolvedValue(access(options.provider)),
      },
      transitions: { transition },
    }),
  };
}

function request(snapshot: RunPhaseAuthoritySnapshot, targetPhase: PhaseName) {
  return {
    attemptId: snapshot.attemptId,
    requestId: 'access-change-1',
    operation: 'transition-phase' as const,
    targetPhase,
    reason: 'Use the reviewed target phase for this active run.',
    expectedAccessSummaryDigest: ACCESS_DIGEST,
    expectedSequence: snapshot.transitionSequence,
    expectedPhaseEvidenceDigest: snapshot.effectiveEvidence.digest,
    expectedManifestDigest: snapshot.manifestDigest,
  };
}

function actor() {
  return {
    actor: {
      id: 'operator-1',
      label: 'Operator',
      type: 'user' as const,
      authMethod: 'session' as const,
      workspaceId: 'local',
    },
    administrator: false,
  };
}

function evidence(phase: PhaseName) {
  return compilePhaseCapabilityAuthority({
    profile: getBuiltInPhaseCapabilityProfile(phase),
    sources: sources(wildcard()),
  });
}

function sources(authority: PhaseAuthority): PhaseCapabilityCompilerSources {
  const source = <
    TKind extends PhaseCapabilityCompilerSources[keyof PhaseCapabilityCompilerSources]['kind'],
  >(
    kind: TKind
  ) => ({
    id: `test:${kind}`,
    kind,
    authority: structuredClone(authority),
    enforcement: Object.fromEntries(
      PHASE_AUTHORITY_DIMENSIONS.map((dimension) => [dimension, 'enforced'])
    ) as PhaseCapabilityCompilerSources['parent']['enforcement'],
  });
  return {
    parent: source('parent'),
    agentProfile: source('agent-profile'),
    sandbox: source('sandbox'),
    toolCatalog: source('tool-catalog'),
    launchPolicy: source('launch-policy'),
  };
}

function wildcard(): PhaseAuthority {
  return Object.fromEntries(
    PHASE_AUTHORITY_DIMENSIONS.map((dimension) => [dimension, ['*']])
  ) as PhaseAuthority;
}

function access(provider: string): RunAccessSummaryResponse {
  return {
    current: {
      digest: ACCESS_DIGEST,
      identity: { provider },
      tools: [{ qualifiedName: 'github.create_issue' }],
      integrations: [{ accountLabel: 'GitHub' }],
      budgets: {
        policy: null,
        usage: null,
        capacity: { runSlots: 1, processSlots: 1, estimatedMemoryMb: 256 },
        concurrencyPolicies: [],
        reservationState: 'active',
        source: {
          kind: 'admission-reservation',
          digest: ACCESS_DIGEST,
          field: 'budgets',
        },
      },
    },
    history: [],
  } as unknown as RunAccessSummaryResponse;
}

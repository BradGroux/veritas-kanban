import { describe, expect, it } from 'vitest';
import type {
  PhaseAuthorityDimension,
  PhaseAuthoritySource,
  PhaseCapabilityEvidence,
  RunLaunchManifest,
  RunApprovalRequest,
  RunApprovalStatus,
  RunEventAppendInput,
  RunEventAppendResult,
  Task,
} from '@veritas-kanban/shared';
import { PHASE_AUTHORITY_DIMENSIONS } from '@veritas-kanban/shared';
import { InMemoryPhaseTransitionRepository } from '../storage/phase-transition-repository.js';
import {
  calculatePhaseCapabilityEvidenceDigest,
  compilePhaseCapabilityAuthority,
  getBuiltInPhaseCapabilityProfile,
} from '../services/phase-capability-service.js';
import {
  PhaseTransitionService,
  type PhaseTransitionActorContext,
} from '../services/phase-transition-service.js';
import type { CreateRunApprovalRequestInput } from '../services/run-approval-broker-service.js';

const MANIFEST_DIGEST = `sha256:${'1'.repeat(64)}`;
const WORKSPACE_ID = 'local';
const TASK_ID = 'task-1';
const ATTEMPT_ID = 'attempt-1';

describe('PhaseTransitionService', () => {
  it('applies a narrowing transition immediately with durable evidence', async () => {
    const fixture = createFixture();
    const from = evidence('implement');
    const target = evidence('plan');

    const result = await fixture.service.transition(
      WORKSPACE_ID,
      TASK_ID,
      request(from, target, 'narrow-1'),
      operator()
    );

    expect(result.status).toBe('applied');
    expect(result.record).toMatchObject({
      sequence: 1,
      operationId: 'narrow-1',
      policyDecision: 'allow',
      manifestDigest: MANIFEST_DIGEST,
    });
    expect(result.record?.authorityDelta.classification).toBe('narrowing');
    expect(result.record?.approvalId).toBeUndefined();
    expect(fixture.journal.inputs).toHaveLength(1);
  });

  it('requires exact-action approval before applying an expansion', async () => {
    const fixture = createFixture();
    const from = evidence('plan');
    const target = evidence('implement');
    const input = request(from, target, 'expand-1');

    const pending = await fixture.service.transition(WORKSPACE_ID, TASK_ID, input, operator());

    expect(pending.status).toBe('approval-required');
    expect(pending.approval).toMatchObject({
      status: 'pending',
      actionClass: 'workflow',
      evidenceRevision: from.digest,
    });
    expect(await fixture.repository.getCurrent(WORKSPACE_ID, TASK_ID, ATTEMPT_ID)).toBeNull();

    fixture.approvals.resolve('approved');
    const applied = await fixture.service.transition(
      WORKSPACE_ID,
      TASK_ID,
      { ...input, approvalId: pending.approval?.id },
      operator()
    );

    expect(applied.status).toBe('applied');
    expect(applied.record).toMatchObject({
      policyDecision: 'approved-expansion',
      approvalId: pending.approval?.id,
    });
    expect(applied.record?.authorityDelta.classification).toBe('expanding');
  });

  it.each(['rejected', 'expired'] as const)(
    'does not apply an expansion after approval is %s',
    async (status) => {
      const fixture = createFixture();
      const from = evidence('plan');
      const target = evidence('implement');
      const input = request(from, target, `expand-${status}`);

      await fixture.service.transition(WORKSPACE_ID, TASK_ID, input, operator());
      fixture.approvals.resolve(status);

      await expect(
        fixture.service.transition(WORKSPACE_ID, TASK_ID, input, operator())
      ).rejects.toThrow('Phase transition approval is not approved');
      expect(await fixture.repository.getCurrent(WORKSPACE_ID, TASK_ID, ATTEMPT_ID)).toBeNull();
    }
  );

  it('returns the original record for an exact duplicate operation', async () => {
    const fixture = createFixture();
    const from = evidence('implement');
    const target = evidence('plan');
    const input = request(from, target, 'duplicate-1');

    const first = await fixture.service.transition(WORKSPACE_ID, TASK_ID, input, operator());
    const duplicate = await fixture.service.transition(WORKSPACE_ID, TASK_ID, input, operator());
    const history = await fixture.repository.list({
      workspaceId: WORKSPACE_ID,
      taskId: TASK_ID,
      attemptId: ATTEMPT_ID,
    });

    expect(duplicate.record?.id).toBe(first.record?.id);
    expect(history).toHaveLength(1);
  });

  it('rejects reuse of an operation identity for changed evidence', async () => {
    const fixture = createFixture();
    const from = evidence('implement');
    await fixture.service.transition(
      WORKSPACE_ID,
      TASK_ID,
      request(from, evidence('plan'), 'operation-1'),
      operator()
    );

    await expect(
      fixture.service.transition(
        WORKSPACE_ID,
        TASK_ID,
        request(from, evidence('verify'), 'operation-1'),
        operator()
      )
    ).rejects.toThrow('Phase transition compare-and-set failed');
  });

  it('fails closed on stale sequence, phase evidence, and manifest provenance', async () => {
    const fixture = createFixture();
    const from = evidence('implement');
    const target = evidence('plan');

    await expect(
      fixture.service.transition(
        WORKSPACE_ID,
        TASK_ID,
        { ...request(from, target, 'stale-sequence'), expectedSequence: 1 },
        operator()
      )
    ).rejects.toThrow('Phase transition sequence is stale');

    await expect(
      fixture.service.transition(
        WORKSPACE_ID,
        TASK_ID,
        {
          ...request(from, target, 'stale-evidence'),
          expectedPhaseEvidenceDigest: evidence('explore').digest,
        },
        operator()
      )
    ).rejects.toThrow('Phase transition evidence is stale');

    await expect(
      fixture.service.transition(
        WORKSPACE_ID,
        TASK_ID,
        {
          ...request(from, target, 'stale-manifest'),
          expectedManifestDigest: `sha256:${'2'.repeat(64)}`,
        },
        operator()
      )
    ).rejects.toThrow('launch-manifest evidence is stale');
  });

  it('requires administrator authority for an expiring emergency override', async () => {
    const fixture = createFixture();
    const from = evidence('plan');
    const target = evidence('publish');
    const input = {
      ...request(from, target, 'override-1'),
      emergencyOverride: {
        justification: 'Restore publication while the approval service is unavailable.',
        expiresAt: '2026-07-25T01:30:00.000Z',
      },
    };

    await expect(
      fixture.service.transition(WORKSPACE_ID, TASK_ID, input, operator(false))
    ).rejects.toThrow('admin:manage');

    const applied = await fixture.service.transition(WORKSPACE_ID, TASK_ID, input, operator(true));
    expect(applied.record).toMatchObject({
      policyDecision: 'emergency-override',
      emergencyOverride: {
        permission: 'admin:manage',
        expiresAt: '2026-07-25T01:30:00.000Z',
      },
    });
  });

  it('recovers after restart and durably narrows an expired override exactly once', async () => {
    const fixture = createFixture();
    const from = evidence('plan');
    const target = evidence('publish');
    await fixture.service.transition(
      WORKSPACE_ID,
      TASK_ID,
      {
        ...request(from, target, 'override-restart'),
        emergencyOverride: {
          justification: 'Time-bounded publication recovery.',
          expiresAt: '2026-07-25T01:30:00.000Z',
        },
      },
      operator(true)
    );

    fixture.clock.value = new Date('2026-07-25T01:31:00.000Z');
    const restarted = fixture.restart();
    const [left, right] = await Promise.all([
      restarted.getCurrent(WORKSPACE_ID, TASK_ID, ATTEMPT_ID),
      restarted.getCurrent(WORKSPACE_ID, TASK_ID, ATTEMPT_ID),
    ]);
    const history = await fixture.repository.list({
      workspaceId: WORKSPACE_ID,
      taskId: TASK_ID,
      attemptId: ATTEMPT_ID,
    });

    expect(left?.effectiveEvidence.digest).toBe(from.digest);
    expect(right?.effectiveEvidence.digest).toBe(from.digest);
    expect(left?.policyDecision).toBe('override-expired');
    expect(history).toHaveLength(2);
    expect(history.map((record) => record.sequence)).toEqual([1, 2]);
  });

  it('allows only one winner for concurrent compare-and-set transitions', async () => {
    const fixture = createFixture();
    const from = evidence('implement');

    const results = await Promise.allSettled([
      fixture.service.transition(
        WORKSPACE_ID,
        TASK_ID,
        request(from, evidence('plan'), 'race-plan'),
        operator()
      ),
      fixture.service.transition(
        WORKSPACE_ID,
        TASK_ID,
        request(from, evidence('verify'), 'race-verify'),
        operator()
      ),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(
      await fixture.repository.list({
        workspaceId: WORKSPACE_ID,
        taskId: TASK_ID,
        attemptId: ATTEMPT_ID,
      })
    ).toHaveLength(1);
  });

  it('rejects blocked or content-tampered target evidence', async () => {
    const fixture = createFixture();
    const from = evidence('implement');
    const blocked = structuredClone(evidence('plan'));
    blocked.status = 'blocked';
    blocked.digest = recalculate(blocked);

    await expect(
      fixture.service.transition(
        WORKSPACE_ID,
        TASK_ID,
        request(from, blocked, 'blocked-target'),
        operator()
      )
    ).rejects.toThrow('Blocked phase evidence');

    const tampered = structuredClone(evidence('plan'));
    tampered.effectiveAuthority['filesystem.write'] = ['<workspace>'];
    await expect(
      fixture.service.transition(
        WORKSPACE_ID,
        TASK_ID,
        request(from, tampered, 'tampered-target'),
        operator()
      )
    ).rejects.toThrow('digest does not match');
  });
});

function createFixture() {
  const repository = new InMemoryPhaseTransitionRepository();
  const approvals = new FakeApprovals();
  const journal = new FakeJournal();
  const clock = { value: new Date('2026-07-25T01:00:00.000Z') };
  let nextId = 1;
  const options = {
    repository,
    tasks: {
      findById: async (id: string) => (id === TASK_ID ? activeTask() : null),
    },
    approvals,
    journal,
    now: () => clock.value,
    id: () => `phasetransition_${String(nextId++).padStart(18, '0')}`,
  };
  return {
    repository,
    approvals,
    journal,
    clock,
    service: new PhaseTransitionService(options),
    restart: () => new PhaseTransitionService(options),
  };
}

function activeTask(): Task {
  return {
    id: TASK_ID,
    title: 'Phase transition test',
    description: 'Fixture',
    type: 'task',
    status: 'in-progress',
    priority: 'high',
    created: '2026-07-25T00:00:00.000Z',
    updated: '2026-07-25T00:00:00.000Z',
    attempt: {
      id: ATTEMPT_ID,
      agent: 'codex',
      provider: 'codex-cli',
      status: 'running',
      runLaunchManifest: { digest: MANIFEST_DIGEST } as RunLaunchManifest,
    },
  };
}

function request(
  fromEvidence: PhaseCapabilityEvidence,
  targetEvidence: PhaseCapabilityEvidence,
  operationId: string
) {
  return {
    attemptId: ATTEMPT_ID,
    operationId,
    expectedSequence: 0,
    expectedPhaseEvidenceDigest: fromEvidence.digest,
    expectedManifestDigest: MANIFEST_DIGEST,
    reason: `Transition for ${operationId}.`,
    fromEvidence,
    targetEvidence,
  };
}

function evidence(phase: 'explore' | 'plan' | 'implement' | 'verify' | 'publish') {
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
    authority: recordForDimensions<string[]>(() => ['*']),
    enforcement: recordForDimensions(() => 'enforced' as const),
  };
}

function recordForDimensions<T>(
  value: (dimension: PhaseAuthorityDimension) => T
): Record<PhaseAuthorityDimension, T> {
  return Object.fromEntries(
    PHASE_AUTHORITY_DIMENSIONS.map((dimension) => [dimension, value(dimension)])
  ) as Record<PhaseAuthorityDimension, T>;
}

function operator(administrator = false): PhaseTransitionActorContext {
  return {
    actor: {
      id: 'operator-brad',
      type: 'user',
      authMethod: 'session',
      authenticatedAt: '2026-07-25T01:00:00.000Z',
      workspaceId: WORKSPACE_ID,
    },
    administrator,
  };
}

class FakeApprovals {
  private requestValue?: RunApprovalRequest;

  async request(input: CreateRunApprovalRequestInput): Promise<RunApprovalRequest> {
    if (this.requestValue) return this.requestValue;
    this.requestValue = {
      schemaVersion: 'run-approval/v1',
      id: 'runapproval_000000000001',
      workspaceId: input.workspaceId ?? WORKSPACE_ID,
      taskId: input.taskId,
      attemptId: input.attemptId,
      provider: input.provider,
      agentId: input.agentId,
      requestKind: input.requestKind,
      actionClass: input.actionClass,
      action: input.action,
      actionHash: 'a'.repeat(64),
      details: input.details,
      resourceScope: input.resourceScope ?? [],
      riskClass: input.riskClass,
      policyReason: input.policyReason,
      evidenceRevision: input.evidenceRevision,
      providerRequestId: input.providerRequestId,
      mobileSafe: input.mobileSafe ?? false,
      status: 'pending',
      revision: 1,
      createdAt: '2026-07-25T01:00:00.000Z',
      updatedAt: '2026-07-25T01:00:00.000Z',
      expiresAt: '2026-07-25T01:05:00.000Z',
    };
    return this.requestValue;
  }

  resolve(status: Exclude<RunApprovalStatus, 'pending' | 'cancelled'>): void {
    if (!this.requestValue) throw new Error('No approval exists.');
    this.requestValue = {
      ...this.requestValue,
      status,
      revision: 2,
      updatedAt: '2026-07-25T01:01:00.000Z',
      resolution: {
        decision: status,
        actor: {
          id: 'approver',
          type: 'user',
          authMethod: 'session',
          authenticatedAt: '2026-07-25T01:01:00.000Z',
          workspaceId: WORKSPACE_ID,
        },
        decidedAt: '2026-07-25T01:01:00.000Z',
      },
    };
  }
}

class FakeJournal {
  readonly inputs: RunEventAppendInput[] = [];

  async append(input: RunEventAppendInput): Promise<RunEventAppendResult> {
    this.inputs.push(input);
    return {
      appended: true,
      event: {
        eventId: `runevt_${this.inputs.length}`,
      } as RunEventAppendResult['event'],
    };
  }
}

function recalculate(evidenceValue: PhaseCapabilityEvidence): string {
  return calculatePhaseCapabilityEvidenceDigest(evidenceValue);
}

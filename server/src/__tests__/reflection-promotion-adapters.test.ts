import { describe, expect, it, vi } from 'vitest';
import type {
  AgentPolicy,
  AgentProfilePackage,
  DecisionRecord,
  ReflectionCandidate,
  ReflectionTypedPromotionInput,
  TaskTemplate,
  TeamRosterManifest,
} from '@veritas-kanban/shared';
import {
  createBuiltInReflectionPromotionAdapters,
  ReflectionPromotionAdapterRegistry,
  type ReflectionPromotionAdapterDependencies,
} from '../services/reflection-promotion-adapters.js';

function candidate(overrides: Partial<ReflectionCandidate> = {}): ReflectionCandidate {
  return {
    id: 'reflection_1',
    status: 'pending',
    category: 'team',
    promotionTarget: 'memory',
    confidence: 0.8,
    source: { kind: 'task-run', taskId: 'task_1', runId: 'attempt_1' },
    summary: 'Use the current schema.',
    previousApproach: 'Guessed the old schema.',
    correction: 'Inspect the current schema.',
    nextAttempt: 'Read the current schema before editing.',
    rationale: 'The correction is reusable.',
    evidence: [],
    tags: ['schema'],
    duplicateKey: 'schema',
    duplicateCount: 1,
    appliedTargets: [],
    redaction: { redacted: false, notes: [] },
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
    ...overrides,
  };
}

function harness() {
  let roster: TeamRosterManifest = {
    id: 'roster_1',
    schemaVersion: 'team-roster/v1',
    workspaceId: 'workspace_1',
    name: 'Primary',
    enabled: true,
    members: [
      {
        id: 'member_1',
        displayName: 'Builder',
        role: 'Implementation',
        agent: 'codex',
        status: 'enabled',
        capabilities: ['typescript'],
      },
    ],
    routingRules: [],
  };
  let profile: AgentProfilePackage = {
    id: 'profile_1',
    schemaVersion: 'agent-profile-package/v1',
    version: '1.0.0',
    displayName: 'Builder',
    role: 'Implementation',
    enabled: true,
    capabilities: ['typescript'],
    defaultTaskTypes: ['feature'],
    runtime: { agent: 'codex' },
  };
  let template: TaskTemplate = {
    id: 'template_1',
    name: 'Feature',
    version: 1,
    taskDefaults: { descriptionTemplate: 'Existing guidance.' },
    created: '2026-07-25T00:00:00.000Z',
    updated: '2026-07-25T00:00:00.000Z',
  };
  const decisions: DecisionRecord[] = [];
  const policies = new Map<string, AgentPolicy>();
  const updateProfile = vi.fn(async (_id: string, patch: { capabilities?: string[] }) => {
    profile = { ...profile, capabilities: patch.capabilities ?? profile.capabilities };
    return profile;
  });
  const updateTemplate = vi.fn(
    async (_id: string, patch: { taskDefaults?: TaskTemplate['taskDefaults'] }) => {
      template = {
        ...template,
        taskDefaults: { ...template.taskDefaults, ...patch.taskDefaults },
      };
      return template;
    }
  );
  const dependencies: ReflectionPromotionAdapterDependencies = {
    teamRoster: () => ({
      async mutateRoster<T>(mutator) {
        const mutation = mutator(roster, []);
        roster = mutation.roster;
        return mutation.result as T;
      },
    }),
    profiles: () => ({
      getProfile: vi.fn(async () => profile),
      updateProfile,
    }),
    templates: () => ({
      getTemplate: vi.fn(async () => template),
      updateTemplate,
    }),
    decisions: () => ({
      list: vi.fn(async () => decisions),
      create: vi.fn(async (input) => {
        const decision: DecisionRecord = {
          id: `decision_${decisions.length + 1}`,
          inputContext: input.inputContext,
          outputAction: input.outputAction,
          assumptions: (input.assumptions ?? []).map((assumption) => ({
            text: typeof assumption === 'string' ? assumption : assumption.text,
            status: 'pending',
          })),
          confidenceLevel: input.confidenceLevel,
          riskScore: input.riskScore,
          parentDecisionId: input.parentDecisionId,
          agentId: input.agentId,
          taskId: input.taskId,
          timestamp: input.timestamp ?? '2026-07-25T00:00:00.000Z',
        };
        decisions.push(decision);
        return decision;
      }),
    }),
    policies: () => ({
      getPolicy: vi.fn(async (id) => policies.get(id) ?? null),
      createPolicy: vi.fn(async (policyInput) => {
        policies.set(policyInput.id, policyInput);
        return policyInput;
      }),
      updatePolicy: vi.fn(async (_id, policyInput) => {
        policies.set(policyInput.id, policyInput);
        return policyInput;
      }),
    }),
  };
  return {
    registry: new ReflectionPromotionAdapterRegistry(
      createBuiltInReflectionPromotionAdapters(dependencies)
    ),
    getRoster: () => roster,
    getProfile: () => profile,
    getTemplate: () => template,
    getDecisions: () => decisions,
    getPolicies: () => policies,
    updateProfile,
    updateTemplate,
  };
}

async function apply(
  registry: ReflectionPromotionAdapterRegistry,
  promotion: ReflectionTypedPromotionInput,
  overrides: Partial<ReflectionCandidate> = {}
) {
  return registry.apply({
    candidate: candidate({ promotionTarget: promotion.target, ...overrides }),
    promotion,
    reviewedBy: 'brad',
    timestamp: '2026-07-25T12:00:00.000Z',
  });
}

describe('typed reflection promotion adapters', () => {
  it('scopes accepted memory to an explicit workspace', async () => {
    const { registry } = harness();

    await expect(
      apply(registry, { target: 'memory', workspaceId: 'workspace_1' })
    ).resolves.toMatchObject({
      kind: 'memory',
      id: 'workspace_1',
      appliedBy: 'brad',
    });
  });

  it('adds reviewed team capabilities without replacing the roster', async () => {
    const { registry, getRoster } = harness();

    const result = await apply(registry, {
      target: 'team',
      rosterId: 'roster_1',
      memberId: 'member_1',
      capabilitiesToAdd: ['rust', 'typescript'],
    });

    expect(result).toMatchObject({ kind: 'team', id: 'roster_1:member_1' });
    expect(getRoster().members[0].capabilities).toEqual(['typescript', 'rust']);
  });

  it('adds reviewed capabilities through the profile service', async () => {
    const { registry, getProfile, updateProfile } = harness();

    await apply(registry, {
      target: 'profile',
      profileId: 'profile_1',
      capabilitiesToAdd: ['review', 'typescript'],
    });

    expect(getProfile().capabilities).toEqual(['typescript', 'review']);
    expect(updateProfile).toHaveBeenCalledTimes(1);
  });

  it('appends redacted reviewed guidance to a task template idempotently', async () => {
    const { registry, getTemplate, updateTemplate } = harness();
    const promotion: ReflectionTypedPromotionInput = {
      target: 'template',
      templateId: 'template_1',
    };

    await apply(registry, promotion);
    await apply(registry, promotion);

    expect(getTemplate().taskDefaults.descriptionTemplate).toContain('[Reflection reflection_1]');
    expect(getTemplate().taskDefaults.descriptionTemplate).toContain(
      'Read the current schema before editing.'
    );
    expect(updateTemplate).toHaveBeenCalledTimes(1);
  });

  it('creates one source-linked decision across retries', async () => {
    const { registry, getDecisions } = harness();
    const promotion: ReflectionTypedPromotionInput = {
      target: 'decision',
      agentId: 'codex',
      taskId: 'task_1',
      confidenceLevel: 0.8,
      riskScore: 20,
    };

    await apply(registry, promotion);
    await apply(registry, promotion);

    expect(getDecisions()).toHaveLength(1);
    expect(getDecisions()[0]).toMatchObject({
      inputContext: expect.stringContaining('[Reflection reflection_1]'),
      outputAction: 'Read the current schema before editing.',
    });
  });

  it('creates or updates a complete policy through the policy service', async () => {
    const { registry, getPolicies } = harness();
    const policy: AgentPolicy = {
      id: 'review-schema',
      name: 'Review schema',
      type: 'require-approval',
      enabled: true,
      scope: { actionTypes: ['schema-change'] },
      responseAction: 'require-approval',
      config: { reason: 'Require review for schema changes.', approvers: ['brad'] },
    };

    await apply(registry, { target: 'policy', policy });
    await apply(registry, {
      target: 'policy',
      policy: { ...policy, description: 'Updated by a reviewed reflection.' },
    });

    expect(getPolicies().get(policy.id)?.description).toBe('Updated by a reviewed reflection.');
  });

  it('fails closed when no adapter owns the requested target', async () => {
    const registry = new ReflectionPromotionAdapterRegistry([]);

    await expect(apply(registry, { target: 'memory', workspaceId: 'workspace_1' })).rejects.toThrow(
      'No typed reflection promotion adapter is registered'
    );
  });
});

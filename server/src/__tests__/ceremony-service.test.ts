import { describe, expect, it, vi } from 'vitest';
import type { Task } from '@veritas-kanban/shared';
import { CeremonyService } from '../services/ceremony-service.js';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task_20260626_ceremony',
    title: 'Ceremony task',
    description: '',
    type: 'code',
    status: 'in-progress',
    priority: 'medium',
    created: '2026-06-26T12:00:00.000Z',
    updated: '2026-06-26T12:00:00.000Z',
    ...overrides,
  } as Task;
}

function service() {
  const audit = vi.fn().mockResolvedValue(undefined);
  const record = vi.fn().mockResolvedValue({ id: 'govtrace_1' });
  return {
    audit,
    record,
    service: new CeremonyService({
      persist: false,
      audit,
      governanceTraceService: { record } as never,
    }),
  };
}

describe('CeremonyService', () => {
  it('creates, lists, and completes ceremony requirements with artifacts', async () => {
    const { audit, service: ceremonyService } = service();

    const requirement = await ceremonyService.create({
      kind: 'design_review',
      enforcementMode: 'block',
      reason: 'Task coordinates multiple agents.',
      target: { taskId: 'task_20260626_design' },
      trigger: 'task.completion',
    });

    expect(requirement).toMatchObject({
      kind: 'design_review',
      status: 'pending',
      enforcementMode: 'block',
      requiredArtifacts: ['decision-packet', 'risk-list', 'action-items'],
    });
    expect(await ceremonyService.list({ status: 'pending' })).toHaveLength(1);

    const completed = await ceremonyService.complete(requirement.id, {
      completedBy: 'brad',
      artifacts: [
        {
          kind: 'decision-packet',
          title: 'Review notes',
          body: 'Reviewed scope, risks, and rollback path.',
        },
      ],
      actionItems: [{ title: 'Add follow-up hardening task', priority: 'high' }],
    });

    expect(completed.status).toBe('completed');
    expect(completed.artifacts[0]).toMatchObject({ title: 'Review notes' });
    expect(completed.artifacts[0].createdAt).toBeDefined();
    expect(completed.actionItems[0]).toMatchObject({ priority: 'high' });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'ceremony.completed' }));
  });

  it('blocks risky task completion until the matching design review is completed', async () => {
    const { record, service: ceremonyService } = service();
    const riskyTask = task({ agents: ['codex', 'claude-code'] });

    const blocked = await ceremonyService.evaluateTaskCompletion(riskyTask, {
      ceremonyDesignReview: 'block',
    });

    expect(blocked.allowed).toBe(false);
    expect(blocked.mode).toBe('block');
    expect(blocked.pending).toHaveLength(1);
    expect(blocked.blockedReasons[0]).toMatch(/Design review required/);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ceremony' }));

    const secondEvaluation = await ceremonyService.evaluateTaskCompletion(riskyTask, {
      ceremonyDesignReview: 'block',
    });
    expect(secondEvaluation.pending).toHaveLength(1);
    expect(await ceremonyService.list({ status: 'pending' })).toHaveLength(1);

    await ceremonyService.complete(blocked.pending[0].id, { completedBy: 'brad' });
    const allowed = await ceremonyService.evaluateTaskCompletion(riskyTask, {
      ceremonyDesignReview: 'block',
    });

    expect(allowed.allowed).toBe(true);
    expect(allowed.pending).toHaveLength(0);
  });

  it('warns instead of blocking for failure retrospectives in warn mode', async () => {
    const { service: ceremonyService } = service();
    const blockedTask = task({
      status: 'blocked',
      blockedReason: { category: 'technical-snag', note: 'CI failed repeatedly.' },
    });

    const evaluation = await ceremonyService.evaluateTaskCompletion(blockedTask, {
      ceremonyFailureRetrospective: 'warn',
    });

    expect(evaluation.allowed).toBe(true);
    expect(evaluation.mode).toBe('warn');
    expect(evaluation.warnings[0]).toMatch(/Failure retrospective required/);
  });
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ReflectionCandidate,
  ReflectionConsolidationProposal,
  ReflectionMemoryDomain,
} from '@veritas-kanban/shared';
import { ReflectionConsolidationService } from '../services/reflection-consolidation-service.js';
import { FileReflectionConsolidationProposalRepository } from '../storage/reflection-consolidation-proposal-repository.js';

const roots: string[] = [];
const domain: ReflectionMemoryDomain = {
  kind: 'workspace-memory',
  id: 'primary',
  workspaceId: 'workspace_1',
};

function candidate(id: string, overrides: Partial<ReflectionCandidate> = {}): ReflectionCandidate {
  return {
    id,
    status: 'pending',
    category: 'team',
    promotionTarget: 'memory',
    confidence: 0.8,
    source: { kind: 'task-run', taskId: 'task_1', runId: 'attempt_1' },
    summary: `Summary ${id}`,
    previousApproach: 'Old approach',
    correction: 'Reviewed correction',
    nextAttempt: 'Use the reviewed correction.',
    proposedScope: 'workspace',
    evidence: [],
    tags: ['workflow'],
    duplicateKey: `duplicate-${id}`,
    duplicateCount: 1,
    appliedTargets: [],
    redaction: { redacted: false, notes: [] },
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function memoryRepository() {
  const proposals = new Map<string, ReflectionConsolidationProposal>();
  return {
    get: vi.fn(async (id: string) => proposals.get(id)),
    list: vi.fn(async () => [...proposals.values()]),
    put: vi.fn(async (proposal: ReflectionConsolidationProposal) => {
      const existing = proposals.get(proposal.id);
      if (existing) return existing;
      proposals.set(proposal.id, proposal);
      return proposal;
    }),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('ReflectionConsolidationService', () => {
  it('produces stable merge, contradiction, decay, and typed-promotion review diffs', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vk-reflection-consolidation-'));
    roots.push(root);
    const candidates = [
      candidate('candidate_a', {
        duplicateKey: 'same-lesson',
        contradictionIds: ['candidate_c'],
      }),
      candidate('candidate_b', { duplicateKey: 'same-lesson', confidence: 0.7 }),
      candidate('candidate_c', {
        status: 'accepted',
        promotionTarget: 'task-lesson',
        reviewedAt: '2025-01-01T00:00:00.000Z',
        appliedTargets: [
          {
            kind: 'task-lesson',
            id: 'task_1',
            appliedAt: '2025-01-01T00:00:00.000Z',
            appliedBy: 'brad',
          },
        ],
      }),
      candidate('candidate_policy', { promotionTarget: 'policy', confidence: 0.95 }),
    ];
    const repository = memoryRepository();
    const service = new ReflectionConsolidationService({
      reflections: { list: vi.fn(async () => ({ candidates })) },
      proposals: repository,
      lockDir: root,
    });

    const first = await service.propose({
      domain,
      candidateIds: ['candidate_policy', 'candidate_c', 'candidate_b', 'candidate_a'],
      createdAt: '2026-07-25T00:00:00.000Z',
      policy: { unusedAfterDays: 30 },
    });
    const retried = await service.propose({
      domain,
      candidateIds: ['candidate_a', 'candidate_b', 'candidate_c', 'candidate_policy'],
      createdAt: '2026-07-26T00:00:00.000Z',
      policy: { unusedAfterDays: 30 },
    });

    expect(retried.id).toBe(first.id);
    expect(retried.sourceDigest).toBe(first.sourceDigest);
    expect(first.policy.unusedAfterDays).toBe(30);
    expect(first.clusters.find((cluster) => cluster.clusterKey === 'same-lesson')).toMatchObject({
      representativeId: 'candidate_a',
      candidateIds: ['candidate_a', 'candidate_b'],
    });
    expect(first.diff.map((entry) => entry.operation)).toEqual(
      expect.arrayContaining([
        'merge-review',
        'contradiction-review',
        'decay-review',
        'promotion-review',
      ])
    );
    expect(repository.put).toHaveBeenCalledTimes(2);
  });

  it('rejects candidate sets above the configured bound instead of truncating silently', async () => {
    const service = new ReflectionConsolidationService({
      reflections: { list: vi.fn() },
      proposals: memoryRepository(),
    });

    await expect(
      service.propose({
        domain,
        candidateIds: ['candidate_a', 'candidate_b'],
        policy: { maxCandidates: 1 },
      })
    ).rejects.toThrow('exceeds the configured maximum of 1');
  });

  it('serializes proposal computation for the same memory domain', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vk-reflection-lock-'));
    roots.push(root);
    let active = 0;
    let maxActive = 0;
    const reflections = {
      list: vi.fn(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active--;
        return { candidates: [candidate('candidate_a')] };
      }),
    };
    const service = new ReflectionConsolidationService({
      reflections,
      proposals: memoryRepository(),
      lockDir: root,
    });

    await Promise.all([
      service.propose({ domain, candidateIds: ['candidate_a'] }),
      service.propose({ domain, candidateIds: ['candidate_a'] }),
    ]);

    expect(maxActive).toBe(1);
  });

  it('persists proposals across file repository restarts', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vk-reflection-proposals-'));
    roots.push(root);
    const service = new ReflectionConsolidationService({
      reflections: { list: vi.fn(async () => ({ candidates: [candidate('candidate_a')] })) },
      proposals: new FileReflectionConsolidationProposalRepository(root),
      lockDir: path.join(root, 'locks'),
    });
    const proposal = await service.propose({ domain, candidateIds: ['candidate_a'] });

    const reopened = new FileReflectionConsolidationProposalRepository(root);
    await expect(reopened.get(proposal.id)).resolves.toEqual(proposal);
  });
});

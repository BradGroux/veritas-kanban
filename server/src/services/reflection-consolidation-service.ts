import { createHash } from 'node:crypto';
import path from 'node:path';
import type {
  ReflectionCandidate,
  ReflectionConsolidationCluster,
  ReflectionConsolidationDiffEntry,
  ReflectionConsolidationPolicy,
  ReflectionConsolidationProposal,
  ReflectionMemoryDomain,
} from '@veritas-kanban/shared';
import { REFLECTION_CONSOLIDATION_SCHEMA_VERSION } from '@veritas-kanban/shared';
import { ValidationError } from '../middleware/error-handler.js';
import {
  FileReflectionConsolidationProposalRepository,
  type ReflectionConsolidationProposalRepository,
} from '../storage/reflection-consolidation-proposal-repository.js';
import { getRuntimeDir } from '../utils/paths.js';
import { withFileLock } from './file-lock.js';
import { getReflectionService } from './reflection-service.js';

const DEFAULT_POLICY: ReflectionConsolidationPolicy = {
  staleAfterDays: 180,
  unusedAfterDays: 90,
  minimumConfidence: 0.5,
  maxCandidates: 500,
};

interface ReflectionCandidateSource {
  list(input: { limit: number }): Promise<{ candidates: ReflectionCandidate[] }>;
}

export interface CreateReflectionConsolidationProposalInput {
  domain: ReflectionMemoryDomain;
  candidateIds: string[];
  policy?: Partial<ReflectionConsolidationPolicy>;
  createdAt?: string;
}

export interface ReflectionConsolidationServiceOptions {
  reflections?: ReflectionCandidateSource;
  proposals?: ReflectionConsolidationProposalRepository;
  lockDir?: string;
  now?: () => Date;
}

export class ReflectionConsolidationService {
  private readonly reflections: ReflectionCandidateSource;
  private readonly proposals: ReflectionConsolidationProposalRepository;
  private readonly lockDir: string;
  private readonly now: () => Date;

  constructor(options: ReflectionConsolidationServiceOptions = {}) {
    this.reflections = options.reflections ?? getReflectionService();
    this.proposals = options.proposals ?? new FileReflectionConsolidationProposalRepository();
    this.lockDir =
      options.lockDir ?? path.join(getRuntimeDir(), 'reflections', 'consolidation-locks');
    this.now = options.now ?? (() => new Date());
  }

  async propose(
    input: CreateReflectionConsolidationProposalInput
  ): Promise<ReflectionConsolidationProposal> {
    const policy = normalizePolicy(input.policy);
    const candidateIds = [
      ...new Set(input.candidateIds.map((id) => id.trim()).filter(Boolean)),
    ].sort();
    if (candidateIds.length === 0) {
      throw new ValidationError('At least one reflection candidate is required.');
    }
    if (candidateIds.length > policy.maxCandidates) {
      throw new ValidationError(
        `Consolidation candidate count exceeds the configured maximum of ${policy.maxCandidates}.`
      );
    }
    const lockPath = path.join(this.lockDir, `${domainKey(input.domain)}.json`);
    return withFileLock(lockPath, async () => {
      const listed = await this.reflections.list({ limit: 2000 });
      const byId = new Map(listed.candidates.map((candidate) => [candidate.id, candidate]));
      const missingIds = candidateIds.filter((id) => !byId.has(id));
      if (missingIds.length > 0) {
        throw new ValidationError('Consolidation references unknown reflection candidates.', {
          missingIds,
        });
      }
      const candidates = candidateIds.map((id) => byId.get(id) as ReflectionCandidate);
      const createdAt = input.createdAt ?? this.now().toISOString();
      const sourceDigest = digest(candidates.map(candidateSnapshot));
      const clusters = stableClusters(candidates);
      const diff = stableDiff(candidates, policy, createdAt);
      const id = `reflection_proposal_${digest({
        domain: input.domain,
        sourceDigest,
        policy,
        clusters,
        diff,
      }).slice('sha256:'.length, 'sha256:'.length + 32)}`;
      const previous = (await this.proposals.list(input.domain)).find(
        (proposal) => proposal.state === 'proposed' && proposal.id !== id
      );
      const proposal: ReflectionConsolidationProposal = {
        schemaVersion: REFLECTION_CONSOLIDATION_SCHEMA_VERSION,
        id,
        domain: input.domain,
        state: 'proposed',
        revision: 1,
        sourceDigest,
        policy,
        clusters,
        diff,
        candidateIds,
        createdAt,
        updatedAt: createdAt,
        supersedesProposalId: previous?.id,
      };
      return this.proposals.put(proposal);
    });
  }

  get(id: string): Promise<ReflectionConsolidationProposal | undefined> {
    return this.proposals.get(id);
  }

  list(domain?: ReflectionMemoryDomain): Promise<ReflectionConsolidationProposal[]> {
    return this.proposals.list(domain);
  }
}

let reflectionConsolidationService: ReflectionConsolidationService | undefined;

export function getReflectionConsolidationService(): ReflectionConsolidationService {
  reflectionConsolidationService ??= new ReflectionConsolidationService();
  return reflectionConsolidationService;
}

function normalizePolicy(
  input: Partial<ReflectionConsolidationPolicy> | undefined
): ReflectionConsolidationPolicy {
  const policy = { ...DEFAULT_POLICY, ...input };
  if (
    !Number.isInteger(policy.staleAfterDays) ||
    policy.staleAfterDays < 1 ||
    !Number.isInteger(policy.unusedAfterDays) ||
    policy.unusedAfterDays < 1 ||
    !Number.isFinite(policy.minimumConfidence) ||
    policy.minimumConfidence < 0 ||
    policy.minimumConfidence > 1 ||
    !Number.isInteger(policy.maxCandidates) ||
    policy.maxCandidates < 1 ||
    policy.maxCandidates > 2000
  ) {
    throw new ValidationError('Reflection consolidation policy is invalid.');
  }
  return policy;
}

function stableClusters(candidates: ReflectionCandidate[]): ReflectionConsolidationCluster[] {
  const groups = new Map<string, ReflectionCandidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.duplicateKey) ?? [];
    group.push(candidate);
    groups.set(candidate.duplicateKey, group);
  }
  return [...groups.entries()]
    .map(([clusterKey, members]) => {
      const ordered = [...members].sort(
        (left, right) =>
          right.confidence - left.confidence ||
          Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
          left.id.localeCompare(right.id)
      );
      return {
        clusterKey,
        representativeId: ordered[0].id,
        candidateIds: ordered.map((candidate) => candidate.id).sort(),
        contradictionIds: [
          ...new Set(ordered.flatMap((candidate) => candidate.contradictionIds ?? [])),
        ].sort(),
      };
    })
    .sort(
      (left, right) =>
        left.clusterKey.localeCompare(right.clusterKey) ||
        left.representativeId.localeCompare(right.representativeId)
    );
}

function stableDiff(
  candidates: ReflectionCandidate[],
  policy: ReflectionConsolidationPolicy,
  createdAt: string
): ReflectionConsolidationDiffEntry[] {
  const entries: ReflectionConsolidationDiffEntry[] = [];
  for (const cluster of stableClusters(candidates)) {
    if (cluster.candidateIds.length > 1) {
      entries.push({
        operation: 'merge-review',
        path: `/clusters/${encodeURIComponent(cluster.clusterKey)}`,
        candidateIds: cluster.candidateIds,
        before: { candidateIds: cluster.candidateIds },
        after: { representativeId: cluster.representativeId },
        reason: 'Candidates share a stable duplicate key and require reviewer-confirmed merge.',
      });
    }
  }
  const selected = new Set(candidates.map((candidate) => candidate.id));
  const contradictionPairs = new Set<string>();
  for (const candidate of candidates) {
    for (const contradictionId of candidate.contradictionIds ?? []) {
      if (!selected.has(contradictionId)) continue;
      const pair = [candidate.id, contradictionId].sort();
      const key = pair.join('\0');
      if (contradictionPairs.has(key)) continue;
      contradictionPairs.add(key);
      entries.push({
        operation: 'contradiction-review',
        path: `/contradictions/${pair.map(encodeURIComponent).join('/')}`,
        candidateIds: pair,
        before: null,
        after: { resolution: 'review-required' },
        reason: 'Linked candidates contradict one another and cannot be promoted together.',
      });
    }
  }
  for (const candidate of candidates) {
    if (shouldProposeDecay(candidate, policy, createdAt)) {
      entries.push({
        operation: 'decay-review',
        path: `/candidates/${encodeURIComponent(candidate.id)}/retention`,
        candidateIds: [candidate.id],
        before: {
          status: candidate.status,
          retrievalCount: candidate.retrievalCount ?? 0,
          lastRetrievedAt: candidate.lastRetrievedAt ?? null,
        },
        after: { status: 'decay-proposed' },
        reason: 'Accepted lesson is stale or unused; no deletion occurs without review.',
      });
    }
    if (
      candidate.status === 'pending' &&
      candidate.confidence >= policy.minimumConfidence &&
      candidate.promotionTarget !== 'task-lesson'
    ) {
      entries.push({
        operation: 'promotion-review',
        path: `/targets/${candidate.promotionTarget}/${encodeURIComponent(candidate.id)}`,
        candidateIds: [candidate.id],
        before: null,
        after: {
          target: candidate.promotionTarget,
          proposedScope: candidate.proposedScope ?? 'workspace',
        },
        reason: 'Wider-scope promotion requires an explicit reviewer and typed target adapter.',
      });
    }
  }
  return entries.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.operation.localeCompare(right.operation) ||
      left.candidateIds.join('\0').localeCompare(right.candidateIds.join('\0'))
  );
}

function shouldProposeDecay(
  candidate: ReflectionCandidate,
  policy: ReflectionConsolidationPolicy,
  createdAt: string
): boolean {
  if (candidate.status !== 'accepted') return false;
  const reference = candidate.lastRetrievedAt ?? candidate.reviewedAt ?? candidate.updatedAt;
  const ageDays = (Date.parse(createdAt) - Date.parse(reference)) / 86_400_000;
  if (!Number.isFinite(ageDays)) return false;
  return candidate.retrievalCount
    ? ageDays >= policy.staleAfterDays
    : ageDays >= policy.unusedAfterDays;
}

function candidateSnapshot(candidate: ReflectionCandidate) {
  return {
    id: candidate.id,
    status: candidate.status,
    category: candidate.category,
    promotionTarget: candidate.promotionTarget,
    confidence: candidate.confidence,
    duplicateKey: candidate.duplicateKey,
    contradictionIds: [...(candidate.contradictionIds ?? [])].sort(),
    retrievalCount: candidate.retrievalCount ?? 0,
    lastRetrievedAt: candidate.lastRetrievedAt ?? null,
    reviewedAt: candidate.reviewedAt ?? null,
    updatedAt: candidate.updatedAt,
  };
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function domainKey(domain: ReflectionMemoryDomain): string {
  return createHash('sha256')
    .update(domain.workspaceId)
    .update('\0')
    .update(domain.kind)
    .update('\0')
    .update(domain.id)
    .digest('hex');
}

import path from 'path';
import { nanoid } from 'nanoid';
import type {
  AcceptReflectionCandidateInput,
  CreateReflectionCandidateInput,
  DeleteReflectionCandidateInput,
  ReflectionAppliedTarget,
  ReflectionCandidate,
  ReflectionCandidateCategory,
  ReflectionCandidateStatus,
  ReflectionDuplicateGroup,
  ReflectionEvidence,
  ReflectionListResponse,
  MergeReflectionCandidateInput,
  ReflectionPromotionTarget,
  ReflectionTypedPromotionInput,
  ReflectionRedactionSummary,
  ReflectionSourceKind,
  RejectReflectionCandidateInput,
  Task,
  TaskEnvelopeMemoryReference,
} from '@veritas-kanban/shared';
import { auditLog, type AuditEvent } from './audit-service.js';
import { getTaskService } from './task-service.js';
import { ConflictError, NotFoundError } from '../middleware/error-handler.js';
import { stripHtml, validatePathSegment } from '../utils/sanitize.js';
import { getRuntimeDir } from '../utils/paths.js';
import { createLogger } from '../lib/logger.js';
import {
  FileReflectionStateRepository,
  type ReflectionState,
  type ReflectionStateRepository,
} from '../storage/reflection-state-repository.js';
import {
  getReflectionPromotionAdapterRegistry,
  type ReflectionPromotionAdapterRegistry,
} from './reflection-promotion-adapters.js';

const log = createLogger('reflection');
const MAX_CANDIDATES = 2000;
const MAX_TEXT_LENGTH = 4000;
const MAX_EVIDENCE_ITEMS = 10;
const MAX_TAGS = 20;
const MAX_CONTRADICTION_IDS = 20;
const MAX_SOURCE_EVENT_IDS = 20;
const MAX_RETRIEVALS_PER_CANDIDATE = 100;
const DEFAULT_RETRIEVAL_LIMIT = 8;

export interface ReflectionListFilters {
  status?: ReflectionCandidateStatus;
  category?: ReflectionCandidateCategory;
  sourceKind?: ReflectionSourceKind;
  taskId?: string;
  limit?: number;
}

export interface ReflectionRetrievalInput {
  task: Pick<Task, 'id' | 'title' | 'description' | 'project' | 'lessonTags'>;
  workspaceId: string;
  attemptId: string;
  retrievedAt: string;
  limit?: number;
  recordAttribution?: boolean;
}

export interface ReflectionTaskService {
  getTask(id: string): Promise<Task | null>;
  updateTask(
    id: string,
    input: { lessonsLearned?: string; lessonTags?: string[] }
  ): Promise<Task | null>;
}

export interface ReflectionServiceOptions {
  storageDir?: string;
  stateRepository?: ReflectionStateRepository;
  persist?: boolean;
  audit?: (event: AuditEvent) => Promise<void>;
  taskService?: ReflectionTaskService;
  promotionAdapters?: Pick<ReflectionPromotionAdapterRegistry, 'apply'>;
}

interface SanitizedText {
  value: string;
  redacted: boolean;
  notes: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function clampConfidence(confidence?: number): number {
  if (confidence === undefined || Number.isNaN(confidence)) return 0.5;
  return Math.min(1, Math.max(0, confidence));
}

function defaultPromotionTarget(input: CreateReflectionCandidateInput): ReflectionPromotionTarget {
  return input.promotionTarget ?? (input.source.taskId ? 'task-lesson' : 'memory');
}

function normalizeForKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 240);
}

function deriveDuplicateKey(input: CreateReflectionCandidateInput): string {
  if (input.duplicateKey?.trim()) return normalizeForKey(input.duplicateKey);
  return [
    input.category,
    defaultPromotionTarget(input),
    normalizeForKey(input.summary),
    normalizeForKey(input.nextAttempt),
  ]
    .filter(Boolean)
    .join('|');
}

function lessonEntry(
  candidate: ReflectionCandidate,
  acceptedAt: string,
  reviewedBy: string
): string {
  return [
    `### Reflection Lesson: ${candidate.id}`,
    `**Category**: ${candidate.category}`,
    `**Source**: ${candidate.source.kind}`,
    candidate.summary ? `**What happened**: ${candidate.summary}` : '',
    candidate.previousApproach ? `**Previous approach**: ${candidate.previousApproach}` : '',
    candidate.correction ? `**Correction**: ${candidate.correction}` : '',
    candidate.nextAttempt ? `**Next attempt**: ${candidate.nextAttempt}` : '',
    candidate.reviewerNote ? `**Reviewer note**: ${candidate.reviewerNote}` : '',
    `*Accepted by ${reviewedBy} at ${acceptedAt}*`,
  ]
    .filter(Boolean)
    .join('\n');
}

export class ReflectionService {
  private readonly stateRepository: ReflectionStateRepository;
  private readonly persist: boolean;
  private readonly audit: (event: AuditEvent) => Promise<void>;
  private readonly taskService: ReflectionTaskService;
  private readonly promotionAdapters: Pick<ReflectionPromotionAdapterRegistry, 'apply'>;
  private loaded = false;
  private state: ReflectionState = this.emptyState();

  constructor(options: ReflectionServiceOptions = {}) {
    const storageDir = options.storageDir ?? path.join(getRuntimeDir(), 'reflections');
    this.stateRepository = options.stateRepository ?? new FileReflectionStateRepository(storageDir);
    this.persist = options.persist ?? process.env.VITEST !== 'true';
    this.audit = options.audit ?? auditLog;
    this.taskService = options.taskService ?? getTaskService();
    this.promotionAdapters = options.promotionAdapters ?? getReflectionPromotionAdapterRegistry();
  }

  async list(filters: ReflectionListFilters = {}): Promise<ReflectionListResponse> {
    await this.ensureLoaded();
    this.refreshDuplicateCounts();

    const limit = Math.max(1, Math.min(Math.floor(filters.limit ?? 100), MAX_CANDIDATES));
    const filtered = this.state.candidates
      .filter((candidate) => !filters.status || candidate.status === filters.status)
      .filter((candidate) => !filters.category || candidate.category === filters.category)
      .filter((candidate) => !filters.sourceKind || candidate.source.kind === filters.sourceKind)
      .filter((candidate) => !filters.taskId || candidate.source.taskId === filters.taskId)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

    return {
      candidates: filtered.slice(0, limit),
      duplicateGroups: this.duplicateGroups(filtered),
      total: filtered.length,
    };
  }

  async retrieveForTask(input: ReflectionRetrievalInput): Promise<TaskEnvelopeMemoryReference[]> {
    await this.ensureLoaded();
    const limit = Math.max(1, Math.min(Math.floor(input.limit ?? DEFAULT_RETRIEVAL_LIMIT), 20));
    const queryTokens = tokenizeReflectionText(
      [
        input.task.title,
        input.task.description,
        input.task.project,
        ...(input.task.lessonTags ?? []),
      ]
        .filter(Boolean)
        .join(' ')
    );
    const ranked = this.state.candidates
      .filter(
        (candidate) =>
          candidate.status === 'accepted' &&
          candidate.source.taskId === input.task.id &&
          (candidate.appliedTargets ?? []).some((target) => target.kind === 'task-lesson')
      )
      .map((candidate) => ({
        candidate,
        score: reflectionRelevanceScore(candidate, input.task.id, queryTokens, input.retrievedAt),
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.candidate.confidence - left.candidate.confidence ||
          Date.parse(right.candidate.updatedAt) - Date.parse(left.candidate.updatedAt) ||
          left.candidate.id.localeCompare(right.candidate.id)
      )
      .slice(0, limit);

    const references = ranked.map(({ candidate, score }) => ({
      reflectionId: candidate.id.slice(0, 160),
      sourceTaskId: candidate.source.taskId?.slice(0, 160),
      sourceRunId: candidate.source.runId?.slice(0, 160),
      sourceEventIds:
        candidate.source.eventIds
          ?.slice(0, MAX_SOURCE_EVENT_IDS)
          .map((eventId) => eventId.trim().slice(0, 160))
          .filter(Boolean) ?? [],
      category: candidate.category,
      summary:
        candidate.summary ||
        candidate.correction ||
        candidate.nextAttempt ||
        'Reviewed reflection lesson.',
      guidance:
        candidate.nextAttempt ||
        candidate.correction ||
        candidate.summary ||
        'Apply the reviewed lesson when relevant.',
      confidence: candidate.confidence,
      relevanceScore: score,
      retrievalCount: (candidate.retrievalCount ?? 0) + (input.recordAttribution ? 1 : 0),
      retrievedAt: input.retrievedAt,
    }));

    if (input.recordAttribution && ranked.length > 0) {
      for (const { candidate, score } of ranked) {
        candidate.retrievalCount = (candidate.retrievalCount ?? 0) + 1;
        candidate.lastRetrievedAt = input.retrievedAt;
        candidate.retrievals = [
          ...(candidate.retrievals ?? []),
          {
            taskId: input.task.id,
            attemptId: input.attemptId,
            workspaceId: input.workspaceId,
            relevanceScore: score,
            retrievedAt: input.retrievedAt,
          },
        ].slice(-MAX_RETRIEVALS_PER_CANDIDATE);
      }
      await this.saveState();
      for (const { candidate, score } of ranked) {
        await this.audit({
          action: 'reflection.retrieved',
          actor: 'system',
          resource: candidate.id,
          details: {
            taskId: input.task.id,
            attemptId: input.attemptId,
            workspaceId: input.workspaceId,
            relevanceScore: score,
            retrievalCount: candidate.retrievalCount,
          },
        }).catch((error) => {
          log.warn(
            { err: error, reflectionId: candidate.id, attemptId: input.attemptId },
            'Failed to append reflection retrieval audit event'
          );
        });
      }
    }

    return references;
  }

  async create(input: CreateReflectionCandidateInput): Promise<ReflectionCandidate> {
    await this.ensureLoaded();

    const sanitized = this.sanitizeInput(input);
    const idempotencyKey = input.idempotencyKey
      ? this.sanitizeText(input.idempotencyKey).value.slice(0, 240)
      : undefined;
    if (idempotencyKey) {
      const existing = this.state.candidates.find(
        (candidate) => candidate.idempotencyKey === idempotencyKey
      );
      if (existing) return existing;
    }
    const duplicateKey = deriveDuplicateKey({ ...input, ...sanitized.values });
    const duplicateOf = this.findDuplicateRepresentative(duplicateKey);
    const timestamp = nowIso();

    const candidate: ReflectionCandidate = {
      id: `reflection_${Date.now()}_${nanoid(6)}`,
      idempotencyKey,
      status: 'pending',
      category: input.category,
      promotionTarget: defaultPromotionTarget(input),
      confidence: clampConfidence(input.confidence),
      source: {
        ...input.source,
        eventIds: input.source.eventIds
          ?.slice(0, MAX_SOURCE_EVENT_IDS)
          .map((id) => this.sanitizeText(id).value)
          .filter(Boolean),
        url: input.source.url ? this.sanitizeText(input.source.url).value : undefined,
      },
      summary: sanitized.values.summary,
      previousApproach: sanitized.values.previousApproach,
      correction: sanitized.values.correction,
      nextAttempt: sanitized.values.nextAttempt,
      proposedScope: input.proposedScope,
      rationale: sanitized.values.rationale,
      applicability: sanitized.values.applicability,
      contradictionIds: input.contradictionIds
        ?.slice(0, MAX_CONTRADICTION_IDS)
        .map((id) => this.sanitizeText(id).value)
        .filter(Boolean),
      evidence: sanitized.evidence,
      tags: this.sanitizeTags(input.tags ?? []),
      duplicateKey,
      duplicateOf,
      duplicateCount: 1,
      appliedTargets: [],
      redaction: sanitized.redaction,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: input.createdBy ? this.sanitizeText(input.createdBy).value : undefined,
    };

    this.state.candidates.push(candidate);
    if (this.state.candidates.length > MAX_CANDIDATES) {
      this.state.candidates = this.state.candidates.slice(-MAX_CANDIDATES);
    }
    this.refreshDuplicateCounts();
    await this.saveState();
    await this.auditChange('reflection.created', candidate, candidate.createdBy ?? 'system');
    return candidate;
  }

  async accept(id: string, input: AcceptReflectionCandidateInput): Promise<ReflectionCandidate> {
    validatePathSegment(id);
    await this.ensureLoaded();
    const candidate = this.findPendingCandidate(id);
    const timestamp = nowIso();
    const reviewedBy = this.sanitizeText(input.reviewedBy).value || 'operator';
    if (
      input.promotion &&
      input.promotionTarget &&
      input.promotion.target !== input.promotionTarget
    ) {
      throw new ConflictError('Typed promotion input does not match the requested target.');
    }
    const promotionTarget =
      input.promotion?.target ?? input.promotionTarget ?? candidate.promotionTarget;
    const reviewerNote = input.reviewerNote
      ? this.sanitizeText(input.reviewerNote).value
      : undefined;
    const promotionCandidate: ReflectionCandidate = {
      ...candidate,
      promotionTarget,
      reviewerNote,
    };
    const appliedTargets = await this.applyPromotion(
      promotionCandidate,
      promotionTarget,
      input.promotion,
      reviewedBy,
      timestamp
    );

    candidate.status = 'accepted';
    candidate.reviewedAt = timestamp;
    candidate.reviewedBy = reviewedBy;
    candidate.reviewerNote = reviewerNote;
    candidate.promotionTarget = promotionTarget;
    candidate.appliedTargets = appliedTargets;
    candidate.updatedAt = timestamp;

    this.refreshDuplicateCounts();
    await this.saveState();
    await this.auditChange('reflection.accepted', candidate, reviewedBy);
    return candidate;
  }

  async reject(id: string, input: RejectReflectionCandidateInput): Promise<ReflectionCandidate> {
    validatePathSegment(id);
    await this.ensureLoaded();
    const candidate = this.findPendingCandidate(id);
    const timestamp = nowIso();
    const reviewedBy = this.sanitizeText(input.reviewedBy).value || 'operator';

    candidate.status = 'rejected';
    candidate.reviewedAt = timestamp;
    candidate.reviewedBy = reviewedBy;
    candidate.rejectionReason = this.sanitizeText(input.reason).value;
    candidate.updatedAt = timestamp;

    this.refreshDuplicateCounts();
    await this.saveState();
    await this.auditChange('reflection.rejected', candidate, reviewedBy);
    return candidate;
  }

  async delete(id: string, input: DeleteReflectionCandidateInput): Promise<ReflectionCandidate> {
    validatePathSegment(id);
    await this.ensureLoaded();
    const candidate = this.findById(id);
    if (!candidate) throw new NotFoundError('Reflection candidate not found');
    if (candidate.status === 'deleted') {
      throw new ConflictError('Reflection candidate is already deleted');
    }

    const timestamp = nowIso();
    const deletedBy = this.sanitizeText(input.deletedBy).value || 'operator';
    candidate.status = 'deleted';
    candidate.deletedAt = timestamp;
    candidate.deletedBy = deletedBy;
    candidate.deleteReason = input.reason ? this.sanitizeText(input.reason).value : undefined;
    candidate.updatedAt = timestamp;

    this.refreshDuplicateCounts();
    await this.saveState();
    await this.auditChange('reflection.deleted', candidate, deletedBy);
    return candidate;
  }

  async mergeDuplicate(
    id: string,
    input: MergeReflectionCandidateInput
  ): Promise<ReflectionCandidate> {
    validatePathSegment(id);
    await this.ensureLoaded();
    const candidate = this.findById(id);
    if (!candidate) throw new NotFoundError('Reflection candidate not found');
    if (candidate.status === 'deleted') {
      throw new ConflictError('Reflection candidate is already deleted');
    }
    const representativeId =
      candidate.duplicateOf ?? this.findDuplicateRepresentative(candidate.duplicateKey);
    if (!representativeId || representativeId === candidate.id || candidate.duplicateCount < 2) {
      throw new ConflictError('Reflection candidate has no duplicate representative');
    }

    const timestamp = nowIso();
    const mergedBy = this.sanitizeText(input.mergedBy).value || 'operator';
    candidate.status = 'deleted';
    candidate.deletedAt = timestamp;
    candidate.deletedBy = mergedBy;
    candidate.deleteReason = `Merged into ${representativeId}`;
    candidate.mergedInto = representativeId;
    candidate.updatedAt = timestamp;

    this.refreshDuplicateCounts();
    await this.saveState();
    await this.auditChange('reflection.merged', candidate, mergedBy);
    return candidate;
  }

  private async applyPromotion(
    candidate: ReflectionCandidate,
    target: ReflectionPromotionTarget,
    promotion: ReflectionTypedPromotionInput | undefined,
    reviewedBy: string,
    timestamp: string
  ): Promise<ReflectionAppliedTarget[]> {
    if (target !== 'task-lesson') {
      if (!promotion || promotion.target !== target) {
        throw new ConflictError(
          `${target} promotion requires explicit typed target input from the reviewer.`
        );
      }
      return [
        await this.promotionAdapters.apply({
          candidate,
          promotion,
          reviewedBy,
          timestamp,
        }),
      ];
    }
    if (promotion) {
      throw new ConflictError('Task lesson promotion does not accept wider target input.');
    }

    const taskId = candidate.source.taskId;
    if (!taskId) {
      throw new ConflictError('Task lesson promotion requires a linked taskId');
    }

    const task = await this.taskService.getTask(taskId);
    if (!task) throw new NotFoundError('Linked task not found');

    const entry = lessonEntry(candidate, timestamp, reviewedBy);
    const existingLessons = task.lessonsLearned?.trim();
    const lessonsLearned = existingLessons ? `${existingLessons}\n\n---\n\n${entry}` : entry;
    const lessonTags = [
      ...(task.lessonTags ?? []),
      'reflection',
      `reflection:${candidate.category}`,
      `source:${candidate.source.kind}`,
      ...candidate.tags,
    ];

    await this.taskService.updateTask(taskId, {
      lessonsLearned,
      lessonTags: [...new Set(lessonTags)].slice(0, 50),
    });

    return [
      {
        kind: 'task-lesson',
        id: task.id,
        title: task.title,
        appliedAt: timestamp,
        appliedBy: reviewedBy,
      },
    ];
  }

  private findPendingCandidate(id: string): ReflectionCandidate {
    const candidate = this.findById(id);
    if (!candidate) throw new NotFoundError('Reflection candidate not found');
    if (candidate.status !== 'pending') {
      throw new ConflictError('Reflection candidate is not pending');
    }
    return candidate;
  }

  private findById(id: string): ReflectionCandidate | undefined {
    return this.state.candidates.find((candidate) => candidate.id === id);
  }

  private findDuplicateRepresentative(duplicateKey: string): string | undefined {
    return this.state.candidates.find(
      (candidate) => candidate.status !== 'deleted' && candidate.duplicateKey === duplicateKey
    )?.id;
  }

  private duplicateGroups(candidates: ReflectionCandidate[]): ReflectionDuplicateGroup[] {
    const groups = new Map<string, ReflectionCandidate[]>();
    for (const candidate of candidates.filter((item) => item.status !== 'deleted')) {
      const existing = groups.get(candidate.duplicateKey) ?? [];
      existing.push(candidate);
      groups.set(candidate.duplicateKey, existing);
    }

    return Array.from(groups.entries())
      .filter(([, group]) => group.length > 1)
      .map(([duplicateKey, group]) => ({
        duplicateKey,
        candidateIds: group.map((candidate) => candidate.id),
        representativeId: group[0].duplicateOf ?? group[0].id,
        statusCounts: group.reduce<Partial<Record<ReflectionCandidateStatus, number>>>(
          (counts, candidate) => ({
            ...counts,
            [candidate.status]: (counts[candidate.status] ?? 0) + 1,
          }),
          {}
        ),
      }));
  }

  private refreshDuplicateCounts(): void {
    const counts = new Map<string, number>();
    for (const candidate of this.state.candidates) {
      if (candidate.status === 'deleted') continue;
      counts.set(candidate.duplicateKey, (counts.get(candidate.duplicateKey) ?? 0) + 1);
    }
    for (const candidate of this.state.candidates) {
      candidate.duplicateCount = counts.get(candidate.duplicateKey) ?? 1;
    }
  }

  private sanitizeInput(input: CreateReflectionCandidateInput): {
    values: Pick<
      CreateReflectionCandidateInput,
      'summary' | 'previousApproach' | 'correction' | 'nextAttempt' | 'rationale' | 'applicability'
    >;
    evidence: ReflectionEvidence[];
    redaction: ReflectionRedactionSummary;
  } {
    const notes = new Set<string>();
    let redacted = false;
    const sanitizeField = (value: string): string => {
      const result = this.sanitizeText(value);
      result.notes.forEach((note) => notes.add(note));
      redacted = redacted || result.redacted;
      return result.value;
    };

    const evidence = (input.evidence ?? []).slice(0, MAX_EVIDENCE_ITEMS).map((item) => ({
      kind: item.kind,
      title: sanitizeField(item.title),
      content: sanitizeField(item.content),
      url: item.url ? sanitizeField(item.url) : undefined,
    }));

    return {
      values: {
        summary: sanitizeField(input.summary),
        previousApproach: sanitizeField(input.previousApproach),
        correction: sanitizeField(input.correction),
        nextAttempt: sanitizeField(input.nextAttempt),
        rationale: input.rationale ? sanitizeField(input.rationale) : undefined,
        applicability: input.applicability ? sanitizeField(input.applicability) : undefined,
      },
      evidence,
      redaction: {
        redacted,
        notes: Array.from(notes),
      },
    };
  }

  private sanitizeText(value: string): SanitizedText {
    let clean = stripHtml(value).slice(0, MAX_TEXT_LENGTH);
    const notes: string[] = [];
    const replacements: Array<[RegExp, string, string]> = [
      [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]', 'bearer-token'],
      [/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_SECRET]', 'api-secret'],
      [/\bgh[pousr]_[A-Za-z0-9_]{8,}\b/g, '[REDACTED_SECRET]', 'github-token'],
      [
        /\b(api[_-]?key|token|secret|password)\s*[:=]\s*['"]?[^'"\s]+/gi,
        '$1=[REDACTED]',
        'credential',
      ],
      [/\/Users\/[^/\s]+\/[^\s`"'<>)]*/g, '[REDACTED_PATH]', 'private-path'],
    ];

    for (const [pattern, replacement, note] of replacements) {
      if (pattern.test(clean)) {
        clean = clean.replace(pattern, replacement);
        notes.push(note);
      }
    }

    return {
      value: clean.trim(),
      redacted: notes.length > 0,
      notes: [...new Set(notes)],
    };
  }

  private sanitizeTags(tags: string[]): string[] {
    return [
      ...new Set(
        tags
          .map((tag) => this.sanitizeText(tag).value.toLowerCase())
          .map((tag) => tag.replace(/[^a-z0-9:_-]+/g, '-').replace(/^-+|-+$/g, ''))
          .filter(Boolean)
      ),
    ].slice(0, MAX_TAGS);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.persist) {
      this.loaded = true;
      return;
    }

    const state = await this.stateRepository.read();
    if (state) {
      this.state = state;
      this.refreshDuplicateCounts();
    } else {
      this.state = this.emptyState();
    }
    this.loaded = true;
  }

  private async saveState(): Promise<void> {
    this.state.updatedAt = nowIso();
    if (!this.persist) return;
    await this.stateRepository.write(this.state);
  }

  private emptyState(): ReflectionState {
    return { version: 1, candidates: [], updatedAt: nowIso() };
  }

  private async auditChange(
    action: string,
    candidate: ReflectionCandidate,
    actor: string
  ): Promise<void> {
    await this.audit({
      action,
      actor,
      resource: candidate.id,
      details: {
        status: candidate.status,
        idempotencyKey: candidate.idempotencyKey,
        category: candidate.category,
        promotionTarget: candidate.promotionTarget,
        source: candidate.source,
        duplicateKey: candidate.duplicateKey,
        duplicateOf: candidate.duplicateOf,
        duplicateCount: candidate.duplicateCount,
        appliedTargets: candidate.appliedTargets,
        redaction: candidate.redaction,
        mergedInto: candidate.mergedInto,
      },
    });
  }
}

function tokenizeReflectionText(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
      .slice(0, 256)
  );
}

function reflectionRelevanceScore(
  candidate: ReflectionCandidate,
  taskId: string,
  queryTokens: Set<string>,
  retrievedAt: string
): number {
  const candidateTokens = tokenizeReflectionText(
    [
      candidate.summary,
      candidate.correction,
      candidate.nextAttempt,
      candidate.applicability,
      ...(candidate.tags ?? []),
    ]
      .filter(Boolean)
      .join(' ')
  );
  const overlap = [...candidateTokens].filter((token) => queryTokens.has(token)).length;
  const overlapRatio =
    candidateTokens.size === 0 || queryTokens.size === 0
      ? 0
      : overlap / Math.min(candidateTokens.size, queryTokens.size);
  const exactTaskBoost = candidate.source.taskId === taskId ? 0.5 : 0;
  const relevance = Math.min(0.3, overlapRatio * 0.3);
  const confidence = candidate.confidence * 0.12;
  const observedUse = Math.min(0.06, Math.log1p(candidate.retrievalCount ?? 0) * 0.02);
  const retrievedTime = Date.parse(retrievedAt);
  const candidateTime = Date.parse(candidate.reviewedAt ?? candidate.updatedAt);
  const ageDays =
    Number.isFinite(retrievedTime) && Number.isFinite(candidateTime)
      ? Math.max(0, (retrievedTime - candidateTime) / 86_400_000)
      : 365;
  const freshness = Math.max(0, 0.02 - Math.min(ageDays, 365) * (0.02 / 365));
  return Number(
    Math.min(1, exactTaskBoost + relevance + confidence + observedUse + freshness).toFixed(6)
  );
}

let reflectionService: ReflectionService | null = null;

export function getReflectionService(): ReflectionService {
  reflectionService ??= new ReflectionService();
  return reflectionService;
}

export function resetReflectionServiceForTests(service?: ReflectionService): void {
  reflectionService = service ?? null;
}

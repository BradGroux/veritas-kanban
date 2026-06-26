import fs from 'fs/promises';
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
  ReflectionRedactionSummary,
  ReflectionSourceKind,
  RejectReflectionCandidateInput,
  Task,
} from '@veritas-kanban/shared';
import { auditLog, type AuditEvent } from './audit-service.js';
import { withFileLock } from './file-lock.js';
import { getTaskService } from './task-service.js';
import { ConflictError, NotFoundError } from '../middleware/error-handler.js';
import { ensureWithinBase, stripHtml, validatePathSegment } from '../utils/sanitize.js';
import { getRuntimeDir } from '../utils/paths.js';

const MAX_CANDIDATES = 2000;
const MAX_TEXT_LENGTH = 4000;
const MAX_EVIDENCE_ITEMS = 10;
const MAX_TAGS = 20;

interface ReflectionState {
  version: 1;
  candidates: ReflectionCandidate[];
  updatedAt: string;
}

export interface ReflectionListFilters {
  status?: ReflectionCandidateStatus;
  category?: ReflectionCandidateCategory;
  sourceKind?: ReflectionSourceKind;
  taskId?: string;
  limit?: number;
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
  persist?: boolean;
  audit?: (event: AuditEvent) => Promise<void>;
  taskService?: ReflectionTaskService;
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
  private readonly storageDir: string;
  private readonly persist: boolean;
  private readonly audit: (event: AuditEvent) => Promise<void>;
  private readonly taskService: ReflectionTaskService;
  private loaded = false;
  private state: ReflectionState = this.emptyState();

  constructor(options: ReflectionServiceOptions = {}) {
    this.storageDir = options.storageDir ?? path.join(getRuntimeDir(), 'reflections');
    this.persist = options.persist ?? process.env.VITEST !== 'true';
    this.audit = options.audit ?? auditLog;
    this.taskService = options.taskService ?? getTaskService();
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

  async create(input: CreateReflectionCandidateInput): Promise<ReflectionCandidate> {
    await this.ensureLoaded();

    const sanitized = this.sanitizeInput(input);
    const duplicateKey = deriveDuplicateKey({ ...input, ...sanitized.values });
    const duplicateOf = this.findDuplicateRepresentative(duplicateKey);
    const timestamp = nowIso();

    const candidate: ReflectionCandidate = {
      id: `reflection_${Date.now()}_${nanoid(6)}`,
      status: 'pending',
      category: input.category,
      promotionTarget: defaultPromotionTarget(input),
      confidence: clampConfidence(input.confidence),
      source: {
        ...input.source,
        url: input.source.url ? this.sanitizeText(input.source.url).value : undefined,
      },
      summary: sanitized.values.summary,
      previousApproach: sanitized.values.previousApproach,
      correction: sanitized.values.correction,
      nextAttempt: sanitized.values.nextAttempt,
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
    const promotionTarget = input.promotionTarget ?? candidate.promotionTarget;
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
    reviewedBy: string,
    timestamp: string
  ): Promise<ReflectionAppliedTarget[]> {
    if (target !== 'task-lesson') {
      return [
        {
          kind: 'manual-review',
          id: target,
          title: `${target} promotion queued for manual application`,
          appliedAt: timestamp,
          appliedBy: reviewedBy,
        },
      ];
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
      'summary' | 'previousApproach' | 'correction' | 'nextAttempt'
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

    await fs.mkdir(this.storageDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.statePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<ReflectionState>;
      this.state = {
        version: 1,
        candidates: Array.isArray(parsed.candidates)
          ? (parsed.candidates as ReflectionCandidate[])
          : [],
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso(),
      };
      this.refreshDuplicateCounts();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      this.state = this.emptyState();
    }
    this.loaded = true;
  }

  private async saveState(): Promise<void> {
    this.state.updatedAt = nowIso();
    if (!this.persist) return;
    await fs.mkdir(this.storageDir, { recursive: true });
    await withFileLock(this.statePath, async () => {
      await fs.writeFile(this.statePath, JSON.stringify(this.state, null, 2), 'utf-8');
    });
  }

  private get statePath(): string {
    const filePath = path.join(this.storageDir, 'candidates.json');
    ensureWithinBase(this.storageDir, filePath);
    return filePath;
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

let reflectionService: ReflectionService | null = null;

export function getReflectionService(): ReflectionService {
  reflectionService ??= new ReflectionService();
  return reflectionService;
}

export function resetReflectionServiceForTests(service?: ReflectionService): void {
  reflectionService = service ?? null;
}

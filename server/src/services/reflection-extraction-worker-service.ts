import { nanoid } from 'nanoid';
import type {
  CompletionResult,
  CreateReflectionCandidateInput,
  ReflectionCandidate,
  ReflectionExtractionJob,
  Task,
  TaskCompletionStatus,
} from '@veritas-kanban/shared';
import { createLogger } from '../lib/logger.js';
import {
  getReflectionExtractionJobService,
  type ReflectionExtractionJobService,
} from './reflection-extraction-job-service.js';
import { getReflectionService } from './reflection-service.js';
import { getTaskService } from './task-service.js';

const log = createLogger('reflection-extraction-worker');
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MAX_SOURCE_TEXT = 4_000;
const MAX_SOURCE_ITEMS = 12;

export interface ReflectionExtractionSourceMaterial {
  workspaceId: string;
  taskId: string;
  taskTitle: string;
  attemptId: string;
  completionId: string;
  completionDigest: string;
  runEventId?: string;
  status: TaskCompletionStatus;
  summary: string;
  error?: string;
  blockers: Array<{ code: string; summary: string; detail: string; retryable: boolean }>;
  evidence: Array<{ id: string; summary: string; verified: boolean }>;
  verification: Array<{ gateId: string; status: string; summary: string }>;
}

export interface ReflectionExtractionSourceLoader {
  load(job: ReflectionExtractionJob): Promise<ReflectionExtractionSourceMaterial>;
}

export interface ReflectionCandidateExtractor {
  extract(source: ReflectionExtractionSourceMaterial): Promise<CreateReflectionCandidateInput[]>;
}

interface ReflectionJobClient {
  claim(ownerId: string, workspaceId?: string): ReturnType<ReflectionExtractionJobService['claim']>;
  complete(
    id: string,
    input: Parameters<ReflectionExtractionJobService['complete']>[1]
  ): ReturnType<ReflectionExtractionJobService['complete']>;
  fail(
    id: string,
    input: Parameters<ReflectionExtractionJobService['fail']>[1]
  ): ReturnType<ReflectionExtractionJobService['fail']>;
}

export interface ReflectionExtractionEnqueuer {
  enqueue(
    input: Parameters<ReflectionExtractionJobService['enqueue']>[0]
  ): ReturnType<ReflectionExtractionJobService['enqueue']>;
}

export interface ScheduleReflectionExtractionJobInput {
  jobs: ReflectionExtractionEnqueuer;
  workspaceId: string;
  completion: CompletionResult;
  runEventId?: string;
  onError?: (error: unknown) => void;
}

export function scheduleReflectionExtractionJob(
  input: ScheduleReflectionExtractionJobInput
): boolean {
  if (input.completion.status === 'interrupted' || !input.completion.summary.trim()) return false;
  queueMicrotask(() => {
    void input.jobs
      .enqueue({
        workspaceId: input.workspaceId,
        idempotencyKey: `completion:${input.completion.idempotencyKey}`,
        source: {
          taskId: input.completion.taskId,
          attemptId: input.completion.attemptId,
          completionId: input.completion.idempotencyKey,
          completionDigest: input.completion.digest,
          runEventId: input.runEventId,
        },
      })
      .catch((error) => input.onError?.(error));
  });
  return true;
}

interface ReflectionCandidateWriter {
  create(input: CreateReflectionCandidateInput): Promise<ReflectionCandidate>;
}

export interface ReflectionExtractionWorkerOptions {
  jobs?: ReflectionJobClient;
  reflections?: ReflectionCandidateWriter;
  sourceLoader?: ReflectionExtractionSourceLoader;
  extractor?: ReflectionCandidateExtractor;
  ownerId?: string;
  pollIntervalMs?: number;
}

export class TaskCompletionReflectionSourceLoader implements ReflectionExtractionSourceLoader {
  async load(job: ReflectionExtractionJob): Promise<ReflectionExtractionSourceMaterial> {
    const task = await getTaskService().getTask(job.source.taskId);
    if (!task) throw extractionError('SOURCE_TASK_NOT_FOUND', 'Source task no longer exists.');
    const attempt = findAttempt(task, job.source.attemptId);
    const completion = attempt?.completionResult;
    if (!completion) {
      throw extractionError(
        'SOURCE_COMPLETION_NOT_FOUND',
        'Source attempt has no durable completion result.'
      );
    }
    if (
      completion.idempotencyKey !== job.source.completionId ||
      completion.digest !== job.source.completionDigest
    ) {
      throw extractionError(
        'SOURCE_COMPLETION_MISMATCH',
        'Durable completion identity does not match the extraction job.'
      );
    }
    return minimizeCompletion(job, task, completion);
  }
}

export class DeterministicReflectionCandidateExtractor implements ReflectionCandidateExtractor {
  async extract(
    source: ReflectionExtractionSourceMaterial
  ): Promise<CreateReflectionCandidateInput[]> {
    if (!['blocked', 'failed', 'partial'].includes(source.status)) return [];
    const blocker = source.blockers[0];
    const correction = blocker
      ? `Resolve ${blocker.summary}. ${blocker.detail}`
      : source.error
        ? `Address the terminal failure: ${source.error}`
        : 'Review the incomplete run and resolve the missing requirement before retrying.';
    const nextAttempt = blocker?.retryable
      ? `Retry only after confirming the ${blocker.code} blocker is resolved.`
      : 'Revise the approach before starting another attempt.';
    return [
      {
        category: 'session',
        promotionTarget: 'task-lesson',
        confidence: blocker ? 0.72 : 0.62,
        source: {
          kind: blocker ? 'error' : 'task-run',
          taskId: source.taskId,
          runId: source.attemptId,
          eventIds: source.runEventId ? [source.runEventId] : undefined,
          errorId: blocker?.code,
        },
        summary: source.summary,
        previousApproach: `The run ended with status ${source.status}.`,
        correction,
        nextAttempt,
        proposedScope: 'task',
        rationale: 'Derived from the authoritative, durable completion result.',
        applicability: `Future attempts for task ${source.taskId} with the same blocker or failure mode.`,
        evidence: [
          ...source.blockers.slice(0, 3).map((item) => ({
            kind: 'error' as const,
            title: item.summary,
            content: item.detail,
          })),
          ...source.evidence
            .filter((item) => item.verified)
            .slice(0, 3)
            .map((item) => ({
              kind: 'task-run' as const,
              title: item.id,
              content: item.summary,
            })),
        ],
        tags: ['extracted', `completion:${source.status}`],
        createdBy: 'reflection-extraction-worker',
      },
    ];
  }
}

export class ReflectionExtractionWorkerService {
  private readonly jobs: ReflectionJobClient;
  private readonly reflections: ReflectionCandidateWriter;
  private readonly sourceLoader: ReflectionExtractionSourceLoader;
  private readonly extractor: ReflectionCandidateExtractor;
  private readonly ownerId: string;
  private readonly pollIntervalMs: number;
  private timer?: ReturnType<typeof setInterval>;
  private tickActive = false;

  constructor(options: ReflectionExtractionWorkerOptions = {}) {
    this.jobs = options.jobs ?? getReflectionExtractionJobService();
    this.reflections = options.reflections ?? getReflectionService();
    this.sourceLoader = options.sourceLoader ?? new TaskCompletionReflectionSourceLoader();
    this.extractor = options.extractor ?? new DeterministicReflectionCandidateExtractor();
    this.ownerId = options.ownerId ?? `reflection-worker-${process.pid}-${nanoid(8)}`;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async runOnce(workspaceId?: string): Promise<'processed' | 'empty' | 'busy'> {
    const claim = await this.jobs.claim(this.ownerId, workspaceId);
    if (!claim.claimed) return claim.reason === 'empty' ? 'empty' : 'busy';
    await this.process(claim.job);
    return 'processed';
  }

  private async tick(): Promise<void> {
    if (this.tickActive) return;
    this.tickActive = true;
    try {
      for (let index = 0; index < 4; index++) {
        const result = await this.runOnce();
        if (result !== 'processed') break;
      }
    } catch (error) {
      log.error({ err: error }, 'Reflection extraction worker tick failed');
    } finally {
      this.tickActive = false;
    }
  }

  private async process(job: ReflectionExtractionJob): Promise<void> {
    try {
      const source = await this.sourceLoader.load(job);
      const drafts = (await this.extractor.extract(source)).slice(0, 8);
      const candidateIds: string[] = [];
      for (const [index, draft] of drafts.entries()) {
        const candidate = await this.reflections.create({
          ...draft,
          idempotencyKey: `${job.id}:candidate:${index}`,
        });
        candidateIds.push(candidate.id);
      }
      await this.jobs.complete(job.id, {
        expectedRevision: job.revision,
        ownerId: this.ownerId,
        candidateIds,
      });
    } catch (error) {
      const code = extractionErrorCode(error);
      const summary = safeErrorSummary(error);
      await this.jobs.fail(job.id, {
        expectedRevision: job.revision,
        ownerId: this.ownerId,
        code,
        summary,
      });
      log.warn({ jobId: job.id, code, summary }, 'Reflection extraction job failed');
    }
  }
}

function findAttempt(task: Task, attemptId: string) {
  if (task.attempt?.id === attemptId) return task.attempt;
  return task.attempts?.find((attempt) => attempt.id === attemptId);
}

function minimizeCompletion(
  job: ReflectionExtractionJob,
  task: Task,
  completion: CompletionResult
): ReflectionExtractionSourceMaterial {
  const text = (value: string | null | undefined) => value?.slice(0, MAX_SOURCE_TEXT) ?? '';
  return {
    workspaceId: job.workspaceId,
    taskId: job.source.taskId,
    taskTitle: text(task.title),
    attemptId: job.source.attemptId,
    completionId: job.source.completionId,
    completionDigest: job.source.completionDigest,
    runEventId: job.source.runEventId,
    status: completion.status,
    summary: text(completion.summary),
    error: completion.error ? text(completion.error) : undefined,
    blockers: completion.blockers.slice(0, MAX_SOURCE_ITEMS).map((item) => ({
      code: text(item.code),
      summary: text(item.summary),
      detail: text(item.detail),
      retryable: item.retryable,
    })),
    evidence: completion.evidence.slice(0, MAX_SOURCE_ITEMS).map((item) => ({
      id: text(item.id),
      summary: text(item.summary),
      verified: item.verified,
    })),
    verification: completion.verification.slice(0, MAX_SOURCE_ITEMS).map((item) => ({
      gateId: text(item.gateId),
      status: item.status,
      summary: text(item.summary),
    })),
  };
}

function extractionError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function extractionErrorCode(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : 'EXTRACTION_FAILED';
  return code.replace(/[^A-Z0-9_-]/gi, '_').slice(0, 80) || 'EXTRACTION_FAILED';
}

function safeErrorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Reflection extraction failed.';
  return message
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_SECRET]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{8,}\b/g, '[REDACTED_SECRET]')
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*['"]?[^'"\s]+/gi, '$1=[REDACTED]')
    .replace(/\/Users\/[^/\s]+\/[^\s`"'<>)]*/g, '[REDACTED_PATH]')
    .replace(/\s+/g, ' ')
    .slice(0, 500);
}

let reflectionExtractionWorker: ReflectionExtractionWorkerService | undefined;

export function getReflectionExtractionWorkerService(): ReflectionExtractionWorkerService {
  reflectionExtractionWorker ??= new ReflectionExtractionWorkerService();
  return reflectionExtractionWorker;
}

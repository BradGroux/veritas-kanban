import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  RUN_FILE_PROVENANCE_RESPONSE_SCHEMA_VERSION,
  RUN_FILE_PROVENANCE_SCHEMA_VERSION,
  RUN_FILE_PROVENANCE_APPROVAL_EVIDENCE_SCHEMA_VERSION,
  type RunEventEnvelope,
  type RunFileProvenanceGap,
  type RunFileProvenanceApprovalEvidence,
  type RunFileProvenanceListResponse,
  type RunFileProvenanceOperation,
  type RunFileProvenanceQuery,
  type RunFileProvenanceRecord,
  type RunFileProvenanceResponse,
  type RunFileProvenanceRoot,
  type RunFileProvenanceScope,
  type RunFileProvenanceSource,
  type RunFileMediaClass,
} from '@veritas-kanban/shared';
import { BadRequestError } from '../middleware/error-handler.js';
import {
  RunFileProvenanceGapSchema,
  RunFileProvenanceRecordSchema,
} from '../schemas/run-file-provenance-schemas.js';
import { redactString } from '../lib/redact.js';
import { validatePathSegment } from '../utils/sanitize.js';
import type { RunEventJournalService } from './run-event-journal-service.js';
import { getRunEventJournalService } from './run-event-journal-service.js';

const MAX_JOURNAL_EVENTS = 50_000;
const PAGE_SIZE = 500;
const SENSITIVE_METADATA_KEY =
  /(?:authorization|api.?key|token|secret|password|credential|private.?key|cookie|header|environment)/i;

export interface RecordRunFileProvenanceInput {
  scope: RunFileProvenanceScope;
  source: RunFileProvenanceSource;
  operation: RunFileProvenanceOperation;
  producer: {
    eventId: string;
    eventSequence: number;
    toolCallId?: string;
    commandId?: string;
    attachmentId?: string;
    connectorTarget?: string;
    sourceUrl?: string;
    metadata?: Record<string, unknown>;
  };
  location: {
    root: RunFileProvenanceRoot;
    relativePath: string;
    previousPath?: string;
    linkKind: 'regular' | 'symlink' | 'hardlink' | 'unknown';
  };
  content: {
    sha256: string;
    byteSize: number;
    mediaType: string;
    mediaClass: RunFileMediaClass;
  };
  captureSupport?: 'captured' | 'unsupported-provider' | 'unsupported-tool';
}

export type RecordRunFileProvenanceResult =
  | { status: 'recorded'; record: RunFileProvenanceRecord; appended: boolean }
  | { status: 'gap'; gap: RunFileProvenanceGap; appended: boolean };

export class RunFileProvenanceService {
  constructor(
    private readonly journal: Pick<
      RunEventJournalService,
      'append' | 'list'
    > = getRunEventJournalService(),
    private readonly now: () => Date = () => new Date()
  ) {}

  async record(input: RecordRunFileProvenanceInput): Promise<RecordRunFileProvenanceResult> {
    this.validateScope(input.scope);
    const normalizedPath = normalizeRelativePath(input.location.relativePath);
    const previousPath = input.location.previousPath
      ? normalizeRelativePath(input.location.previousPath)
      : null;
    if (input.captureSupport === 'unsupported-provider') {
      return this.recordGap(input, {
        code: 'unsupported-provider-path',
        message: 'The selected provider cannot certify file-producing operations.',
      });
    }
    if (input.captureSupport === 'unsupported-tool') {
      return this.recordGap(input, {
        code: 'unsupported-tool-path',
        message: 'The producing tool path does not expose certifiable file evidence.',
      });
    }
    if (input.location.linkKind !== 'regular') {
      return this.recordGap(input, {
        code: 'link-identity-uncertified',
        message: `${input.location.linkKind} file identity cannot be certified.`,
      });
    }
    if (['rename', 'copy', 'extract'].includes(input.operation) && previousPath === null) {
      return this.recordGap(input, {
        code: 'record-invalid',
        message: `${input.operation} provenance requires an explicit predecessor path.`,
      });
    }

    const events = await this.readAll(input.scope.taskId, input.scope.attemptId);
    const causalEvent = events.find(
      (event) =>
        event.eventId === input.producer.eventId && event.sequence === input.producer.eventSequence
    );
    if (!causalEvent) {
      return this.recordGap(input, {
        code: 'causal-event-missing',
        message: 'The producing event is not present at the claimed causal sequence.',
      });
    }

    const { records } = projectEvents(events);
    const caseFoldedPath = normalizedPath.toLocaleLowerCase('en-US');
    const collision = records.find(
      (record) =>
        record.location.root === input.location.root &&
        record.location.caseFoldedPath === caseFoldedPath &&
        record.location.normalizedPath !== normalizedPath
    );
    if (collision) {
      return this.recordGap(input, {
        code: 'path-collision',
        message: 'Case-folded or Unicode-normalized path identity conflicts with prior evidence.',
      });
    }

    const predecessorPath = previousPath ?? normalizedPath;
    const predecessor = records
      .filter(
        (record) =>
          record.location.root === input.location.root &&
          record.location.normalizedPath === predecessorPath
      )
      .sort((left, right) => right.producer.eventSequence - left.producer.eventSequence)[0];
    const contentSha256 = normalizeSha256(input.content.sha256);
    if (!Number.isSafeInteger(input.content.byteSize) || input.content.byteSize < 0) {
      throw new BadRequestError('File provenance byte size must be a non-negative safe integer.');
    }
    const capturedAt = this.now().toISOString();
    const material = {
      schemaVersion: RUN_FILE_PROVENANCE_SCHEMA_VERSION,
      scope: input.scope,
      source: input.source,
      operation: input.operation,
      producer: {
        eventId: causalEvent.eventId,
        eventSequence: causalEvent.sequence,
        toolCallId: boundedIdentifier(input.producer.toolCallId),
        commandId: boundedIdentifier(input.producer.commandId),
        attachmentId: boundedIdentifier(input.producer.attachmentId),
        connectorTarget: safeTarget(input.producer.connectorTarget),
        sourceUrl: safeUrl(input.producer.sourceUrl),
        safeMetadata: safeMetadata(input.producer.metadata),
      },
      location: {
        root: input.location.root,
        relativePath: normalizedPath,
        normalizedPath,
        caseFoldedPath,
      },
      content: {
        sha256: contentSha256,
        byteSize: input.content.byteSize,
        mediaType: boundedMediaType(input.content.mediaType),
        mediaClass: input.content.mediaClass,
      },
      predecessorId: predecessor?.id ?? null,
      previousPath,
      capturedAt,
    };
    const identity = stableJson({
      scope: material.scope,
      producer: material.producer.eventId,
      sequence: material.producer.eventSequence,
      path: material.location.normalizedPath,
      sha256: material.content.sha256,
      operation: material.operation,
    });
    const record = RunFileProvenanceRecordSchema.parse({
      ...material,
      id: `runfile_${hash(identity).slice(0, 32)}`,
      digest: digest(stableJson(material)),
    });
    const appended = await this.journal.append({
      workspaceId: input.scope.workspaceId,
      taskId: input.scope.taskId,
      attemptId: input.scope.attemptId,
      causalEventId: causalEvent.eventId,
      kind: 'file.provenance',
      source: { provider: 'system', adapter: RUN_FILE_PROVENANCE_SCHEMA_VERSION },
      payload: { record },
      dedupeKey: `file-provenance:${record.id}`,
    });
    const persisted = RunFileProvenanceRecordSchema.parse(appended.event.payload.record);
    return { status: 'recorded', record: persisted, appended: appended.appended };
  }

  async resolve(query: RunFileProvenanceQuery): Promise<RunFileProvenanceResponse> {
    this.validateScope(query);
    const normalizedPath = normalizeRelativePath(query.relativePath);
    const sha256 = normalizeSha256(query.sha256);
    const projected = projectEvents(await this.readAll(query.taskId, query.attemptId));
    const matchingPath = projected.records
      .filter(
        (record) =>
          record.scope.workspaceId === query.workspaceId &&
          record.location.root === query.root &&
          record.location.normalizedPath === normalizedPath
      )
      .sort((left, right) => right.producer.eventSequence - left.producer.eventSequence);
    const current = matchingPath[0] ?? null;
    const exact = current?.content.sha256 === sha256 ? current : null;
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
    const chain = exact ? buildChain(exact, projected.records, limit) : [];
    const relevantGaps = projected.gaps.filter(
      (gap) =>
        (!gap.root || gap.root === query.root) &&
        (!gap.relativePath || gap.relativePath === normalizedPath) &&
        (!gap.eventSequence || gap.eventSequence <= (current?.producer.eventSequence ?? Infinity))
    );
    const status = exact
      ? 'exact'
      : relevantGaps.length > 0
        ? 'gap'
        : current
          ? 'stale'
          : 'unknown';
    return {
      schemaVersion: RUN_FILE_PROVENANCE_RESPONSE_SCHEMA_VERSION,
      status,
      query: { ...query, relativePath: normalizedPath, sha256, limit },
      current,
      chain,
      gaps: relevantGaps.slice(-limit),
      generatedAt: this.now().toISOString(),
    };
  }

  async list(
    workspaceId: string,
    taskId: string,
    attemptId: string,
    limit = 25
  ): Promise<RunFileProvenanceListResponse> {
    this.validateScope({ workspaceId, taskId, attemptId });
    const projected = projectEvents(await this.readAll(taskId, attemptId));
    const bounded = Math.min(Math.max(limit, 1), 100);
    return {
      schemaVersion: RUN_FILE_PROVENANCE_RESPONSE_SCHEMA_VERSION,
      taskId,
      attemptId,
      records: projected.records
        .filter((record) => record.scope.workspaceId === workspaceId)
        .sort((left, right) => right.producer.eventSequence - left.producer.eventSequence)
        .slice(0, bounded),
      gaps: projected.gaps.slice(-bounded),
      generatedAt: this.now().toISOString(),
    };
  }

  async approvalEvidence(
    query: RunFileProvenanceQuery
  ): Promise<RunFileProvenanceApprovalEvidence> {
    const resolved = await this.resolve(query);
    const material = {
      schemaVersion: RUN_FILE_PROVENANCE_APPROVAL_EVIDENCE_SCHEMA_VERSION,
      status: resolved.status,
      query: resolved.query,
      currentRecordId: resolved.current?.id ?? null,
      currentRecordDigest: resolved.current?.digest ?? null,
      chainDigests: resolved.chain.map((record) => record.digest),
      gapCodes: [...new Set(resolved.gaps.map((gap) => gap.code))].sort(),
    };
    return {
      ...material,
      generatedAt: this.now().toISOString(),
      digest: digest(stableJson(material)),
    };
  }

  private async recordGap(
    input: RecordRunFileProvenanceInput,
    gapInput: Omit<RunFileProvenanceGap, 'eventId' | 'eventSequence'>
  ): Promise<RecordRunFileProvenanceResult> {
    const gap = RunFileProvenanceGapSchema.parse({
      ...gapInput,
      root: input.location.root,
      relativePath: normalizeRelativePath(input.location.relativePath),
      eventId: input.producer.eventId,
      eventSequence: input.producer.eventSequence,
    });
    const result = await this.journal.append({
      workspaceId: input.scope.workspaceId,
      taskId: input.scope.taskId,
      attemptId: input.scope.attemptId,
      causalEventId: input.producer.eventId,
      kind: 'file.provenance-gap',
      source: { provider: 'system', adapter: RUN_FILE_PROVENANCE_SCHEMA_VERSION },
      payload: { gap },
      dedupeKey: `file-provenance-gap:${hash(stableJson({ scope: input.scope, gap }))}`,
    });
    return {
      status: 'gap',
      gap: RunFileProvenanceGapSchema.parse(result.event.payload.gap),
      appended: result.appended,
    };
  }

  private async readAll(taskId: string, attemptId: string): Promise<RunEventEnvelope[]> {
    validatePathSegment(taskId);
    validatePathSegment(attemptId);
    const events: RunEventEnvelope[] = [];
    let cursor = 0;
    while (events.length < MAX_JOURNAL_EVENTS) {
      const page = await this.journal.list({
        taskId,
        attemptId,
        afterSequence: cursor,
        limit: PAGE_SIZE,
      });
      events.push(...page.events);
      if (!page.hasMore || page.nextCursor <= cursor) break;
      cursor = page.nextCursor;
    }
    return events;
  }

  private validateScope(scope: { workspaceId: string; taskId: string; attemptId: string }): void {
    validatePathSegment(scope.workspaceId);
    validatePathSegment(scope.taskId);
    validatePathSegment(scope.attemptId);
  }
}

function projectEvents(events: RunEventEnvelope[]): {
  records: RunFileProvenanceRecord[];
  gaps: RunFileProvenanceGap[];
} {
  const records: RunFileProvenanceRecord[] = [];
  const gaps: RunFileProvenanceGap[] = [];
  for (const event of events) {
    if (event.kind === 'file.provenance') {
      const parsed = RunFileProvenanceRecordSchema.safeParse(event.payload.record);
      if (parsed.success) records.push(parsed.data);
      else
        gaps.push({
          code: 'record-invalid',
          message: 'A persisted provenance event could not be validated.',
          eventId: event.eventId,
          eventSequence: event.sequence,
        });
    } else if (event.kind === 'file.provenance-gap') {
      const parsed = RunFileProvenanceGapSchema.safeParse(event.payload.gap);
      if (parsed.success) gaps.push(parsed.data);
    }
  }
  const capturedEventIds = new Set(records.map((record) => record.producer.eventId));
  const persistedGapEvents = new Set(gaps.map((gap) => gap.eventId).filter(Boolean));
  for (const event of events) {
    if (
      event.kind !== 'file.changed' ||
      capturedEventIds.has(event.eventId) ||
      persistedGapEvents.has(event.eventId)
    ) {
      continue;
    }
    const candidatePath = typeof event.payload.path === 'string' ? event.payload.path : undefined;
    let relativePath: string | undefined;
    if (candidatePath) {
      try {
        relativePath = normalizeRelativePath(candidatePath);
      } catch {
        relativePath = undefined;
      }
    }
    gaps.push({
      code:
        event.payload.toolCallId || event.payload.commandId
          ? 'unsupported-tool-path'
          : 'unsupported-provider-path',
      message: 'A file-change event did not include certified digest-bound provenance.',
      ...(event.payload.root === 'worktree' || event.payload.root === 'run-artifact'
        ? { root: event.payload.root }
        : {}),
      ...(relativePath ? { relativePath } : {}),
      eventId: event.eventId,
      eventSequence: event.sequence,
    });
  }
  return { records, gaps };
}

function buildChain(
  start: RunFileProvenanceRecord,
  records: RunFileProvenanceRecord[],
  limit: number
): RunFileProvenanceRecord[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  const chain: RunFileProvenanceRecord[] = [];
  const seen = new Set<string>();
  let current: RunFileProvenanceRecord | undefined = start;
  while (current && chain.length < limit && !seen.has(current.id)) {
    chain.push(current);
    seen.add(current.id);
    current = current.predecessorId ? byId.get(current.predecessorId) : undefined;
  }
  return chain;
}

function normalizeRelativePath(value: string): string {
  if (!value || value.length > 2_000 || path.isAbsolute(value)) {
    throw new BadRequestError('File provenance path must be a bounded relative path.');
  }
  const normalized = value.replaceAll('\\', '/').normalize('NFC');
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new BadRequestError('File provenance path contains an invalid segment.');
  }
  for (const segment of segments) validatePathSegment(segment);
  return segments.join('/');
}

function normalizeSha256(value: string): string {
  const normalized = value.startsWith('sha256:') ? value : `sha256:${value}`;
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized)) {
    throw new BadRequestError('File provenance requires a lowercase SHA-256 digest.');
  }
  return normalized;
}

function boundedIdentifier(value: string | undefined): string | null {
  if (!value) return null;
  const bounded = redactString(value).trim().slice(0, 160);
  return bounded || null;
}

function safeTarget(value: string | undefined): string | null {
  if (!value) return null;
  if (value.includes('://')) return safeUrl(value);
  const redacted = redactString(value).trim().slice(0, 500);
  if (!redacted || path.isAbsolute(redacted) || /^[A-Za-z]:[\\/]/.test(redacted)) return null;
  return redacted;
}

function safeUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString().slice(0, 2_000);
  } catch {
    return null;
  }
}

function safeMetadata(value: Record<string, unknown> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, candidate] of Object.entries(value ?? {}).slice(0, 50)) {
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(key) || SENSITIVE_METADATA_KEY.test(key)) continue;
    if (
      typeof candidate !== 'string' &&
      typeof candidate !== 'number' &&
      typeof candidate !== 'boolean'
    )
      continue;
    const safe = redactString(String(candidate)).slice(0, 500);
    result[key] =
      path.isAbsolute(safe) || /^[A-Za-z]:[\\/]/.test(safe) ? '[host-path-redacted]' : safe;
  }
  return result;
}

function boundedMediaType(value: string): string {
  const mediaType = value.trim().toLowerCase().slice(0, 240);
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:;.*)?$/.test(mediaType)) {
    throw new BadRequestError('File provenance media type is invalid.');
  }
  return mediaType;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function digest(value: string): string {
  return `sha256:${hash(value)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

let runFileProvenanceService: RunFileProvenanceService | undefined;

export function getRunFileProvenanceService(): RunFileProvenanceService {
  runFileProvenanceService ??= new RunFileProvenanceService();
  return runFileProvenanceService;
}

export function resetRunFileProvenanceServiceForTests(): void {
  runFileProvenanceService = undefined;
}

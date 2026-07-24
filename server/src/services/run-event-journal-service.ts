import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import {
  RUN_EVENT_SCHEMA_VERSION,
  type RunEventAppendInput,
  type RunEventAppendResult,
  type RunEventEnvelope,
  type RunEventJsonValue,
  type RunEventPage,
  type RunEventQuery,
} from '@veritas-kanban/shared';
import type { RunEventRepository } from '../storage/interfaces.js';
import { FileRunEventRepository } from '../storage/run-event-repository.js';
import { getStorage, getStorageTypeFromEnv } from '../storage/index.js';
import { RunEventEnvelopeSchema } from '../schemas/run-event-schemas.js';
import { redactString } from '../lib/redact.js';
import { createLogger } from '../lib/logger.js';
import { validatePathSegment } from '../utils/sanitize.js';

const MAX_PAYLOAD_BYTES = 32 * 1024;
const MAX_STRING_BYTES = 8 * 1024;
const MAX_DEPTH = 12;
const MAX_OBJECT_KEYS = 256;
const MAX_ARRAY_ITEMS = 200;
const MAX_REPLAY_BUFFER_EVENTS = 1_000;
const SENSITIVE_KEY =
  /(?:^|_)(?:authorization|api_key|apikey|token|access_token|refresh_token|auth_token|id_token|bearer_token|secret|client_secret|password|credential|credentials|private_key|cookie|set_cookie)$/i;

interface SanitizeState {
  redactedFields: string[];
  objectKeys: number;
  originalBytes: number;
  seen: WeakSet<object>;
}

type RunEventListener = (event: RunEventEnvelope) => void;
const log = createLogger('run-event-journal-service');

export interface RunEventSubscription {
  cursor: number;
  unsubscribe: () => void;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function countBytes(value: string): number {
  return Buffer.byteLength(value, 'utf-8');
}

function addOriginalBytes(state: SanitizeState, value: string): void {
  state.originalBytes = Math.min(Number.MAX_SAFE_INTEGER, state.originalBytes + countBytes(value));
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/-/g, '_');
  return SENSITIVE_KEY.test(normalized);
}

function normalizeJson(
  value: unknown,
  state: SanitizeState,
  fieldPath: string,
  depth = 0
): RunEventJsonValue {
  if (depth > MAX_DEPTH) {
    state.redactedFields.push(fieldPath);
    return '[depth limit]';
  }
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') {
    addOriginalBytes(state, value);
    const redacted = redactString(value);
    const bounded =
      countBytes(redacted) > MAX_STRING_BYTES
        ? `${Buffer.from(redacted, 'utf-8').subarray(0, MAX_STRING_BYTES).toString('utf-8')}[truncated]`
        : redacted;
    if (bounded !== value) state.redactedFields.push(fieldPath);
    return bounded;
  }
  if (typeof value !== 'object') {
    state.redactedFields.push(fieldPath);
    return `[unsupported ${typeof value}]`;
  }
  if (state.seen.has(value)) {
    state.redactedFields.push(fieldPath);
    return '[circular]';
  }
  state.seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) state.redactedFields.push(fieldPath);
    const normalized = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((entry, index) => normalizeJson(entry, state, `${fieldPath}[${index}]`, depth + 1));
    state.seen.delete(value);
    return normalized;
  }
  const normalized: Record<string, RunEventJsonValue> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    state.objectKeys += 1;
    if (state.objectKeys > MAX_OBJECT_KEYS) {
      state.redactedFields.push(fieldPath);
      break;
    }
    const nextPath = `${fieldPath}.${key}`;
    if (isSensitiveKey(key)) {
      normalized[key] = '[REDACTED]';
      state.redactedFields.push(nextPath);
      addOriginalBytes(state, typeof entry === 'string' ? entry : '[structured secret]');
    } else {
      normalized[key] = normalizeJson(entry, state, nextPath, depth + 1);
    }
  }
  state.seen.delete(value);
  return normalized;
}

function sanitizePayload(payload: Record<string, unknown>): {
  payload: Record<string, RunEventJsonValue>;
  status: 'none' | 'redacted' | 'dropped';
  fields: string[];
  originalBytes: number;
  persistedBytes: number;
} {
  const state: SanitizeState = {
    redactedFields: [],
    objectKeys: 0,
    originalBytes: 0,
    seen: new WeakSet(),
  };
  const normalized = normalizeJson(payload, state, '$');
  const record =
    normalized && typeof normalized === 'object' && !Array.isArray(normalized)
      ? normalized
      : { value: normalized };
  let serialized = JSON.stringify(record);
  if (countBytes(serialized) > MAX_PAYLOAD_BYTES) {
    const dropped = {
      dropped: true,
      reason: 'Provider payload exceeded the persisted run-event size limit',
      boundedBytes: MAX_PAYLOAD_BYTES,
    } satisfies Record<string, RunEventJsonValue>;
    serialized = JSON.stringify(dropped);
    return {
      payload: dropped,
      status: 'dropped',
      fields: ['$'],
      originalBytes: Math.max(state.originalBytes, countBytes(serialized)),
      persistedBytes: countBytes(serialized),
    };
  }
  return {
    payload: record,
    status: state.redactedFields.length ? 'redacted' : 'none',
    fields: [...new Set(state.redactedFields)].slice(0, 256),
    originalBytes: Math.max(state.originalBytes, countBytes(serialized)),
    persistedBytes: countBytes(serialized),
  };
}

let fileRepository: FileRunEventRepository | undefined;

function defaultRepository(): RunEventRepository {
  if (getStorageTypeFromEnv() === 'sqlite') return getStorage().runEvents;
  fileRepository ??= new FileRunEventRepository();
  return fileRepository;
}

export class RunEventJournalService {
  private readonly listeners = new Set<RunEventListener>();

  constructor(private readonly repository?: RunEventRepository) {}

  async append(input: RunEventAppendInput): Promise<RunEventAppendResult> {
    validatePathSegment(input.taskId);
    validatePathSegment(input.attemptId);
    const sanitized = sanitizePayload(input.payload);
    const payloadJson = JSON.stringify(sanitized.payload);
    const event = RunEventEnvelopeSchema.parse({
      schemaVersion: RUN_EVENT_SCHEMA_VERSION,
      eventId: `runevt_${nanoid(18)}`,
      taskId: input.taskId,
      runId: input.attemptId,
      attemptId: input.attemptId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      itemId: input.itemId,
      providerEventId: input.providerEventId,
      parentEventId: input.parentEventId,
      causalEventId: input.causalEventId,
      sequence: 1,
      providerTimestamp: input.providerTimestamp,
      receivedAt: new Date().toISOString(),
      kind: input.kind,
      source: input.source,
      redaction: {
        status: sanitized.status,
        fields: sanitized.fields,
        originalBytes: sanitized.originalBytes,
        persistedBytes: sanitized.persistedBytes,
      },
      payload: sanitized.payload,
      payloadHash: sha256(payloadJson),
      dedupeKey:
        input.dedupeKey ??
        (input.providerEventId ? `${input.source.provider}:${input.providerEventId}` : undefined),
    });
    const { sequence: _sequence, ...appendable } = event;
    const result = await (this.repository ?? defaultRepository()).append(appendable);
    if (result.appended) {
      for (const listener of this.listeners) {
        try {
          listener(result.event);
        } catch (error) {
          log.warn(
            { err: error, eventId: result.event.eventId },
            'Run event projection listener failed after durable append'
          );
        }
      }
    }
    return result;
  }

  async list(query: RunEventQuery): Promise<RunEventPage> {
    validatePathSegment(query.taskId);
    validatePathSegment(query.attemptId);
    return (this.repository ?? defaultRepository()).list(query);
  }

  async subscribe(query: RunEventQuery, listener: RunEventListener): Promise<RunEventSubscription> {
    validatePathSegment(query.taskId);
    validatePathSegment(query.attemptId);
    let cursor = Math.max(0, query.afterSequence ?? 0);
    let replaying = true;
    let replayBufferOverflowed = false;
    const buffered: RunEventEnvelope[] = [];
    const liveListener: RunEventListener = (event) => {
      if (
        event.taskId !== query.taskId ||
        event.attemptId !== query.attemptId ||
        event.sequence <= cursor
      ) {
        return;
      }
      if (replaying) {
        if (buffered.length >= MAX_REPLAY_BUFFER_EVENTS) {
          replayBufferOverflowed = true;
          return;
        }
        buffered.push(event);
        return;
      }
      cursor = event.sequence;
      listener(event);
    };

    this.onEvent(liveListener);
    try {
      for (;;) {
        const page = await this.list({
          ...query,
          afterSequence: cursor,
          limit: 500,
        });
        for (const event of page.events) {
          cursor = event.sequence;
          listener(event);
        }
        if (replayBufferOverflowed) {
          throw new Error('Run event replay live buffer exceeded its bounded event limit');
        }
        if (!page.hasMore) break;
      }
      replaying = false;
      for (const event of buffered.sort((left, right) => left.sequence - right.sequence)) {
        if (event.sequence <= cursor) continue;
        cursor = event.sequence;
        listener(event);
      }
      return {
        cursor,
        unsubscribe: () => this.offEvent(liveListener),
      };
    } catch (error) {
      this.offEvent(liveListener);
      throw error;
    }
  }

  onEvent(listener: RunEventListener): void {
    this.listeners.add(listener);
  }

  offEvent(listener: RunEventListener): void {
    this.listeners.delete(listener);
  }
}

let runEventJournalService: RunEventJournalService | undefined;

export function getRunEventJournalService(): RunEventJournalService {
  runEventJournalService ??= new RunEventJournalService();
  return runEventJournalService;
}

export function resetRunEventJournalServiceForTests(): void {
  runEventJournalService = undefined;
  fileRepository = undefined;
}

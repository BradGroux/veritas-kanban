import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import type {
  PhaseTransitionAppendInput,
  PhaseTransitionAppendResult,
  PhaseTransitionQuery,
  PhaseTransitionRecord,
} from '@veritas-kanban/shared';
import { phaseTransitionRecordSchema } from '../schemas/phase-capability-schemas.js';
import { withFileLock } from '../services/file-lock.js';
import { getRuntimeDir } from '../utils/paths.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import type { PhaseTransitionRepository } from './interfaces.js';

const MAX_TRANSITION_LOG_BYTES = 64 * 1024 * 1024;
const MAX_TRANSITION_RECORDS = 100_000;

export function getPhaseTransitionsPath(): string {
  return path.join(getRuntimeDir(), 'phase-transitions.jsonl');
}

export class FilePhaseTransitionRepository implements PhaseTransitionRepository {
  constructor(private readonly filePath = getPhaseTransitionsPath()) {
    ensureWithinBase(path.dirname(filePath), filePath);
  }

  async getCurrent(
    workspaceId: string,
    taskId: string,
    attemptId: string
  ): Promise<PhaseTransitionRecord | null> {
    return currentFor(await this.readRecords(), workspaceId, taskId, attemptId);
  }

  async getByOperationId(
    workspaceId: string,
    taskId: string,
    attemptId: string,
    operationId: string
  ): Promise<PhaseTransitionRecord | null> {
    const record = (await this.readRecords()).find(
      (candidate) =>
        sameRun(candidate, workspaceId, taskId, attemptId) && candidate.operationId === operationId
    );
    return record ? structuredClone(record) : null;
  }

  async list(query: PhaseTransitionQuery): Promise<PhaseTransitionRecord[]> {
    const limit = Math.max(1, Math.min(1_000, Math.trunc(query.limit ?? 100)));
    return (await this.readRecords())
      .filter((record) => sameRun(record, query.workspaceId, query.taskId, query.attemptId))
      .sort((left, right) => left.sequence - right.sequence)
      .slice(-limit);
  }

  async append(input: PhaseTransitionAppendInput): Promise<PhaseTransitionAppendResult> {
    const record = phaseTransitionRecordSchema.parse(input.record);
    await this.prepareParent();
    return withFileLock(this.filePath, async () => {
      const records = await this.readRecords();
      const existing = records.find(
        (candidate) =>
          sameRun(candidate, record.workspaceId, record.taskId, record.attemptId) &&
          candidate.operationId === record.operationId
      );
      if (existing) return idempotentResult(existing, input);

      const current = currentFor(records, record.workspaceId, record.taskId, record.attemptId);
      const conflict = compareAndSetConflict(current, input);
      if (conflict) return { record: current ?? undefined, appended: false, reason: conflict };
      if (record.sequence !== input.expectedSequence + 1) {
        return { record: current ?? undefined, appended: false, reason: 'stale-sequence' };
      }

      await this.appendRecord(record, records);
      return { record, appended: true };
    });
  }

  private async prepareParent(): Promise<void> {
    const parent = path.dirname(this.filePath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Phase transition directory is not a private regular directory.');
    }
  }

  private async readRecords(): Promise<PhaseTransitionRecord[]> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(this.filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_TRANSITION_LOG_BYTES) {
        throw new Error('Phase transition log is not a bounded regular file.');
      }
      const content = await handle.readFile({ encoding: 'utf8' });
      if (!content.trim()) return [];
      const lines = content.split(/\r?\n/).filter(Boolean);
      if (lines.length > MAX_TRANSITION_RECORDS) {
        throw new Error('Phase transition log reached its bounded record limit.');
      }
      return lines.map((line) => phaseTransitionRecordSchema.parse(JSON.parse(line)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        throw new Error('Phase transition log is not a bounded regular file.', { cause: error });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private async appendRecord(
    record: PhaseTransitionRecord,
    existing: PhaseTransitionRecord[]
  ): Promise<void> {
    if (existing.length >= MAX_TRANSITION_RECORDS) {
      throw new Error('Phase transition log reached its bounded record limit.');
    }
    const line = `${JSON.stringify(record)}\n`;
    const existingBytes = existing.reduce(
      (total, candidate) => total + Buffer.byteLength(JSON.stringify(candidate), 'utf8') + 1,
      0
    );
    if (existingBytes + Buffer.byteLength(line, 'utf8') > MAX_TRANSITION_LOG_BYTES) {
      throw new Error('Phase transition log reached its bounded byte limit.');
    }
    const handle = await open(
      this.filePath,
      constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600
    );
    try {
      await handle.write(line, undefined, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

export class InMemoryPhaseTransitionRepository implements PhaseTransitionRepository {
  private readonly records: PhaseTransitionRecord[] = [];

  async getCurrent(
    workspaceId: string,
    taskId: string,
    attemptId: string
  ): Promise<PhaseTransitionRecord | null> {
    return currentFor(this.records, workspaceId, taskId, attemptId);
  }

  async getByOperationId(
    workspaceId: string,
    taskId: string,
    attemptId: string,
    operationId: string
  ): Promise<PhaseTransitionRecord | null> {
    const record = this.records.find(
      (candidate) =>
        sameRun(candidate, workspaceId, taskId, attemptId) && candidate.operationId === operationId
    );
    return record ? structuredClone(record) : null;
  }

  async list(query: PhaseTransitionQuery): Promise<PhaseTransitionRecord[]> {
    const limit = Math.max(1, Math.min(1_000, Math.trunc(query.limit ?? 100)));
    return this.records
      .filter((record) => sameRun(record, query.workspaceId, query.taskId, query.attemptId))
      .sort((left, right) => left.sequence - right.sequence)
      .slice(-limit)
      .map((record) => structuredClone(record));
  }

  async append(input: PhaseTransitionAppendInput): Promise<PhaseTransitionAppendResult> {
    const record = phaseTransitionRecordSchema.parse(input.record);
    const existing = this.records.find(
      (candidate) =>
        sameRun(candidate, record.workspaceId, record.taskId, record.attemptId) &&
        candidate.operationId === record.operationId
    );
    if (existing) return idempotentResult(existing, input);
    const current = currentFor(this.records, record.workspaceId, record.taskId, record.attemptId);
    const conflict = compareAndSetConflict(current, input);
    if (conflict) return { record: current ?? undefined, appended: false, reason: conflict };
    if (record.sequence !== input.expectedSequence + 1) {
      return { record: current ?? undefined, appended: false, reason: 'stale-sequence' };
    }
    this.records.push(structuredClone(record));
    return { record: structuredClone(record), appended: true };
  }
}

function currentFor(
  records: PhaseTransitionRecord[],
  workspaceId: string,
  taskId: string,
  attemptId: string
): PhaseTransitionRecord | null {
  const current = records
    .filter((record) => sameRun(record, workspaceId, taskId, attemptId))
    .sort((left, right) => right.sequence - left.sequence)[0];
  return current ? structuredClone(current) : null;
}

function sameRun(
  record: PhaseTransitionRecord,
  workspaceId: string,
  taskId: string,
  attemptId: string
): boolean {
  return (
    record.workspaceId === workspaceId && record.taskId === taskId && record.attemptId === attemptId
  );
}

function compareAndSetConflict(
  current: PhaseTransitionRecord | null,
  input: PhaseTransitionAppendInput
): PhaseTransitionAppendResult['reason'] | undefined {
  if ((current?.sequence ?? 0) !== input.expectedSequence) return 'stale-sequence';
  const currentDigest = current?.effectiveEvidence.digest ?? input.record.priorEvidence.digest;
  if (
    currentDigest !== input.expectedPhaseEvidenceDigest ||
    input.record.priorEvidence.digest !== input.expectedPhaseEvidenceDigest
  ) {
    return 'stale-phase-evidence';
  }
  if (
    (current && current.manifestDigest !== input.expectedManifestDigest) ||
    input.record.manifestDigest !== input.expectedManifestDigest
  ) {
    return 'stale-manifest';
  }
  return undefined;
}

function idempotentResult(
  existing: PhaseTransitionRecord,
  input: PhaseTransitionAppendInput
): PhaseTransitionAppendResult {
  const same =
    existing.sequence === input.expectedSequence + 1 &&
    existing.priorEvidence.digest === input.expectedPhaseEvidenceDigest &&
    existing.effectiveEvidence.digest === input.record.effectiveEvidence.digest &&
    existing.manifestDigest === input.expectedManifestDigest;
  return {
    record: structuredClone(existing),
    appended: false,
    ...(same ? {} : { reason: 'operation-reused' as const }),
  };
}

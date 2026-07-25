import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type {
  AdmissionQueueCompareAndSetInput,
  AdmissionQueueCompareAndSetResult,
  AdmissionQueueEntry,
  AdmissionQueueListQuery,
  AdmissionQueuedClaimInput,
  AdmissionQueuedClaimResult,
  AdmissionReservation,
  AdmissionReservationClaimInput,
  AdmissionReservationClaimOrQueueInput,
  AdmissionReservationClaimOrQueueResult,
  AdmissionReservationClaimResult,
  AdmissionReservationCompareAndSetInput,
  AdmissionReservationCompareAndSetResult,
  AdmissionReservationListQuery,
} from '@veritas-kanban/shared';
import { ADMISSION_QUEUE_ENTRY_SCHEMA_VERSION } from '@veritas-kanban/shared';
import {
  AdmissionQueueEntrySchema,
  AdmissionReservationSchema,
} from '../schemas/admission-control-schemas.js';
import { withFileLock } from '../services/file-lock.js';
import { getRuntimeDir } from '../utils/paths.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import { findLimitingAdmissionPolicies } from './admission-capacity.js';
import { sameAdmissionQueueTarget } from './admission-queue-identity.js';
import {
  findLimitingExecutionTreeBudgetPolicies,
  reactivateExecutionTreeBudget,
  releaseExecutionTreeBudget,
} from './execution-tree-budget.js';
import type { AdmissionReservationRepository } from './interfaces.js';

const MAX_LOG_BYTES = 128 * 1024 * 1024;
const MAX_SNAPSHOTS = 100_000;
const COMPACT_LOG_BYTES = 16 * 1024 * 1024;
const COMPACT_SNAPSHOTS = 10_000;

export function getAdmissionReservationsPath(): string {
  return path.join(getRuntimeDir(), 'admission-reservations.jsonl');
}

export class FileAdmissionReservationRepository implements AdmissionReservationRepository {
  private readonly queueFilePath: string;

  constructor(
    private readonly filePath = getAdmissionReservationsPath(),
    private readonly compactSnapshots = COMPACT_SNAPSHOTS
  ) {
    ensureWithinBase(path.dirname(filePath), filePath);
    this.queueFilePath = `${filePath}.queue`;
    ensureWithinBase(path.dirname(filePath), this.queueFilePath);
  }

  async claim(input: AdmissionReservationClaimInput): Promise<AdmissionReservationClaimResult> {
    const requested = AdmissionReservationSchema.parse(input.record);
    if (requested.revision !== 1) {
      throw new Error('New admission reservations must start at revision 1.');
    }
    await this.prepareParent();
    return withFileLock(this.filePath, async () => {
      const snapshots = await this.readSnapshots();
      const materialized = this.materialize(snapshots);
      await this.expireMaterialized(materialized, input.now, snapshots);
      return this.claimMaterialized(requested, input, materialized, snapshots);
    });
  }

  async claimOrEnqueue(
    input: AdmissionReservationClaimOrQueueInput
  ): Promise<AdmissionReservationClaimOrQueueResult> {
    const requested = AdmissionReservationSchema.parse(input.record);
    if (requested.revision !== 1) {
      throw new Error('New admission reservations must start at revision 1.');
    }
    await this.prepareParent();
    return withFileLock(this.filePath, async () => {
      const snapshots = await this.readSnapshots();
      const materialized = this.materialize(snapshots);
      await this.expireMaterialized(materialized, input.now, snapshots);
      const claimed = await this.claimMaterialized(requested, input, materialized, snapshots);
      if (
        claimed.record ||
        (claimed.limitingBudgetPolicies?.length && claimed.budgetRetryable === false)
      ) {
        return claimed;
      }

      const queue = await this.readQueueEntries();
      const expired = this.expireQueueMaterialized(queue, input.now);
      const activeStates = new Set(['queued', 'requeued', 'leased']);
      const existing = [...queue.values()].find(
        (entry) =>
          entry.request.taskId === input.queue.request.taskId && activeStates.has(entry.state)
      );
      if (existing) {
        if (expired.length > 0) await this.replaceQueueEntries([...queue.values()]);
        if (!sameAdmissionQueueTarget(existing, input.queue)) {
          return { ...claimed, queueConflict: true };
        }
        return { ...claimed, queueEntry: existing };
      }
      const active = [...queue.values()].filter((entry) => activeStates.has(entry.state));
      if (active.length >= input.globalQueueLimit) {
        if (expired.length > 0) await this.replaceQueueEntries([...queue.values()]);
        return { ...claimed, queueOverflow: 'global' };
      }
      if (
        active.filter((entry) => entry.request.workspaceId === input.queue.request.workspaceId)
          .length >= input.workspaceQueueLimit
      ) {
        if (expired.length > 0) await this.replaceQueueEntries([...queue.values()]);
        return { ...claimed, queueOverflow: 'workspace' };
      }
      const enqueueSequence =
        Math.max(0, ...[...queue.values()].map((entry) => entry.enqueueSequence)) + 1;
      const entry = AdmissionQueueEntrySchema.parse({
        schemaVersion: ADMISSION_QUEUE_ENTRY_SCHEMA_VERSION,
        ...input.queue,
        limitingPolicies: claimed.limitingPolicies,
        limitingBudgetPolicies: claimed.limitingBudgetPolicies,
        revision: 1,
        state: 'queued',
        enqueueSequence,
        retryCount: 0,
        updatedAt: input.now,
      });
      queue.set(entry.id, entry);
      await this.replaceQueueEntries([...queue.values()]);
      return { ...claimed, queueEntry: entry };
    });
  }

  async claimQueued(input: AdmissionQueuedClaimInput): Promise<AdmissionQueuedClaimResult> {
    const requested = AdmissionReservationSchema.parse(input.record);
    await this.prepareParent();
    return withFileLock(this.filePath, async () => {
      const snapshots = await this.readSnapshots();
      const reservations = this.materialize(snapshots);
      await this.expireMaterialized(reservations, input.now, snapshots);
      const queue = await this.readQueueEntries();
      const expired = this.expireQueueMaterialized(queue, input.now);
      const current = queue.get(input.queueId);
      const eligible = [...queue.values()]
        .filter(
          (entry) =>
            ['queued', 'requeued'].includes(entry.state) &&
            Date.parse(entry.availableAt) <= Date.parse(input.now)
        )
        .sort(
          (left, right) =>
            left.enqueueSequence - right.enqueueSequence || left.id.localeCompare(right.id)
        );
      if (
        !current ||
        current.revision !== input.expectedRevision ||
        eligible[0]?.id !== current.id
      ) {
        if (expired.length > 0) await this.replaceQueueEntries([...queue.values()]);
        return { stale: true, limitingPolicies: [] };
      }
      const claimed = await this.claimMaterialized(
        requested,
        {
          record: requested,
          now: input.now,
          reclaimExpired: true,
          reclaimReleased: true,
        },
        reservations,
        snapshots
      );
      if (!claimed.record) {
        if (expired.length > 0) await this.replaceQueueEntries([...queue.values()]);
        return {
          stale: false,
          limitingPolicies: claimed.limitingPolicies,
          limitingBudgetPolicies: claimed.limitingBudgetPolicies,
          budgetRetryable: claimed.budgetRetryable,
        };
      }
      const entry = AdmissionQueueEntrySchema.parse({
        ...current,
        revision: current.revision + 1,
        state: 'leased',
        policies: claimed.record.policies,
        lease: claimed.record.lease,
        reservationId: claimed.record.id,
        updatedAt: input.now,
      });
      queue.set(entry.id, entry);
      await this.replaceQueueEntries([...queue.values()]);
      return {
        entry,
        reservation: claimed.record,
        stale: false,
        limitingPolicies: [],
      };
    });
  }

  private async claimMaterialized(
    requested: AdmissionReservation,
    input: AdmissionReservationClaimInput,
    materialized: Map<string, AdmissionReservation>,
    snapshots: AdmissionReservation[]
  ): Promise<AdmissionReservationClaimResult> {
    const existing = materialized.get(requested.id);
    if (existing) {
      if (existing.request.idempotencyKey !== requested.request.idempotencyKey) {
        throw new Error(`Admission reservation ${requested.id} has conflicting identity.`);
      }
      const reclaimable =
        (existing.state === 'expired' && input.reclaimExpired) ||
        (existing.state === 'released' && input.reclaimReleased);
      if (!reclaimable) {
        return { record: existing, created: false, limitingPolicies: [] };
      }
      const reclaimed = AdmissionReservationSchema.parse({
        ...requested,
        revision: existing.revision + 1,
        createdAt: existing.createdAt,
        executionBudget: reactivateExecutionTreeBudget(
          existing.executionBudget,
          requested.executionBudget
        ),
      });
      const limitingPolicies = findLimitingAdmissionPolicies(
        [...materialized.values()].filter((record) => record.id !== existing.id),
        reclaimed
      );
      if (limitingPolicies.length > 0) {
        return { created: false, limitingPolicies };
      }
      const limitingBudgets = findLimitingExecutionTreeBudgetPolicies(
        [...materialized.values()].filter((record) => record.id !== existing.id),
        reclaimed
      );
      if (limitingBudgets.terminal.length > 0 || limitingBudgets.retryable.length > 0) {
        return {
          created: false,
          limitingPolicies: [],
          limitingBudgetPolicies:
            limitingBudgets.terminal.length > 0
              ? limitingBudgets.terminal
              : limitingBudgets.retryable,
          budgetRetryable: limitingBudgets.terminal.length === 0,
        };
      }
      await this.appendSnapshot(reclaimed, snapshots);
      return {
        record: reclaimed,
        created: false,
        reclaimed: true,
        limitingPolicies: [],
      };
    }
    const limitingPolicies = findLimitingAdmissionPolicies([...materialized.values()], requested);
    if (limitingPolicies.length > 0) return { created: false, limitingPolicies };
    const limitingBudgets = findLimitingExecutionTreeBudgetPolicies(
      [...materialized.values()],
      requested
    );
    if (limitingBudgets.terminal.length > 0 || limitingBudgets.retryable.length > 0) {
      return {
        created: false,
        limitingPolicies: [],
        limitingBudgetPolicies:
          limitingBudgets.terminal.length > 0
            ? limitingBudgets.terminal
            : limitingBudgets.retryable,
        budgetRetryable: limitingBudgets.terminal.length === 0,
      };
    }
    await this.appendSnapshot(requested, snapshots);
    return { record: requested, created: true, limitingPolicies: [] };
  }

  async get(id: string): Promise<AdmissionReservation | null> {
    return this.materialize(await this.readSnapshots()).get(id) ?? null;
  }

  async list(query: AdmissionReservationListQuery): Promise<AdmissionReservation[]> {
    const states = query.states ? new Set(query.states) : undefined;
    return [...this.materialize(await this.readSnapshots()).values()]
      .filter((record) => !query.workspaceId || record.request.workspaceId === query.workspaceId)
      .filter((record) => !query.taskId || record.request.taskId === query.taskId)
      .filter((record) => !query.rootTaskId || record.request.rootTaskId === query.rootTaskId)
      .filter((record) => !query.provider || record.request.provider === query.provider)
      .filter((record) => !query.hostId || record.request.hostId === query.hostId)
      .filter(
        (record) => !query.workflowRunId || record.request.workflowRunId === query.workflowRunId
      )
      .filter(
        (record) => !query.workflowStepId || record.request.workflowStepId === query.workflowStepId
      )
      .filter(
        (record) =>
          !query.rootReservationId || record.request.rootReservationId === query.rootReservationId
      )
      .filter(
        (record) =>
          !query.rootObjectiveId ||
          record.request.executionTree?.rootObjectiveId === query.rootObjectiveId
      )
      .filter((record) => !query.nodeId || record.request.executionTree?.nodeId === query.nodeId)
      .filter(
        (record) =>
          !query.parentNodeId || record.request.executionTree?.parentNodeId === query.parentNodeId
      )
      .filter((record) => !states || states.has(record.state))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, query.limit ?? 100);
  }

  async getQueueEntry(id: string): Promise<AdmissionQueueEntry | null> {
    return (await this.readQueueEntries()).get(id) ?? null;
  }

  async listQueue(query: AdmissionQueueListQuery): Promise<AdmissionQueueEntry[]> {
    const states = query.states ? new Set(query.states) : undefined;
    return [...(await this.readQueueEntries()).values()]
      .filter((entry) => !query.workspaceId || entry.request.workspaceId === query.workspaceId)
      .filter((entry) => !query.taskId || entry.request.taskId === query.taskId)
      .filter((entry) => !states || states.has(entry.state))
      .filter(
        (entry) =>
          !query.eligibleAt || Date.parse(entry.availableAt) <= Date.parse(query.eligibleAt)
      )
      .sort(
        (left, right) =>
          left.enqueueSequence - right.enqueueSequence || left.id.localeCompare(right.id)
      )
      .slice(0, query.limit ?? 100);
  }

  async compareAndSetQueue(
    input: AdmissionQueueCompareAndSetInput
  ): Promise<AdmissionQueueCompareAndSetResult> {
    await this.prepareParent();
    return withFileLock(this.filePath, async () => {
      const queue = await this.readQueueEntries();
      const current = queue.get(input.id);
      if (!current) return { updated: false, reason: 'not-found' };
      if (current.revision !== input.expectedRevision) {
        return { record: current, updated: false, reason: 'stale-revision' };
      }
      if (input.next.revision !== input.expectedRevision + 1 || input.next.id !== input.id) {
        return { record: current, updated: false, reason: 'invalid-revision' };
      }
      const next = AdmissionQueueEntrySchema.parse(input.next);
      queue.set(next.id, next);
      await this.replaceQueueEntries([...queue.values()]);
      return { record: next, updated: true };
    });
  }

  async expireQueueLeases(now: string): Promise<AdmissionQueueEntry[]> {
    await this.prepareParent();
    return withFileLock(this.filePath, async () => {
      const queue = await this.readQueueEntries();
      const expired = this.expireQueueMaterialized(queue, now);
      if (expired.length > 0) await this.replaceQueueEntries([...queue.values()]);
      return expired;
    });
  }

  async compareAndSet(
    input: AdmissionReservationCompareAndSetInput
  ): Promise<AdmissionReservationCompareAndSetResult> {
    await this.prepareParent();
    return withFileLock(this.filePath, async () => {
      const snapshots = await this.readSnapshots();
      const current = this.materialize(snapshots).get(input.id);
      if (!current) return { updated: false, reason: 'not-found' };
      if (current.revision !== input.expectedRevision) {
        return { record: current, updated: false, reason: 'stale-revision' };
      }
      if (input.next.revision !== input.expectedRevision + 1 || input.next.id !== input.id) {
        return { record: current, updated: false, reason: 'invalid-revision' };
      }
      const next = AdmissionReservationSchema.parse(input.next);
      await this.appendSnapshot(next, snapshots);
      return { record: next, updated: true };
    });
  }

  async expireLeases(now: string): Promise<AdmissionReservation[]> {
    await this.prepareParent();
    return withFileLock(this.filePath, async () => {
      const snapshots = await this.readSnapshots();
      return this.expireMaterialized(this.materialize(snapshots), now, snapshots);
    });
  }

  private async expireMaterialized(
    materialized: Map<string, AdmissionReservation>,
    now: string,
    snapshots: AdmissionReservation[]
  ): Promise<AdmissionReservation[]> {
    const expired: AdmissionReservation[] = [];
    for (const current of materialized.values()) {
      if (current.state !== 'active' || Date.parse(current.lease.expiresAt) > Date.parse(now)) {
        continue;
      }
      const next = AdmissionReservationSchema.parse({
        ...current,
        revision: current.revision + 1,
        state: 'expired',
        executionBudget: releaseExecutionTreeBudget(current.executionBudget),
        updatedAt: now,
      });
      await this.appendSnapshot(next, snapshots);
      snapshots.push(next);
      materialized.set(next.id, next);
      expired.push(next);
    }
    return expired;
  }

  private async prepareParent(): Promise<void> {
    const parent = path.dirname(this.filePath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Admission reservation directory is not a private regular directory.');
    }
  }

  private async readSnapshots(): Promise<AdmissionReservation[]> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(this.filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_LOG_BYTES) {
        throw new Error('Admission reservation log is not a bounded regular file.');
      }
      const lines = (await handle.readFile({ encoding: 'utf8' })).split(/\r?\n/).filter(Boolean);
      if (lines.length > MAX_SNAPSHOTS) {
        throw new Error('Admission reservation log reached its bounded snapshot limit.');
      }
      return lines.map((line) => AdmissionReservationSchema.parse(JSON.parse(line)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        throw new Error('Admission reservation log is not a bounded regular file.', {
          cause: error,
        });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private async readQueueEntries(): Promise<Map<string, AdmissionQueueEntry>> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(this.queueFilePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_LOG_BYTES) {
        throw new Error('Admission queue is not a bounded regular file.');
      }
      const lines = (await handle.readFile({ encoding: 'utf8' })).split(/\r?\n/).filter(Boolean);
      if (lines.length > MAX_SNAPSHOTS) {
        throw new Error('Admission queue reached its bounded entry limit.');
      }
      return new Map(
        lines.map((line) => {
          const entry = AdmissionQueueEntrySchema.parse(JSON.parse(line));
          return [entry.id, entry];
        })
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        throw new Error('Admission queue is not a bounded regular file.', { cause: error });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private expireQueueMaterialized(
    queue: Map<string, AdmissionQueueEntry>,
    now: string
  ): AdmissionQueueEntry[] {
    const expired: AdmissionQueueEntry[] = [];
    for (const current of queue.values()) {
      if (
        current.state !== 'leased' ||
        !current.lease ||
        Date.parse(current.lease.expiresAt) > Date.parse(now)
      ) {
        continue;
      }
      const retryCount = current.retryCount + 1;
      const terminal = retryCount > current.maxRetries;
      const next = AdmissionQueueEntrySchema.parse({
        ...current,
        revision: current.revision + 1,
        state: terminal ? 'terminal' : 'requeued',
        retryCount,
        availableAt: new Date(Date.parse(now) + current.retryAfterMs).toISOString(),
        lease: undefined,
        reservationId: undefined,
        ...(terminal
          ? {
              terminal: {
                code: 'QUEUE_LEASE_EXPIRED',
                reason: 'The queue lease expired before dispatch ownership became durable.',
                recordedAt: now,
              },
            }
          : {}),
        updatedAt: now,
      });
      queue.set(next.id, next);
      expired.push(next);
    }
    return expired;
  }

  private async replaceQueueEntries(entries: AdmissionQueueEntry[]): Promise<void> {
    if (entries.length > MAX_SNAPSHOTS) {
      throw new Error('Admission queue reached its bounded entry limit.');
    }
    const content =
      entries
        .sort(
          (left, right) =>
            left.enqueueSequence - right.enqueueSequence || left.id.localeCompare(right.id)
        )
        .map((entry) => JSON.stringify(entry))
        .join('\n') + (entries.length > 0 ? '\n' : '');
    if (Buffer.byteLength(content, 'utf8') > MAX_LOG_BYTES) {
      throw new Error('Admission queue reached its bounded byte limit.');
    }
    const temporaryPath = `${this.queueFilePath}.replace-${process.pid}-${randomUUID()}`;
    ensureWithinBase(path.dirname(this.queueFilePath), temporaryPath);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(
        temporaryPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600
      );
      await handle.writeFile(content, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, this.queueFilePath);
    } catch (error) {
      await handle?.close().catch(() => {});
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }
  }

  private materialize(snapshots: AdmissionReservation[]): Map<string, AdmissionReservation> {
    const byId = new Map<string, AdmissionReservation>();
    for (const snapshot of snapshots) {
      const current = byId.get(snapshot.id);
      if (!current || snapshot.revision > current.revision) byId.set(snapshot.id, snapshot);
    }
    return byId;
  }

  private async appendSnapshot(
    snapshot: AdmissionReservation,
    existing: AdmissionReservation[]
  ): Promise<void> {
    const line = `${JSON.stringify(snapshot)}\n`;
    const existingBytes = existing.reduce(
      (total, candidate) => total + Buffer.byteLength(JSON.stringify(candidate), 'utf8') + 1,
      0
    );
    if (
      existing.length >= this.compactSnapshots ||
      existingBytes + Buffer.byteLength(line, 'utf8') > COMPACT_LOG_BYTES
    ) {
      const materialized = this.materialize(existing);
      materialized.set(snapshot.id, snapshot);
      await this.replaceSnapshots([...materialized.values()]);
      return;
    }
    if (existing.length >= MAX_SNAPSHOTS) {
      throw new Error('Admission reservation log reached its bounded snapshot limit.');
    }
    if (existingBytes + Buffer.byteLength(line, 'utf8') > MAX_LOG_BYTES) {
      throw new Error('Admission reservation log reached its bounded byte limit.');
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

  private async replaceSnapshots(snapshots: AdmissionReservation[]): Promise<void> {
    if (snapshots.length > MAX_SNAPSHOTS) {
      throw new Error('Admission reservation log reached its bounded snapshot limit.');
    }
    const content = snapshots.map((snapshot) => JSON.stringify(snapshot)).join('\n') + '\n';
    if (Buffer.byteLength(content, 'utf8') > MAX_LOG_BYTES) {
      throw new Error('Admission reservation log reached its bounded byte limit.');
    }
    const temporaryPath = `${this.filePath}.compact-${process.pid}-${randomUUID()}`;
    ensureWithinBase(path.dirname(this.filePath), temporaryPath);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(
        temporaryPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600
      );
      await handle.writeFile(content, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await handle?.close().catch(() => {});
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }
  }
}

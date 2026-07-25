import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type {
  AdmissionReservation,
  AdmissionReservationClaimInput,
  AdmissionReservationClaimResult,
  AdmissionReservationCompareAndSetInput,
  AdmissionReservationCompareAndSetResult,
  AdmissionReservationListQuery,
} from '@veritas-kanban/shared';
import { AdmissionReservationSchema } from '../schemas/admission-control-schemas.js';
import { withFileLock } from '../services/file-lock.js';
import { getRuntimeDir } from '../utils/paths.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import { findLimitingAdmissionPolicies } from './admission-capacity.js';
import type { AdmissionReservationRepository } from './interfaces.js';

const MAX_LOG_BYTES = 128 * 1024 * 1024;
const MAX_SNAPSHOTS = 100_000;
const COMPACT_LOG_BYTES = 16 * 1024 * 1024;
const COMPACT_SNAPSHOTS = 10_000;

export function getAdmissionReservationsPath(): string {
  return path.join(getRuntimeDir(), 'admission-reservations.jsonl');
}

export class FileAdmissionReservationRepository implements AdmissionReservationRepository {
  constructor(
    private readonly filePath = getAdmissionReservationsPath(),
    private readonly compactSnapshots = COMPACT_SNAPSHOTS
  ) {
    ensureWithinBase(path.dirname(filePath), filePath);
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
      const existing = materialized.get(requested.id);
      if (existing) {
        if (existing.request.idempotencyKey !== requested.request.idempotencyKey) {
          throw new Error(`Admission reservation ${requested.id} has conflicting identity.`);
        }
        if (existing.state !== 'expired' || !input.reclaimExpired) {
          return { record: existing, created: false, limitingPolicies: [] };
        }
        const reclaimed = AdmissionReservationSchema.parse({
          ...requested,
          revision: existing.revision + 1,
          createdAt: existing.createdAt,
        });
        const limitingPolicies = findLimitingAdmissionPolicies(
          [...materialized.values()].filter((record) => record.id !== existing.id),
          reclaimed
        );
        if (limitingPolicies.length > 0) {
          return { created: false, limitingPolicies };
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
      await this.appendSnapshot(requested, snapshots);
      return { record: requested, created: true, limitingPolicies: [] };
    });
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
      .filter((record) => !states || states.has(record.state))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, query.limit ?? 100);
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

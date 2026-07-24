import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import type {
  RunApprovalListQuery,
  RunApprovalRequest,
  RunApprovalTransitionInput,
  RunApprovalTransitionResult,
} from '@veritas-kanban/shared';
import type { RunApprovalRepository } from './interfaces.js';
import { RunApprovalRequestSchema } from '../schemas/run-approval-schemas.js';
import { withFileLock } from '../services/file-lock.js';
import { getRuntimeDir } from '../utils/paths.js';
import { ensureWithinBase } from '../utils/sanitize.js';

const MAX_APPROVAL_LOG_BYTES = 64 * 1024 * 1024;
const MAX_APPROVAL_SNAPSHOTS = 100_000;

export function getRunApprovalsPath(): string {
  return path.join(getRuntimeDir(), 'run-approvals.jsonl');
}

export class FileRunApprovalRepository implements RunApprovalRepository {
  constructor(private readonly filePath = getRunApprovalsPath()) {
    ensureWithinBase(path.dirname(filePath), filePath);
  }

  async create(request: RunApprovalRequest): Promise<RunApprovalRequest> {
    const parsed = RunApprovalRequestSchema.parse(request);
    if (parsed.status !== 'pending' || parsed.revision !== 1) {
      throw new Error('New run approvals must start pending at revision 1.');
    }
    await this.prepareParent();
    return withFileLock(this.filePath, async () => {
      const snapshots = await this.readSnapshots();
      if (snapshots.some((candidate) => candidate.id === parsed.id)) {
        throw new Error(`Run approval ${parsed.id} already exists.`);
      }
      await this.appendSnapshot(parsed, snapshots);
      return parsed;
    });
  }

  async get(id: string): Promise<RunApprovalRequest | null> {
    return this.materialize(await this.readSnapshots()).get(id) ?? null;
  }

  async list(query: RunApprovalListQuery): Promise<RunApprovalRequest[]> {
    return [...this.materialize(await this.readSnapshots()).values()]
      .filter((request) => request.workspaceId === query.workspaceId)
      .filter((request) => !query.status || request.status === query.status)
      .filter((request) => !query.taskId || request.taskId === query.taskId)
      .filter((request) => !query.attemptId || request.attemptId === query.attemptId)
      .filter((request) => !query.agentId || request.agentId === query.agentId)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }

  async transition(input: RunApprovalTransitionInput): Promise<RunApprovalTransitionResult> {
    await this.prepareParent();
    return withFileLock(this.filePath, async () => {
      const snapshots = await this.readSnapshots();
      const current = this.materialize(snapshots).get(input.id);
      if (!current) return { transitioned: false, reason: 'not-found' };
      if (current.status !== 'pending') {
        return { request: current, transitioned: false, reason: 'already-resolved' };
      }
      if (current.revision !== input.expectedRevision) {
        return { request: current, transitioned: false, reason: 'stale-revision' };
      }
      if (current.actionHash !== input.expectedActionHash) {
        return { request: current, transitioned: false, reason: 'action-changed' };
      }

      const next = RunApprovalRequestSchema.parse({
        ...current,
        status: input.status,
        revision: current.revision + 1,
        updatedAt: input.resolution.decidedAt,
        resolution: input.resolution,
      });
      await this.appendSnapshot(next, snapshots);
      return { request: next, transitioned: true };
    });
  }

  private async prepareParent(): Promise<void> {
    const parent = path.dirname(this.filePath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Run approval directory is not a private regular directory.');
    }
  }

  private async readSnapshots(): Promise<RunApprovalRequest[]> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(this.filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_APPROVAL_LOG_BYTES) {
        throw new Error('Run approval log is not a bounded regular file.');
      }
      const content = await handle.readFile({ encoding: 'utf8' });
      if (!content.trim()) return [];
      const lines = content.split(/\r?\n/).filter(Boolean);
      if (lines.length > MAX_APPROVAL_SNAPSHOTS) {
        throw new Error('Run approval log reached its bounded snapshot limit.');
      }
      return lines.map((line) => RunApprovalRequestSchema.parse(JSON.parse(line)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        throw new Error('Run approval log is not a bounded regular file.', { cause: error });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private materialize(snapshots: RunApprovalRequest[]): Map<string, RunApprovalRequest> {
    const byId = new Map<string, RunApprovalRequest>();
    for (const snapshot of snapshots) {
      const current = byId.get(snapshot.id);
      if (!current || snapshot.revision > current.revision) byId.set(snapshot.id, snapshot);
    }
    return byId;
  }

  private async appendSnapshot(
    snapshot: RunApprovalRequest,
    existing: RunApprovalRequest[]
  ): Promise<void> {
    if (existing.length >= MAX_APPROVAL_SNAPSHOTS) {
      throw new Error('Run approval log reached its bounded snapshot limit.');
    }
    const line = `${JSON.stringify(snapshot)}\n`;
    const existingBytes = existing.reduce(
      (total, candidate) => total + Buffer.byteLength(JSON.stringify(candidate), 'utf8') + 1,
      0
    );
    if (existingBytes + Buffer.byteLength(line, 'utf8') > MAX_APPROVAL_LOG_BYTES) {
      throw new Error('Run approval log reached its bounded byte limit.');
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

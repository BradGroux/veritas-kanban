import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { arch, hostname, platform } from 'node:os';
import type {
  AgentBudgetState,
  CompletionResult,
  ExecutableAgentProvider,
  RunSupervisorBindings,
  RunSupervisorControlHandle,
  RunSupervisorRecoveryOperation,
  RunSupervisorRecoveryReasonCode,
  RunSupervisorRecord,
  RunSupervisorTerminalState,
} from '@veritas-kanban/shared';
import { RUN_SUPERVISOR_SCHEMA_VERSION } from '@veritas-kanban/shared';
import { ConflictError, NotFoundError } from '../middleware/error-handler.js';
import { RunSupervisorRecordSchema } from '../schemas/run-supervisor-schemas.js';
import type { RunSupervisorRepository } from '../storage/interfaces.js';
import { FileRunSupervisorRepository } from '../storage/run-supervisor-repository.js';
import { getStorage, getStorageTypeFromEnv } from '../storage/index.js';

const DEFAULT_LEASE_MS = 15_000;
const DEFAULT_HEARTBEAT_MS = 5_000;
const MAX_CAS_ATTEMPTS = 8;
const PROCESS_STOP_GRACE_MS = 5_000;
const PROCESS_STOP_POLL_MS = 100;

export interface RegisterRunSupervisorInput {
  workspaceId?: string;
  taskId: string;
  attemptId: string;
  provider: ExecutableAgentProvider;
  adapter: string;
  providerVersion?: string;
  providerRuntimeManifestDigest: string;
  taskEnvelopeDigest: string;
  runLaunchManifestDigest: string;
  worktreePath: string;
  worktreeManifestId?: string;
  worktreeLeaseId?: string;
  recoveryOperations: RunSupervisorRecoveryOperation[];
  budget?: AgentBudgetState;
  controlKind?: 'in-process' | 'remote-session';
  sessionId?: string;
  threadId?: string;
}

export interface RunSupervisorCheckpoint {
  lastEventSequence?: number;
  budget?: AgentBudgetState;
  sessionId?: string;
  threadId?: string;
}

export interface RunSupervisorRecoveryBindings {
  provider: ExecutableAgentProvider;
  adapter: string;
  providerRuntimeManifestDigest: string;
  taskEnvelopeDigest: string;
  runLaunchManifestDigest: string;
  worktreePath: string;
  worktreeManifestId?: string;
  worktreeLeaseId?: string;
}

export interface RunSupervisorRecoveryResult {
  outcome: 'reattached' | 'recovery-required' | 'lease-held' | 'terminal';
  record: RunSupervisorRecord;
  recovery?: RunSupervisorRecord['recovery'];
}

export interface ProcessProbeResult {
  alive: boolean;
  startToken?: string;
}

export interface RunSupervisorServiceOptions {
  repository?: RunSupervisorRepository;
  now?: () => Date;
  hostId?: string;
  ownerId?: string;
  processId?: number;
  leaseMs?: number;
  heartbeatMs?: number;
  processProbe?: (pid: number) => ProcessProbeResult;
  signalProcess?: (pid: number, processGroupId: number | undefined, signal: NodeJS.Signals) => void;
  sessionProbe?: (record: RunSupervisorRecord) => Promise<boolean>;
}

let fileRepository: FileRunSupervisorRepository | undefined;

function defaultRepository(): RunSupervisorRepository {
  if (getStorageTypeFromEnv() === 'sqlite') return getStorage().runSupervisors;
  fileRepository ??= new FileRunSupervisorRepository();
  return fileRepository;
}

export class RunSupervisorService {
  readonly hostId: string;
  readonly ownerId: string;
  private readonly repository: RunSupervisorRepository;
  private readonly now: () => Date;
  private readonly processId: number;
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;
  private readonly processProbe: (pid: number) => ProcessProbeResult;
  private readonly signalProcess: (
    pid: number,
    processGroupId: number | undefined,
    signal: NodeJS.Signals
  ) => void;
  private readonly sessionProbe?: (record: RunSupervisorRecord) => Promise<boolean>;
  private readonly heartbeatTimers = new Map<string, NodeJS.Timeout>();

  constructor(options: RunSupervisorServiceOptions = {}) {
    this.repository = options.repository ?? defaultRepository();
    this.now = options.now ?? (() => new Date());
    this.processId = options.processId ?? process.pid;
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.hostId = normalizeHostId(options.hostId ?? defaultHostId());
    this.ownerId =
      options.ownerId ?? `runsupervisor-${this.processId}-${randomUUID().replaceAll('-', '')}`;
    this.processProbe = options.processProbe ?? defaultProcessProbe;
    this.signalProcess = options.signalProcess ?? signalProcessGroup;
    this.sessionProbe = options.sessionProbe;
  }

  async register(input: RegisterRunSupervisorInput): Promise<RunSupervisorRecord> {
    const workspaceId = input.workspaceId?.trim() || 'local';
    const id = supervisorIdFor(workspaceId, input.taskId, input.attemptId);
    const now = this.now();
    const bindings: RunSupervisorBindings = {
      provider: input.provider,
      adapter: input.adapter,
      providerVersion: input.providerVersion,
      providerRuntimeManifestDigest: input.providerRuntimeManifestDigest,
      taskEnvelopeDigest: input.taskEnvelopeDigest,
      runLaunchManifestDigest: input.runLaunchManifestDigest,
      worktreePath: input.worktreePath,
      worktreeManifestId: input.worktreeManifestId,
      worktreeLeaseId: input.worktreeLeaseId,
      worktreeFingerprint: fingerprintWorktree({
        worktreePath: input.worktreePath,
        worktreeManifestId: input.worktreeManifestId,
        worktreeLeaseId: input.worktreeLeaseId,
        taskEnvelopeDigest: input.taskEnvelopeDigest,
      }),
    };
    const existing = await this.repository.get(id);
    if (existing) {
      if (!sameBindings(existing.bindings, bindings)) {
        throw new ConflictError(
          'Run supervisor identity was reused with changed launch bindings.',
          {
            supervisorId: id,
            attemptId: input.attemptId,
          }
        );
      }
      if (!isTerminal(existing.state)) this.startHeartbeat(existing.id);
      return existing;
    }
    const control: RunSupervisorControlHandle =
      input.controlKind === 'remote-session' && input.sessionId
        ? {
            kind: 'remote-session',
            hostId: this.hostId,
            sessionId: input.sessionId,
            threadId: input.threadId,
          }
        : { kind: 'in-process', hostId: this.hostId };
    const record = RunSupervisorRecordSchema.parse({
      schemaVersion: RUN_SUPERVISOR_SCHEMA_VERSION,
      id,
      workspaceId,
      taskId: input.taskId,
      attemptId: input.attemptId,
      state: 'launching',
      revision: 1,
      bindings,
      control,
      recoveryOperations: [...new Set(input.recoveryOperations)].sort(),
      budget: input.budget,
      lastEventSequence: 0,
      lease: this.newLease(now),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    const created = await this.repository.create(record);
    this.startHeartbeat(created.id);
    return created;
  }

  async get(id: string): Promise<RunSupervisorRecord> {
    const record = await this.repository.get(id);
    if (!record) throw new NotFoundError('Run supervisor record not found.');
    return record;
  }

  async findByAttempt(
    workspaceId: string,
    taskId: string,
    attemptId: string
  ): Promise<RunSupervisorRecord | null> {
    return (
      (
        await this.repository.list({
          workspaceId,
          taskId,
          attemptId,
        })
      )[0] ?? null
    );
  }

  async attachLocalProcess(
    id: string,
    pid: number,
    processGroupId?: number
  ): Promise<RunSupervisorRecord> {
    const identity = this.processProbe(pid);
    if (!identity.alive) {
      await this.requireRecovery(
        id,
        'process-not-found',
        'The provider process exited before its durable control handle was attached.',
        'Inspect the run log and launch a new attempt after confirming no descendant process remains.'
      );
      throw new ConflictError('Provider process exited before supervisor attachment.', {
        supervisorId: id,
        pid,
      });
    }
    return this.mutate(id, (current, now) => ({
      ...current,
      state: 'running',
      control: {
        kind: 'local-process',
        hostId: this.hostId,
        pid,
        processGroupId,
        startToken: identity.startToken,
      },
      lease: this.refreshLease(current.lease, now),
      updatedAt: now.toISOString(),
      recovery: undefined,
    }));
  }

  async attachRemoteSession(
    id: string,
    sessionId: string,
    threadId?: string
  ): Promise<RunSupervisorRecord> {
    return this.mutate(id, (current, now) => ({
      ...current,
      state: 'running',
      control: {
        kind: 'remote-session',
        hostId: this.hostId,
        sessionId,
        threadId,
      },
      lease: this.refreshLease(current.lease, now),
      updatedAt: now.toISOString(),
      recovery: undefined,
    }));
  }

  async checkpoint(id: string, checkpoint: RunSupervisorCheckpoint): Promise<RunSupervisorRecord> {
    return this.mutate(id, (current, now) => {
      const control =
        (current.control.kind === 'remote-session' || current.control.kind === 'local-process') &&
        checkpoint.sessionId
          ? {
              ...current.control,
              sessionId: checkpoint.sessionId,
              threadId: checkpoint.threadId ?? current.control.threadId,
            }
          : current.control;
      return {
        ...current,
        state: current.state === 'launching' ? 'running' : current.state,
        control,
        budget: checkpoint.budget ?? current.budget,
        lastEventSequence: Math.max(
          current.lastEventSequence,
          checkpoint.lastEventSequence ?? current.lastEventSequence
        ),
        lease: this.refreshLease(current.lease, now),
        updatedAt: now.toISOString(),
      };
    });
  }

  async heartbeat(id: string): Promise<RunSupervisorRecord> {
    return this.mutate(id, (current, now) => ({
      ...current,
      lease: this.refreshLease(current.lease, now),
      updatedAt: now.toISOString(),
    }));
  }

  async recover(
    id: string,
    bindings: RunSupervisorRecoveryBindings
  ): Promise<RunSupervisorRecoveryResult> {
    const current = await this.get(id);
    if (isTerminal(current.state)) {
      if (!matchesRecoveryBindings(current.bindings, bindings)) {
        return {
          outcome: 'recovery-required',
          record: current,
          recovery: {
            code: 'binding-mismatch',
            detail:
              'The terminal supervisor does not match the persisted provider, launch, task, or worktree bindings.',
            nextAction:
              'Do not apply this completion. Inspect the immutable attempt and supervisor evidence, then resolve the task manually.',
            recordedAt: this.now().toISOString(),
          },
        };
      }
      return { outcome: 'terminal', record: current };
    }
    const claimed = await this.claimRecoveryLease(current);
    if (!claimed) return { outcome: 'lease-held', record: await this.get(id) };
    const record = await this.get(id);
    if (!matchesRecoveryBindings(record.bindings, bindings)) {
      const recoveryRequired = await this.requireRecovery(
        id,
        'binding-mismatch',
        'The persisted provider, launch manifest, task envelope, or worktree binding changed.',
        'Do not resume this process. Inspect the recovery record, terminate the original handle if safe, and launch a new attempt.'
      );
      return { outcome: 'recovery-required', record: recoveryRequired };
    }
    if (record.control.kind === 'local-process') {
      if (record.control.hostId !== this.hostId) {
        return this.recoveryRequiredResult(
          id,
          'foreign-host',
          'The local provider process belongs to another host identity.',
          'Recover the run on its original host or verify termination there before launching again.'
        );
      }
      const probe = this.processProbe(record.control.pid);
      if (!probe.alive) {
        return this.recoveryRequiredResult(
          id,
          'process-not-found',
          'The persisted provider process is no longer running.',
          'Review the durable event cursor and run log, then retry from a new attempt.'
        );
      }
      if (!record.control.startToken || !probe.startToken) {
        return this.recoveryRequiredResult(
          id,
          'process-identity-unverifiable',
          'The provider process is alive but its start identity cannot be verified.',
          'Terminate the exact process group after manual verification, then launch a new attempt.'
        );
      }
      if (record.control.startToken !== probe.startToken) {
        return this.recoveryRequiredResult(
          id,
          'process-identity-mismatch',
          'The persisted process ID was reused by a different operating-system process.',
          'Do not signal the reused process. Launch a new attempt after reviewing the old run evidence.'
        );
      }
      const reattached = await this.mutate(id, (candidate, now) => ({
        ...candidate,
        state: 'reattached',
        lease: this.refreshLease(candidate.lease, now),
        recovery: undefined,
        updatedAt: now.toISOString(),
      }));
      this.startHeartbeat(id);
      return { outcome: 'reattached', record: reattached };
    }
    if (record.control.kind === 'remote-session') {
      if (
        !record.recoveryOperations.includes('reattach') &&
        !record.recoveryOperations.includes('resume')
      ) {
        return this.recoveryRequiredResult(
          id,
          'adapter-reattach-unsupported',
          'The provider adapter does not declare a durable session recovery operation.',
          'Leave the remote session untouched, inspect it in the provider, and launch a new attempt only after its state is known.'
        );
      }
      const reachable = this.sessionProbe ? await this.sessionProbe(record) : false;
      if (!reachable) {
        return this.recoveryRequiredResult(
          id,
          'session-unreachable',
          'The persisted provider session could not be reached through its adapter.',
          'Restore provider connectivity and retry recovery, or verify the remote session before launching new work.'
        );
      }
      const reattached = await this.mutate(id, (candidate, now) => ({
        ...candidate,
        state: 'reattached',
        lease: this.refreshLease(candidate.lease, now),
        recovery: undefined,
        updatedAt: now.toISOString(),
      }));
      this.startHeartbeat(id);
      return { outcome: 'reattached', record: reattached };
    }
    return this.recoveryRequiredResult(
      id,
      'in-process-state-lost',
      'The provider used process-local state without a durable process or session handle.',
      'Record the attempt as interrupted and start a new attempt from the last durable event cursor.'
    );
  }

  async requireRecovery(
    id: string,
    code: RunSupervisorRecoveryReasonCode,
    detail: string,
    nextAction: string
  ): Promise<RunSupervisorRecord> {
    this.stopHeartbeat(id);
    return this.mutate(id, (current, now) =>
      isTerminal(current.state)
        ? current
        : {
            ...current,
            state: 'recovery-required',
            recovery: { code, detail, nextAction, recordedAt: now.toISOString() },
            updatedAt: now.toISOString(),
          }
    );
  }

  async markTerminal(
    id: string,
    state: RunSupervisorTerminalState,
    summary: string,
    idempotencyKey?: string,
    completionResult?: CompletionResult
  ): Promise<RunSupervisorRecord> {
    this.stopHeartbeat(id);
    return this.mutate(id, (current, now) => {
      if (isTerminal(current.state)) {
        if (
          current.state === state &&
          (!idempotencyKey || current.terminal?.idempotencyKey === idempotencyKey)
        ) {
          return current;
        }
        throw new ConflictError('A different terminal state already owns the run supervisor.', {
          supervisorId: id,
          currentState: current.state,
          requestedState: state,
        });
      }
      return {
        ...current,
        state,
        terminal: {
          state,
          summary,
          idempotencyKey,
          completionResult,
          recordedAt: now.toISOString(),
        },
        updatedAt: now.toISOString(),
      };
    });
  }

  async stopLocalProcess(id: string): Promise<void> {
    const record = await this.get(id);
    if (record.control.kind !== 'local-process') {
      throw new ConflictError('Run supervisor does not own a local provider process.', {
        supervisorId: id,
        controlKind: record.control.kind,
      });
    }
    if (record.control.hostId !== this.hostId) {
      throw new ConflictError('Run supervisor cannot signal a process on another host.', {
        supervisorId: id,
      });
    }
    const before = this.processProbe(record.control.pid);
    if (!before.alive) return;
    if (
      !record.control.startToken ||
      !before.startToken ||
      record.control.startToken !== before.startToken
    ) {
      throw new ConflictError('Provider process identity no longer matches the durable handle.', {
        supervisorId: id,
        pid: record.control.pid,
      });
    }
    this.signalProcess(record.control.pid, record.control.processGroupId, 'SIGTERM');
    const deadline = Date.now() + PROCESS_STOP_GRACE_MS;
    while (Date.now() < deadline) {
      if (!this.processProbe(record.control.pid).alive) return;
      await delay(PROCESS_STOP_POLL_MS);
    }
    this.signalProcess(record.control.pid, record.control.processGroupId, 'SIGKILL');
  }

  isLocalProcessAlive(record: RunSupervisorRecord): boolean {
    if (record.control.kind !== 'local-process' || record.control.hostId !== this.hostId)
      return false;
    const probe = this.processProbe(record.control.pid);
    return (
      probe.alive &&
      Boolean(record.control.startToken) &&
      Boolean(probe.startToken) &&
      record.control.startToken === probe.startToken
    );
  }

  dispose(): void {
    for (const id of this.heartbeatTimers.keys()) this.stopHeartbeat(id);
  }

  private async recoveryRequiredResult(
    id: string,
    code: RunSupervisorRecoveryReasonCode,
    detail: string,
    nextAction: string
  ): Promise<RunSupervisorRecoveryResult> {
    return {
      outcome: 'recovery-required',
      record: await this.requireRecovery(id, code, detail, nextAction),
    };
  }

  private async claimRecoveryLease(record: RunSupervisorRecord): Promise<boolean> {
    if (record.lease.ownerId === this.ownerId) return true;
    const now = this.now();
    const leaseActive = Date.parse(record.lease.expiresAt) > now.getTime();
    const ownerAlive =
      leaseActive &&
      record.lease.hostId === this.hostId &&
      this.processProbe(record.lease.processId).alive;
    const foreignLeaseActive = record.lease.hostId !== this.hostId && leaseActive;
    if (ownerAlive || foreignLeaseActive) return false;
    const next = RunSupervisorRecordSchema.parse({
      ...record,
      state: 'recovering',
      revision: record.revision + 1,
      lease: this.newLease(now),
      updatedAt: now.toISOString(),
    });
    const result = await this.repository.compareAndSet({
      id: record.id,
      expectedRevision: record.revision,
      next,
    });
    return result.updated;
  }

  private startHeartbeat(id: string): void {
    if (this.heartbeatTimers.has(id)) return;
    const timer = setInterval(() => {
      void this.heartbeat(id).catch(() => this.stopHeartbeat(id));
    }, this.heartbeatMs);
    timer.unref();
    this.heartbeatTimers.set(id, timer);
  }

  private stopHeartbeat(id: string): void {
    const timer = this.heartbeatTimers.get(id);
    if (timer) clearInterval(timer);
    this.heartbeatTimers.delete(id);
  }

  private async mutate(
    id: string,
    transform: (current: RunSupervisorRecord, now: Date) => Omit<RunSupervisorRecord, 'revision'>
  ): Promise<RunSupervisorRecord> {
    let current = await this.get(id);
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const transformed = transform(current, this.now());
      if (transformed === current) return current;
      const next = RunSupervisorRecordSchema.parse({
        ...transformed,
        revision: current.revision + 1,
      });
      const result = await this.repository.compareAndSet({
        id,
        expectedRevision: current.revision,
        next,
      });
      if (result.updated && result.record) return result.record;
      if (result.reason === 'not-found')
        throw new NotFoundError('Run supervisor record not found.');
      if (result.reason === 'invalid-revision') {
        throw new ConflictError('Run supervisor compare-and-set revision was invalid.', {
          supervisorId: id,
        });
      }
      current = result.record ?? (await this.get(id));
    }
    throw new ConflictError('Run supervisor compare-and-set retry budget was exhausted.', {
      supervisorId: id,
    });
  }

  private newLease(now: Date) {
    const timestamp = now.toISOString();
    return {
      ownerId: this.ownerId,
      hostId: this.hostId,
      processId: this.processId,
      acquiredAt: timestamp,
      heartbeatAt: timestamp,
      expiresAt: new Date(now.getTime() + this.leaseMs).toISOString(),
    };
  }

  private refreshLease(lease: RunSupervisorRecord['lease'], now: Date) {
    if (lease.ownerId !== this.ownerId) {
      throw new ConflictError('Run supervisor lease is owned by another process.', {
        leaseOwnerId: lease.ownerId,
      });
    }
    return {
      ...lease,
      heartbeatAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.leaseMs).toISOString(),
    };
  }
}

export function fingerprintWorktree(input: {
  worktreePath: string;
  worktreeManifestId?: string;
  worktreeLeaseId?: string;
  taskEnvelopeDigest: string;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        input.worktreePath,
        input.worktreeManifestId ?? null,
        input.worktreeLeaseId ?? null,
        input.taskEnvelopeDigest,
      ])
    )
    .digest('hex');
}

export function signalProcessGroup(
  pid: number,
  processGroupId: number | undefined,
  signal: NodeJS.Signals
): void {
  const target = process.platform === 'win32' || !processGroupId ? pid : -Math.abs(processGroupId);
  try {
    process.kill(target, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

function defaultProcessProbe(pid: number): ProcessProbeResult {
  try {
    process.kill(pid, 0);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return { alive: false };
    if (code !== 'EPERM') return { alive: false };
  }
  return { alive: true, startToken: processStartToken(pid) };
}

function processStartToken(pid: number): string | undefined {
  if (process.platform === 'win32') return undefined;
  try {
    const output = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 1_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return output || undefined;
  } catch {
    return undefined;
  }
}

function defaultHostId(): string {
  const configured = process.env.VERITAS_RUN_HOST_ID?.trim();
  return createHash('sha256')
    .update(configured || `${hostname()}\0${platform()}\0${arch()}`)
    .digest('hex');
}

function normalizeHostId(value: string): string {
  return /^[a-f0-9]{64}$/.test(value) ? value : createHash('sha256').update(value).digest('hex');
}

function supervisorIdFor(workspaceId: string, taskId: string, attemptId: string): string {
  return `runsupervisor_${createHash('sha256')
    .update(`${workspaceId}:${taskId}:${attemptId}`)
    .digest('base64url')
    .slice(0, 20)}`;
}

function sameBindings(left: RunSupervisorBindings, right: RunSupervisorBindings): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function matchesRecoveryBindings(
  persisted: RunSupervisorBindings,
  current: RunSupervisorRecoveryBindings
): boolean {
  return (
    persisted.provider === current.provider &&
    persisted.adapter === current.adapter &&
    persisted.providerRuntimeManifestDigest === current.providerRuntimeManifestDigest &&
    persisted.taskEnvelopeDigest === current.taskEnvelopeDigest &&
    persisted.runLaunchManifestDigest === current.runLaunchManifestDigest &&
    persisted.worktreePath === current.worktreePath &&
    persisted.worktreeManifestId === current.worktreeManifestId &&
    persisted.worktreeLeaseId === current.worktreeLeaseId &&
    persisted.worktreeFingerprint === fingerprintWorktree(current)
  );
}

function isTerminal(state: RunSupervisorRecord['state']): state is RunSupervisorTerminalState {
  return ['completed', 'failed', 'interrupted', 'cancelled'].includes(state);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let instance: RunSupervisorService | undefined;

export function getRunSupervisorService(): RunSupervisorService {
  instance ??= new RunSupervisorService();
  return instance;
}

export function resetRunSupervisorServiceForTests(): void {
  instance?.dispose();
  instance = undefined;
  fileRepository = undefined;
}

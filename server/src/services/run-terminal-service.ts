import { createHash } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { nanoid } from 'nanoid';
import {
  RUN_TERMINAL_HANDLE_SCHEMA_VERSION,
  RUN_TERMINAL_OUTPUT_SCHEMA_VERSION,
  RUN_TERMINAL_RECONCILIATION_SCHEMA_VERSION,
  type RunEventAppendInput,
  type RunEventEnvelope,
  type RunTerminalCapabilityPosture,
  type RunTerminalExecuteRequest,
  type RunTerminalHandle,
  type RunTerminalOutputChunk,
  type RunTerminalOutputPage,
  type RunTerminalReconciliationResult,
  type RunTerminalStream,
  type RunTerminalTerminationResult,
  type RunTerminalWaitManyResult,
  type RunTerminalWaitResult,
} from '@veritas-kanban/shared';
import { createLogger } from '../lib/logger.js';
import { redactString } from '../lib/redact.js';
import {
  ConflictError,
  InternalError,
  NotFoundError,
  ValidationError,
} from '../middleware/error-handler.js';
import {
  RunTerminalExecuteRequestSchema,
  RunTerminalHandleSchema,
} from '../schemas/run-terminal-schemas.js';
import { realpath } from '../storage/fs-helpers.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import {
  getRunEventJournalService,
  type RunEventJournalService,
} from './run-event-journal-service.js';

const log = createLogger('run-terminal-service');
const DEFAULT_OUTPUT_LIMIT_BYTES = 256 * 1024;
const DEFAULT_MAXIMUM_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_PERSISTED_CHUNK_BYTES = 6 * 1024;
const DEFAULT_CHUNK_LIMIT_BYTES = MAX_PERSISTED_CHUNK_BYTES;
const DEFAULT_TERMINATION_GRACE_MS = 5_000;
const MAX_OUTPUT_PAGE_CHUNKS = 200;
const MAX_WAIT_MS = 300_000;
const MAX_RECONCILIATION_EVENTS = 20_000;

const CAPABILITIES: RunTerminalCapabilityPosture = {
  pipe: 'enforced',
  pty: 'unsupported',
  interactiveStdin: 'unsupported',
  restartReattachment: 'unsupported',
};

export interface RunTerminalLaunchContext {
  workspaceId: string;
  taskId: string;
  attemptId: string;
  launchManifestDigest: string;
  worktreeRoot: string;
  environment: Record<string, string>;
  allowedCommands: string[];
  wrap?: (
    command: string,
    args: string[],
    cwd: string
  ) => {
    command: string;
    args: string[];
    cwd: string;
    environment: Record<string, string>;
  };
}

export interface RunTerminalServiceOptions {
  journal?: Pick<RunEventJournalService, 'append' | 'list'>;
  now?: () => Date;
  outputLimitBytes?: number;
  maximumOutputBytes?: number;
  chunkLimitBytes?: number;
  terminationGraceMs?: number;
}

interface TerminalRecord {
  handle: RunTerminalHandle;
  chunks: RunTerminalOutputChunk[];
  retainedBytes: number;
  droppedBytes: number;
  observedBytes: number;
  nextCursor: number;
  journalQueue: Promise<void>;
}

interface RuntimeRecord extends TerminalRecord {
  context: RunTerminalLaunchContext;
  child: ChildProcessWithoutNullStreams;
  exit: Promise<void>;
  resolveExit(): void;
  gracefulSignalAt?: string;
  forceSignalAt?: string;
  journalFailure?: Error;
  completedEventQueued: boolean;
  volumeCircuitTripped: boolean;
}

export class RunTerminalService {
  private readonly journal: Pick<RunEventJournalService, 'append' | 'list'>;
  private readonly now: () => Date;
  private readonly outputLimitBytes: number;
  private readonly maximumOutputBytes: number;
  private readonly chunkLimitBytes: number;
  private readonly terminationGraceMs: number;
  private readonly records = new Map<string, TerminalRecord>();
  private readonly recoveredHandleIds = new Set<string>();
  private readonly pendingExecutions = new Map<
    string,
    { requestDigest: string; promise: Promise<RunTerminalHandle> }
  >();

  constructor(options: RunTerminalServiceOptions = {}) {
    this.journal = options.journal ?? getRunEventJournalService();
    this.now = options.now ?? (() => new Date());
    this.outputLimitBytes = boundedPositive(
      options.outputLimitBytes,
      DEFAULT_OUTPUT_LIMIT_BYTES,
      4 * 1024,
      16 * 1024 * 1024
    );
    this.chunkLimitBytes = boundedPositive(
      options.chunkLimitBytes,
      DEFAULT_CHUNK_LIMIT_BYTES,
      256,
      MAX_PERSISTED_CHUNK_BYTES
    );
    if (this.chunkLimitBytes > this.outputLimitBytes) {
      throw new Error('Run terminal chunk limit cannot exceed the output limit.');
    }
    this.maximumOutputBytes = boundedPositive(
      options.maximumOutputBytes,
      DEFAULT_MAXIMUM_OUTPUT_BYTES,
      4 * 1024,
      64 * 1024 * 1024
    );
    if (this.maximumOutputBytes < this.outputLimitBytes) {
      throw new Error('Run terminal maximum output bytes cannot be below the retention limit.');
    }
    this.terminationGraceMs = boundedPositive(
      options.terminationGraceMs,
      DEFAULT_TERMINATION_GRACE_MS,
      100,
      60_000
    );
  }

  async execute(
    inputContext: RunTerminalLaunchContext,
    inputRequest: RunTerminalExecuteRequest
  ): Promise<RunTerminalHandle> {
    const context = normalizeContext(inputContext);
    const request = RunTerminalExecuteRequestSchema.parse(inputRequest);
    const requestDigest = digestTerminalRequest(request);
    const existing = [...this.records.values()].find(
      (record) =>
        record.handle.workspaceId === context.workspaceId &&
        record.handle.taskId === context.taskId &&
        record.handle.attemptId === context.attemptId &&
        record.handle.requestId === request.requestId
    );
    if (existing) {
      if (existing.handle.requestDigest !== requestDigest) {
        throw new ConflictError('Terminal request identity was reused for a changed command.', {
          requestId: request.requestId,
          handleId: existing.handle.id,
        });
      }
      return cloneHandle(existing.handle);
    }
    const executionKey = [
      context.workspaceId,
      context.taskId,
      context.attemptId,
      request.requestId,
    ].join('\0');
    const pending = this.pendingExecutions.get(executionKey);
    if (pending) {
      if (pending.requestDigest !== requestDigest) {
        throw new ConflictError('Terminal request identity was reused for a changed command.', {
          requestId: request.requestId,
        });
      }
      return pending.promise.then(cloneHandle);
    }
    const promise = this.executeNew(context, request, requestDigest);
    this.pendingExecutions.set(executionKey, { requestDigest, promise });
    try {
      return await promise;
    } finally {
      if (this.pendingExecutions.get(executionKey)?.promise === promise) {
        this.pendingExecutions.delete(executionKey);
      }
    }
  }

  private async executeNew(
    context: RunTerminalLaunchContext,
    request: RunTerminalExecuteRequest,
    requestDigest: string
  ): Promise<RunTerminalHandle> {
    if (request.mode !== 'pipe') {
      throw new ConflictError('PTY mode is not supported by the current run terminal runtime.', {
        mode: request.mode,
        capability: CAPABILITIES.pty,
      });
    }
    if (!context.allowedCommands.includes(request.command)) {
      throw new ConflictError('Terminal command is not approved by the run launch manifest.', {
        commandId: commandId(request.command, request.args),
      });
    }
    assertNoCredentialArguments(request.command, request.args);
    const requestedCwd = await resolveCwd(context.worktreeRoot, request.cwd);
    const launch = context.wrap
      ? context.wrap(request.command, request.args, requestedCwd)
      : {
          command: request.command,
          args: request.args,
          cwd: requestedCwd,
          environment: {},
        };
    const cwd = await resolveWrappedCwd(context.worktreeRoot, launch.cwd);
    const environment = {
      ...selectEnvironment(context.environment, request.environmentKeys),
      ...launch.environment,
    };
    const id = `terminal_${nanoid(18)}`;
    const startedAt = this.now().toISOString();
    const child = spawn(launch.command, launch.args, {
      cwd,
      env: environment,
      shell: false,
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    let resolveExit!: () => void;
    const exit = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    const handle: RunTerminalHandle = {
      schemaVersion: RUN_TERMINAL_HANDLE_SCHEMA_VERSION,
      id,
      workspaceId: context.workspaceId,
      taskId: context.taskId,
      attemptId: context.attemptId,
      launchManifestDigest: context.launchManifestDigest,
      requestId: request.requestId,
      requestDigest,
      mode: request.mode,
      startMode: request.startMode,
      state: child.pid ? 'running' : 'starting',
      commandId: commandId(request.command, request.args),
      ...(child.pid
        ? {
            processId: child.pid,
            ...(process.platform !== 'win32' ? { processGroupId: child.pid } : {}),
          }
        : {}),
      startedAt,
      output: emptyOutputMetadata(),
      capabilities: { ...CAPABILITIES },
    };
    const record: RuntimeRecord = {
      context,
      handle,
      child,
      chunks: [],
      retainedBytes: 0,
      droppedBytes: 0,
      observedBytes: 0,
      nextCursor: 1,
      exit,
      resolveExit,
      journalQueue: Promise.resolve(),
      completedEventQueued: false,
      volumeCircuitTripped: false,
    };
    this.records.set(id, record);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.acceptOutput(record, 'stdout', chunk));
    child.stderr.on('data', (chunk: string) => this.acceptOutput(record, 'stderr', chunk));
    child.once('spawn', () => {
      if (record.handle.state === 'starting') record.handle.state = 'running';
      this.refreshOutputMetadata(record);
    });
    child.once('error', (error) => this.fail(record, error));
    child.once('close', (code, signal) => this.close(record, code, signal));
    try {
      await this.appendEvent(record, {
        kind: 'command.started',
        payload: {
          handleId: id,
          commandId: handle.commandId,
          mode: request.mode,
          startMode: request.startMode,
          handle: cloneHandle(handle),
        },
        dedupeKey: `run-terminal:${id}:started`,
      });
    } catch (error) {
      record.completedEventQueued = true;
      if (!terminal(record.handle.state)) signalProcessGroup(record.child, 'SIGKILL');
      await record.exit;
      this.records.delete(id);
      log.error(
        { err: error, handleId: id, attemptId: context.attemptId },
        'Failed to persist run terminal ownership before returning the handle'
      );
      throw new InternalError('Run terminal ownership could not be persisted.');
    }
    return cloneHandle(record.handle);
  }

  get(handleId: string): RunTerminalHandle {
    return cloneHandle(this.require(handleId).handle);
  }

  assertScope(
    handleId: string,
    workspaceId: string,
    taskId: string,
    attemptId: string
  ): RunTerminalHandle {
    const handle = this.get(handleId);
    if (
      handle.workspaceId !== required(workspaceId, 'workspaceId') ||
      handle.taskId !== required(taskId, 'taskId') ||
      handle.attemptId !== required(attemptId, 'attemptId')
    ) {
      throw new NotFoundError('Run terminal handle not found.');
    }
    return handle;
  }

  list(workspaceId: string, taskId: string, attemptId: string): RunTerminalHandle[] {
    const scope = {
      workspaceId: required(workspaceId, 'workspaceId'),
      taskId: required(taskId, 'taskId'),
      attemptId: required(attemptId, 'attemptId'),
    };
    return [...this.records.values()]
      .filter(
        (record) =>
          record.handle.workspaceId === scope.workspaceId &&
          record.handle.taskId === scope.taskId &&
          record.handle.attemptId === scope.attemptId
      )
      .map((record) => cloneHandle(record.handle))
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  }

  output(handleId: string, afterCursor = 0, limit = MAX_OUTPUT_PAGE_CHUNKS): RunTerminalOutputPage {
    if (!Number.isInteger(afterCursor) || afterCursor < 0) {
      throw new ValidationError('Terminal output cursor must be a non-negative integer.');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_OUTPUT_PAGE_CHUNKS) {
      throw new ValidationError(
        `Terminal output page limit must be between 1 and ${MAX_OUTPUT_PAGE_CHUNKS}.`
      );
    }
    const record = this.require(handleId);
    const retainedFromCursor = record.chunks[0]?.cursor ?? record.nextCursor;
    const chunks = record.chunks
      .filter((chunk) => chunk.cursor > afterCursor)
      .slice(0, limit)
      .map((chunk) => ({ ...chunk }));
    return {
      schemaVersion: RUN_TERMINAL_OUTPUT_SCHEMA_VERSION,
      handleId,
      afterCursor,
      nextCursor:
        chunks.at(-1)?.cursor ??
        (afterCursor < retainedFromCursor ? retainedFromCursor - 1 : afterCursor),
      retainedFromCursor,
      gap: afterCursor < retainedFromCursor - 1,
      chunks,
      handle: cloneHandle(record.handle),
    };
  }

  async wait(handleId: string, timeoutMs: number): Promise<RunTerminalWaitResult> {
    assertWaitTimeout(timeoutMs);
    const record = this.require(handleId);
    if (terminal(record.handle.state)) {
      await this.awaitJournal(record);
      return { completed: true, timedOut: false, handle: cloneHandle(record.handle) };
    }
    const runtime = this.requireRuntime(handleId);
    if (timeoutMs === 0) {
      return { completed: false, timedOut: true, handle: cloneHandle(runtime.handle) };
    }
    let timer: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
      runtime.exit.then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), timeoutMs);
        timer.unref();
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (!timedOut) await this.awaitJournal(runtime);
    return {
      completed: !timedOut,
      timedOut,
      handle: cloneHandle(runtime.handle),
    };
  }

  async waitAny(handleIds: string[], timeoutMs: number): Promise<RunTerminalWaitManyResult> {
    assertWaitTimeout(timeoutMs);
    const records = this.requireMany(handleIds);
    const alreadyCompleted = records.find((record) => terminal(record.handle.state));
    if (alreadyCompleted) {
      await this.awaitJournal(alreadyCompleted);
      return this.waitManyResult('any', records, false, alreadyCompleted.handle.id);
    }
    if (timeoutMs === 0) return this.waitManyResult('any', records, true);
    const runtimeRecords = records.map((record) => this.requireRuntime(record.handle.id));
    let timer: NodeJS.Timeout | undefined;
    const selectedHandleId = await Promise.race([
      ...runtimeRecords.map((record) => record.exit.then(() => record.handle.id)),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
        timer.unref();
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (selectedHandleId) {
      await this.awaitJournal(this.require(selectedHandleId));
      return this.waitManyResult('any', records, false, selectedHandleId);
    }
    return this.waitManyResult('any', records, true);
  }

  async waitAll(handleIds: string[], timeoutMs: number): Promise<RunTerminalWaitManyResult> {
    assertWaitTimeout(timeoutMs);
    const records = this.requireMany(handleIds);
    const pending = records.filter((record) => !terminal(record.handle.state));
    if (pending.length === 0) {
      await Promise.all(records.map((record) => this.awaitJournal(record)));
      return this.waitManyResult('all', records, false);
    }
    if (timeoutMs === 0) return this.waitManyResult('all', records, true);
    const runtimePending = pending.map((record) => this.requireRuntime(record.handle.id));
    let timer: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
      Promise.all(runtimePending.map((record) => record.exit)).then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), timeoutMs);
        timer.unref();
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (!timedOut) await Promise.all(records.map((record) => this.awaitJournal(record)));
    return this.waitManyResult('all', records, timedOut);
  }

  async detach(handleId: string): Promise<RunTerminalHandle> {
    const record = this.require(handleId);
    if (record.handle.startMode === 'background') return cloneHandle(record.handle);
    if (terminal(record.handle.state)) {
      throw new ConflictError('A terminal command cannot be detached after it exits.');
    }
    const runtime = this.requireRuntime(handleId);
    runtime.handle.startMode = 'background';
    try {
      await this.appendEvent(runtime, {
        kind: 'command.detached',
        payload: {
          handleId: runtime.handle.id,
          commandId: runtime.handle.commandId,
          handle: cloneHandle(runtime.handle),
        },
        dedupeKey: `run-terminal:${runtime.handle.id}:detached`,
      });
    } catch {
      runtime.handle.startMode = 'foreground';
      throw new InternalError('Run terminal detachment could not be persisted.');
    }
    return cloneHandle(runtime.handle);
  }

  async terminate(handleId: string): Promise<RunTerminalTerminationResult> {
    const record = this.require(handleId);
    if (terminal(record.handle.state)) {
      return { handle: cloneHandle(record.handle) };
    }
    const runtime = this.requireRuntime(handleId);
    runtime.handle.state = 'terminating';
    runtime.gracefulSignalAt = this.now().toISOString();
    signalProcessGroup(runtime.child, 'SIGTERM');
    const graceful = await this.wait(handleId, this.terminationGraceMs);
    if (!graceful.completed && !terminal(runtime.handle.state)) {
      runtime.forceSignalAt = this.now().toISOString();
      signalProcessGroup(runtime.child, 'SIGKILL');
      await runtime.exit;
    }
    return this.terminationResult(runtime);
  }

  async cleanupAttempt(
    workspaceId: string,
    taskId: string,
    attemptId: string
  ): Promise<RunTerminalTerminationResult[]> {
    const scope = {
      workspaceId: required(workspaceId, 'workspaceId'),
      taskId: required(taskId, 'taskId'),
      attemptId: required(attemptId, 'attemptId'),
    };
    const records = [...this.records.values()].filter(
      (record) =>
        record.handle.workspaceId === scope.workspaceId &&
        record.handle.taskId === scope.taskId &&
        record.handle.attemptId === scope.attemptId
    );
    const results = await Promise.all(
      records.map(async (record) => {
        if (terminal(record.handle.state)) {
          await this.awaitJournal(record);
          return undefined;
        }
        return this.terminate(record.handle.id);
      })
    );
    return results.filter((result): result is RunTerminalTerminationResult => result !== undefined);
  }

  async reconcileAttempt(
    inputWorkspaceId: string,
    inputTaskId: string,
    inputAttemptId: string
  ): Promise<RunTerminalReconciliationResult> {
    const workspaceId = required(inputWorkspaceId, 'workspaceId');
    const taskId = required(inputTaskId, 'taskId');
    const attemptId = required(inputAttemptId, 'attemptId');
    const projected = new Map<string, TerminalRecord>();
    let afterSequence = 0;
    let eventCount = 0;

    for (;;) {
      const page = await this.journal.list({
        taskId,
        attemptId,
        afterSequence,
        limit: 500,
      });
      for (const event of page.events) {
        if (event.source.provider !== 'system' || event.source.adapter !== 'run-terminal') {
          continue;
        }
        eventCount += 1;
        if (eventCount > MAX_RECONCILIATION_EVENTS) {
          throw new ConflictError('Run terminal reconciliation exceeded its event bound.', {
            taskId,
            attemptId,
            maximumEvents: MAX_RECONCILIATION_EVENTS,
          });
        }
        this.projectReconciliationEvent(projected, event, workspaceId, taskId, attemptId);
      }
      if (page.hasMore && page.nextCursor <= afterSequence) {
        throw new ConflictError('Run terminal reconciliation journal cursor did not advance.', {
          taskId,
          attemptId,
          afterSequence,
        });
      }
      afterSequence = page.nextCursor;
      if (!page.hasMore) break;
    }

    const interruptedHandleIds: string[] = [];
    for (const [handleId, record] of projected) {
      if (this.records.has(handleId)) continue;
      if (!terminal(record.handle.state)) {
        const recordedAt = this.now().toISOString();
        record.handle.state = 'interrupted';
        record.handle.endedAt = recordedAt;
        record.handle.failure =
          'Run terminal ownership was interrupted because this runtime cannot reattach inherited pipes after a server restart.';
        record.handle.capabilities.restartReattachment = 'unsupported';
        await this.journal.append({
          workspaceId: record.handle.workspaceId,
          taskId,
          attemptId,
          kind: 'command.completed',
          source: {
            provider: 'system',
            adapter: 'run-terminal',
          },
          payload: {
            handleId,
            commandId: record.handle.commandId,
            state: record.handle.state,
            failure: record.handle.failure,
            output: record.handle.output,
            reconciledAfterRestart: true,
            handle: cloneHandle(record.handle),
          },
          dedupeKey: `run-terminal:${handleId}:restart-interrupted`,
        });
        interruptedHandleIds.push(handleId);
      }
      this.records.set(handleId, record);
      this.recoveredHandleIds.add(handleId);
    }

    const handles = this.list(workspaceId, taskId, attemptId);
    return {
      schemaVersion: RUN_TERMINAL_RECONCILIATION_SCHEMA_VERSION,
      workspaceId,
      taskId,
      attemptId,
      handles,
      recoveredHandleIds: handles
        .map((handle) => handle.id)
        .filter((handleId) => this.recoveredHandleIds.has(handleId)),
      interruptedHandleIds: interruptedHandleIds.sort(),
    };
  }

  private projectReconciliationEvent(
    projected: Map<string, TerminalRecord>,
    event: RunEventEnvelope,
    workspaceId: string,
    taskId: string,
    attemptId: string
  ): void {
    if (
      event.kind === 'command.started' ||
      event.kind === 'command.detached' ||
      event.kind === 'command.completed'
    ) {
      const handle = parsePersistedHandle(event.payload.handle);
      if (!handle) return;
      if (
        handle.workspaceId !== workspaceId ||
        handle.taskId !== taskId ||
        handle.attemptId !== attemptId
      ) {
        throw new ConflictError('Persisted run terminal handle scope does not match its journal.', {
          handleId: handle.id,
          workspaceId,
          taskId,
          attemptId,
        });
      }
      const current = projected.get(handle.id);
      if (event.kind === 'command.started') {
        if (terminal(handle.state)) {
          throw new ConflictError('Persisted run terminal start event is already terminal.', {
            handleId: handle.id,
          });
        }
      } else {
        if (!current) return;
        assertSamePersistedHandleIdentity(current.handle, handle);
        if (event.kind === 'command.detached' && handle.startMode !== 'background') {
          throw new ConflictError('Persisted run terminal detach event is not detached.', {
            handleId: handle.id,
          });
        }
        if (event.kind === 'command.completed' && !terminal(handle.state)) {
          throw new ConflictError('Persisted run terminal completion event is not terminal.', {
            handleId: handle.id,
          });
        }
      }
      projected.set(handle.id, {
        handle,
        chunks: current?.chunks ?? [],
        retainedBytes: handle.output.retainedBytes,
        droppedBytes: handle.output.droppedBytes,
        observedBytes: handle.output.observedBytes,
        nextCursor: Math.max(handle.output.nextCursor + 1, current?.nextCursor ?? 1),
        journalQueue: Promise.resolve(),
      });
      return;
    }
    if (event.kind !== 'stream.stdout' && event.kind !== 'stream.stderr') return;
    const handleId = persistedString(event.payload.handleId);
    if (!handleId) return;
    const record = projected.get(handleId);
    if (!record) return;
    const chunk = parsePersistedChunk(event);
    if (!chunk) return;
    const priorChunk = record.chunks.at(-1);
    if (priorChunk && chunk.cursor <= priorChunk.cursor) {
      throw new ConflictError('Persisted run terminal output cursors are not monotonic.', {
        handleId,
        cursor: chunk.cursor,
      });
    }
    record.chunks.push(chunk);
    record.retainedBytes += chunk.byteLength;
    record.observedBytes += chunk.byteLength;
    record.nextCursor = Math.max(record.nextCursor, chunk.cursor + 1);
    while (record.retainedBytes > this.outputLimitBytes && record.chunks.length > 0) {
      const dropped = record.chunks.shift();
      if (!dropped) break;
      record.retainedBytes -= dropped.byteLength;
      record.droppedBytes += dropped.byteLength;
    }
    record.handle.output = {
      nextCursor: record.nextCursor - 1,
      retainedFromCursor: record.chunks[0]?.cursor ?? record.nextCursor,
      observedBytes: record.observedBytes,
      retainedBytes: record.retainedBytes,
      droppedBytes: record.droppedBytes,
      truncated: record.droppedBytes > 0,
      volumeCircuitTripped: record.handle.output.volumeCircuitTripped,
    };
  }

  private acceptOutput(record: RuntimeRecord, stream: RunTerminalStream, raw: string): void {
    if (record.volumeCircuitTripped) return;
    record.observedBytes += Buffer.byteLength(raw, 'utf8');
    const volumeExceeded = record.observedBytes > this.maximumOutputBytes;
    const redacted = redactString(raw);
    for (const content of splitUtf8(redacted, this.chunkLimitBytes)) {
      const byteLength = Buffer.byteLength(content, 'utf8');
      const chunk: RunTerminalOutputChunk = {
        cursor: record.nextCursor++,
        stream,
        content,
        byteLength,
        occurredAt: this.now().toISOString(),
      };
      record.chunks.push(chunk);
      record.retainedBytes += byteLength;
      while (record.retainedBytes > this.outputLimitBytes && record.chunks.length > 0) {
        const dropped = record.chunks.shift();
        if (!dropped) break;
        record.retainedBytes -= dropped.byteLength;
        record.droppedBytes += dropped.byteLength;
      }
      this.refreshOutputMetadata(record);
      if (!volumeExceeded) {
        void this.appendEvent(record, {
          kind: stream === 'stdout' ? 'stream.stdout' : 'stream.stderr',
          payload: {
            handleId: record.handle.id,
            commandId: record.handle.commandId,
            cursor: chunk.cursor,
            content: chunk.content,
            byteLength: chunk.byteLength,
            occurredAt: chunk.occurredAt,
          },
          dedupeKey: `run-terminal:${record.handle.id}:output:${chunk.cursor}`,
        });
      }
    }
    if (volumeExceeded) {
      record.volumeCircuitTripped = true;
      this.refreshOutputMetadata(record);
      void this.appendEvent(record, {
        kind: 'run.error',
        payload: {
          handleId: record.handle.id,
          commandId: record.handle.commandId,
          code: 'terminal-output-volume-limit',
          observedBytes: record.observedBytes,
          maximumOutputBytes: this.maximumOutputBytes,
        },
        dedupeKey: `run-terminal:${record.handle.id}:volume-limit`,
      });
      void this.terminate(record.handle.id).catch((error) => {
        log.error(
          { err: error, handleId: record.handle.id },
          'Failed to terminate run terminal after output volume trip'
        );
      });
    }
  }

  private fail(record: RuntimeRecord, error: Error): void {
    if (terminal(record.handle.state)) return;
    record.handle.state = 'failed';
    record.handle.failure = redactString(error.message).slice(0, 1_000);
    record.handle.endedAt = this.now().toISOString();
    this.refreshOutputMetadata(record);
    record.resolveExit();
    this.appendCompletedEvent(record);
  }

  private close(record: RuntimeRecord, code: number | null, signal: NodeJS.Signals | null): void {
    if (!record.handle.endedAt) record.handle.endedAt = this.now().toISOString();
    if (code !== null) record.handle.exitCode = code;
    if (signal) record.handle.signal = signal;
    if (record.handle.state !== 'failed') {
      record.handle.state =
        record.handle.state === 'terminating' ? 'terminated' : code === 0 ? 'exited' : 'failed';
    }
    this.refreshOutputMetadata(record);
    record.resolveExit();
    this.appendCompletedEvent(record);
  }

  private appendEvent(
    record: RuntimeRecord,
    event: Pick<RunEventAppendInput, 'kind' | 'payload' | 'dedupeKey'>
  ): Promise<void> {
    const pending = record.journalQueue.then(async () => {
      await this.journal.append({
        workspaceId: record.context.workspaceId,
        taskId: record.context.taskId,
        attemptId: record.context.attemptId,
        kind: event.kind,
        source: {
          provider: 'system',
          adapter: 'run-terminal',
        },
        payload: event.payload,
        dedupeKey: event.dedupeKey,
      });
    });
    record.journalQueue = pending.catch((error) => {
      record.journalFailure = error instanceof Error ? error : new Error(String(error));
      log.error(
        { err: error, handleId: record.handle.id, attemptId: record.handle.attemptId },
        'Failed to append run terminal event'
      );
    });
    return pending;
  }

  private async awaitJournal(record: TerminalRecord): Promise<void> {
    await record.journalQueue;
    if (isRuntimeRecord(record) && record.journalFailure) {
      throw new InternalError('Run terminal journal evidence is incomplete.');
    }
  }

  private appendCompletedEvent(record: RuntimeRecord): void {
    if (record.completedEventQueued) return;
    record.completedEventQueued = true;
    void this.appendEvent(record, {
      kind: 'command.completed',
      payload: {
        handleId: record.handle.id,
        commandId: record.handle.commandId,
        state: record.handle.state,
        exitCode: record.handle.exitCode,
        signal: record.handle.signal,
        failure: record.handle.failure,
        output: record.handle.output,
        gracefulSignalAt: record.gracefulSignalAt,
        forceSignalAt: record.forceSignalAt,
        handle: cloneHandle(record.handle),
      },
      dedupeKey: `run-terminal:${record.handle.id}:completed`,
    });
  }

  private refreshOutputMetadata(record: RuntimeRecord): void {
    record.handle.output = {
      nextCursor: record.nextCursor - 1,
      retainedFromCursor: record.chunks[0]?.cursor ?? record.nextCursor,
      observedBytes: record.observedBytes,
      retainedBytes: record.retainedBytes,
      droppedBytes: record.droppedBytes,
      truncated: record.droppedBytes > 0,
      volumeCircuitTripped: record.volumeCircuitTripped,
    };
  }

  private require(handleId: string): TerminalRecord {
    const record = this.records.get(handleId);
    if (!record) throw new NotFoundError('Run terminal handle not found.');
    return record;
  }

  private requireRuntime(handleId: string): RuntimeRecord {
    const record = this.require(handleId);
    if (!isRuntimeRecord(record)) {
      throw new ConflictError('Run terminal process ownership is no longer attached.');
    }
    return record;
  }

  private requireMany(handleIds: string[]): TerminalRecord[] {
    const unique = [...new Set(handleIds)];
    if (unique.length === 0 || unique.length > 64 || unique.length !== handleIds.length) {
      throw new ValidationError('Terminal multi-wait requires between 1 and 64 unique handles.');
    }
    return unique.map((handleId) => this.require(handleId));
  }

  private waitManyResult(
    mode: RunTerminalWaitManyResult['mode'],
    records: TerminalRecord[],
    timedOut: boolean,
    selectedHandleId?: string
  ): RunTerminalWaitManyResult {
    const handles = records.map((record) => cloneHandle(record.handle));
    const completedHandleIds = handles
      .filter((handle) => terminal(handle.state))
      .map((handle) => handle.id);
    const pendingHandleIds = handles
      .filter((handle) => !terminal(handle.state))
      .map((handle) => handle.id);
    return {
      mode,
      completed: mode === 'any' ? completedHandleIds.length > 0 : pendingHandleIds.length === 0,
      timedOut,
      ...(selectedHandleId ? { selectedHandleId } : {}),
      completedHandleIds,
      pendingHandleIds,
      handles,
    };
  }

  private terminationResult(record: RuntimeRecord): RunTerminalTerminationResult {
    return {
      handle: cloneHandle(record.handle),
      ...(record.gracefulSignalAt ? { gracefulSignalAt: record.gracefulSignalAt } : {}),
      ...(record.forceSignalAt ? { forceSignalAt: record.forceSignalAt } : {}),
    };
  }
}

function normalizeContext(input: RunTerminalLaunchContext): RunTerminalLaunchContext {
  const workspaceId = required(input.workspaceId, 'workspaceId');
  const taskId = required(input.taskId, 'taskId');
  const attemptId = required(input.attemptId, 'attemptId');
  const launchManifestDigest = required(input.launchManifestDigest, 'launchManifestDigest');
  if (!/^sha256:[a-f0-9]{64}$/.test(launchManifestDigest)) {
    throw new ValidationError('Run terminal launch manifest digest is invalid.');
  }
  const worktreeRoot = path.resolve(required(input.worktreeRoot, 'worktreeRoot'));
  const allowedCommands = [...new Set(input.allowedCommands.map((command) => command.trim()))]
    .filter(Boolean)
    .sort();
  if (allowedCommands.length === 0) {
    throw new ConflictError('Run terminal launch context has no approved commands.');
  }
  return {
    workspaceId,
    taskId,
    attemptId,
    launchManifestDigest,
    worktreeRoot,
    environment: { ...input.environment },
    allowedCommands,
    ...(input.wrap ? { wrap: input.wrap } : {}),
  };
}

async function resolveCwd(worktreeRoot: string, requested: string | undefined): Promise<string> {
  const resolved = path.resolve(worktreeRoot, requested ?? '.');
  ensureWithinBase(worktreeRoot, resolved);
  const [canonicalRoot, canonicalCwd] = await Promise.all([
    realpath(worktreeRoot),
    realpath(resolved),
  ]);
  ensureWithinBase(canonicalRoot, canonicalCwd);
  return canonicalCwd;
}

async function resolveWrappedCwd(worktreeRoot: string, wrappedCwd: string): Promise<string> {
  const resolved = path.resolve(wrappedCwd);
  const [canonicalRoot, canonicalCwd] = await Promise.all([
    realpath(worktreeRoot),
    realpath(resolved),
  ]);
  ensureWithinBase(canonicalRoot, canonicalCwd);
  return canonicalCwd;
}

function selectEnvironment(
  approved: Record<string, string>,
  requestedKeys: string[]
): NodeJS.ProcessEnv {
  const selected: NodeJS.ProcessEnv = {};
  for (const key of [...new Set(requestedKeys)].sort()) {
    const value = approved[key];
    if (value === undefined) {
      throw new ConflictError(`Environment key ${key} is not approved by the run launch manifest.`);
    }
    selected[key] = value;
  }
  return selected;
}

function assertNoCredentialArguments(command: string, args: string[]): void {
  for (const value of [command, ...args]) {
    if (redactString(value) !== value) {
      throw new ValidationError(
        'Terminal command arguments cannot contain credential values; use a brokered reference.'
      );
    }
  }
}

function commandId(command: string, args: string[]): string {
  return `cmd_${createHash('sha256')
    .update(JSON.stringify([command, args]))
    .digest('base64url')
    .slice(0, 24)}`;
}

function digestTerminalRequest(request: RunTerminalExecuteRequest): string {
  return `sha256:${createHash('sha256')
    .update(
      JSON.stringify({
        requestId: request.requestId,
        command: request.command,
        args: request.args,
        mode: request.mode,
        startMode: request.startMode,
        cwd: request.cwd ?? '.',
        environmentKeys: [...request.environmentKeys].sort(),
      })
    )
    .digest('hex')}`;
}

function splitUtf8(value: string, maximumBytes: number): string[] {
  if (Buffer.byteLength(value, 'utf8') <= maximumBytes) return value ? [value] : [];
  const chunks: string[] = [];
  let remaining = value;
  while (remaining) {
    let end = Math.min(remaining.length, maximumBytes);
    while (end > 1 && Buffer.byteLength(remaining.slice(0, end), 'utf8') > maximumBytes) {
      end = Math.floor(end * 0.9);
    }
    const chunk = remaining.slice(0, end);
    chunks.push(chunk);
    remaining = remaining.slice(end);
  }
  return chunks;
}

function signalProcessGroup(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The group may already be gone; fall through to the exact child.
    }
  }
  child.kill(signal);
}

function cloneHandle(handle: RunTerminalHandle): RunTerminalHandle {
  return structuredClone(handle);
}

function parsePersistedHandle(value: unknown): RunTerminalHandle | null {
  if (value === undefined) return null;
  const legacy =
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).id === 'string' &&
    typeof (value as Record<string, unknown>).requestId !== 'string' &&
    typeof (value as Record<string, unknown>).requestDigest !== 'string'
      ? {
          ...(value as Record<string, unknown>),
          requestId: `legacy:${(value as Record<string, unknown>).id as string}`,
          requestDigest: `sha256:${createHash('sha256')
            .update(`legacy-run-terminal:${(value as Record<string, unknown>).id as string}`)
            .digest('hex')}`,
        }
      : value;
  const parsed = RunTerminalHandleSchema.safeParse(legacy);
  if (!parsed.success) {
    throw new ConflictError('Persisted run terminal handle is invalid.');
  }
  return parsed.data;
}

function persistedString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function assertSamePersistedHandleIdentity(
  current: RunTerminalHandle,
  next: RunTerminalHandle
): void {
  const currentIdentity = [
    current.id,
    current.workspaceId,
    current.taskId,
    current.attemptId,
    current.launchManifestDigest,
    current.requestId,
    current.requestDigest,
    current.mode,
    current.commandId,
    current.processId,
    current.processGroupId,
    current.startedAt,
    current.capabilities,
  ];
  const nextIdentity = [
    next.id,
    next.workspaceId,
    next.taskId,
    next.attemptId,
    next.launchManifestDigest,
    next.requestId,
    next.requestDigest,
    next.mode,
    next.commandId,
    next.processId,
    next.processGroupId,
    next.startedAt,
    next.capabilities,
  ];
  if (JSON.stringify(currentIdentity) !== JSON.stringify(nextIdentity)) {
    throw new ConflictError('Persisted run terminal handle identity changed during replay.', {
      handleId: current.id,
    });
  }
}

function parsePersistedChunk(event: RunEventEnvelope): RunTerminalOutputChunk | null {
  const cursor = event.payload.cursor;
  const content = persistedString(event.payload.content);
  if (!Number.isInteger(cursor) || (cursor as number) < 1 || !content) return null;
  if (Buffer.byteLength(content, 'utf8') > 64 * 1024) {
    throw new ConflictError('Persisted run terminal output chunk exceeds its byte bound.');
  }
  const occurredAtValue = persistedString(event.payload.occurredAt);
  const occurredAt =
    occurredAtValue && Number.isFinite(Date.parse(occurredAtValue))
      ? occurredAtValue
      : event.receivedAt;
  return {
    cursor: cursor as number,
    stream: event.kind === 'stream.stdout' ? 'stdout' : 'stderr',
    content,
    byteLength: Buffer.byteLength(content, 'utf8'),
    occurredAt,
  };
}

function isRuntimeRecord(record: TerminalRecord): record is RuntimeRecord {
  return 'child' in record;
}

function emptyOutputMetadata(): RunTerminalHandle['output'] {
  return {
    nextCursor: 0,
    retainedFromCursor: 1,
    observedBytes: 0,
    retainedBytes: 0,
    droppedBytes: 0,
    truncated: false,
    volumeCircuitTripped: false,
  };
}

function terminal(state: RunTerminalHandle['state']): boolean {
  return ['exited', 'failed', 'terminated', 'interrupted'].includes(state);
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new ValidationError(`Run terminal ${label} is required.`);
  return normalized;
}

function boundedPositive(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`Run terminal bound must be an integer between ${minimum} and ${maximum}.`);
  }
  return resolved;
}

function assertWaitTimeout(timeoutMs: number): void {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > MAX_WAIT_MS) {
    throw new ValidationError(`Terminal wait timeout must be between 0 and ${MAX_WAIT_MS} ms.`);
  }
}

let singleton: RunTerminalService | undefined;

export function getRunTerminalService(): RunTerminalService {
  singleton ??= new RunTerminalService();
  return singleton;
}

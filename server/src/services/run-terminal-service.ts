import { createHash } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { nanoid } from 'nanoid';
import {
  RUN_TERMINAL_HANDLE_SCHEMA_VERSION,
  RUN_TERMINAL_OUTPUT_SCHEMA_VERSION,
  type RunEventAppendInput,
  type RunTerminalCapabilityPosture,
  type RunTerminalExecuteRequest,
  type RunTerminalHandle,
  type RunTerminalOutputChunk,
  type RunTerminalOutputPage,
  type RunTerminalStream,
  type RunTerminalTerminationResult,
  type RunTerminalWaitResult,
} from '@veritas-kanban/shared';
import { createLogger } from '../lib/logger.js';
import { redactString } from '../lib/redact.js';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { RunTerminalExecuteRequestSchema } from '../schemas/run-terminal-schemas.js';
import { realpath } from '../storage/fs-helpers.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import {
  getRunEventJournalService,
  type RunEventJournalService,
} from './run-event-journal-service.js';

const log = createLogger('run-terminal-service');
const DEFAULT_OUTPUT_LIMIT_BYTES = 256 * 1024;
const DEFAULT_MAXIMUM_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_CHUNK_LIMIT_BYTES = 8 * 1024;
const DEFAULT_TERMINATION_GRACE_MS = 5_000;
const MAX_OUTPUT_PAGE_CHUNKS = 200;
const MAX_WAIT_MS = 300_000;

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
}

export interface RunTerminalServiceOptions {
  journal?: Pick<RunEventJournalService, 'append'>;
  now?: () => Date;
  outputLimitBytes?: number;
  maximumOutputBytes?: number;
  chunkLimitBytes?: number;
  terminationGraceMs?: number;
}

interface RuntimeRecord {
  context: RunTerminalLaunchContext;
  handle: RunTerminalHandle;
  child: ChildProcessWithoutNullStreams;
  chunks: RunTerminalOutputChunk[];
  retainedBytes: number;
  droppedBytes: number;
  observedBytes: number;
  nextCursor: number;
  exit: Promise<void>;
  resolveExit(): void;
  journalQueue: Promise<void>;
  gracefulSignalAt?: string;
  forceSignalAt?: string;
  completedEventQueued: boolean;
  volumeCircuitTripped: boolean;
}

export class RunTerminalService {
  private readonly journal: Pick<RunEventJournalService, 'append'>;
  private readonly now: () => Date;
  private readonly outputLimitBytes: number;
  private readonly maximumOutputBytes: number;
  private readonly chunkLimitBytes: number;
  private readonly terminationGraceMs: number;
  private readonly records = new Map<string, RuntimeRecord>();

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
      64 * 1024
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
    if (request.mode !== 'pipe') {
      throw new ConflictError('PTY mode is not supported by the current run terminal runtime.', {
        mode: request.mode,
        capability: CAPABILITIES.pty,
      });
    }
    if (request.startMode !== 'background') {
      throw new ConflictError(
        'Foreground-to-background handoff is not supported by the current run terminal runtime.',
        {
          startMode: request.startMode,
        }
      );
    }
    if (!context.allowedCommands.includes(request.command)) {
      throw new ConflictError('Terminal command is not approved by the run launch manifest.', {
        commandId: commandId(request.command, request.args),
      });
    }
    assertNoCredentialArguments(request.command, request.args);
    const cwd = await resolveCwd(context.worktreeRoot, request.cwd);
    const environment = selectEnvironment(context.environment, request.environmentKeys);
    const id = `terminal_${nanoid(18)}`;
    const startedAt = this.now().toISOString();
    const child = spawn(request.command, request.args, {
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
    this.appendEvent(record, {
      kind: 'command.started',
      payload: {
        handleId: id,
        commandId: handle.commandId,
        mode: request.mode,
        startMode: request.startMode,
      },
      dedupeKey: `run-terminal:${id}:started`,
    });
    return cloneHandle(record.handle);
  }

  get(handleId: string): RunTerminalHandle {
    return cloneHandle(this.require(handleId).handle);
  }

  list(attemptId: string): RunTerminalHandle[] {
    return [...this.records.values()]
      .filter((record) => record.handle.attemptId === attemptId)
      .map((record) => cloneHandle(record.handle))
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  }

  output(
    handleId: string,
    afterCursor = 0,
    limit = MAX_OUTPUT_PAGE_CHUNKS
  ): RunTerminalOutputPage {
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
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > MAX_WAIT_MS) {
      throw new ValidationError(`Terminal wait timeout must be between 0 and ${MAX_WAIT_MS} ms.`);
    }
    const record = this.require(handleId);
    if (terminal(record.handle.state)) {
      await record.journalQueue;
      return { completed: true, timedOut: false, handle: cloneHandle(record.handle) };
    }
    if (timeoutMs === 0) {
      return { completed: false, timedOut: true, handle: cloneHandle(record.handle) };
    }
    let timer: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
      record.exit.then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), timeoutMs);
        timer.unref();
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (!timedOut) await record.journalQueue;
    return {
      completed: !timedOut,
      timedOut,
      handle: cloneHandle(record.handle),
    };
  }

  async terminate(handleId: string): Promise<RunTerminalTerminationResult> {
    const record = this.require(handleId);
    if (terminal(record.handle.state)) {
      return this.terminationResult(record);
    }
    record.handle.state = 'terminating';
    record.gracefulSignalAt = this.now().toISOString();
    signalProcessGroup(record.child, 'SIGTERM');
    const graceful = await this.wait(handleId, this.terminationGraceMs);
    if (!graceful.completed && !terminal(record.handle.state)) {
      record.forceSignalAt = this.now().toISOString();
      signalProcessGroup(record.child, 'SIGKILL');
      await record.exit;
    }
    return this.terminationResult(record);
  }

  async cleanupAttempt(attemptId: string): Promise<RunTerminalTerminationResult[]> {
    const results: RunTerminalTerminationResult[] = [];
    for (const record of this.records.values()) {
      if (record.handle.attemptId !== attemptId || terminal(record.handle.state)) continue;
      results.push(await this.terminate(record.handle.id));
    }
    return results;
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
      while (
        record.retainedBytes > this.outputLimitBytes &&
        record.chunks.length > 0
      ) {
        const dropped = record.chunks.shift();
        if (!dropped) break;
        record.retainedBytes -= dropped.byteLength;
        record.droppedBytes += dropped.byteLength;
      }
      this.refreshOutputMetadata(record);
      if (!volumeExceeded) {
        this.appendEvent(record, {
          kind: stream === 'stdout' ? 'stream.stdout' : 'stream.stderr',
          payload: {
            handleId: record.handle.id,
            commandId: record.handle.commandId,
            cursor: chunk.cursor,
            content: chunk.content,
            byteLength: chunk.byteLength,
          },
          dedupeKey: `run-terminal:${record.handle.id}:output:${chunk.cursor}`,
        });
      }
    }
    if (volumeExceeded) {
      record.volumeCircuitTripped = true;
      this.refreshOutputMetadata(record);
      this.appendEvent(record, {
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
        record.handle.state === 'terminating'
          ? 'terminated'
          : code === 0
            ? 'exited'
            : 'failed';
    }
    this.refreshOutputMetadata(record);
    record.resolveExit();
    this.appendCompletedEvent(record);
  }

  private appendEvent(
    record: RuntimeRecord,
    event: Pick<RunEventAppendInput, 'kind' | 'payload' | 'dedupeKey'>
  ): void {
    record.journalQueue = record.journalQueue
      .then(async () => {
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
      })
      .catch((error) => {
        log.error(
          { err: error, handleId: record.handle.id, attemptId: record.handle.attemptId },
          'Failed to append run terminal event'
        );
      });
  }

  private appendCompletedEvent(record: RuntimeRecord): void {
    if (record.completedEventQueued) return;
    record.completedEventQueued = true;
    this.appendEvent(record, {
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

  private require(handleId: string): RuntimeRecord {
    const record = this.records.get(handleId);
    if (!record) throw new NotFoundError('Run terminal handle not found.');
    return record;
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

function selectEnvironment(
  approved: Record<string, string>,
  requestedKeys: string[]
): NodeJS.ProcessEnv {
  const selected: NodeJS.ProcessEnv = {};
  for (const key of [...new Set(requestedKeys)].sort()) {
    const value = approved[key];
    if (value === undefined) {
      throw new ConflictError(
        `Environment key ${key} is not approved by the run launch manifest.`
      );
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

function signalProcessGroup(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals
): void {
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
  return ['exited', 'failed', 'terminated'].includes(state);
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

let singleton: RunTerminalService | undefined;

export function getRunTerminalService(): RunTerminalService {
  singleton ??= new RunTerminalService();
  return singleton;
}

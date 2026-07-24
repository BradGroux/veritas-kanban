import { Buffer } from 'node:buffer';
import path from 'node:path';
import readline from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { Command } from 'commander';
import type {
  AcpContentBlock,
  AcpJsonRpcId,
  AcpJsonRpcMessage,
  AcpPromptResponse,
  ClientAuthContext,
  RunApprovalRequest,
  RunEventEnvelope,
  RunEventPage,
  Task,
  TaskAttempt,
} from '@veritas-kanban/shared';
import { ACP_PROTOCOL_VERSION } from '@veritas-kanban/shared';
import { api } from '../utils/api.js';

const MAX_PROTOCOL_LINE_BYTES = 1024 * 1024;
const DEFAULT_POLL_INTERVAL_MS = 250;
const ACP_SERVER_NAME = 'Veritas Kanban';
const ACP_SERVER_VERSION = '6.0.0';

export const ACP_SERVER_METHODS = [
  'initialize',
  'session/new',
  'session/load',
  'session/resume',
  'session/prompt',
  'session/cancel',
] as const;

export type AcpApiClient = <T>(requestPath: string, options?: RequestInit) => Promise<T>;

export interface AcpServerViewOptions {
  api?: AcpApiClient;
  write: (record: AcpJsonRpcMessage) => void;
  boundTaskId?: string;
  agent?: string;
  profileId?: string;
  pollIntervalMs?: number;
  now?: () => number;
}

interface ViewSession {
  sessionId: string;
  taskId: string;
  cwd: string;
  attemptId?: string;
  cursor: number;
  busy: boolean;
}

interface MethodOutcome {
  result: unknown;
  afterResponse?: () => Promise<void>;
}

interface PendingClientRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface AcpStatus {
  schemaVersion: 'veritas-acp-server-status/v1';
  protocolVersion: typeof ACP_PROTOCOL_VERSION;
  transport: 'stdio';
  ready: boolean;
  methods: readonly string[];
  durableRuns: true;
  providerNeutral: true;
  role?: string;
  workspaceId?: string;
  error?: string;
}

export class AcpServerView {
  private readonly apiClient: AcpApiClient;
  private readonly writeRecord: (record: AcpJsonRpcMessage) => void;
  private readonly boundTaskId?: string;
  private readonly agent?: string;
  private readonly profileId?: string;
  private readonly pollIntervalMs: number;
  private readonly now: () => number;
  private readonly sessions = new Map<string, ViewSession>();
  private readonly pendingClientRequests = new Map<string | number, PendingClientRequest>();
  private nextClientRequestId = 1;
  private disconnected = false;

  constructor(options: AcpServerViewOptions) {
    this.apiClient = options.api ?? api;
    this.writeRecord = (record) => {
      if (!this.disconnected) options.write(record);
    };
    this.boundTaskId = options.boundTaskId;
    this.agent = options.agent;
    this.profileId = options.profileId;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.now = options.now ?? Date.now;
  }

  disconnect(): void {
    this.disconnected = true;
    for (const pending of this.pendingClientRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('ACP client disconnected.'));
    }
    this.pendingClientRequests.clear();
  }

  async acceptLine(line: string): Promise<void> {
    if (Buffer.byteLength(line, 'utf8') > MAX_PROTOCOL_LINE_BYTES) {
      this.writeError(null, -32600, 'ACP record exceeds the 1 MiB limit.');
      return;
    }
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      this.writeError(null, -32700, 'Invalid JSON.');
      return;
    }
    if (!isRecord(record) || record.jsonrpc !== '2.0') {
      this.writeError(null, -32600, 'Invalid JSON-RPC record.');
      return;
    }
    if ('result' in record || 'error' in record) {
      this.acceptClientResponse(record);
      return;
    }
    if (typeof record.method !== 'string') {
      this.writeError(
        validId(record.id) ? record.id : null,
        -32600,
        'JSON-RPC method is required.'
      );
      return;
    }
    const id = validId(record.id) ? record.id : undefined;
    if (id === undefined) {
      await this.handleNotification(record.method, record.params);
      return;
    }
    await this.handleRequest(id, record.method, record.params);
  }

  private async handleRequest(id: AcpJsonRpcId, method: string, params: unknown): Promise<void> {
    try {
      const outcome = await this.dispatch(method, params);
      this.writeRecord({ jsonrpc: '2.0', id, result: outcome.result });
      if (outcome.afterResponse) void outcome.afterResponse();
    } catch (error) {
      const rpcError = error instanceof AcpViewError ? error : AcpViewError.internal(error);
      this.writeError(id, rpcError.code, rpcError.message, rpcError.data);
    }
  }

  private async handleNotification(method: string, params: unknown): Promise<void> {
    if (method !== 'session/cancel') return;
    try {
      const input = requiredRecord(params, 'session/cancel params');
      const session = this.requireSession(requiredString(input.sessionId, 'sessionId'));
      if (!session.attemptId) return;
      await this.apiClient(
        `/api/agents/${encodeURIComponent(session.taskId)}/conversation/interrupt`,
        {
          method: 'POST',
          body: JSON.stringify({ attemptId: session.attemptId }),
        }
      );
    } catch {
      // Notifications have no response. Durable run state remains authoritative.
    }
  }

  private async dispatch(method: string, params: unknown): Promise<MethodOutcome> {
    switch (method) {
      case 'initialize':
        return this.initialize(params);
      case 'session/new':
        return this.newSession(params);
      case 'session/load':
      case 'session/resume':
        return this.loadSession(params);
      case 'session/prompt':
        return this.prompt(params);
      default:
        throw new AcpViewError(-32601, `Unsupported ACP method: ${method}`);
    }
  }

  private async initialize(params: unknown): Promise<MethodOutcome> {
    const input = requiredRecord(params, 'initialize params');
    if (input.protocolVersion !== ACP_PROTOCOL_VERSION) {
      throw new AcpViewError(-32602, 'Unsupported ACP protocol version.', {
        expected: ACP_PROTOCOL_VERSION,
        received: input.protocolVersion,
      });
    }
    await this.apiClient<ClientAuthContext>('/api/auth/context');
    return {
      result: {
        protocolVersion: ACP_PROTOCOL_VERSION,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: false, audio: false, embeddedContext: false },
          mcpCapabilities: { http: false, sse: false },
          sessionCapabilities: { resume: {} },
        },
        agentInfo: {
          name: ACP_SERVER_NAME,
          title: ACP_SERVER_NAME,
          version: ACP_SERVER_VERSION,
        },
        _meta: {
          'veritas/providerNeutral': true,
          'veritas/durableRuns': true,
          'veritas/supportedMethods': ACP_SERVER_METHODS,
        },
      },
    };
  }

  private async newSession(params: unknown): Promise<MethodOutcome> {
    const input = requiredRecord(params, 'session/new params');
    rejectClientMcp(input.mcpServers);
    const metadata = optionalRecord(input._meta);
    const taskReference =
      this.boundTaskId ??
      optionalString(metadata['veritas/taskId']) ??
      optionalString(metadata.veritasTaskId);
    if (!taskReference) {
      throw new AcpViewError(
        -32602,
        'Bind the server with --task or pass _meta["veritas/taskId"].'
      );
    }
    const task = await this.resolveTask(taskReference);
    const cwd = requiredString(input.cwd, 'cwd');
    this.assertTaskWorktree(task, cwd);
    const sessionId = sessionIdForTask(task.id);
    this.sessions.set(sessionId, {
      sessionId,
      taskId: task.id,
      cwd,
      cursor: 0,
      busy: false,
    });
    return {
      result: {
        sessionId,
        _meta: { 'veritas/taskId': task.id },
      },
    };
  }

  private async loadSession(params: unknown): Promise<MethodOutcome> {
    const input = requiredRecord(params, 'session/load params');
    rejectClientMcp(input.mcpServers);
    const sessionId = requiredString(input.sessionId, 'sessionId');
    const taskId = taskIdFromSession(sessionId);
    if (this.boundTaskId) {
      const boundTask = await this.resolveTask(this.boundTaskId);
      if (boundTask.id !== taskId) {
        throw new AcpViewError(-32003, 'ACP session is outside the bound task scope.');
      }
    }
    const task = await this.resolveTask(taskId);
    const cwd = requiredString(input.cwd, 'cwd');
    this.assertTaskWorktree(task, cwd);
    const metadata = optionalRecord(input._meta);
    const requestedAttemptId = optionalString(metadata['veritas/attemptId']);
    const attempt = requestedAttemptId
      ? findTaskAttempt(task, requestedAttemptId)
      : latestTaskAttempt(task);
    if (requestedAttemptId && !attempt) {
      throw new AcpViewError(-32602, 'Requested Veritas attempt was not found.');
    }
    const afterSequence = optionalNonNegativeInteger(metadata['veritas/afterSequence']) ?? 0;
    const session: ViewSession = {
      sessionId,
      taskId: task.id,
      cwd,
      attemptId: attempt?.id,
      cursor: afterSequence,
      busy: false,
    };
    this.sessions.set(sessionId, session);
    return {
      result: {},
      ...(attempt
        ? {
            afterResponse: async () => {
              await this.replayAvailable(session);
            },
          }
        : {}),
    };
  }

  private async prompt(params: unknown): Promise<MethodOutcome> {
    const input = requiredRecord(params, 'session/prompt params');
    const session = this.requireSession(requiredString(input.sessionId, 'sessionId'));
    if (session.busy) throw new AcpViewError(-32004, 'An ACP prompt is already active.');
    const message = promptText(input.prompt);
    session.busy = true;
    try {
      const task = await this.resolveTask(session.taskId);
      this.assertTaskWorktree(task, session.cwd);
      const status = await this.apiClient<{ running: boolean; attemptId?: string }>(
        `/api/agents/${encodeURIComponent(task.id)}/status`
      );
      if (status.running) {
        throw new AcpViewError(-32004, 'The scoped Veritas task already has an active turn.', {
          attemptId: status.attemptId,
        });
      }
      const source = session.attemptId
        ? findTaskAttempt(task, session.attemptId)
        : latestTaskAttempt(task);
      const result = source?.conversation
        ? await this.apiClient<{ attemptId: string }>(
            `/api/agents/${encodeURIComponent(task.id)}/conversation/follow-up`,
            {
              method: 'POST',
              body: JSON.stringify({
                sourceAttemptId: source.id,
                message,
                profileId: this.profileId,
              }),
            }
          )
        : await this.apiClient<{ attemptId: string }>(
            `/api/agents/${encodeURIComponent(task.id)}/conversation/fresh`,
            {
              method: 'POST',
              body: JSON.stringify({
                message,
                agent: this.profileId ? undefined : this.agent,
                profileId: this.profileId,
              }),
            }
          );
      session.attemptId = result.attemptId;
      session.cursor = 0;
      const response = await this.streamUntilTerminal(session);
      return { result: response };
    } finally {
      session.busy = false;
    }
  }

  private async streamUntilTerminal(session: ViewSession): Promise<AcpPromptResponse> {
    for (;;) {
      if (this.disconnected) {
        throw new AcpViewError(-32006, 'ACP client disconnected from the durable run.');
      }
      const page = await this.readEvents(session);
      for (const event of page.events) {
        const terminal = await this.projectEvent(session, event);
        session.cursor = Math.max(session.cursor, event.sequence);
        if (terminal) return terminal;
      }
      if (page.hasMore) continue;
      await delay(this.pollIntervalMs);
    }
  }

  private async replayAvailable(session: ViewSession): Promise<void> {
    if (!session.attemptId) return;
    for (;;) {
      if (this.disconnected) return;
      const page = await this.readEvents(session);
      for (const event of page.events) {
        await this.projectEvent(session, event);
        session.cursor = Math.max(session.cursor, event.sequence);
      }
      if (!page.hasMore) return;
    }
  }

  private readEvents(session: ViewSession): Promise<RunEventPage> {
    if (!session.attemptId) throw new AcpViewError(-32002, 'ACP session has no Veritas attempt.');
    const query = new URLSearchParams({
      afterSequence: String(session.cursor),
      limit: '250',
    });
    return this.apiClient<RunEventPage>(
      `/api/agents/${encodeURIComponent(session.taskId)}/attempts/${encodeURIComponent(
        session.attemptId
      )}/events?${query.toString()}`
    );
  }

  private async projectEvent(
    session: ViewSession,
    event: RunEventEnvelope
  ): Promise<AcpPromptResponse | undefined> {
    if (event.kind === 'approval.requested') {
      await this.relayApproval(session, event);
      return undefined;
    }
    const update = eventToSessionUpdate(event);
    if (update) {
      this.writeRecord({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: session.sessionId,
          update,
          _meta: {
            'veritas/eventId': event.eventId,
            'veritas/sequence': event.sequence,
          },
        },
      });
    }
    if (event.kind === 'run.completed') {
      return {
        stopReason: 'end_turn',
        ...(event.payload.usage ? { usage: event.payload.usage } : {}),
        _meta: { 'veritas/eventId': event.eventId, 'veritas/sequence': event.sequence },
      };
    }
    if (event.kind === 'run.interrupted') {
      return {
        stopReason: 'cancelled',
        _meta: { 'veritas/eventId': event.eventId, 'veritas/sequence': event.sequence },
      };
    }
    if (event.kind === 'run.failed') {
      return {
        stopReason: 'refusal',
        _meta: { 'veritas/eventId': event.eventId, 'veritas/sequence': event.sequence },
      };
    }
    return undefined;
  }

  private async relayApproval(session: ViewSession, event: RunEventEnvelope): Promise<void> {
    const approvalId = optionalString(event.payload.approvalId);
    if (!approvalId) throw new AcpViewError(-32005, 'Approval event is missing its durable ID.');
    const approval = await this.apiClient<RunApprovalRequest>(
      `/api/run-approvals/${encodeURIComponent(approvalId)}`
    );
    const expiresIn = Math.max(1, Date.parse(approval.expiresAt) - this.now());
    let response: unknown;
    let timedOut = false;
    try {
      response = await this.requestClient(
        'session/request_permission',
        {
          sessionId: session.sessionId,
          toolCall: {
            toolCallId: approval.providerRequestId,
            title: approval.action,
            name: approval.actionClass,
            kind: approval.actionClass,
            status: 'pending',
            rawInput: {
              details: approval.details,
              resourceScope: approval.resourceScope,
              riskClass: approval.riskClass,
              policyReason: approval.policyReason,
            },
          },
          options: [
            { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
          ],
        },
        expiresIn
      );
    } catch {
      timedOut = true;
    }
    const outcome = optionalRecord(optionalRecord(response).outcome);
    const selected = optionalString(outcome.outcome);
    const selectedOption = optionalString(outcome.optionId);
    const approved = selected === 'selected' && selectedOption === 'allow_once';
    await this.apiClient(`/api/run-approvals/${encodeURIComponent(approval.id)}/decision`, {
      method: 'POST',
      body: JSON.stringify({
        decision: approved ? 'approved' : 'rejected',
        expectedRevision: approval.revision,
        expectedActionHash: approval.actionHash,
        note: timedOut
          ? 'ACP client permission request timed out.'
          : approved
            ? 'ACP client selected allow once.'
            : 'ACP client denied or cancelled the request.',
      }),
    });
  }

  private requestClient(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = `vk-client-${this.nextClientRequestId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingClientRequests.delete(id);
        reject(new Error('ACP client request timed out.'));
      }, timeoutMs);
      this.pendingClientRequests.set(id, { resolve, reject, timer });
      this.writeRecord({ jsonrpc: '2.0', id, method, params });
    });
  }

  private acceptClientResponse(record: Record<string, unknown>): void {
    if (!validId(record.id)) return;
    const pending = this.pendingClientRequests.get(record.id);
    if (!pending) return;
    this.pendingClientRequests.delete(record.id);
    clearTimeout(pending.timer);
    if (isRecord(record.error)) {
      pending.reject(
        new Error(optionalString(record.error.message) ?? 'ACP client request failed.')
      );
      return;
    }
    pending.resolve(record.result);
  }

  private async resolveTask(reference: string): Promise<Task> {
    const tasks = await this.apiClient<Task[]>('/api/tasks');
    const exact = tasks.find((task) => task.id === reference);
    const suffixMatches = exact ? [] : tasks.filter((task) => task.id.endsWith(reference));
    const task = exact ?? (suffixMatches.length === 1 ? suffixMatches[0] : undefined);
    if (!task) {
      throw new AcpViewError(
        -32003,
        suffixMatches.length > 1 ? 'Task reference is ambiguous.' : 'Task was not found.'
      );
    }
    return task;
  }

  private assertTaskWorktree(task: Task, cwd: string): void {
    const worktree = task.git?.worktreePath;
    if (!worktree) throw new AcpViewError(-32003, 'Task has no active worktree.');
    if (path.resolve(worktree) !== path.resolve(cwd)) {
      throw new AcpViewError(-32003, 'ACP cwd does not match the task worktree.');
    }
  }

  private requireSession(sessionId: string): ViewSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new AcpViewError(-32002, 'ACP session is not loaded in this process.');
    return session;
  }

  private writeError(id: AcpJsonRpcId | null, code: number, message: string, data?: unknown): void {
    this.writeRecord({
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        ...(data === undefined ? {} : { data }),
      },
    });
  }
}

export async function readAcpStatus(apiClient: AcpApiClient = api): Promise<AcpStatus> {
  try {
    const context = await apiClient<ClientAuthContext>('/api/auth/context');
    return {
      schemaVersion: 'veritas-acp-server-status/v1',
      protocolVersion: ACP_PROTOCOL_VERSION,
      transport: 'stdio',
      ready: true,
      methods: ACP_SERVER_METHODS,
      durableRuns: true,
      providerNeutral: true,
      role: context.role,
      workspaceId: context.workspaceId,
    };
  } catch (error) {
    return {
      schemaVersion: 'veritas-acp-server-status/v1',
      protocolVersion: ACP_PROTOCOL_VERSION,
      transport: 'stdio',
      ready: false,
      methods: ACP_SERVER_METHODS,
      durableRuns: true,
      providerNeutral: true,
      error: boundedError(error),
    };
  }
}

export function runAcpStdioServer(options: {
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
  boundTaskId?: string;
  agent?: string;
  profileId?: string;
  api?: AcpApiClient;
  pollIntervalMs?: number;
}): void {
  const input = options.stdin ?? process.stdin;
  const output = options.stdout ?? process.stdout;
  const errors = options.stderr ?? process.stderr;
  const server = new AcpServerView({
    ...(options.api ? { api: options.api } : {}),
    boundTaskId: options.boundTaskId,
    agent: options.agent,
    profileId: options.profileId,
    pollIntervalMs: options.pollIntervalMs,
    write: (record) => {
      output.write(`${JSON.stringify(record)}\n`);
    },
  });
  input.setEncoding('utf8');
  const lines = readline.createInterface({ input });
  lines.on('line', (line) => {
    void server.acceptLine(line);
  });
  lines.on('error', (error) => {
    errors.write(`ACP stdio input failed: ${boundedError(error)}\n`);
  });
  lines.on('close', () => {
    server.disconnect();
  });
}

export function registerAcpCommands(program: Command): void {
  const acp = program.command('acp').description('Agent Client Protocol server view');
  acp
    .command('status')
    .description('Report ACP server-view readiness')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const status = await readAcpStatus();
      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log(
          `${status.ready ? 'ready' : 'not ready'}: ACP v${status.protocolVersion} over ${status.transport}`
        );
        if (status.error) console.error(status.error);
      }
      if (!status.ready) process.exitCode = 1;
    });

  acp
    .command('serve')
    .description('Serve the provider-neutral Veritas ACP view over stdio')
    .requiredOption('--stdio', 'Use newline-delimited JSON-RPC over stdio')
    .option('--task <taskId>', 'Bind this process to one Veritas task')
    .option('--agent <agent>', 'Agent for a fresh scoped conversation')
    .option('--profile <profileId>', 'Agent profile for a fresh scoped conversation')
    .action(
      (options: { stdio: boolean; task?: string; agent?: string; profile?: string }): void => {
        runAcpStdioServer({
          boundTaskId: options.task,
          agent: options.agent,
          profileId: options.profile,
        });
      }
    );
}

function eventToSessionUpdate(event: RunEventEnvelope): Record<string, unknown> | undefined {
  const summary = eventSummary(event);
  switch (event.kind) {
    case 'message.delta':
      return {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: summary },
      };
    case 'reasoning.delta':
      return {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: summary },
      };
    case 'tool.started':
      return {
        sessionUpdate: 'tool_call',
        toolCallId: event.itemId ?? event.eventId,
        title: summary,
        kind: optionalString(event.payload.actionClass) ?? 'other',
        status: 'in_progress',
        rawInput: event.payload.input,
      };
    case 'tool.completed':
      return {
        sessionUpdate: 'tool_call_update',
        toolCallId: event.itemId ?? event.eventId,
        status: event.payload.success === false ? 'failed' : 'completed',
        content: summary ? [{ type: 'content', content: { type: 'text', text: summary } }] : [],
      };
    case 'progress':
      return {
        sessionUpdate: 'plan',
        entries: [{ content: summary, priority: 'medium', status: 'in_progress' }],
      };
    case 'approval.resolved':
      return {
        sessionUpdate: 'tool_call_update',
        toolCallId: optionalString(event.payload.approvalId) ?? event.eventId,
        status: event.payload.status === 'approved' ? 'completed' : 'failed',
        content: summary ? [{ type: 'content', content: { type: 'text', text: summary } }] : [],
      };
    case 'run.failed':
      return summary
        ? {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: summary },
          }
        : undefined;
    default:
      return undefined;
  }
}

function eventSummary(event: RunEventEnvelope): string {
  return (
    optionalString(event.payload.summary) ??
    optionalString(event.payload.message) ??
    optionalString(event.payload.error) ??
    ''
  );
}

function promptText(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AcpViewError(-32602, 'session/prompt requires at least one text block.');
  }
  const blocks = value as AcpContentBlock[];
  const unsupported = blocks.find((block) => !isRecord(block) || block.type !== 'text');
  if (unsupported) {
    throw new AcpViewError(-32602, 'The Veritas ACP server view accepts text prompts only.');
  }
  const text = blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
    .trim();
  if (!text || text.length > 20_000) {
    throw new AcpViewError(-32602, 'ACP prompt must contain 1 to 20,000 text characters.');
  }
  return text;
}

function rejectClientMcp(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new AcpViewError(-32602, 'mcpServers must be an array.');
  if (value.length > 0) {
    throw new AcpViewError(
      -32003,
      'ACP clients cannot override the immutable Veritas run tool catalog.'
    );
  }
}

function sessionIdForTask(taskId: string): string {
  return `vkacp_${Buffer.from(taskId, 'utf8').toString('base64url')}`;
}

function taskIdFromSession(sessionId: string): string {
  if (!/^vkacp_[A-Za-z0-9_-]+$/.test(sessionId)) {
    throw new AcpViewError(-32602, 'Invalid Veritas ACP session ID.');
  }
  try {
    const taskId = Buffer.from(sessionId.slice('vkacp_'.length), 'base64url').toString('utf8');
    if (!taskId || Buffer.byteLength(taskId, 'utf8') > 200) throw new Error('invalid');
    return taskId;
  } catch {
    throw new AcpViewError(-32602, 'Invalid Veritas ACP session ID.');
  }
}

function latestTaskAttempt(task: Task): TaskAttempt | undefined {
  const attempts = [task.attempt, ...(task.attempts ?? [])].filter(
    (attempt): attempt is TaskAttempt => Boolean(attempt)
  );
  return attempts.sort((left, right) => {
    const leftTime = Date.parse(left.started ?? left.ended ?? '') || 0;
    const rightTime = Date.parse(right.started ?? right.ended ?? '') || 0;
    return rightTime - leftTime;
  })[0];
}

function findTaskAttempt(task: Task, attemptId: string): TaskAttempt | undefined {
  return [task.attempt, ...(task.attempts ?? [])]
    .filter((attempt): attempt is TaskAttempt => Boolean(attempt))
    .find((attempt) => attempt.id === attemptId);
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new AcpViewError(-32602, `${label} must be an object.`);
  return value;
}

function optionalRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function requiredString(value: unknown, label: string): string {
  const result = optionalString(value);
  if (!result) throw new AcpViewError(-32602, `${label} must be a non-empty string.`);
  return result;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validId(value: unknown): value is AcpJsonRpcId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, 1_000);
}

class AcpViewError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown
  ) {
    super(message);
  }

  static internal(error: unknown): AcpViewError {
    return new AcpViewError(-32000, boundedError(error));
  }
}

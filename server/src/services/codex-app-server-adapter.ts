import { Ajv, type ValidateFunction } from 'ajv';
import type { SandboxPolicyDryRunResult } from '@veritas-kanban/shared';
import clientNotificationSchema from '../contracts/codex-app-server-v0.145.0/ClientNotification.json' with { type: 'json' };
import clientRequestSchema from '../contracts/codex-app-server-v0.145.0/ClientRequest.json' with { type: 'json' };
import jsonRpcErrorSchema from '../contracts/codex-app-server-v0.145.0/JSONRPCError.json' with { type: 'json' };
import jsonRpcResponseSchema from '../contracts/codex-app-server-v0.145.0/JSONRPCResponse.json' with { type: 'json' };
import serverNotificationSchema from '../contracts/codex-app-server-v0.145.0/ServerNotification.json' with { type: 'json' };
import serverRequestSchema from '../contracts/codex-app-server-v0.145.0/ServerRequest.json' with { type: 'json' };
import initializeResponseSchema from '../contracts/codex-app-server-v0.145.0/v1/InitializeResponse.json' with { type: 'json' };
import threadStartResponseSchema from '../contracts/codex-app-server-v0.145.0/v2/ThreadStartResponse.json' with { type: 'json' };
import turnInterruptResponseSchema from '../contracts/codex-app-server-v0.145.0/v2/TurnInterruptResponse.json' with { type: 'json' };
import turnStartResponseSchema from '../contracts/codex-app-server-v0.145.0/v2/TurnStartResponse.json' with { type: 'json' };
import { buildSafeCodexEnv } from '../utils/codex-env.js';

export const CODEX_APP_SERVER_CERTIFIED_VERSION = 'codex-cli 0.145.0';
export const CODEX_APP_SERVER_CERTIFIED_BUILD =
  'openai/codex@25af12f7e61572b0bc18ddb1008be543b91519b0;schema-set:21378ac910dd6408502cde3ff421a5014bbc0b9c4ae191ce95debe74f43c40bc';
export const CODEX_APP_SERVER_PROTOCOL_VERSION = 'codex-app-server-jsonrpc/v2';
export const CODEX_APP_SERVER_MAX_RECORD_BYTES = 4 * 1024 * 1024;
export const CODEX_APP_SERVER_OVERLOAD_ERROR = -32_001;

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_OVERLOAD_ATTEMPTS = 3;
const OVERLOAD_BASE_DELAY_MS = 100;
const OVERLOAD_MAX_DELAY_MS = 1_000;
const MAX_SUMMARY_LENGTH = 8_000;
const MAX_IDENTIFIER_LENGTH = 256;

export const CODEX_APP_SERVER_OUTBOUND_METHODS = [
  'initialize',
  'thread/start',
  'turn/start',
  'turn/interrupt',
] as const;

export type CodexAppServerOutboundMethod = (typeof CODEX_APP_SERVER_OUTBOUND_METHODS)[number];

const OUTBOUND_METHOD_SET = new Set<string>(CODEX_APP_SERVER_OUTBOUND_METHODS);
const ajv = new Ajv({
  allErrors: true,
  strict: false,
  validateFormats: false,
});
const validateClientRequest = ajv.compile(clientRequestSchema as object);
const validateClientNotification = ajv.compile(clientNotificationSchema as object);
const validateServerNotification = ajv.compile(serverNotificationSchema as object);
const validateServerRequest = ajv.compile(serverRequestSchema as object);
const validateJsonRpcResponse = ajv.compile(jsonRpcResponseSchema as object);
const validateJsonRpcError = ajv.compile(jsonRpcErrorSchema as object);
const responseValidators: Record<CodexAppServerOutboundMethod, ValidateFunction<unknown>> = {
  initialize: ajv.compile(initializeResponseSchema as object),
  'thread/start': ajv.compile(threadStartResponseSchema as object),
  'turn/start': ajv.compile(turnStartResponseSchema as object),
  'turn/interrupt': ajv.compile(turnInterruptResponseSchema as object),
};

export interface CodexAppServerThreadInput {
  cwd: string;
  model?: string;
  sandboxMode: SandboxPolicyDryRunResult['effective']['sandboxMode'];
}

export interface CodexAppServerTurnInput {
  threadId: string;
  prompt: string;
  cwd: string;
  model?: string;
}

export interface CodexAppServerUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CodexAppServerTerminalResult {
  success: boolean;
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress' | 'unknown';
  error?: string;
}

export interface CodexAppServerClassification {
  providerType: string;
  summary?: string;
  sessionId?: string;
  turnId?: string;
  itemId?: string;
  files: string[];
  usage?: CodexAppServerUsage;
  terminal?: CodexAppServerTerminalResult;
}

export interface CodexAppServerInbound {
  kind: 'notification' | 'server-request' | 'response';
  method: string;
  record: Record<string, unknown>;
  denied?: boolean;
}

export interface CodexAppServerRpcClientOptions {
  write(line: string): void;
  requestTimeoutMs?: number;
  overloadAttempts?: number;
  sleep?: (delayMs: number) => Promise<void>;
  random?: () => number;
  onOverloadRetry?: (
    method: CodexAppServerOutboundMethod,
    attempt: number,
    delayMs: number
  ) => void;
}

interface PendingRpcRequest {
  method: CodexAppServerOutboundMethod;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export class CodexAppServerRpcError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly data?: unknown
  ) {
    super(message);
    this.name = 'CodexAppServerRpcError';
  }
}

export function buildCodexAppServerArgs(extraArgs: string[] = []): string[] {
  if (extraArgs.length > 0) {
    throw new Error(
      'Codex app-server launch arguments are system-owned; configure model and policy through Veritas fields.'
    );
  }
  return [
    'app-server',
    '--stdio',
    '--strict-config',
    '-c',
    'mcp_servers={}',
    '-c',
    'hooks={}',
    '--disable',
    'plugins',
    '--disable',
    'apps',
    '--disable',
    'in_app_browser',
    '--disable',
    'computer_use',
    '--disable',
    'tool_call_mcp_elicitation',
  ];
}

export function buildSafeCodexAppServerEnv(
  source: NodeJS.ProcessEnv = process.env,
  passthroughKeys?: Iterable<string>
): Record<string, string> {
  return {
    ...buildSafeCodexEnv(source, passthroughKeys),
    CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: '1',
  };
}

export function isCodexAppServerOutboundMethod(
  value: string
): value is CodexAppServerOutboundMethod {
  return OUTBOUND_METHOD_SET.has(value);
}

export function parseCodexAppServerLine(line: string): Record<string, unknown> {
  const trimmed = line.trim();
  if (!trimmed) throw new Error('Codex app-server record was empty.');
  if (Buffer.byteLength(trimmed, 'utf8') > CODEX_APP_SERVER_MAX_RECORD_BYTES) {
    throw new Error('Codex app-server record exceeded the 4 MiB safety limit.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error('Codex app-server record was not valid JSON.', { cause: error });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Codex app-server record must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

export function classifyCodexAppServerNotification(
  record: Record<string, unknown>
): CodexAppServerClassification {
  validateWithSchema(validateServerNotification, record, 'Codex app-server notification');
  const method = boundedIdentifier(record.method) ?? 'unknown';
  const params = recordValue(record.params) ?? {};
  const item = recordValue(params.item);
  const turn = recordValue(params.turn);
  const tokenUsage = recordValue(params.tokenUsage);
  const totalUsage = recordValue(tokenUsage?.total);
  const turnStatus = stringValue(turn?.status);
  const turnError = recordValue(turn?.error);
  const summary = boundedSummary(
    stringValue(params.delta) ??
      (stringValue(item?.type) === 'agentMessage' ? stringValue(item?.text) : undefined) ??
      stringValue(turnError?.message)
  );
  const usage =
    method === 'thread/tokenUsage/updated' && totalUsage
      ? {
          inputTokens: boundedNumber(totalUsage.inputTokens) ?? 0,
          outputTokens: boundedNumber(totalUsage.outputTokens) ?? 0,
          totalTokens: boundedNumber(totalUsage.totalTokens) ?? 0,
        }
      : undefined;
  const terminal =
    method === 'turn/completed'
      ? terminalResult(turnStatus, stringValue(turnError?.message))
      : undefined;
  const sessionId = boundedIdentifier(params.threadId);
  const turnId = boundedIdentifier(params.turnId) ?? boundedIdentifier(turn?.id);
  const itemId = boundedIdentifier(params.itemId) ?? boundedIdentifier(item?.id);

  return {
    providerType: method,
    ...(summary ? { summary } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(turnId ? { turnId } : {}),
    ...(itemId ? { itemId } : {}),
    files: extractFileChanges(item),
    ...(usage ? { usage } : {}),
    ...(terminal ? { terminal } : {}),
  };
}

export class CodexAppServerRpcClient {
  private readonly pending = new Map<string, PendingRpcRequest>();
  private readonly requestTimeoutMs: number;
  private readonly overloadAttempts: number;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly random: () => number;
  private nextId = 1;
  private closed = false;
  private initialized = false;

  constructor(private readonly options: CodexAppServerRpcClientOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.overloadAttempts = options.overloadAttempts ?? DEFAULT_OVERLOAD_ATTEMPTS;
    this.sleep =
      options.sleep ?? ((delayMs) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
    this.random = options.random ?? Math.random;
  }

  async initialize(): Promise<void> {
    if (this.initialized) throw new Error('Codex app-server was already initialized.');
    await this.request('initialize', {
      clientInfo: {
        name: 'veritas_kanban',
        title: 'Veritas Kanban',
        version: '1.0.0',
      },
      capabilities: {
        experimentalApi: false,
        mcpServerOpenaiFormElicitation: false,
      },
    });
    this.notify('initialized', {});
    this.initialized = true;
  }

  async startThread(input: CodexAppServerThreadInput): Promise<string> {
    this.assertInitialized();
    const result = await this.request('thread/start', {
      cwd: input.cwd,
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandbox: input.sandboxMode,
      serviceName: 'veritas-kanban',
      sessionStartSource: 'startup',
      ...(input.model?.trim() ? { model: input.model.trim() } : {}),
    });
    return requiredNestedIdentifier(result, 'thread', 'id', 'Codex app-server thread/start');
  }

  async startTurn(input: CodexAppServerTurnInput): Promise<string> {
    this.assertInitialized();
    const result = await this.request('turn/start', {
      threadId: requiredIdentifier(input.threadId, 'Codex app-server thread ID'),
      input: [{ type: 'text', text: input.prompt }],
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      cwd: input.cwd,
      ...(input.model?.trim() ? { model: input.model.trim() } : {}),
    });
    return requiredNestedIdentifier(result, 'turn', 'id', 'Codex app-server turn/start');
  }

  async interrupt(threadId: string, turnId: string): Promise<void> {
    this.assertInitialized();
    await this.request('turn/interrupt', {
      threadId: requiredIdentifier(threadId, 'Codex app-server thread ID'),
      turnId: requiredIdentifier(turnId, 'Codex app-server turn ID'),
    });
  }

  async acceptRecord(record: Record<string, unknown>): Promise<CodexAppServerInbound> {
    const method = stringValue(record.method);
    const hasId = record.id !== undefined;

    if (method && hasId) {
      validateWithSchema(validateServerRequest, record, 'Codex app-server server request');
      const response = denialForServerRequest(method);
      this.writeRecord({ id: record.id, ...response });
      return {
        kind: 'server-request',
        method,
        record,
        denied: true,
      };
    }

    if (method) {
      validateWithSchema(validateServerNotification, record, 'Codex app-server notification');
      return { kind: 'notification', method, record };
    }

    if (!hasId) {
      throw new Error('Codex app-server record had neither a method nor a response ID.');
    }

    const key = rpcIdKey(record.id);
    const pending = this.pending.get(key);
    if (!pending) {
      throw new Error('Codex app-server returned an uncorrelated response ID.');
    }
    this.pending.delete(key);
    clearTimeout(pending.timer);

    if (record.error !== undefined) {
      try {
        validateWithSchema(validateJsonRpcError, record, 'Codex app-server error response');
        const error = recordValue(record.error);
        const code = boundedSignedNumber(error?.code);
        const message =
          boundedSummary(stringValue(error?.message)) ?? 'Codex app-server RPC failed.';
        pending.reject(new CodexAppServerRpcError(message, code ?? -32_603, error?.data));
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    } else {
      try {
        validateWithSchema(validateJsonRpcResponse, record, 'Codex app-server response');
        validateWithSchema(
          responseValidators[pending.method],
          record.result,
          `Codex app-server ${pending.method} result`
        );
        pending.resolve(record.result);
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    }
    return { kind: 'response', method: pending.method, record };
  }

  close(error = new Error('Codex app-server connection closed.')): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private async request(
    method: CodexAppServerOutboundMethod,
    params: Record<string, unknown>
  ): Promise<unknown> {
    if (!isCodexAppServerOutboundMethod(method)) {
      throw new Error(`Codex app-server method "${method}" is not reachable from Veritas.`);
    }
    for (let attempt = 1; attempt <= this.overloadAttempts; attempt += 1) {
      try {
        return await this.requestOnce(method, params);
      } catch (error) {
        if (
          !(error instanceof CodexAppServerRpcError) ||
          error.code !== CODEX_APP_SERVER_OVERLOAD_ERROR ||
          attempt >= this.overloadAttempts
        ) {
          throw error;
        }
        const exponential = Math.min(
          OVERLOAD_BASE_DELAY_MS * 2 ** (attempt - 1),
          OVERLOAD_MAX_DELAY_MS
        );
        const delayMs = exponential + Math.floor(this.random() * Math.max(1, exponential / 2));
        this.options.onOverloadRetry?.(method, attempt, delayMs);
        await this.sleep(delayMs);
      }
    }
    throw new Error('Codex app-server overload retry budget was exhausted.');
  }

  private requestOnce(
    method: CodexAppServerOutboundMethod,
    params: Record<string, unknown>
  ): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('Codex app-server connection is closed.'));
    const id = this.nextId;
    this.nextId += 1;
    if (!Number.isSafeInteger(id)) {
      return Promise.reject(new Error('Codex app-server request ID space was exhausted.'));
    }
    const record = { id, method, params };
    validateWithSchema(validateClientRequest, record, `Codex app-server ${method} request`);
    const key = rpcIdKey(id);
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`Codex app-server ${method} request timed out.`));
      }, this.requestTimeoutMs);
      this.pending.set(key, { method, resolve, reject, timer });
      try {
        this.writeRecord(record);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(key);
        reject(error);
      }
    });
  }

  private notify(method: 'initialized', params: Record<string, unknown>): void {
    const record = { method, params };
    validateWithSchema(validateClientNotification, record, 'Codex app-server client notification');
    this.writeRecord(record);
  }

  private writeRecord(record: Record<string, unknown>): void {
    if (this.closed) throw new Error('Codex app-server connection is closed.');
    const line = JSON.stringify(record);
    if (Buffer.byteLength(line, 'utf8') > CODEX_APP_SERVER_MAX_RECORD_BYTES) {
      throw new Error('Codex app-server outbound record exceeded the 4 MiB safety limit.');
    }
    this.options.write(`${line}\n`);
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('Codex app-server is not initialized.');
  }
}

function denialForServerRequest(
  method: string
): { result: Record<string, unknown> } | { error: Record<string, unknown> } {
  if (method === 'item/commandExecution/requestApproval') {
    return { result: { decision: 'decline' } };
  }
  if (method === 'item/fileChange/requestApproval') {
    return { result: { decision: 'decline' } };
  }
  if (method === 'mcpServer/elicitation/request') {
    return { result: { action: 'decline', content: null } };
  }
  if (method === 'item/tool/requestUserInput') {
    return { result: { answers: {} } };
  }
  if (method === 'applyPatchApproval' || method === 'execCommandApproval') {
    return {
      result: {
        decision: {
          denied: {
            rejection: 'Veritas approval broker is unavailable for this run.',
          },
        },
      },
    };
  }
  return {
    error: {
      code: -32_602,
      message: 'Veritas does not expose this provider-to-client method.',
    },
  };
}

function terminalResult(
  status: string | undefined,
  error: string | undefined
): CodexAppServerTerminalResult {
  const normalized =
    status === 'completed' ||
    status === 'interrupted' ||
    status === 'failed' ||
    status === 'inProgress'
      ? status
      : 'unknown';
  return {
    success: normalized === 'completed',
    status: normalized,
    ...(normalized !== 'completed'
      ? { error: boundedSummary(error) ?? `Codex app-server turn ended with status ${normalized}.` }
      : {}),
  };
}

function extractFileChanges(item: Record<string, unknown> | undefined): string[] {
  if (stringValue(item?.type) !== 'fileChange' || !Array.isArray(item?.changes)) return [];
  const files = new Set<string>();
  for (const change of item.changes.slice(0, 100)) {
    const path = boundedIdentifier(recordValue(change)?.path, 2_048);
    if (path) files.add(path);
  }
  return [...files].slice(0, 20);
}

function validateWithSchema(
  validator: ValidateFunction<unknown>,
  value: unknown,
  label: string
): void {
  if (validator(value)) return;
  const detail = (validator.errors ?? [])
    .slice(0, 3)
    .map((error) => `${error.instancePath || '/'} ${error.keyword}`)
    .join(', ');
  throw new Error(`${label} failed the pinned v0.145.0 schema${detail ? `: ${detail}` : '.'}`);
}

function requiredNestedIdentifier(
  value: unknown,
  parentKey: string,
  childKey: string,
  label: string
): string {
  const parent = recordValue(value);
  const nested = recordValue(parent?.[parentKey]);
  return requiredIdentifier(nested?.[childKey], `${label} ${parentKey}.${childKey}`);
}

function requiredIdentifier(value: unknown, label: string): string {
  const identifier = boundedIdentifier(value);
  if (!identifier) throw new Error(`${label} was missing or invalid.`);
  return identifier;
}

function rpcIdKey(value: unknown): string {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    (typeof value === 'number' && !Number.isSafeInteger(value))
  ) {
    throw new Error('Codex app-server response ID was invalid.');
  }
  return `${typeof value}:${String(value)}`;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function boundedIdentifier(value: unknown, maxLength = MAX_IDENTIFIER_LENGTH): string | undefined {
  const normalized = stringValue(value);
  const containsControlCharacter = [...(normalized ?? '')].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (!normalized || normalized.length > maxLength || containsControlCharacter) return undefined;
  return normalized;
}

function boundedSummary(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized.length > MAX_SUMMARY_LENGTH
    ? `${normalized.slice(0, MAX_SUMMARY_LENGTH)}[truncated]`
    : normalized;
}

function boundedNumber(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
    ? value
    : undefined;
}

function boundedSignedNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

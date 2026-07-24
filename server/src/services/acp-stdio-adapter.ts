import { createHash } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import type {
  AcpAgentCapabilities,
  AcpExistingSessionRequest,
  AcpInitializeResponse,
  AcpJsonRpcMessage,
  AcpMcpServer,
  AcpNewSessionResponse,
  AcpPromptResponse,
  AcpRequestPermissionRequest,
  AcpRequestPermissionResponse,
  AcpRuntimeProbe,
  AcpSessionNotification,
  AcpStopReason,
  ConversationLaunchMode,
} from '@veritas-kanban/shared';
import { ACP_METHODS, ACP_PROTOCOL_VERSION, AcpJsonRpcPeer } from '@veritas-kanban/shared';
import { ConflictError, ValidationError } from '../middleware/error-handler.js';
import { sanitizeProviderRuntimeDiagnostic } from '../utils/provider-runtime-manifest-sanitize.js';

const ACP_STARTUP_TIMEOUT_MS = 10_000;
const ACP_PROMPT_TIMEOUT_MS = 24 * 60 * 60 * 1_000;
const ACP_TERMINATION_GRACE_MS = 2_000;
const ACP_MAX_STDERR_BYTES = 8 * 1024;

export interface AcpStdioOpenOptions {
  command: string;
  args: string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  environmentKeys?: string[];
  onNotification?: (notification: AcpSessionNotification) => void | Promise<void>;
  onPermissionRequest?: (
    request: AcpRequestPermissionRequest
  ) => AcpRequestPermissionResponse | Promise<AcpRequestPermissionResponse>;
  onSpawn?: (child: ChildProcessWithoutNullStreams) => void | Promise<void>;
}

export interface AcpOpenSessionInput {
  mode: ConversationLaunchMode;
  cwd: string;
  mcpServers: AcpMcpServer[];
  conversationId?: string;
}

export interface AcpStdioControl {
  readonly child: ChildProcessWithoutNullStreams;
  readonly probe: AcpRuntimeProbe;
  readonly sessionId?: string;
  openSession(input: AcpOpenSessionInput): Promise<string>;
  prompt(prompt: string): Promise<AcpPromptResponse>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}

export async function probeAcpStdioRuntime(
  options: Omit<AcpStdioOpenOptions, 'onNotification' | 'onPermissionRequest' | 'onSpawn'>
): Promise<AcpRuntimeProbe> {
  const control = await openAcpStdio(options);
  try {
    return control.probe;
  } finally {
    await control.close();
  }
}

export async function openAcpStdio(options: AcpStdioOpenOptions): Promise<AcpStdioControl> {
  return AcpStdioConnection.open(options);
}

class AcpStdioConnection implements AcpStdioControl {
  readonly child: ChildProcessWithoutNullStreams;
  readonly probe: AcpRuntimeProbe;
  private readonly peer: AcpJsonRpcPeer;
  private readonly capabilities: AcpAgentCapabilities;
  private activeSessionId?: string;
  private closed = false;

  private constructor(
    child: ChildProcessWithoutNullStreams,
    peer: AcpJsonRpcPeer,
    probe: AcpRuntimeProbe,
    private readonly options: AcpStdioOpenOptions
  ) {
    this.child = child;
    this.peer = peer;
    this.probe = probe;
    this.capabilities = probe.capabilities;
  }

  get sessionId(): string | undefined {
    return this.activeSessionId;
  }

  static async open(options: AcpStdioOpenOptions): Promise<AcpStdioConnection> {
    const command = options.command.trim();
    if (!command || command.includes('\0')) {
      throw new ValidationError('ACP command must be a non-empty executable path.');
    }
    const child = spawn(command, options.args, {
      cwd: options.cwd,
      env: buildSafeAcpEnv(options.environment, options.environmentKeys ?? []),
      shell: false,
      detached: process.platform !== 'win32',
    });
    let stderr = '';
    let peer: AcpJsonRpcPeer;
    peer = new AcpJsonRpcPeer({
      requestTimeoutMs: ACP_STARTUP_TIMEOUT_MS,
      write: (record) => writeRecord(child, record),
      onNotification: async (method, params) => {
        if (method !== ACP_METHODS.client.sessionUpdate) return;
        try {
          await options.onNotification?.(parseSessionNotification(params));
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error));
          peer.close(failure);
          terminateProcessGroup(child);
          throw failure;
        }
      },
      onRequest: async (method, params) => {
        if (method !== ACP_METHODS.client.requestPermission) {
          throw new Error(`Unsupported ACP client request: ${method}`);
        }
        if (!options.onPermissionRequest) {
          return { outcome: { outcome: 'cancelled' } } satisfies AcpRequestPermissionResponse;
        }
        return options.onPermissionRequest(parsePermissionRequest(params));
      },
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => peer.acceptChunk(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = boundUtf8(`${stderr}${chunk}`, ACP_MAX_STDERR_BYTES);
    });
    child.stdin.on('error', (error) => peer.close(error));
    child.on('error', (error) => peer.close(error));
    child.on('close', (code, signal) => {
      const diagnostic = sanitizeProviderRuntimeDiagnostic(stderr.trim());
      peer.close(
        new Error(
          `ACP stdio process exited (${code ?? 'none'}/${signal ?? 'none'}).${
            diagnostic ? ` ${diagnostic}` : ''
          }`
        )
      );
    });

    try {
      await options.onSpawn?.(child);
      const initialized = await peer.request<AcpInitializeResponse>(
        ACP_METHODS.agent.initialize,
        {
          protocolVersion: ACP_PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: { name: 'veritas-kanban', version: '6.0.0' },
        },
        ACP_STARTUP_TIMEOUT_MS
      );
      const probe = parseInitializeResponse(initialized, path.basename(command));
      return new AcpStdioConnection(child, peer, probe, options);
    } catch (error) {
      peer.close(error instanceof Error ? error : new Error(String(error)));
      terminateProcessGroup(child);
      throw error;
    }
  }

  async openSession(input: AcpOpenSessionInput): Promise<string> {
    if (this.activeSessionId) {
      throw new ConflictError('ACP connection already has an active session.');
    }
    for (const server of input.mcpServers) {
      if ('type' in server && this.capabilities.mcpCapabilities?.[server.type] !== true) {
        throw new ConflictError(
          `ACP agent did not negotiate ${server.type} MCP transport support.`
        );
      }
    }
    if (input.mode === 'fresh') {
      const response = await this.peer.request<AcpNewSessionResponse>(
        ACP_METHODS.agent.sessionNew,
        {
          cwd: input.cwd,
          mcpServers: input.mcpServers,
        },
        ACP_STARTUP_TIMEOUT_MS
      );
      this.activeSessionId = requiredString(response?.sessionId, 'ACP session/new sessionId');
      return this.activeSessionId;
    }

    const conversationId = requiredString(
      input.conversationId,
      `ACP ${input.mode} conversation identity`
    );
    const request: AcpExistingSessionRequest = {
      sessionId: conversationId,
      cwd: input.cwd,
      mcpServers: input.mcpServers,
    };
    if (input.mode === 'fork') {
      if (!this.capabilities.sessionCapabilities?.fork) {
        throw new ConflictError('ACP agent did not negotiate session/fork support.');
      }
      const response = await this.peer.request<AcpNewSessionResponse>(
        ACP_METHODS.agent.sessionFork,
        request,
        ACP_STARTUP_TIMEOUT_MS
      );
      this.activeSessionId = requiredString(response?.sessionId, 'ACP session/fork sessionId');
      return this.activeSessionId;
    }

    if (this.capabilities.sessionCapabilities?.resume) {
      await this.peer.request(ACP_METHODS.agent.sessionResume, request, ACP_STARTUP_TIMEOUT_MS);
    } else if (this.capabilities.loadSession) {
      await this.peer.request(ACP_METHODS.agent.sessionLoad, request, ACP_STARTUP_TIMEOUT_MS);
    } else {
      throw new ConflictError('ACP agent did not negotiate session/resume or session/load.');
    }
    this.activeSessionId = conversationId;
    return conversationId;
  }

  async prompt(prompt: string): Promise<AcpPromptResponse> {
    const sessionId = requiredString(this.activeSessionId, 'ACP active session');
    const text = prompt.trim();
    if (!text || Buffer.byteLength(text, 'utf8') > 200_000) {
      throw new ValidationError('ACP prompt must contain 1 to 200,000 UTF-8 bytes.');
    }
    const response = await this.peer.request<AcpPromptResponse>(
      ACP_METHODS.agent.sessionPrompt,
      {
        sessionId,
        prompt: [{ type: 'text', text }],
      },
      ACP_PROMPT_TIMEOUT_MS
    );
    parseStopReason(response?.stopReason);
    return response;
  }

  async cancel(): Promise<void> {
    if (!this.activeSessionId || this.closed) return;
    await this.peer.notify(ACP_METHODS.agent.sessionCancel, {
      sessionId: this.activeSessionId,
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.activeSessionId && this.capabilities.sessionCapabilities?.close) {
      await this.peer
        .request(
          ACP_METHODS.agent.sessionClose,
          { sessionId: this.activeSessionId },
          ACP_STARTUP_TIMEOUT_MS
        )
        .catch(() => undefined);
    }
    this.peer.close();
    this.child.stdin.end();
    terminateProcessGroup(this.child);
  }
}

function parseInitializeResponse(value: unknown, fallbackName: string): AcpRuntimeProbe {
  const record = requiredRecord(value, 'ACP initialize response');
  if (record.protocolVersion !== ACP_PROTOCOL_VERSION) {
    throw new ConflictError('ACP agent selected an unsupported protocol version.', {
      expected: ACP_PROTOCOL_VERSION,
      received: record.protocolVersion,
    });
  }
  const capabilities = optionalRecord(record.agentCapabilities) as AcpAgentCapabilities;
  const agentInfoRecord = optionalRecord(record.agentInfo);
  const agentInfo = {
    name: optionalString(agentInfoRecord.name) ?? fallbackName,
    ...(optionalString(agentInfoRecord.title)
      ? { title: optionalString(agentInfoRecord.title) }
      : {}),
    ...(optionalString(agentInfoRecord.version)
      ? { version: optionalString(agentInfoRecord.version) }
      : {}),
  };
  return {
    protocolVersion: ACP_PROTOCOL_VERSION,
    agentInfo,
    capabilities,
    capabilityDigest: digestCapabilities(capabilities),
  };
}

function parseSessionNotification(value: unknown): AcpSessionNotification {
  const record = requiredRecord(value, 'ACP session/update params');
  const update = requiredRecord(record.update, 'ACP session/update payload');
  const sessionUpdate = requiredString(update.sessionUpdate, 'ACP session update discriminator');
  return {
    sessionId: requiredString(record.sessionId, 'ACP session/update sessionId'),
    update: { ...update, sessionUpdate },
  } as AcpSessionNotification;
}

function parsePermissionRequest(value: unknown): AcpRequestPermissionRequest {
  const record = requiredRecord(value, 'ACP permission request');
  const toolCall = requiredRecord(record.toolCall, 'ACP permission toolCall');
  const options = Array.isArray(record.options) ? record.options : [];
  if (options.length === 0 || options.length > 20) {
    throw new ValidationError('ACP permission request must provide 1 to 20 options.');
  }
  return {
    sessionId: requiredString(record.sessionId, 'ACP permission sessionId'),
    toolCall: {
      ...toolCall,
      toolCallId: requiredString(toolCall.toolCallId, 'ACP permission toolCallId'),
      title: optionalString(toolCall.title),
      name: optionalString(toolCall.name),
      kind: optionalString(toolCall.kind),
      status: optionalString(toolCall.status),
    },
    options: options.map((option, index) => {
      const item = requiredRecord(option, `ACP permission option ${index}`);
      const kind = requiredString(item.kind, `ACP permission option ${index} kind`);
      if (!['allow_once', 'allow_always', 'reject_once', 'reject_always'].includes(kind)) {
        throw new ValidationError(`ACP permission option ${index} has an invalid kind.`);
      }
      return {
        optionId: requiredString(item.optionId, `ACP permission option ${index} optionId`),
        name: requiredString(item.name, `ACP permission option ${index} name`),
        kind: kind as 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always',
      };
    }),
  };
}

function parseStopReason(value: unknown): AcpStopReason {
  if (
    value === 'end_turn' ||
    value === 'max_tokens' ||
    value === 'max_turn_requests' ||
    value === 'refusal' ||
    value === 'cancelled'
  ) {
    return value;
  }
  throw new ValidationError('ACP prompt response returned an invalid stopReason.');
}

function digestCapabilities(capabilities: AcpAgentCapabilities): string {
  return `sha256:${createHash('sha256').update(stableJson(capabilities)).digest('hex')}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function writeRecord(
  child: ChildProcessWithoutNullStreams,
  record: AcpJsonRpcMessage
): Promise<void> {
  return new Promise((resolve, reject) => {
    child.stdin.write(`${JSON.stringify(record)}\n`, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function buildSafeAcpEnv(
  source: NodeJS.ProcessEnv,
  selectedKeys: string[]
): NodeJS.ProcessEnv {
  const allowed = new Set([
    'CI',
    'FORCE_COLOR',
    'HOME',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'LOGNAME',
    'NODE_EXTRA_CA_CERTS',
    'NO_COLOR',
    'PATH',
    'SHELL',
    'SSL_CERT_FILE',
    'TEMP',
    'TERM',
    'TMP',
    'TMPDIR',
    'USER',
    ...selectedKeys,
  ]);
  return Object.fromEntries(
    [...allowed]
      .map((key) => [key, source[key]])
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

function terminateProcessGroup(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode != null || child.signalCode != null) return;
  const pid = child.pid;
  if (process.platform === 'win32' && pid !== undefined && pid > 0) {
    const terminator = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    terminator.unref();
    return;
  }
  let group = false;
  if (pid !== undefined && pid > 0) {
    try {
      process.kill(-pid, 'SIGTERM');
      group = true;
    } catch {
      // Fall through to the exact child handle.
    }
  }
  if (!group) child.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (child.exitCode != null || child.signalCode != null) return;
    if (group && pid !== undefined) {
      try {
        process.kill(-pid, 'SIGKILL');
        return;
      } catch {
        // Fall through to the exact child handle.
      }
    }
    child.kill('SIGKILL');
  }, ACP_TERMINATION_GRACE_MS);
  timer.unref();
  child.once('close', () => clearTimeout(timer));
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredString(value: unknown, label: string): string {
  const result = optionalString(value);
  if (!result || result.length > 500) throw new ValidationError(`${label} is invalid.`);
  return result;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function boundUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.byteLength <= maxBytes) return value;
  return bytes
    .subarray(bytes.byteLength - maxBytes)
    .toString('utf8')
    .replace(/^\uFFFD/u, '');
}

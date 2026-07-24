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
import { ACP_RUNTIME_PROFILE_SCHEMA_VERSION } from '@veritas-kanban/shared';
import { ConflictError, ValidationError } from '../middleware/error-handler.js';
import { sanitizeProviderRuntimeDiagnostic } from '../utils/provider-runtime-manifest-sanitize.js';

const ACP_STARTUP_TIMEOUT_MS = 10_000;
const ACP_PROMPT_TIMEOUT_MS = 24 * 60 * 60 * 1_000;
const ACP_TERMINATION_GRACE_MS = 2_000;
const ACP_MAX_STDERR_BYTES = 8 * 1024;

export const BUZZ_AGENT_RUNTIME_PROFILE_ID = 'buzz-agent';
export const BUZZ_AGENT_RUNTIME_PROFILE_REVISION = 1;
export const BUZZ_AGENT_TESTED_RELEASE = 'v0.4.24';
export const BUZZ_AGENT_TESTED_COMMIT = '710ed9fff57878a1d69f809b80a6ee0416c53fc4';
export const BUZZ_AGENT_ACP_VERSION = '0.1.0';
export const BUZZ_AGENT_CREDENTIAL_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'DATABRICKS_TOKEN',
  'OPENAI_COMPAT_API_KEY',
] as const;
export const BUZZ_AGENT_ENVIRONMENT_KEYS = [
  'ANTHROPIC_API_VERSION',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'BUZZ_AGENT_LLM_TIMEOUT_SECS',
  'BUZZ_AGENT_MAX_CONTEXT_TOKENS',
  'BUZZ_AGENT_MAX_HANDOFFS',
  'BUZZ_AGENT_MAX_HISTORY_BYTES',
  'BUZZ_AGENT_MAX_LINE_BYTES',
  'BUZZ_AGENT_MAX_OUTPUT_TOKENS',
  'BUZZ_AGENT_MAX_PARALLEL_TOOLS',
  'BUZZ_AGENT_MAX_ROUNDS',
  'BUZZ_AGENT_MAX_SESSIONS',
  'BUZZ_AGENT_MAX_TOOL_RESULT_TEXT_BYTES',
  'BUZZ_AGENT_PROVIDER',
  'BUZZ_AGENT_SYSTEM_PROMPT',
  'BUZZ_AGENT_SYSTEM_PROMPT_FILE',
  'BUZZ_AGENT_TOOL_TIMEOUT_SECS',
  'DATABRICKS_HOST',
  'DATABRICKS_MODEL',
  'OPENAI_COMPAT_API',
  'OPENAI_COMPAT_BASE_URL',
  'OPENAI_COMPAT_MODEL',
] as const;

export const COPILOT_ACP_RUNTIME_PROFILE_ID = 'github-copilot-cli';
export const COPILOT_ACP_RUNTIME_PROFILE_REVISION = 1;
export const COPILOT_ACP_TESTED_RELEASE = 'v1.0.74';
export const COPILOT_ACP_TESTED_COMMIT = '2b809c84e87dbcc88f897cb4f3fb97c43b77af95';
export const COPILOT_ACP_VERSION = '1.0.74';
export const COPILOT_ACP_CREDENTIAL_ENV_KEYS = [
  'COPILOT_GITHUB_TOKEN',
  'COPILOT_PROVIDER_API_KEY',
  'COPILOT_PROVIDER_BEARER_TOKEN',
  'GH_TOKEN',
  'GITHUB_TOKEN',
] as const;
export const COPILOT_ACP_ENVIRONMENT_KEYS = [
  'COPILOT_GH_HOST',
  'COPILOT_HOME',
  'COPILOT_OFFLINE',
  'COPILOT_PROVIDER_AZURE_API_VERSION',
  'COPILOT_PROVIDER_BASE_URL',
  'COPILOT_PROVIDER_MAX_OUTPUT_TOKENS',
  'COPILOT_PROVIDER_MAX_PROMPT_TOKENS',
  'COPILOT_PROVIDER_MODEL_ID',
  'COPILOT_PROVIDER_TRANSPORT',
  'COPILOT_PROVIDER_TYPE',
  'COPILOT_PROVIDER_WIRE_API',
  'COPILOT_PROVIDER_WIRE_MODEL',
  'GH_HOST',
] as const;

export const GROK_BUILD_RUNTIME_PROFILE_ID = 'grok-build';
export const GROK_BUILD_RUNTIME_PROFILE_REVISION = 1;
export const GROK_BUILD_TESTED_RELEASE = 'v0.2.111';
export const GROK_BUILD_TESTED_BUILD = '94172f2aa4e5';
export const GROK_BUILD_TESTED_BINARY_SHA256 =
  'e1fafdfffe14f339460befaf194360e8f90bfd02efe8a4f24cfa1c7aea657ffe';
export const GROK_BUILD_ACP_VERSION = '0.2.111';
export const GROK_BUILD_VERSION_OUTPUT = `grok ${GROK_BUILD_ACP_VERSION} (${GROK_BUILD_TESTED_BUILD}) [alpha]`;
export const GROK_BUILD_CREDENTIAL_ENV_KEYS = [
  'GROK_CODE_XAI_API_KEY',
  'GROK_DEPLOYMENT_KEY',
  'XAI_API_KEY',
] as const;
export const GROK_BUILD_ENVIRONMENT_KEYS = [
  'GROK_DISABLE_API_KEY_AUTH',
  'GROK_FEEDBACK_ENABLED',
  'GROK_HOME',
  'GROK_SANDBOX',
  'GROK_TELEMETRY_ENABLED',
  'GROK_TRACE_UPLOAD',
] as const;
export const GROK_BUILD_REQUIRED_ARGS = ['agent', '--no-leader'] as const;
const GROK_BUILD_RESTRICTIVE_BOOLEAN_FLAGS = new Set([
  '--disable-web-search',
  '--no-memory',
  '--no-plan',
  '--no-subagents',
]);
const GROK_BUILD_RESTRICTIVE_REPEATABLE_FLAGS = new Set(['--deny']);
const GROK_BUILD_RESTRICTIVE_SINGLE_VALUE_FLAGS = new Set([
  '--disallowed-tools',
  '--sandbox',
  '--tools',
]);
const GROK_BUILD_SANDBOX_PROFILES = new Set(['read-only', 'strict', 'workspace']);
const GROK_BUILD_EFFORT_FLAGS = new Set(['--effort', '--reasoning-effort']);
const GROK_BUILD_EFFORT_LEVELS = new Set(['low', 'medium', 'high']);

export function buildGrokBuildAcpArgs(input: {
  model?: string;
  extraArgs?: readonly string[];
}): string[] {
  const globalArgs: string[] = [];
  const agentArgs: string[] = ['--no-leader'];
  if (input.model !== undefined) {
    agentArgs.push(`--model=${boundedGrokBuildArgumentValue('--model', input.model, 200)}`);
  }

  const extraArgs = input.extraArgs ?? [];
  const seenSingleValueFlags = new Set<string>();
  for (let index = 0; index < extraArgs.length; index += 1) {
    const raw = extraArgs[index]?.trim() ?? '';
    const separator = raw.indexOf('=');
    const flag = separator >= 0 ? raw.slice(0, separator) : raw;
    if (GROK_BUILD_RESTRICTIVE_BOOLEAN_FLAGS.has(flag)) {
      if (separator >= 0 || seenSingleValueFlags.has(flag)) {
        throw new ConflictError(`Grok Build ACP ${flag} may be configured only once.`);
      }
      seenSingleValueFlags.add(flag);
      globalArgs.push(flag);
      continue;
    }

    const isEffort = GROK_BUILD_EFFORT_FLAGS.has(flag);
    const accepted =
      isEffort ||
      GROK_BUILD_RESTRICTIVE_REPEATABLE_FLAGS.has(flag) ||
      GROK_BUILD_RESTRICTIVE_SINGLE_VALUE_FLAGS.has(flag);
    if (!accepted) {
      throw new ConflictError('Grok Build ACP launch argument is not governed by Veritas.', {
        argument: sanitizeProviderRuntimeDiagnostic(raw),
        remediation:
          'Use the agent model field or the documented restrictive Grok Build ACP profile arguments.',
      });
    }

    let value = separator >= 0 ? raw.slice(separator + 1) : undefined;
    if (value === undefined) {
      index += 1;
      value = extraArgs[index];
    }
    const normalizedValue = boundedGrokBuildArgumentValue(flag, value, 1_000);
    const canonicalFlag = isEffort ? '--reasoning-effort' : flag;
    if (isEffort || GROK_BUILD_RESTRICTIVE_SINGLE_VALUE_FLAGS.has(flag)) {
      if (seenSingleValueFlags.has(canonicalFlag)) {
        throw new ConflictError(`Grok Build ACP ${canonicalFlag} may be configured only once.`);
      }
      seenSingleValueFlags.add(canonicalFlag);
    }
    if (isEffort && !GROK_BUILD_EFFORT_LEVELS.has(normalizedValue)) {
      throw new ConflictError('Grok Build ACP reasoning effort is outside the tested profile.', {
        effort: normalizedValue,
      });
    }
    if (canonicalFlag === '--sandbox' && !GROK_BUILD_SANDBOX_PROFILES.has(normalizedValue)) {
      throw new ConflictError('Grok Build ACP sandbox is outside the tested profile.', {
        sandbox: normalizedValue,
      });
    }
    const target = isEffort ? agentArgs : globalArgs;
    target.push(`${canonicalFlag}=${normalizedValue}`);
  }
  return [...globalArgs, ...GROK_BUILD_REQUIRED_ARGS, ...agentArgs.slice(1), 'stdio'];
}

export function assertGrokBuildVersionEvidence(version: string | undefined): void {
  if (version?.trim() === GROK_BUILD_VERSION_OUTPUT) return;
  throw new ConflictError('Grok Build executable is outside the tested compatibility profile.', {
    expected: GROK_BUILD_VERSION_OUTPUT,
    received: sanitizeProviderRuntimeDiagnostic(version?.trim() || 'unknown'),
    remediation: `Install Grok Build ${GROK_BUILD_TESTED_RELEASE}, then run \`vk doctor\`.`,
  });
}

const COPILOT_ACP_SECRET_ENV_ARG = `--secret-env-vars=${COPILOT_ACP_CREDENTIAL_ENV_KEYS.join(',')}`;
export const COPILOT_ACP_REQUIRED_ARGS = [
  '--acp',
  '--stdio',
  '--no-auto-update',
  '--no-remote',
  '--no-remote-export',
  '--disable-builtin-mcps',
  '--no-custom-instructions',
  '--no-ask-user',
  '--no-experimental',
  COPILOT_ACP_SECRET_ENV_ARG,
] as const;
const COPILOT_ACP_REPEATABLE_RESTRICTIVE_FLAGS = new Set([
  '--available-tools',
  '--deny-tool',
  '--deny-url',
  '--excluded-tools',
]);
const COPILOT_ACP_SINGLE_VALUE_FLAGS = new Set([
  '--context',
  '--effort',
  '--max-ai-credits',
  '--reasoning-effort',
]);
const COPILOT_ACP_EFFORT_LEVELS = new Set([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

export function buildCopilotAcpArgs(input: {
  model?: string;
  extraArgs?: readonly string[];
}): string[] {
  const args = [...COPILOT_ACP_REQUIRED_ARGS];
  if (input.model !== undefined) {
    const model = boundedCopilotArgumentValue('--model', input.model, 200);
    args.push(`--model=${model}`);
  }

  const extraArgs = input.extraArgs ?? [];
  const seenSingleValueFlags = new Set<string>();
  for (let index = 0; index < extraArgs.length; index += 1) {
    const raw = extraArgs[index]?.trim() ?? '';
    const separator = raw.indexOf('=');
    const flag = separator >= 0 ? raw.slice(0, separator) : raw;
    const accepted =
      COPILOT_ACP_REPEATABLE_RESTRICTIVE_FLAGS.has(flag) ||
      COPILOT_ACP_SINGLE_VALUE_FLAGS.has(flag);
    if (!accepted) {
      throw new ConflictError('Copilot ACP launch argument is not governed by Veritas.', {
        argument: sanitizeProviderRuntimeDiagnostic(raw),
        remediation:
          'Use the agent model field or the documented restrictive Copilot ACP profile arguments.',
      });
    }

    let value = separator >= 0 ? raw.slice(separator + 1) : undefined;
    if (value === undefined) {
      index += 1;
      value = extraArgs[index];
    }
    const normalizedValue = boundedCopilotArgumentValue(flag, value, 1_000);
    const canonicalFlag = flag === '--reasoning-effort' ? '--effort' : flag;
    if (COPILOT_ACP_SINGLE_VALUE_FLAGS.has(flag)) {
      if (seenSingleValueFlags.has(canonicalFlag)) {
        throw new ConflictError(`Copilot ACP ${canonicalFlag} may be configured only once.`);
      }
      seenSingleValueFlags.add(canonicalFlag);
    }
    if (canonicalFlag === '--effort' && !COPILOT_ACP_EFFORT_LEVELS.has(normalizedValue)) {
      throw new ConflictError('Copilot ACP reasoning effort is outside the tested profile.', {
        effort: normalizedValue,
      });
    }
    if (
      canonicalFlag === '--context' &&
      normalizedValue !== 'default' &&
      normalizedValue !== 'long_context'
    ) {
      throw new ConflictError('Copilot ACP context tier is outside the tested profile.', {
        context: normalizedValue,
      });
    }
    if (
      canonicalFlag === '--max-ai-credits' &&
      (!/^\d+$/.test(normalizedValue) || Number(normalizedValue) < 30)
    ) {
      throw new ConflictError('Copilot ACP max AI credits must be an integer of at least 30.');
    }
    args.push(`${canonicalFlag}=${normalizedValue}`);
  }
  return args;
}

export interface AcpStdioOpenOptions {
  command: string;
  args: string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  environmentKeys?: string[];
  runtimeProfileId?: string;
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
      const probe = applyAcpRuntimeProfile(
        parseInitializeResponse(initialized, path.basename(command), options.runtimeProfileId),
        options.runtimeProfileId
      );
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

function parseInitializeResponse(
  value: unknown,
  fallbackName: string,
  runtimeProfileId?: string
): AcpRuntimeProbe {
  const record = requiredRecord(value, 'ACP initialize response');
  if (record.protocolVersion !== ACP_PROTOCOL_VERSION) {
    throw new ConflictError('ACP agent selected an unsupported protocol version.', {
      expected: ACP_PROTOCOL_VERSION,
      received: record.protocolVersion,
    });
  }
  const capabilities = optionalRecord(record.agentCapabilities) as AcpAgentCapabilities;
  const agentInfoRecord = optionalRecord(record.agentInfo);
  const extensionMetadata = optionalRecord(record._meta);
  const grokBuildExtension =
    runtimeProfileId === GROK_BUILD_RUNTIME_PROFILE_ID &&
    extensionMetadata.grokShell === true &&
    optionalString(extensionMetadata.agentVersion)
      ? {
          name: 'Grok Build',
          version: optionalString(extensionMetadata.agentVersion),
        }
      : undefined;
  const agentInfo = {
    name: optionalString(agentInfoRecord.name) ?? grokBuildExtension?.name ?? fallbackName,
    ...(optionalString(agentInfoRecord.title)
      ? { title: optionalString(agentInfoRecord.title) }
      : {}),
    ...((optionalString(agentInfoRecord.version) ?? grokBuildExtension?.version)
      ? { version: optionalString(agentInfoRecord.version) ?? grokBuildExtension?.version }
      : {}),
  };
  return {
    protocolVersion: ACP_PROTOCOL_VERSION,
    agentInfo,
    capabilities,
    capabilityDigest: digestCapabilities(capabilities),
  };
}

function applyAcpRuntimeProfile(
  probe: AcpRuntimeProbe,
  runtimeProfileId: string | undefined
): AcpRuntimeProbe {
  if (!runtimeProfileId || runtimeProfileId === 'acp-stdio') return probe;
  if (runtimeProfileId === BUZZ_AGENT_RUNTIME_PROFILE_ID) return applyBuzzRuntimeProfile(probe);
  if (runtimeProfileId === COPILOT_ACP_RUNTIME_PROFILE_ID) {
    return applyCopilotRuntimeProfile(probe);
  }
  if (runtimeProfileId === GROK_BUILD_RUNTIME_PROFILE_ID) {
    return applyGrokBuildRuntimeProfile(probe);
  }
  throw new ConflictError('Configured ACP runtime profile is not registered.', {
    runtimeProfileId,
  });
}

function applyBuzzRuntimeProfile(probe: AcpRuntimeProbe): AcpRuntimeProbe {
  const failures = [
    ...(probe.agentInfo.name !== 'buzz-agent'
      ? [`Expected agentInfo.name buzz-agent, received ${probe.agentInfo.name}.`]
      : []),
    ...(probe.agentInfo.version !== BUZZ_AGENT_ACP_VERSION
      ? [
          `Expected buzz-agent ACP version ${BUZZ_AGENT_ACP_VERSION}, received ${
            probe.agentInfo.version ?? 'unknown'
          }.`,
        ]
      : []),
    ...(probe.capabilities.loadSession === false
      ? []
      : ['The tested Buzz profile requires loadSession: false.']),
    ...(probe.capabilities.mcpCapabilities?.http === false &&
    probe.capabilities.mcpCapabilities?.sse === false
      ? []
      : ['The tested Buzz profile supports stdio MCP only.']),
  ];
  if (failures.length > 0) {
    throw new ConflictError('Buzz ACP runtime is outside the tested compatibility profile.', {
      runtimeProfileId: BUZZ_AGENT_RUNTIME_PROFILE_ID,
      testedRelease: BUZZ_AGENT_TESTED_RELEASE,
      testedCommit: BUZZ_AGENT_TESTED_COMMIT,
      failures,
    });
  }
  const payload = {
    schemaVersion: ACP_RUNTIME_PROFILE_SCHEMA_VERSION,
    id: BUZZ_AGENT_RUNTIME_PROFILE_ID,
    revision: BUZZ_AGENT_RUNTIME_PROFILE_REVISION,
    testedRelease: BUZZ_AGENT_TESTED_RELEASE,
    testedCommit: BUZZ_AGENT_TESTED_COMMIT,
    limitations: [
      'non-streaming-llm',
      'in-memory-sessions',
      'no-session-load',
      'stdio-mcp-only',
      'provider-environment-authentication',
    ],
  };
  return {
    ...probe,
    runtimeProfile: {
      ...payload,
      digest: `sha256:${createHash('sha256').update(stableJson(payload)).digest('hex')}`,
    },
  };
}

function applyCopilotRuntimeProfile(probe: AcpRuntimeProbe): AcpRuntimeProbe {
  const failures = [
    ...(probe.agentInfo.name !== 'Copilot'
      ? [`Expected agentInfo.name Copilot, received ${probe.agentInfo.name}.`]
      : []),
    ...(probe.agentInfo.version !== COPILOT_ACP_VERSION
      ? [
          `Expected Copilot ACP version ${COPILOT_ACP_VERSION}, received ${
            probe.agentInfo.version ?? 'unknown'
          }.`,
        ]
      : []),
    ...(probe.capabilities.loadSession === true
      ? []
      : ['The tested Copilot profile requires loadSession: true.']),
    ...(probe.capabilities.mcpCapabilities?.http === true &&
    probe.capabilities.mcpCapabilities?.sse === true
      ? []
      : ['The tested Copilot profile requires HTTP and SSE MCP capability evidence.']),
    ...(probe.capabilities.promptCapabilities?.image === true &&
    probe.capabilities.promptCapabilities?.embeddedContext === true
      ? []
      : ['The tested Copilot profile requires image and embedded-context prompt capabilities.']),
    ...(probe.capabilities.sessionCapabilities?.list
      ? []
      : ['The tested Copilot profile requires session listing capability evidence.']),
  ];
  if (failures.length > 0) {
    throw new ConflictError('Copilot ACP runtime is outside the tested compatibility profile.', {
      runtimeProfileId: COPILOT_ACP_RUNTIME_PROFILE_ID,
      testedRelease: COPILOT_ACP_TESTED_RELEASE,
      testedCommit: COPILOT_ACP_TESTED_COMMIT,
      failures,
    });
  }
  const payload = {
    schemaVersion: ACP_RUNTIME_PROFILE_SCHEMA_VERSION,
    id: COPILOT_ACP_RUNTIME_PROFILE_ID,
    revision: COPILOT_ACP_RUNTIME_PROFILE_REVISION,
    testedRelease: COPILOT_ACP_TESTED_RELEASE,
    testedCommit: COPILOT_ACP_TESTED_COMMIT,
    limitations: [
      'public-preview-acp',
      'process-wide-tool-and-effort-policy',
      'provider-managed-authentication-not-probed',
      'partial-public-source',
      'release-tag-provenance-mismatch',
      'inherited-copilot-home',
      'veritas-stdio-transport-only',
    ],
  };
  return {
    ...probe,
    runtimeProfile: {
      ...payload,
      digest: `sha256:${createHash('sha256').update(stableJson(payload)).digest('hex')}`,
    },
  };
}

function applyGrokBuildRuntimeProfile(probe: AcpRuntimeProbe): AcpRuntimeProbe {
  const extensionMetadata = optionalRecord(probe.capabilities._meta);
  const failures = [
    ...(probe.agentInfo.name !== 'Grok Build'
      ? [`Expected Grok Build ACP identity, received ${probe.agentInfo.name}.`]
      : []),
    ...(probe.agentInfo.version !== GROK_BUILD_ACP_VERSION
      ? [
          `Expected Grok Build ACP version ${GROK_BUILD_ACP_VERSION}, received ${
            probe.agentInfo.version ?? 'unknown'
          }.`,
        ]
      : []),
    ...(probe.capabilities.loadSession === true
      ? []
      : ['The tested Grok Build profile requires loadSession: true.']),
    ...(probe.capabilities.mcpCapabilities?.http === true &&
    probe.capabilities.mcpCapabilities?.sse === true
      ? []
      : ['The tested Grok Build profile requires HTTP and SSE MCP capability evidence.']),
    ...(probe.capabilities.promptCapabilities?.image === false &&
    probe.capabilities.promptCapabilities?.embeddedContext === true
      ? []
      : [
          'The tested Grok Build profile requires image: false and embeddedContext: true prompt capability evidence.',
        ]),
    ...(extensionMetadata['x.ai/fs_notify'] === true
      ? []
      : ['The tested Grok Build profile requires negotiated x.ai/fs_notify extension evidence.']),
    ...(optionalRecord(extensionMetadata['x.ai/capabilities']).toolOverrides
      ? []
      : ['The tested Grok Build profile requires negotiated x.ai/capabilities evidence.']),
  ];
  if (failures.length > 0) {
    throw new ConflictError('Grok Build ACP runtime is outside the tested compatibility profile.', {
      runtimeProfileId: GROK_BUILD_RUNTIME_PROFILE_ID,
      testedRelease: GROK_BUILD_TESTED_RELEASE,
      testedBuild: GROK_BUILD_TESTED_BUILD,
      failures,
    });
  }
  const payload = {
    schemaVersion: ACP_RUNTIME_PROFILE_SCHEMA_VERSION,
    id: GROK_BUILD_RUNTIME_PROFILE_ID,
    revision: GROK_BUILD_RUNTIME_PROFILE_REVISION,
    testedRelease: GROK_BUILD_TESTED_RELEASE,
    testedCommit: GROK_BUILD_TESTED_BUILD,
    limitations: [
      'provider-managed-authentication-not-probed',
      'inherited-grok-home',
      'no-acp-image-input',
      'xai-extensions-version-gated',
      'public-source-not-binary-provenance',
      'stable-artifact-reports-alpha-channel',
      'veritas-stdio-transport-only',
    ],
  };
  return {
    ...probe,
    runtimeProfile: {
      ...payload,
      digest: `sha256:${createHash('sha256').update(stableJson(payload)).digest('hex')}`,
    },
  };
}

function boundedCopilotArgumentValue(
  flag: string,
  value: string | undefined,
  maxLength: number
): string {
  const normalized = value?.trim() ?? '';
  const containsControlCharacter = [...normalized].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (!normalized || normalized.length > maxLength || containsControlCharacter) {
    throw new ConflictError(`Copilot ACP ${flag} requires a bounded non-empty value.`);
  }
  return normalized;
}

function boundedGrokBuildArgumentValue(
  flag: string,
  value: string | undefined,
  maxLength: number
): string {
  const normalized = value?.trim() ?? '';
  const containsControlCharacter = [...normalized].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (!normalized || normalized.length > maxLength || containsControlCharacter) {
    throw new ConflictError(`Grok Build ACP ${flag} requires a bounded non-empty value.`);
  }
  return normalized;
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

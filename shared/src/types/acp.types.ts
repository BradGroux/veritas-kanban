export const ACP_PROTOCOL_VERSION = 1 as const;
export const ACP_PROTOCOL_ID = 'acp/v1' as const;

export const ACP_METHODS = {
  agent: {
    initialize: 'initialize',
    sessionNew: 'session/new',
    sessionLoad: 'session/load',
    sessionResume: 'session/resume',
    sessionFork: 'session/fork',
    sessionClose: 'session/close',
    sessionPrompt: 'session/prompt',
    sessionCancel: 'session/cancel',
  },
  client: {
    sessionUpdate: 'session/update',
    requestPermission: 'session/request_permission',
  },
} as const;

export type AcpMeta = Record<string, unknown>;
export type AcpJsonRpcId = string | number;

export interface AcpJsonRpcRequest {
  jsonrpc: '2.0';
  id: AcpJsonRpcId;
  method: string;
  params?: unknown;
}

export interface AcpJsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface AcpJsonRpcSuccess {
  jsonrpc: '2.0';
  id: AcpJsonRpcId;
  result: unknown;
}

export interface AcpJsonRpcFailure {
  jsonrpc: '2.0';
  id: AcpJsonRpcId | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type AcpJsonRpcMessage =
  AcpJsonRpcRequest | AcpJsonRpcNotification | AcpJsonRpcSuccess | AcpJsonRpcFailure;

export interface AcpImplementation {
  name: string;
  title?: string | null;
  version?: string | null;
  _meta?: AcpMeta | null;
}

export interface AcpSessionCapabilities {
  list?: Record<string, never> | null;
  delete?: Record<string, never> | null;
  additionalDirectories?: Record<string, never> | null;
  fork?: Record<string, never> | null;
  resume?: Record<string, never> | null;
  close?: Record<string, never> | null;
  _meta?: AcpMeta | null;
}

export interface AcpAgentCapabilities {
  loadSession?: boolean;
  promptCapabilities?: {
    image?: boolean;
    audio?: boolean;
    embeddedContext?: boolean;
    _meta?: AcpMeta | null;
  };
  mcpCapabilities?: {
    http?: boolean;
    sse?: boolean;
    _meta?: AcpMeta | null;
  };
  sessionCapabilities?: AcpSessionCapabilities;
  _meta?: AcpMeta | null;
}

export interface AcpClientCapabilities {
  fs?: {
    readTextFile?: boolean;
    writeTextFile?: boolean;
    _meta?: AcpMeta | null;
  };
  terminal?: boolean;
  session?: Record<string, unknown> | null;
  _meta?: AcpMeta | null;
}

export interface AcpInitializeRequest {
  protocolVersion: number;
  clientCapabilities?: AcpClientCapabilities;
  clientInfo?: AcpImplementation | null;
  _meta?: AcpMeta | null;
}

export interface AcpInitializeResponse {
  protocolVersion: number;
  agentCapabilities?: AcpAgentCapabilities;
  authMethods?: unknown[];
  agentInfo?: AcpImplementation | null;
  _meta?: AcpMeta | null;
}

export type AcpMcpServer =
  | {
      name: string;
      command: string;
      args: string[];
      env: Array<{ name: string; value: string; _meta?: AcpMeta | null }>;
      _meta?: AcpMeta | null;
    }
  | {
      type: 'http' | 'sse';
      name: string;
      url: string;
      headers: Array<{ name: string; value: string; _meta?: AcpMeta | null }>;
      _meta?: AcpMeta | null;
    };

export interface AcpNewSessionRequest {
  cwd: string;
  additionalDirectories?: string[];
  mcpServers: AcpMcpServer[];
  _meta?: AcpMeta | null;
}

export interface AcpNewSessionResponse {
  sessionId: string;
  modes?: unknown;
  configOptions?: unknown[];
  _meta?: AcpMeta | null;
}

export interface AcpExistingSessionRequest {
  sessionId: string;
  cwd: string;
  additionalDirectories?: string[];
  mcpServers?: AcpMcpServer[];
  _meta?: AcpMeta | null;
}

export interface AcpSessionIdentityRequest {
  sessionId: string;
  _meta?: AcpMeta | null;
}

export type AcpContentBlock =
  | {
      type: 'text';
      text: string;
      annotations?: unknown;
      _meta?: AcpMeta | null;
    }
  | {
      type: 'resource_link';
      uri: string;
      name: string;
      description?: string | null;
      mimeType?: string | null;
      title?: string | null;
      size?: number | null;
      annotations?: unknown;
      _meta?: AcpMeta | null;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

export interface AcpPromptRequest {
  sessionId: string;
  prompt: AcpContentBlock[];
  _meta?: AcpMeta | null;
}

export type AcpStopReason =
  'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';

export interface AcpPromptResponse {
  stopReason: AcpStopReason;
  usage?: unknown;
  _meta?: AcpMeta | null;
}

export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
  _meta?: AcpMeta | null;
}

export interface AcpToolCall {
  toolCallId: string;
  title?: string | null;
  name?: string | null;
  kind?: string | null;
  status?: string | null;
  content?: unknown[] | null;
  locations?: Array<{ path: string; line?: number | null }> | null;
  rawInput?: unknown;
  rawOutput?: unknown;
  _meta?: AcpMeta | null;
}

export interface AcpRequestPermissionRequest {
  sessionId: string;
  toolCall: AcpToolCall;
  options: AcpPermissionOption[];
  _meta?: AcpMeta | null;
}

export interface AcpRequestPermissionResponse {
  outcome:
    | { outcome: 'cancelled' }
    | {
        outcome: 'selected';
        optionId: string;
      };
  _meta?: AcpMeta | null;
}

export type AcpSessionUpdate =
  | {
      sessionUpdate: 'user_message_chunk' | 'agent_message_chunk' | 'agent_thought_chunk';
      content: AcpContentBlock;
      messageId?: string | null;
      _meta?: AcpMeta | null;
    }
  | ({
      sessionUpdate: 'tool_call' | 'tool_call_update';
    } & AcpToolCall)
  | {
      sessionUpdate: 'plan';
      entries: Array<{
        content: string;
        priority: 'high' | 'medium' | 'low';
        status: 'pending' | 'in_progress' | 'completed';
      }>;
      _meta?: AcpMeta | null;
    }
  | {
      sessionUpdate: string;
      [key: string]: unknown;
    };

export interface AcpSessionNotification {
  sessionId: string;
  update: AcpSessionUpdate;
  _meta?: AcpMeta | null;
}

export interface AcpRuntimeProbe {
  protocolVersion: typeof ACP_PROTOCOL_VERSION;
  agentInfo: AcpImplementation;
  capabilities: AcpAgentCapabilities;
  capabilityDigest: string;
}

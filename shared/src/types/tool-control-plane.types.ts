import type { ExecutableAgentProvider } from './config.types.js';

export const TOOL_SERVER_DEFINITION_SCHEMA_VERSION = 'tool-server-definition/v1' as const;
export const TOOL_DISCOVERY_SCHEMA_VERSION = 'tool-server-discovery/v1' as const;
export const RUN_TOOL_CATALOG_SCHEMA_VERSION = 'run-tool-catalog/v1' as const;

export type ToolServerApprovalMode = 'never' | 'always';
export type ToolServerRequirement = 'required' | 'optional';
export type ToolServerTransportKind = 'stdio' | 'http';

export interface ToolServerStdioTransport {
  kind: 'stdio';
  command: string;
  args: string[];
  /** Environment key names only. Values are resolved at dispatch and never persisted. */
  environmentKeys: string[];
  /** Credential broker definition references only. Raw values are forbidden. */
  credentialReferences: string[];
}

export interface ToolServerHttpHeaderReference {
  name: string;
  /** Environment key name only. The value is resolved at dispatch. */
  environmentKey: string;
}

export interface ToolServerHttpTransport {
  kind: 'http';
  url: string;
  headers: ToolServerHttpHeaderReference[];
  /** Credential broker definition references only. Raw values are forbidden. */
  credentialReferences: string[];
}

export type ToolServerTransport = ToolServerStdioTransport | ToolServerHttpTransport;

export interface ToolServerDefinitionInput {
  id: string;
  version: string;
  displayName: string;
  description?: string;
  enabled: boolean;
  transport: ToolServerTransport;
  requirement: ToolServerRequirement;
  startupTimeoutMs: number;
  toolTimeoutMs: number;
  allowedTools: string[];
  deniedTools: string[];
  approvalRequiredTools: string[];
  approvalMode: ToolServerApprovalMode;
}

export interface ToolServerDefinition extends ToolServerDefinitionInput {
  schemaVersion: typeof TOOL_SERVER_DEFINITION_SCHEMA_VERSION;
  digest: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolDiscoveryEntry {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  inputSchemaDigest: string;
}

export interface ToolServerDiscovery {
  schemaVersion: typeof TOOL_DISCOVERY_SCHEMA_VERSION;
  serverId: string;
  serverVersion: string;
  definitionDigest: string;
  protocolVersion: string;
  status: 'ready' | 'failed';
  tools: ToolDiscoveryEntry[];
  error?: string;
  discoveredAt: string;
  digest: string;
}

export type RunToolPolicyDecision = 'allow' | 'deny' | 'approval';

export interface RunToolCatalogEntry {
  serverId: string;
  serverVersion: string;
  definitionDigest: string;
  discoveryDigest: string;
  transport: ToolServerTransportKind;
  requirement: ToolServerRequirement;
  status: 'ready' | 'degraded';
  tools: Array<{
    name: string;
    qualifiedName: string;
    description?: string;
    inputSchema: Record<string, unknown>;
    inputSchemaDigest: string;
    decision: RunToolPolicyDecision;
  }>;
  error?: string;
}

/**
 * Immutable catalog compiled before provider dispatch.
 *
 * The catalog contains only metadata and references. Environment values,
 * credential values, process handles, and transport session IDs are excluded.
 */
export interface RunToolCatalog {
  schemaVersion: typeof RUN_TOOL_CATALOG_SCHEMA_VERSION;
  taskId: string;
  attemptId: string;
  provider: ExecutableAgentProvider;
  providerRuntimeManifestDigest: string;
  taskEnvelopeDigest: string;
  entries: RunToolCatalogEntry[];
  createdAt: string;
  digest: string;
}

export interface ToolInvocationRequest {
  taskId: string;
  attemptId: string;
  serverId: string;
  tool: string;
  arguments: Record<string, unknown>;
  operationId: string;
  approvalId?: string;
}

export interface ToolInvocationResult {
  serverId: string;
  tool: string;
  operationId: string;
  content: unknown;
  isError: boolean;
  eventId: string;
}

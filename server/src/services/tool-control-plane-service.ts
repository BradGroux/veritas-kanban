import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import { Ajv, type ValidateFunction } from 'ajv';
import {
  RUN_TOOL_CATALOG_SCHEMA_VERSION,
  TOOL_DISCOVERY_SCHEMA_VERSION,
  TOOL_SERVER_DEFINITION_SCHEMA_VERSION,
  type ExecutableAgentProvider,
  type AcpMcpServer,
  type CredentialAction,
  type CredentialDefinition,
  type RunToolCatalog,
  type RunToolCatalogEntry,
  type RunToolCredentialBinding,
  type ToolInvocationRequest,
  type ToolInvocationResult,
  type ToolServerDefinition,
  type ToolServerDefinitionInput,
  type ToolServerDiscovery,
} from '@veritas-kanban/shared';
import { redactString } from '../lib/redact.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../middleware/error-handler.js';
import {
  runToolCatalogSchema,
  toolServerDefinitionInputSchema,
  toolServerDefinitionSchema,
  toolServerDiscoverySchema,
} from '../schemas/tool-control-plane-schemas.js';
import type { ToolControlPlaneRepository } from '../storage/interfaces.js';
import { FileToolControlPlaneRepository } from '../storage/tool-control-plane-repository.js';
import { getStorage, getStorageTypeFromEnv } from '../storage/index.js';
import {
  calculateRunToolCatalogDigest,
  calculateToolDiscoveryDigest,
  calculateToolServerDefinitionDigest,
} from '../utils/tool-control-plane-digest.js';
import {
  calculateCredentialActionFingerprint,
  calculateCredentialScopeDigest,
} from '../utils/credential-broker-digest.js';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';
import { RunApprovalBrokerService } from './run-approval-broker-service.js';
import { RunEventJournalService } from './run-event-journal-service.js';
import {
  getCredentialBrokerService,
  type CredentialBrokerService,
} from './credential-broker-service.js';

const MCP_PROTOCOL_VERSION = '2025-06-18';
const MAX_RPC_BYTES = 4 * 1024 * 1024;
const MAX_ARGUMENT_BYTES = 64 * 1024;
const MAX_SCHEMA_BYTES = 128 * 1024;
const MAX_DISCOVERY_PAGES = 20;
const MAX_DISCOVERED_TOOLS = 1_000;
const STDIO_TERMINATION_GRACE_MS = 2_000;
const CREDENTIAL_ENV_KEY_PATTERN =
  /(?:^|_)(?:API_KEYS?|AUTHORIZATION|AUTH_TOKEN|BEARER|BEARER_TOKEN|COOKIE|CREDENTIALS?|DATABASE_URL|DB_URL|PASSWORD|PASS|PRIVATE_KEY|SECRET|SESSION|SESSION_TOKEN|TOKEN|WEBHOOK)(?:_|$)/i;

interface RpcSession {
  request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown>;
  notify(method: string, params: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
}

interface ToolControlPlaneRuntime {
  open(
    definition: ToolServerDefinition,
    cwd?: string,
    credentials?: ToolCredentialDelivery
  ): Promise<RpcSession>;
}

interface ToolCredentialDelivery {
  environment: Record<string, string>;
  headers: Record<string, string>;
}

export interface PrepareRunToolCatalogInput {
  taskId: string;
  attemptId: string;
  provider: ExecutableAgentProvider;
  providerRuntimeManifestDigest: string;
  taskEnvelopeDigest: string;
  serverIds: string[];
  allowedTools?: string[];
  deniedTools?: string[];
  cwd?: string;
  persist?: boolean;
}

export interface ToolControlPlaneServiceOptions {
  repository?: ToolControlPlaneRepository;
  runtime?: ToolControlPlaneRuntime;
  journal?: RunEventJournalService;
  approvals?: RunApprovalBrokerService;
  credentialBroker?: Pick<
    CredentialBrokerService,
    'getDefinition' | 'issueLease' | 'withCredential'
  >;
  now?: () => Date;
  environment?: NodeJS.ProcessEnv;
}

let fileRepository: FileToolControlPlaneRepository | undefined;
let singleton: ToolControlPlaneService | undefined;

function defaultRepository(): ToolControlPlaneRepository {
  if (getStorageTypeFromEnv() === 'sqlite') return getStorage().toolControlPlane;
  fileRepository ??= new FileToolControlPlaneRepository();
  return fileRepository;
}

export class ToolControlPlaneService {
  private readonly configuredRepository?: ToolControlPlaneRepository;
  private readonly runtime: ToolControlPlaneRuntime;
  private readonly journal: RunEventJournalService;
  private readonly approvals: RunApprovalBrokerService;
  private readonly credentialBroker: Pick<
    CredentialBrokerService,
    'getDefinition' | 'issueLease' | 'withCredential'
  >;
  private readonly now: () => Date;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly sessions = new Map<string, Promise<RpcSession>>();
  private readonly validators = new Map<string, ValidateFunction>();

  constructor(options: ToolControlPlaneServiceOptions = {}) {
    this.configuredRepository = options.repository;
    this.environment = options.environment ?? process.env;
    this.runtime = options.runtime ?? new McpJsonRpcRuntime(this.environment);
    this.journal = options.journal ?? new RunEventJournalService();
    this.approvals = options.approvals ?? new RunApprovalBrokerService();
    this.credentialBroker = options.credentialBroker ?? getCredentialBrokerService();
    this.now = options.now ?? (() => new Date());
  }

  async listDefinitions(): Promise<ToolServerDefinition[]> {
    return this.repository().listDefinitions();
  }

  async getDefinition(id: string): Promise<ToolServerDefinition> {
    const definition = await this.repository().getDefinition(id);
    if (!definition) throw new NotFoundError('Tool server definition not found.');
    return definition;
  }

  async createDefinition(input: ToolServerDefinitionInput): Promise<ToolServerDefinition> {
    const parsed = toolServerDefinitionInputSchema.parse(input);
    assertSafeDefinition(parsed);
    if (await this.repository().getDefinition(parsed.id)) {
      throw new ConflictError('Tool server definition already exists.');
    }
    const now = this.now().toISOString();
    const definition = toolServerDefinitionSchema.parse({
      ...parsed,
      schemaVersion: TOOL_SERVER_DEFINITION_SCHEMA_VERSION,
      digest: calculateToolServerDefinitionDigest(parsed),
      createdAt: now,
      updatedAt: now,
    });
    return this.repository().saveDefinition(definition);
  }

  async updateDefinition(
    id: string,
    input: ToolServerDefinitionInput
  ): Promise<ToolServerDefinition> {
    const current = await this.getDefinition(id);
    const parsed = toolServerDefinitionInputSchema.parse(input);
    assertSafeDefinition(parsed);
    if (parsed.id !== id) throw new ValidationError('Definition ID cannot be changed.');
    const definition = toolServerDefinitionSchema.parse({
      ...parsed,
      schemaVersion: TOOL_SERVER_DEFINITION_SCHEMA_VERSION,
      digest: calculateToolServerDefinitionDigest(parsed),
      createdAt: current.createdAt,
      updatedAt: this.now().toISOString(),
    });
    return this.repository().saveDefinition(definition);
  }

  async deleteDefinition(id: string): Promise<void> {
    if (!(await this.repository().deleteDefinition(id))) {
      throw new NotFoundError('Tool server definition not found.');
    }
  }

  async discover(id: string, force = false, cwd?: string): Promise<ToolServerDiscovery> {
    const definition = await this.getDefinition(id);
    if (!definition.enabled) throw new ConflictError('Tool server definition is disabled.');
    const runtimeDefinition = await this.credentialFreeDiscoveryDefinition(definition);
    const cached = await this.repository().getDiscovery(definition.digest);

    let session: RpcSession | undefined;
    let discovery: ToolServerDiscovery;
    try {
      session = await this.runtime.open(runtimeDefinition, cwd);
      const protocolVersion = await initializeSession(
        session,
        definition.startupTimeoutMs,
        definition.version
      );
      if (cached?.status === 'ready' && !force) return cached;
      const tools = await listAllTools(session, definition.startupTimeoutMs);
      const normalizedTools = tools
        .map((tool) => normalizeDiscoveredTool(tool))
        .sort((left, right) => left.name.localeCompare(right.name));
      if (new Set(normalizedTools.map((tool) => tool.name)).size !== normalizedTools.length) {
        throw new Error('MCP tools/list returned duplicate tool names.');
      }
      for (const tool of normalizedTools) {
        this.validatorFor(tool.inputSchemaDigest, tool.inputSchema);
      }
      const payload: ToolServerDiscovery = {
        schemaVersion: TOOL_DISCOVERY_SCHEMA_VERSION,
        serverId: definition.id,
        serverVersion: definition.version,
        definitionDigest: definition.digest,
        protocolVersion,
        status: 'ready',
        tools: normalizedTools,
        discoveredAt: this.now().toISOString(),
        digest: 'sha256:'.padEnd(71, '0'),
      };
      discovery = toolServerDiscoverySchema.parse({
        ...payload,
        digest: calculateToolDiscoveryDigest(payload),
      });
    } catch (error) {
      const payload: ToolServerDiscovery = {
        schemaVersion: TOOL_DISCOVERY_SCHEMA_VERSION,
        serverId: definition.id,
        serverVersion: definition.version,
        definitionDigest: definition.digest,
        protocolVersion: MCP_PROTOCOL_VERSION,
        status: 'failed',
        tools: [],
        error: boundedError(error),
        discoveredAt: this.now().toISOString(),
        digest: 'sha256:'.padEnd(71, '0'),
      };
      discovery = toolServerDiscoverySchema.parse({
        ...payload,
        digest: calculateToolDiscoveryDigest(payload),
      });
    } finally {
      await session?.close().catch(() => undefined);
    }
    return this.repository().saveDiscovery(discovery);
  }

  async prepareRunCatalog(input: PrepareRunToolCatalogInput): Promise<RunToolCatalog | undefined> {
    const serverIds = [...new Set(input.serverIds)].sort();
    if (serverIds.length === 0) return undefined;
    const allowed = new Set(input.allowedTools ?? []);
    const denied = new Set(input.deniedTools ?? []);
    const entries: RunToolCatalogEntry[] = [];

    for (const serverId of serverIds) {
      const definition = await this.getDefinition(serverId);
      if (!definition.enabled) {
        if (definition.requirement === 'required') {
          throw new ConflictError(`Required tool server ${serverId} is disabled.`);
        }
        entries.push(degradedEntry(definition, 'Tool server definition is disabled.'));
        continue;
      }
      let discovery: ToolServerDiscovery;
      try {
        discovery = await this.discover(serverId, false, input.cwd);
      } catch (error) {
        const message = boundedError(error);
        if (definition.requirement === 'required') {
          throw new ConflictError(`Required tool server ${serverId} failed discovery.`, {
            error: message,
          });
        }
        entries.push(degradedEntry(definition, message));
        continue;
      }
      if (discovery.status !== 'ready') {
        if (definition.requirement === 'required') {
          throw new ConflictError(`Required tool server ${serverId} failed discovery.`, {
            error: discovery.error,
          });
        }
        entries.push(
          degradedEntry(definition, discovery.error ?? 'Tool discovery failed.', discovery)
        );
        continue;
      }
      const catalogTools = discovery.tools.map((tool) => {
        const qualifiedName = `${definition.id}/${tool.name}`;
        const definitionAllows =
          definition.allowedTools.length === 0 ||
          definition.allowedTools.includes('*') ||
          matchesTool(definition.allowedTools, tool.name, qualifiedName);
        const runAllows =
          allowed.size === 0 ||
          allowed.has('*') ||
          allowed.has(tool.name) ||
          allowed.has(qualifiedName);
        const isDenied =
          matchesTool(definition.deniedTools, tool.name, qualifiedName) ||
          denied.has(tool.name) ||
          denied.has(qualifiedName);
        const approval =
          definition.approvalMode === 'always' ||
          matchesTool(definition.approvalRequiredTools, tool.name, qualifiedName);
        return {
          ...tool,
          qualifiedName,
          decision:
            !definitionAllows || !runAllows || isDenied
              ? ('deny' as const)
              : approval
                ? ('approval' as const)
                : ('allow' as const),
        };
      });
      const brokeredToolNames = new Set(
        catalogTools.filter((tool) => tool.decision !== 'deny').map((tool) => tool.name)
      );
      let credentialBindings: RunToolCredentialBinding[];
      try {
        credentialBindings = await this.compileCredentialBindings(definition, {
          ...discovery,
          tools: discovery.tools.filter((tool) => brokeredToolNames.has(tool.name)),
        });
      } catch (error) {
        const message = boundedError(error);
        if (definition.requirement === 'required') {
          throw new ConflictError(
            `Required tool server ${serverId} has invalid credential boundary evidence.`,
            { error: message }
          );
        }
        entries.push(degradedEntry(definition, message, discovery));
        continue;
      }
      entries.push({
        serverId: definition.id,
        serverVersion: definition.version,
        definitionDigest: definition.digest,
        discoveryDigest: discovery.digest,
        transport: definition.transport.kind,
        requirement: definition.requirement,
        status: 'ready',
        ...(credentialBindings.length > 0 ? { credentialBindings } : {}),
        tools: catalogTools,
      });
    }

    const payload: RunToolCatalog = {
      schemaVersion: RUN_TOOL_CATALOG_SCHEMA_VERSION,
      taskId: input.taskId,
      attemptId: input.attemptId,
      provider: input.provider,
      providerRuntimeManifestDigest: input.providerRuntimeManifestDigest,
      taskEnvelopeDigest: input.taskEnvelopeDigest,
      entries,
      createdAt: this.now().toISOString(),
      digest: 'sha256:'.padEnd(71, '0'),
    };
    const catalog = runToolCatalogSchema.parse({
      ...payload,
      digest: calculateRunToolCatalogDigest(payload),
    });
    if (input.persist === false) return catalog;
    const persisted = await this.repository().saveRunCatalog(catalog);
    for (const entry of persisted.entries.filter((candidate) => candidate.status === 'degraded')) {
      await this.journal.append({
        taskId: persisted.taskId,
        attemptId: persisted.attemptId,
        providerEventId: `tool-discovery:${entry.serverId}`,
        kind: 'run.error',
        source: {
          provider: persisted.provider,
          adapter: 'tool-control-plane',
        },
        payload: {
          serverId: entry.serverId,
          serverVersion: entry.serverVersion,
          optional: true,
          error: entry.error ?? 'Optional tool server is degraded.',
          phase: 'tool-discovery',
          catalogDigest: persisted.digest,
        },
        dedupeKey: `tool-control-plane:${persisted.digest}:${entry.serverId}:degraded`,
      });
    }
    return persisted;
  }

  async getRunCatalog(taskId: string, attemptId: string): Promise<RunToolCatalog> {
    const catalog = await this.repository().getRunCatalog(taskId, attemptId);
    if (!catalog) throw new NotFoundError('Run tool catalog not found.');
    return catalog;
  }

  async invoke(
    request: ToolInvocationRequest,
    actorId: string,
    cwd?: string,
    runLaunchManifestDigest?: string
  ): Promise<ToolInvocationResult> {
    const catalog = await this.getRunCatalog(request.taskId, request.attemptId);
    const entry = catalog.entries.find((candidate) => candidate.serverId === request.serverId);
    if (!entry || entry.status !== 'ready') {
      throw new ConflictError('Tool server is not ready in the exact run catalog.');
    }
    const tool = entry.tools.find(
      (candidate) => candidate.name === request.tool || candidate.qualifiedName === request.tool
    );
    if (!tool) throw new NotFoundError('Tool is not present in the exact run catalog.');
    if (tool.decision === 'deny') {
      throw new ForbiddenError('Tool policy denies this run-scoped tool call.');
    }
    assertBoundedJson(request.arguments, MAX_ARGUMENT_BYTES, 'Tool arguments');
    const validateArguments = this.validatorFor(tool.inputSchemaDigest, tool.inputSchema);
    if (!validateArguments(request.arguments)) {
      throw new ValidationError('Tool arguments do not match the discovered input schema.', {
        errors: validateArguments.errors,
      });
    }
    const definition = await this.getCatalogDefinition(entry);
    const credentialBound = (entry.credentialBindings?.length ?? 0) > 0;
    const credentialAction = credentialBound
      ? this.credentialAction(catalog, entry, tool.name, request.arguments)
      : undefined;
    const credentialActionFingerprint = credentialAction
      ? calculateCredentialActionFingerprint(credentialAction)
      : undefined;
    const credentialApprovalRequired =
      credentialBound && (await this.credentialApprovalRequired(entry));
    let approvedRequestId: string | undefined;

    if (tool.decision === 'approval' || credentialApprovalRequired) {
      const providerRequestId = credentialActionFingerprint
        ? `tool:${request.operationId}:${credentialActionFingerprint}`
        : `tool:${request.operationId}`;
      const approval = await this.approvals.request({
        taskId: request.taskId,
        attemptId: request.attemptId,
        provider: catalog.provider,
        agentId: actorId,
        requestKind: 'approval',
        actionClass: 'tool',
        action: `${entry.serverId}/${tool.name}`,
        exactAction: {
          serverId: entry.serverId,
          tool: tool.name,
          arguments: request.arguments,
          catalogDigest: catalog.digest,
          ...(credentialActionFingerprint ? { credentialActionFingerprint } : {}),
        },
        resourceScope: [entry.serverId, tool.name],
        riskClass: 'high',
        evidenceRevision: catalog.digest,
        providerRequestId,
        mobileSafe: false,
      });
      if (request.approvalId && request.approvalId !== approval.id) {
        throw new ConflictError('Approval identity does not match this exact tool call.');
      }
      if (approval.status !== 'approved') {
        throw new ConflictError('Tool call requires an approved run approval.', {
          approvalId: approval.id,
          status: approval.status,
          revision: approval.revision,
          actionHash: approval.actionHash,
        });
      }
      approvedRequestId = approval.id;
    }

    const started = await this.journal.append({
      taskId: request.taskId,
      attemptId: request.attemptId,
      providerEventId: request.operationId,
      kind: 'tool.started',
      source: {
        provider: catalog.provider,
        adapter: 'tool-control-plane',
        agent: actorId,
      },
      payload: {
        serverId: entry.serverId,
        tool: tool.name,
        arguments: request.arguments,
        catalogDigest: catalog.digest,
      },
      dedupeKey: `tool-control-plane:${request.operationId}:started`,
    });
    if (!started.appended) {
      throw new ConflictError('Tool operation was already dispatched.', {
        operationId: request.operationId,
        eventId: started.event.eventId,
      });
    }

    const sessionKey = `${request.taskId}:${request.attemptId}:${entry.serverId}`;
    let sessionPromise: Promise<RpcSession> | undefined;
    let session: RpcSession | undefined;
    try {
      let response: unknown;
      if (credentialBound && credentialAction) {
        if (!runLaunchManifestDigest) {
          throw new ConflictError(
            'Credential-bound tool calls require the server-owned launch manifest digest.'
          );
        }
        response = await this.withCredentialDelivery({
          request,
          entry,
          action: credentialAction,
          runLaunchManifestDigest,
          approvalId: approvedRequestId,
          dispatch: async (credentials) => {
            session = await this.openSession(definition, cwd, credentials);
            try {
              return await session.request(
                'tools/call',
                { name: tool.name, arguments: request.arguments },
                definition.toolTimeoutMs
              );
            } finally {
              await session.close().catch(() => undefined);
              session = undefined;
            }
          },
        });
      } else {
        sessionPromise = this.sessions.get(sessionKey);
        if (!sessionPromise) {
          sessionPromise = this.openSession(definition, cwd);
          this.sessions.set(sessionKey, sessionPromise);
        }
        session = await sessionPromise;
        response = await session.request(
          'tools/call',
          { name: tool.name, arguments: request.arguments },
          definition.toolTimeoutMs
        );
      }
      assertBoundedJson(response, MAX_RPC_BYTES, 'Tool result');
      const resultRecord =
        response && typeof response === 'object' && !Array.isArray(response)
          ? (response as Record<string, unknown>)
          : { content: response };
      const completed = await this.journal.append({
        taskId: request.taskId,
        attemptId: request.attemptId,
        providerEventId: request.operationId,
        causalEventId: started.event.eventId,
        kind: 'tool.completed',
        source: {
          provider: catalog.provider,
          adapter: 'tool-control-plane',
          agent: actorId,
        },
        payload: {
          serverId: entry.serverId,
          tool: tool.name,
          result: resultRecord,
          isError: resultRecord.isError === true,
          catalogDigest: catalog.digest,
        },
        dedupeKey: `tool-control-plane:${request.operationId}:completed`,
      });
      return {
        serverId: entry.serverId,
        tool: tool.name,
        operationId: request.operationId,
        content: resultRecord.content ?? response,
        isError: resultRecord.isError === true,
        eventId: completed.event.eventId,
      };
    } catch (error) {
      await this.journal.append({
        taskId: request.taskId,
        attemptId: request.attemptId,
        providerEventId: request.operationId,
        causalEventId: started.event.eventId,
        kind: 'run.error',
        source: {
          provider: catalog.provider,
          adapter: 'tool-control-plane',
          agent: actorId,
        },
        payload: {
          serverId: entry.serverId,
          tool: tool.name,
          error: boundedError(error),
          phase: 'tool-call',
        },
        dedupeKey: `tool-control-plane:${request.operationId}:failed`,
      });
      await session?.close().catch(() => undefined);
      if (sessionPromise && this.sessions.get(sessionKey) === sessionPromise) {
        this.sessions.delete(sessionKey);
      }
      throw error;
    }
  }

  async closeRun(taskId: string, attemptId: string): Promise<void> {
    const prefix = `${taskId}:${attemptId}:`;
    await this.closeSessions(
      [...this.sessions.entries()].filter(([key]) => key.startsWith(prefix))
    );
  }

  async closeAll(): Promise<void> {
    await this.closeSessions([...this.sessions.entries()]);
  }

  private async closeSessions(matching: Array<[string, Promise<RpcSession>]>): Promise<void> {
    for (const [key, promise] of matching) {
      if (this.sessions.get(key) === promise) this.sessions.delete(key);
    }
    const opened = await Promise.allSettled(matching.map(([, session]) => session));
    await Promise.allSettled(
      opened.flatMap((result) => (result.status === 'fulfilled' ? [result.value.close()] : []))
    );
  }

  async providerConfig(catalog: RunToolCatalog): Promise<Record<string, unknown>> {
    const servers: Record<string, unknown> = {};
    for (const entry of catalog.entries.filter((candidate) => candidate.status === 'ready')) {
      const definition = await this.getCatalogDefinition(entry);
      if ((entry.credentialBindings?.length ?? 0) > 0) continue;
      const allowedTools = entry.tools
        .filter((tool) => tool.decision === 'allow')
        .map((tool) => tool.name);
      const disabledTools = entry.tools
        .filter((tool) => tool.decision !== 'allow')
        .map((tool) => tool.name);
      servers[entry.serverId] =
        definition.transport.kind === 'stdio'
          ? {
              command: definition.transport.command,
              args: definition.transport.args,
              enabled: true,
              required: definition.requirement === 'required',
              env_vars: definition.transport.environmentKeys,
              default_tools_approval_mode: 'approve',
              startup_timeout_sec: definition.startupTimeoutMs / 1_000,
              tool_timeout_sec: definition.toolTimeoutMs / 1_000,
              enabled_tools: allowedTools,
              disabled_tools: disabledTools,
            }
          : {
              url: definition.transport.url,
              enabled: true,
              required: definition.requirement === 'required',
              default_tools_approval_mode: 'approve',
              startup_timeout_sec: definition.startupTimeoutMs / 1_000,
              tool_timeout_sec: definition.toolTimeoutMs / 1_000,
              enabled_tools: allowedTools,
              disabled_tools: disabledTools,
            };
    }
    return servers;
  }

  async claudeConfig(catalog: RunToolCatalog): Promise<{
    config: Record<string, unknown>;
    allowedToolNames: string[];
  }> {
    const servers: Record<string, unknown> = {};
    const allowedToolNames: string[] = [];
    for (const entry of catalog.entries.filter((candidate) => candidate.status === 'ready')) {
      const definition = await this.getCatalogDefinition(entry);
      if ((entry.credentialBindings?.length ?? 0) > 0) continue;
      servers[entry.serverId] =
        definition.transport.kind === 'stdio'
          ? {
              command: definition.transport.command,
              args: definition.transport.args,
            }
          : {
              type: 'http',
              url: definition.transport.url,
            };
      for (const tool of entry.tools.filter((candidate) => candidate.decision === 'allow')) {
        allowedToolNames.push(`mcp__${entry.serverId}__${tool.name}`);
      }
    }
    return {
      config: { mcpServers: servers },
      allowedToolNames: allowedToolNames.sort(),
    };
  }

  async acpConfig(
    catalog: RunToolCatalog,
    environment: NodeJS.ProcessEnv = process.env
  ): Promise<AcpMcpServer[]> {
    const servers: AcpMcpServer[] = [];
    for (const entry of catalog.entries.filter((candidate) => candidate.status === 'ready')) {
      if ((entry.credentialBindings?.length ?? 0) > 0) {
        await this.getCatalogDefinition(entry);
        continue;
      }
      const restricted = entry.tools.filter((tool) => tool.decision !== 'allow');
      if (restricted.length > 0) {
        throw new ConflictError(
          'ACP v1 cannot enforce a partially restricted native MCP tool catalog.',
          {
            serverId: entry.serverId,
            restrictedTools: restricted.map((tool) => tool.name),
            remediation:
              'Use an all-allow server catalog or route calls through the Veritas tool bridge.',
          }
        );
      }
      const definition = await this.getCatalogDefinition(entry);
      if (definition.transport.kind === 'stdio') {
        if (!path.isAbsolute(definition.transport.command)) {
          throw new ConflictError('ACP v1 requires an absolute stdio MCP server command.', {
            serverId: entry.serverId,
            command: definition.transport.command,
          });
        }
        servers.push({
          name: definition.displayName,
          command: definition.transport.command,
          args: definition.transport.args,
          env: definition.transport.environmentKeys.flatMap((name) => {
            const value = environment[name];
            return typeof value === 'string' ? [{ name, value }] : [];
          }),
        });
      } else {
        servers.push({
          type: 'http',
          name: definition.displayName,
          url: definition.transport.url,
          headers: definition.transport.headers.flatMap((header) => {
            const value = environment[header.environmentKey];
            return typeof value === 'string' ? [{ name: header.name, value }] : [];
          }),
        });
      }
    }
    return servers;
  }

  async environmentKeys(catalog: RunToolCatalog): Promise<string[]> {
    const keys = new Set<string>();
    for (const entry of catalog.entries.filter((candidate) => candidate.status === 'ready')) {
      const definition = await this.getCatalogDefinition(entry);
      if ((entry.credentialBindings?.length ?? 0) > 0) continue;
      if (definition.transport.kind === 'stdio') {
        for (const key of definition.transport.environmentKeys) keys.add(key);
      } else {
        for (const header of definition.transport.headers) keys.add(header.environmentKey);
      }
    }
    return [...keys].sort();
  }

  private repository(): ToolControlPlaneRepository {
    return this.configuredRepository ?? defaultRepository();
  }

  private validatorFor(
    inputSchemaDigest: string,
    inputSchema: Record<string, unknown>
  ): ValidateFunction {
    const cached = this.validators.get(inputSchemaDigest);
    if (cached) return cached;
    let validator: ValidateFunction;
    try {
      validator = new Ajv({
        allErrors: true,
        strict: false,
        validateFormats: false,
      }).compile(inputSchema);
    } catch (error) {
      throw new ValidationError('Discovered tool input schema is not valid JSON Schema.', {
        error: boundedError(error),
        inputSchemaDigest,
      });
    }
    if (this.validators.size >= 5_000) {
      const oldest = this.validators.keys().next().value as string | undefined;
      if (oldest) this.validators.delete(oldest);
    }
    this.validators.set(inputSchemaDigest, validator);
    return validator;
  }

  private credentialAction(
    catalog: RunToolCatalog,
    entry: RunToolCatalogEntry,
    tool: string,
    argumentsValue: Record<string, unknown>
  ): CredentialAction {
    return {
      dispatchType: 'mcp',
      tool,
      action: `${entry.serverId}.${tool}`,
      argumentsDigest: digestRunLaunchValue({
        catalogDigest: catalog.digest,
        serverId: entry.serverId,
        tool,
        arguments: argumentsValue,
      }),
    };
  }

  private async credentialApprovalRequired(entry: RunToolCatalogEntry): Promise<boolean> {
    for (const binding of entry.credentialBindings ?? []) {
      const definition = await this.credentialBroker.getDefinition(binding.credentialReference);
      if (
        !definition ||
        !definition.enabled ||
        definition.digest !== binding.credentialDefinitionDigest
      ) {
        throw new ConflictError('Credential definition changed before approval evaluation.', {
          credentialReference: binding.credentialReference,
          serverId: entry.serverId,
        });
      }
      if (definition.approval === 'required') return true;
    }
    return false;
  }

  private async withCredentialDelivery<T>(input: {
    request: ToolInvocationRequest;
    entry: RunToolCatalogEntry;
    action: CredentialAction;
    runLaunchManifestDigest: string;
    approvalId?: string;
    dispatch: (credentials: ToolCredentialDelivery) => Promise<T>;
  }): Promise<T> {
    const bindings = input.entry.credentialBindings ?? [];
    const delivery: ToolCredentialDelivery = { environment: {}, headers: {} };
    const consume = async (index: number): Promise<T> => {
      const binding = bindings[index];
      if (!binding) return input.dispatch(delivery);
      const issued = await this.credentialBroker.issueLease({
        definitionId: binding.credentialReference,
        taskId: input.request.taskId,
        attemptId: input.request.attemptId,
        runLaunchManifestDigest: input.runLaunchManifestDigest,
        action: input.action,
        approvalId: input.approvalId,
        operationId: input.request.operationId,
      });
      const leaseOperationId = digestRunLaunchValue({
        operationId: input.request.operationId,
        credentialReference: binding.credentialReference,
      });
      return this.credentialBroker.withCredential(
        {
          handle: issued.handle,
          operationId: leaseOperationId,
          taskId: input.request.taskId,
          attemptId: input.request.attemptId,
          runLaunchManifestDigest: input.runLaunchManifestDigest,
          action: input.action,
        },
        async (credential) => {
          if (binding.target.kind === 'environment') {
            delivery.environment[binding.target.name] = credential;
          } else {
            delivery.headers[binding.target.name] = credential;
          }
          return consume(index + 1);
        }
      );
    };
    return consume(0);
  }

  private async openSession(
    definition: ToolServerDefinition,
    cwd?: string,
    credentials?: ToolCredentialDelivery
  ): Promise<RpcSession> {
    const session = await this.runtime.open(definition, cwd, credentials);
    try {
      await initializeSession(session, definition.startupTimeoutMs, definition.version);
      return session;
    } catch (error) {
      await session.close().catch(() => undefined);
      throw error;
    }
  }

  private async getCatalogDefinition(entry: RunToolCatalogEntry): Promise<ToolServerDefinition> {
    const definition = await this.getDefinition(entry.serverId);
    if (
      definition.digest !== entry.definitionDigest ||
      definition.version !== entry.serverVersion ||
      definition.transport.kind !== entry.transport
    ) {
      throw new ConflictError(
        'Tool server definition drifted after the run catalog was compiled.',
        {
          serverId: entry.serverId,
          catalogDefinitionDigest: entry.definitionDigest,
          currentDefinitionDigest: definition.digest,
          remediation: 'Compile a new launch manifest and run tool catalog.',
        }
      );
    }
    await this.assertCredentialEvidence(entry, definition);
    return definition;
  }

  private async credentialFreeDiscoveryDefinition(
    definition: ToolServerDefinition
  ): Promise<ToolServerDefinition> {
    assertSafeDefinition(definition);
    const resolved = await this.resolveCredentialTargets(definition);
    if (definition.transport.kind === 'stdio') {
      const credentialKeys = new Set(
        resolved.flatMap((entry) =>
          entry.binding.target.kind === 'environment' ? [entry.binding.target.name] : []
        )
      );
      const unbound = definition.transport.environmentKeys.filter(
        (key) => isCredentialLikeKey(key) && !credentialKeys.has(key)
      );
      if (unbound.length > 0) {
        throw new ConflictError(
          'Credential-shaped tool server environment keys require exact broker definitions.',
          { serverId: definition.id, environmentKeys: unbound }
        );
      }
      return {
        ...definition,
        transport: {
          ...definition.transport,
          environmentKeys: definition.transport.environmentKeys.filter(
            (key) => !credentialKeys.has(key)
          ),
        },
      };
    }
    const credentialHeaders = new Set(
      resolved.flatMap((entry) =>
        entry.binding.target.kind === 'http-header' ? [entry.binding.target.name.toLowerCase()] : []
      )
    );
    const unbound = definition.transport.headers.filter(
      (header) => !credentialHeaders.has(header.name.toLowerCase())
    );
    if (unbound.length > 0) {
      throw new ConflictError('HTTP tool server headers require exact broker definitions.', {
        serverId: definition.id,
        headerNames: unbound.map((header) => header.name),
      });
    }
    return {
      ...definition,
      transport: {
        ...definition.transport,
        headers: [],
      },
    };
  }

  private async compileCredentialBindings(
    definition: ToolServerDefinition,
    discovery: ToolServerDiscovery
  ): Promise<RunToolCredentialBinding[]> {
    const resolved = await this.resolveCredentialTargets(definition);
    if (resolved.length > 0 && discovery.tools.length === 0) {
      throw new ConflictError(
        'Credential-bound tool server has no callable tools in the exact run policy.',
        { serverId: definition.id }
      );
    }
    for (const { credential } of resolved) {
      const scope = credential.scope;
      if (
        scope.hosts.length > 0 ||
        scope.destinations.length > 0 ||
        scope.methods.length > 0 ||
        scope.pathPrefixes.length > 0
      ) {
        throw new ConflictError(
          'MCP credential definitions cannot require HTTP-only scope dimensions.',
          { credentialReference: credential.id, serverId: definition.id }
        );
      }
      for (const tool of discovery.tools) {
        const qualifiedName = `${definition.id}/${tool.name}`;
        const credentialAction = `${definition.id}.${tool.name}`;
        if (
          scope.tools.length > 0 &&
          !scope.tools.includes(tool.name) &&
          !scope.tools.includes(qualifiedName)
        ) {
          throw new ConflictError('Credential definition does not accept every discovered tool.', {
            credentialReference: credential.id,
            serverId: definition.id,
            tool: tool.name,
          });
        }
        if (
          scope.actions.length > 0 &&
          !scope.actions.includes(tool.name) &&
          !scope.actions.includes(credentialAction)
        ) {
          throw new ConflictError(
            'Credential definition does not accept every discovered MCP action.',
            {
              credentialReference: credential.id,
              serverId: definition.id,
              action: credentialAction,
            }
          );
        }
      }
    }
    return resolved.map((entry) => entry.binding);
  }

  private async resolveCredentialTargets(definition: ToolServerDefinition): Promise<
    Array<{
      credential: CredentialDefinition;
      binding: RunToolCredentialBinding;
    }>
  > {
    const resolved: Array<{
      credential: CredentialDefinition;
      binding: RunToolCredentialBinding;
    }> = [];
    const targetKeys = new Set<string>();
    for (const reference of [...definition.transport.credentialReferences].sort()) {
      const credential = await this.credentialBroker.getDefinition(reference);
      if (!credential) {
        throw new ConflictError('Tool server credential definition was not found.', {
          serverId: definition.id,
          credentialReference: reference,
        });
      }
      if (!credential.enabled) {
        throw new ConflictError('Tool server credential definition is disabled.', {
          serverId: definition.id,
          credentialReference: reference,
        });
      }
      if (!credential.scope.dispatchTypes.includes('mcp')) {
        throw new ConflictError('Tool server credential definition does not allow MCP dispatch.', {
          serverId: definition.id,
          credentialReference: reference,
        });
      }
      if (credential.source.kind !== 'environment') {
        throw new ConflictError(
          'External credential sources require an explicit bridge target mapping.',
          { serverId: definition.id, credentialReference: reference }
        );
      }
      let target: RunToolCredentialBinding['target'];
      if (definition.transport.kind === 'stdio') {
        if (!definition.transport.environmentKeys.includes(credential.source.reference)) {
          throw new ConflictError(
            'Credential source key is not an environment target on the stdio tool server.',
            { serverId: definition.id, credentialReference: reference }
          );
        }
        target = { kind: 'environment', name: credential.source.reference };
      } else {
        const matches = definition.transport.headers.filter(
          (header) => header.environmentKey === credential.source.reference
        );
        if (matches.length !== 1) {
          throw new ConflictError(
            'Credential source key must map to exactly one HTTP tool server header.',
            { serverId: definition.id, credentialReference: reference }
          );
        }
        target = { kind: 'http-header', name: matches[0].name };
      }
      const targetKey = `${target.kind}:${target.name.toLowerCase()}`;
      if (targetKeys.has(targetKey)) {
        throw new ConflictError('Tool server credential target is ambiguous.', {
          serverId: definition.id,
          target,
        });
      }
      targetKeys.add(targetKey);
      resolved.push({
        credential,
        binding: {
          credentialReference: credential.id,
          credentialDefinitionDigest: credential.digest,
          scopeDigest: calculateCredentialScopeDigest(credential.scope),
          target,
        },
      });
    }
    return resolved.sort((left, right) =>
      left.binding.credentialReference.localeCompare(right.binding.credentialReference)
    );
  }

  private async assertCredentialEvidence(
    entry: RunToolCatalogEntry,
    definition: ToolServerDefinition
  ): Promise<void> {
    const current = await this.compileCredentialBindings(definition, {
      schemaVersion: TOOL_DISCOVERY_SCHEMA_VERSION,
      serverId: entry.serverId,
      serverVersion: entry.serverVersion,
      definitionDigest: entry.definitionDigest,
      protocolVersion: MCP_PROTOCOL_VERSION,
      status: 'ready',
      tools: entry.tools
        .filter((tool) => tool.decision !== 'deny')
        .map(({ name, description, inputSchema, inputSchemaDigest }) => ({
          name,
          ...(description ? { description } : {}),
          inputSchema,
          inputSchemaDigest,
        })),
      discoveredAt: this.now().toISOString(),
      digest: entry.discoveryDigest,
    });
    if (digestRunLaunchValue(current) !== digestRunLaunchValue(entry.credentialBindings ?? [])) {
      throw new ConflictError(
        'Credential definition or scope drifted after the run catalog was compiled.',
        {
          serverId: entry.serverId,
          remediation: 'Compile a new launch manifest and run tool catalog.',
        }
      );
    }
  }
}

export function getToolControlPlaneService(): ToolControlPlaneService {
  singleton ??= new ToolControlPlaneService();
  return singleton;
}

class McpJsonRpcRuntime implements ToolControlPlaneRuntime {
  constructor(private readonly environment: NodeJS.ProcessEnv) {}

  async open(
    definition: ToolServerDefinition,
    cwd?: string,
    credentials?: ToolCredentialDelivery
  ): Promise<RpcSession> {
    return definition.transport.kind === 'stdio'
      ? new StdioRpcSession(definition, this.environment, cwd, credentials?.environment)
      : new HttpRpcSession(definition, this.environment, credentials?.headers);
  }
}

class StdioRpcSession implements RpcSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: NodeJS.Timeout;
    }
  >();
  private nextId = 1;
  private buffer = '';
  private stderr = '';
  private closed = false;

  constructor(
    definition: ToolServerDefinition,
    environment: NodeJS.ProcessEnv,
    cwd?: string,
    credentialEnvironment: Record<string, string> = {}
  ) {
    if (definition.transport.kind !== 'stdio') throw new Error('Expected stdio definition.');
    const env = {
      ...minimalProcessEnvironment(environment, definition.transport.environmentKeys),
      ...credentialEnvironment,
    };
    this.child = spawn(definition.transport.command, definition.transport.args, {
      cwd,
      env,
      shell: false,
      detached: process.platform !== 'win32',
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.accept(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-4_000);
    });
    this.child.stdin.on('error', (error) => this.fail(error));
    this.child.on('error', (error) => this.fail(error));
    this.child.on('close', (code, signal) => {
      const diagnostic = redactString(this.stderr.trim());
      this.fail(
        new Error(
          `MCP stdio server exited (${code ?? 'none'}/${signal ?? 'none'}).${
            diagnostic ? ` ${diagnostic}` : ''
          }`
        )
      );
    });
  }

  request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('MCP stdio session is closed.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request ${method} timed out.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  async notify(method: string, params: Record<string, unknown>): Promise<void> {
    this.write({ jsonrpc: '2.0', method, params });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.child.stdin.end();
    terminateStdioProcessGroup(this.child);
    this.fail(new Error('MCP stdio session closed.'));
  }

  private write(record: Record<string, unknown>): void {
    if (this.closed) throw new Error('MCP stdio session is closed.');
    const line = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(line, 'utf8') > MAX_RPC_BYTES) {
      throw new Error('MCP request exceeded the bounded record limit.');
    }
    this.child.stdin.write(line);
  }

  private accept(chunk: string): void {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, 'utf8') > MAX_RPC_BYTES) {
      this.fail(new Error('MCP response exceeded the bounded record limit.'));
      return;
    }
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line) as Record<string, unknown>;
      } catch {
        this.fail(new Error('MCP stdio server returned invalid JSON.'));
        return;
      }
      if (typeof record.id !== 'number') continue;
      const pending = this.pending.get(record.id);
      if (!pending) continue;
      this.pending.delete(record.id);
      clearTimeout(pending.timer);
      if (record.error) pending.reject(new Error(boundedError(record.error)));
      else pending.resolve(record.result);
    }
  }

  private fail(error: Error): void {
    const wasClosed = this.closed;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    if (!wasClosed && this.child.exitCode == null && this.child.signalCode == null) {
      terminateStdioProcessGroup(this.child);
    }
  }
}

class HttpRpcSession implements RpcSession {
  private nextId = 1;
  private sessionId?: string;
  private protocolVersion?: string;

  constructor(
    private readonly definition: ToolServerDefinition,
    private readonly environment: NodeJS.ProcessEnv,
    private readonly credentialHeaders: Record<string, string> = {}
  ) {}

  async request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number
  ): Promise<unknown> {
    const id = this.nextId++;
    const record = await this.post({ jsonrpc: '2.0', id, method, params }, timeoutMs);
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error('MCP HTTP server returned an invalid response.');
    }
    const response = record as Record<string, unknown>;
    if (response.error) throw new Error(boundedError(response.error));
    if (response.id !== id)
      throw new Error('MCP HTTP response identity did not match the request.');
    if (method === 'initialize') {
      const result = response.result;
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        const protocolVersion = (result as Record<string, unknown>).protocolVersion;
        if (typeof protocolVersion === 'string') this.protocolVersion = protocolVersion;
      }
    }
    return response.result;
  }

  async notify(method: string, params: Record<string, unknown>): Promise<void> {
    await this.post({ jsonrpc: '2.0', method, params }, this.definition.startupTimeoutMs, true);
  }

  async close(): Promise<void> {
    if (!this.sessionId || this.definition.transport.kind !== 'http') return;
    const sessionId = this.sessionId;
    this.sessionId = undefined;
    const headers: Record<string, string> = {
      accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    };
    if (this.protocolVersion) headers['mcp-protocol-version'] = this.protocolVersion;
    for (const header of this.definition.transport.headers) {
      const value = this.credentialHeaders[header.name] ?? this.environment[header.environmentKey];
      if (value) headers[header.name] = value;
    }
    const response = await fetch(this.definition.transport.url, {
      method: 'DELETE',
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(this.definition.startupTimeoutMs),
    });
    if (!response.ok && response.status !== 404 && response.status !== 405) {
      throw new Error(`MCP HTTP session cleanup returned ${response.status}.`);
    }
  }

  private async post(
    payload: Record<string, unknown>,
    timeoutMs: number,
    notification = false
  ): Promise<unknown> {
    if (this.definition.transport.kind !== 'http') throw new Error('Expected HTTP definition.');
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    if (this.protocolVersion) headers['mcp-protocol-version'] = this.protocolVersion;
    for (const header of this.definition.transport.headers) {
      const value = this.credentialHeaders[header.name] ?? this.environment[header.environmentKey];
      if (!value) throw new Error(`Required tool server header ${header.name} is unavailable.`);
      headers[header.name] = value;
    }
    const response = await fetch(this.definition.transport.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`MCP HTTP server returned ${response.status}.`);
    this.sessionId = response.headers.get('mcp-session-id') ?? this.sessionId;
    if (notification || response.status === 202) return undefined;
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RPC_BYTES) {
      throw new Error('MCP HTTP response exceeded the bounded record limit.');
    }
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const dataRecords = text
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);
      const expectedId = payload.id;
      for (const data of dataRecords) {
        const record = JSON.parse(data) as unknown;
        if (
          expectedId === undefined ||
          (record &&
            typeof record === 'object' &&
            !Array.isArray(record) &&
            (record as Record<string, unknown>).id === expectedId)
        ) {
          return record;
        }
      }
      throw new Error('MCP HTTP event stream contained no matching response data.');
    }
    return JSON.parse(text);
  }
}

async function initializeSession(
  session: RpcSession,
  timeoutMs: number,
  expectedServerVersion: string
): Promise<string> {
  const response = await session.request(
    'initialize',
    {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'veritas-kanban', version: '6.0.0' },
    },
    timeoutMs
  );
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('MCP initialize returned an invalid result.');
  }
  const protocolVersion = (response as Record<string, unknown>).protocolVersion;
  if (protocolVersion !== MCP_PROTOCOL_VERSION) {
    throw new Error(
      `MCP server negotiated unsupported protocol ${String(protocolVersion ?? 'missing')}.`
    );
  }
  const serverInfo = (response as Record<string, unknown>).serverInfo;
  const serverName =
    serverInfo && typeof serverInfo === 'object' && !Array.isArray(serverInfo)
      ? (serverInfo as Record<string, unknown>).name
      : undefined;
  const serverVersion =
    serverInfo && typeof serverInfo === 'object' && !Array.isArray(serverInfo)
      ? (serverInfo as Record<string, unknown>).version
      : undefined;
  if (typeof serverName !== 'string' || !serverName.trim()) {
    throw new Error('MCP server identity is missing from initialize.');
  }
  if (serverVersion !== expectedServerVersion) {
    throw new Error(
      `MCP server version ${String(serverVersion ?? 'missing')} does not match declared version ${expectedServerVersion}.`
    );
  }
  await session.notify('notifications/initialized', {});
  return protocolVersion;
}

async function listAllTools(
  session: RpcSession,
  timeoutMs: number
): Promise<Array<Record<string, unknown>>> {
  const tools: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;
  const deadline = Date.now() + timeoutMs;
  for (let page = 0; page < MAX_DISCOVERY_PAGES; page += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error('MCP tools/list exceeded the discovery deadline.');
    const response = await session.request('tools/list', cursor ? { cursor } : {}, remainingMs);
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
      throw new Error('MCP tools/list returned an invalid result.');
    }
    const result = response as Record<string, unknown>;
    if (!Array.isArray(result.tools)) throw new Error('MCP tools/list omitted the tools array.');
    for (const tool of result.tools) {
      if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
        throw new Error('MCP tools/list returned an invalid tool definition.');
      }
      tools.push(tool as Record<string, unknown>);
      if (tools.length > MAX_DISCOVERED_TOOLS) {
        throw new Error('MCP tools/list exceeded the bounded tool limit.');
      }
    }
    cursor =
      typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined;
    if (!cursor) return tools;
  }
  throw new Error('MCP tools/list exceeded the bounded pagination limit.');
}

function normalizeDiscoveredTool(tool: Record<string, unknown>) {
  const name = typeof tool.name === 'string' ? tool.name.trim() : '';
  if (!name) throw new Error('Discovered MCP tool is missing a name.');
  const inputSchema =
    tool.inputSchema && typeof tool.inputSchema === 'object' && !Array.isArray(tool.inputSchema)
      ? (tool.inputSchema as Record<string, unknown>)
      : {};
  assertBoundedJson(inputSchema, MAX_SCHEMA_BYTES, `Input schema for ${name}`);
  assertSafeSchema(inputSchema, `Input schema for ${name}`);
  return {
    name,
    ...(typeof tool.description === 'string'
      ? { description: redactString(tool.description).slice(0, 4_000) }
      : {}),
    inputSchema,
    inputSchemaDigest: calculateSchemaDigest(inputSchema),
  };
}

function calculateSchemaDigest(schema: Record<string, unknown>): string {
  return digestRunLaunchValue(schema);
}

function assertSafeSchema(
  value: unknown,
  label: string,
  sensitiveProperty = false,
  depth = 0
): void {
  if (depth > 20) throw new ValidationError(`${label} exceeds the schema depth limit.`);
  if (typeof value === 'string') {
    if (redactString(value) !== value) {
      throw new ValidationError(`${label} contains a credential-like literal.`);
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const entry of value) assertSafeSchema(entry, label, sensitiveProperty, depth + 1);
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (
      sensitiveProperty &&
      ['const', 'default', 'enum', 'examples'].includes(key) &&
      entry !== undefined
    ) {
      throw new ValidationError(
        `${label} cannot embed defaults or examples for credential-shaped inputs.`
      );
    }
    if (key === 'properties' && entry && typeof entry === 'object' && !Array.isArray(entry)) {
      for (const [propertyName, propertySchema] of Object.entries(
        entry as Record<string, unknown>
      )) {
        assertSafeSchema(propertySchema, label, isCredentialLikeKey(propertyName), depth + 1);
      }
      continue;
    }
    assertSafeSchema(entry, label, sensitiveProperty, depth + 1);
  }
}

function isCredentialLikeKey(key: string): boolean {
  return CREDENTIAL_ENV_KEY_PATTERN.test(
    key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/-/g, '_')
  );
}

function degradedEntry(
  definition: ToolServerDefinition,
  error: string,
  discovery?: ToolServerDiscovery
): RunToolCatalogEntry {
  return {
    serverId: definition.id,
    serverVersion: definition.version,
    definitionDigest: definition.digest,
    discoveryDigest: discovery?.digest ?? definition.digest,
    transport: definition.transport.kind,
    requirement: definition.requirement,
    status: 'degraded',
    tools: [],
    error: redactString(error).slice(0, 4_000),
  };
}

function matchesTool(list: string[], name: string, qualifiedName: string): boolean {
  return list.includes('*') || list.includes(name) || list.includes(qualifiedName);
}

function minimalProcessEnvironment(
  source: NodeJS.ProcessEnv,
  selectedKeys: string[]
): NodeJS.ProcessEnv {
  const allowed = new Set([
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

function terminateStdioProcessGroup(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode != null || child.signalCode != null) return;
  if (process.platform === 'win32' && typeof child.pid === 'number' && child.pid > 0) {
    const terminator = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    terminator.unref();
    return;
  }
  let signaledGroup = false;
  if (process.platform !== 'win32' && typeof child.pid === 'number' && child.pid > 0) {
    try {
      process.kill(-child.pid, 'SIGTERM');
      signaledGroup = true;
    } catch {
      // The process may have exited or may not own a group; fall back to the child handle.
    }
  }
  if (!signaledGroup) child.kill('SIGTERM');
  const forceTimer = setTimeout(() => {
    if (child.exitCode != null || child.signalCode != null) return;
    if (signaledGroup && typeof child.pid === 'number' && child.pid > 0) {
      try {
        process.kill(-child.pid, 'SIGKILL');
        return;
      } catch {
        // Fall back to the exact child if its process group is already gone.
      }
    }
    child.kill('SIGKILL');
  }, STDIO_TERMINATION_GRACE_MS);
  forceTimer.unref();
  child.once('close', () => clearTimeout(forceTimer));
}

function assertSafeDefinition(definition: ToolServerDefinitionInput): void {
  if (definition.transport.kind !== 'stdio') return;
  for (const argument of definition.transport.args) {
    if (redactString(argument) !== argument) {
      throw new ValidationError('Tool server arguments cannot contain credential values.');
    }
    const key = argument.replace(/^-+/, '').split(/[=:]/, 1)[0] ?? '';
    if (key && isCredentialLikeKey(key)) {
      throw new ValidationError(
        'Credential-shaped tool server arguments are forbidden; use a broker reference.'
      );
    }
  }
}

function assertBoundedJson(value: unknown, maximumBytes: number, label: string): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new ValidationError(`${label} must be JSON serializable.`);
  }
  if (typeof serialized !== 'string') {
    throw new ValidationError(`${label} must be a JSON value.`);
  }
  if (Buffer.byteLength(serialized, 'utf8') > maximumBytes) {
    throw new ValidationError(`${label} exceeds the bounded payload limit.`);
  }
}

function boundedError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);
  return redactString(raw || 'Unknown tool server error').slice(0, 4_000);
}

import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { AcpMcpServer, ExecutableAgentProvider, RunToolCatalog } from '@veritas-kanban/shared';
import { ConflictError, ForbiddenError } from '../middleware/error-handler.js';

export const RUN_TOOL_BRIDGE_ENV_KEY = 'VK_RUN_TOOL_BRIDGE_HANDLE';
export const RUN_TOOL_BRIDGE_SERVER_ID = 'veritas-run';
export const RUN_TOOL_BRIDGE_METHODS = ['catalog.read', 'tool.call'] as const;

export type RunToolBridgeMethod = (typeof RUN_TOOL_BRIDGE_METHODS)[number];

export interface RunToolBridgeBinding {
  taskId: string;
  attemptId: string;
  catalogDigest: string;
  runLaunchManifestDigest: string;
}

export interface RunToolBridgeLaunch extends RunToolBridgeBinding {
  /** Opaque, run-local bearer authority. Never persist or log this value. */
  handle: string;
  handleId: string;
  expiresAt: string;
}

export interface RunToolBridgeSupport {
  provider: ExecutableAgentProvider;
  supported: boolean;
  injection: 'codex-config' | 'claude-config' | 'acp-session' | 'unavailable';
  reason: string;
}

interface StoredRunToolBridgeAuthority extends RunToolBridgeBinding {
  handleId: string;
  allowedMethods: readonly RunToolBridgeMethod[];
  expiresAt: string;
}

const SUPPORT: Record<ExecutableAgentProvider, Omit<RunToolBridgeSupport, 'provider'>> = {
  'codex-cli': {
    supported: true,
    injection: 'codex-config',
    reason: 'Codex CLI accepts system-owned MCP config overrides and inherited named variables.',
  },
  'codex-sdk': {
    supported: true,
    injection: 'codex-config',
    reason: 'Codex SDK accepts the same system-owned Codex config object and launch environment.',
  },
  'codex-app-server': {
    supported: true,
    injection: 'codex-config',
    reason: 'Codex app-server accepts thread-scoped MCP configuration.',
  },
  'claude-code': {
    supported: true,
    injection: 'claude-config',
    reason: 'Claude Code accepts a strict system-owned MCP configuration.',
  },
  'acp-stdio': {
    supported: true,
    injection: 'acp-session',
    reason: 'ACP stdio accepts run-scoped stdio MCP servers during session creation.',
  },
  'hermes-cli': {
    supported: false,
    injection: 'unavailable',
    reason: 'The certified Hermes one-shot interface has no verified system-owned MCP injection.',
  },
  openclaw: {
    supported: false,
    injection: 'unavailable',
    reason: 'The certified OpenClaw gateway dispatch cannot bind a local run-scoped MCP process.',
  },
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;

export interface RunToolBridgeServiceOptions {
  now?: () => Date;
  randomHandle?: () => string;
  ttlMs?: number;
  entrypoint?: string;
  apiUrl?: string;
}

export function runToolBridgeSupport(provider: ExecutableAgentProvider): RunToolBridgeSupport {
  return { provider, ...SUPPORT[provider] };
}

export function runToolCatalogRequiresBridge(catalog: RunToolCatalog | undefined): boolean {
  return Boolean(
    catalog?.entries.some(
      (entry) => entry.status === 'ready' && (entry.credentialBindings?.length ?? 0) > 0
    )
  );
}

export class RunToolBridgeService {
  private readonly authorities = new Map<string, StoredRunToolBridgeAuthority>();
  private readonly now: () => Date;
  private readonly randomHandle: () => string;
  private readonly ttlMs: number;
  private readonly entrypoint: string;
  private readonly apiUrl: string;

  constructor(options: RunToolBridgeServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.randomHandle =
      options.randomHandle ?? (() => `vkbridge_${randomBytes(32).toString('base64url')}`);
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.entrypoint = path.resolve(options.entrypoint ?? defaultBridgeEntrypoint());
    this.apiUrl = normalizeBridgeApiUrl(
      options.apiUrl ?? process.env.VK_API_URL ?? 'http://localhost:3001'
    );
  }

  support(provider: ExecutableAgentProvider): RunToolBridgeSupport {
    return runToolBridgeSupport(provider);
  }

  requiresBridge(catalog: RunToolCatalog | undefined): boolean {
    return runToolCatalogRequiresBridge(catalog);
  }

  issue(binding: RunToolBridgeBinding): RunToolBridgeLaunch {
    if (!binding.taskId || !binding.attemptId) {
      throw new ConflictError('Run tool bridge authority requires an exact task and attempt.');
    }
    const handle = this.randomHandle();
    if (!/^vkbridge_[A-Za-z0-9_-]{32,}$/.test(handle)) {
      throw new ConflictError('Run tool bridge handle source returned an invalid opaque handle.');
    }
    const handleHash = hashHandle(handle);
    if (this.authorities.has(handleHash)) {
      throw new ConflictError('Run tool bridge handle source returned a duplicate handle.');
    }
    const handleId = `vkbridge_${handleHash.slice(0, 16)}`;
    const expiresAt = new Date(this.now().getTime() + this.ttlMs).toISOString();
    this.authorities.set(handleHash, {
      ...binding,
      handleId,
      allowedMethods: RUN_TOOL_BRIDGE_METHODS,
      expiresAt,
    });
    return { ...binding, handle, handleId, expiresAt };
  }

  authorize(
    handle: string | undefined,
    method: RunToolBridgeMethod,
    expected: Partial<RunToolBridgeBinding> = {}
  ): StoredRunToolBridgeAuthority {
    if (!handle?.startsWith('vkbridge_')) {
      throw new ForbiddenError('Run tool bridge authority is missing or invalid.');
    }
    const authority = this.authorities.get(hashHandle(handle));
    if (!authority) {
      throw new ForbiddenError('Run tool bridge authority is stale or revoked.');
    }
    if (Date.parse(authority.expiresAt) <= this.now().getTime()) {
      this.authorities.delete(hashHandle(handle));
      throw new ForbiddenError('Run tool bridge authority expired.');
    }
    if (!authority.allowedMethods.includes(method)) {
      throw new ForbiddenError('Run tool bridge method is outside the run authority.');
    }
    for (const field of [
      'taskId',
      'attemptId',
      'catalogDigest',
      'runLaunchManifestDigest',
    ] as const) {
      if (expected[field] && expected[field] !== authority[field]) {
        throw new ForbiddenError(`Run tool bridge ${field} does not match the active authority.`);
      }
    }
    return { ...authority };
  }

  revokeRun(taskId: string, attemptId: string): number {
    let revoked = 0;
    for (const [handleHash, authority] of this.authorities) {
      if (authority.taskId === taskId && authority.attemptId === attemptId) {
        this.authorities.delete(handleHash);
        revoked += 1;
      }
    }
    return revoked;
  }

  launchEnvironment(
    source: Record<string, string>,
    launch: RunToolBridgeLaunch | undefined
  ): Record<string, string> {
    return launch
      ? {
          ...source,
          VK_API_URL: this.apiUrl,
          [RUN_TOOL_BRIDGE_ENV_KEY]: launch.handle,
        }
      : source;
  }

  codexServer(launch: RunToolBridgeLaunch): Record<string, unknown> {
    this.assertLaunch(launch);
    return {
      command: process.execPath,
      args: [this.entrypoint],
      enabled: true,
      required: true,
      env_vars: ['VK_API_URL', RUN_TOOL_BRIDGE_ENV_KEY],
      default_tools_approval_mode: 'approve',
      enabled_tools: ['get_run_tool_catalog', 'call_run_tool'],
      disabled_tools: [],
    };
  }

  codexConfig(launch: RunToolBridgeLaunch): Record<string, unknown> {
    return {
      mcp_servers: {
        [RUN_TOOL_BRIDGE_SERVER_ID]: this.codexServer(launch),
      },
    };
  }

  codexCliOverride(launch: RunToolBridgeLaunch): string {
    this.assertLaunch(launch);
    return `mcp_servers.${RUN_TOOL_BRIDGE_SERVER_ID}=${tomlInlineTable({
      command: process.execPath,
      args: [this.entrypoint],
      enabled: true,
      required: true,
      env_vars: ['VK_API_URL', RUN_TOOL_BRIDGE_ENV_KEY],
      enabled_tools: ['get_run_tool_catalog', 'call_run_tool'],
    })}`;
  }

  claudeServer(launch: RunToolBridgeLaunch): {
    config: Record<string, unknown>;
    allowedToolNames: string[];
  } {
    this.assertLaunch(launch);
    return {
      config: {
        mcpServers: {
          [RUN_TOOL_BRIDGE_SERVER_ID]: {
            command: process.execPath,
            args: [this.entrypoint],
            env: {
              VK_API_URL: this.apiUrl,
              [RUN_TOOL_BRIDGE_ENV_KEY]: launch.handle,
            },
          },
        },
      },
      allowedToolNames: [
        `mcp__${RUN_TOOL_BRIDGE_SERVER_ID}__get_run_tool_catalog`,
        `mcp__${RUN_TOOL_BRIDGE_SERVER_ID}__call_run_tool`,
      ],
    };
  }

  acpServer(launch: RunToolBridgeLaunch): AcpMcpServer {
    this.assertLaunch(launch);
    return {
      name: 'Veritas run tools',
      command: process.execPath,
      args: [this.entrypoint],
      env: [
        { name: 'VK_API_URL', value: this.apiUrl },
        { name: RUN_TOOL_BRIDGE_ENV_KEY, value: launch.handle },
      ],
    };
  }

  private assertLaunch(launch: RunToolBridgeLaunch): void {
    this.authorize(launch.handle, 'catalog.read', launch);
  }
}

function defaultBridgeEntrypoint(): string {
  return fileURLToPath(new URL('../../runtime/run-tool-bridge.mjs', import.meta.url));
}

function hashHandle(handle: string): string {
  return createHash('sha256').update(handle).digest('hex');
}

function normalizeBridgeApiUrl(value: string): string {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new ConflictError('Run tool bridge API URL must use HTTPS or loopback HTTP.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function tomlInlineTable(value: Record<string, string | boolean | string[]>): string {
  return `{${Object.entries(value)
    .map(([key, child]) => {
      if (Array.isArray(child))
        return `${key}=[${child.map((item) => JSON.stringify(item)).join(',')}]`;
      return `${key}=${typeof child === 'string' ? JSON.stringify(child) : String(child)}`;
    })
    .join(',')}}`;
}

let singleton: RunToolBridgeService | undefined;

export function getRunToolBridgeService(): RunToolBridgeService {
  singleton ??= new RunToolBridgeService();
  return singleton;
}

export function resetRunToolBridgeService(): void {
  singleton = undefined;
}

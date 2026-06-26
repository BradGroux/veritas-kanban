export type ClientAuthRole = 'admin' | 'read-only' | 'agent';
export type ClientAuthMethod =
  | 'disabled'
  | 'session'
  | 'api-key'
  | 'device-session'
  | 'localhost-bypass';
export type ClientAuthActorType = 'user' | 'agent' | 'service' | 'device' | 'localhost-bypass';
export type ClientAuthPermission =
  | '*'
  | 'workspace:read'
  | 'task:read'
  | 'task:write'
  | 'comment:write'
  | 'workflow:read'
  | 'workflow:write'
  | 'workflow:execute'
  | 'work_product:read'
  | 'work_product:write'
  | 'report:read'
  | 'telemetry:read'
  | 'telemetry:write'
  | 'agent:read'
  | 'agent:write'
  | 'settings:read'
  | 'settings:write'
  | 'policy:read'
  | 'policy:write'
  | 'backup:read'
  | 'backup:write'
  | 'admin:manage';

export interface ClientAuthContext {
  role: ClientAuthRole;
  keyName?: string;
  isLocalhost: boolean;
  userId?: string;
  workspaceId?: string;
  actorType?: ClientAuthActorType;
  authMethod?: ClientAuthMethod;
  tokenName?: string;
  permissions?: ClientAuthPermission[];
  apiTokenId?: string;
  deviceSessionId?: string;
  deviceId?: string;
  clientId?: string;
  clientMode?: string;
  capabilities?: string[];
  degradedReason?: string | null;
}

export interface ApiPermissionRequirement {
  permissions: ClientAuthPermission[];
  path: string;
  method: string;
  public: boolean;
}

export type ApiContextClient = <T>(path: string, options?: RequestInit) => Promise<T>;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

interface RoutePermissionConfig {
  prefix: string;
  read: ClientAuthPermission | ClientAuthPermission[];
  write?: ClientAuthPermission | ClientAuthPermission[];
  overrides?: {
    methods?: string[];
    path: RegExp;
    permissions: ClientAuthPermission | ClientAuthPermission[];
  }[];
}

function asPermissions(
  permissions: ClientAuthPermission | ClientAuthPermission[]
): ClientAuthPermission[] {
  return Array.isArray(permissions) ? permissions : [permissions];
}

function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

function normalizeApiPath(path: string): string {
  const url = new URL(path, 'http://veritas.local');
  let normalized = url.pathname.replace(/\/+$/, '') || '/';

  if (normalized === '/api/v1') {
    normalized = '/api';
  } else if (normalized.startsWith('/api/v1/')) {
    normalized = `/api${normalized.slice('/api/v1'.length)}`;
  }

  return normalized;
}

function routeRequirement(
  config: RoutePermissionConfig,
  path: string,
  method: string
): ApiPermissionRequirement | null {
  if (path !== config.prefix && !path.startsWith(`${config.prefix}/`)) {
    return null;
  }

  const relativePath = path.slice(config.prefix.length) || '/';
  const override = config.overrides?.find((candidate) => {
    const methodMatches =
      !candidate.methods ||
      candidate.methods.some((candidateMethod) => candidateMethod.toUpperCase() === method);
    return methodMatches && candidate.path.test(relativePath);
  });

  const permissions = override
    ? override.permissions
    : isSafeMethod(method)
      ? config.read
      : (config.write ?? config.read);

  return {
    permissions: asPermissions(permissions),
    path,
    method,
    public: false,
  };
}

const ROUTE_PERMISSIONS: RoutePermissionConfig[] = [
  {
    prefix: '/api/tasks',
    read: 'task:read',
    write: 'task:write',
    overrides: [
      {
        methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
        path: /^\/[^/]+\/comments(?:\/.*)?$/,
        permissions: 'comment:write',
      },
      {
        methods: ['GET', 'HEAD', 'OPTIONS'],
        path: /^\/[^/]+\/work-products(?:\/.*)?$/,
        permissions: 'work_product:read',
      },
      {
        methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
        path: /^\/[^/]+\/work-products(?:\/.*)?$/,
        permissions: 'work_product:write',
      },
    ],
  },
  { prefix: '/api/backlog', read: 'task:read', write: 'task:write' },
  { prefix: '/api/observations', read: 'task:read' },
  {
    prefix: '/api/config',
    read: 'settings:read',
    write: 'settings:write',
    overrides: [
      { methods: ['POST'], path: /^\/repos\/validate\/?$/, permissions: 'settings:read' },
      {
        methods: ['POST'],
        path: /^\/agent-profiles\/validate\/?$/,
        permissions: 'settings:read',
      },
    ],
  },
  { prefix: '/api/changes', read: 'task:read' },
  { prefix: '/api/chat', read: 'task:read', write: 'comment:write' },
  { prefix: '/api/agents/register', read: 'agent:read', write: 'telemetry:write' },
  {
    prefix: '/api/agents/permissions',
    read: 'agent:read',
    write: 'admin:manage',
    overrides: [
      { methods: ['POST'], path: /^\/check\/?$/, permissions: 'agent:read' },
      { methods: ['POST'], path: /^\/approvals\/?$/, permissions: 'task:write' },
    ],
  },
  {
    prefix: '/api/agents',
    read: 'agent:read',
    write: 'admin:manage',
    overrides: [
      { methods: ['POST'], path: /^\/route\/?$/, permissions: 'agent:read' },
      { methods: ['POST'], path: /^\/hosts\/preview\/?$/, permissions: 'agent:read' },
      { methods: ['POST'], path: /^\/[^/]+\/(start|stop)\/?$/, permissions: 'agent:write' },
      { methods: ['POST'], path: /^\/[^/]+\/message\/?$/, permissions: 'task:write' },
    ],
  },
  {
    prefix: '/api/diff',
    read: 'task:read',
    write: 'task:write',
    overrides: [
      { methods: ['POST'], path: /^\/[^/]+\/codex-review\/?$/, permissions: 'workflow:execute' },
    ],
  },
  { prefix: '/api/automation', read: 'task:read', write: 'task:write' },
  { prefix: '/api/summary', read: 'report:read' },
  { prefix: '/api/notifications', read: 'agent:read', write: 'comment:write' },
  { prefix: '/api/broadcasts', read: 'task:read', write: 'comment:write' },
  { prefix: '/api/templates', read: 'settings:read', write: 'settings:write' },
  { prefix: '/api/task-types', read: 'settings:read', write: 'settings:write' },
  { prefix: '/api/projects', read: 'settings:read', write: 'settings:write' },
  { prefix: '/api/sprints', read: 'settings:read', write: 'settings:write' },
  { prefix: '/api/activity', read: 'telemetry:read', write: 'admin:manage' },
  { prefix: '/api/github', read: 'task:read', write: 'task:write' },
  { prefix: '/api/preview', read: 'task:read', write: 'admin:manage' },
  { prefix: '/api/conflicts', read: 'task:read', write: 'task:write' },
  { prefix: '/api/telemetry', read: 'telemetry:read', write: 'telemetry:write' },
  { prefix: '/api/metrics', read: 'report:read' },
  { prefix: '/api/analytics', read: 'report:read' },
  { prefix: '/api/traces', read: 'telemetry:read', write: 'telemetry:write' },
  { prefix: '/api/drift', read: 'telemetry:read', write: 'telemetry:write' },
  { prefix: '/api/settings/transition-hooks', read: 'admin:manage', write: 'admin:manage' },
  { prefix: '/api/settings', read: 'settings:read', write: 'settings:write' },
  { prefix: '/api/agent/status', read: 'agent:read', write: 'telemetry:write' },
  { prefix: '/api/cost-prediction', read: 'report:read', write: 'task:write' },
  { prefix: '/api/deliverables', read: 'task:read', write: 'task:write' },
  {
    prefix: '/api/reports',
    read: 'report:read',
    write: 'settings:write',
    overrides: [{ methods: ['POST'], path: /^\/generate\/?$/, permissions: 'report:read' }],
  },
  { prefix: '/api/doc-freshness', read: 'settings:read', write: 'settings:write' },
  { prefix: '/api/docs', read: 'settings:read', write: 'settings:write' },
  { prefix: '/api/errors', read: 'telemetry:read', write: 'telemetry:write' },
  {
    prefix: '/api/search',
    read: 'task:read',
    write: 'settings:write',
    overrides: [
      { methods: ['POST'], path: /^\/?$/, permissions: ['task:read', 'work_product:read'] },
    ],
  },
  { prefix: '/api/work-products', read: 'work_product:read', write: 'work_product:write' },
  { prefix: '/api/hooks', read: 'settings:read', write: 'settings:write' },
  { prefix: '/api/shared-resources', read: 'settings:read', write: 'settings:write' },
  { prefix: '/api/status-history', read: 'telemetry:read', write: 'admin:manage' },
  { prefix: '/api/digest', read: 'report:read' },
  { prefix: '/api/evidence', read: 'report:read' },
  { prefix: '/api/time-breakdowns', read: 'report:read' },
  { prefix: '/api/audit', read: 'admin:manage', write: 'admin:manage' },
  { prefix: '/api/lessons', read: 'task:read' },
  { prefix: '/api/delegation', read: 'agent:read', write: 'admin:manage' },
  {
    prefix: '/api/workflows',
    read: 'workflow:read',
    write: 'workflow:write',
    overrides: [
      { methods: ['POST'], path: /^\/[^/]+\/runs\/?$/, permissions: 'workflow:execute' },
      { methods: ['POST'], path: /^\/runs\/[^/]+\/resume\/?$/, permissions: 'workflow:execute' },
      {
        methods: ['POST'],
        path: /^\/runs\/[^/]+\/steps\/[^/]+\/(approve|reject)\/?$/,
        permissions: 'workflow:execute',
      },
    ],
  },
  { prefix: '/api/ceremonies', read: 'workflow:read', write: 'workflow:write' },
  {
    prefix: '/api/scheduler',
    read: 'workflow:read',
    write: 'workflow:write',
    overrides: [
      { methods: ['POST'], path: /^\/items\/[^/]+\/run\/?$/, permissions: 'workflow:execute' },
      { methods: ['POST'], path: /^\/items\/[^/]+\/validate\/?$/, permissions: 'workflow:read' },
      { methods: ['POST'], path: /^\/due\/run\/?$/, permissions: 'workflow:execute' },
    ],
  },
  {
    prefix: '/api/queue-monitors',
    read: 'workflow:read',
    write: 'workflow:write',
    overrides: [
      { methods: ['POST'], path: /^\/[^/]+\/run\/?$/, permissions: 'workflow:execute' },
      { methods: ['GET', 'POST'], path: /^\/[^/]+\/explain\/?$/, permissions: 'workflow:read' },
      { methods: ['GET'], path: /^\/[^/]+\/health\/?$/, permissions: 'workflow:read' },
    ],
  },
  {
    prefix: '/api/watcher-policies',
    read: 'policy:read',
    write: 'policy:write',
    overrides: [
      { methods: ['POST'], path: /^\/evaluate\/?$/, permissions: ['policy:read', 'agent:read'] },
    ],
  },
  {
    prefix: '/api/tool-policies',
    read: 'policy:read',
    overrides: [
      { methods: ['POST'], path: /^\/evaluate\/?$/, permissions: ['policy:read', 'agent:read'] },
    ],
  },
  {
    prefix: '/api/policies',
    read: 'policy:read',
    overrides: [
      { methods: ['POST'], path: /^\/evaluate\/?$/, permissions: ['policy:read', 'agent:read'] },
    ],
  },
  {
    prefix: '/api/sandbox-policies',
    read: 'policy:read',
    write: 'policy:write',
    overrides: [
      { methods: ['POST'], path: /^\/validate\/?$/, permissions: ['policy:read', 'agent:read'] },
    ],
  },
  {
    prefix: '/api/skills/capabilities',
    read: 'policy:read',
    write: 'policy:write',
    overrides: [
      {
        methods: ['POST'],
        path: /^\/[^/]+\/remediation-task\/?$/,
        permissions: ['policy:write', 'task:write'],
      },
    ],
  },
  {
    prefix: '/api/skills/security',
    read: 'policy:read',
    write: 'admin:manage',
    overrides: [{ methods: ['POST'], path: /^\/scan\/?$/, permissions: 'admin:manage' }],
  },
  {
    prefix: '/api/integrations',
    read: 'settings:read',
    write: 'settings:write',
    overrides: [
      {
        methods: ['POST'],
        path: /^\/communication\/adapters\/[^/]+\/replies\/?$/,
        permissions: 'comment:write',
      },
    ],
  },
  { prefix: '/api/transcripts', read: 'workspace:read', write: 'workflow:execute' },
  {
    prefix: '/api/scoring',
    read: 'report:read',
    write: 'settings:write',
    overrides: [{ methods: ['POST'], path: /^\/evaluate\/?$/, permissions: 'report:read' }],
  },
  { prefix: '/api/system/health', read: 'workspace:read', write: 'admin:manage' },
  {
    prefix: '/api/workspace-capabilities',
    read: 'workspace:read',
    write: 'settings:write',
    overrides: [
      { methods: ['POST'], path: /^\/manifest\/validate\/?$/, permissions: 'workspace:read' },
      { methods: ['POST'], path: /^\/intake\/?$/, permissions: 'task:write' },
      { methods: ['GET'], path: /^\/delegations(?:\/.*)?$/, permissions: 'task:read' },
      { methods: ['POST'], path: /^\/delegations\/[^/]+\/refresh\/?$/, permissions: 'task:write' },
    ],
  },
  { prefix: '/api/decisions', read: 'task:read', write: 'task:write' },
  { prefix: '/api/run-sessions', read: 'task:read', write: 'task:write' },
  { prefix: '/api/governance/traces', read: 'policy:read' },
  { prefix: '/api/feedback', read: 'report:read', write: 'comment:write' },
  {
    prefix: '/api/prompt-registry',
    read: 'settings:read',
    write: 'settings:write',
    overrides: [
      {
        methods: ['POST'],
        path: /^\/[^/]+\/render-preview\/?$/,
        permissions: 'settings:read',
      },
      {
        methods: ['POST'],
        path: /^\/[^/]+\/record-usage\/?$/,
        permissions: 'telemetry:write',
      },
    ],
  },
  { prefix: '/api/sqlite', read: 'backup:read', write: 'backup:write' },
  {
    prefix: '/api/maintenance',
    read: 'backup:read',
    write: 'backup:write',
    overrides: [
      { methods: ['POST'], path: /^\/skill-security\/scan\/?$/, permissions: 'admin:manage' },
    ],
  },
  { prefix: '/api/identity', read: 'workspace:read', write: 'admin:manage' },
];

function isPublicApiPath(path: string): boolean {
  return (
    path === '/health' ||
    path.startsWith('/health/') ||
    path === '/api/health' ||
    path === '/api/health/live' ||
    path === '/api/health/ready' ||
    path === '/api/auth/status' ||
    path === '/api/auth/setup' ||
    path === '/api/auth/login' ||
    path === '/api/auth/logout' ||
    path === '/api/auth/recover' ||
    path === '/api/auth/context' ||
    path.startsWith('/api/webhook/')
  );
}

export function getApiPermissionRequirement(
  path: string,
  options: Pick<RequestInit, 'method'> = {}
): ApiPermissionRequirement {
  const method = (options.method || 'GET').toUpperCase();
  const normalizedPath = normalizeApiPath(path);

  if (isPublicApiPath(normalizedPath)) {
    return { permissions: [], path: normalizedPath, method, public: true };
  }

  for (const config of ROUTE_PERMISSIONS) {
    const requirement = routeRequirement(config, normalizedPath, method);
    if (requirement) return requirement;
  }

  return {
    permissions: ['admin:manage'],
    path: normalizedPath,
    method,
    public: false,
  };
}

export function hasClientPermission(
  auth: Pick<ClientAuthContext, 'role' | 'permissions'> | undefined,
  permission: ClientAuthPermission
): boolean {
  if (!auth) return false;
  if (auth.role === 'admin') return true;

  const permissions = auth.permissions ?? [];
  return permissions.includes('*') || permissions.includes(permission);
}

export class ClientPermissionError extends Error {
  readonly code = 'CLIENT_PERMISSION_DENIED';
  readonly required: ClientAuthPermission[];
  readonly currentRole?: ClientAuthRole;
  readonly currentPermissions: ClientAuthPermission[];
  readonly path: string;
  readonly method: string;

  constructor(requirement: ApiPermissionRequirement, context: ClientAuthContext) {
    const required = requirement.permissions.join(', ');
    super(
      `Token is not allowed to call ${requirement.method} ${requirement.path}. Required permission: ${required}. Current role: ${context.role}.`
    );
    this.name = 'ClientPermissionError';
    this.required = requirement.permissions;
    this.currentRole = context.role;
    this.currentPermissions = context.permissions ?? [];
    this.path = requirement.path;
    this.method = requirement.method;
  }
}

export function createApiPermissionGuard(loadContext: () => Promise<ClientAuthContext>) {
  let cachedContext: Promise<ClientAuthContext> | null = null;

  return async function assertApiPermissionForRequest(
    path: string,
    options: Pick<RequestInit, 'method'> = {}
  ): Promise<ClientAuthContext | null> {
    const requirement = getApiPermissionRequirement(path, options);
    if (requirement.public) return null;

    cachedContext ??= loadContext();
    const context = await cachedContext;
    const allowed = requirement.permissions.some((permission) =>
      hasClientPermission(context, permission)
    );

    if (!allowed) {
      throw new ClientPermissionError(requirement, context);
    }

    return context;
  };
}

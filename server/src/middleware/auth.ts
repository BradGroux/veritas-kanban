import { Request, Response, NextFunction } from 'express';
import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getSecurityConfig, getJwtSecret, getValidJwtSecrets } from '../config/security.js';
import { createLogger } from '../lib/logger.js';
import { validateScopedApiToken } from '../services/api-token-service.js';
import { validateDeviceSessionSecret } from '../services/device-session-service.js';

const log = createLogger('auth');

// === Types ===

export type AuthRole = 'admin' | 'read-only' | 'agent';
export type AuthMethod = 'disabled' | 'session' | 'api-key' | 'device-session' | 'localhost-bypass';
export type AuthActorType = 'user' | 'agent' | 'service' | 'device' | 'localhost-bypass';
export type AuthPermission =
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

export interface AuthConfig {
  /** Enable authentication (default: true) */
  enabled: boolean;
  /** Allow unauthenticated localhost connections when auth is enabled */
  allowLocalhostBypass: boolean;
  /** Role assigned to localhost bypass connections (default: 'read-only') */
  localhostRole: AuthRole;
  /** API keys for agents and services */
  apiKeys: ApiKeyConfig[];
  /** Admin API key (full access) */
  adminKey?: string;
}

export interface ApiKeyConfig {
  /** The API key value */
  key: string;
  /** Human-readable name/description */
  name: string;
  /** Role assigned to this key */
  role: AuthRole;
  /** Optional: restrict to specific routes (regex patterns) */
  allowedRoutes?: string[];
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}

const DEFAULT_WORKSPACE_ID = 'local';
const DEFAULT_USER_ID = 'local-user';

export interface AuthContext {
  role: AuthRole;
  keyName?: string;
  isLocalhost: boolean;
  userId?: string;
  workspaceId?: string;
  actorType?: AuthActorType;
  authMethod?: AuthMethod;
  tokenName?: string;
  permissions?: AuthPermission[];
  apiTokenId?: string;
  deviceSessionId?: string;
  deviceId?: string;
  clientId?: string;
  clientMode?: string;
  capabilities?: string[];
  degradedReason?: string | null;
}

const ROLE_PERMISSIONS: Record<AuthRole, readonly AuthPermission[]> = {
  admin: ['*'],
  agent: [
    'workspace:read',
    'task:read',
    'task:write',
    'comment:write',
    'workflow:read',
    'workflow:execute',
    'work_product:read',
    'work_product:write',
    'report:read',
    'telemetry:write',
    'agent:read',
  ],
  'read-only': [
    'workspace:read',
    'task:read',
    'workflow:read',
    'work_product:read',
    'report:read',
    'telemetry:read',
    'agent:read',
    'settings:read',
    'policy:read',
    'backup:read',
  ],
};

function permissionsForRole(role: AuthRole): AuthPermission[] {
  return [...ROLE_PERMISSIONS[role]];
}

function actorTypeFor(role: AuthRole, authMethod: AuthMethod): AuthActorType {
  if (authMethod === 'localhost-bypass') return 'localhost-bypass';
  if (role === 'agent') return 'agent';
  return authMethod === 'session' ? 'user' : 'service';
}

function buildAuthContext(input: {
  role: AuthRole;
  keyName?: string;
  isLocalhost: boolean;
  authMethod: AuthMethod;
}): NonNullable<AuthenticatedRequest['auth']> {
  return {
    role: input.role,
    keyName: input.keyName,
    isLocalhost: input.isLocalhost,
    userId: DEFAULT_USER_ID,
    workspaceId: DEFAULT_WORKSPACE_ID,
    actorType: actorTypeFor(input.role, input.authMethod),
    authMethod: input.authMethod,
    tokenName: input.authMethod === 'api-key' ? input.keyName : undefined,
    permissions: permissionsForRole(input.role),
  };
}

function permissionListFor(auth: Pick<AuthContext, 'role' | 'permissions'>): AuthPermission[] {
  return auth.permissions ?? permissionsForRole(auth.role);
}

export function hasPermission(
  auth: Pick<AuthContext, 'role' | 'permissions'> | undefined,
  permission: AuthPermission
): boolean {
  if (!auth) return false;
  if (auth.role === 'admin') return true;

  const permissions = permissionListFor(auth);
  return permissions.includes('*') || permissions.includes(permission);
}

// === Configuration ===

// Load auth config from environment variables
/** Valid values for VERITAS_AUTH_LOCALHOST_ROLE */
const VALID_LOCALHOST_ROLES: AuthRole[] = ['admin', 'read-only', 'agent'];

function loadAuthConfig(): AuthConfig {
  const enabled = process.env.VERITAS_AUTH_ENABLED !== 'false';
  const allowLocalhostBypass = process.env.VERITAS_AUTH_LOCALHOST_BYPASS === 'true';
  const adminKey = process.env.VERITAS_ADMIN_KEY;

  // Parse localhost role (default: read-only for security)
  const rawLocalhostRole = (process.env.VERITAS_AUTH_LOCALHOST_ROLE?.trim() ||
    'read-only') as AuthRole;
  const localhostRole = VALID_LOCALHOST_ROLES.includes(rawLocalhostRole)
    ? rawLocalhostRole
    : 'read-only';

  // Parse API keys from environment (format: name:key:role,name2:key2:role2)
  const apiKeysEnv = process.env.VERITAS_API_KEYS || '';
  const apiKeys: ApiKeyConfig[] = apiKeysEnv
    .split(',')
    .filter(Boolean)
    .map((entry) => {
      const [name, key, role] = entry.split(':');
      return {
        name: name?.trim() || 'unnamed',
        key: key?.trim() || '',
        role: (role?.trim() as AuthRole) || 'read-only',
      };
    })
    .filter((k) => k.key);

  return {
    enabled,
    allowLocalhostBypass,
    localhostRole,
    apiKeys,
    adminKey,
  };
}

// === Weak Key Detection ===

/** Known weak/default keys that should never be used in production */
const WEAK_KEYS = new Set([
  'dev-admin-key',
  'your-secret-admin-key-here',
  'changeme',
  'admin',
  'password',
  'secret',
]);

const MIN_KEY_LENGTH = 32;

export interface AdminKeyWarning {
  level: 'critical' | 'warning';
  message: string;
}

/**
 * Check if the configured admin key is weak or insecure.
 * Returns an array of warnings (empty if the key is strong).
 */
export function checkAdminKeyStrength(): AdminKeyWarning[] {
  const adminKey = process.env.VERITAS_ADMIN_KEY;
  const warnings: AdminKeyWarning[] = [];

  if (!adminKey) {
    return warnings; // No admin key configured — nothing to warn about
  }

  if (WEAK_KEYS.has(adminKey)) {
    warnings.push({
      level: 'critical',
      message: `Admin key is a known weak default. Generate a strong key: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    });
  } else if (adminKey.length < MIN_KEY_LENGTH) {
    warnings.push({
      level: 'warning',
      message: `Admin key is only ${adminKey.length} characters (minimum recommended: ${MIN_KEY_LENGTH}). Consider using a longer key.`,
    });
  }

  return warnings;
}

// Singleton config instance (reloaded on each request for dev flexibility)
let authConfig: AuthConfig | null = null;

export function getAuthConfig(): AuthConfig {
  if (!authConfig || process.env.NODE_ENV === 'development') {
    authConfig = loadAuthConfig();
  }
  return authConfig;
}

// === Helper Functions ===

function isLocalhostRequest(req: Request | IncomingMessage): boolean {
  // Only trust X-Forwarded-For when trust proxy is explicitly configured
  const trustProxy =
    'app' in req &&
    typeof (req as Request).app?.get === 'function' &&
    (req as Request).app.get('trust proxy');
  const forwarded = trustProxy
    ? (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    : undefined;
  let remoteAddr: string;

  // In production, never allow localhost bypass regardless of config
  if (process.env.NODE_ENV === 'production') {
    return false;
  }

  if ('socket' in req && req.socket) {
    remoteAddr = forwarded || req.socket.remoteAddress || '';
  } else if ('ip' in req) {
    remoteAddr = forwarded || (req as Request).ip || '';
  } else {
    remoteAddr = forwarded || '';
  }

  return (
    remoteAddr === '127.0.0.1' ||
    remoteAddr === '::1' ||
    remoteAddr === '::ffff:127.0.0.1' ||
    remoteAddr === 'localhost'
  );
}

function extractApiKey(
  req: Request | IncomingMessage,
  options: { allowQueryParam?: boolean } = {}
): string | null {
  const { allowQueryParam = false } = options;

  // Check Authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // Check X-API-Key header
  const apiKeyHeader = req.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string') {
    return apiKeyHeader;
  }

  // Optional fallback for WebSocket clients only.
  // HTTP requests must use headers, not query parameters.
  if (allowQueryParam && 'url' in req && typeof req.url === 'string') {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const apiKey = url.searchParams.get('api_key');
      if (apiKey) return apiKey;
    } catch {
      // Ignore URL parsing errors
    }
  }

  return null;
}

function validateApiKey(
  apiKey: string,
  config: AuthConfig
): { valid: boolean; role?: AuthRole; name?: string } {
  // Check admin key first
  if (config.adminKey && apiKey === config.adminKey) {
    return { valid: true, role: 'admin', name: 'admin' };
  }

  // Check configured API keys
  const keyConfig = config.apiKeys.find((k) => k.key === apiKey);
  if (keyConfig) {
    return { valid: true, role: keyConfig.role, name: keyConfig.name };
  }

  return { valid: false };
}

function validateDatabaseApiToken(
  apiKey: string,
  req: Request | IncomingMessage,
  isLocalhost: boolean
): AuthContext | null {
  try {
    const validation = validateScopedApiToken(apiKey, requestRemoteAddress(req));
    return validation.valid && validation.auth ? { ...validation.auth, isLocalhost } : null;
  } catch (error) {
    log.warn({ err: error }, 'Scoped API token validation failed');
    return null;
  }
}

function validateDatabaseDeviceSession(
  apiKey: string,
  req: Request | IncomingMessage,
  isLocalhost: boolean
): AuthContext | null {
  try {
    const validation = validateDeviceSessionSecret(apiKey, requestRemoteAddress(req));
    return validation.valid && validation.auth ? { ...validation.auth, isLocalhost } : null;
  } catch (error) {
    log.warn({ err: error }, 'Device session validation failed');
    return null;
  }
}

function requestRemoteAddress(req: Request | IncomingMessage): string | null {
  if ('socket' in req && req.socket) {
    return req.socket.remoteAddress ?? null;
  }
  return 'ip' in req ? ((req as Request).ip ?? null) : null;
}

// === JWT Verification ===

/**
 * Verify a JWT token against all valid secrets (supports secret rotation).
 * Tries the current secret first, then falls back to previous secrets
 * still within their grace period.
 */
function verifyJwtToken(token: string): { valid: boolean; error?: string } {
  const secrets = getValidJwtSecrets();
  let lastError: Error | null = null;

  for (const secret of secrets) {
    try {
      jwt.verify(token, secret, { algorithms: ['HS256'] });
      return { valid: true };
    } catch (err) {
      lastError = err as Error;
      // If the token is expired, no point trying other secrets
      if (err instanceof jwt.TokenExpiredError) {
        return { valid: false, error: 'Session expired' };
      }
      // For other errors (invalid signature), try the next secret
      continue;
    }
  }

  // None of the secrets worked
  return { valid: false, error: 'Invalid session' };
}

function verifyJwtCookie(req: Request): { valid: boolean; error?: string } {
  // Get cookie from request
  const token = req.cookies?.veritas_session;
  if (!token) {
    return { valid: false };
  }

  return verifyJwtToken(token);
}

// === Express Middleware ===

/**
 * Authentication middleware - validates JWT cookie, API key, or localhost bypass
 * Priority: JWT cookie > API key > localhost bypass
 */
export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const config = getAuthConfig();
  const securityConfig = getSecurityConfig();
  const isLocalhost = isLocalhostRequest(req);

  // If password auth not set up yet, check API key auth
  const passwordAuthEnabled = securityConfig.authEnabled && securityConfig.passwordHash;

  // Auth disabled via env var - allow all requests
  if (!config.enabled && !passwordAuthEnabled) {
    req.auth = buildAuthContext({ role: 'admin', isLocalhost, authMethod: 'disabled' });
    return next();
  }

  // 1. Check JWT cookie (human users)
  if (passwordAuthEnabled) {
    const jwtResult = verifyJwtCookie(req);
    if (jwtResult.valid) {
      req.auth = buildAuthContext({
        role: 'admin',
        keyName: 'session',
        isLocalhost,
        authMethod: 'session',
      });
      return next();
    }
  }

  // 2. Check API key (agents/services)
  const apiKey = extractApiKey(req, { allowQueryParam: false });
  if (apiKey) {
    const validation = validateApiKey(apiKey, config);
    if (validation.valid) {
      req.auth = buildAuthContext({
        role: validation.role!,
        keyName: validation.name,
        isLocalhost,
        authMethod: 'api-key',
      });
      return next();
    }

    const scopedAuth = validateDatabaseApiToken(apiKey, req, isLocalhost);
    if (scopedAuth) {
      req.auth = scopedAuth;
      return next();
    }

    const deviceAuth = validateDatabaseDeviceSession(apiKey, req, isLocalhost);
    if (deviceAuth) {
      req.auth = deviceAuth;
      return next();
    }
  }

  // 3. Localhost bypass (dev mode) — role is configurable (default: read-only)
  if (config.allowLocalhostBypass && isLocalhost) {
    req.auth = buildAuthContext({
      role: config.localhostRole,
      keyName: 'localhost-bypass',
      isLocalhost,
      authMethod: 'localhost-bypass',
    });
    return next();
  }

  // No valid auth found
  res.status(401).json({
    code: 'AUTH_REQUIRED',
    message: 'Authentication required',
    details: {
      hint: passwordAuthEnabled
        ? 'Please log in or provide an API key'
        : 'Provide API key via Authorization header (Bearer <key>) or X-API-Key header',
    },
  });
}

/**
 * Authorization middleware factory - requires specific roles
 */
export function authorize(...allowedRoles: AuthRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({
        code: 'AUTH_REQUIRED',
        message: 'Authentication required',
      });
      return;
    }

    // Admin can do everything
    if (req.auth.role === 'admin') {
      return next();
    }

    if (allowedRoles.includes('admin') && hasPermission(req.auth, 'admin:manage')) {
      return next();
    }

    if (!allowedRoles.includes(req.auth.role)) {
      res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Insufficient permissions',
        details: {
          required: allowedRoles,
          current: req.auth.role,
        },
      });
      return;
    }

    next();
  };
}

/**
 * Authorization middleware factory - requires at least one specific permission.
 *
 * Existing callers can keep using role checks while v5 route work moves toward
 * explicit permission requirements.
 */
export function authorizePermission(...allowedPermissions: AuthPermission[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({
        code: 'AUTH_REQUIRED',
        message: 'Authentication required',
      });
      return;
    }

    if (!allowedPermissions.some((permission) => hasPermission(req.auth, permission))) {
      res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Insufficient permissions',
        details: {
          required: allowedPermissions,
          currentRole: req.auth.role,
          currentPermissions: permissionListFor(req.auth),
        },
      });
      return;
    }

    next();
  };
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

type PermissionInput = AuthPermission | AuthPermission[];

export interface MethodPermissionOverride {
  methods?: string[];
  path?: RegExp;
  permissions: PermissionInput;
}

export interface MethodPermissionConfig {
  read: PermissionInput;
  write?: PermissionInput;
  overrides?: MethodPermissionOverride[];
}

function normalizePermissions(permissions: PermissionInput): AuthPermission[] {
  return Array.isArray(permissions) ? permissions : [permissions];
}

/**
 * Authorization middleware factory - selects explicit permissions by method.
 *
 * REST route groups can use this at mount time to require read permissions for
 * safe methods and write/execute permissions for mutating methods, with narrow
 * path overrides for read-like POST endpoints.
 */
export function authorizePermissionByMethod(config: MethodPermissionConfig) {
  const readPermissions = normalizePermissions(config.read);
  const writePermissions = normalizePermissions(config.write ?? config.read);
  const overrides = config.overrides ?? [];

  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const override = overrides.find((candidate) => {
      const methodMatches =
        !candidate.methods ||
        candidate.methods.some((method) => method.toUpperCase() === req.method.toUpperCase());
      const pathMatches = !candidate.path || candidate.path.test(req.path);
      return methodMatches && pathMatches;
    });

    const requiredPermissions = override
      ? normalizePermissions(override.permissions)
      : READ_METHODS.has(req.method)
        ? readPermissions
        : writePermissions;

    authorizePermission(...requiredPermissions)(req, res, next);
  };
}

/**
 * Middleware that allows read operations for read-only users
 * but requires admin for write operations
 */
export function authorizeWrite(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({
      code: 'AUTH_REQUIRED',
      message: 'Authentication required',
    });
    return;
  }

  // Admin and agent can write
  if (req.auth.role === 'admin' || req.auth.role === 'agent') {
    return next();
  }

  // Read-only can only GET
  const readMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (req.auth.role === 'read-only' && readMethods.includes(req.method)) {
    return next();
  }

  res.status(403).json({
    code: 'WRITE_FORBIDDEN',
    message: 'Write access denied',
    details: {
      hint: 'Your API key has read-only access',
    },
  });
}

// === WebSocket Authentication ===

export interface WebSocketAuthResult {
  authenticated: boolean;
  role?: AuthRole;
  keyName?: string;
  isLocalhost: boolean;
  userId?: string;
  workspaceId?: string;
  actorType?: AuthActorType;
  authMethod?: AuthMethod;
  tokenName?: string;
  permissions?: AuthPermission[];
  apiTokenId?: string;
  deviceSessionId?: string;
  deviceId?: string;
  clientId?: string;
  clientMode?: string;
  capabilities?: string[];
  degradedReason?: string | null;
  error?: string;
}

/**
 * Extract JWT from WebSocket request cookies
 */
function extractJwtFromWebSocket(req: IncomingMessage): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').reduce(
    (acc, cookie) => {
      const [key, value] = cookie.trim().split('=');
      if (key && value) acc[key] = value;
      return acc;
    },
    {} as Record<string, string>
  );

  return cookies['veritas_session'] || null;
}

/**
 * Authenticate a WebSocket connection request
 */
export function authenticateWebSocket(req: IncomingMessage): WebSocketAuthResult {
  const config = getAuthConfig();
  const securityConfig = getSecurityConfig();
  const isLocalhost = isLocalhostRequest(req);

  const passwordAuthEnabled = securityConfig.authEnabled && securityConfig.passwordHash;

  // Auth disabled via env var
  if (!config.enabled && !passwordAuthEnabled) {
    return {
      authenticated: true,
      ...buildAuthContext({ role: 'admin', isLocalhost, authMethod: 'disabled' }),
    };
  }

  // 1. Check JWT cookie (supports rotated secrets)
  if (passwordAuthEnabled) {
    const token = extractJwtFromWebSocket(req);
    if (token) {
      const result = verifyJwtToken(token);
      if (result.valid) {
        return {
          authenticated: true,
          ...buildAuthContext({
            role: 'admin',
            keyName: 'session',
            isLocalhost,
            authMethod: 'session',
          }),
        };
      }
      // Token invalid or expired, continue to other auth methods
    }
  }

  // 2. Check API key (headers; query-param fallback for WS only)
  const apiKey = extractApiKey(req, { allowQueryParam: true });
  if (apiKey) {
    const validation = validateApiKey(apiKey, config);
    if (validation.valid) {
      return {
        authenticated: true,
        ...buildAuthContext({
          role: validation.role!,
          keyName: validation.name,
          isLocalhost,
          authMethod: 'api-key',
        }),
      };
    }

    const scopedAuth = validateDatabaseApiToken(apiKey, req, isLocalhost);
    if (scopedAuth) {
      return {
        authenticated: true,
        ...scopedAuth,
      };
    }

    const deviceAuth = validateDatabaseDeviceSession(apiKey, req, isLocalhost);
    if (deviceAuth) {
      return {
        authenticated: true,
        ...deviceAuth,
      };
    }
  }

  // 3. Localhost bypass — role is configurable (default: read-only)
  if (config.allowLocalhostBypass && isLocalhost) {
    return {
      authenticated: true,
      ...buildAuthContext({
        role: config.localhostRole,
        keyName: 'localhost-bypass',
        isLocalhost,
        authMethod: 'localhost-bypass',
      }),
    };
  }

  return {
    authenticated: false,
    isLocalhost,
    error: passwordAuthEnabled
      ? 'Authentication required. Please log in.'
      : 'Authentication required. Provide API key via Authorization or X-API-Key header (WebSocket also supports api_key query parameter).',
  };
}

/**
 * Attach auth info to WebSocket for later use
 */
export interface AuthenticatedWebSocket extends WebSocket {
  auth?: AuthContext;
}

// === Origin Validation ===

/**
 * Validate the Origin header for WebSocket connections.
 * Blocks cross-origin browser attacks (CSWSH) while allowing non-browser clients.
 *
 * Rules:
 *   1. No origin header → ALLOW (non-browser clients: curl, Postman, agents)
 *   2. Origin in allowed list → ALLOW
 *   3. Development mode + localhost origin → ALLOW
 *   4. Otherwise → REJECT
 */
export function validateWebSocketOrigin(
  origin: string | undefined,
  allowedOrigins: string[]
): { allowed: boolean; reason: string } {
  // Non-browser clients don't send Origin — allow them through
  if (!origin) {
    return { allowed: true, reason: 'No origin header (non-browser client)' };
  }

  // Check against the explicit allowed list
  if (allowedOrigins.includes(origin)) {
    return { allowed: true, reason: 'Origin in allowed list' };
  }

  // In development, allow any localhost/127.0.0.1 origin
  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev) {
    try {
      const url = new URL(origin);
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        return { allowed: true, reason: 'Localhost origin (dev mode)' };
      }
    } catch {
      // Invalid URL — fall through to rejection
    }
  }

  return { allowed: false, reason: `Origin not allowed: ${origin}` };
}

// === Utility Functions ===

/**
 * Generate a secure random API key
 */
export function generateApiKey(prefix = 'vk'): string {
  const key = crypto.randomBytes(32).toString('base64url');
  return `${prefix}_${key}`;
}

/**
 * Check if current config requires authentication
 */
export function isAuthRequired(): boolean {
  const config = getAuthConfig();
  return config.enabled;
}

/**
 * Get current auth status for diagnostics
 */
export function getAuthStatus(): {
  enabled: boolean;
  localhostBypass: boolean;
  localhostRole: AuthRole;
  configuredKeys: number;
  hasAdminKey: boolean;
} {
  const config = getAuthConfig();
  return {
    enabled: config.enabled,
    localhostBypass: config.allowLocalhostBypass,
    localhostRole: config.localhostRole,
    configuredKeys: config.apiKeys.length,
    hasAdminKey: !!config.adminKey,
  };
}

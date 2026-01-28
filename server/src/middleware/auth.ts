import { Request, Response, NextFunction } from 'express';
import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import { getSecurityConfig, getJwtSecret, getValidJwtSecrets } from '../config/security.js';

// === Types ===

export type AuthRole = 'admin' | 'read-only' | 'agent';

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
  auth?: {
    role: AuthRole;
    keyName?: string;
    isLocalhost: boolean;
  };
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
      message: `Admin key is a known weak default ("${adminKey}"). Generate a strong key: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
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
  const forwarded = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim();
  let remoteAddr: string;

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

function extractApiKey(req: Request | IncomingMessage): string | null {
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

  // Check query parameter (for WebSocket connections)
  if ('query' in req && typeof req.query === 'object' && req.query !== null) {
    const query = req.query as Record<string, unknown>;
    if (typeof query.api_key === 'string') {
      return query.api_key;
    }
  }

  // For IncomingMessage (WebSocket), parse URL
  if ('url' in req && typeof req.url === 'string') {
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
      jwt.verify(token, secret);
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
    req.auth = { role: 'admin', isLocalhost };
    return next();
  }

  // 1. Check JWT cookie (human users)
  if (passwordAuthEnabled) {
    const jwtResult = verifyJwtCookie(req);
    if (jwtResult.valid) {
      req.auth = { role: 'admin', keyName: 'session', isLocalhost };
      return next();
    }
  }

  // 2. Check API key (agents/services)
  const apiKey = extractApiKey(req);
  if (apiKey) {
    const validation = validateApiKey(apiKey, config);
    if (validation.valid) {
      req.auth = {
        role: validation.role!,
        keyName: validation.name,
        isLocalhost,
      };
      return next();
    }
  }

  // 3. Localhost bypass (dev mode) — role is configurable (default: read-only)
  if (config.allowLocalhostBypass && isLocalhost) {
    req.auth = { role: config.localhostRole, keyName: 'localhost-bypass', isLocalhost };
    return next();
  }

  // No valid auth found
  res.status(401).json({
    error: 'Authentication required',
    code: 'AUTH_REQUIRED',
    hint: passwordAuthEnabled
      ? 'Please log in or provide an API key'
      : 'Provide API key via Authorization header (Bearer <key>), X-API-Key header, or api_key query parameter',
  });
}

/**
 * Authorization middleware factory - requires specific roles
 */
export function authorize(...allowedRoles: AuthRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
      return;
    }

    // Admin can do everything
    if (req.auth.role === 'admin') {
      return next();
    }

    if (!allowedRoles.includes(req.auth.role)) {
      res.status(403).json({
        error: 'Insufficient permissions',
        code: 'FORBIDDEN',
        required: allowedRoles,
        current: req.auth.role,
      });
      return;
    }

    next();
  };
}

/**
 * Middleware that allows read operations for read-only users
 * but requires admin for write operations
 */
export function authorizeWrite(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
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
    error: 'Write access denied',
    code: 'WRITE_FORBIDDEN',
    hint: 'Your API key has read-only access',
  });
}

// === WebSocket Authentication ===

export interface WebSocketAuthResult {
  authenticated: boolean;
  role?: AuthRole;
  keyName?: string;
  isLocalhost: boolean;
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
    return { authenticated: true, role: 'admin', isLocalhost };
  }

  // 1. Check JWT cookie (supports rotated secrets)
  if (passwordAuthEnabled) {
    const token = extractJwtFromWebSocket(req);
    if (token) {
      const result = verifyJwtToken(token);
      if (result.valid) {
        return { authenticated: true, role: 'admin', keyName: 'session', isLocalhost };
      }
      // Token invalid or expired, continue to other auth methods
    }
  }

  // 2. Check API key
  const apiKey = extractApiKey(req);
  if (apiKey) {
    const validation = validateApiKey(apiKey, config);
    if (validation.valid) {
      return {
        authenticated: true,
        role: validation.role,
        keyName: validation.name,
        isLocalhost,
      };
    }
  }

  // 3. Localhost bypass — role is configurable (default: read-only)
  if (config.allowLocalhostBypass && isLocalhost) {
    return {
      authenticated: true,
      role: config.localhostRole,
      keyName: 'localhost-bypass',
      isLocalhost,
    };
  }

  return {
    authenticated: false,
    isLocalhost,
    error: passwordAuthEnabled
      ? 'Authentication required. Please log in.'
      : 'Authentication required. Provide api_key query parameter.',
  };
}

/**
 * Attach auth info to WebSocket for later use
 */
export interface AuthenticatedWebSocket extends WebSocket {
  auth?: {
    role: AuthRole;
    keyName?: string;
    isLocalhost: boolean;
  };
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
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = prefix + '_';
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
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

import { Request, Response, NextFunction } from 'express';
import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';

// === Types ===

export type AuthRole = 'admin' | 'read-only' | 'agent';

export interface AuthConfig {
  /** Enable authentication (default: true) */
  enabled: boolean;
  /** Allow unauthenticated localhost connections when auth is enabled */
  allowLocalhostBypass: boolean;
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
function loadAuthConfig(): AuthConfig {
  const enabled = process.env.VERITAS_AUTH_ENABLED !== 'false';
  const allowLocalhostBypass = process.env.VERITAS_AUTH_LOCALHOST_BYPASS === 'true';
  const adminKey = process.env.VERITAS_ADMIN_KEY;
  
  // Parse API keys from environment (format: name:key:role,name2:key2:role2)
  const apiKeysEnv = process.env.VERITAS_API_KEYS || '';
  const apiKeys: ApiKeyConfig[] = apiKeysEnv
    .split(',')
    .filter(Boolean)
    .map(entry => {
      const [name, key, role] = entry.split(':');
      return {
        name: name?.trim() || 'unnamed',
        key: key?.trim() || '',
        role: (role?.trim() as AuthRole) || 'read-only',
      };
    })
    .filter(k => k.key);

  return {
    enabled,
    allowLocalhostBypass,
    apiKeys,
    adminKey,
  };
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

function validateApiKey(apiKey: string, config: AuthConfig): { valid: boolean; role?: AuthRole; name?: string } {
  // Check admin key first
  if (config.adminKey && apiKey === config.adminKey) {
    return { valid: true, role: 'admin', name: 'admin' };
  }
  
  // Check configured API keys
  const keyConfig = config.apiKeys.find(k => k.key === apiKey);
  if (keyConfig) {
    return { valid: true, role: keyConfig.role, name: keyConfig.name };
  }
  
  return { valid: false };
}

// === Express Middleware ===

/**
 * Authentication middleware - validates API key and sets auth context
 */
export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const config = getAuthConfig();
  const isLocalhost = isLocalhostRequest(req);
  
  // Auth disabled - allow all requests
  if (!config.enabled) {
    req.auth = { role: 'admin', isLocalhost };
    return next();
  }
  
  // Localhost bypass
  if (config.allowLocalhostBypass && isLocalhost) {
    req.auth = { role: 'admin', isLocalhost };
    return next();
  }
  
  // Extract and validate API key
  const apiKey = extractApiKey(req);
  
  if (!apiKey) {
    res.status(401).json({
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
      hint: 'Provide API key via Authorization header (Bearer <key>), X-API-Key header, or api_key query parameter',
    });
    return;
  }
  
  const validation = validateApiKey(apiKey, config);
  
  if (!validation.valid) {
    res.status(401).json({
      error: 'Invalid API key',
      code: 'INVALID_API_KEY',
    });
    return;
  }
  
  req.auth = {
    role: validation.role!,
    keyName: validation.name,
    isLocalhost,
  };
  
  next();
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
 * Authenticate a WebSocket connection request
 */
export function authenticateWebSocket(req: IncomingMessage): WebSocketAuthResult {
  const config = getAuthConfig();
  const isLocalhost = isLocalhostRequest(req);
  
  // Auth disabled
  if (!config.enabled) {
    return { authenticated: true, role: 'admin', isLocalhost };
  }
  
  // Localhost bypass
  if (config.allowLocalhostBypass && isLocalhost) {
    return { authenticated: true, role: 'admin', isLocalhost };
  }
  
  // Extract and validate API key
  const apiKey = extractApiKey(req);
  
  if (!apiKey) {
    return {
      authenticated: false,
      isLocalhost,
      error: 'Authentication required. Provide api_key query parameter.',
    };
  }
  
  const validation = validateApiKey(apiKey, config);
  
  if (!validation.valid) {
    return {
      authenticated: false,
      isLocalhost,
      error: 'Invalid API key',
    };
  }
  
  return {
    authenticated: true,
    role: validation.role,
    keyName: validation.name,
    isLocalhost,
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
  configuredKeys: number;
  hasAdminKey: boolean;
} {
  const config = getAuthConfig();
  return {
    enabled: config.enabled,
    localhostBypass: config.allowLocalhostBypass,
    configuredKeys: config.apiKeys.length,
    hasAdminKey: !!config.adminKey,
  };
}

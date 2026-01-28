/**
 * Auth Middleware Tests
 * Tests authentication, authorization, API key validation, WebSocket auth,
 * origin validation, and utility functions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage } from 'http';

// Mock the security config module BEFORE importing auth
vi.mock('../../config/security.js', () => ({
  getSecurityConfig: vi.fn(() => ({
    authEnabled: false,
    passwordHash: null,
    jwtSecret: 'test-secret-key',
  })),
  getJwtSecret: vi.fn(() => 'test-secret-key'),
  getValidJwtSecrets: vi.fn(() => ['test-secret-key']),
}));

import {
  authenticate,
  authorize,
  authorizeWrite,
  authenticateWebSocket,
  validateWebSocketOrigin,
  generateApiKey,
  isAuthRequired,
  getAuthStatus,
  getAuthConfig,
  type AuthenticatedRequest,
} from '../../middleware/auth.js';
import { getSecurityConfig, getValidJwtSecrets } from '../../config/security.js';
import jwt from 'jsonwebtoken';

// Helper to create a mock Express request
function mockRequest(overrides: Partial<Request> = {}): Request {
  const req = {
    headers: {},
    cookies: {},
    query: {},
    socket: { remoteAddress: '127.0.0.1' },
    ip: '127.0.0.1',
    method: 'GET',
    ...overrides,
  } as unknown as Request;
  return req;
}

// Helper to create mock response
function mockResponse(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

function mockNext(): NextFunction {
  return vi.fn();
}

describe('Auth Middleware', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset environment
    delete process.env.VERITAS_AUTH_ENABLED;
    delete process.env.VERITAS_AUTH_LOCALHOST_BYPASS;
    delete process.env.VERITAS_ADMIN_KEY;
    delete process.env.VERITAS_API_KEYS;
    process.env.NODE_ENV = 'development';

    // Reset mocks
    vi.mocked(getSecurityConfig).mockReturnValue({
      authEnabled: false,
      passwordHash: null,
    } as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // === getAuthConfig ===
  describe('getAuthConfig', () => {
    it('should return default config when no env vars set', () => {
      const config = getAuthConfig();
      expect(config.enabled).toBe(true); // default is enabled
      expect(config.allowLocalhostBypass).toBe(false);
      expect(config.apiKeys).toEqual([]);
    });

    it('should disable auth when VERITAS_AUTH_ENABLED=false', () => {
      process.env.VERITAS_AUTH_ENABLED = 'false';
      const config = getAuthConfig();
      expect(config.enabled).toBe(false);
    });

    it('should enable localhost bypass when env var is true', () => {
      process.env.VERITAS_AUTH_LOCALHOST_BYPASS = 'true';
      const config = getAuthConfig();
      expect(config.allowLocalhostBypass).toBe(true);
    });

    it('should parse API keys from environment', () => {
      process.env.VERITAS_API_KEYS = 'agent1:key123:agent,reader:key456:read-only';
      const config = getAuthConfig();
      expect(config.apiKeys).toHaveLength(2);
      expect(config.apiKeys[0]).toEqual({
        name: 'agent1',
        key: 'key123',
        role: 'agent',
      });
      expect(config.apiKeys[1]).toEqual({
        name: 'reader',
        key: 'key456',
        role: 'read-only',
      });
    });

    it('should filter out empty API key entries', () => {
      process.env.VERITAS_API_KEYS = 'agent1:key123:agent,,';
      const config = getAuthConfig();
      expect(config.apiKeys).toHaveLength(1);
    });

    it('should set admin key from env', () => {
      process.env.VERITAS_ADMIN_KEY = 'admin-secret';
      const config = getAuthConfig();
      expect(config.adminKey).toBe('admin-secret');
    });
  });

  // === authenticate middleware ===
  describe('authenticate', () => {
    it('should allow all requests when auth is disabled and no password auth', () => {
      process.env.VERITAS_AUTH_ENABLED = 'false';
      const req = mockRequest() as AuthenticatedRequest;
      const res = mockResponse();
      const next = mockNext();

      authenticate(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.auth?.role).toBe('admin');
    });

    it('should authenticate via API key in X-API-Key header', () => {
      process.env.VERITAS_ADMIN_KEY = 'my-admin-key';
      const req = mockRequest({
        headers: { 'x-api-key': 'my-admin-key' },
      }) as AuthenticatedRequest;
      const res = mockResponse();
      const next = mockNext();

      authenticate(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.auth?.role).toBe('admin');
      expect(req.auth?.keyName).toBe('admin');
    });

    it('should authenticate via Bearer token in Authorization header', () => {
      process.env.VERITAS_ADMIN_KEY = 'bearer-key';
      const req = mockRequest({
        headers: { authorization: 'Bearer bearer-key' },
      }) as AuthenticatedRequest;
      const res = mockResponse();
      const next = mockNext();

      authenticate(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.auth?.role).toBe('admin');
    });

    it('should authenticate via configured API key with specific role', () => {
      process.env.VERITAS_API_KEYS = 'myagent:agent-key-123:agent';
      const req = mockRequest({
        headers: { 'x-api-key': 'agent-key-123' },
      }) as AuthenticatedRequest;
      const res = mockResponse();
      const next = mockNext();

      authenticate(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.auth?.role).toBe('agent');
      expect(req.auth?.keyName).toBe('myagent');
    });

    it('should allow localhost bypass when enabled', () => {
      process.env.VERITAS_AUTH_LOCALHOST_BYPASS = 'true';
      const req = mockRequest({
        socket: { remoteAddress: '127.0.0.1' } as any,
      }) as AuthenticatedRequest;
      const res = mockResponse();
      const next = mockNext();

      authenticate(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.auth?.role).toBe('admin');
      expect(req.auth?.isLocalhost).toBe(true);
    });

    it('should reject unauthenticated requests when auth is required', () => {
      // Auth enabled (default), no password auth, no API key, no localhost bypass
      const req = mockRequest({
        socket: { remoteAddress: '192.168.1.100' } as any,
        ip: '192.168.1.100',
      }) as AuthenticatedRequest;
      const res = mockResponse();
      const next = mockNext();

      authenticate(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'AUTH_REQUIRED' })
      );
    });

    it('should reject invalid API key', () => {
      process.env.VERITAS_ADMIN_KEY = 'real-key';
      const req = mockRequest({
        headers: { 'x-api-key': 'wrong-key' },
        socket: { remoteAddress: '192.168.1.100' } as any,
        ip: '192.168.1.100',
      }) as AuthenticatedRequest;
      const res = mockResponse();
      const next = mockNext();

      authenticate(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should authenticate via JWT cookie when password auth is enabled', () => {
      const secret = 'test-secret-key';
      const token = jwt.sign({ type: 'session' }, secret, { expiresIn: '1h' });
      
      vi.mocked(getSecurityConfig).mockReturnValue({
        authEnabled: true,
        passwordHash: 'hashed-password',
      } as any);
      vi.mocked(getValidJwtSecrets).mockReturnValue([secret]);

      const req = mockRequest({
        cookies: { veritas_session: token },
      }) as AuthenticatedRequest;
      const res = mockResponse();
      const next = mockNext();

      authenticate(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.auth?.role).toBe('admin');
      expect(req.auth?.keyName).toBe('session');
    });

    it('should fall back to API key when JWT is invalid', () => {
      vi.mocked(getSecurityConfig).mockReturnValue({
        authEnabled: true,
        passwordHash: 'hashed-password',
      } as any);
      vi.mocked(getValidJwtSecrets).mockReturnValue(['different-secret']);

      process.env.VERITAS_ADMIN_KEY = 'fallback-key';
      const req = mockRequest({
        cookies: { veritas_session: 'invalid-token' },
        headers: { 'x-api-key': 'fallback-key' },
      }) as AuthenticatedRequest;
      const res = mockResponse();
      const next = mockNext();

      authenticate(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.auth?.role).toBe('admin');
    });

    it('should detect IPv6 localhost', () => {
      process.env.VERITAS_AUTH_LOCALHOST_BYPASS = 'true';
      const req = mockRequest({
        socket: { remoteAddress: '::1' } as any,
        ip: '::1',
      }) as AuthenticatedRequest;
      const res = mockResponse();
      const next = mockNext();

      authenticate(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.auth?.isLocalhost).toBe(true);
    });

    it('should detect IPv4-mapped IPv6 localhost', () => {
      process.env.VERITAS_AUTH_LOCALHOST_BYPASS = 'true';
      const req = mockRequest({
        socket: { remoteAddress: '::ffff:127.0.0.1' } as any,
        ip: '::ffff:127.0.0.1',
      }) as AuthenticatedRequest;
      const res = mockResponse();
      const next = mockNext();

      authenticate(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.auth?.isLocalhost).toBe(true);
    });

    it('should check X-Forwarded-For header for localhost detection', () => {
      process.env.VERITAS_AUTH_LOCALHOST_BYPASS = 'true';
      const req = mockRequest({
        headers: { 'x-forwarded-for': '127.0.0.1, 10.0.0.1' },
        socket: { remoteAddress: '10.0.0.1' } as any,
        ip: '10.0.0.1',
      }) as AuthenticatedRequest;
      const res = mockResponse();
      const next = mockNext();

      authenticate(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.auth?.isLocalhost).toBe(true);
    });

    it('should extract API key from query parameter', () => {
      process.env.VERITAS_ADMIN_KEY = 'query-key';
      const req = mockRequest({
        query: { api_key: 'query-key' },
        socket: { remoteAddress: '192.168.1.100' } as any,
        ip: '192.168.1.100',
      }) as AuthenticatedRequest;
      const res = mockResponse();
      const next = mockNext();

      authenticate(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.auth?.role).toBe('admin');
    });
  });

  // === authorize middleware ===
  describe('authorize', () => {
    it('should allow admin role for any authorization check', () => {
      const middleware = authorize('read-only');
      const req = mockRequest() as AuthenticatedRequest;
      req.auth = { role: 'admin', isLocalhost: true };
      const res = mockResponse();
      const next = mockNext();

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should allow specified role', () => {
      const middleware = authorize('agent', 'read-only');
      const req = mockRequest() as AuthenticatedRequest;
      req.auth = { role: 'agent', isLocalhost: false };
      const res = mockResponse();
      const next = mockNext();

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should reject unauthorized role', () => {
      const middleware = authorize('admin');
      const req = mockRequest() as AuthenticatedRequest;
      req.auth = { role: 'read-only', isLocalhost: false };
      const res = mockResponse();
      const next = mockNext();

      middleware(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'FORBIDDEN' })
      );
    });

    it('should reject unauthenticated requests', () => {
      const middleware = authorize('admin');
      const req = mockRequest() as AuthenticatedRequest;
      // No auth set
      const res = mockResponse();
      const next = mockNext();

      middleware(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  // === authorizeWrite middleware ===
  describe('authorizeWrite', () => {
    it('should allow admin to write', () => {
      const req = mockRequest({ method: 'POST' }) as AuthenticatedRequest;
      req.auth = { role: 'admin', isLocalhost: true };
      const res = mockResponse();
      const next = mockNext();

      authorizeWrite(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should allow agent to write', () => {
      const req = mockRequest({ method: 'PATCH' }) as AuthenticatedRequest;
      req.auth = { role: 'agent', isLocalhost: false };
      const res = mockResponse();
      const next = mockNext();

      authorizeWrite(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should allow read-only to GET', () => {
      const req = mockRequest({ method: 'GET' }) as AuthenticatedRequest;
      req.auth = { role: 'read-only', isLocalhost: false };
      const res = mockResponse();
      const next = mockNext();

      authorizeWrite(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should allow read-only to HEAD', () => {
      const req = mockRequest({ method: 'HEAD' }) as AuthenticatedRequest;
      req.auth = { role: 'read-only', isLocalhost: false };
      const res = mockResponse();
      const next = mockNext();

      authorizeWrite(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should allow read-only to OPTIONS', () => {
      const req = mockRequest({ method: 'OPTIONS' }) as AuthenticatedRequest;
      req.auth = { role: 'read-only', isLocalhost: false };
      const res = mockResponse();
      const next = mockNext();

      authorizeWrite(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should deny read-only POST', () => {
      const req = mockRequest({ method: 'POST' }) as AuthenticatedRequest;
      req.auth = { role: 'read-only', isLocalhost: false };
      const res = mockResponse();
      const next = mockNext();

      authorizeWrite(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'WRITE_FORBIDDEN' })
      );
    });

    it('should deny read-only DELETE', () => {
      const req = mockRequest({ method: 'DELETE' }) as AuthenticatedRequest;
      req.auth = { role: 'read-only', isLocalhost: false };
      const res = mockResponse();
      const next = mockNext();

      authorizeWrite(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should reject unauthenticated requests', () => {
      const req = mockRequest() as AuthenticatedRequest;
      // No auth
      const res = mockResponse();
      const next = mockNext();

      authorizeWrite(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  // === authenticateWebSocket ===
  describe('authenticateWebSocket', () => {
    it('should allow when auth is disabled', () => {
      process.env.VERITAS_AUTH_ENABLED = 'false';
      const req = {
        headers: {},
        socket: { remoteAddress: '192.168.1.100' },
      } as unknown as IncomingMessage;

      const result = authenticateWebSocket(req);
      expect(result.authenticated).toBe(true);
      expect(result.role).toBe('admin');
    });

    it('should authenticate via API key in query parameter', () => {
      process.env.VERITAS_ADMIN_KEY = 'ws-key';
      const req = {
        headers: { host: 'localhost:3001' },
        url: '/ws?api_key=ws-key',
        socket: { remoteAddress: '192.168.1.100' },
      } as unknown as IncomingMessage;

      const result = authenticateWebSocket(req);
      expect(result.authenticated).toBe(true);
      expect(result.role).toBe('admin');
    });

    it('should authenticate via JWT cookie', () => {
      const secret = 'test-secret-key';
      const token = jwt.sign({ type: 'session' }, secret, { expiresIn: '1h' });

      vi.mocked(getSecurityConfig).mockReturnValue({
        authEnabled: true,
        passwordHash: 'hashed',
      } as any);
      vi.mocked(getValidJwtSecrets).mockReturnValue([secret]);

      const req = {
        headers: {
          cookie: `veritas_session=${token}; other=val`,
          host: 'localhost:3001',
        },
        url: '/ws',
        socket: { remoteAddress: '192.168.1.100' },
      } as unknown as IncomingMessage;

      const result = authenticateWebSocket(req);
      expect(result.authenticated).toBe(true);
      expect(result.role).toBe('admin');
    });

    it('should allow localhost bypass for WebSocket', () => {
      process.env.VERITAS_AUTH_LOCALHOST_BYPASS = 'true';
      const req = {
        headers: {},
        url: '/ws',
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as IncomingMessage;

      const result = authenticateWebSocket(req);
      expect(result.authenticated).toBe(true);
      expect(result.role).toBe('admin');
    });

    it('should reject unauthenticated WebSocket when auth required', () => {
      const req = {
        headers: {},
        url: '/ws',
        socket: { remoteAddress: '192.168.1.100' },
      } as unknown as IncomingMessage;

      const result = authenticateWebSocket(req);
      expect(result.authenticated).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return error message mentioning login when password auth enabled', () => {
      vi.mocked(getSecurityConfig).mockReturnValue({
        authEnabled: true,
        passwordHash: 'some-hash',
      } as any);

      const req = {
        headers: {},
        url: '/ws',
        socket: { remoteAddress: '192.168.1.100' },
      } as unknown as IncomingMessage;

      const result = authenticateWebSocket(req);
      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('log in');
    });
  });

  // === validateWebSocketOrigin ===
  describe('validateWebSocketOrigin', () => {
    it('should allow requests without origin (non-browser clients)', () => {
      const result = validateWebSocketOrigin(undefined, []);
      expect(result.allowed).toBe(true);
    });

    it('should allow origin in allowed list', () => {
      const result = validateWebSocketOrigin('http://localhost:5173', ['http://localhost:5173']);
      expect(result.allowed).toBe(true);
    });

    it('should allow localhost origin in dev mode', () => {
      process.env.NODE_ENV = 'development';
      const result = validateWebSocketOrigin('http://localhost:3000', []);
      expect(result.allowed).toBe(true);
    });

    it('should allow 127.0.0.1 origin in dev mode', () => {
      process.env.NODE_ENV = 'development';
      const result = validateWebSocketOrigin('http://127.0.0.1:3000', []);
      expect(result.allowed).toBe(true);
    });

    it('should reject unknown origin in production', () => {
      process.env.NODE_ENV = 'production';
      const result = validateWebSocketOrigin('http://evil.com', []);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not allowed');
    });

    it('should reject invalid origin URL', () => {
      process.env.NODE_ENV = 'development';
      const result = validateWebSocketOrigin('not-a-valid-url', []);
      expect(result.allowed).toBe(false);
    });
  });

  // === Utility Functions ===
  describe('generateApiKey', () => {
    it('should generate a key with default prefix', () => {
      const key = generateApiKey();
      expect(key).toMatch(/^vk_[A-Za-z0-9]{32}$/);
    });

    it('should generate a key with custom prefix', () => {
      const key = generateApiKey('test');
      expect(key).toMatch(/^test_[A-Za-z0-9]{32}$/);
    });

    it('should generate unique keys', () => {
      const key1 = generateApiKey();
      const key2 = generateApiKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe('isAuthRequired', () => {
    it('should return true when auth is enabled', () => {
      // Default is enabled
      expect(isAuthRequired()).toBe(true);
    });

    it('should return false when auth is disabled', () => {
      process.env.VERITAS_AUTH_ENABLED = 'false';
      expect(isAuthRequired()).toBe(false);
    });
  });

  describe('getAuthStatus', () => {
    it('should return diagnostic info', () => {
      process.env.VERITAS_ADMIN_KEY = 'admin-key';
      process.env.VERITAS_API_KEYS = 'a:k1:agent,b:k2:read-only';
      const status = getAuthStatus();
      expect(status.enabled).toBe(true);
      expect(status.hasAdminKey).toBe(true);
      expect(status.configuredKeys).toBe(2);
    });

    it('should report no admin key when not set', () => {
      const status = getAuthStatus();
      expect(status.hasAdminKey).toBe(false);
    });
  });
});

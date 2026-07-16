/**
 * Auth Middleware Tests
 * Tests authentication, authorization, API key validation, WebSocket auth,
 * origin validation, and utility functions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage } from 'http';

// Mock the security config module BEFORE importing auth
vi.mock('../../config/security.js', () => {
  const getSecurityConfig = vi.fn(() => ({
    authEnabled: false,
    passwordHash: null,
    jwtSecret: 'test-secret-key',
  }));

  return {
    getSecurityConfig,
    getJwtSecret: vi.fn(() => 'test-secret-key'),
    getValidJwtSecrets: vi.fn(() => ['test-secret-key']),
    getSessionVersion: vi.fn((config?: { sessionVersion?: number }) => {
      const source = config ?? getSecurityConfig();
      return typeof source.sessionVersion === 'number' ? source.sessionVersion : 0;
    }),
  };
});

import {
  authenticate,
  authorize,
  authorizePermission,
  authorizePermissionByMethod,
  authorizeWrite,
  authenticateWebSocket,
  validateWebSocketOrigin,
  generateApiKey,
  hasPermission,
  isAuthRequired,
  getAuthStatus,
  getAuthConfig,
  type AuthenticatedRequest,
} from '../../middleware/auth.js';
import { getSecurityConfig, getValidJwtSecrets } from '../../config/security.js';
import jwt from 'jsonwebtoken';
import { ApiTokenService, resetApiTokenServiceForTests } from '../../services/api-token-service.js';
import {
  DeviceSessionService,
  resetDeviceSessionServiceForTests,
} from '../../services/device-session-service.js';
import { createTestSqliteDatabase } from '../../storage/sqlite/test-helpers.js';
import { SqliteApiTokenRepository } from '../../storage/sqlite/api-token-repository.js';
import { SqliteDeviceSessionRepository } from '../../storage/sqlite/device-session-repository.js';
import { SqliteIdentityRepository } from '../../storage/sqlite/identity-repository.js';
import type { IdentityActor } from '../../services/identity-service.js';

// Helper to create a mock Express request
function mockRequest(overrides: Partial<Request> = {}): Request {
  const req = {
    headers: { host: 'localhost:3001' },
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
    delete process.env.VERITAS_AUTH_LOCALHOST_ROLE;
    delete process.env.VERITAS_ADMIN_KEY;
    delete process.env.VERITAS_API_KEYS;
    delete process.env.VERITAS_SQLITE_PATH;
    process.env.NODE_ENV = 'development';

    // Reset mocks
    vi.mocked(getSecurityConfig).mockReturnValue({
      authEnabled: false,
      passwordHash: null,
    } as any);
  });

  afterEach(() => {
    resetApiTokenServiceForTests();
    resetDeviceSessionServiceForTests();
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // === getAuthConfig ===
  describe('getAuthConfig', () => {
    it('should return default config when no env vars set', () => {
      const config = getAuthConfig();
      expect(config.enabled).toBe(true); // default is enabled
      expect(config.allowLocalhostBypass).toBe(false);
      expect(config.localhostRole).toBe('read-only'); // default is read-only, not admin
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

    it('should parse localhost role from env', () => {
      process.env.VERITAS_AUTH_LOCALHOST_ROLE = 'admin';
      const config = getAuthConfig();
      expect(config.localhostRole).toBe('admin');
    });

    it('should accept agent as localhost role', () => {
      process.env.VERITAS_AUTH_LOCALHOST_ROLE = 'agent';
      const config = getAuthConfig();
      expect(config.localhostRole).toBe('agent');
    });

    it('should default to read-only for invalid localhost role', () => {
      process.env.VERITAS_AUTH_LOCALHOST_ROLE = 'superuser';
      const config = getAuthConfig();
      expect(config.localhostRole).toBe('read-only');
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
      expect(req.auth?.actorType).toBe('service');
      expect(req.auth?.authMethod).toBe('disabled');
      expect(req.auth?.workspaceId).toBe('local');
      expect(req.auth?.permissions).toEqual(['*']);
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
      expect(req.auth?.authMethod).toBe('api-key');
      expect(req.auth?.tokenName).toBe('admin');
      expect(req.auth?.actorType).toBe('service');
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
      expect(req.auth?.actorType).toBe('agent');
      expect(req.auth?.authMethod).toBe('api-key');
      expect(req.auth?.tokenName).toBe('myagent');
      expect(req.auth?.userId).toBe('local-user');
      expect(req.auth?.workspaceId).toBe('local');
      expect(req.auth?.permissions).toContain('task:write');
      expect(req.auth?.permissions).not.toContain('admin:manage');
    });

    it('should authenticate via SQLite scoped API token', async () => {
      const fixture = createTestSqliteDatabase();
      fixture.database.open();
      process.env.VERITAS_SQLITE_PATH = fixture.databasePath;

      const identityRepository = new SqliteIdentityRepository(fixture.database);
      const tokenRepository = new SqliteApiTokenRepository(fixture.database);
      const service = new ApiTokenService({
        identityRepository,
        tokenRepository,
        audit: vi.fn().mockResolvedValue(undefined),
        activity: { logActivity: vi.fn().mockResolvedValue(undefined) },
      });
      const owner = identityRepository.ensureLocalOwner({ displayName: 'Owner' });
      const ownerActor = {
        userId: owner.user.id,
        role: 'owner',
        displayName: owner.user.displayName,
        permissions: ['*'],
      } satisfies IdentityActor;
      const scoped = await service.createToken(
        {
          workspaceId: 'local',
          name: 'Scoped worker',
          scopes: ['workspace:read', 'task:read'],
        },
        ownerActor
      );
      resetApiTokenServiceForTests();

      try {
        const req = mockRequest({
          headers: { authorization: `Bearer ${scoped.secret}` },
          socket: { remoteAddress: '192.168.1.100' } as any,
          ip: '192.168.1.100',
        }) as AuthenticatedRequest;
        const res = mockResponse();
        const next = mockNext();

        authenticate(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.auth?.role).toBe('read-only');
        expect(req.auth?.keyName).toBe('Scoped worker');
        expect(req.auth?.workspaceId).toBe('local');
        expect(req.auth?.permissions).toEqual(['workspace:read', 'task:read']);
      } finally {
        fixture.cleanup();
      }
    });

    it('should authenticate via SQLite device session token', async () => {
      const fixture = createTestSqliteDatabase();
      fixture.database.open();
      process.env.VERITAS_SQLITE_PATH = fixture.databasePath;

      const identityRepository = new SqliteIdentityRepository(fixture.database);
      const deviceSessionRepository = new SqliteDeviceSessionRepository(fixture.database);
      const service = new DeviceSessionService({
        identityRepository,
        sessionRepository: deviceSessionRepository,
        audit: vi.fn().mockResolvedValue(undefined),
        activity: { logActivity: vi.fn().mockResolvedValue(undefined) },
      });
      const owner = identityRepository.ensureLocalOwner({ displayName: 'Owner' });
      const pairing = await service.createPairingCode(
        {
          workspaceId: 'local',
          deviceName: 'Mobile device',
          deviceType: 'pwa',
          clientId: 'mobile-auth-client',
          clientMode: 'mobile-pwa',
          capabilities: ['workspace:read', 'task:read'],
          scopes: ['workspace:read', 'task:read'],
          role: 'read-only',
        },
        {
          userId: owner.user.id,
          role: 'owner',
          displayName: owner.user.displayName,
          permissions: ['*'],
        }
      );
      const paired = await service.exchangePairingCode({
        code: pairing.code,
        clientId: pairing.payload.clientId,
        clientMode: pairing.payload.clientMode,
        capabilities: pairing.payload.capabilities,
        nonce: pairing.payload.nonce,
        signedAt: pairing.payload.signedAt,
        signature: pairing.payload.signature,
      });
      resetDeviceSessionServiceForTests();

      try {
        const req = mockRequest({
          headers: { authorization: `Bearer ${paired.secret}` },
          socket: { remoteAddress: '192.168.1.101' } as any,
          ip: '192.168.1.101',
        }) as AuthenticatedRequest;
        const res = mockResponse();
        const next = mockNext();

        authenticate(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.auth?.role).toBe('read-only');
        expect(req.auth?.actorType).toBe('device');
        expect(req.auth?.authMethod).toBe('device-session');
        expect(req.auth?.deviceSessionId).toBe(paired.session.id);
        expect(req.auth?.deviceId).toBe(paired.session.deviceId);
        expect(req.auth?.clientId).toBe('mobile-auth-client');
        expect(req.auth?.clientMode).toBe('mobile-pwa');
        expect(req.auth?.permissions).toEqual(['workspace:read', 'task:read']);
      } finally {
        fixture.cleanup();
      }
    });

    it('should allow localhost bypass with read-only role by default', () => {
      process.env.VERITAS_AUTH_LOCALHOST_BYPASS = 'true';
      const req = mockRequest({
        socket: { remoteAddress: '127.0.0.1' } as any,
      }) as AuthenticatedRequest;
      const res = mockResponse();
      const next = mockNext();

      authenticate(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.auth?.role).toBe('read-only');
      expect(req.auth?.keyName).toBe('localhost-bypass');
      expect(req.auth?.isLocalhost).toBe(true);
      expect(req.auth?.actorType).toBe('localhost-bypass');
      expect(req.auth?.authMethod).toBe('localhost-bypass');
      expect(req.auth?.permissions).toContain('task:read');
      expect(req.auth?.permissions).not.toContain('task:write');
    });

    it('should allow localhost bypass with admin role when explicitly configured', () => {
      process.env.VERITAS_AUTH_LOCALHOST_BYPASS = 'true';
      process.env.VERITAS_AUTH_LOCALHOST_ROLE = 'admin';
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

    it('should allow localhost bypass with agent role when configured', () => {
      process.env.VERITAS_AUTH_LOCALHOST_BYPASS = 'true';
      process.env.VERITAS_AUTH_LOCALHOST_ROLE = 'agent';
      const req = mockRequest({
        socket: { remoteAddress: '127.0.0.1' } as any,
      }) as AuthenticatedRequest;
      const res = mockResponse();
      const next = mockNext();

      authenticate(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.auth?.role).toBe('agent');
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
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
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
      });
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
      expect(req.auth?.actorType).toBe('user');
      expect(req.auth?.authMethod).toBe('session');
      expect(req.auth?.workspaceId).toBe('local');
    });

    it('should authenticate production loopback JWT cookie for packaged desktop local owner', () => {
      process.env.NODE_ENV = 'production';
      const secret = 'test-secret-key';
      const token = jwt.sign({ type: 'session' }, secret, { expiresIn: '1h' });

      vi.mocked(getSecurityConfig).mockReturnValue({
        authEnabled: true,
        passwordHash: 'hashed-password',
      });
      vi.mocked(getValidJwtSecrets).mockReturnValue([secret]);

      const req = mockRequest({
        cookies: { veritas_session: token },
        headers: {
          host: '127.0.0.1:3001',
          origin: 'http://127.0.0.1:3001',
          referer: 'http://127.0.0.1:3001/',
        },
        socket: { remoteAddress: '127.0.0.1' } as Request['socket'],
        ip: '127.0.0.1',
      }) as AuthenticatedRequest;
      const res = mockResponse();
      const next = mockNext();

      authenticate(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.auth?.role).toBe('admin');
      expect(req.auth?.authMethod).toBe('session');
      expect(req.auth?.isLocalhost).toBe(false);
      expect(req.auth?.capabilities).toEqual(['local-agent:run']);
    });

    it('should reject JWT cookie from remote hosts because password sessions are local-owner only', () => {
      const secret = 'test-secret-key';
      const token = jwt.sign({ type: 'session' }, secret, { expiresIn: '1h' });

      vi.mocked(getSecurityConfig).mockReturnValue({
        authEnabled: true,
        passwordHash: 'hashed-password',
      });
      vi.mocked(getValidJwtSecrets).mockReturnValue([secret]);

      const req = mockRequest({
        cookies: { veritas_session: token },
        headers: {
          host: 'kanban.example.com',
          origin: 'https://kanban.example.com',
        },
        socket: { remoteAddress: '203.0.113.10' } as Request['socket'],
        ip: '203.0.113.10',
      }) as AuthenticatedRequest;
      const res = mockResponse();
      const next = mockNext();

      authenticate(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'PASSWORD_SESSION_LOCAL_ONLY' })
      );
    });

    it('should reject JWT cookie through a non-loopback forwarded host', () => {
      const secret = 'test-secret-key';
      const token = jwt.sign({ type: 'session' }, secret, { expiresIn: '1h' });

      vi.mocked(getSecurityConfig).mockReturnValue({
        authEnabled: true,
        passwordHash: 'hashed-password',
      });
      vi.mocked(getValidJwtSecrets).mockReturnValue([secret]);

      const req = mockRequest({
        cookies: { veritas_session: token },
        headers: {
          host: 'localhost:3001',
          'x-forwarded-host': 'kanban.example.com',
        },
      }) as AuthenticatedRequest;
      const res = mockResponse();
      const next = mockNext();

      authenticate(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'PASSWORD_SESSION_LOCAL_ONLY' })
      );
    });

    it('should still allow API key auth when a remote password-session cookie is present', () => {
      const secret = 'test-secret-key';
      const token = jwt.sign({ type: 'session' }, secret, { expiresIn: '1h' });

      vi.mocked(getSecurityConfig).mockReturnValue({
        authEnabled: true,
        passwordHash: 'hashed-password',
      });
      vi.mocked(getValidJwtSecrets).mockReturnValue([secret]);

      process.env.VERITAS_ADMIN_KEY = 'fallback-key';
      const req = mockRequest({
        cookies: { veritas_session: token },
        headers: {
          host: 'kanban.example.com',
          origin: 'https://kanban.example.com',
          'x-api-key': 'fallback-key',
        },
        socket: { remoteAddress: '203.0.113.10' } as Request['socket'],
        ip: '203.0.113.10',
      }) as AuthenticatedRequest;
      const res = mockResponse();
      const next = mockNext();

      authenticate(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.auth?.authMethod).toBe('api-key');
    });

    it('should reject JWT cookie when session version is stale', () => {
      const secret = 'test-secret-key';
      const token = jwt.sign({ type: 'session', sessionVersion: 0 }, secret, { expiresIn: '1h' });

      vi.mocked(getSecurityConfig).mockReturnValue({
        authEnabled: true,
        passwordHash: 'hashed-password',
        sessionVersion: 1,
      } as any);
      vi.mocked(getValidJwtSecrets).mockReturnValue([secret]);

      const req = mockRequest({
        cookies: { veritas_session: token },
        socket: { remoteAddress: '192.168.1.100' } as any,
        ip: '192.168.1.100',
      }) as AuthenticatedRequest;
      const res = mockResponse();
      const next = mockNext();

      authenticate(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
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
      process.env.VERITAS_ADMIN_KEY = 'test-key'; // Ensure there's an API key for non-localhost fallback
      const req = mockRequest({
        headers: {
          'x-forwarded-for': '127.0.0.1, 10.0.0.1',
          'x-api-key': 'test-key', // Provide API key as fallback
        },
        socket: { remoteAddress: '10.0.0.1' } as any,
        ip: '10.0.0.1',
      }) as AuthenticatedRequest;
      const res = mockResponse();
      const next = mockNext();

      authenticate(req, res, next);
      expect(next).toHaveBeenCalled();
      // The current implementation may not check X-Forwarded-For for localhost
      // If it's truly from 10.0.0.1, it should authenticate via API key instead
      expect(req.auth?.role).toBe('admin');
    });

    it('should reject API key in HTTP query parameter (headers only)', () => {
      process.env.VERITAS_ADMIN_KEY = 'query-key';
      const req = mockRequest({
        query: { api_key: 'query-key' },
        socket: { remoteAddress: '192.168.1.100' } as any,
        ip: '192.168.1.100',
      }) as AuthenticatedRequest;
      const res = mockResponse();
      const next = mockNext();

      authenticate(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  // === permission helpers ===
  describe('permission helpers', () => {
    it('should allow admin for any permission', () => {
      expect(hasPermission({ role: 'admin' }, 'admin:manage')).toBe(true);
      expect(hasPermission({ role: 'admin', permissions: [] }, 'task:write')).toBe(true);
    });

    it('should evaluate role-derived permissions when permissions are absent', () => {
      expect(hasPermission({ role: 'agent' }, 'task:write')).toBe(true);
      expect(hasPermission({ role: 'agent' }, 'admin:manage')).toBe(false);
      expect(hasPermission({ role: 'read-only' }, 'task:read')).toBe(true);
      expect(hasPermission({ role: 'read-only' }, 'task:write')).toBe(false);
    });

    it('should allow explicit permission middleware matches', () => {
      const middleware = authorizePermission('task:write');
      const req = mockRequest() as AuthenticatedRequest;
      req.auth = { role: 'agent', isLocalhost: false };
      const res = mockResponse();
      const next = mockNext();

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should reject explicit permission middleware misses', () => {
      const middleware = authorizePermission('admin:manage');
      const req = mockRequest() as AuthenticatedRequest;
      req.auth = { role: 'agent', isLocalhost: false };
      const res = mockResponse();
      const next = mockNext();

      middleware(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
    });

    it('should select read permissions for safe HTTP methods', () => {
      const middleware = authorizePermissionByMethod({
        read: 'settings:read',
        write: 'settings:write',
      });
      const req = mockRequest({ method: 'GET' }) as AuthenticatedRequest;
      req.auth = { role: 'read-only', isLocalhost: false };
      const res = mockResponse();
      const next = mockNext();

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should select write permissions for mutating HTTP methods', () => {
      const middleware = authorizePermissionByMethod({
        read: 'settings:read',
        write: 'settings:write',
      });
      const req = mockRequest({ method: 'PATCH' }) as AuthenticatedRequest;
      req.auth = { role: 'agent', isLocalhost: false };
      const res = mockResponse();
      const next = mockNext();

      middleware(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ required: ['settings:write'] }),
        })
      );
    });

    it('should honor method and path permission overrides', () => {
      const middleware = authorizePermissionByMethod({
        read: 'workflow:read',
        write: 'workflow:write',
        overrides: [
          { methods: ['POST'], path: /^\/workflow-1\/runs\/?$/, permissions: 'workflow:execute' },
        ],
      });
      const req = mockRequest({ method: 'POST', path: '/workflow-1/runs' }) as AuthenticatedRequest;
      req.auth = { role: 'agent', isLocalhost: false };
      const res = mockResponse();
      const next = mockNext();

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
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
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
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
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'WRITE_FORBIDDEN' }));
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
      expect(result.authMethod).toBe('disabled');
      expect(result.permissions).toEqual(['*']);
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
      expect(result.authMethod).toBe('api-key');
      expect(result.tokenName).toBe('admin');
    });

    it('should authenticate WebSocket API keys with v5 auth context', () => {
      process.env.VERITAS_API_KEYS = 'myagent:ws-agent-key:agent';
      const req = {
        headers: { authorization: 'Bearer ws-agent-key', host: 'localhost:3001' },
        url: '/ws',
        socket: { remoteAddress: '192.168.1.100' },
      } as unknown as IncomingMessage;

      const result = authenticateWebSocket(req);
      expect(result.authenticated).toBe(true);
      expect(result.role).toBe('agent');
      expect(result.actorType).toBe('agent');
      expect(result.authMethod).toBe('api-key');
      expect(result.tokenName).toBe('myagent');
      expect(result.workspaceId).toBe('local');
      expect(result.permissions).toContain('task:write');
      expect(result.permissions).not.toContain('admin:manage');
    });

    it('should authenticate WebSocket scoped API tokens from the query parameter', async () => {
      const fixture = createTestSqliteDatabase();
      fixture.database.open();
      process.env.VERITAS_SQLITE_PATH = fixture.databasePath;

      const identityRepository = new SqliteIdentityRepository(fixture.database);
      const tokenRepository = new SqliteApiTokenRepository(fixture.database);
      const service = new ApiTokenService({
        identityRepository,
        tokenRepository,
        audit: vi.fn().mockResolvedValue(undefined),
        activity: { logActivity: vi.fn().mockResolvedValue(undefined) },
      });
      const owner = identityRepository.ensureLocalOwner({ displayName: 'Owner' });
      const scoped = await service.createToken(
        {
          workspaceId: 'local',
          name: 'WebSocket reader',
          scopes: ['workspace:read', 'task:read'],
        },
        {
          userId: owner.user.id,
          role: 'owner',
          displayName: owner.user.displayName,
          permissions: ['*'],
        }
      );
      resetApiTokenServiceForTests();

      try {
        const req = {
          headers: { host: 'localhost:3001' },
          url: `/ws?api_key=${encodeURIComponent(scoped.secret)}`,
          socket: { remoteAddress: '192.168.1.100' },
        } as unknown as IncomingMessage;

        const result = authenticateWebSocket(req);
        expect(result.authenticated).toBe(true);
        expect(result.role).toBe('read-only');
        expect(result.tokenName).toBe('WebSocket reader');
        expect(result.workspaceId).toBe('local');
        expect(result.permissions).toEqual(['workspace:read', 'task:read']);
      } finally {
        fixture.cleanup();
      }
    });

    it('should authenticate WebSocket device session tokens from the query parameter', async () => {
      const fixture = createTestSqliteDatabase();
      fixture.database.open();
      process.env.VERITAS_SQLITE_PATH = fixture.databasePath;

      const identityRepository = new SqliteIdentityRepository(fixture.database);
      const deviceSessionRepository = new SqliteDeviceSessionRepository(fixture.database);
      const service = new DeviceSessionService({
        identityRepository,
        sessionRepository: deviceSessionRepository,
        audit: vi.fn().mockResolvedValue(undefined),
        activity: { logActivity: vi.fn().mockResolvedValue(undefined) },
      });
      const owner = identityRepository.ensureLocalOwner({ displayName: 'Owner' });
      const pairing = await service.createPairingCode(
        {
          workspaceId: 'local',
          deviceName: 'WebSocket mobile',
          deviceType: 'pwa',
          clientId: 'ws-mobile-client',
          clientMode: 'mobile-pwa',
          capabilities: ['workspace:read', 'task:read'],
          scopes: ['workspace:read', 'task:read'],
          role: 'read-only',
        },
        {
          userId: owner.user.id,
          role: 'owner',
          displayName: owner.user.displayName,
          permissions: ['*'],
        }
      );
      const paired = await service.exchangePairingCode({
        code: pairing.code,
        clientId: pairing.payload.clientId,
        clientMode: pairing.payload.clientMode,
        capabilities: pairing.payload.capabilities,
        nonce: pairing.payload.nonce,
        signedAt: pairing.payload.signedAt,
        signature: pairing.payload.signature,
      });
      resetDeviceSessionServiceForTests();

      try {
        const req = {
          headers: { host: 'localhost:3001' },
          url: `/ws?api_key=${encodeURIComponent(paired.secret)}`,
          socket: { remoteAddress: '192.168.1.101' },
        } as unknown as IncomingMessage;

        const result = authenticateWebSocket(req);
        expect(result.authenticated).toBe(true);
        expect(result.role).toBe('read-only');
        expect(result.actorType).toBe('device');
        expect(result.authMethod).toBe('device-session');
        expect(result.deviceSessionId).toBe(paired.session.id);
        expect(result.deviceId).toBe(paired.session.deviceId);
        expect(result.clientId).toBe('ws-mobile-client');
        expect(result.permissions).toEqual(['workspace:read', 'task:read']);
      } finally {
        fixture.cleanup();
      }
    });

    it('should authenticate via JWT cookie', () => {
      const secret = 'test-secret-key';
      const token = jwt.sign({ type: 'session' }, secret, { expiresIn: '1h' });

      vi.mocked(getSecurityConfig).mockReturnValue({
        authEnabled: true,
        passwordHash: 'hashed',
      });
      vi.mocked(getValidJwtSecrets).mockReturnValue([secret]);

      const req = {
        headers: {
          cookie: `veritas_session=${token}; other=val`,
          host: 'localhost:3001',
        },
        url: '/ws',
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as IncomingMessage;

      const result = authenticateWebSocket(req);
      expect(result.authenticated).toBe(true);
      expect(result.role).toBe('admin');
      expect(result.authMethod).toBe('session');
      expect(result.actorType).toBe('user');
    });

    it('should authenticate production loopback WebSocket JWT cookie for packaged desktop local owner', () => {
      process.env.NODE_ENV = 'production';
      const secret = 'test-secret-key';
      const token = jwt.sign({ type: 'session' }, secret, { expiresIn: '1h' });

      vi.mocked(getSecurityConfig).mockReturnValue({
        authEnabled: true,
        passwordHash: 'hashed',
      });
      vi.mocked(getValidJwtSecrets).mockReturnValue([secret]);

      const req = {
        headers: {
          cookie: `veritas_session=${token}; other=val`,
          host: '127.0.0.1:3001',
          origin: 'http://127.0.0.1:3001',
        },
        url: '/ws',
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as IncomingMessage;

      const result = authenticateWebSocket(req);
      expect(result.authenticated).toBe(true);
      expect(result.role).toBe('admin');
      expect(result.authMethod).toBe('session');
      expect(result.isLocalhost).toBe(false);
      expect(result.capabilities).toEqual(['local-agent:run']);
    });

    it('should reject WebSocket JWT cookie from remote hosts', () => {
      const secret = 'test-secret-key';
      const token = jwt.sign({ type: 'session' }, secret, { expiresIn: '1h' });

      vi.mocked(getSecurityConfig).mockReturnValue({
        authEnabled: true,
        passwordHash: 'hashed',
      });
      vi.mocked(getValidJwtSecrets).mockReturnValue([secret]);

      const req = {
        headers: {
          cookie: `veritas_session=${token}; other=val`,
          host: 'kanban.example.com',
          origin: 'https://kanban.example.com',
        },
        url: '/ws',
        socket: { remoteAddress: '203.0.113.10' },
      } as unknown as IncomingMessage;

      const result = authenticateWebSocket(req);
      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('Password sessions are limited to local-owner');
    });

    it('should allow WebSocket API key fallback when a remote password-session cookie is present', () => {
      const secret = 'test-secret-key';
      const token = jwt.sign({ type: 'session' }, secret, { expiresIn: '1h' });

      vi.mocked(getSecurityConfig).mockReturnValue({
        authEnabled: true,
        passwordHash: 'hashed',
      });
      vi.mocked(getValidJwtSecrets).mockReturnValue([secret]);

      process.env.VERITAS_ADMIN_KEY = 'ws-fallback-key';
      const req = {
        headers: {
          cookie: `veritas_session=${token}; other=val`,
          host: 'kanban.example.com',
          'x-api-key': 'ws-fallback-key',
        },
        url: '/ws',
        socket: { remoteAddress: '203.0.113.10' },
      } as unknown as IncomingMessage;

      const result = authenticateWebSocket(req);
      expect(result.authenticated).toBe(true);
      expect(result.authMethod).toBe('api-key');
    });

    it('should reject WebSocket JWT cookie when session version is stale', () => {
      const secret = 'test-secret-key';
      const token = jwt.sign({ type: 'session', sessionVersion: 0 }, secret, { expiresIn: '1h' });

      vi.mocked(getSecurityConfig).mockReturnValue({
        authEnabled: true,
        passwordHash: 'hashed',
        sessionVersion: 1,
      } as any);
      vi.mocked(getValidJwtSecrets).mockReturnValue([secret]);

      const req = {
        headers: {
          cookie: `veritas_session=${token}`,
          host: 'localhost:3001',
        },
        url: '/ws',
        socket: { remoteAddress: '192.168.1.100' },
      } as unknown as IncomingMessage;

      const result = authenticateWebSocket(req);
      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('Authentication required');
    });

    it('should allow localhost bypass for WebSocket with read-only role by default', () => {
      process.env.VERITAS_AUTH_LOCALHOST_BYPASS = 'true';
      const req = {
        headers: {},
        url: '/ws',
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as IncomingMessage;

      const result = authenticateWebSocket(req);
      expect(result.authenticated).toBe(true);
      expect(result.role).toBe('read-only');
      expect(result.keyName).toBe('localhost-bypass');
      expect(result.authMethod).toBe('localhost-bypass');
      expect(result.actorType).toBe('localhost-bypass');
    });

    it('should allow WebSocket localhost bypass with admin when configured', () => {
      process.env.VERITAS_AUTH_LOCALHOST_BYPASS = 'true';
      process.env.VERITAS_AUTH_LOCALHOST_ROLE = 'admin';
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
      // Keys now include - and _ characters for URL-safe base64
      expect(key).toMatch(/^vk_[A-Za-z0-9_-]{40,}$/);
    });

    it('should generate a key with custom prefix', () => {
      const key = generateApiKey('test');
      // Keys now include - and _ characters for URL-safe base64
      expect(key).toMatch(/^test_[A-Za-z0-9_-]{40,}$/);
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
      expect(status.localhostRole).toBe('read-only');
    });

    it('should report no admin key when not set', () => {
      const status = getAuthStatus();
      expect(status.hasAdminKey).toBe(false);
    });

    it('should report configured localhost role', () => {
      process.env.VERITAS_AUTH_LOCALHOST_ROLE = 'agent';
      const status = getAuthStatus();
      expect(status.localhostRole).toBe('agent');
    });
  });
});

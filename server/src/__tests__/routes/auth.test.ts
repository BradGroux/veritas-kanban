/**
 * Auth Routes Integration Tests
 * Tests /api/auth endpoints using the actual route module.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// We need to mock the security module before importing routes
let testConfigDir: string;
let testSecurityFile: string;
let securityConfig: any = {};
let desktopSetupContext: Record<string, unknown> | undefined;
let openAiEnabled = false;
const beginOpenAiSignIn = vi.fn();
const completeOpenAiSignIn = vi.fn();
let storedOpenAiTransaction: Record<string, string> | null = null;

// Mock security module
vi.mock('../../config/security.js', () => {
  return {
    getSecurityConfig: () => securityConfig,
    saveSecurityConfig: (config: any) => {
      securityConfig = config;
    },
    getJwtSecret: () => securityConfig.jwtSecret || 'test-secret-key-for-jwt-signing-12345678',
    getValidJwtSecrets: () => [
      securityConfig.jwtSecret || 'test-secret-key-for-jwt-signing-12345678',
    ],
    getSessionVersion: (config: any = securityConfig) =>
      typeof config.sessionVersion === 'number' ? config.sessionVersion : 0,
    nextSessionVersion: (config: any = securityConfig) =>
      (typeof config.sessionVersion === 'number' ? config.sessionVersion : 0) + 1,
    generateRecoveryKey: () => 'RECOVERY-KEY-12345678',
    hashRecoveryKey: async (key: string) => {
      return crypto.createHash('sha256').update(key).digest('hex');
    },
    rotateJwtSecret: (gracePeriodMs?: number) => ({
      success: true,
      newVersion: 2,
      prunedCount: 0,
      message: 'Rotated',
    }),
    getJwtRotationStatus: () => ({
      currentVersion: 1,
      totalSecrets: 1,
      oldestSecretAge: 0,
    }),
  };
});

vi.mock('../../services/desktop-setup-context-service.js', () => ({
  getDesktopSetupContext: () => desktopSetupContext,
}));

vi.mock('../../services/openai-oidc-service.js', () => ({
  isOpenAiOidcConfigured: () => openAiEnabled,
  getOpenAiOidcService: () => ({
    begin: beginOpenAiSignIn,
    complete: completeOpenAiSignIn,
  }),
  storeOpenAiOidcTransaction: (transaction: Record<string, string>) => {
    storedOpenAiTransaction = transaction;
    return 'transaction-id';
  },
  consumeOpenAiOidcTransaction: (id: string) => {
    if (id !== 'transaction-id') return null;
    const transaction = storedOpenAiTransaction;
    storedOpenAiTransaction = null;
    return transaction;
  },
}));

// Import auth route after mocking
import authRouter from '../../routes/auth.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { authRateLimit } from '../../middleware/rate-limit.js';
import {
  DeviceSessionService,
  resetDeviceSessionServiceForTests,
} from '../../services/device-session-service.js';
import { createTestSqliteDatabase } from '../../storage/sqlite/test-helpers.js';
import { SqliteDeviceSessionRepository } from '../../storage/sqlite/device-session-repository.js';
import { SqliteIdentityRepository } from '../../storage/sqlite/identity-repository.js';
import {
  getIdentityService,
  resetIdentityServiceForTests,
} from '../../services/identity-service.js';

describe('Auth Routes', () => {
  let app: express.Express;

  beforeEach(async () => {
    // Reset security config for each test
    securityConfig = {
      authEnabled: false,
      passwordHash: null,
      jwtSecret: 'test-secret-key-for-jwt-signing-12345678',
      sessionVersion: 0,
    };
    desktopSetupContext = undefined;
    openAiEnabled = false;
    beginOpenAiSignIn.mockReset();
    completeOpenAiSignIn.mockReset();
    storedOpenAiTransaction = null;

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/auth', authRouter);
    app.use(errorHandler);
  });

  afterEach(() => {
    resetDeviceSessionServiceForTests();
    resetIdentityServiceForTests();
    delete process.env.VERITAS_JWT_SECRET;
    delete process.env.VERITAS_SQLITE_PATH;
    delete process.env.VERITAS_STORAGE;
  });

  describe('GET /api/auth/status', () => {
    it('should indicate setup is needed when no password set', async () => {
      const res = await request(app).get('/api/auth/status');
      expect(res.status).toBe(200);
      expect(res.body.needsSetup).toBe(true);
      expect(res.body.authenticated).toBe(false);
    });

    it('includes populated desktop data context while setup is needed', async () => {
      desktopSetupContext = {
        storageMode: 'sqlite',
        hasExistingData: true,
        counts: {
          tasks: 2236,
          squadMessages: 74196,
          telemetryEvents: 98,
          workflowDefinitions: 2,
          workflowRuns: 3,
        },
      };

      const res = await request(app).get('/api/auth/status');

      expect(res.status).toBe(200);
      expect(res.body.setupContext).toEqual(desktopSetupContext);
    });

    it('should indicate setup complete when password exists', async () => {
      securityConfig.passwordHash = await bcrypt.hash('test-password', 4);
      securityConfig.authEnabled = true;

      const res = await request(app).get('/api/auth/status');
      expect(res.status).toBe(200);
      expect(res.body.needsSetup).toBe(false);
      expect(res.body.setupContext).toBeUndefined();
    });

    it('should detect valid JWT cookie', async () => {
      securityConfig.passwordHash = await bcrypt.hash('test-password', 4);
      securityConfig.authEnabled = true;

      const token = jwt.sign(
        { type: 'session', sessionVersion: securityConfig.sessionVersion },
        securityConfig.jwtSecret,
        { expiresIn: '1h' }
      );

      const res = await request(app)
        .get('/api/auth/status')
        .set('Cookie', `veritas_session=${token}`);

      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(true);
      expect(res.body.sessionExpiry).toBeDefined();
    });

    it('should handle invalid JWT cookie gracefully', async () => {
      securityConfig.passwordHash = await bcrypt.hash('test-password', 4);
      securityConfig.authEnabled = true;

      const res = await request(app)
        .get('/api/auth/status')
        .set('Cookie', 'veritas_session=invalid-token');

      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(false);
    });

    it('should not consume strict auth attempts for status checks in production', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const limitedApp = express();
      limitedApp.use(express.json());
      limitedApp.use(cookieParser());
      limitedApp.use('/api/auth', authRateLimit, authRouter);
      limitedApp.use(errorHandler);

      try {
        for (let i = 0; i < 12; i++) {
          const res = await request(limitedApp).get('/api/auth/status');
          expect(res.status).toBe(200);
          expect(res.body.needsSetup).toBe(true);
        }
      } finally {
        if (originalNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = originalNodeEnv;
        }
      }
    });
  });

  describe('Sign in with ChatGPT', () => {
    it('reports the identity provider as disabled without activation configuration', async () => {
      const res = await request(app).get('/api/auth/openai/status');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ enabled: false, capability: 'identity' });
    });

    it('starts a PKCE transaction in an HttpOnly callback-scoped cookie', async () => {
      openAiEnabled = true;
      beginOpenAiSignIn.mockResolvedValue({
        authorizationUrl: 'https://auth.openai.com/api/accounts/authorize?client_id=oaiapp_test',
        transaction: {
          state: 'state-value',
          nonce: 'nonce-value',
          codeVerifier: 'verifier-value',
          redirectUri: 'https://kanban.example.com/api/auth/openai/callback',
        },
      });

      const res = await request(app).get('/api/auth/openai/start');

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('https://auth.openai.com/');
      expect(res.headers['set-cookie']?.[0]).toContain('HttpOnly');
      expect(res.headers['set-cookie']?.[0]).toContain('SameSite=Lax');
      expect(res.headers['set-cookie']?.[0]).toContain('Path=/api/auth/openai/callback');
    });

    it('rejects a callback whose state does not match before token exchange', async () => {
      openAiEnabled = true;
      beginOpenAiSignIn.mockResolvedValue({
        authorizationUrl: 'https://auth.openai.com/api/accounts/authorize',
        transaction: {
          state: 'expected-state',
          nonce: 'nonce-value',
          codeVerifier: 'verifier-value',
          redirectUri: 'https://kanban.example.com/api/auth/openai/callback',
        },
      });
      const start = await request(app).get('/api/auth/openai/start');
      const cookie = start.headers['set-cookie']?.[0].split(';')[0];

      const res = await request(app)
        .get('/api/auth/openai/callback?code=secret-code&state=wrong-state')
        .set('Cookie', cookie);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_OAUTH_STATE');
      expect(completeOpenAiSignIn).not.toHaveBeenCalled();
    });

    it('never accepts an OAuth transaction token as an application session', async () => {
      securityConfig.passwordHash = await bcrypt.hash('test-password', 4);
      securityConfig.authEnabled = true;
      const transactionToken = jwt.sign(
        {
          type: 'openai-oidc-browser',
          transactionId: 'transaction-id',
          sessionVersion: 0,
        },
        securityConfig.jwtSecret,
        { expiresIn: '10m' }
      );

      const res = await request(app)
        .get('/api/auth/status')
        .set('Cookie', `veritas_session=${transactionToken}`);

      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(false);
    });

    it('issues a Veritas session with the existing linked workspace role', async () => {
      const fixture = createTestSqliteDatabase();
      fixture.database.open();
      const identities = new SqliteIdentityRepository(fixture.database);
      identities.ensureLocalOwner({ displayName: 'Owner', email: 'owner@example.test' });
      process.env.VERITAS_STORAGE = 'sqlite';
      process.env.VERITAS_SQLITE_PATH = fixture.databasePath;
      securityConfig.passwordHash = await bcrypt.hash('test-password', 4);
      securityConfig.authEnabled = true;
      openAiEnabled = true;
      beginOpenAiSignIn.mockResolvedValue({
        authorizationUrl: 'https://auth.openai.com/api/accounts/authorize',
        transaction: {
          state: 'expected-state',
          nonce: 'nonce-value',
          codeVerifier: 'verifier-value',
          redirectUri: 'https://kanban.example.com/api/auth/openai/callback',
        },
      });
      completeOpenAiSignIn.mockResolvedValue({
        issuer: 'https://auth.openai.com',
        clientId: 'oaiapp_test',
        subject: 'acct_owner',
        email: 'owner@example.test',
        emailVerified: true,
        displayName: 'Owner',
        avatarUrl: null,
      });

      try {
        getIdentityService().ensureOwnerSetup();
        const passwordSession = jwt.sign(
          { type: 'session', sessionVersion: 0 },
          securityConfig.jwtSecret,
          { expiresIn: '1h' }
        );
        const start = await request(app)
          .get('/api/auth/openai/link/start')
          .set('Cookie', `veritas_session=${passwordSession}`);
        expect(start.status).toBe(302);
        const transactionCookie = start.headers['set-cookie']?.[0].split(';')[0];
        const callback = await request(app)
          .get('/api/auth/openai/callback?code=authorization-code&state=expected-state')
          .set('Cookie', transactionCookie);

        expect(callback.status).toBe(302);
        expect(callback.headers.location).toBe('/');
        const sessionCookie = callback.headers['set-cookie']?.find((value: string) =>
          value.startsWith('veritas_session=')
        );
        expect(sessionCookie).toContain('HttpOnly');
        const sessionToken = sessionCookie?.split(';')[0].split('=')[1];
        expect(sessionToken).toBeTruthy();
        if (!sessionToken) throw new Error('Session cookie did not include a token');
        expect(jwt.verify(sessionToken, securityConfig.jwtSecret)).toMatchObject({
          type: 'session',
          sessionKind: 'openai-oidc',
          userId: 'local-user',
          workspaceId: 'local',
          role: 'admin',
        });
      } finally {
        resetIdentityServiceForTests();
        fixture.cleanup();
      }
    });
  });

  describe('POST /api/auth/device-pairing/exchange', () => {
    it('redeems a pairing payload and authenticates the returned device secret', async () => {
      const fixture = createTestSqliteDatabase();
      fixture.database.open();
      process.env.VERITAS_SQLITE_PATH = fixture.databasePath;

      try {
        const identityRepository = new SqliteIdentityRepository(fixture.database);
        const sessionRepository = new SqliteDeviceSessionRepository(fixture.database);
        const service = new DeviceSessionService({
          identityRepository,
          sessionRepository,
          audit: vi.fn().mockResolvedValue(undefined),
          activity: { logActivity: vi.fn().mockResolvedValue(undefined) },
        });
        const owner = identityRepository.ensureLocalOwner({ displayName: 'Owner' });
        const pairing = await service.createPairingCode(
          {
            workspaceId: 'local',
            deviceName: 'Route phone',
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
        resetDeviceSessionServiceForTests();

        const exchanged = await request(app)
          .post('/api/auth/device-pairing/exchange')
          .send({ payload: pairing.payload })
          .expect(201);

        expect(exchanged.body.secret).toMatch(/^vk_dev_/);
        expect(exchanged.body.session.tokenHash).toBeUndefined();

        const context = await request(app)
          .get('/api/auth/context')
          .set('Authorization', `Bearer ${exchanged.body.secret}`)
          .expect(200);
        expect(context.body.authMethod).toBe('device-session');
        expect(context.body.actorType).toBe('device');
        expect(context.body.deviceSessionId).toBe(exchanged.body.session.id);
      } finally {
        fixture.cleanup();
      }
    });
  });

  describe('POST /api/auth/setup', () => {
    it('should set up password on first run', async () => {
      const res = await request(app)
        .post('/api/auth/setup')
        .send({ password: 'strongpassword123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.recoveryKey).toBe('RECOVERY-KEY-12345678');
      expect(res.body.message).toContain('Password set');
    });

    it('preserves migrated local identity metadata during password setup', async () => {
      const fixture = createTestSqliteDatabase();
      fixture.database.open();
      const identities = new SqliteIdentityRepository(fixture.database);
      identities.ensureLocalOwner({
        displayName: 'Migrated Owner',
        email: 'owner@example.test',
      });
      process.env.VERITAS_STORAGE = 'sqlite';
      process.env.VERITAS_SQLITE_PATH = fixture.databasePath;

      try {
        const res = await request(app)
          .post('/api/auth/setup')
          .send({ password: 'strongpassword123' });

        expect(res.status).toBe(200);
        expect(identities.getUser('local-user')).toMatchObject({
          displayName: 'Migrated Owner',
          email: 'owner@example.test',
        });
      } finally {
        resetIdentityServiceForTests();
        fixture.cleanup();
      }
    });

    it('should reject setup when password already exists', async () => {
      securityConfig.passwordHash = 'existing-hash';

      const res = await request(app).post('/api/auth/setup').send({ password: 'newpassword123' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('ALREADY_SETUP');
    });

    it('should reject missing password', async () => {
      const res = await request(app).post('/api/auth/setup').send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_PASSWORD');
    });

    it('should reject short password', async () => {
      const res = await request(app).post('/api/auth/setup').send({ password: 'short' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PASSWORD_TOO_SHORT');
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      securityConfig.passwordHash = await bcrypt.hash('correctpassword', 4);
      securityConfig.authEnabled = true;
    });

    it('should login with correct password', async () => {
      const res = await request(app).post('/api/auth/login').send({ password: 'correctpassword' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.expiresAt).toBeDefined();
      // Should set cookie
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('should reject wrong password', async () => {
      const res = await request(app).post('/api/auth/login').send({ password: 'wrongpassword' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_PASSWORD');
    });

    it('should reject missing password', async () => {
      const res = await request(app).post('/api/auth/login').send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_PASSWORD');
    });

    it('should reject login when no password configured', async () => {
      securityConfig.passwordHash = null;

      const res = await request(app).post('/api/auth/login').send({ password: 'anything' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('NOT_SETUP');
    });

    it('should support rememberMe option', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ password: 'correctpassword', rememberMe: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should rate limit after too many failures', async () => {
      app.set('trust proxy', true);
      const forwardedIp = '203.0.113.42';

      // Send 5 wrong passwords
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/login')
          .set('X-Forwarded-For', forwardedIp)
          .send({ password: 'wrong' });
      }

      // 6th should be rate limited
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', forwardedIp)
        .send({ password: 'wrong' });

      expect(res.status).toBe(429);
      expect(res.body.code).toBe('RATE_LIMITED');
      expect(res.body.retryAfter).toBeDefined();
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should clear session cookie', async () => {
      const res = await request(app).post('/api/auth/logout');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Cookie should be cleared
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
    });
  });

  describe('POST /api/auth/recover', () => {
    beforeEach(async () => {
      const recoveryHash = crypto.createHash('sha256').update('VALID-RECOVERY-KEY').digest('hex');
      securityConfig.passwordHash = await bcrypt.hash('oldpassword', 4);
      securityConfig.recoveryKeyHash = recoveryHash;
      securityConfig.authEnabled = true;
    });

    it('should reset password with valid recovery key', async () => {
      const res = await request(app)
        .post('/api/auth/recover')
        .send({ recoveryKey: 'VALID-RECOVERY-KEY', newPassword: 'newstrongpassword' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.recoveryKey).toBeDefined(); // New recovery key
      expect(securityConfig.sessionVersion).toBe(1);
    });

    it('should revoke existing session cookies after recovery reset even when jwt secret is unchanged', async () => {
      process.env.VERITAS_JWT_SECRET = 'env-managed-secret';
      const oldToken = jwt.sign(
        { type: 'session', sessionVersion: securityConfig.sessionVersion },
        securityConfig.jwtSecret,
        { expiresIn: '1h' }
      );
      const originalSecret = securityConfig.jwtSecret;

      await request(app)
        .post('/api/auth/recover')
        .send({ recoveryKey: 'VALID-RECOVERY-KEY', newPassword: 'newstrongpassword' })
        .expect(200);
      expect(securityConfig.jwtSecret).toBe(originalSecret);

      const status = await request(app)
        .get('/api/auth/status')
        .set('Cookie', `veritas_session=${oldToken}`);

      expect(status.status).toBe(200);
      expect(status.body.authenticated).toBe(false);
    });

    it('should reject invalid recovery key', async () => {
      const res = await request(app)
        .post('/api/auth/recover')
        .send({ recoveryKey: 'WRONG-KEY', newPassword: 'newstrongpassword' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_RECOVERY_KEY');
    });

    it('should reject missing recovery key', async () => {
      const res = await request(app)
        .post('/api/auth/recover')
        .send({ newPassword: 'newstrongpassword' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_RECOVERY_KEY');
    });

    it('should reject short new password', async () => {
      const res = await request(app)
        .post('/api/auth/recover')
        .send({ recoveryKey: 'VALID-RECOVERY-KEY', newPassword: 'short' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_NEW_PASSWORD');
    });

    it('should reject when no recovery key configured', async () => {
      securityConfig.recoveryKeyHash = null;

      const res = await request(app)
        .post('/api/auth/recover')
        .send({ recoveryKey: 'SOME-KEY', newPassword: 'newpassword123' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('NO_RECOVERY_KEY');
    });

    it('should use timing-safe comparison for recovery key validation', async () => {
      const spy = vi.spyOn(crypto, 'timingSafeEqual');

      await request(app)
        .post('/api/auth/recover')
        .send({ recoveryKey: 'VALID-RECOVERY-KEY', newPassword: 'newstrongpassword' });

      expect(spy).toHaveBeenCalledTimes(1);
      // Both args should be Buffers of equal length (SHA-256 = 32 bytes)
      const [a, b] = spy.mock.calls[0];
      expect(Buffer.isBuffer(a)).toBe(true);
      expect(Buffer.isBuffer(b)).toBe(true);
      expect(a.length).toBe(32);
      expect(b.length).toBe(32);

      spy.mockRestore();
    });
  });

  describe('POST /api/auth/change-password', () => {
    beforeEach(async () => {
      securityConfig.passwordHash = await bcrypt.hash('currentpassword', 4);
      securityConfig.authEnabled = true;
    });

    it('should change password with correct current password', async () => {
      const res = await request(app)
        .post('/api/auth/change-password')
        .send({ currentPassword: 'currentpassword', newPassword: 'newsecurepassword' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(securityConfig.sessionVersion).toBe(1);
    });

    it('should revoke existing session cookies after password change', async () => {
      const oldToken = jwt.sign(
        { type: 'session', sessionVersion: securityConfig.sessionVersion },
        securityConfig.jwtSecret,
        { expiresIn: '1h' }
      );

      await request(app)
        .post('/api/auth/change-password')
        .send({ currentPassword: 'currentpassword', newPassword: 'newsecurepassword' })
        .expect(200);

      const status = await request(app)
        .get('/api/auth/status')
        .set('Cookie', `veritas_session=${oldToken}`);

      expect(status.status).toBe(200);
      expect(status.body.authenticated).toBe(false);
    });

    it('should reject wrong current password', async () => {
      const res = await request(app)
        .post('/api/auth/change-password')
        .send({ currentPassword: 'wrongpassword', newPassword: 'newsecurepassword' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CURRENT_PASSWORD');
    });

    it('should reject missing current password', async () => {
      const res = await request(app)
        .post('/api/auth/change-password')
        .send({ newPassword: 'newsecurepassword' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_CURRENT_PASSWORD');
    });

    it('should reject short new password', async () => {
      const res = await request(app)
        .post('/api/auth/change-password')
        .send({ currentPassword: 'currentpassword', newPassword: 'short' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_NEW_PASSWORD');
    });

    it('should reject when no password configured', async () => {
      securityConfig.passwordHash = null;

      const res = await request(app)
        .post('/api/auth/change-password')
        .send({ currentPassword: 'old', newPassword: 'newpassword123' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('NOT_SETUP');
    });
  });
});

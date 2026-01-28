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

// Mock security module
vi.mock('../../config/security.js', () => {
  return {
    getSecurityConfig: () => securityConfig,
    saveSecurityConfig: (config: any) => {
      securityConfig = config;
    },
    getJwtSecret: () => securityConfig.jwtSecret || 'test-secret-key-for-jwt-signing-12345678',
    getValidJwtSecrets: () => [securityConfig.jwtSecret || 'test-secret-key-for-jwt-signing-12345678'],
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

// Import auth route after mocking
import authRouter from '../../routes/auth.js';
import { errorHandler } from '../../middleware/error-handler.js';

describe('Auth Routes', () => {
  let app: express.Express;

  beforeEach(async () => {
    // Reset security config for each test
    securityConfig = {
      authEnabled: false,
      passwordHash: null,
      jwtSecret: 'test-secret-key-for-jwt-signing-12345678',
    };

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/auth', authRouter);
    app.use(errorHandler);
  });

  describe('GET /api/auth/status', () => {
    it('should indicate setup is needed when no password set', async () => {
      const res = await request(app).get('/api/auth/status');
      expect(res.status).toBe(200);
      expect(res.body.needsSetup).toBe(true);
      expect(res.body.authenticated).toBe(false);
    });

    it('should indicate setup complete when password exists', async () => {
      securityConfig.passwordHash = await bcrypt.hash('test-password', 4);
      securityConfig.authEnabled = true;

      const res = await request(app).get('/api/auth/status');
      expect(res.status).toBe(200);
      expect(res.body.needsSetup).toBe(false);
    });

    it('should detect valid JWT cookie', async () => {
      securityConfig.passwordHash = await bcrypt.hash('test-password', 4);
      securityConfig.authEnabled = true;

      const token = jwt.sign({ type: 'session' }, securityConfig.jwtSecret, { expiresIn: '1h' });

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

    it('should reject setup when password already exists', async () => {
      securityConfig.passwordHash = 'existing-hash';

      const res = await request(app)
        .post('/api/auth/setup')
        .send({ password: 'newpassword123' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('ALREADY_SETUP');
    });

    it('should reject missing password', async () => {
      const res = await request(app)
        .post('/api/auth/setup')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_PASSWORD');
    });

    it('should reject short password', async () => {
      const res = await request(app)
        .post('/api/auth/setup')
        .send({ password: 'short' });

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
      const res = await request(app)
        .post('/api/auth/login')
        .send({ password: 'correctpassword' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.expiresAt).toBeDefined();
      // Should set cookie
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('should reject wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ password: 'wrongpassword' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_PASSWORD');
    });

    it('should reject missing password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_PASSWORD');
    });

    it('should reject login when no password configured', async () => {
      securityConfig.passwordHash = null;

      const res = await request(app)
        .post('/api/auth/login')
        .send({ password: 'anything' });

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
      // Send 5 wrong passwords
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/login')
          .send({ password: 'wrong' });
      }

      // 6th should be rate limited
      const res = await request(app)
        .post('/api/auth/login')
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

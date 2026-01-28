import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// We need to mock the filesystem and env before importing the module
const mockFs: Record<string, string> = {};

vi.mock('fs', () => ({
  default: {
    existsSync: (path: string) => path in mockFs,
    readFileSync: (path: string) => {
      if (path in mockFs) return mockFs[path];
      throw new Error(`ENOENT: ${path}`);
    },
    writeFileSync: (path: string, data: string) => {
      mockFs[path] = data;
    },
    renameSync: (from: string, to: string) => {
      mockFs[to] = mockFs[from];
      delete mockFs[from];
    },
    mkdirSync: () => {},
  },
}));

// Import after mocks are set up
import {
  getSecurityConfig,
  getJwtSecret,
  getValidJwtSecrets,
  rotateJwtSecret,
  getJwtRotationStatus,
  saveSecurityConfig,
  type SecurityConfig,
  type JwtSecretEntry,
} from '../config/security.js';

describe('JWT Secret Rotation', () => {
  const CONFIG_DIR = process.env.VERITAS_DATA_DIR || `${process.cwd()}/.veritas-kanban`;
  const CONFIG_PATH = `${CONFIG_DIR}/security.json`;

  beforeEach(() => {
    // Clear mock filesystem
    for (const key of Object.keys(mockFs)) {
      delete mockFs[key];
    }
    // Clear env var
    delete process.env.VERITAS_JWT_SECRET;
    // Reset module cache by clearing the config
    // Force cache invalidation by setting a fresh config
  });

  afterEach(() => {
    delete process.env.VERITAS_JWT_SECRET;
  });

  function setConfig(config: SecurityConfig) {
    mockFs[CONFIG_PATH] = JSON.stringify(config);
    // Force cache invalidation
    saveSecurityConfig(config);
  }

  describe('getJwtSecret', () => {
    it('should return env var when set', () => {
      process.env.VERITAS_JWT_SECRET = 'env-secret-123';
      expect(getJwtSecret()).toBe('env-secret-123');
    });

    it('should return latest secret from jwtSecrets array', () => {
      setConfig({
        jwtSecrets: [
          { secret: 'old-secret', version: 1, createdAt: '2026-01-01T00:00:00Z', expiresAt: '2026-02-01T00:00:00Z' },
          { secret: 'current-secret', version: 2, createdAt: '2026-01-15T00:00:00Z' },
        ],
        jwtSecretVersion: 2,
      });
      expect(getJwtSecret()).toBe('current-secret');
    });

    it('should fall back to legacy jwtSecret field', () => {
      setConfig({ jwtSecret: 'legacy-secret' });
      expect(getJwtSecret()).toBe('legacy-secret');
    });
  });

  describe('getValidJwtSecrets', () => {
    it('should return only env var when set', () => {
      process.env.VERITAS_JWT_SECRET = 'env-secret';
      expect(getValidJwtSecrets()).toEqual(['env-secret']);
    });

    it('should return current and non-expired secrets', () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString(); // +1 day
      setConfig({
        jwtSecrets: [
          { secret: 'old-secret', version: 1, createdAt: '2026-01-01T00:00:00Z', expiresAt: futureDate },
          { secret: 'current-secret', version: 2, createdAt: '2026-01-15T00:00:00Z' },
        ],
        jwtSecretVersion: 2,
      });

      const secrets = getValidJwtSecrets();
      expect(secrets).toHaveLength(2);
      expect(secrets[0]).toBe('current-secret'); // Current first
      expect(secrets[1]).toBe('old-secret');
    });

    it('should exclude expired secrets', () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString(); // -1 day
      setConfig({
        jwtSecrets: [
          { secret: 'expired-secret', version: 1, createdAt: '2026-01-01T00:00:00Z', expiresAt: pastDate },
          { secret: 'current-secret', version: 2, createdAt: '2026-01-15T00:00:00Z' },
        ],
        jwtSecretVersion: 2,
      });

      const secrets = getValidJwtSecrets();
      expect(secrets).toHaveLength(1);
      expect(secrets[0]).toBe('current-secret');
    });
  });

  describe('rotateJwtSecret', () => {
    it('should fail when env var is set', () => {
      process.env.VERITAS_JWT_SECRET = 'env-secret';
      const result = rotateJwtSecret();
      expect(result.success).toBe(false);
      expect(result.message).toContain('VERITAS_JWT_SECRET');
    });

    it('should migrate legacy jwtSecret to array on first rotation', () => {
      setConfig({
        jwtSecret: 'legacy-secret',
        authEnabled: true,
        setupCompletedAt: '2026-01-01T00:00:00Z',
      });

      const result = rotateJwtSecret();
      expect(result.success).toBe(true);
      expect(result.newVersion).toBe(2); // legacy=1, new=2

      const config = getSecurityConfig();
      expect(config.jwtSecrets).toHaveLength(2);
      // Legacy secret should have an expiresAt
      const legacyEntry = config.jwtSecrets!.find(s => s.secret === 'legacy-secret');
      expect(legacyEntry).toBeDefined();
      expect(legacyEntry!.expiresAt).toBeDefined();
      // New secret should NOT have expiresAt
      const newEntry = config.jwtSecrets!.find(s => s.version === 2);
      expect(newEntry).toBeDefined();
      expect(newEntry!.expiresAt).toBeUndefined();
    });

    it('should rotate existing array', () => {
      const secret1 = crypto.randomBytes(32).toString('hex');
      setConfig({
        jwtSecrets: [
          { secret: secret1, version: 1, createdAt: '2026-01-01T00:00:00Z' },
        ],
        jwtSecretVersion: 1,
      });

      const result = rotateJwtSecret();
      expect(result.success).toBe(true);
      expect(result.newVersion).toBe(2);

      const config = getSecurityConfig();
      expect(config.jwtSecrets).toHaveLength(2);
      // Old secret should have expiresAt
      const oldEntry = config.jwtSecrets!.find(s => s.version === 1);
      expect(oldEntry!.expiresAt).toBeDefined();
    });

    it('should prune expired secrets during rotation', () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      const secret1 = crypto.randomBytes(32).toString('hex');
      const secret2 = crypto.randomBytes(32).toString('hex');
      setConfig({
        jwtSecrets: [
          { secret: secret1, version: 1, createdAt: '2026-01-01T00:00:00Z', expiresAt: pastDate },
          { secret: secret2, version: 2, createdAt: '2026-01-15T00:00:00Z' },
        ],
        jwtSecretVersion: 2,
      });

      const result = rotateJwtSecret();
      expect(result.success).toBe(true);
      expect(result.prunedCount).toBe(1);
      expect(result.newVersion).toBe(3);

      const config = getSecurityConfig();
      // Should have version 2 (with expiresAt) and version 3 (current)
      expect(config.jwtSecrets).toHaveLength(2);
      expect(config.jwtSecrets!.find(s => s.version === 1)).toBeUndefined();
    });

    it('should support custom grace period (short)', () => {
      const secret1 = crypto.randomBytes(32).toString('hex');
      setConfig({
        jwtSecrets: [
          { secret: secret1, version: 1, createdAt: '2026-01-01T00:00:00Z' },
        ],
        jwtSecretVersion: 1,
      });

      // 1 hour grace period
      const oneHourMs = 60 * 60 * 1000;
      const result = rotateJwtSecret(oneHourMs);
      expect(result.success).toBe(true);

      const config = getSecurityConfig();
      const oldEntry = config.jwtSecrets!.find(s => s.version === 1);
      expect(oldEntry).toBeDefined();
      expect(oldEntry!.expiresAt).toBeDefined();
      // expiresAt should be approximately 1 hour from now
      const expiresAt = new Date(oldEntry!.expiresAt!).getTime();
      const expectedExpiry = Date.now() + oneHourMs;
      expect(Math.abs(expiresAt - expectedExpiry)).toBeLessThan(5000); // within 5 seconds
    });

    it('should immediately prune with 0ms grace period', () => {
      const secret1 = crypto.randomBytes(32).toString('hex');
      setConfig({
        jwtSecrets: [
          { secret: secret1, version: 1, createdAt: '2026-01-01T00:00:00Z' },
        ],
        jwtSecretVersion: 1,
      });

      // 0ms grace period — old secret should be immediately pruned
      const result = rotateJwtSecret(0);
      expect(result.success).toBe(true);
      expect(result.prunedCount).toBe(1);

      const config = getSecurityConfig();
      // Only the new current secret should remain
      expect(config.jwtSecrets).toHaveLength(1);
      expect(config.jwtSecrets![0].version).toBe(2);
    });
  });

  describe('getJwtRotationStatus', () => {
    it('should report env var usage', () => {
      process.env.VERITAS_JWT_SECRET = 'env-secret';
      const status = getJwtRotationStatus();
      expect(status.usingEnvVar).toBe(true);
    });

    it('should report secret versions', () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      setConfig({
        jwtSecrets: [
          { secret: 'old', version: 1, createdAt: '2026-01-01T00:00:00Z', expiresAt: futureDate },
          { secret: 'current', version: 2, createdAt: '2026-01-15T00:00:00Z' },
        ],
        jwtSecretVersion: 2,
      });

      const status = getJwtRotationStatus();
      expect(status.currentVersion).toBe(2);
      expect(status.totalSecrets).toBe(2);
      expect(status.validSecrets).toBe(2);
      expect(status.secrets).toHaveLength(2);
      expect(status.secrets[0].isCurrent).toBe(true);
      expect(status.secrets[0].version).toBe(2);
    });
  });

  describe('Token verification across rotation', () => {
    it('should verify tokens signed with previous secret during grace period', () => {
      // Set up initial secret
      const initialSecret = crypto.randomBytes(32).toString('hex');
      setConfig({
        jwtSecrets: [
          { secret: initialSecret, version: 1, createdAt: '2026-01-01T00:00:00Z' },
        ],
        jwtSecretVersion: 1,
      });

      // Sign a token with the initial secret
      const token = jwt.sign({ type: 'session' }, initialSecret, { expiresIn: '24h' });

      // Rotate the secret
      rotateJwtSecret();

      // The old secret should still be valid (within grace period)
      const secrets = getValidJwtSecrets();
      expect(secrets.length).toBeGreaterThanOrEqual(2);

      // Verify the old token works with the fallback secrets
      let verified = false;
      for (const secret of secrets) {
        try {
          jwt.verify(token, secret);
          verified = true;
          break;
        } catch {
          continue;
        }
      }
      expect(verified).toBe(true);
    });

    it('should sign new tokens with current (latest) secret', () => {
      setConfig({
        jwtSecrets: [
          { secret: 'old-secret', version: 1, createdAt: '2026-01-01T00:00:00Z', expiresAt: new Date(Date.now() + 86400000).toISOString() },
          { secret: 'new-secret', version: 2, createdAt: '2026-01-15T00:00:00Z' },
        ],
        jwtSecretVersion: 2,
      });

      // getJwtSecret should return the current (v2) secret
      const signingSecret = getJwtSecret();
      expect(signingSecret).toBe('new-secret');

      // Token signed with current secret should verify with it
      const token = jwt.sign({ type: 'session' }, signingSecret, { expiresIn: '24h' });
      const decoded = jwt.verify(token, 'new-secret');
      expect(decoded).toBeDefined();
    });
  });
});

/**
 * Environment Validation Tests
 *
 * Tests the Zod-based env validation schema for:
 *   - Required variables (VERITAS_ADMIN_KEY)
 *   - Optional variables with defaults
 *   - Type coercion (PORT string → number)
 *   - Invalid value rejection
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { envSchema } from '../../config/env.js';

describe('envSchema', () => {
  describe('required variables', () => {
    it('should reject when VERITAS_ADMIN_KEY is missing', () => {
      const result = envSchema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('VERITAS_ADMIN_KEY');
      }
    });

    it('should reject when VERITAS_ADMIN_KEY is empty string', () => {
      const result = envSchema.safeParse({ VERITAS_ADMIN_KEY: '' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('VERITAS_ADMIN_KEY');
      }
    });

    it('should accept a valid VERITAS_ADMIN_KEY', () => {
      const result = envSchema.safeParse({
        VERITAS_ADMIN_KEY: 'abc123secret',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('PORT coercion', () => {
    it('should coerce PORT string to number', () => {
      const result = envSchema.safeParse({
        VERITAS_ADMIN_KEY: 'test-key',
        PORT: '8080',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PORT).toBe(8080);
        expect(typeof result.data.PORT).toBe('number');
      }
    });

    it('should default PORT to 3001 when not set', () => {
      const result = envSchema.safeParse({
        VERITAS_ADMIN_KEY: 'test-key',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PORT).toBe(3001);
      }
    });

    it('should reject PORT outside valid range (0)', () => {
      const result = envSchema.safeParse({
        VERITAS_ADMIN_KEY: 'test-key',
        PORT: '0',
      });
      expect(result.success).toBe(false);
    });

    it('should reject PORT outside valid range (99999)', () => {
      const result = envSchema.safeParse({
        VERITAS_ADMIN_KEY: 'test-key',
        PORT: '99999',
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-numeric PORT', () => {
      const result = envSchema.safeParse({
        VERITAS_ADMIN_KEY: 'test-key',
        PORT: 'abc',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('NODE_ENV', () => {
    it('should default to development', () => {
      const result = envSchema.safeParse({
        VERITAS_ADMIN_KEY: 'test-key',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.NODE_ENV).toBe('development');
      }
    });

    it('should accept production', () => {
      const result = envSchema.safeParse({
        VERITAS_ADMIN_KEY: 'test-key',
        NODE_ENV: 'production',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.NODE_ENV).toBe('production');
      }
    });

    it('should accept test', () => {
      const result = envSchema.safeParse({
        VERITAS_ADMIN_KEY: 'test-key',
        NODE_ENV: 'test',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.NODE_ENV).toBe('test');
      }
    });

    it('should reject invalid NODE_ENV', () => {
      const result = envSchema.safeParse({
        VERITAS_ADMIN_KEY: 'test-key',
        NODE_ENV: 'staging',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('LOG_LEVEL', () => {
    it('should default to info', () => {
      const result = envSchema.safeParse({
        VERITAS_ADMIN_KEY: 'test-key',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.LOG_LEVEL).toBe('info');
      }
    });

    it('should accept valid log levels', () => {
      for (const level of ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']) {
        const result = envSchema.safeParse({
          VERITAS_ADMIN_KEY: 'test-key',
          LOG_LEVEL: level,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.LOG_LEVEL).toBe(level);
        }
      }
    });

    it('should reject invalid log level', () => {
      const result = envSchema.safeParse({
        VERITAS_ADMIN_KEY: 'test-key',
        LOG_LEVEL: 'verbose',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('optional variables with defaults', () => {
    it('should set all defaults when only required vars are provided', () => {
      const result = envSchema.safeParse({
        VERITAS_ADMIN_KEY: 'test-key',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PORT).toBe(3001);
        expect(result.data.NODE_ENV).toBe('development');
        expect(result.data.LOG_LEVEL).toBe('info');
        expect(result.data.VERITAS_AUTH_ENABLED).toBe(true);
        expect(result.data.VERITAS_AUTH_LOCALHOST_BYPASS).toBe(false);
        expect(result.data.VERITAS_AUTH_LOCALHOST_ROLE).toBe('read-only');
        expect(result.data.VERITAS_API_KEYS).toBe('');
        expect(result.data.RATE_LIMIT_MAX).toBe(300);
        expect(result.data.CSP_REPORT_ONLY).toBe(false);
        expect(result.data.CLAWDBOT_GATEWAY).toBe('http://127.0.0.1:18789');
      }
    });

    it('should allow VERITAS_JWT_SECRET to be omitted', () => {
      const result = envSchema.safeParse({
        VERITAS_ADMIN_KEY: 'test-key',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.VERITAS_JWT_SECRET).toBeUndefined();
      }
    });

    it('should accept CORS_ORIGINS as a string', () => {
      const result = envSchema.safeParse({
        VERITAS_ADMIN_KEY: 'test-key',
        CORS_ORIGINS: 'http://localhost:3000,http://localhost:5173',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.CORS_ORIGINS).toBe('http://localhost:3000,http://localhost:5173');
      }
    });
  });

  describe('localhost auth role enum', () => {
    it('should accept canonical roles', () => {
      for (const role of ['admin', 'agent', 'read-only']) {
        const result = envSchema.safeParse({
          VERITAS_ADMIN_KEY: 'test-key',
          VERITAS_AUTH_LOCALHOST_ROLE: role,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.VERITAS_AUTH_LOCALHOST_ROLE).toBe(role);
        }
      }
    });

    it('should reject legacy role names', () => {
      for (const role of ['editor', 'viewer']) {
        const result = envSchema.safeParse({
          VERITAS_ADMIN_KEY: 'test-key',
          VERITAS_AUTH_LOCALHOST_ROLE: role,
        });
        expect(result.success).toBe(false);
      }
    });
  });

  describe('boolean string coercion', () => {
    it('should coerce "true" to true', () => {
      const result = envSchema.safeParse({
        VERITAS_ADMIN_KEY: 'test-key',
        VERITAS_AUTH_LOCALHOST_BYPASS: 'true',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.VERITAS_AUTH_LOCALHOST_BYPASS).toBe(true);
      }
    });

    it('should coerce "false" to false', () => {
      const result = envSchema.safeParse({
        VERITAS_ADMIN_KEY: 'test-key',
        VERITAS_AUTH_ENABLED: 'false',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.VERITAS_AUTH_ENABLED).toBe(false);
      }
    });
  });

  describe('RATE_LIMIT_MAX coercion', () => {
    it('should coerce string to number', () => {
      const result = envSchema.safeParse({
        VERITAS_ADMIN_KEY: 'test-key',
        RATE_LIMIT_MAX: '500',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.RATE_LIMIT_MAX).toBe(500);
      }
    });

    it('should default to 300', () => {
      const result = envSchema.safeParse({
        VERITAS_ADMIN_KEY: 'test-key',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.RATE_LIMIT_MAX).toBe(300);
      }
    });
  });

  describe('CLAWDBOT_GATEWAY', () => {
    it('should accept a valid URL', () => {
      const result = envSchema.safeParse({
        VERITAS_ADMIN_KEY: 'test-key',
        CLAWDBOT_GATEWAY: 'http://192.168.1.100:18789',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.CLAWDBOT_GATEWAY).toBe('http://192.168.1.100:18789');
      }
    });

    it('should reject an invalid URL', () => {
      const result = envSchema.safeParse({
        VERITAS_ADMIN_KEY: 'test-key',
        CLAWDBOT_GATEWAY: 'not-a-url',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('multiple errors reported at once', () => {
    it('should report all issues in a single parse result', () => {
      const result = envSchema.safeParse({
        // Missing VERITAS_ADMIN_KEY
        PORT: 'not-a-number',
        NODE_ENV: 'staging',
        LOG_LEVEL: 'verbose',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        // Should have at least 3 issues
        expect(result.error.issues.length).toBeGreaterThanOrEqual(3);
      }
    });
  });
});

describe('validateEnv', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Save and clear process.env
    originalEnv = { ...process.env };
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as any);
  });

  afterEach(() => {
    // Restore process.env
    process.env = originalEnv;
    exitSpy.mockRestore();
    vi.resetModules();
  });

  it('should call process.exit(1) when required vars are missing', async () => {
    // Remove the required key
    delete process.env.VERITAS_ADMIN_KEY;

    // Re-import to get a fresh module
    const { validateEnv } = await import('../../config/env.js');

    // Reset internal state
    expect(() => validateEnv()).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should succeed when all required vars are present', async () => {
    process.env.VERITAS_ADMIN_KEY = 'test-key-for-validation';

    const { validateEnv: validate } = await import('../../config/env.js');
    const result = validate();

    expect(result).toBeDefined();
    expect(result.VERITAS_ADMIN_KEY).toBe('test-key-for-validation');
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

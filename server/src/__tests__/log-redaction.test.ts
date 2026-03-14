/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { redactString, redactObject, redactSerializers, PINO_REDACT_PATHS } from '../lib/redact.js';

// ─── redactString ───────────────────────────────────────────────────────────────

describe('redactString', () => {
  it('redacts Bearer tokens', () => {
    const input = 'Authorization failed: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature';
    const result = redactString(input);
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(result).toContain('[REDACTED');
  });

  it('redacts standalone JWT tokens', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const result = redactString(`Token ${jwt} is invalid`);
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(result).toContain('[REDACTED');
  });

  it('redacts vk_ prefixed API keys', () => {
    const result = redactString('Key vk_abc123defXYZ456789_long is invalid');
    expect(result).not.toContain('vk_abc123defXYZ456789_long');
    expect(result).toContain('[REDACTED_API_KEY]');
  });

  it('redacts sk_ prefixed keys', () => {
    const result = redactString('Secret key sk_live_abcdef12345678');
    expect(result).not.toContain('sk_live_abcdef12345678');
    expect(result).toContain('[REDACTED_API_KEY]');
  });

  it('redacts long hex strings (likely tokens)', () => {
    const hex = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
    const result = redactString(`Secret: ${hex}`);
    expect(result).not.toContain(hex);
    expect(result).toContain('[REDACTED_HEX]');
  });

  it('preserves short strings and requestIds', () => {
    // Short hex IDs (< 32 chars) should NOT be redacted
    const result = redactString('requestId: abc123');
    expect(result).toBe('requestId: abc123');
  });

  it('preserves normal log messages', () => {
    const msg = 'User logged in successfully from 127.0.0.1';
    expect(redactString(msg)).toBe(msg);
  });

  it('handles empty string', () => {
    expect(redactString('')).toBe('');
  });

  it('redacts multiple secrets in one string', () => {
    const input = 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig with key vk_abcdefghijklmnop';
    const result = redactString(input);
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(result).not.toContain('vk_abcdefghijklmnop');
  });
});

// ─── redactObject ───────────────────────────────────────────────────────────────

describe('redactObject', () => {
  it('redacts sensitive keys by name', () => {
    const obj = {
      username: 'admin',
      password: 'super-secret',
      token: 'abc123',
      apiKey: 'vk_xyz',
    };
    const result = redactObject(obj) as Record<string, unknown>;
    expect(result.username).toBe('admin');
    expect(result.password).toBe('[REDACTED]');
    expect(result.token).toBe('[REDACTED]');
    expect(result.apiKey).toBe('[REDACTED]');
  });

  it('redacts nested objects', () => {
    const obj = {
      user: { name: 'Brad', credentials: { password: 'secret123' } },
    };
    const result = redactObject(obj) as any;
    expect(result.user.name).toBe('Brad');
    // 'credentials' is a sensitive key → entire value is redacted
    expect(result.user.credentials).toBe('[REDACTED]');
  });

  it('redacts password inside nested non-sensitive keys', () => {
    const obj = {
      user: { name: 'Brad', config: { password: 'secret123', role: 'admin' } },
    };
    const result = redactObject(obj) as any;
    expect(result.user.name).toBe('Brad');
    expect(result.user.config.password).toBe('[REDACTED]');
    expect(result.user.config.role).toBe('admin');
  });

  it('redacts secrets in string values via pattern matching', () => {
    const obj = {
      error: 'Failed auth with Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
    };
    const result = redactObject(obj) as any;
    expect(result.error).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(result.error).toContain('[REDACTED');
  });

  it('handles arrays', () => {
    const arr = ['Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig', 'safe string'];
    const result = redactObject(arr) as string[];
    expect(result[0]).toContain('[REDACTED');
    expect(result[1]).toBe('safe string');
  });

  it('handles null/undefined gracefully', () => {
    expect(redactObject(null)).toBeNull();
    expect(redactObject(undefined)).toBeUndefined();
  });

  it('respects depth limit', () => {
    // Build a deeply nested object
    let obj: any = { value: 'deep' };
    for (let i = 0; i < 15; i++) {
      obj = { nested: obj };
    }
    const result = redactObject(obj) as any;
    // Should not throw, should truncate at depth
    expect(result).toBeDefined();
  });

  it('preserves non-sensitive fields and types', () => {
    const obj = { count: 42, active: true, name: 'test' };
    const result = redactObject(obj) as any;
    expect(result.count).toBe(42);
    expect(result.active).toBe(true);
    expect(result.name).toBe('test');
  });

  it('redacts authorization header case-insensitively by key name', () => {
    const obj = { Authorization: 'Bearer xyz123456789abcdef' };
    const result = redactObject(obj) as any;
    expect(result.Authorization).toBe('[REDACTED]');
  });
});

// ─── redactSerializers ──────────────────────────────────────────────────────────

describe('redactSerializers', () => {
  describe('err serializer', () => {
    it('redacts secrets in error message', () => {
      const errObj = {
        type: 'Error',
        message: 'Invalid token: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
        stack: 'Error: ...',
      };
      const result = redactSerializers.err(errObj) as any;
      expect(result.message).not.toContain('eyJhbGciOiJIUzI1NiJ9');
      expect(result.type).toBe('Error');
    });

    it('redacts secrets in stack trace', () => {
      const errObj = {
        type: 'Error',
        message: 'Auth failed',
        stack: 'Error: token vk_secret_key_1234567890\n    at auth.ts:42',
      };
      const result = redactSerializers.err(errObj) as any;
      expect(result.stack).not.toContain('vk_secret_key_1234567890');
    });

    it('passes through null/non-objects', () => {
      expect(redactSerializers.err(null)).toBeNull();
      expect(redactSerializers.err('string')).toBe('string');
    });
  });

  describe('req serializer', () => {
    it('redacts auth headers', () => {
      const reqObj = {
        method: 'GET',
        url: '/api/tasks',
        headers: {
          authorization: 'Bearer secret-token',
          'x-api-key': 'vk_my_key',
          cookie: 'session=abc123',
          host: 'localhost:3001',
        },
      };
      const result = redactSerializers.req(reqObj) as any;
      expect(result.headers.authorization).toBe('[REDACTED]');
      expect(result.headers['x-api-key']).toBe('[REDACTED]');
      expect(result.headers.cookie).toBe('[REDACTED]');
      expect(result.headers.host).toBe('localhost:3001');
      expect(result.method).toBe('GET');
    });

    it('handles missing headers gracefully', () => {
      const reqObj = { method: 'GET', url: '/api/tasks' };
      const result = redactSerializers.req(reqObj) as any;
      expect(result.method).toBe('GET');
    });
  });
});

// ─── PINO_REDACT_PATHS ─────────────────────────────────────────────────────────

describe('PINO_REDACT_PATHS', () => {
  it('includes authorization header path', () => {
    expect(PINO_REDACT_PATHS).toContain('req.headers.authorization');
  });

  it('includes api-key header path', () => {
    expect(PINO_REDACT_PATHS).toContain('req.headers["x-api-key"]');
  });

  it('includes cookie paths', () => {
    expect(PINO_REDACT_PATHS).toContain('req.headers.cookie');
    expect(PINO_REDACT_PATHS).toContain('res.headers["set-cookie"]');
  });
});

// ─── Integration: requestId preservation ────────────────────────────────────────

describe('requestId preservation', () => {
  it('preserves requestId through redactObject', () => {
    const logEntry = {
      requestId: 'req-abc-123',
      err: { message: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig failed' },
      method: 'POST',
      path: '/api/auth',
    };
    const result = redactObject(logEntry) as any;
    expect(result.requestId).toBe('req-abc-123');
    expect(result.method).toBe('POST');
    expect(result.path).toBe('/api/auth');
    // The nested error message should be redacted
    expect(result.err.message).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('preserves UUID-style requestIds', () => {
    const uuid = 'ccf7cedf-ef5a-4fb3-baa8-5959f8d79c91';
    const result = redactObject({ requestId: uuid }) as any;
    // UUIDs with dashes should survive — they don't match the 32+ contiguous hex pattern
    expect(result.requestId).toBe(uuid);
  });
});

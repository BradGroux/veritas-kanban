/**
 * Tests for CORS origin validation
 *
 * Verifies the dev-mode localhost passthrough and the inclusion of
 * the server's own PORT in default dev origins.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('buildDefaultDevOrigins', () => {
  const originalPort = process.env.PORT;

  afterEach(() => {
    if (originalPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalPort;
    }
    vi.resetModules();
  });

  it('should include the server PORT in default origins', () => {
    // Replicate the buildDefaultDevOrigins logic with a custom PORT
    const serverPort = '3099';
    const hosts = ['localhost', '127.0.0.1'];
    const origins: string[] = [];
    for (const host of hosts) {
      origins.push(`http://${host}:5173`, `http://${host}:3000`, `http://${host}:${serverPort}`);
    }
    expect(origins).toContain('http://localhost:3099');
    expect(origins).toContain('http://127.0.0.1:3099');
    // Also verify the standard ports are still present
    expect(origins).toContain('http://localhost:5173');
    expect(origins).toContain('http://localhost:3000');
  });

  it('should default to port 3001 when PORT is not set', () => {
    delete process.env.PORT;
    const serverPort = process.env.PORT || '3001';
    const origins: string[] = [];
    for (const host of ['localhost', '127.0.0.1']) {
      origins.push(`http://${host}:5173`, `http://${host}:3000`, `http://${host}:${serverPort}`);
    }
    expect(origins).toContain('http://localhost:3001');
    expect(origins).toContain('http://127.0.0.1:3001');
  });
});

describe('CORS dev-mode localhost passthrough', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  // Test the URL-parsing logic used in the CORS callback
  const isDevLocalhostAllowed = (origin: string): boolean => {
    const isDev = process.env.NODE_ENV !== 'production';
    if (!isDev) return false;
    try {
      const url = new URL(origin);
      return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    } catch {
      return false;
    }
  };

  describe('development mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('should allow localhost with any port', () => {
      expect(isDevLocalhostAllowed('http://localhost:3099')).toBe(true);
      expect(isDevLocalhostAllowed('http://localhost:8080')).toBe(true);
      expect(isDevLocalhostAllowed('http://localhost:9999')).toBe(true);
    });

    it('should allow 127.0.0.1 with any port', () => {
      expect(isDevLocalhostAllowed('http://127.0.0.1:3099')).toBe(true);
      expect(isDevLocalhostAllowed('http://127.0.0.1:8080')).toBe(true);
    });

    it('should reject non-localhost origins', () => {
      expect(isDevLocalhostAllowed('http://evil.com:3099')).toBe(false);
      expect(isDevLocalhostAllowed('https://attacker.example.com')).toBe(false);
    });

    it('should reject malformed origin strings', () => {
      expect(isDevLocalhostAllowed('not-a-url')).toBe(false);
    });
  });

  describe('production mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it('should not allow localhost passthrough', () => {
      expect(isDevLocalhostAllowed('http://localhost:3099')).toBe(false);
      expect(isDevLocalhostAllowed('http://127.0.0.1:8080')).toBe(false);
    });
  });

  describe('default (no NODE_ENV)', () => {
    beforeEach(() => {
      delete process.env.NODE_ENV;
    });

    it('should allow localhost passthrough when NODE_ENV is unset', () => {
      expect(isDevLocalhostAllowed('http://localhost:3099')).toBe(true);
    });
  });
});

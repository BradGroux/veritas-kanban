/**
 * Tests for WebSocket Origin validation (CSWSH protection)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateWebSocketOrigin } from '../middleware/auth.js';

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
];

describe('validateWebSocketOrigin', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('no origin header (non-browser clients)', () => {
    it('should allow undefined origin', () => {
      const result = validateWebSocketOrigin(undefined, ALLOWED_ORIGINS);
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('non-browser');
    });
  });

  describe('allowed origins', () => {
    it('should allow origin in the allowed list', () => {
      const result = validateWebSocketOrigin('http://localhost:5173', ALLOWED_ORIGINS);
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('allowed list');
    });

    it('should allow 127.0.0.1 variant in the allowed list', () => {
      const result = validateWebSocketOrigin('http://127.0.0.1:5173', ALLOWED_ORIGINS);
      expect(result.allowed).toBe(true);
    });

    it('should reject origin not in the allowed list', () => {
      process.env.NODE_ENV = 'production';
      const result = validateWebSocketOrigin('http://evil.com', ALLOWED_ORIGINS);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not allowed');
    });
  });

  describe('development mode localhost passthrough', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('should allow any localhost port in dev mode', () => {
      const result = validateWebSocketOrigin('http://localhost:9999', ALLOWED_ORIGINS);
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('dev mode');
    });

    it('should allow 127.0.0.1 with any port in dev mode', () => {
      const result = validateWebSocketOrigin('http://127.0.0.1:8080', ALLOWED_ORIGINS);
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('dev mode');
    });

    it('should still reject non-localhost origins in dev mode', () => {
      const result = validateWebSocketOrigin('http://evil.com', ALLOWED_ORIGINS);
      expect(result.allowed).toBe(false);
    });
  });

  describe('production mode strictness', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it('should reject localhost origin not in allowed list', () => {
      const result = validateWebSocketOrigin('http://localhost:9999', ALLOWED_ORIGINS);
      expect(result.allowed).toBe(false);
    });

    it('should reject external origins', () => {
      const result = validateWebSocketOrigin('https://attacker.example.com', ALLOWED_ORIGINS);
      expect(result.allowed).toBe(false);
    });

    it('should allow explicitly listed origins', () => {
      const result = validateWebSocketOrigin('http://localhost:5173', ALLOWED_ORIGINS);
      expect(result.allowed).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should reject malformed origin strings', () => {
      process.env.NODE_ENV = 'production';
      const result = validateWebSocketOrigin('not-a-url', ALLOWED_ORIGINS);
      expect(result.allowed).toBe(false);
    });

    it('should work with empty allowed list (non-browser still passes)', () => {
      const result = validateWebSocketOrigin(undefined, []);
      expect(result.allowed).toBe(true);
    });

    it('should reject everything except no-origin with empty allowed list in production', () => {
      process.env.NODE_ENV = 'production';
      const result = validateWebSocketOrigin('http://localhost:5173', []);
      expect(result.allowed).toBe(false);
    });

    it('should handle custom CORS_ORIGINS', () => {
      const customOrigins = ['https://kanban.example.com', 'https://app.example.com'];
      expect(validateWebSocketOrigin('https://kanban.example.com', customOrigins).allowed).toBe(true);
      expect(validateWebSocketOrigin('https://other.example.com', customOrigins).allowed).toBe(false);
    });
  });
});

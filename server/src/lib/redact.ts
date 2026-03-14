/**
 * Log redaction utilities.
 *
 * Prevents secrets, tokens, and API keys from leaking into
 * server logs (pino JSON, console, error-handler output).
 *
 * Works at two levels:
 *   1. **Pino serializer hook** — redacts structured fields before they
 *      reach the transport (see `redactSerializers` export).
 *   2. **String-level redactor** — catches secrets embedded in free-text
 *      error messages or stack traces.
 *
 * @see SECURITY_AUDIT — prevent secret/token leakage in error logs
 */

// ─── Pattern Definitions ────────────────────────────────────────────────────────

/**
 * Patterns that match sensitive strings in free-text log messages.
 * Each entry: [regex, replacement label].
 *
 * Order matters — more specific patterns should come first.
 */
const REDACTION_PATTERNS: [RegExp, string][] = [
  // Bearer tokens in Authorization-style strings
  [/Bearer\s+[A-Za-z0-9\-_.]{8,}/gi, 'Bearer [REDACTED]'],

  // JWT-shaped tokens (three base64url segments separated by dots)
  [/eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g, '[REDACTED_JWT]'],

  // API keys with common prefixes (vk_, sk_, pk_, api_, key_)
  [/\b(vk|sk|pk|api|key)_[A-Za-z0-9\-_]{8,}\b/gi, '[REDACTED_API_KEY]'],

  // Generic hex secrets (32+ hex chars — likely tokens/hashes, but skip short ones)
  [/\b[0-9a-f]{32,}\b/gi, '[REDACTED_HEX]'],

  // Base64url tokens (40+ chars — catches long opaque tokens)
  [/\b[A-Za-z0-9\-_]{40,}={0,2}\b/g, '[REDACTED_TOKEN]'],
];

/**
 * Pino structured-field paths that should be fully redacted.
 * These are passed to pino's built-in `redact` option.
 */
export const PINO_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

// ─── String Redactor ────────────────────────────────────────────────────────────

/**
 * Redact sensitive tokens/secrets from an arbitrary string.
 *
 *   redactString('Bearer eyJhbG...xyz failed auth')
 *   // → 'Bearer [REDACTED] failed auth'
 */
export function redactString(input: string): string {
  let result = input;
  for (const [pattern, replacement] of REDACTION_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ─── Object Redactor ────────────────────────────────────────────────────────────

/** Keys whose *values* are always fully redacted in structured log objects. */
const SENSITIVE_KEYS = new Set([
  'authorization',
  'x-api-key',
  'cookie',
  'set-cookie',
  'password',
  'passwordhash',
  'secret',
  'jwtsecret',
  'apikey',
  'api_key',
  'adminkey',
  'token',
  'accesstoken',
  'refreshtoken',
  'access_token',
  'refresh_token',
  'credentials',
]);

/**
 * Deep-clone a plain object while redacting sensitive keys and
 * running string-level redaction on all string values.
 *
 * Used by pino serializers for the `err` object (which pino
 * serializes via its own `errSerializer` before our hook runs).
 */
export function redactObject(obj: unknown, depth = 0): unknown {
  if (depth > 8) return '[depth limit]';

  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') return redactString(obj);

  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      result[key] = redactString(value);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactObject(value, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ─── Pino Serializers ───────────────────────────────────────────────────────────

/**
 * Custom pino serializers that redact secrets from structured fields.
 * Pass to pino({ serializers: redactSerializers }).
 */
export const redactSerializers = {
  /**
   * Error serializer — redacts secrets from error message and stack.
   * Pino's default errSerializer produces { type, message, stack, ... }.
   * We post-process that output.
   */
  err(raw: unknown): unknown {
    if (!raw || typeof raw !== 'object') return raw;
    const obj = raw as Record<string, unknown>;
    const result: Record<string, unknown> = { ...obj };

    if (typeof result.message === 'string') {
      result.message = redactString(result.message);
    }
    if (typeof result.stack === 'string') {
      result.stack = redactString(result.stack);
    }

    return result;
  },

  /**
   * Request serializer — strip auth headers.
   */
  req(raw: unknown): unknown {
    if (!raw || typeof raw !== 'object') return raw;
    const obj = raw as Record<string, unknown>;
    const result: Record<string, unknown> = { ...obj };

    if (result.headers && typeof result.headers === 'object') {
      const headers = { ...(result.headers as Record<string, unknown>) };
      if ('authorization' in headers) headers.authorization = '[REDACTED]';
      if ('x-api-key' in headers) headers['x-api-key'] = '[REDACTED]';
      if ('cookie' in headers) headers.cookie = '[REDACTED]';
      result.headers = headers;
    }

    return result;
  },
};

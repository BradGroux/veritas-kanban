/** Metadata safe to forward to command-line and tool clients. Full task snapshots are omitted. */
const SAFE_DETAIL_FIELDS = new Set([
  'code',
  'message',
  'path',
  'expectedRevision',
  'currentRevision',
  'retryAfter',
  'retryAfterMs',
  'retryAfterSeconds',
  'requiredPermission',
  'requiredPermissions',
  'limit',
]);

export function safeApiText(value: string, secrets: string[] = []): string {
  let text = value;
  for (const secret of secrets) if (secret) text = text.replaceAll(secret, '[redacted]');
  return text
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:password|token|api[_-]?key|secret)\s*[:=]\s*[^\s,;]+/gi, '[redacted]')
    .slice(0, 2048);
}

export function safeApiDetails(value: unknown, secrets: string[] = [], depth = 0): unknown {
  if (depth > 3) return undefined;
  if (typeof value === 'string') return safeApiText(value, secrets);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value))
    return value.slice(0, 20).map((item) => safeApiDetails(item, secrets, depth + 1));
  if (typeof value !== 'object') return undefined;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => SAFE_DETAIL_FIELDS.has(key))
      .map(([key, item]) => [key, safeApiDetails(item, secrets, depth + 1)])
  );
}

export class ApiError extends Error {
  readonly status?: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    message: string,
    metadata: { status?: number; code?: string; details?: unknown } = {}
  ) {
    const code = metadata.code ?? 'API_ERROR';
    super(`${metadata.status ? `HTTP ${metadata.status} ` : ''}[${code}] ${message}`);
    this.name = 'ApiError';
    this.status = metadata.status;
    this.code = code;
    this.details = metadata.details;
  }

  toJSON() {
    return { message: this.message, status: this.status, code: this.code, details: this.details };
  }
}

export function formatApiError(error: unknown, json = false): string {
  if (json)
    return JSON.stringify({
      error:
        error instanceof ApiError
          ? error.toJSON()
          : { message: error instanceof Error ? error.message : String(error) },
    });
  return error instanceof Error ? error.message : String(error);
}

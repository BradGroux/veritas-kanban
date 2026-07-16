const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]'],
  [/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}/gi, '[REDACTED]'],
  [/\b(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*([^\s"'`,}]+)/gi, '$1=[REDACTED]'],
];

export function sanitizeProviderRuntimeDiagnostic(value: string): string {
  let sanitized = normalizeProviderRuntimeDiagnostic(value);
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized.slice(0, 1000);
}

export function containsUnredactedProviderRuntimeSecret(value: string): boolean {
  const normalized = normalizeProviderRuntimeDiagnostic(value).slice(0, 1000);
  return sanitizeProviderRuntimeDiagnostic(value) !== normalized;
}

function normalizeProviderRuntimeDiagnostic(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

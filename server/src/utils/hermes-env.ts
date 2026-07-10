/**
 * Hermes Agent environment passthrough utilities.
 *
 * Hermes Agent v2026.7.7.2 is spawned as a subprocess. Only the keys listed in
 * HERMES_ENV_ALLOWLIST are forwarded to the child process unless an explicit
 * passthrough list is provided by the sandbox policy.
 *
 * Sensitive keys (secrets, tokens, private keys) are never forwarded even if
 * they appear in the sandbox passthrough list. The same redaction pattern used
 * by Codex applies here.
 */

const HERMES_ENV_ALLOWLIST = new Set([
  'ANTHROPIC_API_KEY',
  'CI',
  'FORCE_COLOR',
  'HERMES_API_KEY',
  'HERMES_CONFIG_DIR',
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOGNAME',
  'NODE_EXTRA_CA_CERTS',
  'NO_COLOR',
  'PATH',
  'SHELL',
  'SSL_CERT_FILE',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'USER',
  'VK_API_URL',
]);

const HERMES_AUTH_ENV_KEYS = new Set(['ANTHROPIC_API_KEY', 'HERMES_API_KEY']);

const SECRET_ENV_KEY_PATTERN =
  /(?:SECRET|TOKEN|PASSWORD|PASS|CREDENTIAL|COOKIE|SESSION|WEBHOOK|DATABASE|DB_URL|PRIVATE|SERVICE_ROLE|ADMIN_KEY|API_KEYS?|GITHUB|GH_|SUPABASE|STRIPE|AWS_|AZURE_|GCP_|GOOGLE_)/i;

export function isSensitiveHermesEnvKey(key: string): boolean {
  if (HERMES_AUTH_ENV_KEYS.has(key)) return false;
  return SECRET_ENV_KEY_PATTERN.test(key);
}

export function buildSafeHermesEnv(
  source: NodeJS.ProcessEnv = process.env,
  passthroughKeys?: Iterable<string>
): Record<string, string> {
  const env: Record<string, string> = {};
  const allowlist = new Set(HERMES_ENV_ALLOWLIST);
  if (passthroughKeys) {
    for (const key of passthroughKeys) {
      allowlist.add(key.toUpperCase());
    }
  }

  for (const key of allowlist) {
    const value = source[key];
    if (typeof value === 'string' && !isSensitiveHermesEnvKey(key)) {
      env[key] = value;
    }
  }

  env.VK_API_URL = source.VK_API_URL || 'http://localhost:3001';
  return env;
}

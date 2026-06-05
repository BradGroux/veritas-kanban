const CODEX_ENV_ALLOWLIST = new Set([
  'CI',
  'CODEX_API_KEY',
  'CODEX_HOME',
  'FORCE_COLOR',
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOGNAME',
  'NODE_EXTRA_CA_CERTS',
  'NO_COLOR',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_ORG_ID',
  'OPENAI_ORGANIZATION',
  'OPENAI_PROJECT',
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

const CODEX_AUTH_ENV_KEYS = new Set(['CODEX_API_KEY', 'OPENAI_API_KEY']);
const SECRET_ENV_KEY_PATTERN =
  /(?:SECRET|TOKEN|PASSWORD|PASS|CREDENTIAL|COOKIE|SESSION|WEBHOOK|DATABASE|DB_URL|PRIVATE|SERVICE_ROLE|ADMIN_KEY|API_KEYS?|GITHUB|GH_|SUPABASE|STRIPE|AWS_|AZURE_|GCP_|GOOGLE_)/i;

export function isSensitiveCodexEnvKey(key: string): boolean {
  if (CODEX_AUTH_ENV_KEYS.has(key)) return false;
  return SECRET_ENV_KEY_PATTERN.test(key);
}

export function buildSafeCodexEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of CODEX_ENV_ALLOWLIST) {
    const value = source[key];
    if (typeof value === 'string' && !isSensitiveCodexEnvKey(key)) {
      env[key] = value;
    }
  }

  env.VK_API_URL = source.VK_API_URL || 'http://localhost:3001';
  return env;
}

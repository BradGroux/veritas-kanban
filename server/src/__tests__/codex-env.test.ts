import { describe, expect, it } from 'vitest';

import { buildSafeCodexEnv, isSensitiveCodexEnvKey } from '../utils/codex-env.js';

describe('Codex environment filtering', () => {
  it('keeps Codex auth and operational variables while dropping ambient secrets', () => {
    const env = buildSafeCodexEnv({
      CODEX_API_KEY: 'test-codex-key',
      OPENAI_API_KEY: 'test-openai-key',
      VK_API_URL: 'http://127.0.0.1:3001',
      PATH: '/usr/bin',
      GITHUB_TOKEN: 'test-github-token',
      DATABASE_URL: 'postgres://test-secret',
      VERITAS_ADMIN_KEY: 'test-admin-key',
    });

    expect(env).toEqual({
      CODEX_API_KEY: 'test-codex-key',
      OPENAI_API_KEY: 'test-openai-key',
      PATH: '/usr/bin',
      VK_API_URL: 'http://127.0.0.1:3001',
    });
  });

  it('defaults VK_API_URL without forwarding disallowed variables', () => {
    expect(buildSafeCodexEnv({ RANDOM_VALUE: 'ignored' })).toEqual({
      VK_API_URL: 'http://localhost:3001',
    });
  });

  it('does not classify the required Codex auth keys as sensitive', () => {
    expect(isSensitiveCodexEnvKey('OPENAI_API_KEY')).toBe(false);
    expect(isSensitiveCodexEnvKey('CODEX_API_KEY')).toBe(false);
    expect(isSensitiveCodexEnvKey('GITHUB_TOKEN')).toBe(true);
    expect(isSensitiveCodexEnvKey('SUPABASE_SERVICE_ROLE_KEY')).toBe(true);
  });
});

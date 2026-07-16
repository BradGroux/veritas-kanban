/**
 * Contract and regression tests for the Hermes CLI provider adapter.
 *
 * Tested against Hermes Agent v2026.7.7.2 scripted interface.
 * Live credential-gated tests are skipped in CI; they are guarded by
 * HERMES_SMOKE_TEST=true and the presence of HERMES_API_KEY / ANTHROPIC_API_KEY.
 *
 * @smoke describe blocks require a real Hermes binary and credential.
 */

import { describe, it, expect } from 'vitest';
import { buildSafeHermesEnv, isSensitiveHermesEnvKey } from '../utils/hermes-env.js';
import { AgentHealthService } from '../services/agent-health-service.js';
import { getProviderRuntimeAdapterDefinition } from '../services/provider-runtime-adapter-registry.js';
import type { AgentConfig } from '@veritas-kanban/shared';

// ── buildSafeHermesEnv ────────────────────────────────────────────────────────

describe('buildSafeHermesEnv', () => {
  it('forwards core allowlist keys when present', () => {
    const env = buildSafeHermesEnv({
      HOME: '/home/user',
      PATH: '/usr/bin:/bin',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      HERMES_API_KEY: 'hk-test',
      RANDOM_VALUE: 'ignored',
    });
    expect(env.HOME).toBe('/home/user');
    expect(env.PATH).toBe('/usr/bin:/bin');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test');
    expect(env.HERMES_API_KEY).toBe('hk-test');
    expect(env.RANDOM_VALUE).toBeUndefined();
  });

  it('always injects VK_API_URL', () => {
    const env = buildSafeHermesEnv({});
    expect(env.VK_API_URL).toBe('http://localhost:3001');
  });

  it('uses VK_API_URL from source when present', () => {
    const env = buildSafeHermesEnv({ VK_API_URL: 'http://veritas.internal:3001' });
    expect(env.VK_API_URL).toBe('http://veritas.internal:3001');
  });

  it('forwards explicit passthrough keys', () => {
    const env = buildSafeHermesEnv({ HERMES_CONFIG_DIR: '/opt/hermes', EXTRA: 'extra' }, [
      'HERMES_CONFIG_DIR',
      'EXTRA',
    ]);
    expect(env.HERMES_CONFIG_DIR).toBe('/opt/hermes');
    expect(env.EXTRA).toBe('extra');
  });

  it('never forwards sensitive keys even from passthrough list', () => {
    const env = buildSafeHermesEnv({ MY_GITHUB_TOKEN: 'ghp_secret', HOME: '/home/user' }, [
      'MY_GITHUB_TOKEN',
      'HOME',
    ]);
    expect(env.MY_GITHUB_TOKEN).toBeUndefined();
    expect(env.HOME).toBe('/home/user');
  });

  it('preserves the base allowlist when sandbox passthrough keys are provided', () => {
    const env = buildSafeHermesEnv(
      {
        ANTHROPIC_API_KEY: 'sk-ant-test',
        HERMES_API_KEY: 'hk-test',
        PATH: '/usr/bin:/bin',
        EXTRA: 'extra',
      },
      ['EXTRA']
    );
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test');
    expect(env.HERMES_API_KEY).toBe('hk-test');
    expect(env.PATH).toBe('/usr/bin:/bin');
    expect(env.EXTRA).toBe('extra');
  });
});

describe('isSensitiveHermesEnvKey', () => {
  it('returns false for auth keys', () => {
    expect(isSensitiveHermesEnvKey('ANTHROPIC_API_KEY')).toBe(false);
    expect(isSensitiveHermesEnvKey('HERMES_API_KEY')).toBe(false);
  });

  it('returns true for secret-pattern keys', () => {
    expect(isSensitiveHermesEnvKey('GITHUB_TOKEN')).toBe(true);
    expect(isSensitiveHermesEnvKey('DATABASE_URL')).toBe(true);
    expect(isSensitiveHermesEnvKey('MY_SECRET')).toBe(true);
    expect(isSensitiveHermesEnvKey('STRIPE_KEY')).toBe(true);
  });

  it('returns false for benign keys', () => {
    expect(isSensitiveHermesEnvKey('HOME')).toBe(false);
    expect(isSensitiveHermesEnvKey('PATH')).toBe(false);
    expect(isSensitiveHermesEnvKey('LANG')).toBe(false);
  });
});

// ── AgentHealthService — hermes-cli provider ──────────────────────────────────

describe('AgentHealthService hermes-cli auth probe', () => {
  const healthService = new AgentHealthService();

  const baseConfig: AgentConfig = {
    type: 'hermes',
    name: 'Hermes',
    command: 'hermes',
    args: [],
    enabled: true,
    provider: 'hermes-cli',
  };

  it('returns healthy: false when hermes binary is not on PATH', async () => {
    const config = { ...baseConfig, command: '/nonexistent/hermes' };
    const result = await healthService.checkAgent(config);
    expect(result.executableFound).toBe(false);
    expect(result.healthy).toBe(false);
    expect(result.reason).toMatch(/not found/i);
  });

  it('reports healthy: false and reason for disabled agent', async () => {
    const config = { ...baseConfig, enabled: false, command: '/nonexistent/hermes' };
    const result = await healthService.checkAgent(config);
    expect(result.healthy).toBe(false);
    expect(result.reason).toMatch(/disabled/i);
  });

  it('checkAgent returns correct type and name fields', async () => {
    const config = { ...baseConfig, command: '/nonexistent/hermes' };
    const result = await healthService.checkAgent(config);
    expect(result.type).toBe('hermes');
    expect(result.name).toBe('Hermes');
    expect(result.command).toBe('/nonexistent/hermes');
    expect(result.configured).toBe(true);
  });
});

describe('Hermes provider runtime sandbox capabilities', () => {
  it('reports the same evidence-backed local capability set as codex-cli', () => {
    const supported = (provider: 'hermes-cli' | 'codex-cli') =>
      getProviderRuntimeAdapterDefinition(provider)
        .capabilities.filter((capability) => capability.state === 'supported')
        .map((capability) => capability.id);
    expect(supported('hermes-cli')).toContain('environment.allowlist');
    const hermes = getProviderRuntimeAdapterDefinition('hermes-cli').capabilities;
    expect(hermes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'filesystem.read', state: 'advisory' }),
        expect.objectContaining({ id: 'filesystem.write', state: 'advisory' }),
      ])
    );
    expect(supported('codex-cli')).toEqual(
      expect.arrayContaining(['filesystem.read', 'filesystem.write', 'environment.allowlist'])
    );
  });
});

// ── @smoke — credential-gated live tests ─────────────────────────────────────

describe.skipIf(!process.env.HERMES_SMOKE_TEST)('@smoke Hermes v2026.7.7.2 live one-shot', () => {
  it('hermes -z returns non-empty output and exits 0', async () => {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    const { stdout, stderr } = await execFileAsync(
      'hermes',
      ['-z', 'Reply with exactly: HERMES_SMOKE_OK'],
      { timeout: 60_000 }
    );
    const output = `${stdout}${stderr}`.trim();
    expect(output.length).toBeGreaterThan(0);
    // Basic sanity: exit 0 is enforced by execFileAsync not throwing
  });

  it('hermes --version outputs version string', async () => {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    const { stdout, stderr } = await execFileAsync('hermes', ['--version'], { timeout: 5_000 });
    expect(`${stdout}${stderr}`).toMatch(/\d{4}\.\d+\.\d+/);
  });
});

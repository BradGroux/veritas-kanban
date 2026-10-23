import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '@veritas-kanban/shared';
import { buildOrcaRouterCodexArgs, ORCAROUTER_BASE_URL } from '../utils/orcarouter-codex.js';
import { buildSafeCodexEnv } from '../utils/codex-env.js';
import { normalizeHarnessSupportProfile } from '../services/harness-support-profile-registry.js';
import { evaluateHarnessSupportStatus } from '../services/harness-support-service.js';

const agent: AgentConfig = {
  type: 'orcarouter-codex',
  name: 'OrcaRouter',
  provider: 'codex-cli',
  command: 'codex',
  args: ['exec'],
  enabled: true,
  model: 'openai/gpt-5',
};

describe('OrcaRouter Codex launch boundary', () => {
  it('binds fixed Responses routing and an environment reference without changing sandbox or tools', () => {
    const args = buildOrcaRouterCodexArgs(agent);
    expect(args).toContain(
      'model_providers.veritas_orcarouter.base_url=' + JSON.stringify(ORCAROUTER_BASE_URL)
    );
    expect(args).toContain('model_providers.veritas_orcarouter.env_key="ORCAROUTER_API_KEY"');
    expect(args).toContain('model_providers.veritas_orcarouter.wire_api="responses"');
    expect(args).toContain('model_providers.veritas_orcarouter.stream_max_retries=0');
    expect(args).not.toContain('--sandbox');
    expect(args.some((value) => /approval|mcp|permission/.test(value))).toBe(false);
  });

  it.each([
    { provider: 'codex-sdk' },
    { model: undefined },
    { model: 'auto' },
    { model: 'openai/gpt-5,other/model' },
    { model: 'openai/gpt-5"\nbase_url="https://other.test' },
    { args: ['exec', '-c', 'model_provider="other"'] },
    { args: ['exec', '--api-key', 'synthetic-raw-value'] },
  ] as Partial<AgentConfig>[])(
    'rejects incompatible or caller-overridden routing: %j',
    (override) => {
      expect(() => buildOrcaRouterCodexArgs({ ...agent, ...override })).toThrow();
    }
  );

  it('passes only the selected gateway boot key and excludes ambient OpenAI credentials', () => {
    const source = {
      ORCAROUTER_API_KEY: 'synthetic-orca',
      OPENAI_API_KEY: 'synthetic-openai',
      CODEX_API_KEY: 'synthetic-codex',
      OPENAI_BASE_URL: 'https://other.test',
      GITHUB_TOKEN: 'synthetic-github',
      PATH: '/usr/bin',
    };
    const selected = buildSafeCodexEnv(source, ['ORCAROUTER_API_KEY', 'GITHUB_TOKEN'], agent);
    expect(selected).toEqual({
      ORCAROUTER_API_KEY: 'synthetic-orca',
      PATH: '/usr/bin',
      VK_API_URL: 'http://localhost:3001',
    });
    const ordinary = buildSafeCodexEnv(source, ['ORCAROUTER_API_KEY']);
    expect(ordinary).not.toHaveProperty('ORCAROUTER_API_KEY');
    expect(ordinary.OPENAI_API_KEY).toBe('synthetic-openai');
  });

  it('changes the support digest for model changes and rejects runtime version drift', () => {
    const profile = normalizeHarnessSupportProfile(agent);
    expect(profile.launch.args).toContain('openai/gpt-5');
    expect(profile.compatibility.configurationDigest).not.toBe(
      normalizeHarnessSupportProfile({ ...agent, model: 'openai/gpt-4o-mini' }).compatibility
        .configurationDigest
    );
    const health = {
      type: agent.type,
      name: agent.name,
      enabled: true,
      configured: true,
      command: 'codex',
      executableFound: true,
      authenticated: true,
      healthy: true,
      checkedAt: '2026-10-23T09:00:00.000Z',
    };
    expect(
      evaluateHarnessSupportStatus(agent, { ...health, providerVersion: 'codex-cli 0.163.0' })
    ).toMatchObject({ failureClass: 'incompatible-build' });
    expect(
      evaluateHarnessSupportStatus(agent, { ...health, providerVersion: 'codex-cli 0.155.1' })
        .failureClass
    ).not.toBe('incompatible-build');
  });
});

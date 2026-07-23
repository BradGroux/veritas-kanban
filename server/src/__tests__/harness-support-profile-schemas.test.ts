import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '@veritas-kanban/shared';
import { HarnessSupportProfileSchema } from '../schemas/harness-support-profile-schemas.js';
import { normalizeHarnessSupportProfile } from '../services/harness-support-profile-registry.js';

describe('HarnessSupportProfileSchema', () => {
  it('rejects a configured harness profile without an executable adapter', () => {
    const agent: AgentConfig = {
      type: 'codex',
      name: 'OpenAI Codex',
      command: 'codex',
      args: [],
      enabled: true,
      provider: 'codex-cli',
    };
    const profile = normalizeHarnessSupportProfile(agent);
    const { adapterId: _adapterId, ...withoutAdapter } = profile;

    expect(() => HarnessSupportProfileSchema.parse(withoutAdapter)).toThrow(/executable adapter/i);
  });

  it('rejects an unknown executable adapter', () => {
    const profile = normalizeHarnessSupportProfile({
      type: 'codex',
      name: 'OpenAI Codex',
      command: 'codex',
      args: [],
      enabled: true,
      provider: 'codex-cli',
    });

    expect(() =>
      HarnessSupportProfileSchema.parse({
        ...profile,
        adapterId: 'implicit-openclaw-fallback',
      })
    ).toThrow();
  });

  it('redacts credential-bearing launch arguments without encoding values in the digest', () => {
    const base: AgentConfig = {
      type: 'custom-secure-runner',
      name: 'Secure Runner',
      command: 'runner',
      args: [
        '--api-key',
        'first-sensitive-value',
        '--token=inline-sensitive-value',
        '--credentials=credential-sensitive-value',
      ],
      enabled: true,
      provider: 'codex-cli',
    };
    const first = normalizeHarnessSupportProfile(base);
    const rotated = normalizeHarnessSupportProfile({
      ...base,
      args: [
        '--api-key',
        'rotated-sensitive-value',
        '--token=inline-sensitive-value',
        '--credentials=rotated-credential-sensitive-value',
      ],
    });

    expect(first.launch.args).toEqual([
      '--api-key',
      '[REDACTED]',
      '--token=[REDACTED]',
      '--credentials=[REDACTED]',
    ]);
    expect(JSON.stringify(first)).not.toContain('first-sensitive-value');
    expect(JSON.stringify(first)).not.toContain('inline-sensitive-value');
    expect(JSON.stringify(first)).not.toContain('credential-sensitive-value');
    expect(first.compatibility.configurationDigest).toBe(rotated.compatibility.configurationDigest);
    expect(first).toMatchObject({
      supportTier: 'degraded',
      supportReason: expect.stringMatching(/credential material/i),
    });
    expect(() => HarnessSupportProfileSchema.parse(first)).not.toThrow();
  });

  it('redacts and degrades a command containing a credential argument', () => {
    const profile = normalizeHarnessSupportProfile({
      type: 'custom-secure-runner',
      name: 'Secure Runner',
      command:
        'runner token=inline-command-sensitive-value --authorization command-sensitive-value',
      args: [],
      enabled: true,
      provider: 'codex-cli',
    });

    expect(profile).toMatchObject({
      supportTier: 'degraded',
      executable: {
        command: 'runner token=[REDACTED] --authorization [REDACTED]',
      },
    });
    expect(JSON.stringify(profile)).not.toContain('inline-command-sensitive-value');
    expect(JSON.stringify(profile)).not.toContain('command-sensitive-value');
  });

  it('rejects unredacted credential material anywhere in public profile evidence', () => {
    const profile = normalizeHarnessSupportProfile({
      type: 'codex',
      name: 'OpenAI Codex',
      command: 'codex',
      args: [],
      enabled: true,
      provider: 'codex-cli',
    });

    expect(() =>
      HarnessSupportProfileSchema.parse({
        ...profile,
        conformance: {
          ...profile.conformance,
          providerBuild: 'build token=unredacted-sensitive-value',
        },
      })
    ).toThrow(/credentials|secrets/i);
  });
});

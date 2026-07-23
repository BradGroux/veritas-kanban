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
});

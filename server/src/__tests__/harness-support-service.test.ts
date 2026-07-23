import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '@veritas-kanban/shared';
import { normalizeHarnessSupportProfile } from '../services/harness-support-profile-registry.js';
import { evaluateHarnessSupportStatus } from '../services/harness-support-service.js';
import { providerRuntimeManifestFixture } from './fixtures/provider-runtime-manifest.js';

function agent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  const base: AgentConfig = {
    type: 'claude-code',
    name: 'Claude Code',
    command: 'claude',
    args: [],
    enabled: true,
  };
  const candidate = { ...base, ...overrides };
  return {
    ...candidate,
    supportProfile: normalizeHarnessSupportProfile(candidate),
  };
}

describe('evaluateHarnessSupportStatus', () => {
  it('classifies a display-only profile as unsupported even when its executable is installed', () => {
    const candidate = agent();

    expect(
      evaluateHarnessSupportStatus(candidate, {
        type: candidate.type,
        name: candidate.name,
        enabled: true,
        configured: true,
        command: candidate.command,
        executableFound: true,
        authenticated: true,
        healthy: true,
        checkedAt: '2026-07-23T16:00:00.000Z',
      })
    ).toMatchObject({
      profileId: 'claude-code',
      supportTier: 'unsupported',
      failureClass: 'adapter-unavailable',
      executableFound: true,
    });
  });

  it.each([
    {
      name: 'installed but disabled',
      enabled: false,
      executableFound: true,
      authenticated: true,
      healthy: false,
      expectedTier: 'detected',
      expectedFailure: 'disabled',
    },
    {
      name: 'missing executable',
      enabled: true,
      executableFound: false,
      authenticated: null,
      healthy: false,
      expectedTier: 'degraded',
      expectedFailure: 'not-installed',
    },
    {
      name: 'failed authentication',
      enabled: true,
      executableFound: true,
      authenticated: false,
      healthy: false,
      expectedTier: 'degraded',
      expectedFailure: 'unauthenticated',
    },
    {
      name: 'configured without current certification',
      enabled: true,
      executableFound: true,
      authenticated: true,
      healthy: true,
      expectedTier: 'configured',
      expectedFailure: 'none',
    },
  ] as const)(
    'classifies an executable adapter as $expectedTier when $name',
    ({ enabled, executableFound, authenticated, healthy, expectedTier, expectedFailure }) => {
      const candidate = agent({
        type: 'codex',
        name: 'OpenAI Codex',
        command: 'codex',
        provider: 'codex-cli',
        enabled,
      });

      expect(
        evaluateHarnessSupportStatus(candidate, {
          type: candidate.type,
          name: candidate.name,
          enabled,
          configured: true,
          command: candidate.command,
          executableFound,
          authenticated,
          healthy,
          checkedAt: '2026-07-23T16:00:00.000Z',
        })
      ).toMatchObject({
        supportTier: expectedTier,
        failureClass: expectedFailure,
      });
    }
  );

  it('certifies only the exact runtime manifest recorded by passing conformance evidence', () => {
    const manifest = providerRuntimeManifestFixture({
      provider: 'codex-cli',
      providerVersion: 'codex-cli 1.0.0',
      providerBuild: 'build-a',
    });
    const candidate = agent({
      type: 'codex',
      name: 'OpenAI Codex',
      command: 'codex',
      provider: 'codex-cli',
    });
    if (!candidate.supportProfile) {
      throw new Error('Expected a normalized Codex support profile');
    }
    candidate.supportProfile = {
      ...candidate.supportProfile,
      conformance: {
        fixtureSet: 'openai-codex-cli/v1',
        status: 'passed',
        certifiedAt: '2026-07-23T16:00:00.000Z',
        providerVersion: manifest.providerVersion,
        providerBuild: manifest.providerBuild,
        manifestDigest: manifest.digest,
        configurationDigest: candidate.supportProfile.compatibility.configurationDigest,
        probeRevision: manifest.probeRevision,
      },
    };
    const health = {
      type: candidate.type,
      name: candidate.name,
      enabled: true,
      configured: true,
      command: candidate.command,
      executableFound: true,
      providerVersion: manifest.providerVersion,
      authenticated: true,
      healthy: true,
      checkedAt: '2026-07-23T16:00:00.000Z',
    };

    expect(evaluateHarnessSupportStatus(candidate, health, manifest)).toMatchObject({
      supportTier: 'certified',
      failureClass: 'none',
      manifestDigest: manifest.digest,
      diagnosticCommands: ['codex --version', 'codex login status'],
    });

    expect(
      evaluateHarnessSupportStatus(candidate, health, {
        ...manifest,
        providerVersion: 'codex-cli 2.0.0',
      })
    ).toMatchObject({
      supportTier: 'degraded',
      failureClass: 'certification-stale',
    });

    expect(
      evaluateHarnessSupportStatus(candidate, health, {
        ...manifest,
        providerBuild: 'build-b',
      })
    ).toMatchObject({
      supportTier: 'degraded',
      failureClass: 'certification-stale',
    });

    expect(
      evaluateHarnessSupportStatus(candidate, health, {
        ...manifest,
        probeRevision: manifest.probeRevision + 1,
      })
    ).toMatchObject({
      supportTier: 'degraded',
      failureClass: 'certification-stale',
    });

    candidate.supportProfile.compatibility.configurationDigest = `sha256:${'f'.repeat(64)}`;
    expect(evaluateHarnessSupportStatus(candidate, health, manifest)).toMatchObject({
      supportTier: 'degraded',
      failureClass: 'certification-stale',
    });
  });

  it('degrades an installed provider version outside the tested compatibility policy', () => {
    const manifest = providerRuntimeManifestFixture({
      provider: 'codex-cli',
      providerVersion: 'codex-cli 2.0.0',
    });
    const candidate = agent({
      type: 'codex',
      name: 'OpenAI Codex',
      command: 'codex',
      provider: 'codex-cli',
    });
    if (!candidate.supportProfile) {
      throw new Error('Expected a normalized Codex support profile');
    }
    candidate.supportProfile.compatibility.testedVersions = ['codex-cli 1.0.0'];

    expect(
      evaluateHarnessSupportStatus(
        candidate,
        {
          type: candidate.type,
          name: candidate.name,
          enabled: true,
          configured: true,
          command: candidate.command,
          executableFound: true,
          providerVersion: manifest.providerVersion,
          authenticated: true,
          healthy: true,
          checkedAt: '2026-07-23T16:00:00.000Z',
        },
        manifest
      )
    ).toMatchObject({
      supportTier: 'degraded',
      failureClass: 'incompatible-build',
    });
  });

  it('uses the probed runtime manifest as the canonical provider version', () => {
    const manifest = providerRuntimeManifestFixture({
      provider: 'codex-cli',
      providerVersion: 'codex-cli 2.0.0',
    });
    const candidate = agent({
      type: 'codex',
      name: 'OpenAI Codex',
      command: 'codex',
      provider: 'codex-cli',
    });

    expect(
      evaluateHarnessSupportStatus(
        candidate,
        {
          type: candidate.type,
          name: candidate.name,
          enabled: true,
          configured: true,
          command: candidate.command,
          executableFound: true,
          providerVersion: 'stale health version',
          authenticated: true,
          healthy: true,
          checkedAt: '2026-07-23T16:00:00.000Z',
        },
        manifest
      )
    ).toMatchObject({
      providerVersion: 'codex-cli 2.0.0',
    });
  });

  it('degrades and redacts a failed runtime probe', () => {
    const candidate = agent({
      type: 'codex',
      name: 'OpenAI Codex',
      command: 'codex',
      provider: 'codex-cli',
    });
    if (!candidate.supportProfile) {
      throw new Error('Expected a normalized Codex support profile');
    }
    candidate.supportProfile.authentication = {
      kind: 'command',
      commandArgs: ['login', 'status', '--token=diagnostic-secret'],
      nonMutating: true,
    };
    const health = {
      type: candidate.type,
      name: candidate.name,
      enabled: true,
      configured: true,
      command: candidate.command,
      executableFound: true,
      authenticated: true,
      healthy: true,
      checkedAt: '2026-07-23T16:00:00.000Z',
    };

    const status = evaluateHarnessSupportStatus(
      candidate,
      health,
      undefined,
      'linux',
      'probe failed token=super-secret-value'
    );

    expect(status).toMatchObject({
      supportTier: 'degraded',
      failureClass: 'probe-failed',
    });
    expect(status.reason).toContain('token=[REDACTED]');
    expect(status.reason).not.toContain('super-secret-value');
    expect(status.diagnosticCommands).toContain('codex login status --token=[REDACTED]');
    expect(JSON.stringify(status)).not.toContain('diagnostic-secret');
  });

  it('degrades unsafe launch configuration before evaluating runtime readiness', () => {
    const candidate = agent({
      type: 'custom-secure-runner',
      name: 'Secure Runner',
      command: 'codex',
      args: ['--api-key', 'status-sensitive-value'],
      provider: 'codex-cli',
    });

    const status = evaluateHarnessSupportStatus(candidate, {
      type: candidate.type,
      name: candidate.name,
      enabled: true,
      configured: true,
      command: candidate.command,
      executableFound: true,
      authenticated: true,
      healthy: true,
      checkedAt: '2026-07-23T16:00:00.000Z',
    });

    expect(status).toMatchObject({
      profileId: 'openai-codex-cli',
      supportTier: 'degraded',
      failureClass: 'unsafe-configuration',
      reason: expect.stringMatching(/credential material/i),
    });
    expect(JSON.stringify(status)).not.toContain('status-sensitive-value');
  });
});

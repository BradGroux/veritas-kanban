import { describe, expect, it } from 'vitest';
import type { HarnessSupportStatus } from '@veritas-kanban/shared';
import {
  getHarnessCompatibilityRecordDigest,
  HarnessCompatibilityMatrixService,
} from '../services/harness-compatibility-matrix-service.js';

const NOW = new Date('2026-07-24T12:00:00.000Z');

describe('HarnessCompatibilityMatrixService', () => {
  it('publishes the five reviewed harnesses from one versioned contract', () => {
    const matrix = new HarnessCompatibilityMatrixService(() => NOW).build();

    expect(matrix).toMatchObject({
      schemaVersion: 'harness-compatibility-matrix/v1',
      generatedAt: NOW.toISOString(),
      probeRevision: 14,
    });
    expect(matrix.records.map((record) => record.agentType)).toEqual([
      'buzz-agent',
      'grok-build',
      'codex-app-server',
      'claude-code',
      'copilot',
    ]);
    expect(matrix.records.map((record) => record.testedVersions[0])).toEqual([
      'buzz-agent 0.1.0',
      'Grok Build 0.2.111',
      'codex-cli 0.145.0',
      '2.1.218 (Claude Code)',
      'Copilot 1.0.74',
    ]);
    expect(matrix.records.find((record) => record.agentType === 'grok-build')).toMatchObject({
      sourceAvailability: 'partial-source',
      protocolVersion: 'acp/v1',
      testedBuilds: ['94172f2aa4e5'],
    });
  });

  it('keeps deterministic evidence and all drift keys in the stable record digest', () => {
    const service = new HarnessCompatibilityMatrixService(() => NOW);
    const first = service.build();
    const second = service.build();

    expect(first.digest).toBe(second.digest);
    for (const record of first.records) {
      expect(record.certification).toMatchObject({
        fixtureRevision: 1,
        credentialSmokePolicy: 'supplemental-only',
        status: 'not-run',
      });
      expect(record.certification.deterministicEvidence.length).toBeGreaterThan(0);
      expect(record.certification.invalidatedBy).toEqual(
        expect.arrayContaining([
          'provider-version',
          'provider-build',
          'probe-revision',
          'protocol-version',
          'capability-digest',
          'fixture-revision',
        ])
      );
      expect(getHarnessCompatibilityRecordDigest(record.profileId)).toBe(
        record.certification.capabilityDigest
      );
    }
  });

  it('projects live support without letting it rewrite deterministic certification identity', () => {
    const status: HarnessSupportStatus = {
      agentType: 'copilot',
      enabled: true,
      profileId: 'github-copilot-cli',
      adapterId: 'acp-stdio',
      transport: 'acp',
      supportTier: 'degraded',
      reason: 'The certified provider evidence no longer matches the installed runtime.',
      failureClass: 'certification-stale',
      checkedAt: NOW.toISOString(),
      executableFound: true,
      authenticated: null,
      certification: {
        fixtureSet: 'github-copilot-cli/v1',
        status: 'stale',
      },
      diagnosticCommands: ['copilot --version'],
      remediation: ['Install the tested release.'],
    };

    const withoutLiveStatus = new HarnessCompatibilityMatrixService(() => NOW).build();
    const withLiveStatus = new HarnessCompatibilityMatrixService(() => NOW).build([status]);
    const record = withLiveStatus.records.find((candidate) => candidate.agentType === 'copilot');

    expect(record?.certification.capabilityDigest).toBe(
      withoutLiveStatus.records.find((candidate) => candidate.agentType === 'copilot')
        ?.certification.capabilityDigest
    );
    expect(record).toMatchObject({
      certification: { status: 'stale' },
      supportStatus: status,
    });
    expect(withLiveStatus.supportStatuses).toEqual([status]);
  });
});

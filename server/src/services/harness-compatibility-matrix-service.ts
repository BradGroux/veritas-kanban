import { createHash } from 'node:crypto';
import type {
  AgentConfig,
  ExecutableAgentProvider,
  HarnessCompatibilityGuide,
  HarnessCompatibilityMatrix,
  HarnessCompatibilityRecord,
  HarnessCompatibilityEvidence,
  HarnessSourceAvailability,
  HarnessSupportStatus,
  HarnessSupportTier,
} from '@veritas-kanban/shared';
import {
  HARNESS_COMPATIBILITY_MATRIX_SCHEMA_VERSION,
  PROVIDER_RUNTIME_PROBE_REVISION,
} from '@veritas-kanban/shared';
import {
  BUZZ_AGENT_TESTED_COMMIT,
  BUZZ_AGENT_TESTED_RELEASE,
  COPILOT_ACP_TESTED_COMMIT,
  COPILOT_ACP_TESTED_RELEASE,
  GROK_BUILD_TESTED_BUILD,
  GROK_BUILD_TESTED_RELEASE,
} from './acp-stdio-adapter.js';
import { normalizeHarnessSupportProfile } from './harness-support-profile-registry.js';
import { getProviderRuntimeAdapterDefinition } from './provider-runtime-adapter-registry.js';

const REVIEWED_AT = '2026-07-24';
const FIXTURE_REVISION = 1;
const INVALIDATION_KEYS = [
  'provider-version',
  'provider-build',
  'configuration-digest',
  'probe-revision',
  'protocol-version',
  'capability-digest',
  'fixture-revision',
] as const;
const TESTED_BUILDS: Record<string, string[]> = {
  'buzz-agent': [BUZZ_AGENT_TESTED_COMMIT],
  'grok-build': [GROK_BUILD_TESTED_BUILD],
  'codex-app-server': ['25af12f7e61572b0bc18ddb1008be543b91519b0'],
  'claude-code': ['2982f951552e94f38cd972764ae94c1d90c41da3'],
  copilot: [COPILOT_ACP_TESTED_COMMIT],
};

export const HARNESS_SUPPORT_TIER_DEFINITIONS: Record<HarnessSupportTier, string> = {
  certified:
    'The installed build, configuration, runtime manifest, probe revision, and deterministic fixtures match passing evidence.',
  configured:
    'The executable adapter is ready to dispatch, but current deterministic certification evidence is absent.',
  detected: 'The executable is installed, but this profile is disabled.',
  degraded:
    'The profile is enabled or detected, but a readiness, compatibility, policy, or certification check failed.',
  unsupported:
    'The platform or configured provider has no safe executable adapter for this profile.',
};

interface ReviewedHarness {
  agent: AgentConfig;
  sourceAvailability: HarnessSourceAvailability;
  evidence: HarnessCompatibilityEvidence[];
  limitations: string[];
  guide: Omit<HarnessCompatibilityGuide, 'documentationUrl'>;
}

const REVIEWED_HARNESSES: ReviewedHarness[] = [
  reviewedHarness(
    {
      type: 'buzz-agent',
      name: 'Buzz Agent',
      command: 'buzz-agent',
      args: [],
      enabled: false,
      provider: 'acp-stdio',
    },
    'open-source',
    [
      source(
        'Buzz source',
        `https://github.com/block/buzz/tree/${BUZZ_AGENT_TESTED_COMMIT}`,
        BUZZ_AGENT_TESTED_COMMIT
      ),
      release('Buzz release', 'https://github.com/block/buzz/releases', BUZZ_AGENT_TESTED_RELEASE),
      fixture('ACP adapter contract', 'server/src/__tests__/acp-stdio-provider.test.ts'),
      fixture(
        'Buzz compatibility contract',
        'server/src/__tests__/buzz-compatibility-integration.test.ts'
      ),
      fixture(
        'Buzz communication and replay contract',
        'server/src/__tests__/buzz-communication-adapter-service.test.ts'
      ),
      fixture(
        'Run-scoped MCP bridge contract',
        'server/src/__tests__/run-tool-bridge-runtime.test.ts'
      ),
      fixture(
        'Buzz persona and team import contract',
        'server/src/__tests__/buzz-definition-import-service.test.ts'
      ),
      fixture(
        'Buzz workflow trigger contract',
        'server/src/__tests__/buzz-workflow-trigger-service.test.ts'
      ),
    ],
    [
      'Veritas launches buzz-agent as an ACP server; buzz-acp is the inverse relay-side client.',
      'Relay, identity, community, and workflow compatibility are reported separately from task execution.',
      'Credential-gated live smoke is supplemental; the credential-free composed gate is the release authority.',
    ]
  ),
  reviewedHarness(
    {
      type: 'grok-build',
      name: 'Grok Build',
      command: 'grok',
      args: [],
      enabled: false,
      provider: 'acp-stdio',
    },
    'partial-source',
    [
      source('Grok Build source', 'https://github.com/xai-org/grok-build'),
      release(
        'Tested Grok Build binary',
        'https://github.com/xai-org/grok-build/releases',
        `${GROK_BUILD_TESTED_RELEASE} build ${GROK_BUILD_TESTED_BUILD}`
      ),
      fixture('ACP adapter contract', 'server/src/__tests__/acp-stdio-provider.test.ts'),
    ],
    [
      'The public source tree and released binary do not provide a complete one-to-one provenance chain.',
      'The tested stable artifact self-reports an alpha channel.',
    ]
  ),
  reviewedHarness(
    {
      type: 'codex-app-server',
      name: 'OpenAI Codex app-server',
      command: 'codex',
      args: [],
      enabled: false,
      provider: 'codex-app-server',
    },
    'open-source',
    [
      source(
        'Codex app-server source',
        'https://github.com/openai/codex/tree/25af12f7e61572b0bc18ddb1008be543b91519b0',
        '25af12f7e61572b0bc18ddb1008be543b91519b0'
      ),
      fixture(
        'Codex app-server contract',
        'server/src/__tests__/codex-app-server-provider.test.ts'
      ),
    ],
    [
      'Experimental app-server methods are excluded until their generated schemas and behavior are pinned.',
    ]
  ),
  reviewedHarness(
    {
      type: 'claude-code',
      name: 'Claude Code',
      command: 'claude',
      args: [],
      enabled: false,
      provider: 'claude-code',
    },
    'partial-source',
    [
      source(
        'Claude Code public repository',
        'https://github.com/anthropics/claude-code/tree/2982f951552e94f38cd972764ae94c1d90c41da3',
        '2982f951552e94f38cd972764ae94c1d90c41da3'
      ),
      fixture('Claude Code contract', 'server/src/__tests__/claude-code-provider.test.ts'),
    ],
    [
      'The complete Claude Code CLI implementation is not available in the public repository.',
      'Filesystem and network enforcement remain partly provider-dependent.',
    ]
  ),
  reviewedHarness(
    {
      type: 'copilot',
      name: 'GitHub Copilot CLI',
      command: 'copilot',
      args: [],
      enabled: false,
      provider: 'acp-stdio',
    },
    'partial-source',
    [
      source(
        'Copilot CLI public repository',
        `https://github.com/github/copilot-cli/tree/${COPILOT_ACP_TESTED_COMMIT}`,
        COPILOT_ACP_TESTED_COMMIT
      ),
      release(
        'Copilot CLI release',
        'https://github.com/github/copilot-cli/releases',
        COPILOT_ACP_TESTED_RELEASE
      ),
      fixture('ACP adapter contract', 'server/src/__tests__/acp-stdio-provider.test.ts'),
    ],
    [
      'ACP support is public preview and can change without a stable protocol guarantee.',
      'The complete Copilot CLI implementation is not public.',
      'Authentication is provider-managed and has no non-consuming status probe.',
    ]
  ),
];

export class HarnessCompatibilityMatrixService {
  constructor(private readonly now: () => Date = () => new Date()) {}

  build(supportStatuses: HarnessSupportStatus[] = []): HarnessCompatibilityMatrix {
    const records = REVIEWED_HARNESSES.map((reviewed) =>
      buildRecord(
        reviewed,
        supportStatuses.find((status) => status.agentType === reviewed.agent.type)
      )
    );
    return {
      schemaVersion: HARNESS_COMPATIBILITY_MATRIX_SCHEMA_VERSION,
      generatedAt: this.now().toISOString(),
      probeRevision: PROVIDER_RUNTIME_PROBE_REVISION,
      digest: digest(records.map(withoutLiveStatus)),
      tierDefinitions: { ...HARNESS_SUPPORT_TIER_DEFINITIONS },
      records,
      supportStatuses: structuredClone(supportStatuses),
    };
  }
}

export function getHarnessCompatibilityRecordDigest(profileId: string): string | undefined {
  const reviewed = REVIEWED_HARNESSES.find(
    (candidate) => normalizeHarnessSupportProfile(candidate.agent).id === profileId
  );
  return reviewed ? buildRecord(reviewed).certification.capabilityDigest : undefined;
}

function buildRecord(
  reviewed: ReviewedHarness,
  supportStatus?: HarnessSupportStatus
): HarnessCompatibilityRecord {
  const profile = normalizeHarnessSupportProfile(reviewed.agent);
  if (!profile.adapterId) {
    throw new Error(`Reviewed harness ${profile.id} has no executable adapter.`);
  }
  const adapter = getProviderRuntimeAdapterDefinition(profile.adapterId as ExecutableAgentProvider);
  const capabilityDigest = digest({
    profileId: profile.id,
    adapterId: profile.adapterId,
    protocolVersion: adapter.protocolVersion,
    probeRevision: PROVIDER_RUNTIME_PROBE_REVISION,
    capabilities: adapter.capabilities,
  });
  const certificationStatus =
    supportStatus?.certification?.status ??
    (supportStatus?.supportTier === 'certified'
      ? 'passed'
      : supportStatus?.failureClass === 'certification-stale'
        ? 'stale'
        : 'not-run');
  return {
    agentType: reviewed.agent.type,
    profileId: profile.id,
    displayName: profile.displayName,
    adapterId: profile.adapterId,
    transport: profile.transport,
    protocolVersion: adapter.protocolVersion,
    platforms: [...profile.platforms],
    testedVersions: [...profile.compatibility.testedVersions],
    testedBuilds: [...(TESTED_BUILDS[reviewed.agent.type] ?? [])],
    reviewedAt: REVIEWED_AT,
    sourceAvailability: reviewed.sourceAvailability,
    evidence: structuredClone(reviewed.evidence),
    capabilities: structuredClone(adapter.capabilities),
    certification: {
      fixtureSet: profile.conformance.fixtureSet,
      fixtureRevision: FIXTURE_REVISION,
      capabilityDigest,
      status: certificationStatus,
      invalidatedBy: [...INVALIDATION_KEYS],
      deterministicEvidence: reviewed.evidence.filter((entry) => entry.kind === 'fixture'),
      credentialSmokePolicy: 'supplemental-only',
    },
    limitations: [...reviewed.limitations],
    guide: {
      documentationUrl: profile.documentationUrl,
      ...reviewed.guide,
    },
    ...(supportStatus ? { supportStatus: structuredClone(supportStatus) } : {}),
  };
}

function reviewedHarness(
  agent: AgentConfig,
  sourceAvailability: HarnessSourceAvailability,
  evidence: HarnessCompatibilityEvidence[],
  limitations: string[]
): ReviewedHarness {
  const label = agent.name;
  return {
    agent,
    sourceAvailability,
    evidence,
    limitations,
    guide: {
      installation: `Install the exact tested ${label} build before enabling the profile.`,
      authentication: `Use ${label}'s provider-managed login or an allowlisted boot credential.`,
      configuration: 'Configure the built-in profile; Veritas owns transport and launch arguments.',
      permissions:
        'Apply a Veritas sandbox policy and approval policy; unsafe launch flags fail closed.',
      mcp: 'Veritas exposes only the immutable task catalog and system-owned run bridge.',
      worktree: 'Each task launches in its assigned Git worktree.',
      upgrade: 'Re-run probes and deterministic fixtures after any version or build change.',
      degradedState:
        'Degraded profiles cannot dispatch until the reported evidence mismatch is fixed.',
      troubleshooting: 'Run `vk doctor --json` and follow the redacted remediation commands.',
    },
  };
}

function source(label: string, url: string, revision?: string): HarnessCompatibilityEvidence {
  return { kind: 'source', label, url, ...(revision ? { revision } : {}) };
}

function release(label: string, url: string, revision: string): HarnessCompatibilityEvidence {
  return { kind: 'release', label, url, revision };
}

function fixture(label: string, path: string): HarnessCompatibilityEvidence {
  return { kind: 'fixture', label, path, revision: String(FIXTURE_REVISION) };
}

function withoutLiveStatus(
  record: HarnessCompatibilityRecord
): Omit<HarnessCompatibilityRecord, 'supportStatus'> {
  const { supportStatus: _supportStatus, ...staticRecord } = record;
  return staticRecord;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

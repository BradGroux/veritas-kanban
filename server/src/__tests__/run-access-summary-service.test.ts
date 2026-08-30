import { describe, expect, it, vi } from 'vitest';
import {
  PHASE_AUTHORITY_DIMENSIONS,
  type AdmissionReservation,
  type CredentialDefinition,
  type CredentialLease,
  type PhaseAuthorityDimension,
  type PhaseAuthoritySource,
  type PhaseCapabilityEvidence,
  type PhaseTransitionRecord,
  type RunLaunchManifest,
  type RunPhaseAuthoritySnapshot,
  type RunToolCatalog,
  type Task,
} from '@veritas-kanban/shared';
import { RunAccessSummaryService } from '../services/run-access-summary-service.js';
import {
  compilePhaseCapabilityAuthority,
  getBuiltInPhaseCapabilityProfile,
} from '../services/phase-capability-service.js';
import { calculateRunLaunchManifestDigest } from '../utils/run-launch-manifest-digest.js';
import { calculateRunToolCatalogDigest } from '../utils/tool-control-plane-digest.js';
import {
  calculateCredentialDefinitionDigest,
  calculateCredentialScopeDigest,
} from '../utils/credential-broker-digest.js';
import { providerRuntimeManifestFixture } from './fixtures/provider-runtime-manifest.js';

const TASK_ID = 'task-access-summary';
const ATTEMPT_ID = 'attempt-access-summary';
const NOW = '2026-08-30T08:00:00.000Z';

describe('RunAccessSummaryService', () => {
  it('projects one redacted digest-bound contract across access dimensions', async () => {
    const launchEvidence = phaseEvidence('implement');
    const providerRuntime = providerRuntimeManifestFixture({
      provider: 'codex-cli',
      capabilityStates: {
        'network.disable': 'supported',
        'artifact.write': 'supported',
      },
    });
    const catalog = toolCatalog(providerRuntime.digest, launchEvidence.digest);
    const manifest = launchManifest(providerRuntime, launchEvidence, catalog.digest);
    const task = taskFixture(manifest, providerRuntime);
    const definition = credentialDefinition();
    const lease = credentialLease(manifest.digest, definition);
    const service = serviceFixture({
      task,
      phase: phaseSnapshot(manifest, launchEvidence),
      catalog,
      reservation: admissionReservation(),
      definitions: [definition],
      leases: [lease],
    });

    const result = await service.get('local', TASK_ID, ATTEMPT_ID);

    expect(result.history).toEqual([]);
    expect(result.current).toMatchObject({
      schemaVersion: 'run-access-summary/v1',
      status: 'complete',
      generatedAt: NOW,
      version: { kind: 'launch', sequence: 0 },
      identity: {
        taskId: TASK_ID,
        runId: ATTEMPT_ID,
        attemptId: ATTEMPT_ID,
        launchManifestDigest: manifest.digest,
        phaseEvidenceDigest: launchEvidence.digest,
        selectedHost: 'local-process',
      },
      filesystem: {
        sandboxMode: 'workspace-write',
        targets: [
          expect.objectContaining({
            label: 'Task workspace',
            access: 'write',
            pathDigest: `sha256:${'9'.repeat(64)}`,
          }),
        ],
      },
      network: {
        enabled: false,
        policy: 'disabled',
        enforceability: 'supported',
      },
      tools: [
        expect.objectContaining({
          server: 'github-tools',
          name: 'create_issue',
          decision: 'approval',
          availability: 'ready',
        }),
      ],
      integrations: [
        expect.objectContaining({
          definition: 'github-production',
          accountLabel: 'Production GitHub',
          state: 'brokered',
          externalTargets: ['api.example.com'],
          expiresAt: '2026-08-30T09:00:00.000Z',
        }),
      ],
      approvals: { toolCount: 1, integrationCount: 1 },
      budgets: {
        reservationState: 'active',
        capacity: { runSlots: 1, processSlots: 1, estimatedMemoryMb: 512 },
      },
      support: { tier: 'configured', enforceable: true, degraded: false },
      blockers: [],
    });
    expect(result.current.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('supersecret');
    expect(serialized).not.toContain('GITHUB_TOKEN');
    expect(serialized).not.toContain('/Users/bradgroux');
  });

  it('preserves prior immutable phase versions and projects the current transition', async () => {
    const launchEvidence = phaseEvidence('plan');
    const effectiveEvidence = phaseEvidence('implement');
    const providerRuntime = providerRuntimeManifestFixture();
    const catalog = toolCatalog(providerRuntime.digest, launchEvidence.digest);
    const manifest = launchManifest(providerRuntime, launchEvidence, catalog.digest);
    const transition = transitionRecord(manifest, launchEvidence, effectiveEvidence);
    const phase = phaseSnapshot(manifest, effectiveEvidence, transition);
    const service = serviceFixture({
      task: taskFixture(manifest, providerRuntime),
      phase,
      catalog,
      reservation: admissionReservation(),
    });

    const result = await service.get('local', TASK_ID, ATTEMPT_ID);

    expect(result.current.version).toMatchObject({ kind: 'transition', sequence: 1 });
    expect(result.current.identity.phase).toMatchObject({ mode: 'profile', phase: 'implement' });
    expect(result.history).toHaveLength(1);
    expect(result.history[0]).toMatchObject({
      version: { kind: 'launch', sequence: 0 },
      identity: { phase: { mode: 'profile', phase: 'plan' } },
    });
    expect(result.history[0].digest).not.toBe(result.current.digest);
  });

  it('returns typed blocked or incomplete states for missing, conflicting, and failed sources', async () => {
    const missingTask = {
      id: TASK_ID,
      attempt: { id: ATTEMPT_ID, agent: 'codex', status: 'complete' },
    } as Task;
    const missing = serviceFixture({
      task: missingTask,
      phaseError: new Error('token=secret-value unavailable'),
    });
    const missingResult = await missing.get('local', TASK_ID, ATTEMPT_ID);
    expect(missingResult.current.status).toBe('blocked');
    expect(missingResult.current.blockers.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        'phase-projection-unavailable',
        'missing-launch-manifest',
        'missing-provider-runtime-evidence',
        'missing-admission-reservation',
      ])
    );
    expect(JSON.stringify(missingResult)).not.toContain('secret-value');

    const evidence = phaseEvidence('implement');
    const providerRuntime = providerRuntimeManifestFixture();
    const catalog = toolCatalog(providerRuntime.digest, evidence.digest);
    const manifest = launchManifest(providerRuntime, evidence, catalog.digest);
    const definition = credentialDefinition();
    const reservation = admissionReservation();
    const conflicting = serviceFixture({
      task: taskFixture(manifest, providerRuntime),
      phase: phaseSnapshot(manifest, evidence),
      catalog: { ...catalog, digest: `sha256:${'f'.repeat(64)}` },
      reservation: {
        ...reservation,
        request: { ...reservation.request, hostId: 'unexpected-host' },
      },
      definitions: [{ ...definition, digest: `sha256:${'e'.repeat(64)}` }],
    });
    const conflictResult = await conflicting.get('local', TASK_ID, ATTEMPT_ID);
    expect(conflictResult.current.status).toBe('blocked');
    expect(conflictResult.current.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'tool-catalog-digest-conflict' }),
        expect.objectContaining({ code: 'admission-reservation-conflict' }),
        expect.objectContaining({ code: 'credential-definition-conflict' }),
      ])
    );
  });
});

interface ServiceFixtureOptions {
  task: Task;
  phase?: RunPhaseAuthoritySnapshot | null;
  phaseError?: Error;
  catalog?: RunToolCatalog | null;
  reservation?: AdmissionReservation | null;
  definitions?: CredentialDefinition[];
  leases?: CredentialLease[];
}

function serviceFixture(options: ServiceFixtureOptions): RunAccessSummaryService {
  return new RunAccessSummaryService({
    tasks: { findById: vi.fn(async () => options.task) },
    phase: {
      get: vi.fn(async () => {
        if (options.phaseError) throw options.phaseError;
        return options.phase ?? null;
      }),
    },
    tools: { getRunCatalog: vi.fn(async () => options.catalog ?? null) },
    admission: { findByAttempt: vi.fn(async () => options.reservation ?? null) },
    credentials: {
      listDefinitions: vi.fn(async () => options.definitions ?? []),
      listLeases: vi.fn(async () => options.leases ?? []),
    },
    now: () => new Date(NOW),
  });
}

function taskFixture(
  manifest: RunLaunchManifest,
  providerRuntime: ReturnType<typeof providerRuntimeManifestFixture>
): Task {
  return {
    id: TASK_ID,
    title: 'Run access summary',
    description: 'Project exact run authority.',
    type: 'code',
    status: 'in-progress',
    priority: 'high',
    project: 'veritas',
    created: NOW,
    updated: NOW,
    attempt: {
      id: ATTEMPT_ID,
      agent: 'codex',
      provider: 'codex-cli',
      status: 'running',
      runLaunchManifest: manifest,
      providerRuntimeManifest: providerRuntime,
      budget: {
        enabled: true,
        policy: manifest.budget,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          costUsd: 0.02,
          toolCalls: 1,
          runtimeSeconds: 30,
          idleRuntimeSeconds: 0,
          retries: 0,
          fanOut: 0,
        },
        decision: 'allow',
        thresholdEvents: [],
        traceIds: [],
      },
    },
  };
}

function launchManifest(
  providerRuntime: ReturnType<typeof providerRuntimeManifestFixture>,
  evidence: PhaseCapabilityEvidence,
  catalogDigest: string
): RunLaunchManifest {
  const credentialPlan = {
    schemaVersion: 'run-launch-credential-plan/v1' as const,
    digest: `sha256:${'8'.repeat(64)}`,
    mode: 'brokered' as const,
    brokerState: 'supported' as const,
    providerRuntimeManifestDigest: providerRuntime.digest,
    providerRuntimeProbeRevision: providerRuntime.probeRevision,
    references: [
      {
        reference: 'github-production',
        classification: 'task-integration' as const,
        delivery: 'brokered-boundary' as const,
        boundary: 'tool-control-plane' as const,
        risk: 'brokered' as const,
      },
    ],
  };
  const payload: Omit<RunLaunchManifest, 'digest'> = {
    schemaVersion: 'run-launch-manifest/v1',
    createdAt: NOW,
    taskId: TASK_ID,
    attemptId: ATTEMPT_ID,
    taskEnvelope: {
      schemaVersion: 'task-envelope/v1',
      digest: `sha256:${'1'.repeat(64)}`,
      materialDigest: `sha256:${'2'.repeat(64)}`,
    },
    providerRuntime: {
      schemaVersion: providerRuntime.schemaVersion,
      digest: providerRuntime.digest,
      materialDigest: providerRuntime.digest,
      probeRevision: providerRuntime.probeRevision,
      provider: providerRuntime.provider,
      adapter: providerRuntime.adapter,
      protocolVersion: providerRuntime.protocolVersion,
      providerVersion: providerRuntime.providerVersion,
    },
    providerRequirements: { required: [], capabilities: [] },
    harnessSupport: {
      profileId: 'codex-cli',
      adapterId: 'codex-cli',
      transport: 'process-jsonl',
      supportTier: 'configured',
    },
    routing: {
      requestedAgent: 'codex',
      selectedAgent: 'codex',
      selectedHost: 'local-process',
      reason: 'Configured local provider.',
      fallbackAgent: null,
      fallbackAllowed: false,
    },
    phase: { evidence, sourceReferences: [] },
    readiness: {
      ready: true,
      overridden: false,
      passed: 1,
      total: 1,
      missingRequired: [],
      warnings: [],
    },
    instructions: [],
    runtime: {
      command: 'codex',
      args: [],
      workingDirectory: 'task-worktree',
      worktree: 'required',
      environmentKeys: ['PATH'],
      credentialReferences: ['github-production'],
    },
    credentials: credentialPlan,
    tools: {
      allowed: [],
      denied: [],
      policyIds: [],
      mcpServers: ['github-tools'],
      catalogDigest,
      enforcement: 'enforced',
    },
    permissions: { level: 'specialist', required: [], enforcement: 'enforced' },
    resources: { skills: [], shared: [], enforcement: 'enforced' },
    requiredHealthChecks: [],
    sandbox: {
      presetId: 'workspace-write',
      enforcement: 'required',
      decision: 'allow',
      effective: {
        sandboxMode: 'workspace-write',
        networkAccessEnabled: false,
        environmentKeys: ['PATH'],
        credentialReferences: ['github-production'],
      },
      unsupportedRules: [],
      warnings: [],
      filesystem: {
        schemaVersion: 'filesystem-sandbox-evidence/v1',
        providerRuntimeManifestDigest: providerRuntime.digest,
        backend: 'provider-native',
        state: 'enforced',
        platformBackend: 'provider-native',
        capabilityVersion: 'fixture/v1',
        policyHash: `sha256:${'7'.repeat(64)}`,
        roots: [
          {
            id: 'workspace',
            access: 'write',
            scope: 'workspace',
            pathDigest: `sha256:${'9'.repeat(64)}`,
          },
        ],
        protectedPaths: [],
        dotfileMasking: true,
        descendantsEnforced: true,
        cleanupOwner: 'run-supervisor',
      },
    },
    budget: { enabled: true, scope: 'run', limits: { totalTokens: 10_000, costUsd: 5 } },
    workspaceTrust: { status: 'not-required', source: 'fixture' },
    origins: [],
    enforcement: { enforceable: true, blockers: [], warnings: [] },
  };
  return { ...payload, digest: calculateRunLaunchManifestDigest(payload) };
}

function toolCatalog(providerDigest: string, phaseDigest: string): RunToolCatalog {
  const definition = credentialDefinition();
  const payload: RunToolCatalog = {
    schemaVersion: 'run-tool-catalog/v1',
    taskId: TASK_ID,
    attemptId: ATTEMPT_ID,
    provider: 'codex-cli',
    providerRuntimeManifestDigest: providerDigest,
    taskEnvelopeDigest: `sha256:${'1'.repeat(64)}`,
    phaseEvidenceDigest: phaseDigest,
    entries: [
      {
        serverId: 'github-tools',
        serverVersion: '1.0.0',
        definitionDigest: `sha256:${'3'.repeat(64)}`,
        discoveryDigest: `sha256:${'4'.repeat(64)}`,
        transport: 'stdio',
        requirement: 'required',
        status: 'ready',
        credentialBindings: [
          {
            credentialReference: 'github-production',
            credentialDefinitionDigest: definition.digest,
            scopeDigest: calculateCredentialScopeDigest(definition.scope),
            target: { kind: 'environment', name: 'GITHUB_TOKEN' },
          },
        ],
        tools: [
          {
            name: 'create_issue',
            qualifiedName: 'github-tools.create_issue',
            inputSchema: {},
            inputSchemaDigest: `sha256:${'7'.repeat(64)}`,
            externalAction: 'mutate',
            decision: 'approval',
          },
        ],
      },
    ],
    createdAt: NOW,
    digest: `sha256:${'0'.repeat(64)}`,
  };
  return { ...payload, digest: calculateRunToolCatalogDigest(payload) };
}

function credentialDefinition(): CredentialDefinition {
  const definition = {
    schemaVersion: 'credential-definition/v1',
    id: 'github-production',
    name: 'Production GitHub',
    enabled: true,
    source: { kind: 'environment', reference: 'GITHUB_TOKEN' },
    scope: {
      dispatchTypes: ['tool'],
      hosts: [],
      tools: ['create_issue'],
      destinations: ['https://api.example.com/repos?token=supersecret'],
      methods: ['POST'],
      actions: ['issue.create'],
      pathPrefixes: [],
    },
    lease: { ttlSeconds: 3600, maxUses: 1, renewable: false },
    approval: 'required',
    createdAt: NOW,
    updatedAt: NOW,
  };
  return { ...definition, digest: calculateCredentialDefinitionDigest(definition) };
}

function credentialLease(
  manifestDigest: string,
  definition: CredentialDefinition
): CredentialLease {
  return {
    schemaVersion: 'credential-lease/v1',
    id: 'lease-access-summary',
    handleHash: `sha256:${'a'.repeat(64)}`,
    definitionId: definition.id,
    definitionDigest: definition.digest,
    taskId: TASK_ID,
    attemptId: ATTEMPT_ID,
    runLaunchManifestDigest: manifestDigest,
    scopeDigest: calculateCredentialScopeDigest(definition.scope),
    actionFingerprint: `sha256:${'7'.repeat(64)}`,
    state: 'active',
    issuedAt: NOW,
    expiresAt: '2026-08-30T09:00:00.000Z',
    updatedAt: NOW,
    uses: 0,
    maxUses: 1,
    operations: [],
  };
}

function admissionReservation(): AdmissionReservation {
  return {
    schemaVersion: 'admission-reservation/v1',
    id: 'admission-access-summary',
    revision: 1,
    state: 'active',
    request: {
      schemaVersion: 'admission-request/v1',
      idempotencyKey: `sha256:${'b'.repeat(64)}`,
      source: 'direct',
      taskId: TASK_ID,
      rootTaskId: TASK_ID,
      workspaceId: 'local',
      provider: 'codex-cli',
      hostId: 'local-process',
      requested: { runSlots: 1, processSlots: 1, estimatedMemoryMb: 512 },
      requestedAt: NOW,
    },
    policies: [
      {
        id: 'workspace-capacity',
        scope: 'workspace',
        scopeId: 'local',
        limits: { concurrentRuns: 3 },
      },
    ],
    attemptId: ATTEMPT_ID,
    lease: {
      ownerId: 'run-supervisor',
      hostId: 'local-process',
      processId: 123,
      acquiredAt: NOW,
      heartbeatAt: NOW,
      expiresAt: '2026-08-30T08:05:00.000Z',
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function phaseSnapshot(
  manifest: RunLaunchManifest,
  evidence: PhaseCapabilityEvidence,
  transition?: PhaseTransitionRecord
): RunPhaseAuthoritySnapshot {
  return {
    taskId: TASK_ID,
    attemptId: ATTEMPT_ID,
    manifestDigest: manifest.digest,
    launch: manifest.phase as NonNullable<RunLaunchManifest['phase']>,
    effectiveEvidence: evidence,
    transitionSequence: transition?.sequence ?? 0,
    current: transition ?? null,
    history: transition ? [transition] : [],
  };
}

function transitionRecord(
  manifest: RunLaunchManifest,
  priorEvidence: PhaseCapabilityEvidence,
  effectiveEvidence: PhaseCapabilityEvidence
): PhaseTransitionRecord {
  return {
    schemaVersion: 'phase-transition-record/v1',
    id: 'phase-transition-access-summary',
    workspaceId: 'local',
    taskId: TASK_ID,
    attemptId: ATTEMPT_ID,
    sequence: 1,
    operationId: 'transition-access-summary',
    priorEvidence,
    effectiveEvidence,
    authorityDelta: { classification: 'expanding', entries: [] },
    actor: { id: 'operator', type: 'user', label: 'Operator' },
    reason: 'Begin implementation.',
    policyDecision: 'approved-expansion',
    manifestDigest: manifest.digest,
    eventReference: 'phase-transition-access-summary',
    createdAt: NOW,
  };
}

function phaseEvidence(phase: 'plan' | 'implement'): PhaseCapabilityEvidence {
  return compilePhaseCapabilityAuthority({
    profile: getBuiltInPhaseCapabilityProfile(phase),
    sources: {
      parent: phaseSource('parent', 'parent'),
      agentProfile: phaseSource('agent-profile', 'agent-profile'),
      sandbox: phaseSource('sandbox', 'sandbox'),
      toolCatalog: phaseSource('tool-catalog', 'tool-catalog'),
      launchPolicy: phaseSource('launch-policy', 'launch-policy'),
    },
  });
}

function phaseSource<K extends PhaseAuthoritySource['kind']>(
  id: string,
  kind: K
): PhaseAuthoritySource & { kind: K } {
  return {
    id,
    kind,
    authority: dimensions(() => ['*']),
    enforcement: dimensions(() => 'enforced' as const),
  };
}

function dimensions<T>(
  value: (dimension: PhaseAuthorityDimension) => T
): Record<PhaseAuthorityDimension, T> {
  return Object.fromEntries(
    PHASE_AUTHORITY_DIMENSIONS.map((dimension) => [dimension, value(dimension)])
  ) as Record<PhaseAuthorityDimension, T>;
}

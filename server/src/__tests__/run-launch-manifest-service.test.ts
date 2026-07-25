import { describe, expect, it } from 'vitest';
import {
  RUN_LAUNCH_MANIFEST_SCHEMA_VERSION,
  type HarnessSupportStatus,
  type RunToolCatalog,
  type SandboxPolicyDryRunResult,
  type TaskEnvelope,
} from '@veritas-kanban/shared';
import {
  RunLaunchManifestSchema,
  parseRunLaunchManifest,
} from '../schemas/run-launch-manifest-schemas.js';
import {
  RunLaunchManifestService,
  diffRunLaunchManifests,
  type RunLaunchManifestCompileInput,
} from '../services/run-launch-manifest-service.js';
import { calculateProviderRuntimeManifestDigest } from '../utils/provider-runtime-manifest-digest.js';
import {
  calculateRunLaunchManifestDigest,
  verifyRunLaunchManifestDigest,
} from '../utils/run-launch-manifest-digest.js';
import { calculateRunToolCatalogDigest } from '../utils/tool-control-plane-digest.js';
import { providerRuntimeManifestFixture } from './fixtures/provider-runtime-manifest.js';
import { PhaseLaunchAuthorityService } from '../services/phase-launch-authority-service.js';

const providerRuntimeManifest = providerRuntimeManifestFixture({
  provider: 'codex-cli',
  providerVersion: 'codex-cli 1.0.0',
});

const taskEnvelope: TaskEnvelope = {
  schemaVersion: 'task-envelope/v1',
  digest: `sha256:${'a'.repeat(64)}`,
  subject: {
    id: 'task-854',
    title: 'Compile launch manifest',
    objective: 'Compile the effective runtime launch plan.',
    background: [],
    constraints: [],
    acceptanceCriteria: [],
  },
  attempt: {
    id: 'attempt-854',
    createdAt: '2026-07-23T20:00:00.000Z',
  },
  workspace: {
    workspaceId: 'workspace-854',
    worktreeId: 'worktree-854',
    worktreeManifestId: 'manifest-854',
    ownershipLeaseId: 'lease-854',
    ownershipAttemptId: 'attempt-854',
    repo: 'BradGroux/veritas-kanban',
    branch: 'feat/run-launch-manifest-854',
    baseBranch: 'main',
    resolvedBaseCommit: 'b'.repeat(40),
    baseResolutionSource: 'remote',
    worktreePath: '/workspace/veritas-kanban',
    baseline: {
      capturedAt: '2026-07-23T20:00:00.000Z',
      headSha: 'a'.repeat(40),
      dirty: false,
      files: [],
    },
  },
  commitPolicy: 'allowed',
  allowedSideEffects: [],
  expectedOutputs: [],
  verificationGates: [],
  launchManifest: {
    schemaVersion: providerRuntimeManifest.schemaVersion,
    digest: providerRuntimeManifest.digest,
    provider: providerRuntimeManifest.provider,
    adapter: providerRuntimeManifest.adapter,
    protocolVersion: providerRuntimeManifest.protocolVersion,
  },
  completionContract: {
    schemaVersion: 'completion-result/v1',
    evidenceRequirements: [],
  },
};

const harnessSupport: HarnessSupportStatus = {
  agentType: 'codex',
  enabled: true,
  profileId: 'openai-codex-cli',
  adapterId: 'codex-cli',
  transport: 'process-jsonl',
  supportTier: 'configured',
  reason: 'Configured for test.',
  failureClass: 'none',
  checkedAt: '2026-07-23T20:00:00.000Z',
  executableFound: true,
  authenticated: true,
  diagnosticCommands: ['codex --version'],
  remediation: [],
};

const sandboxPolicy: SandboxPolicyDryRunResult = {
  decision: 'allow',
  provider: 'codex-cli',
  preset: {
    id: 'workspace-write-default',
    name: 'Workspace write',
    enabled: true,
    enforcement: 'required',
    requiredCapabilities: [],
    filesystem: {
      readPaths: ['<workspace>'],
      writePaths: ['<workspace>'],
      deniedPaths: [],
      dotfileMasking: false,
      localOnlyHandles: true,
    },
    network: {
      defaultEgress: 'deny',
      allowedHosts: [],
      allowedMethods: [],
      allowedPathPrefixes: [],
      blockPrivateNetwork: true,
      blockMetadataEndpoints: true,
      blockLoopback: true,
    },
    environment: {
      passthrough: ['PATH', 'OPENAI_API_KEY'],
      redactDisplay: true,
    },
    credentials: {
      mode: 'none',
      brokerRefs: [],
    },
    createdAt: '2026-07-23T20:00:00.000Z',
    updatedAt: '2026-07-23T20:00:00.000Z',
  },
  effective: {
    sandboxMode: 'workspace-write',
    networkAccessEnabled: false,
    envPassthrough: ['PATH', 'OPENAI_API_KEY'],
    credentialRefs: [],
    filesystemBackend: {
      backend: 'codex-sandbox',
      state: 'available',
      capabilityVersion: 'codex-sandbox-state/v0.145',
      backendVersion: '0.145.0',
      platformBackend: 'seatbelt',
      supported: [
        'filesystem.read',
        'filesystem.write',
        'filesystem.deny-paths',
        'filesystem.dotfile-masking',
        'filesystem.protected-metadata',
        'filesystem.descendants',
      ],
      reason: 'Credential-free conformance passed.',
    },
  },
  evaluations: [],
  unsupportedRules: [],
  warnings: [],
};

const workspaceTrustIdentity = {
  schemaVersion: 'workspace-execution-trust/v1',
  digest: `sha256:${'1'.repeat(64)}`,
  canonicalWorkspacePathDigest: `sha256:${'2'.repeat(64)}`,
  canonicalRepositoryRootDigest: `sha256:${'3'.repeat(64)}`,
  gitCommonDirectoryDigest: `sha256:${'4'.repeat(64)}`,
  remoteIdentityDigest: `sha256:${'5'.repeat(64)}`,
} as const;

const workspaceTrust: RunLaunchManifestCompileInput['workspaceTrust'] = {
  schemaVersion: 'workspace-execution-trust/v1',
  status: 'not-required',
  source: 'No repository-controlled execution components were discovered.',
  requiresExplicitDecision: false,
  identity: workspaceTrustIdentity,
  inventory: {
    schemaVersion: 'workspace-execution-trust-inventory/v1',
    digest: `sha256:${'6'.repeat(64)}`,
    scannerRevision: 1,
    scannedAt: '2026-07-23T20:00:00.000Z',
    identity: workspaceTrustIdentity,
    entries: [],
    projectPolicy: {
      maximumTrust: 'trusted',
      valid: true,
    },
  },
  restrictionChecks: [],
};

const legacyPhaseAuthority = new PhaseLaunchAuthorityService().compile({
  sandboxPolicy,
  providerRuntimeManifest,
  selectedHost: 'local-process',
});

function input(
  overrides: Partial<RunLaunchManifestCompileInput> = {}
): RunLaunchManifestCompileInput {
  return {
    taskId: 'task-854',
    attemptId: 'attempt-854',
    createdAt: '2026-07-23T20:00:00.000Z',
    taskEnvelope,
    providerRuntimeManifest,
    harnessSupport,
    routing: {
      requestedAgent: 'auto',
      selectedAgent: 'codex',
      selectedHost: 'local-process',
      reason: 'Routing engine selected the configured coding harness.',
      fallbackAgent: null,
      fallbackAllowed: false,
    },
    profile: {
      id: 'developer-profile',
      version: '1.0.0',
      role: 'developer',
    },
    phase: legacyPhaseAuthority,
    readiness: {
      summary: {
        checks: [],
        passed: 8,
        total: 8,
        percent: 100,
        ready: true,
        missingRequired: [],
        warnings: [],
      },
    },
    instructions: [
      {
        id: 'task-prompt',
        kind: 'task',
        content: 'Implement the task envelope launch contract.',
        origin: 'task-envelope',
        precedence: 10,
      },
      {
        id: 'profile-prompt',
        kind: 'profile',
        content: 'Use the repository conventions.',
        origin: 'agent-profile:developer-profile',
        precedence: 20,
      },
    ],
    runtime: {
      model: 'gpt-5.6',
      command: 'codex',
      args: ['exec', '--json', '<prompt>'],
      workingDirectory: 'task-worktree',
      worktree: 'required',
      environmentKeys: ['PATH', 'OPENAI_API_KEY'],
      credentialReferences: ['env:OPENAI_API_KEY'],
    },
    tools: {
      allowed: [],
      denied: [],
      policyIds: [],
      mcpServers: [],
      enforcement: 'not-required',
    },
    permissions: {
      level: 'specialist',
      required: [],
      enforcement: 'not-required',
    },
    resources: {
      skills: [],
      shared: [],
      enforcement: 'not-required',
    },
    requiredHealthChecks: [],
    sandboxPolicy,
    filesystemSandbox: {
      schemaVersion: 'filesystem-sandbox-evidence/v1',
      providerRuntimeManifestDigest: providerRuntimeManifest.digest,
      backend: 'codex-sandbox',
      state: 'enforced',
      platformBackend: 'seatbelt',
      capabilityVersion: 'codex-sandbox-state/v0.145',
      backendVersion: '0.145.0',
      backendExecutableDigest: `sha256:${'d'.repeat(64)}`,
      policyHash: `sha256:${'f'.repeat(64)}`,
      roots: [
        {
          id: 'workspace-write',
          access: 'write',
          scope: 'workspace',
          pathDigest: `sha256:${'e'.repeat(64)}`,
        },
      ],
      protectedPaths: ['.agents', '.codex', '.git', '.veritas-kanban'],
      dotfileMasking: false,
      descendantsEnforced: true,
      cleanupOwner: 'run-supervisor',
    },
    budgetPolicy: {
      enabled: true,
      scope: 'run',
      limits: { totalTokens: 50_000 },
      hardAction: 'require-approval',
    },
    workspaceTrust,
    origins: [
      {
        field: 'runtime.model',
        scope: 'agent-profile',
        source: 'agent-profile:developer-profile',
        precedence: 30,
      },
      {
        field: 'sandbox.presetId',
        scope: 'system-default',
        source: 'sandbox:workspace-write-default',
        precedence: 10,
      },
    ],
    ...overrides,
  };
}

function requireFilesystemSandbox(
  value: ReturnType<typeof input>['filesystemSandbox']
): NonNullable<ReturnType<typeof input>['filesystemSandbox']> {
  if (!value) throw new Error('Expected filesystem sandbox fixture evidence');
  return value;
}

function brokeredCatalog(): RunToolCatalog {
  const payload: RunToolCatalog = {
    schemaVersion: 'run-tool-catalog/v1',
    taskId: 'task-854',
    attemptId: 'attempt-854',
    provider: 'codex-cli',
    providerRuntimeManifestDigest: providerRuntimeManifest.digest,
    taskEnvelopeDigest: taskEnvelope.digest,
    entries: [
      {
        serverId: 'github-tools',
        serverVersion: '1.0.0',
        definitionDigest: `sha256:${'b'.repeat(64)}`,
        discoveryDigest: `sha256:${'c'.repeat(64)}`,
        transport: 'stdio',
        requirement: 'required',
        status: 'ready',
        credentialBindings: [
          {
            credentialReference: 'github-token',
            credentialDefinitionDigest: `sha256:${'d'.repeat(64)}`,
            scopeDigest: `sha256:${'e'.repeat(64)}`,
            target: { kind: 'environment', name: 'GITHUB_TOKEN' },
          },
        ],
        tools: [],
      },
    ],
    createdAt: '2026-07-23T20:00:00.000Z',
    digest: `sha256:${'0'.repeat(64)}`,
  };
  return { ...payload, digest: calculateRunToolCatalogDigest(payload) };
}

describe('RunLaunchManifestService', () => {
  it('compiles a canonical immutable manifest without prompt or credential values', () => {
    const manifest = new RunLaunchManifestService().compile(input());

    expect(manifest).toMatchObject({
      schemaVersion: RUN_LAUNCH_MANIFEST_SCHEMA_VERSION,
      taskId: 'task-854',
      attemptId: 'attempt-854',
      taskEnvelope: {
        schemaVersion: 'task-envelope/v1',
        digest: taskEnvelope.digest,
      },
      providerRuntime: {
        digest: expect.stringMatching(/^sha256:/),
        provider: 'codex-cli',
        probeRevision: expect.any(Number),
      },
      credentials: {
        schemaVersion: 'run-launch-credential-plan/v1',
        mode: 'none',
        brokerState: 'not-required',
        references: [
          {
            reference: 'env:OPENAI_API_KEY',
            classification: 'harness-boot-authentication',
            delivery: 'provider-native-environment',
            boundary: 'provider-process',
            risk: 'provider-required',
          },
        ],
      },
      workspace: {
        worktreeId: 'worktree-854',
        worktreeManifestId: 'manifest-854',
        ownershipLeaseId: 'lease-854',
        ownershipAttemptId: 'attempt-854',
        repo: 'BradGroux/veritas-kanban',
        branch: 'feat/run-launch-manifest-854',
        baseBranch: 'main',
        resolvedBaseCommit: 'b'.repeat(40),
        baseResolutionSource: 'remote',
      },
      enforcement: {
        enforceable: true,
        blockers: [],
      },
      phase: {
        evidence: {
          identity: {
            mode: 'legacy',
            phase: 'legacy',
          },
          status: expect.stringMatching(/allowed|narrowed/),
        },
        sourceReferences: expect.arrayContaining([
          expect.objectContaining({ kind: 'parent' }),
          expect.objectContaining({ kind: 'agent-profile' }),
          expect.objectContaining({ kind: 'sandbox' }),
          expect.objectContaining({ kind: 'tool-catalog' }),
          expect.objectContaining({ kind: 'launch-policy' }),
        ]),
      },
      sandbox: {
        filesystem: {
          backend: 'codex-sandbox',
          providerRuntimeManifestDigest: providerRuntimeManifest.digest,
          policyHash: `sha256:${'f'.repeat(64)}`,
          cleanupOwner: 'run-supervisor',
        },
      },
    });
    expect(manifest.instructions).toEqual([
      expect.objectContaining({
        id: 'task-prompt',
        digest: expect.stringMatching(/^sha256:/),
        byteLength: expect.any(Number),
      }),
      expect.objectContaining({
        id: 'profile-prompt',
        digest: expect.stringMatching(/^sha256:/),
        byteLength: expect.any(Number),
      }),
    ]);
    expect(manifest.credentials?.providerRuntimeManifestDigest).toBe(
      manifest.providerRuntime.digest
    );
    expect(manifest.credentials?.providerRuntimeProbeRevision).toBe(
      manifest.providerRuntime.probeRevision
    );
    expect(JSON.stringify(manifest)).not.toContain('Implement the task envelope');
    expect(JSON.stringify(manifest)).not.toContain('provider-sensitive-value');
    expect(RunLaunchManifestSchema.safeParse(manifest).success).toBe(true);
    expect(verifyRunLaunchManifestDigest(manifest)).toBe(true);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.runtime.args)).toBe(true);
    expect(() => manifest.runtime.args.push('--tamper')).toThrow(TypeError);
  });

  it('keeps legacy v1 launch manifests readable without treating them as fresh trust evidence', () => {
    const current = new RunLaunchManifestService().compile(input());
    const { digest: _digest, ...currentPayload } = current;
    const { phase: _phase, ...legacyPhasePayload } = currentPayload;
    const legacyPayload = {
      ...legacyPhasePayload,
      workspaceTrust: {
        status: 'trusted' as const,
        source: 'Legacy workspace trust evidence.',
      },
    };
    const legacy = {
      ...legacyPayload,
      digest: calculateRunLaunchManifestDigest(legacyPayload),
    };

    expect(parseRunLaunchManifest(legacy).workspaceTrust).toEqual(legacyPayload.workspaceTrust);
    expect(parseRunLaunchManifest(legacy).phase).toBeUndefined();
  });

  it('rejects filesystem evidence linked to a different provider manifest', () => {
    const compileInput = input();

    expect(() =>
      new RunLaunchManifestService().compile({
        ...compileInput,
        filesystemSandbox: {
          ...requireFilesystemSandbox(compileInput.filesystemSandbox),
          providerRuntimeManifestDigest: `sha256:${'9'.repeat(64)}`,
        },
      })
    ).toThrow('Filesystem sandbox evidence does not match the provider runtime manifest');
  });

  it('fails closed when task credentials lack a controlled broker boundary', () => {
    const brokeredPolicy: SandboxPolicyDryRunResult = {
      ...sandboxPolicy,
      preset: {
        ...sandboxPolicy.preset,
        credentials: {
          mode: 'brokered',
          brokerRefs: ['github-token'],
        },
      },
      effective: {
        ...sandboxPolicy.effective,
        credentialRefs: ['github-token'],
      },
    };
    const manifest = new RunLaunchManifestService().compile(
      input({
        sandboxPolicy: brokeredPolicy,
        runtime: {
          ...input().runtime,
          credentialReferences: ['env:OPENAI_API_KEY', 'github-token'],
        },
      })
    );

    expect(manifest.credentials).toMatchObject({
      brokerState: 'blocked',
      references: expect.arrayContaining([
        expect.objectContaining({
          reference: 'github-token',
          classification: 'task-integration',
          delivery: 'blocked',
        }),
      ]),
    });
    expect(manifest.enforcement).toMatchObject({
      enforceable: false,
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'credential-boundary-unavailable' }),
      ]),
    });
  });

  it('accepts an exact tool-control-plane credential boundary', () => {
    const brokeredPolicy: SandboxPolicyDryRunResult = {
      ...sandboxPolicy,
      preset: {
        ...sandboxPolicy.preset,
        credentials: {
          mode: 'brokered',
          brokerRefs: ['github-token'],
        },
      },
      effective: {
        ...sandboxPolicy.effective,
        credentialRefs: ['github-token'],
      },
    };
    const runToolCatalog = brokeredCatalog();
    const manifest = new RunLaunchManifestService().compile(
      input({
        sandboxPolicy: brokeredPolicy,
        runToolCatalog,
        tools: {
          allowed: [],
          denied: [],
          policyIds: [],
          mcpServers: ['github-tools'],
          catalogDigest: runToolCatalog.digest,
          enforcement: 'enforced',
        },
        runtime: {
          ...input().runtime,
          credentialReferences: ['env:OPENAI_API_KEY', 'github-token'],
        },
      })
    );

    expect(manifest.credentials).toMatchObject({
      brokerState: 'supported',
      references: expect.arrayContaining([
        {
          reference: 'github-token',
          classification: 'task-integration',
          delivery: 'brokered-boundary',
          boundary: 'tool-control-plane',
          risk: 'brokered',
        },
      ]),
    });
    expect(manifest.enforcement).toMatchObject({
      enforceable: true,
      blockers: [],
    });
  });

  it('fails closed when the selected provider cannot inject the run tool bridge', () => {
    const hermesRuntime = providerRuntimeManifestFixture({
      provider: 'hermes-cli',
      providerVersion: 'hermes 2026.7.7.2',
    });
    const hermesEnvelope: TaskEnvelope = {
      ...taskEnvelope,
      launchManifest: {
        schemaVersion: hermesRuntime.schemaVersion,
        digest: hermesRuntime.digest,
        provider: hermesRuntime.provider,
        adapter: hermesRuntime.adapter,
        protocolVersion: hermesRuntime.protocolVersion,
      },
    };
    const catalogInput = {
      ...brokeredCatalog(),
      provider: 'hermes-cli' as const,
      providerRuntimeManifestDigest: hermesRuntime.digest,
    };
    const runToolCatalog = {
      ...catalogInput,
      digest: calculateRunToolCatalogDigest(catalogInput),
    };
    const brokeredPolicy: SandboxPolicyDryRunResult = {
      ...sandboxPolicy,
      provider: 'hermes-cli',
      preset: {
        ...sandboxPolicy.preset,
        credentials: { mode: 'brokered', brokerRefs: ['github-token'] },
      },
      effective: {
        ...sandboxPolicy.effective,
        credentialRefs: ['github-token'],
      },
    };
    const manifest = new RunLaunchManifestService().compile(
      input({
        taskEnvelope: hermesEnvelope,
        providerRuntimeManifest: hermesRuntime,
        harnessSupport: {
          ...harnessSupport,
          agentType: 'hermes',
          profileId: 'hermes-cli',
          adapterId: 'hermes-cli',
        },
        sandboxPolicy: brokeredPolicy,
        filesystemSandbox: {
          ...requireFilesystemSandbox(input().filesystemSandbox),
          providerRuntimeManifestDigest: hermesRuntime.digest,
        },
        runToolCatalog,
        tools: {
          allowed: [],
          denied: [],
          policyIds: [],
          mcpServers: ['github-tools'],
          catalogDigest: runToolCatalog.digest,
          enforcement: 'enforced',
        },
        runtime: {
          ...input().runtime,
          command: 'hermes',
          credentialReferences: ['github-token'],
        },
      })
    );

    expect(manifest.credentials?.brokerState).toBe('supported');
    expect(manifest.enforcement).toMatchObject({
      enforceable: false,
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'run-tool-bridge-unavailable' }),
      ]),
    });
  });

  it('fails closed for declared tools, MCP servers, permissions, and health checks without enforcement', () => {
    const manifest = new RunLaunchManifestService().compile(
      input({
        tools: {
          allowed: ['Read'],
          denied: ['exec'],
          policyIds: ['reviewer'],
          mcpServers: ['veritas'],
          enforcement: 'unavailable',
        },
        permissions: {
          level: 'specialist',
          required: ['repository.read'],
          enforcement: 'unavailable',
        },
        resources: {
          skills: ['review'],
          shared: ['workspace-guidelines'],
          enforcement: 'unavailable',
        },
        requiredHealthChecks: ['profile-health'],
      })
    );

    expect(manifest.enforcement).toMatchObject({
      enforceable: false,
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'tool-policy-unenforceable' }),
        expect.objectContaining({ code: 'mcp-unavailable' }),
        expect.objectContaining({ code: 'permission-unenforceable' }),
        expect.objectContaining({ code: 'skill-resource-unavailable' }),
        expect.objectContaining({ code: 'shared-resource-unavailable' }),
        expect.objectContaining({ code: 'health-check-unavailable' }),
      ]),
    });
    expect(() => new RunLaunchManifestService().assertEnforceable(manifest)).toThrow(
      /cannot be enforced/i
    );
  });

  it('requires immutable catalog evidence for enforced MCP selections', () => {
    const missing = new RunLaunchManifestService().compile(
      input({
        tools: {
          allowed: ['veritas/get_task'],
          denied: [],
          policyIds: [],
          mcpServers: ['veritas'],
          enforcement: 'enforced',
        },
      })
    );
    expect(missing.enforcement.blockers).toContainEqual(
      expect.objectContaining({ code: 'tool-catalog-missing' })
    );

    const catalogued = new RunLaunchManifestService().compile(
      input({
        tools: {
          allowed: ['veritas/get_task'],
          denied: [],
          policyIds: [],
          mcpServers: ['veritas'],
          catalogDigest: `sha256:${'c'.repeat(64)}`,
          enforcement: 'enforced',
        },
      })
    );
    expect(catalogued.enforcement.enforceable).toBe(true);
  });

  it('surfaces unsupported provider capability requirements as preview blockers', () => {
    const manifest = new RunLaunchManifestService().compile(
      input({
        requiredRuntimeCapabilities: ['run.start', 'run.stop'],
      })
    );

    expect(manifest.providerRequirements).toMatchObject({
      required: ['run.start', 'run.stop'],
      capabilities: expect.arrayContaining([
        expect.objectContaining({ id: 'run.start', satisfied: true }),
        expect.objectContaining({ id: 'run.stop', state: 'unknown', satisfied: false }),
      ]),
    });
    expect(manifest.enforcement.blockers).toContainEqual(
      expect.objectContaining({
        code: 'provider-capability-unavailable',
        field: 'providerRequirements.run.stop',
      })
    );
  });

  it('preserves effective-field origins across precedence scopes', () => {
    const manifest = new RunLaunchManifestService().compile(
      input({
        origins: [
          {
            field: 'runtime.model',
            scope: 'system-default',
            source: 'default-model',
            precedence: 10,
          },
          {
            field: 'runtime.model',
            scope: 'workspace',
            source: 'workspace-model-policy',
            precedence: 20,
          },
          {
            field: 'runtime.model',
            scope: 'workflow',
            source: 'workflow:release',
            precedence: 25,
          },
          {
            field: 'runtime.model',
            scope: 'agent-profile',
            source: 'agent-profile:developer-profile',
            precedence: 30,
          },
          {
            field: 'runtime.model',
            scope: 'run',
            source: 'operator-run-override',
            precedence: 40,
          },
          {
            field: 'instructions',
            scope: 'template',
            source: 'prompt-template:implementation',
            precedence: 25,
          },
        ],
      })
    );

    expect(manifest.origins).toEqual([
      expect.objectContaining({
        field: 'instructions',
        scope: 'template',
        precedence: 25,
      }),
      expect.objectContaining({
        field: 'runtime.model',
        scope: 'system-default',
        precedence: 10,
      }),
      expect.objectContaining({
        field: 'runtime.model',
        scope: 'workspace',
        precedence: 20,
      }),
      expect.objectContaining({
        field: 'runtime.model',
        scope: 'workflow',
        precedence: 25,
      }),
      expect.objectContaining({
        field: 'runtime.model',
        scope: 'agent-profile',
        precedence: 30,
      }),
      expect.objectContaining({
        field: 'runtime.model',
        scope: 'run',
        source: 'operator-run-override',
        precedence: 40,
      }),
    ]);
  });

  it('reports material drift without treating attempt metadata as configuration drift', () => {
    const service = new RunLaunchManifestService();
    const parent = service.compile(input());
    const nextTaskEnvelope = structuredClone(taskEnvelope);
    nextTaskEnvelope.digest = `sha256:${'c'.repeat(64)}`;
    nextTaskEnvelope.attempt = {
      id: 'attempt-855',
      createdAt: '2026-07-23T20:05:00.000Z',
    };
    nextTaskEnvelope.workspace.baseline.capturedAt = '2026-07-23T20:05:00.000Z';
    const sameConfiguration = service.compile(
      input({
        attemptId: 'attempt-855',
        createdAt: '2026-07-23T20:05:00.000Z',
        taskEnvelope: nextTaskEnvelope,
      })
    );
    const changedConfiguration = service.compile(
      input({
        runtime: {
          ...input().runtime,
          model: 'gpt-5.6-mini',
        },
      })
    );

    expect(diffRunLaunchManifests(sameConfiguration, parent)).toEqual({
      material: false,
      changes: [],
    });
    expect(diffRunLaunchManifests(changedConfiguration, parent)).toMatchObject({
      material: true,
      changes: [
        expect.objectContaining({
          field: 'runtime',
          beforeDigest: expect.stringMatching(/^sha256:/),
          afterDigest: expect.stringMatching(/^sha256:/),
        }),
      ],
    });

    const changedPolicyEnvelope = structuredClone(nextTaskEnvelope);
    changedPolicyEnvelope.digest = `sha256:${'d'.repeat(64)}`;
    changedPolicyEnvelope.commitPolicy = 'forbidden';
    const changedPolicy = service.compile(input({ taskEnvelope: changedPolicyEnvelope }));
    expect(diffRunLaunchManifests(changedPolicy, parent)).toMatchObject({
      material: true,
      changes: [expect.objectContaining({ field: 'taskEnvelope' })],
    });

    const noProfileParent = service.compile(input({ profile: undefined }));
    const noProfileCurrent = service.compile(
      input({
        profile: undefined,
        attemptId: 'attempt-856',
        createdAt: '2026-07-23T20:06:00.000Z',
      })
    );
    expect(diffRunLaunchManifests(noProfileCurrent, noProfileParent)).toEqual({
      material: false,
      changes: [],
    });
  });

  it('does not report drift when only the provider probe timestamp and exact digest refresh', () => {
    const service = new RunLaunchManifestService();
    const parent = service.compile(input());
    const { digest: _providerDigest, ...refreshedProviderPayload } =
      structuredClone(providerRuntimeManifest);
    refreshedProviderPayload.probe.probedAt = '2026-07-23T20:30:00.000Z';
    const refreshedProviderRuntime = {
      ...refreshedProviderPayload,
      digest: calculateProviderRuntimeManifestDigest(refreshedProviderPayload),
    };
    const refreshedEnvelope = structuredClone(taskEnvelope);
    refreshedEnvelope.digest = `sha256:${'e'.repeat(64)}`;
    refreshedEnvelope.attempt = {
      id: 'attempt-857',
      createdAt: '2026-07-23T20:30:00.000Z',
    };
    refreshedEnvelope.launchManifest.digest = refreshedProviderRuntime.digest;
    const current = service.compile(
      input({
        attemptId: 'attempt-857',
        createdAt: '2026-07-23T20:30:00.000Z',
        taskEnvelope: refreshedEnvelope,
        providerRuntimeManifest: refreshedProviderRuntime,
        filesystemSandbox: {
          ...requireFilesystemSandbox(input().filesystemSandbox),
          providerRuntimeManifestDigest: refreshedProviderRuntime.digest,
        },
      })
    );

    expect(parent.providerRuntime.digest).not.toBe(current.providerRuntime.digest);
    expect(parent.providerRuntime.materialDigest).toBe(current.providerRuntime.materialDigest);
    expect(diffRunLaunchManifests(current, parent)).toEqual({
      material: false,
      changes: [],
    });
  });

  it('normalizes raw and gateway-safe attempt IDs in runtime drift evidence', () => {
    const service = new RunLaunchManifestService();
    const parent = service.compile(
      input({
        attemptId: 'attempt-parent-id',
        runtime: {
          ...input().runtime,
          args: [
            'label=Veritas task task-854 / attempt attempt-parent-id',
            'taskName=task_task_854_attempt_parent_id',
          ],
        },
      })
    );
    const current = service.compile(
      input({
        attemptId: 'attempt-current-id',
        runtime: {
          ...input().runtime,
          args: [
            'label=Veritas task task-854 / attempt attempt-current-id',
            'taskName=task_task_854_attempt_current_id',
          ],
        },
      })
    );

    expect(diffRunLaunchManifests(current, parent)).toEqual({
      material: false,
      changes: [],
    });
  });

  it('rejects tampered or unredacted public evidence', () => {
    const manifest = new RunLaunchManifestService().compile(input());

    expect(() =>
      parseRunLaunchManifest({
        ...manifest,
        runtime: {
          ...manifest.runtime,
          credentialReferences: ['token=unredacted-sensitive-value'],
        },
      })
    ).toThrow(/credential|secret|digest/i);

    expect(() =>
      parseRunLaunchManifest({
        ...manifest,
        runtime: {
          ...manifest.runtime,
          model: 'different-model',
        },
      })
    ).toThrow(/digest/i);

    expect(() =>
      parseRunLaunchManifest({
        ...manifest,
        phase: manifest.phase
          ? {
              ...manifest.phase,
              evidence: {
                ...manifest.phase.evidence,
                warnings: [...manifest.phase.evidence.warnings, 'tampered'],
              },
            }
          : undefined,
      })
    ).toThrow(/phase|digest/i);
  });

  it('does not change persisted evidence when source configuration mutates after compile', () => {
    const source = input();
    const manifest = new RunLaunchManifestService().compile(source);
    const original = structuredClone(manifest);

    source.runtime.model = 'mutated-model';
    source.runtime.args.push('--new-flag');
    source.tools.allowed.push('Write');
    source.sandboxPolicy.effective.envPassthrough.push('MUTATED_SECRET');
    source.budgetPolicy.limits = { totalTokens: 1 };
    const firstOrigin = source.origins[0];
    if (firstOrigin) firstOrigin.source = 'mutated-origin';

    expect(manifest).toEqual(original);
    expect(verifyRunLaunchManifestDigest(manifest)).toBe(true);
  });
});

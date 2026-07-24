import { describe, expect, it } from 'vitest';
import {
  RUN_LAUNCH_MANIFEST_SCHEMA_VERSION,
  type HarnessSupportStatus,
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
import { verifyRunLaunchManifestDigest } from '../utils/run-launch-manifest-digest.js';
import { providerRuntimeManifestFixture } from './fixtures/provider-runtime-manifest.js';

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
      mode: 'brokered',
      brokerRefs: ['openai=provider-sensitive-value'],
    },
    createdAt: '2026-07-23T20:00:00.000Z',
    updatedAt: '2026-07-23T20:00:00.000Z',
  },
  effective: {
    sandboxMode: 'workspace-write',
    networkAccessEnabled: false,
    envPassthrough: ['PATH', 'OPENAI_API_KEY'],
    credentialRefs: ['openai=[redacted]'],
  },
  evaluations: [],
  unsupportedRules: [],
  warnings: [],
};

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
      credentialReferences: ['openai=[redacted]'],
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
    budgetPolicy: {
      enabled: true,
      scope: 'run',
      limits: { totalTokens: 50_000 },
      hardAction: 'require-approval',
    },
    workspaceTrust: {
      status: 'not-required',
      source: 'No repository-controlled executable components were selected.',
    },
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
    expect(JSON.stringify(manifest)).not.toContain('Implement the task envelope');
    expect(JSON.stringify(manifest)).not.toContain('provider-sensitive-value');
    expect(RunLaunchManifestSchema.safeParse(manifest).success).toBe(true);
    expect(verifyRunLaunchManifestDigest(manifest)).toBe(true);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.runtime.args)).toBe(true);
    expect(() => manifest.runtime.args.push('--tamper')).toThrow(TypeError);
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

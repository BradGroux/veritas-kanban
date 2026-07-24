import { describe, expect, it, vi } from 'vitest';
import type {
  HarnessConformanceExecutionInput,
  HarnessConformanceExecutor,
  HarnessConformanceObservation,
  HarnessConformanceSuite,
} from '@veritas-kanban/shared';
import {
  HarnessConformanceExecutionError,
  HarnessConformanceService,
} from '../services/harness-conformance-service.js';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;

function suite(): HarnessConformanceSuite {
  return {
    schemaVersion: 'harness-conformance-suite/v1',
    id: 'provider-parity',
    revision: 1,
    objective: 'Prove the same governed task contract across provider profiles.',
    fixture: {
      id: 'seeded-task-repository',
      revision: 1,
      digest: DIGEST_A,
      seed: 'task-42',
    },
    combinations: [
      {
        id: 'codex',
        provider: 'codex-cli',
        model: 'gpt-5.6-sol',
        profileId: 'openai-codex-cli',
        policyId: 'workspace',
        sandboxPresetId: 'workspace-write',
        mode: 'mock',
      },
      {
        id: 'claude',
        provider: 'claude-code',
        model: 'claude-sonnet-4-6',
        profileId: 'claude-code',
        policyId: 'workspace',
        sandboxPresetId: 'workspace-write',
        mode: 'mock',
      },
    ],
    scenarios: [
      {
        id: 'governed-change',
        objective: 'Create the selected file and complete through the governed tool boundary.',
        repetitions: 2,
        assertions: [
          { kind: 'outcome', expected: 'passed' },
          { kind: 'file', path: 'src/result.txt', expected: 'created' },
          { kind: 'tool', name: 'workspace/write_file', expected: 'allowed' },
          { kind: 'approval', expected: 'approved' },
          { kind: 'network', host: 'metadata.internal', expected: 'denied' },
          { kind: 'policy', policyId: 'workspace', expected: 'allowed' },
          { kind: 'completion', expectedSchema: 'provider-completion/v1', valid: true },
          { kind: 'capability', capabilityId: 'tool.mcp', expected: 'supported' },
        ],
      },
    ],
    capabilityClaims: [
      {
        profileId: 'openai-codex-cli',
        capabilityId: 'tool.mcp',
        scenarioIds: ['governed-change'],
      },
      {
        profileId: 'claude-code',
        capabilityId: 'tool.mcp',
        scenarioIds: ['governed-change'],
      },
    ],
    baselines: [
      {
        revision: 1,
        combinationId: 'codex',
        scenarioId: 'governed-change',
        minPassRate: 1,
        maxMeanLatencyMs: 150,
        maxLatencyStdDevMs: 10,
        maxMeanTokens: 120,
        maxMeanCostUsd: 0.02,
      },
      {
        revision: 1,
        combinationId: 'claude',
        scenarioId: 'governed-change',
        minPassRate: 1,
        maxMeanLatencyMs: 150,
        maxLatencyStdDevMs: 10,
        maxMeanTokens: 120,
        maxMeanCostUsd: 0.02,
      },
    ],
  };
}

function observation(input: HarnessConformanceExecutionInput): HarnessConformanceObservation {
  return {
    outcome: 'passed',
    durationMs: 100 + input.trial,
    tokens: 100,
    costUsd: 0.01,
    retries: 0,
    files: [{ path: 'src/result.txt', state: 'created' }],
    tools: [{ name: 'workspace/write_file', outcome: 'allowed' }],
    approvals: [{ outcome: 'approved' }],
    network: [{ host: 'metadata.internal', decision: 'denied' }],
    policies: [{ policyId: 'workspace', decision: 'allowed' }],
    completions: [{ schema: 'provider-completion/v1', valid: true }],
    capabilities: [{ id: 'tool.mcp', state: 'supported' }],
    evidence: {
      launchManifestDigest: DIGEST_A,
      providerRuntimeManifestDigest: DIGEST_B,
      taskId: `task-${input.combination.id}`,
      attemptId: `attempt-${input.trial}`,
      eventSequenceStart: 1,
      eventSequenceEnd: 8,
    },
  };
}

function executor(
  execute: (input: HarnessConformanceExecutionInput) => HarnessConformanceObservation = observation
): HarnessConformanceExecutor {
  return {
    reset: vi.fn(async () => undefined),
    execute: vi.fn(async (input) => execute(input)),
  };
}

describe('HarnessConformanceService', () => {
  it('runs one seeded scenario across provider combinations and aggregates reproducible evidence', async () => {
    const runner = executor();
    const service = new HarnessConformanceService(() => new Date('2026-07-24T14:00:00.000Z'));
    const result = await service.run(suite(), runner);

    expect(result).toMatchObject({
      schemaVersion: 'harness-conformance-result/v1',
      suiteId: 'provider-parity',
      suiteRevision: 1,
      status: 'passed',
    });
    expect(result.trials).toHaveLength(4);
    expect(result.aggregates).toEqual([
      expect.objectContaining({
        combinationId: 'codex',
        trials: 2,
        passed: 2,
        passRate: 1,
        meanLatencyMs: 101.5,
        p95LatencyMs: 102,
        totalTokens: 200,
        totalCostUsd: 0.02,
        regressions: [],
      }),
      expect.objectContaining({
        combinationId: 'claude',
        trials: 2,
        passed: 2,
        regressions: [],
      }),
    ]);
    expect(runner.reset).toHaveBeenCalledTimes(4);
    expect(runner.execute).toHaveBeenCalledTimes(4);
    expect(result.trials[0]?.observation?.evidence).toMatchObject({
      launchManifestDigest: DIGEST_A,
      providerRuntimeManifestDigest: DIGEST_B,
      eventSequenceStart: 1,
      eventSequenceEnd: 8,
    });
    expect(() => service.assertPassed(result)).not.toThrow();
  });

  it('reports baseline regression and exposes a CI-blocking assertion', async () => {
    const slower = executor((input) => ({
      ...observation(input),
      durationMs: 500,
      tokens: 400,
      costUsd: 0.25,
    }));
    const service = new HarnessConformanceService();
    const result = await service.run(suite(), slower);

    expect(result.status).toBe('regression');
    expect(result.aggregates[0]?.regressions).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Mean latency'),
        expect.stringContaining('Mean tokens'),
        expect.stringContaining('Mean cost'),
      ])
    );
    expect(() => service.assertPassed(result)).toThrow(/conformance regression/i);
  });

  it('classifies reset and provider execution failures without losing later trials', async () => {
    const candidate = suite();
    retainFirstCombination(candidate);
    const reset = vi
      .fn<HarnessConformanceExecutor['reset']>()
      .mockRejectedValueOnce(new Error('fixture could not reset'))
      .mockResolvedValue(undefined);
    const run = vi
      .fn<HarnessConformanceExecutor['execute']>()
      .mockRejectedValueOnce(
        new HarnessConformanceExecutionError('provider-crash', 'provider exited 9')
      );
    const result = await new HarnessConformanceService().run(candidate, { reset, execute: run });

    expect(result.status).toBe('regression');
    expect(result.trials).toMatchObject([
      { passed: false, failureClass: 'fixture-reset' },
      { passed: false, failureClass: 'provider-crash' },
    ]);
    expect(reset).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledOnce();
  });

  it('requires explicit opt-in for credential-gated lanes', async () => {
    const candidate = suite();
    retainFirstCombination(candidate);
    const first = candidate.combinations[0];
    if (!first) throw new Error('Fixture combination missing.');
    candidate.combinations = [{ ...first, mode: 'credential-gated' as const }];
    const runner = executor();
    const service = new HarnessConformanceService();

    await expect(service.run(candidate, runner)).rejects.toThrow(/explicit.*opt-in/i);
    await expect(
      service.run(candidate, runner, { allowCredentialGated: true })
    ).resolves.toMatchObject({ status: 'passed' });
  });

  it('rejects unproven claims and secret-bearing suites while redacting executor diagnostics', async () => {
    const missingProof = suite();
    const firstScenario = missingProof.scenarios[0];
    if (!firstScenario) throw new Error('Fixture scenario missing.');
    firstScenario.assertions = [{ kind: 'outcome', expected: 'passed' }];
    await expect(new HarnessConformanceService().run(missingProof, executor())).rejects.toThrow(
      /matching scenario assertion/i
    );

    const secret = suite();
    secret.objective = 'api_key=super-sensitive-fixture-value';
    await expect(new HarnessConformanceService().run(secret, executor())).rejects.toThrow(
      /credential material/i
    );

    const diagnostic = executor((input) => ({
      ...observation(input),
      diagnostic: 'token=super-sensitive-provider-value',
    }));
    const result = await new HarnessConformanceService().run(suite(), diagnostic);
    expect(result.trials[0]?.diagnostic).toBe('token=[REDACTED]');
    expect(JSON.stringify(result)).not.toContain('super-sensitive-provider-value');
  });
});

function retainFirstCombination(candidate: HarnessConformanceSuite): void {
  const first = candidate.combinations[0];
  if (!first) throw new Error('Fixture combination missing.');
  candidate.combinations = [first];
  candidate.baselines = candidate.baselines.filter(
    (baseline) => baseline.combinationId === first.id
  );
  candidate.capabilityClaims = candidate.capabilityClaims.filter(
    (claim) => claim.profileId === first.profileId
  );
}

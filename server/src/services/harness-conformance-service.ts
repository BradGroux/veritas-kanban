import { createHash } from 'node:crypto';
import type {
  HarnessConformanceAggregate,
  HarnessConformanceAssertion,
  HarnessConformanceAssertionResult,
  HarnessConformanceExecutionInput,
  HarnessConformanceExecutor,
  HarnessConformanceFailureClass,
  HarnessConformanceObservation,
  HarnessConformanceResult,
  HarnessConformanceSuite,
  HarnessConformanceTrialResult,
} from '@veritas-kanban/shared';
import { HARNESS_CONFORMANCE_RESULT_SCHEMA_VERSION } from '@veritas-kanban/shared';
import { ConflictError, ValidationError } from '../middleware/error-handler.js';
import {
  harnessConformanceObservationSchema,
  harnessConformanceSuiteSchema,
} from '../schemas/harness-conformance-schemas.js';
import {
  containsUnredactedProviderRuntimeSecret,
  sanitizeProviderRuntimeDiagnostic,
} from '../utils/provider-runtime-manifest-sanitize.js';

export interface HarnessConformanceRunOptions {
  allowCredentialGated?: boolean;
}

export class HarnessConformanceExecutionError extends Error {
  constructor(
    public readonly failureClass: HarnessConformanceFailureClass,
    message: string
  ) {
    super(message);
  }
}

export class HarnessConformanceService {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async run(
    input: HarnessConformanceSuite,
    executor: HarnessConformanceExecutor,
    options: HarnessConformanceRunOptions = {}
  ): Promise<HarnessConformanceResult> {
    const suite = harnessConformanceSuiteSchema.parse(input) as HarnessConformanceSuite;
    if (containsSensitiveValue(suite)) {
      throw new ValidationError('Conformance suites cannot contain credential material.');
    }
    if (
      !options.allowCredentialGated &&
      suite.combinations.some((combination) => combination.mode === 'credential-gated')
    ) {
      throw new ValidationError(
        'Credential-gated conformance requires an explicit local or scheduled-lane opt-in.'
      );
    }

    const startedAt = this.now().toISOString();
    const trials: HarnessConformanceTrialResult[] = [];
    for (const combination of suite.combinations) {
      for (const scenario of suite.scenarios) {
        for (let trial = 1; trial <= scenario.repetitions; trial += 1) {
          const execution: HarnessConformanceExecutionInput = {
            suite,
            combination,
            scenario,
            trial,
          };
          trials.push(await this.executeTrial(execution, executor));
        }
      }
    }
    const aggregates = this.aggregate(suite, trials);
    const hasRegression = aggregates.some((aggregate) => aggregate.regressions.length > 0);
    const status = hasRegression
      ? 'regression'
      : trials.every((trial) => trial.passed)
        ? 'passed'
        : 'failed';
    const completedAt = this.now().toISOString();
    return {
      schemaVersion: HARNESS_CONFORMANCE_RESULT_SCHEMA_VERSION,
      id: `hcr_${hashJson({ suite: suite.id, revision: suite.revision, startedAt }).slice(0, 24)}`,
      suiteId: suite.id,
      suiteRevision: suite.revision,
      fixture: structuredClone(suite.fixture),
      startedAt,
      completedAt,
      status,
      trials,
      aggregates,
    };
  }

  assertPassed(result: HarnessConformanceResult): void {
    if (result.status === 'passed') return;
    throw new ConflictError(`Harness conformance ${result.status}.`, {
      resultId: result.id,
      regressions: result.aggregates.flatMap((aggregate) =>
        aggregate.regressions.map((regression) => ({
          combinationId: aggregate.combinationId,
          scenarioId: aggregate.scenarioId,
          detail: regression,
        }))
      ),
      failedTrials: result.trials.filter((trial) => !trial.passed).length,
    });
  }

  private async executeTrial(
    input: HarnessConformanceExecutionInput,
    executor: HarnessConformanceExecutor
  ): Promise<HarnessConformanceTrialResult> {
    try {
      await executor.reset(structuredClone(input));
    } catch (error) {
      return failedTrial(input, 'fixture-reset', error);
    }

    let observation: HarnessConformanceObservation;
    try {
      observation = harnessConformanceObservationSchema.parse(
        await executor.execute(structuredClone(input))
      ) as HarnessConformanceObservation;
    } catch (error) {
      return failedTrial(
        input,
        error instanceof HarnessConformanceExecutionError
          ? error.failureClass
          : isSchemaError(error)
            ? 'malformed-output'
            : 'unknown',
        error
      );
    }
    const assertions = input.scenario.assertions.map((assertion) =>
      evaluateAssertion(assertion, observation)
    );
    const passed = assertions.every((assertion) => assertion.passed);
    const { diagnostic, ...safeObservation } = observation;
    return {
      combinationId: input.combination.id,
      scenarioId: input.scenario.id,
      trial: input.trial,
      passed,
      ...(!passed || observation.failureClass
        ? { failureClass: observation.failureClass ?? 'assertion' }
        : {}),
      ...(diagnostic ? { diagnostic: sanitizeProviderRuntimeDiagnostic(diagnostic) } : {}),
      observation: safeObservation,
      assertions,
    };
  }

  private aggregate(
    suite: HarnessConformanceSuite,
    trials: HarnessConformanceTrialResult[]
  ): HarnessConformanceAggregate[] {
    return suite.combinations.flatMap((combination) =>
      suite.scenarios.map((scenario) => {
        const matching = trials.filter(
          (trial) => trial.combinationId === combination.id && trial.scenarioId === scenario.id
        );
        const observations = matching.flatMap((trial) =>
          trial.observation ? [trial.observation] : []
        );
        const latencies = observations.map((observation) => observation.durationMs);
        const tokens = observations.map((observation) => observation.tokens ?? 0);
        const costs = observations.map((observation) => observation.costUsd ?? 0);
        const aggregate: HarnessConformanceAggregate = {
          combinationId: combination.id,
          scenarioId: scenario.id,
          trials: matching.length,
          passed: matching.filter((trial) => trial.passed).length,
          passRate:
            matching.length === 0
              ? 0
              : matching.filter((trial) => trial.passed).length / matching.length,
          meanLatencyMs: mean(latencies),
          p95LatencyMs: percentile(latencies, 0.95),
          latencyStdDevMs: stdDev(latencies),
          meanTokens: mean(tokens),
          totalTokens: sum(tokens),
          meanCostUsd: mean(costs),
          totalCostUsd: sum(costs),
          retries: sum(observations.map((observation) => observation.retries ?? 0)),
          regressions: [],
        };
        const baseline = suite.baselines.find(
          (candidate) =>
            candidate.combinationId === combination.id && candidate.scenarioId === scenario.id
        );
        if (baseline) {
          aggregate.baselineRevision = baseline.revision;
          if (aggregate.passRate < baseline.minPassRate) {
            aggregate.regressions.push(
              `Pass rate ${aggregate.passRate.toFixed(3)} is below ${baseline.minPassRate.toFixed(3)}.`
            );
          }
          compareMaximum(
            aggregate.regressions,
            'Mean latency',
            aggregate.meanLatencyMs,
            baseline.maxMeanLatencyMs,
            'ms'
          );
          compareMaximum(
            aggregate.regressions,
            'Latency standard deviation',
            aggregate.latencyStdDevMs,
            baseline.maxLatencyStdDevMs,
            'ms'
          );
          compareMaximum(
            aggregate.regressions,
            'Mean tokens',
            aggregate.meanTokens,
            baseline.maxMeanTokens,
            'tokens'
          );
          compareMaximum(
            aggregate.regressions,
            'Mean cost',
            aggregate.meanCostUsd,
            baseline.maxMeanCostUsd,
            'USD'
          );
        }
        return aggregate;
      })
    );
  }
}

function failedTrial(
  input: HarnessConformanceExecutionInput,
  failureClass: HarnessConformanceFailureClass,
  error: unknown
): HarnessConformanceTrialResult {
  return {
    combinationId: input.combination.id,
    scenarioId: input.scenario.id,
    trial: input.trial,
    passed: false,
    failureClass,
    diagnostic: sanitizeProviderRuntimeDiagnostic(
      error instanceof Error ? error.message : 'Harness conformance execution failed.'
    ),
    assertions: [],
  };
}

function evaluateAssertion(
  assertion: HarnessConformanceAssertion,
  observation: HarnessConformanceObservation
): HarnessConformanceAssertionResult {
  let passed = false;
  let observed = 'not observed';
  switch (assertion.kind) {
    case 'outcome':
      observed = observation.outcome;
      passed = observation.outcome === assertion.expected;
      break;
    case 'file': {
      const file = observation.files?.find((candidate) => candidate.path === assertion.path);
      observed = file?.state ?? 'not observed';
      passed = file?.state === assertion.expected;
      break;
    }
    case 'tool': {
      const calls =
        observation.tools?.filter((candidate) => candidate.name === assertion.name) ?? [];
      observed = calls.length === 0 ? 'not called' : calls.map((call) => call.outcome).join(',');
      passed =
        assertion.expected === 'called'
          ? calls.length > 0
          : assertion.expected === 'not-called'
            ? calls.length === 0
            : calls.some((call) => call.outcome === assertion.expected);
      break;
    }
    case 'approval': {
      const approvals = observation.approvals ?? [];
      observed =
        approvals.length === 0 ? 'not requested' : approvals.map((item) => item.outcome).join(',');
      passed =
        assertion.expected === 'not-requested'
          ? approvals.length === 0
          : approvals.some((item) => item.outcome === assertion.expected);
      break;
    }
    case 'network': {
      const attempts =
        observation.network?.filter((candidate) => candidate.host === assertion.host) ?? [];
      observed =
        attempts.length === 0 ? 'not attempted' : attempts.map((item) => item.decision).join(',');
      passed =
        assertion.expected === 'not-attempted'
          ? attempts.length === 0
          : attempts.some((item) => item.decision === assertion.expected);
      break;
    }
    case 'policy': {
      const decisions =
        observation.policies?.filter((candidate) => candidate.policyId === assertion.policyId) ??
        [];
      observed =
        decisions.length === 0 ? 'not observed' : decisions.map((item) => item.decision).join(',');
      passed = decisions.some((item) => item.decision === assertion.expected);
      break;
    }
    case 'completion': {
      const completion = observation.completions?.find(
        (candidate) => candidate.schema === assertion.expectedSchema
      );
      observed = completion ? String(completion.valid) : 'not observed';
      passed = completion?.valid === assertion.valid;
      break;
    }
    case 'capability': {
      const capability = observation.capabilities?.find(
        (candidate) => candidate.id === assertion.capabilityId
      );
      observed = capability?.state ?? 'not observed';
      passed = capability?.state === assertion.expected;
      break;
    }
  }
  return {
    assertion,
    passed,
    detail: passed
      ? `Observed ${observed}.`
      : `Expected ${expectedValue(assertion)}; observed ${observed}.`,
  };
}

function expectedValue(assertion: HarnessConformanceAssertion): string {
  if (assertion.kind === 'completion') return String(assertion.valid);
  return assertion.expected;
}

function compareMaximum(
  regressions: string[],
  label: string,
  actual: number,
  maximum: number | undefined,
  unit: string
): void {
  if (maximum !== undefined && actual > maximum) {
    regressions.push(
      `${label} ${actual.toFixed(3)} ${unit} exceeds ${maximum.toFixed(3)} ${unit}.`
    );
  }
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentileValue * ordered.length) - 1);
  return ordered[index] ?? 0;
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isSchemaError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'name' in error &&
    (error as { name?: unknown }).name === 'ZodError'
  );
}

function containsSensitiveValue(value: unknown): boolean {
  if (typeof value === 'string') return containsUnredactedProviderRuntimeSecret(value);
  if (Array.isArray(value)) return value.some(containsSensitiveValue);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, child]) =>
      containsUnredactedProviderRuntimeSecret(`${key}=${String(child)}`) ||
      containsSensitiveValue(child)
  );
}

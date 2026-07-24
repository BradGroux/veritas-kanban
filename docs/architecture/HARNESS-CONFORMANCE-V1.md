# Harness Conformance v1

`harness-conformance-suite/v1` is the provider-neutral contract for repeating
the same seeded scenario across provider, model, profile, policy, and sandbox
combinations. It complements unit, integration, E2E, load, and security tests;
it does not replace them or reduce provider quality to one synthetic score.

## Contract

A suite contains:

- a versioned fixture ID, revision, digest, and optional repository/seed;
- one or more provider/model/profile/policy/sandbox combinations;
- bounded scenarios with explicit repetitions and assertions;
- capability claims linked to scenarios that actually assert those claims; and
- versioned pass-rate, latency, variance, token, and cost baselines.

The initial assertion vocabulary covers outcome, files, tool calls, approvals,
network attempts, policy decisions, completion schema, and runtime capability
state. It is deliberately declarative. Suites cannot contain executable code,
environment values, credentials, arbitrary expressions, or unbounded matchers.

Suites are limited to 20 combinations, 50 scenarios, 20 repetitions per
scenario, and 500 total trials. IDs and references must be unique and complete.
File assertions accept bounded relative paths only.

## Runner

`HarnessConformanceService` accepts a validated suite and an executor:

```ts
type HarnessConformanceExecutor = {
  reset(input): Promise<void>;
  execute(input): Promise<HarnessConformanceObservation>;
};
```

The runner resets the fixture before every trial, executes combinations and
scenarios in stable declaration order, validates each observation, evaluates
assertions, and returns `harness-conformance-result/v1`. A production executor
can drive Veritas task APIs; deterministic tests can use an in-process mock.
Credential-gated combinations require explicit opt-in and are never enabled by
the suite alone.

Each successful observation references the exact run launch manifest and
provider runtime manifest digests. Optional task, attempt, and causal event
sequence references retain traceability without copying raw provider output
into committed fixtures.

Results report per-trial failure class and per-combination/scenario pass rate,
mean and p95 latency, latency standard deviation, token/cost totals and means,
retries, baseline revision, and regression reasons. `assertPassed()` throws for
failed or regressed results so CI and provider-promotion workflows can fail
closed.

## Recorded mock lane

Run the committed credential-free smoke fixture:

```bash
pnpm --filter @veritas-kanban/server exec tsx \
  src/scripts/run-harness-conformance.ts -- \
  --suite server/src/__fixtures__/harness-conformance/mock-suite.json \
  --observations server/src/__fixtures__/harness-conformance/mock-observations.json
```

Add `--json` for the complete normalized result. The recorded executor is
intentionally inert: it reads bounded observations, runs no arbitrary suite
command, and exits non-zero when evidence is missing, an assertion fails, or a
baseline regresses.

Real-provider lanes supply an executor through the service API. A scheduled or
local caller must add `--allow-credential-gated` or the equivalent service
option, obtain credentials from the approved runtime secret source, and retain
only the normalized evidence contract.

## Security and retention

- Suite and observation schemas reject unknown fields and bound every array,
  string, path, duration, cost, retry, and sequence value.
- Secret-like suite text is rejected. Executor diagnostics are normalized,
  redacted, and truncated before inclusion.
- Observations contain tool names and outcomes, not arguments; hosts, not full
  URLs; policy decisions, not secrets; and evidence references, not raw logs.
- Provider output and private task content are not part of the result schema.
- A failed reset, malformed observation, provider crash, policy block, timeout,
  or verification failure receives an explicit classification.

## Ownership

This contract owns deterministic scenario execution, reduction, baselines, and
evidence references. Provider adapters own their mechanics and runtime
manifests. Buzz composition and the cross-harness compatibility matrix consume
this runner in their release fixtures rather than creating parallel evaluators.

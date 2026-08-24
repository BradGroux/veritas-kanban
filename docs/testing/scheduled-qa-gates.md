# Scheduled QA Gates

Review date: 2026-08-24

The scheduled QA workflow runs heavier browser and load-test coverage outside
the fast pull-request path. Ordinary pull requests stay limited to lint,
typecheck, build, production dependency audit, security gates, and test-scope
recording. Workspace tests, coverage, desktop artifacts, and Docker contracts
run only at scheduled, manual, or `ci:full` milestones.

The 2026-06-04 audit found the workflow failing before job creation because
job-level `env` used the `runner.temp` context. GitHub does not expose the
`runner` context until a job is running, so manual dispatch returned a parse
error instead of producing logs. The workflow now writes `VERITAS_DATA_DIR`
from `$RUNNER_TEMP` during job setup.

Playwright, Mantine QA, coverage, desktop artifacts, load profiles, and Docker
contracts are deliberate milestone gates. Apply `ci:full` to an integration or
release candidate, or use the documented scheduled/manual dispatch. Do not add
them to every ordinary pull request merely to duplicate the final milestone.

## Workflow

Workflow file:

```text
.github/workflows/scheduled-qa.yml
```

Triggers:

- Pull request carrying `ci:full`, rerun on each synchronized candidate head.
- Weekly schedule: Monday at 08:17 UTC.
- Manual dispatch: `workflow_dispatch`.

Manual dispatch input:

| Input          | Values          | Default | Effect                                       |
| -------------- | --------------- | ------- | -------------------------------------------- |
| `load_profile` | `smoke`, `full` | `smoke` | Chooses either k6 CRUD smoke or all profiles |

## Playwright Gate

The Playwright job runs:

```bash
pnpm test:e2e
```

The job installs Chromium only. The Playwright config still owns the test
matrix, including desktop Chromium and the mobile Chromium project for mobile
responsive and offline tests.

Scheduled CI sets `PLAYWRIGHT_HTML_REPORT=1`, so the run emits both GitHub
annotations and an HTML report. This keeps ordinary CI output terse while still
preserving enough evidence for diagnosis.

Artifacts:

| Path                 | Contents                                      |
| -------------------- | --------------------------------------------- |
| `playwright-report/` | HTML report for the scheduled run             |
| `test-results/`      | Failure screenshots, traces, videos, and logs |

Retention: 7 days.

## k6 Gate

The k6 job starts the built API server, waits for `/api/health`, then runs the
selected profile through the pinned official k6 Docker image:

```text
grafana/k6:1.7.1
```

Default scheduled profile:

```text
smoke
```

Manual `full` profile:

```text
smoke read-load write-load mixed-load ws-stress v5-remote-mix
```

Artifacts:

| Path                 | Contents                                  |
| -------------------- | ----------------------------------------- |
| `k6-results/*.json`  | k6 `--summary-export` output per script   |
| `k6-results/*.log`   | Full stdout/stderr per script             |
| `veritas-server.log` | API startup/runtime log for the k6 server |

Retention: 7 days.

## Thresholds

Thresholds live in the k6 scripts and fail the scheduled job when breached.
They are intentionally conservative for the generated CI dataset:

| Profile         | Main threshold                                         |
| --------------- | ------------------------------------------------------ |
| `smoke`         | All checks must pass                                   |
| `read-load`     | p95 HTTP duration under 200 ms, errors under 1 percent |
| `write-load`    | p95 HTTP duration under 500 ms, errors under 1 percent |
| `mixed-load`    | p95 HTTP duration under 500 ms, errors under 1 percent |
| `ws-stress`     | WebSocket connection errors under 5 percent            |
| `v5-remote-mix` | Hot-path p95 budgets from 250 ms to 750 ms by endpoint |

The scheduled run uses generated test data and should catch obvious regression
signals without pretending to be a production soak test. Release candidates
should attach a manual `load_profile=full` run before claiming performance
readiness.

## Local Commands

Playwright:

```bash
pnpm test:e2e
```

k6 smoke:

```bash
pnpm test:load:smoke
```

k6 full profile:

```bash
pnpm test:load
```

The local k6 commands expect an API server at `http://localhost:3001`.

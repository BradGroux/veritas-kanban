# SOP: Orchestrator Pipelines

Use workflow `pipeline` metadata when a parent agent delegates work to scoped subagents and needs a reconciled handoff.

## Workflow Shape

A pipeline declares:

- `mode`: `orchestrated`
- `parentAgent`: workflow agent that owns scope, handoff, and final reconciliation
- `completion`: `all-required`, `any-success`, or `manual-review`
- `roles`: subagent contracts with `scope`, `taskBrief`, `deliverable`, `verification`, optional `dependsOn`, and optional token/time telemetry budgets

The workflow steps still do the execution. Roles should be referenced by normal agent steps or by `parallel.steps[]` substeps. Dry-run lint blocks missing parent agents, missing role agents, missing deliverables, missing verification, and invalid dependencies.

## Runtime Behavior

Run context stores `context.pipeline` with role status and telemetry rollups. Parallel substep output is reconciled into role status after the parent step completes. The run detail view shows role, status, scope, deliverable, dependencies, verification count, and time/token telemetry when present.

Completion packets include an Orchestration Pipeline section when the task attempt has an orchestration summary.

## Built-in Recipe

The `.openclaw Audit` recipe fans out an audit across config, storage, security, docs, and follow-up task roles, then reconciles findings into a work product and completion packet.

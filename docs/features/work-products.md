# Durable Work Products

Durable work products are generated outputs that should outlive a chat message
or task comment: reports, handoff notes, evidence summaries, checklists, tables,
lightweight dashboards, and governed files.

## Model

Each work product stores:

- typed render contract: `text`, `markdown`, `summary`, `checklist`, `report`, `table`, `dashboard`, or governed `file`
- source provenance: task ID, run ID, agent, model, workspace, and source links
- redaction metadata for previews and exports
- bounded version history for typed renders; immutable file versions remain downloadable after archive until an exact-confirmation physical purge

The render contract is data-only. It does not execute arbitrary UI code.

File products can only be created through governed artifact registration. Direct `POST` or `PATCH` requests that attempt to forge a `file` render are rejected. See [File-Backed Work Products v1](../architecture/FILE-WORK-PRODUCTS-V1.md) for launch authority, storage, security, lifecycle, and backup behavior.

## Governed files

Runs with an enforceable artifact grant receive `VERITAS_ARTIFACT_ROOT`. After writing a complete file below that directory, register it with the CLI:

```bash
vk work-products register \
  --task task_20260531_release \
  --run run_abc123 \
  --attempt attempt_abc123 \
  --request-id release-report-v1 \
  --event runevt_provider_output \
  --path release-report.pdf \
  --title "Release report" \
  --media-type application/pdf \
  --json
```

Use `--product <id>` with a new stable request ID to register a new immutable version. Inspect, list, and download with `vk work-products inspect`, `vk work-products list`, and `vk work-products download`. Archive first, then use `vk work-products purge <id> --confirm <id>` only when every immutable version and its metadata should be physically removed.

## API

```bash
curl -s -X POST http://localhost:3001/api/work-products \
  -H 'Content-Type: application/json' \
  -d '{
    "kind": "markdown",
    "title": "Release Readiness Packet",
    "taskId": "task_20260531_release",
    "sourceRunId": "run_abc123",
    "agent": "codex",
    "model": "gpt-5",
    "render": {
      "schemaVersion": 1,
      "kind": "markdown",
      "markdown": "## Summary\nReady for release after verification."
    }
  }'
```

Useful reads:

```bash
curl -s "http://localhost:3001/api/work-products?taskId=task_20260531_release"
curl -s "http://localhost:3001/api/tasks/task_20260531_release/work-products?view=preview"
curl -s "http://localhost:3001/api/work-products/{id}/versions"
curl -s "http://localhost:3001/api/work-products/{id}/export"
```

Refine an existing product without losing history:

```bash
curl -s -X PATCH http://localhost:3001/api/work-products/{id} \
  -H 'Content-Type: application/json' \
  -d '{
    "changeType": "refine",
    "changeSummary": "Add rollback notes",
    "render": {
      "schemaVersion": 1,
      "kind": "markdown",
      "markdown": "## Summary\nReady for release.\n\n## Rollback\nUse the signed rollback artifact."
    }
  }'
```

Restore an earlier version:

```bash
curl -s -X POST http://localhost:3001/api/work-products/{id}/versions/1/restore
```

## Search

Work products participate in keyword search through the `work-products`
collection:

```bash
curl -s -X POST http://localhost:3001/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"release readiness","collections":["work-products"],"backend":"keyword"}'
```

## Redaction

Previews and exports default to redacted output unless a product explicitly sets
`redaction.exportDefault` to `full`. Strict or sensitive products return a
redacted placeholder in previews and exports.

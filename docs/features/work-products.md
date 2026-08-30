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

## Passive previews

Task Work, the Run Timeline, and the Work Products tab share one authenticated preview contract. Text and Markdown, common raster images, passive PDFs, CSV, and Open XML spreadsheets can be inspected without exposing the artifact store or a local file URL. Renderer selection uses validated bytes and media type rather than the filename alone.

Preview parsing is bounded by format-specific byte, row, column, cell, page, pixel, archive-entry, decompressed-size, and compression-ratio limits. Spreadsheet formulas are displayed as inert formula text and are never evaluated. Markdown cannot load images or activate links. PDF previews reject active actions, embedded content, and external links, then render in a sandboxed data-origin frame.

Every preview shows the immutable version, SHA-256 digest, media type, source run, redaction state, and a route to the causal timeline event. Truncation is explicit. Unsupported, quarantined, missing, malformed, oversized, or policy-blocked files keep only the fallback actions allowed by artifact policy.

HTML preview is passive, not a browser runtime. The server reduces bounded `text/html` to semantic, URL-free markup and wraps it in a host-owned document. The client renders it in an empty-sandbox `srcdoc` frame with a unique opaque origin, no referrer, no scripts, no network or remote assets, no forms, no frames or embeds, no storage, and no host or application authority. Refresh and causal-navigation controls stay outside the frame, and the preview lifecycle writes bounded audit records without document contents. Interactive HTML is not supported. See [Governed Artifact Previews v1](../architecture/ARTIFACT-PREVIEWS-V1.md).

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
curl -s "http://localhost:3001/api/work-products/{id}/artifact/preview?version=1"
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

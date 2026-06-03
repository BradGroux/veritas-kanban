# v5.0 Maintenance Center

The Maintenance Center is the operator surface for local-first upkeep. It lives
in Settings -> Maintenance and is backed by `/api/v1/maintenance`.

## What It Shows

- Health checks for storage, disk space, logs, work products, agent runner
  registry state, recent run success, and lifecycle policy loading.
- Storage usage for task files, attachments, telemetry/traces, workflow runs,
  worktrees, logs, debug bundles, and work products.
- Cleanup previews that separate active work, archived/restorable work, and
  safe-to-review generated data.
- Redacted log tails from allowlisted sources only.
- Redacted debug bundles with a manifest of included and excluded categories.
- SQLite export/import actions that report bundle path, database path, table
  counts, warnings, and failure messages.

## Safety Rules

- Cleanup is preview-only until a dedicated delete handler exists for the
  affected data class.
- Destructive cleanup must require explicit confirmation and must never delete
  active task worktrees or current run state silently.
- Debug bundles include redacted log tails, health metadata, storage summaries,
  lifecycle policy metadata, and work-product preview metadata.
- Maintenance summaries and log-tail responses redact local log paths before
  returning data to the UI.
- Debug bundles exclude raw tokens, token hashes, cookies, private keys, raw
  prompts, raw chat content, and generated sensitive text.
- Local home, project, storage, runtime, and log paths are redacted in bundle
  files by default.

## Verification

Focused regression coverage:

```bash
pnpm --filter @veritas-kanban/server test -- maintenance-service.test.ts
pnpm --filter @veritas-kanban/web test -- settings-maintenance-mantine.test.tsx
```

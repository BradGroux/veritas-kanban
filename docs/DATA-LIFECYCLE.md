# v5.0 Data Lifecycle, Retention, and Privacy Controls

This document defines the durable data classes introduced or expanded in v5.0
and the rules that Maintenance Center, backup/export, workspace deletion, and
support bundles must follow.

Hosted cloud sync and hosted SaaS are post-GA. If hosted work starts, extend
this lifecycle policy with the tenant retention, export, deletion, backup, and
support-access rules from
[ADR 0004](architecture/ADR-0004-post-ga-cloud-sync-hosted-saas.md) before any
customer data is processed.

## Core Rules

- Full SQLite backup bundles are raw admin exports. They can include private
  paths, prompts, generated content, user content, and operational history.
- Support/debug bundles are redacted by default. They must not include token
  values, token hashes, cookies, private keys, credentialed URLs, local path
  prefixes, raw prompts, raw chat content, or generated sensitive text unless a
  user explicitly opts in.
- Workspace-scoped exports include only rows for the requested workspace plus
  member user records. Global app configuration is excluded from scoped exports
  until a dedicated per-workspace settings model exists.
- Cleanup previews must show counts, links, age, status, and storage estimates
  before deletion. They should avoid showing full user content.
- Audit/governance evidence is retained separately from operational cleanup
  candidates. Operational cleanup must not silently delete audit history.
- Device sessions, pairing codes, API token secrets, and hashes are not included
  in SQLite backup table exports by default.

## Data Classes

| Data class                                          | Primary tables                                                                                                                                                                                                                              | Default retention                                                                    | Export/delete policy                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Workspace identity and membership                   | `workspaces`, `users`, `workspace_memberships`, `workspace_invitations`                                                                                                                                                                     | Until admin removal or workspace archival                                            | Scoped exports include selected workspace, memberships, invitations, and member users only.                                      |
| Tasks and task metadata                             | `tasks`                                                                                                                                                                                                                                     | Active/backlog until archived or deleted; archived until cleanup                     | Preview linked artifacts before deletion. Included in full and scoped exports.                                                   |
| Task comments and discussion                        | `tasks` JSON                                                                                                                                                                                                                                | Follows parent task                                                                  | Included with task export. Cleanup follows parent task unless comment-level delete is used.                                      |
| Uploads and attachment metadata                     | `task_attachments`                                                                                                                                                                                                                          | While linked to a task unless cleanup-eligible                                       | Preview parent task, path, size, MIME type, and orphan status before deletion.                                                   |
| Work products and versions                          | `work_products`, `work_product_versions`, `task_deliverables`                                                                                                                                                                               | Until task/workspace cleanup or version retention                                    | Preview source task/run, status, version count, and redaction state.                                                             |
| Telemetry and metrics events                        | `telemetry_events`                                                                                                                                                                                                                          | 30 days by default                                                                   | Purge only by explicit range/workspace preview.                                                                                  |
| Workflow definitions, runs, and scheduled snapshots | `workflow_definitions`, `workflow_acls`, `workflow_audit_events`, `workflow_runs`, `scheduled_deliverables`, `scheduled_deliverable_runs`                                                                                                   | Definitions until deleted; runs/snapshots by admin retention                         | Never delete active runs or current scheduled state silently.                                                                    |
| Notifications and subscriptions                     | `notifications`, `thread_subscriptions`                                                                                                                                                                                                     | Until read/dismissed history cleanup                                                 | Preview delivered/read state, target category, source task, and age.                                                             |
| Chat and squad messages                             | `chat_sessions`, `chat_messages`, `squad_messages`                                                                                                                                                                                          | Until session/workspace cleanup                                                      | Preview session, task link, message count, agents, and age.                                                                      |
| Audit, governance, and policy records               | `activity_events`, `status_history`, `decision_records`, `governance_decision_traces`, `feedback_records`, `scoring_profiles`, `scoring_evaluations`, `drift_alerts`, `drift_baselines`, `audit_entries`, `agent_policies`, `tool_policies` | Longer-lived audit evidence                                                          | Do not silently delete through operational cleanup.                                                                              |
| Device sessions and API tokens                      | excluded from backup table exports                                                                                                                                                                                                          | Until expiration or revocation                                                       | Revoke before deletion. Never print secret values or hashes.                                                                     |
| Credential broker metadata                          | `.veritas-kanban/credential-broker/state.json`                                                                                                                                                                                              | Definitions until deleted; lease records retained; audit ring capped at 5,000 events | Metadata only. Excluded from workspace SQLite exports until repository migration. Never export raw handles or credential values. |
| Configuration and registries                        | `app_config_documents`, `managed_list_items`, `task_templates`, `prompt_templates`, `prompt_versions`, `prompt_usage`                                                                                                                       | Until changed or deleted                                                             | Full exports include them. Scoped exports exclude global app config.                                                             |
| Backups, imports, and exports                       | filesystem bundles and manifests                                                                                                                                                                                                            | Until admin removes files                                                            | Every export includes a manifest with data classes, row counts, and redaction state.                                             |
| Diagnostics and debug bundles                       | filesystem bundle output                                                                                                                                                                                                                    | Generated on demand                                                                  | Redacted by default and includes an included-category manifest.                                                                  |

The canonical machine-readable policy is exposed by:

```text
GET /api/v1/sqlite/lifecycle-policy
```

That endpoint describes the SQLite-backed data classes used by backup,
retention, export, and delete workflows. The file-backed credential broker row
above is an explicit exception until its repository migrates to SQLite, so it is
not represented in the endpoint response or SQLite export manifests.

## Backup Manifest

SQLite export manifests use `formatVersion: 2` and include:

- `scope`: `database` or `workspace`
- `tables`: row counts by SQLite table
- `dataClasses`: lifecycle entries with row counts, retention/export/delete
  behavior, sensitivity flags, and workspace scope
- `redaction`: whether the backup is raw or redacted

Workspace-scoped export example:

```json
{
  "sqlitePath": "/path/to/veritas.db",
  "outputDir": "/path/to/workspace-a-export",
  "workspaceId": "workspace-a"
}
```

Workspace exports include rows where `workspace_id` matches the requested
workspace, the matching `workspaces` row, and users who are members of that
workspace. Derived task Markdown and workflow YAML files follow the same
workspace boundary. Tables and derived files without a workspace boundary are
exported as empty arrays or omitted to avoid leaking global state.

## Maintenance Center Requirements

Cleanup and diagnostics surfaces must use this policy instead of ad hoc delete
rules:

- show active, archived, restorable, generated, and safe-to-remove categories
  separately
- list retained reasons for large uploads, work products, chat sessions,
  telemetry ranges, notifications, and workflow snapshots
- require explicit confirmation for destructive cleanup
- preserve active worktrees and current run state by default
- treat `.veritas-kanban/worktree-manifests/*.json` as ownership and recovery
  records, not disposable cache; a clean worktree is not proof that it is
  pushed, merged, unowned, or safe to remove
- preview stale worktree candidates before removal and retain the exact blocked
  reasons; only reasoned overrides may bypass dirty, untracked, unpushed,
  unmerged, or external-hold checks, while an active run remains
  non-overrideable
- preserve credential broker state during general runtime cleanup; revoke active
  leases before intentional broker-state removal
- emit audit/activity records for admin cleanup, export, import, restore, and
  retention-setting changes

## Verification

Regression coverage:

```bash
pnpm --filter @veritas-kanban/server test -- sqlite-portability-service.test.ts
```

The tests verify:

- export manifests include lifecycle data classes and redaction metadata
- workspace-scoped exports exclude another workspace's tasks and telemetry
- member user rows are scoped to the exported workspace
- global app configuration is excluded from workspace-scoped exports

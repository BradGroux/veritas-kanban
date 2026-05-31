# SQLite Schema and Migration Strategy

Status: planned for v5.0-alpha.1

## Purpose

Veritas Kanban v5.0 moves from Markdown, JSON, YAML, JSONL, and NDJSON files to
SQLite as the primary storage backend. The first implementation must preserve the
existing storage abstraction while giving later v5 work room for users,
workspaces, RBAC, remote clients, search, audit history, and safe migration from
v4 projects.

This document defines the initial SQLite schema, important indexes, migration
numbering, rollback policy, current file-backed parity map, and security handling
for sensitive fields.

## Storage Model

The default v5 database file is:

```text
<storage-root>/.veritas-kanban/veritas.db
```

The existing `DATA_DIR` and `VERITAS_DATA_DIR` rules remain authoritative. When
either environment variable is set, the database lives on that configured volume.
Fresh v5 installs use SQLite by default. Upgraded v4 projects keep their original
files as a migration backup until the migration is verified.

## Global Column Conventions

Most mutable domain tables use the following columns:

| Column         | Type                         | Rule                                                                 |
| -------------- | ---------------------------- | -------------------------------------------------------------------- |
| `id`           | `TEXT PRIMARY KEY`           | Stable application ID. Preserve v4 IDs during migration.             |
| `workspace_id` | `TEXT NOT NULL`              | Defaults to `local` until multi-user workspaces land.                |
| `created_at`   | `TEXT NOT NULL`              | ISO 8601 UTC timestamp.                                              |
| `updated_at`   | `TEXT NOT NULL`              | ISO 8601 UTC timestamp.                                              |
| `created_by`   | `TEXT`                       | `system`, `local-user`, API key hash, agent slug, or future user ID. |
| `updated_by`   | `TEXT`                       | Same actor format as `created_by`.                                   |
| `revision`     | `INTEGER NOT NULL DEFAULT 1` | Incremented on every successful write.                               |
| `deleted_at`   | `TEXT`                       | Soft delete marker when history must be retained.                    |
| `archived_at`  | `TEXT`                       | Archive marker when item remains restorable.                         |

Foreign keys are enabled with `PRAGMA foreign_keys = ON`. Application code must
write timestamps in UTC and compare revisions for optimistic concurrency.

## Core Schema

The schema is split into domains so repository parity can land incrementally.
JSON columns are allowed for flexible settings or provider payloads, but task
workflow concepts that need filtering, references, or integrity are normalized.

### Schema Metadata and Workspaces

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  checksum TEXT NOT NULL,
  execution_ms INTEGER NOT NULL,
  rolled_back_at TEXT
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL DEFAULT 'local',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email TEXT,
  auth_subject TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled_at TEXT
);

CREATE TABLE workspace_memberships (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  invited_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT
);
```

Important indexes:

```sql
CREATE INDEX idx_memberships_user ON workspace_memberships(user_id);
CREATE INDEX idx_api_tokens_workspace ON api_tokens(workspace_id, revoked_at);
```

### Tasks and Task Detail

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type_id TEXT,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  project_id TEXT,
  sprint_id TEXT,
  position REAL,
  agent TEXT,
  agents_json TEXT,
  github_repo TEXT,
  github_issue_number INTEGER,
  github_url TEXT,
  auto_complete_on_subtasks INTEGER NOT NULL DEFAULT 0,
  run_mode TEXT,
  qa_required INTEGER NOT NULL DEFAULT 0,
  qa_passed INTEGER NOT NULL DEFAULT 0,
  qa_passed_at TEXT,
  qa_passed_by TEXT,
  blocked_category TEXT,
  blocked_note TEXT,
  lessons_learned TEXT,
  lesson_tags_json TEXT,
  checkpoint_json TEXT,
  cost_prediction_json TEXT,
  actual_cost REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  updated_by TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT,
  deleted_at TEXT,
  migrated_from_path TEXT
);

CREATE TABLE task_git (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  repo TEXT NOT NULL,
  branch TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  worktree_path TEXT,
  pr_url TEXT,
  pr_number INTEGER
);

CREATE TABLE task_attempts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent TEXT NOT NULL,
  status TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  thread_id TEXT,
  cloud_url TEXT,
  cloud_target TEXT,
  started_at TEXT,
  ended_at TEXT,
  is_current INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE task_subtasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  acceptance_criteria_json TEXT,
  criteria_checked_json TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE task_verification_steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0,
  checked_at TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  created_by TEXT,
  PRIMARY KEY (task_id, depends_on_task_id)
);

CREATE TABLE task_comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  deleted_at TEXT
);

CREATE TABLE task_observations (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  score INTEGER NOT NULL,
  agent TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE task_attachments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT,
  storage_path TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  uploaded_by TEXT,
  session_id TEXT,
  validation_status TEXT NOT NULL DEFAULT 'unknown',
  validation_error TEXT,
  retention_status TEXT NOT NULL DEFAULT 'active',
  cleanup_eligible INTEGER NOT NULL DEFAULT 0,
  attachment_json TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE task_deliverables (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  path TEXT,
  agent TEXT,
  model TEXT,
  source_run_id TEXT,
  description TEXT,
  version_number INTEGER NOT NULL DEFAULT 1,
  redaction_json TEXT,
  deliverable_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  deleted_at TEXT
);

CREATE TABLE task_time_entries (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  start_time TEXT NOT NULL,
  end_time TEXT,
  duration_seconds INTEGER,
  description TEXT,
  manual INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE task_review_comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  line_number INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE task_review_state (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  decision TEXT,
  decided_at TEXT,
  summary TEXT,
  review_scores_json TEXT
);

CREATE TABLE task_automation_state (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  session_key TEXT,
  spawned_at TEXT,
  completed_at TEXT,
  result TEXT
);
```

Important indexes:

```sql
CREATE INDEX idx_tasks_workspace_status_position
  ON tasks(workspace_id, status, position, updated_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_workspace_updated ON tasks(workspace_id, updated_at DESC);
CREATE INDEX idx_tasks_project ON tasks(workspace_id, project_id);
CREATE INDEX idx_tasks_sprint ON tasks(workspace_id, sprint_id);
CREATE INDEX idx_tasks_github ON tasks(github_repo, github_issue_number);
CREATE INDEX idx_task_attempts_task ON task_attempts(task_id, started_at DESC);
CREATE INDEX idx_task_comments_task ON task_comments(task_id, created_at);
CREATE INDEX idx_task_observations_task ON task_observations(task_id, created_at DESC);
CREATE INDEX idx_task_attachments_task_uploaded ON task_attachments(task_id, uploaded_at DESC);
CREATE INDEX idx_task_attachments_workspace_cleanup
  ON task_attachments(workspace_id, cleanup_eligible, uploaded_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_task_attachments_mime_uploaded
  ON task_attachments(workspace_id, mime_type, uploaded_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_task_deliverables_task_created ON task_deliverables(task_id, created_at DESC);
CREATE INDEX idx_task_deliverables_workspace_type_status
  ON task_deliverables(workspace_id, type, status, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_task_deliverables_agent_created
  ON task_deliverables(agent, created_at DESC)
  WHERE agent IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_task_deliverables_source_run
  ON task_deliverables(source_run_id)
  WHERE source_run_id IS NOT NULL;
CREATE INDEX idx_task_dependencies_depends ON task_dependencies(depends_on_task_id);
```

### Managed Lists, Settings, Agents, and Integrations

```sql
CREATE TABLE managed_lists (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  icon TEXT,
  color TEXT,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, kind, id)
);

CREATE TABLE app_settings (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (workspace_id, namespace, key)
);

CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  dev_server_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, name)
);

CREATE TABLE agent_configs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  args_json TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE agent_routing_rules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  match_json TEXT NOT NULL,
  agent TEXT NOT NULL,
  model TEXT,
  fallback TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL
);

CREATE TABLE integrations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  config_json TEXT NOT NULL,
  secret_refs_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, provider, display_name)
);
```

Important indexes:

```sql
CREATE INDEX idx_managed_lists_kind ON managed_lists(workspace_id, kind, sort_order);
CREATE INDEX idx_settings_namespace ON app_settings(workspace_id, namespace);
CREATE INDEX idx_agent_configs_workspace ON agent_configs(workspace_id, enabled);
CREATE INDEX idx_integrations_provider ON integrations(workspace_id, provider, enabled);
```

### Templates and Prompt Registry

```sql
CREATE TABLE task_templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  task_defaults_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE task_template_subtasks (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE task_template_blueprint_tasks (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
  ref_id TEXT NOT NULL,
  title TEXT NOT NULL,
  task_defaults_json TEXT NOT NULL,
  blocked_by_refs_json TEXT,
  sort_order INTEGER NOT NULL
);

CREATE TABLE prompt_templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  content TEXT NOT NULL,
  variables_json TEXT NOT NULL,
  current_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE prompt_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES prompt_templates(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  content TEXT NOT NULL,
  changelog TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT,
  UNIQUE (template_id, version_number)
);

CREATE TABLE prompt_usage (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES prompt_templates(id) ON DELETE CASCADE,
  used_at TEXT NOT NULL,
  used_by TEXT,
  rendered_prompt TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER
);
```

Important indexes:

```sql
CREATE INDEX idx_task_templates_workspace ON task_templates(workspace_id, category, name);
CREATE INDEX idx_prompt_templates_workspace ON prompt_templates(workspace_id, category, name);
CREATE INDEX idx_prompt_versions_template ON prompt_versions(template_id, version_number DESC);
CREATE INDEX idx_prompt_usage_template ON prompt_usage(template_id, used_at DESC);
```

### Activity, Status History, Audit, Notifications, and Telemetry

```sql
CREATE TABLE activity_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  type TEXT NOT NULL,
  task_id TEXT,
  task_title TEXT,
  agent TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE status_history (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  task_id TEXT,
  task_title TEXT,
  sub_agent_count INTEGER,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  timestamp TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  resource TEXT,
  details_json TEXT,
  previous_hash TEXT NOT NULL,
  entry_hash TEXT NOT NULL UNIQUE
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  task_id TEXT NOT NULL,
  target_agent TEXT NOT NULL,
  from_agent TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0,
  delivered_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE thread_subscriptions (
  task_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  agent TEXT NOT NULL,
  reason TEXT NOT NULL,
  subscribed_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, task_id, agent)
);

CREATE TABLE telemetry_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  type TEXT NOT NULL,
  task_id TEXT,
  project_id TEXT,
  agent TEXT,
  model TEXT,
  attempt_id TEXT,
  success INTEGER,
  duration_ms INTEGER,
  exit_code INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_tokens INTEGER,
  total_tokens INTEGER,
  cost REAL,
  error TEXT,
  stack_trace TEXT,
  session_key TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE traces (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  attempt_id TEXT,
  task_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  retention_expires_at TEXT
);
```

Important indexes:

```sql
CREATE INDEX idx_activity_workspace_created ON activity_events(workspace_id, created_at DESC);
CREATE INDEX idx_activity_task ON activity_events(task_id, created_at DESC);
CREATE INDEX idx_status_history_created ON status_history(workspace_id, created_at DESC);
CREATE INDEX idx_audit_workspace_created ON audit_events(workspace_id, timestamp DESC);
CREATE INDEX idx_notifications_target ON notifications(workspace_id, target_agent, delivered, created_at DESC);
CREATE INDEX idx_telemetry_type_created ON telemetry_events(workspace_id, type, created_at DESC);
CREATE INDEX idx_telemetry_task_created ON telemetry_events(task_id, created_at DESC);
CREATE INDEX idx_traces_attempt ON traces(attempt_id, created_at DESC);
```

### Workflows, Runs, Policies, Decisions, and Ops Records

```sql
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  description TEXT NOT NULL,
  config_json TEXT,
  variables_json TEXT,
  schemas_json TEXT,
  definition_yaml TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  updated_by TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

CREATE TABLE workflow_agents (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  model TEXT,
  description TEXT NOT NULL,
  tools_json TEXT,
  sort_order INTEGER NOT NULL
);

CREATE TABLE workflow_steps (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  agent_id TEXT,
  input_template TEXT,
  output_json TEXT,
  config_json TEXT,
  sort_order INTEGER NOT NULL
);

CREATE TABLE workflow_acls (
  workflow_id TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
  owner TEXT NOT NULL,
  editors_json TEXT NOT NULL,
  viewers_json TEXT NOT NULL,
  executors_json TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE workflow_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  workflow_id TEXT NOT NULL,
  workflow_version INTEGER,
  action TEXT NOT NULL,
  user_id TEXT NOT NULL,
  changes_json TEXT,
  run_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  workflow_id TEXT NOT NULL,
  workflow_version INTEGER NOT NULL,
  task_id TEXT,
  status TEXT NOT NULL,
  current_step TEXT,
  context_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  last_checkpoint TEXT,
  error TEXT
);

CREATE TABLE workflow_run_steps (
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  status TEXT NOT NULL,
  agent TEXT,
  session_key TEXT,
  started_at TEXT,
  completed_at TEXT,
  duration_seconds INTEGER,
  retries INTEGER NOT NULL DEFAULT 0,
  output_path TEXT,
  error TEXT,
  loop_state_json TEXT,
  PRIMARY KEY (run_id, step_id)
);

CREATE TABLE workflow_run_outputs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content TEXT,
  storage_path TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE tool_policies (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  role TEXT NOT NULL,
  allowed_json TEXT NOT NULL,
  denied_json TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, role)
);

CREATE TABLE policy_profiles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  body TEXT NOT NULL,
  context_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  decided_at TEXT,
  deleted_at TEXT
);

CREATE TABLE broadcasts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  frontmatter_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE drift_alerts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE drift_baselines (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Important indexes:

```sql
CREATE INDEX idx_workflows_workspace ON workflows(workspace_id, name);
CREATE INDEX idx_workflow_runs_status ON workflow_runs(workspace_id, status, started_at DESC);
CREATE INDEX idx_workflow_runs_task ON workflow_runs(task_id, started_at DESC);
CREATE INDEX idx_tool_policies_role ON tool_policies(workspace_id, role);
CREATE INDEX idx_decisions_workspace ON decisions(workspace_id, status, updated_at DESC);
CREATE INDEX idx_drift_alerts_created ON drift_alerts(workspace_id, created_at DESC);
```

## Full-Text Search

SQLite FTS5 tables provide search without forcing every caller through slow JSON
or Markdown scans.

```sql
CREATE VIRTUAL TABLE task_search USING fts5(
  task_id UNINDEXED,
  workspace_id UNINDEXED,
  title,
  description,
  lessons_learned,
  content='',
  tokenize='porter unicode61'
);

CREATE VIRTUAL TABLE comment_search USING fts5(
  comment_id UNINDEXED,
  task_id UNINDEXED,
  workspace_id UNINDEXED,
  body,
  tokenize='porter unicode61'
);

CREATE VIRTUAL TABLE observation_search USING fts5(
  observation_id UNINDEXED,
  task_id UNINDEXED,
  workspace_id UNINDEXED,
  content,
  tokenize='porter unicode61'
);

CREATE VIRTUAL TABLE prompt_search USING fts5(
  prompt_id UNINDEXED,
  workspace_id UNINDEXED,
  name,
  description,
  content,
  tokenize='porter unicode61'
);

CREATE VIRTUAL TABLE docs_search USING fts5(
  doc_id UNINDEXED,
  workspace_id UNINDEXED,
  source_path,
  title,
  content,
  tokenize='porter unicode61'
);
```

Search rows are maintained by repository writes in the first implementation. SQL
triggers can be added later if repository-level maintenance becomes fragile.

## Runtime Foundation

The v5 foundation uses Node's built-in `node:sqlite` `DatabaseSync` API for the
server runtime. That keeps SQLite support dependency-free on the required Node
22.22+ runtime and avoids native package installation during local setup,
Docker builds, and CI.

Runtime settings:

| Setting               | Default                   | Purpose                                          |
| --------------------- | ------------------------- | ------------------------------------------------ |
| `VERITAS_STORAGE`     | `file`                    | Selects `file` or `sqlite` storage mode.         |
| `VERITAS_SQLITE_PATH` | `{runtimeDir}/veritas.db` | Overrides the SQLite database file location.     |
| `VERITAS_DATA_DIR`    | project/runtime default   | Controls the runtime directory used by defaults. |

SQLite mode owns database open/close, PRAGMAs, migration tracking, task
persistence, settings, managed lists, task templates, prompt registry,
activity/status history, and telemetry persistence. File storage remains the
default until the migration/import path is complete.

## Task Repository Implementation

The first SQLite task repository stores the complete shared `Task` payload as
JSON while also maintaining indexed columns for board and API access patterns:
`status`, `priority`, `type`, `project`, `sprint`, `position`, timestamps, and
storage state. This keeps all existing task fields round-trippable while later
migrations can normalize high-value child collections without losing data.

Task storage states replace filesystem moves:

| State      | Meaning                                      |
| ---------- | -------------------------------------------- |
| `active`   | Visible on the active board.                 |
| `archived` | Hidden from active lists, restorable later.  |
| `backlog`  | Reserved for the backlog provider migration. |

`task_search` is maintained by SQLite repository writes so title/description
search can use FTS5 in SQLite mode.

## Configuration Repository Implementation

The first settings and registry repository pass uses JSON document tables with
indexed metadata columns. This keeps v4 payloads lossless while the later
multi-user work normalizes repositories, agents, integrations, and template
children into the broader target schema above.

| Runtime table          | Stored data                                                                  |
| ---------------------- | ---------------------------------------------------------------------------- |
| `app_config_documents` | Full `AppConfig` document keyed by `app_config`, with default feature merge. |
| `managed_list_items`   | Projects, sprints, task types, and other managed lists by `list_name`.       |
| `task_templates`       | Complete `TaskTemplate` JSON plus name/category index columns.               |
| `prompt_templates`     | Complete `PromptTemplate` JSON plus category/current-version columns.        |
| `prompt_versions`      | Version snapshots for prompt template content and changelogs.                |
| `prompt_usage`         | Usage records for prompt stats, token averages, and last-used timestamps.    |

`ConfigService`, `ManagedListService`, `TemplateService`, and
`PromptRegistryService` select these SQLite repositories when
`VERITAS_STORAGE=sqlite`, so the existing REST/UI routes continue to use the
same service contracts in both storage modes. File-backed behavior remains
unchanged when `VERITAS_STORAGE=file`.

## Operational Repository Implementation

The first operational repository pass moves append-heavy runtime data into
SQLite tables with JSON payload columns plus query indexes. This keeps the v4
service contracts intact while preventing SQLite mode from writing operational
state back to `.veritas-kanban/*.json` or telemetry NDJSON files.

| Runtime table      | Stored data                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `activity_events`  | Complete activity entries plus type, task, agent, and created-time columns.              |
| `status_history`   | Complete status transition entries plus previous/new status and task columns.            |
| `telemetry_events` | Complete telemetry events plus type, task, project, token, duration, and result columns. |

`ActivityService`, `StatusHistoryService`, and `TelemetryService` select these
SQLite repositories when `VERITAS_STORAGE=sqlite`. File storage still forces the
file-backed services to `storageType='file'`, so explicit file mode cannot be
accidentally flipped by the environment.

Dashboard metric aggregation uses the same active storage backend. In SQLite
mode, `/metrics/all`, `/metrics/trends`, agent comparison, task cost, and
utilization aggregations read `telemetry_events` directly instead of walking
telemetry NDJSON files.

## Governance Repository Implementation

The first governance repository pass moves JSON-backed decisions, feedback,
scoring, and drift data into SQLite document tables with indexed query columns.
The domain services keep their existing APIs, validation, and analytics logic;
only the persistence backend switches when `VERITAS_STORAGE=sqlite`.

| Runtime table         | Stored data                                                                            |
| --------------------- | -------------------------------------------------------------------------------------- |
| `decision_records`    | Complete `DecisionRecord` JSON plus agent, task, parent, confidence, and risk columns. |
| `feedback_records`    | Complete `Feedback` JSON plus task, agent, rating, sentiment, and resolved columns.    |
| `scoring_profiles`    | Complete `ScoringProfile` JSON plus name and built-in metadata.                        |
| `scoring_evaluations` | Complete `EvaluationResult` JSON plus profile, agent, task, and score columns.         |
| `drift_alerts`        | Complete `DriftAlert` JSON plus agent, metric, severity, and acknowledged columns.     |
| `drift_baselines`     | Complete `DriftBaseline` JSON plus agent and metric columns.                           |

## Audit And Policy Repository Implementation

The audit/policy repository pass moves immutable audit log entries, governance
policies, and role-based tool policies into SQLite when `VERITAS_STORAGE=sqlite`.
Audit entries retain the existing SHA-256 hash chain semantics; policy services
keep the same validation, preset seeding, and evaluation behavior.

| Runtime table    | Stored data                                                                       |
| ---------------- | --------------------------------------------------------------------------------- |
| `audit_entries`  | Complete audit entry JSON plus action, actor, resource, integrity, and timestamp. |
| `agent_policies` | Complete `AgentPolicy` JSON plus name, type, enabled, response, and preset data.  |
| `tool_policies`  | Complete `ToolPolicy` JSON plus role and indexed allow/deny JSON columns.         |

## Workflow Repository Implementation

Workflow definitions, ACLs, audit events, run state, and workflow snapshots move
into SQLite when `VERITAS_STORAGE=sqlite`. The workflow execution engine keeps
its existing state machine and retry/block/resume behavior; SQLite replaces the
YAML and `run.json` persistence layer while retaining file mode as the default.

| Runtime table           | Stored data                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `workflow_definitions`  | Complete `WorkflowDefinition` JSON plus name, version, and description columns.      |
| `workflow_acls`         | Complete `WorkflowACL` JSON keyed by workflow.                                       |
| `workflow_audit_events` | Complete workflow audit event JSON plus workflow, action, user, and timestamp data.  |
| `workflow_runs`         | Complete `WorkflowRun` JSON plus status, task, checkpoint, error, and snapshot JSON. |

## Chat Repository Implementation

Chat sessions, task chat messages, and squad messages move into SQLite when
`VERITAS_STORAGE=sqlite`. File mode remains the default and keeps the current
Markdown format for existing local projects.

| Runtime table    | Stored data                                                                     |
| ---------------- | ------------------------------------------------------------------------------- |
| `chat_sessions`  | Board and task chat session metadata, scoped by task when present.              |
| `chat_messages`  | Individual chat messages with session, task, role, agent, model, and timestamp. |
| `squad_messages` | Squad channel messages with agent, system/event flags, tags, cards, and timing. |

## Notification Repository Implementation

Notification inbox records and thread subscriptions move into SQLite when
`VERITAS_STORAGE=sqlite`. The notification service keeps the same mention,
assignment, delivery, and subscription behavior while replacing
`notifications.json` and `thread-subscriptions.json` in SQLite mode.

| Runtime table          | Stored data                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `notifications`        | Complete notification JSON plus task, target, source, type, read state, target URL, and dedupe key. |
| `thread_subscriptions` | Complete subscription JSON keyed by workspace, task, and subscribed agent.                          |

## Task Artifact Metadata Implementation

Task attachments and task deliverables keep their full JSON inside `tasks` for
API parity, and SQLite mode mirrors high-value metadata into child tables during
the same repository transaction. Attachments store validation, size, hash,
retention, workspace, session, and cleanup fields while leaving binary blobs on
disk. Deliverables store typed artifact metadata, source run/model provenance,
redaction hints, and a current version number for task detail, timeline,
completion packet, dashboard, and migration queries.

| Runtime table       | Stored data                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `task_attachments`  | File metadata, MIME validation result, hash/path, owner/session, retention, and cleanup data. |
| `task_deliverables` | Typed work-product metadata, source run/model, redaction hints, and full deliverable JSON.    |

## Scheduled Deliverable Repository Implementation

Scheduled deliverables and recurring run history move into SQLite when
`VERITAS_STORAGE=sqlite`. Run rows keep stable output snapshots separate from
live workflow execution state so dashboards and completion packets can read
bounded historical results without traversing workflow-run directories.

| Runtime table                | Stored data                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `scheduled_deliverables`     | Complete scheduled deliverable JSON plus schedule, agent, output path, tags, and next run.   |
| `scheduled_deliverable_runs` | Complete run JSON plus source workflow/run IDs, status, output, duration, and snapshot JSON. |

## Migration Numbering

Migrations live under the future SQLite package as paired SQL files:

```text
server/src/storage/sqlite/migrations/
  0001_initial_schema.up.sql
  0001_initial_schema.down.sql
  0002_seed_local_workspace.up.sql
  0002_seed_local_workspace.down.sql
```

Rules:

1. Use four-digit, monotonic numbers.
2. Never edit a migration after it has shipped in a tagged release.
3. Each migration has an `up` and `down` file unless it is explicitly marked
   irreversible in code and release notes.
4. Store the normalized SQL checksum in `schema_migrations`.
5. Apply migrations inside a transaction where SQLite allows it.
6. Migration code must set `PRAGMA foreign_keys=ON`,
   `PRAGMA journal_mode=WAL`, and `PRAGMA busy_timeout=5000` for app
   connections.

## Rollback Policy

Rollback is safety-first because v5 upgrades existing file-backed projects.

1. Before file-to-SQLite migration, create a timestamped copy of `tasks/`,
   `.veritas-kanban/`, `workflows`, `storage`, and `prompt-registry`.
2. Do not delete source files during the first successful migration. Mark them as
   migrated in a manifest and keep them for rollback/export until the user
   explicitly cleans them up.
3. If any import step fails, rollback the SQLite transaction, keep the backup,
   write a migration report, and leave the app on file storage.
4. If a shipped schema migration fails after v5 adoption, stop startup before
   mutating data further and show the failed migration version.
5. `down` migrations may be used during development and pre-GA testing. For GA
   user rollback, prefer restoring the pre-upgrade backup over destructive
   in-place downgrades.
6. Any migration that changes sensitive fields must prove redaction behavior in
   the migration report.

## File-Backed Parity Matrix

| Current source                                   | SQLite destination                                                                     | Notes                                                                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `tasks/active/*.md`                              | `tasks`, task detail tables, `task_search`                                             | Preserve task IDs, created/updated timestamps, frontmatter, Markdown description, and file path in `migrated_from_path`. |
| `tasks/archive/*.md`                             | `tasks.archived_at`, task detail tables                                                | Archive status must remain restorable.                                                                                   |
| `tasks/backlog/*.md`                             | `tasks.status` or backlog marker in `tasks`                                            | If backlog remains distinct, model it as a status or queue field before provider work.                                   |
| `tasks/attachments/*`                            | `task_attachments` plus file blobs on disk                                             | v5 stores attachment metadata in SQLite, not binary blobs.                                                               |
| `.veritas-kanban/config.json`                    | `app_settings`, `repositories`, `agent_configs`, `agent_routing_rules`, `integrations` | Split security-sensitive integration secrets into `secret_refs_json`.                                                    |
| `.veritas-kanban/activity.json`                  | `activity_events`                                                                      | Existing newest-first array becomes append/query table.                                                                  |
| `.veritas-kanban/agent-status.json`              | `app_settings` and `status_history`                                                    | Current status can be a setting; transitions remain history records.                                                     |
| `.veritas-kanban/agent-registry.json`            | future `agent_registry` table or `app_settings` namespace                              | Prefer a dedicated table when #413 pipeline modeling lands.                                                              |
| `.veritas-kanban/notifications.json`             | `notifications`                                                                        | Preserve delivered state and timestamps.                                                                                 |
| `.veritas-kanban/thread-subscriptions.json`      | `thread_subscriptions`                                                                 | Preserve task-agent subscription uniqueness.                                                                             |
| `.veritas-kanban/projects.json`                  | `managed_lists(kind='project')`                                                        | Map description and color columns.                                                                                       |
| `.veritas-kanban/sprints.json`                   | `managed_lists(kind='sprint')`                                                         | Map description and order.                                                                                               |
| `.veritas-kanban/task-types.json`                | `managed_lists(kind='task_type')`                                                      | Map icon and color.                                                                                                      |
| `.veritas-kanban/templates/*.md`                 | `task_templates`, template child tables                                                | Preserve YAML frontmatter data.                                                                                          |
| `.veritas-kanban/prompt-templates/*.md`          | `prompt_templates`, `prompt_search`                                                    | Preserve content and variables.                                                                                          |
| `.veritas-kanban/prompt-versions/*.md`           | `prompt_versions`                                                                      | Preserve version numbers and changelogs.                                                                                 |
| `.veritas-kanban/prompt-usage/*.json`            | `prompt_usage`                                                                         | Rendered prompts may contain sensitive task context.                                                                     |
| `.veritas-kanban/workflows/*.yml`                | `workflows`, `workflow_agents`, `workflow_steps`                                       | Store original YAML in `definition_yaml` for round-trip export.                                                          |
| `.veritas-kanban/workflows/.acl.json`            | `workflow_acls`                                                                        | Preserve owner/editor/viewer/executor lists.                                                                             |
| `.veritas-kanban/workflows/.audit.jsonl`         | `workflow_audit_events`                                                                | Append-only history remains ordered by import sequence and timestamp.                                                    |
| `.veritas-kanban/workflow-runs/*/run.json`       | `workflow_runs`, `workflow_run_steps`                                                  | Preserve context JSON and step state.                                                                                    |
| `.veritas-kanban/workflow-runs/*/progress.md`    | `workflow_run_outputs` or retained file path                                           | Store text content when reasonably sized; otherwise keep file path.                                                      |
| `.veritas-kanban/workflow-runs/*/step-outputs/*` | `workflow_run_outputs`                                                                 | Preserve output filename and content type.                                                                               |
| `.veritas-kanban/tool-policies/*.json`           | `tool_policies`                                                                        | Role remains the natural unique key per workspace.                                                                       |
| `.veritas-kanban/storage/policies/*.json`        | `policy_profiles`                                                                      | Keep full rules JSON until policy schema is formalized.                                                                  |
| `.veritas-kanban/storage/drift/alerts/*`         | `drift_alerts`                                                                         | Preserve raw payload.                                                                                                    |
| `.veritas-kanban/storage/drift/baselines/*`      | `drift_baselines`                                                                      | Preserve raw payload.                                                                                                    |
| `.veritas-kanban/telemetry/*.ndjson*`            | `telemetry_events`                                                                     | Import gzip and plain NDJSON; preserve event IDs when present.                                                           |
| `.veritas-kanban/traces/*.json`                  | `traces`                                                                               | Apply retention and redaction rules.                                                                                     |
| `.veritas-kanban/audit/audit-*.log`              | `audit_events`                                                                         | Preserve hash-chain fields and recompute `entry_hash` on import.                                                         |
| `.veritas-kanban/broadcasts/*.md`                | `broadcasts`                                                                           | Preserve frontmatter and Markdown body.                                                                                  |
| `storage/decisions/*`                            | `decisions`                                                                            | Preserve decision content and status.                                                                                    |
| `storage/scoring/*` and `storage/evaluations/*`  | future scoring tables or `app_settings` namespace                                      | Not in the first repository parity slice unless scoring endpoints are moved to storage abstraction.                      |
| `docs/`, `prompt-registry/*.md`                  | `docs_search` and seed data                                                            | Do not make repo docs mutable app data unless user-created docs are imported later.                                      |

## Security and Redaction Requirements

| Field or domain                   | Requirement                                                                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| API tokens                        | Store only hashes in `api_tokens.token_hash`. Never persist plaintext tokens.                                                            |
| Webhook URLs and secrets          | Store secrets in keychain/native secret storage where available; SQLite stores only references or redacted config.                       |
| Coolify/OpenPanel/n8n/API keys    | Move secret values out of `config_json` into secret references before remote mode ships.                                                 |
| OpenClaw gateway token            | Treat as a secret ref. Do not expose in logs, search indexes, telemetry, or exports.                                                     |
| Agent command args                | Store as config but redact known token-like values in diagnostics and migration reports.                                                 |
| Prompt usage rendered text        | Store for audit only when enabled. Exclude from default export and mark as sensitive content.                                            |
| Telemetry errors and stack traces | Redact tokens, Authorization headers, cookies, filesystem secrets, and private keys before insert.                                       |
| Task attachments                  | Store metadata in SQLite and files on disk. Validate MIME type and retain size/hash metadata.                                            |
| Audit events                      | Preserve append-only semantics. Updates are not allowed; correction requires a new event.                                                |
| FTS tables                        | Index user-visible task/comment/observation/prompt/doc text only. Do not index secrets, tokens, stack traces, or raw integration config. |
| Backups                           | Backup files and SQLite database together. Encrypt/sign release backups when the desktop app adds keychain support.                      |

## Multi-User Readiness

The first SQLite implementation remains single-user by default, but every table
that stores user data includes `workspace_id` or is reachable through a
workspace-owned parent. Actor columns are nullable during the file migration but
must be populated by new writes once the multi-user layer lands.

The seed migration creates:

```text
workspace: local
user: local-user
membership: local-user owner of local
```

This lets #334-#338 add identity, membership, RBAC, scoped API tokens, and
workspace screens without destructive schema rewrites.

## Implementation Sequence

1. Add the SQLite package, migration runner, connection lifecycle, and seed
   migrations.
2. Implement TaskRepository parity against this schema.
3. Move settings, managed lists, templates, and prompt registry repositories.
4. Move telemetry, activity, audit, workflow, chat, notification, attachment
   metadata, and task deliverable metadata repositories.
5. Add file-to-database migration, Markdown export/import, and rollback drills.
6. Turn on SQLite as the default storage backend for fresh v5 installs after
   parity and migration tests pass.

## Open Decisions for Follow-Up Issues

1. Whether backlog remains a distinct queue or becomes a task status.
2. Whether scoring/evaluation records need first-class tables in v5.0 or can
   remain JSON-backed until the scoring model settles.
3. Whether workflow run output content should be fully in SQLite or retained as
   files with metadata rows for large artifacts.
4. Whether prompt rendered output storage should default off for privacy.

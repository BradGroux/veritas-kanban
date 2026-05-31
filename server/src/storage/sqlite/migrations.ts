export interface SqliteMigration {
  version: number;
  name: string;
  up: string;
}

export const SQLITE_BASE_MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    name: '0001_initial_workspace_foundation',
    up: `
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        email TEXT UNIQUE,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS workspace_memberships (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        PRIMARY KEY (workspace_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_workspace_memberships_user_id
        ON workspace_memberships(user_id);
    `,
  },
  {
    version: 2,
    name: '0002_seed_local_workspace',
    up: `
      INSERT OR IGNORE INTO workspaces (id, slug, name, description)
      VALUES (
        'local',
        'local',
        'Local Workspace',
        'Default local workspace used for v5 migration and single-user mode.'
      );

      INSERT OR IGNORE INTO users (id, display_name, email)
      VALUES ('local-user', 'Local User', NULL);

      INSERT OR IGNORE INTO workspace_memberships (workspace_id, user_id, role)
      VALUES ('local', 'local-user', 'owner');
    `,
  },
  {
    version: 3,
    name: '0003_task_repository_foundation',
    up: `
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        storage_state TEXT NOT NULL DEFAULT 'active'
          CHECK (storage_state IN ('active', 'archived', 'backlog')),
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        project TEXT,
        sprint TEXT,
        position INTEGER,
        task_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT,
        deleted_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_workspace_state_updated
        ON tasks(workspace_id, storage_state, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_tasks_status_position
        ON tasks(status, position);

      CREATE INDEX IF NOT EXISTS idx_tasks_project
        ON tasks(project);

      CREATE INDEX IF NOT EXISTS idx_tasks_sprint
        ON tasks(sprint);

      CREATE VIRTUAL TABLE IF NOT EXISTS task_search USING fts5(
        task_id UNINDEXED,
        title,
        description,
        tokenize='porter unicode61'
      );
    `,
  },
  {
    version: 4,
    name: '0004_configuration_repositories',
    up: `
      CREATE TABLE IF NOT EXISTS app_config_documents (
        key TEXT PRIMARY KEY,
        document_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS managed_list_items (
        list_name TEXT NOT NULL,
        item_id TEXT NOT NULL,
        item_json TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        is_hidden INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (list_name, item_id)
      );

      CREATE INDEX IF NOT EXISTS idx_managed_list_items_order
        ON managed_list_items(list_name, order_index);

      CREATE TABLE IF NOT EXISTS task_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT,
        template_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_task_templates_name
        ON task_templates(name);

      CREATE TABLE IF NOT EXISTS prompt_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        current_version_id TEXT NOT NULL,
        template_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_prompt_templates_category_name
        ON prompt_templates(category, name);

      CREATE TABLE IF NOT EXISTS prompt_versions (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        version_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (template_id, version_number)
      );

      CREATE INDEX IF NOT EXISTS idx_prompt_versions_template
        ON prompt_versions(template_id, version_number DESC);

      CREATE TABLE IF NOT EXISTS prompt_usage (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL,
        used_at TEXT NOT NULL,
        used_by TEXT,
        model TEXT,
        usage_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_prompt_usage_template_used
        ON prompt_usage(template_id, used_at);
    `,
  },
  {
    version: 5,
    name: '0005_operational_repositories',
    up: `
      CREATE TABLE IF NOT EXISTS activity_events (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        task_id TEXT,
        task_title TEXT,
        agent TEXT,
        details_json TEXT,
        activity_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_activity_workspace_created
        ON activity_events(workspace_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_activity_task_created
        ON activity_events(task_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_activity_type_created
        ON activity_events(type, created_at DESC);

      CREATE TABLE IF NOT EXISTS status_history (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        previous_status TEXT NOT NULL,
        new_status TEXT NOT NULL,
        task_id TEXT,
        task_title TEXT,
        sub_agent_count INTEGER,
        duration_ms INTEGER,
        entry_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_status_history_workspace_created
        ON status_history(workspace_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_status_history_task_created
        ON status_history(task_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS telemetry_events (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
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
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_telemetry_workspace_created
        ON telemetry_events(workspace_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_telemetry_type_created
        ON telemetry_events(workspace_id, type, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_telemetry_task_created
        ON telemetry_events(task_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_telemetry_project_created
        ON telemetry_events(project_id, created_at DESC);
    `,
  },
];

export function sortedMigrations(migrations: readonly SqliteMigration[]): SqliteMigration[] {
  return [...migrations].sort((a, b) => a.version - b.version);
}

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
  {
    version: 6,
    name: '0006_governance_repositories',
    up: `
      CREATE TABLE IF NOT EXISTS decision_records (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        agent_id TEXT,
        task_id TEXT,
        parent_decision_id TEXT,
        confidence_level REAL NOT NULL,
        risk_score REAL NOT NULL,
        decision_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_decision_records_workspace_created
        ON decision_records(workspace_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_decision_records_agent_created
        ON decision_records(agent_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_decision_records_task_created
        ON decision_records(task_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS feedback_records (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        agent TEXT,
        rating INTEGER NOT NULL,
        sentiment TEXT NOT NULL,
        resolved INTEGER NOT NULL DEFAULT 0,
        categories_json TEXT NOT NULL,
        feedback_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_feedback_records_workspace_created
        ON feedback_records(workspace_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_feedback_records_task_created
        ON feedback_records(task_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_feedback_records_agent_created
        ON feedback_records(agent, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_feedback_records_sentiment_created
        ON feedback_records(sentiment, created_at DESC);

      CREATE TABLE IF NOT EXISTS scoring_profiles (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        built_in INTEGER NOT NULL DEFAULT 0,
        profile_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scoring_profiles_workspace_name
        ON scoring_profiles(workspace_id, name);

      CREATE TABLE IF NOT EXISTS scoring_evaluations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL,
        agent TEXT,
        task_id TEXT,
        composite_score REAL NOT NULL,
        evaluation_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scoring_evaluations_profile_created
        ON scoring_evaluations(profile_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_scoring_evaluations_agent_created
        ON scoring_evaluations(agent, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_scoring_evaluations_task_created
        ON scoring_evaluations(task_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS drift_alerts (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        metric TEXT NOT NULL,
        severity TEXT NOT NULL,
        acknowledged INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_drift_alerts_workspace_created
        ON drift_alerts(workspace_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_drift_alerts_agent_created
        ON drift_alerts(agent_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_drift_alerts_metric_created
        ON drift_alerts(metric, created_at DESC);

      CREATE TABLE IF NOT EXISTS drift_baselines (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        metric TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (workspace_id, agent_id, metric)
      );

      CREATE INDEX IF NOT EXISTS idx_drift_baselines_agent_metric
        ON drift_baselines(agent_id, metric);
    `,
  },
  {
    version: 7,
    name: '0007_audit_policy_repositories',
    up: `
      CREATE TABLE IF NOT EXISTS audit_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        resource TEXT,
        integrity TEXT NOT NULL,
        entry_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_entries_workspace_created
        ON audit_entries(workspace_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_audit_entries_actor_created
        ON audit_entries(actor, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_audit_entries_action_created
        ON audit_entries(action, created_at DESC);

      CREATE TABLE IF NOT EXISTS agent_policies (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        response_action TEXT NOT NULL,
        preset TEXT,
        policy_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agent_policies_workspace_name
        ON agent_policies(workspace_id, name);

      CREATE INDEX IF NOT EXISTS idx_agent_policies_type_enabled
        ON agent_policies(type, enabled);

      CREATE TABLE IF NOT EXISTS tool_policies (
        role TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        allowed_json TEXT NOT NULL,
        denied_json TEXT NOT NULL,
        policy_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tool_policies_workspace_role
        ON tool_policies(workspace_id, role);
    `,
  },
  {
    version: 8,
    name: '0008_workflow_repositories',
    up: `
      CREATE TABLE IF NOT EXISTS workflow_definitions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        version INTEGER NOT NULL,
        description TEXT,
        workflow_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_definitions_workspace_name
        ON workflow_definitions(workspace_id, name);

      CREATE TABLE IF NOT EXISTS workflow_acls (
        workflow_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        acl_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workflow_audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        workflow_id TEXT NOT NULL,
        action TEXT NOT NULL,
        user_id TEXT NOT NULL,
        event_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_audit_events_workflow_created
        ON workflow_audit_events(workflow_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        workflow_id TEXT NOT NULL,
        workflow_version INTEGER NOT NULL,
        task_id TEXT,
        status TEXT NOT NULL,
        current_step TEXT,
        run_json TEXT NOT NULL,
        workflow_snapshot_json TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        last_checkpoint TEXT,
        error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_runs_workspace_started
        ON workflow_runs(workspace_id, started_at DESC);

      CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_started
        ON workflow_runs(workflow_id, started_at DESC);

      CREATE INDEX IF NOT EXISTS idx_workflow_runs_task_started
        ON workflow_runs(task_id, started_at DESC);

      CREATE INDEX IF NOT EXISTS idx_workflow_runs_status_started
        ON workflow_runs(status, started_at DESC);
    `,
  },
  {
    version: 9,
    name: '0009_chat_repositories',
    up: `
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        task_id TEXT,
        title TEXT NOT NULL,
        agent TEXT NOT NULL,
        model TEXT,
        mode TEXT NOT NULL,
        session_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_sessions_task
        ON chat_sessions(task_id)
        WHERE task_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_chat_sessions_workspace_updated
        ON chat_sessions(workspace_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        task_id TEXT,
        role TEXT NOT NULL,
        agent TEXT,
        model TEXT,
        message_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created
        ON chat_messages(session_id, created_at ASC);

      CREATE INDEX IF NOT EXISTS idx_chat_messages_task_created
        ON chat_messages(task_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS squad_messages (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        agent TEXT NOT NULL,
        display_name TEXT,
        message TEXT NOT NULL,
        tags_json TEXT,
        timestamp TEXT NOT NULL,
        model TEXT,
        is_system INTEGER NOT NULL DEFAULT 0,
        event TEXT,
        task_title TEXT,
        duration TEXT,
        card_json TEXT,
        message_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_squad_messages_workspace_timestamp
        ON squad_messages(workspace_id, timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_squad_messages_agent_timestamp
        ON squad_messages(agent, timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_squad_messages_event_timestamp
        ON squad_messages(event, timestamp DESC);
    `,
  },
  {
    version: 10,
    name: '0010_notification_repositories',
    up: `
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        target_agent TEXT NOT NULL,
        from_agent TEXT NOT NULL,
        type TEXT NOT NULL,
        delivered INTEGER NOT NULL DEFAULT 0,
        delivered_at TEXT,
        content TEXT NOT NULL,
        title TEXT,
        task_title TEXT,
        project TEXT,
        target_url TEXT,
        dedupe_key TEXT,
        source_json TEXT,
        notification_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_notifications_agent_delivered_created
        ON notifications(target_agent, delivered, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_notifications_task_created
        ON notifications(task_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_notifications_type_created
        ON notifications(type, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_notifications_dedupe_key
        ON notifications(dedupe_key)
        WHERE dedupe_key IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_notifications_project_created
        ON notifications(project, created_at DESC)
        WHERE project IS NOT NULL;

      CREATE TABLE IF NOT EXISTS thread_subscriptions (
        task_id TEXT NOT NULL,
        agent TEXT NOT NULL,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        reason TEXT NOT NULL,
        subscription_json TEXT NOT NULL,
        subscribed_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, task_id, agent)
      );

      CREATE INDEX IF NOT EXISTS idx_thread_subscriptions_task
        ON thread_subscriptions(task_id, agent);
    `,
  },
  {
    version: 11,
    name: '0011_scheduled_deliverable_repositories',
    up: `
      CREATE TABLE IF NOT EXISTS scheduled_deliverables (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        schedule TEXT NOT NULL,
        cron_expr TEXT,
        schedule_description TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        agent TEXT,
        output_path TEXT,
        tags_json TEXT NOT NULL,
        deliverable_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_run_at TEXT,
        next_run_at TEXT,
        total_runs INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_scheduled_deliverables_enabled_next_run
        ON scheduled_deliverables(enabled, next_run_at);

      CREATE INDEX IF NOT EXISTS idx_scheduled_deliverables_agent_enabled
        ON scheduled_deliverables(agent, enabled);

      CREATE TABLE IF NOT EXISTS scheduled_deliverable_runs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        deliverable_id TEXT NOT NULL,
        status TEXT NOT NULL,
        output_file TEXT,
        summary TEXT,
        duration_ms INTEGER,
        error TEXT,
        source_run_id TEXT,
        workflow_id TEXT,
        snapshot_json TEXT,
        run_json TEXT NOT NULL,
        run_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scheduled_deliverable_runs_deliverable_run
        ON scheduled_deliverable_runs(deliverable_id, run_at DESC);

      CREATE INDEX IF NOT EXISTS idx_scheduled_deliverable_runs_status_run
        ON scheduled_deliverable_runs(status, run_at DESC);

      CREATE INDEX IF NOT EXISTS idx_scheduled_deliverable_runs_source_run
        ON scheduled_deliverable_runs(source_run_id)
        WHERE source_run_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_scheduled_deliverable_runs_workflow_run
        ON scheduled_deliverable_runs(workflow_id, run_at DESC)
        WHERE workflow_id IS NOT NULL;
    `,
  },
  {
    version: 12,
    name: '0012_task_artifact_metadata',
    up: `
      CREATE TABLE IF NOT EXISTS task_attachments (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
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

      CREATE INDEX IF NOT EXISTS idx_task_attachments_task_uploaded
        ON task_attachments(task_id, uploaded_at DESC);

      CREATE INDEX IF NOT EXISTS idx_task_attachments_workspace_cleanup
        ON task_attachments(workspace_id, cleanup_eligible, uploaded_at DESC)
        WHERE deleted_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_task_attachments_mime_uploaded
        ON task_attachments(workspace_id, mime_type, uploaded_at DESC)
        WHERE deleted_at IS NULL;

      CREATE TABLE IF NOT EXISTS task_deliverables (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
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

      CREATE INDEX IF NOT EXISTS idx_task_deliverables_task_created
        ON task_deliverables(task_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_task_deliverables_workspace_type_status
        ON task_deliverables(workspace_id, type, status, created_at DESC)
        WHERE deleted_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_task_deliverables_agent_created
        ON task_deliverables(agent, created_at DESC)
        WHERE agent IS NOT NULL AND deleted_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_task_deliverables_source_run
        ON task_deliverables(source_run_id)
        WHERE source_run_id IS NOT NULL;
    `,
  },
  {
    version: 13,
    name: '0013_work_product_repositories',
    up: `
      CREATE TABLE IF NOT EXISTS work_products (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'archived')),
        task_id TEXT,
        source_run_id TEXT,
        agent TEXT,
        model TEXT,
        version_number INTEGER NOT NULL DEFAULT 1,
        redaction_json TEXT,
        source_links_json TEXT,
        metadata_json TEXT,
        render_json TEXT NOT NULL,
        product_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT,
        deleted_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_work_products_workspace_updated
        ON work_products(workspace_id, updated_at DESC)
        WHERE deleted_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_work_products_task_updated
        ON work_products(task_id, updated_at DESC)
        WHERE task_id IS NOT NULL AND deleted_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_work_products_source_run
        ON work_products(source_run_id, updated_at DESC)
        WHERE source_run_id IS NOT NULL AND deleted_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_work_products_kind_status
        ON work_products(workspace_id, kind, status, updated_at DESC)
        WHERE deleted_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_work_products_agent_updated
        ON work_products(agent, updated_at DESC)
        WHERE agent IS NOT NULL AND deleted_at IS NULL;

      CREATE TABLE IF NOT EXISTS work_product_versions (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES work_products(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL DEFAULT 'local'
          REFERENCES workspaces(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        change_type TEXT NOT NULL,
        change_summary TEXT,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        agent TEXT,
        model TEXT,
        redaction_json TEXT,
        render_json TEXT NOT NULL,
        version_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (product_id, version_number)
      );

      CREATE INDEX IF NOT EXISTS idx_work_product_versions_product
        ON work_product_versions(product_id, version_number DESC);

      CREATE INDEX IF NOT EXISTS idx_work_product_versions_workspace_created
        ON work_product_versions(workspace_id, created_at DESC);

      CREATE VIRTUAL TABLE IF NOT EXISTS work_product_search USING fts5(
        product_id UNINDEXED,
        title,
        body,
        tokenize='porter unicode61'
      );
    `,
  },
];

export function sortedMigrations(migrations: readonly SqliteMigration[]): SqliteMigration[] {
  return [...migrations].sort((a, b) => a.version - b.version);
}

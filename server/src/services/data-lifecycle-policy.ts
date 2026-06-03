export type DataLifecycleClassId =
  | 'workspaceIdentity'
  | 'tasks'
  | 'comments'
  | 'uploadsAttachments'
  | 'workProducts'
  | 'telemetry'
  | 'workflowRuns'
  | 'notifications'
  | 'chat'
  | 'audit'
  | 'deviceAccess'
  | 'configuration'
  | 'backupsExports'
  | 'debugBundles';

export interface DataLifecyclePolicy {
  id: DataLifecycleClassId;
  label: string;
  description: string;
  tables: string[];
  defaultRetention: string;
  userControls: string[];
  adminControls: string[];
  exportBehavior: string;
  deleteBehavior: string;
  auditBehavior: string;
  redaction: string;
  containsSecrets: boolean;
  containsPrivatePaths: boolean;
  containsGeneratedContent: boolean;
  workspaceScoped: boolean;
  previewSafety: string;
}

export interface DataLifecycleManifestEntry {
  id: DataLifecycleClassId;
  label: string;
  tables: string[];
  rowCount: number;
  defaultRetention: string;
  exportBehavior: string;
  deleteBehavior: string;
  redaction: string;
  containsSecrets: boolean;
  containsPrivatePaths: boolean;
  containsGeneratedContent: boolean;
  workspaceScoped: boolean;
}

export interface DataLifecycleManifestOptions {
  workspaceId?: string;
  tableCounts: Record<string, number>;
}

export const DATA_LIFECYCLE_POLICIES: readonly DataLifecyclePolicy[] = [
  {
    id: 'workspaceIdentity',
    label: 'Workspace identity and membership',
    description: 'Users, workspaces, memberships, invitations, roles, and actor identity.',
    tables: ['workspaces', 'users', 'workspace_memberships', 'workspace_invitations'],
    defaultRetention: 'Retained until the workspace, user, or invitation is removed by an admin.',
    userControls: ['View own identity where exposed by the UI.'],
    adminControls: ['Manage members, roles, invitations, disabled users, and workspace archival.'],
    exportBehavior:
      'Included in full exports. Workspace-scoped exports include the selected workspace, memberships, invitations, and member user records only.',
    deleteBehavior:
      'Workspace deletion must cascade through workspace-scoped operational data and preserve audit expectations.',
    auditBehavior:
      'Role, membership, and invitation changes should emit actor-aware audit records.',
    redaction:
      'Email and handle values are included in admin exports but must be redacted in support bundles.',
    containsSecrets: false,
    containsPrivatePaths: false,
    containsGeneratedContent: false,
    workspaceScoped: true,
    previewSafety: 'Show names, roles, status, and counts before destructive changes.',
  },
  {
    id: 'tasks',
    label: 'Tasks and task metadata',
    description:
      'Active, archived, and backlog tasks plus subtasks, dependencies, criteria, and task fields.',
    tables: ['tasks'],
    defaultRetention:
      'Active and backlog tasks are retained until archived or deleted; archived tasks are retained until cleanup.',
    userControls: ['Archive, restore, export, and delete task records where permissions allow.'],
    adminControls: ['Bulk archive, workspace export, workspace deletion, and retention previews.'],
    exportBehavior: 'Included in full and workspace-scoped exports.',
    deleteBehavior:
      'Deletes must not remove active work silently and must show linked artifact counts first.',
    auditBehavior:
      'Create, update, archive, restore, and delete actions should carry actor attribution.',
    redaction:
      'Task text can include private prompts, paths, and generated content; redact in support bundles.',
    containsSecrets: false,
    containsPrivatePaths: true,
    containsGeneratedContent: true,
    workspaceScoped: true,
    previewSafety: 'Preview task status, title, linked worktrees, attachments, and work products.',
  },
  {
    id: 'comments',
    label: 'Task comments and discussion',
    description: 'Comments embedded in task payloads and review discussion tied to task work.',
    tables: ['tasks'],
    defaultRetention: 'Follows parent task retention.',
    userControls: ['Edit or delete comments where the task UI supports it.'],
    adminControls: ['Export and delete through parent task/workspace operations.'],
    exportBehavior: 'Included with task JSON and Markdown task exports.',
    deleteBehavior: 'Follows parent task deletion unless a future comment-level delete is used.',
    auditBehavior: 'Comment mutation should remain attributable where actor data exists.',
    redaction:
      'Comment text is user content and must be redacted in diagnostics/support bundles by default.',
    containsSecrets: false,
    containsPrivatePaths: true,
    containsGeneratedContent: true,
    workspaceScoped: true,
    previewSafety: 'Show counts and parent task links, not full comment text, in cleanup previews.',
  },
  {
    id: 'uploadsAttachments',
    label: 'Uploads and attachment metadata',
    description:
      'Attachment rows, file metadata, MIME validation status, storage paths, and cleanup state.',
    tables: ['task_attachments'],
    defaultRetention:
      'Retained while linked to an active or archived task unless marked cleanup-eligible.',
    userControls: ['Download and delete attachments from task context where permissions allow.'],
    adminControls: ['Storage usage review, orphan detection, and cleanup preview.'],
    exportBehavior:
      'Metadata is included in SQLite exports; file blobs require explicit backup/import handling.',
    deleteBehavior:
      'Delete only after previewing parent task, path, size, validation status, and orphan status.',
    auditBehavior: 'Upload and delete actions should be auditable when actor data exists.',
    redaction: 'Private filenames and storage paths must be redacted from support bundles.',
    containsSecrets: false,
    containsPrivatePaths: true,
    containsGeneratedContent: false,
    workspaceScoped: true,
    previewSafety: 'Show filename, size, MIME type, validation status, and parent task link.',
  },
  {
    id: 'workProducts',
    label: 'Work products and versions',
    description:
      'Durable work products, version history, source links, redaction metadata, and render data.',
    tables: ['work_products', 'work_product_versions', 'task_deliverables'],
    defaultRetention:
      'Active work products and accepted deliverables are retained until task/workspace cleanup.',
    userControls: ['Archive, restore, export, and regenerate where supported.'],
    adminControls: [
      'Version retention, generated artifact cleanup, workspace export, and workspace deletion.',
    ],
    exportBehavior: 'Included in full and workspace-scoped exports with version metadata.',
    deleteBehavior:
      'Preview source task, source run, status, version count, and redaction state before cleanup.',
    auditBehavior:
      'Creation, regeneration, restore, archive, and delete actions should be traceable.',
    redaction:
      'Rendered content may include prompts, private paths, or generated sensitive text; redact in support bundles.',
    containsSecrets: false,
    containsPrivatePaths: true,
    containsGeneratedContent: true,
    workspaceScoped: true,
    previewSafety:
      'Show title, kind, status, version count, linked task/run, and storage estimate.',
  },
  {
    id: 'telemetry',
    label: 'Telemetry and metrics events',
    description:
      'Run events, token/cost events, durations, errors, session keys, and dashboard metric inputs.',
    tables: ['telemetry_events'],
    defaultRetention: 'Default retention is 30 days unless the admin changes telemetry settings.',
    userControls: ['Dashboard filtering and telemetry export where permissions allow.'],
    adminControls: ['Retention window, export, purge preview, and dashboard diagnostics.'],
    exportBehavior:
      'Included in full and workspace-scoped exports. CSV/JSON telemetry exports remain separate API flows.',
    deleteBehavior:
      'Purge only by explicit range/workspace preview and never as implicit task cleanup.',
    auditBehavior: 'Retention/purge actions should emit admin audit records.',
    redaction:
      'Errors, stack traces, session keys, prompts, and model outputs must be redacted in support bundles.',
    containsSecrets: false,
    containsPrivatePaths: true,
    containsGeneratedContent: true,
    workspaceScoped: true,
    previewSafety: 'Show event counts by type, date range, project, and agent before purge.',
  },
  {
    id: 'workflowRuns',
    label: 'Workflow definitions, runs, and scheduled snapshots',
    description:
      'Workflow definitions, ACLs, run state, checkpoints, audit events, and scheduled deliverable snapshots.',
    tables: [
      'workflow_definitions',
      'workflow_acls',
      'workflow_audit_events',
      'workflow_runs',
      'scheduled_deliverables',
      'scheduled_deliverable_runs',
    ],
    defaultRetention:
      'Definitions are retained until deleted; run/snapshot retention is admin-configurable.',
    userControls: ['View runs, retry/resume where permitted, and export linked outputs.'],
    adminControls: [
      'Run retention, scheduled snapshot retention, cleanup preview, and workspace export/delete.',
    ],
    exportBehavior: 'Included in full and workspace-scoped exports.',
    deleteBehavior:
      'Do not delete active runs or current scheduled state; preview status and linked outputs first.',
    auditBehavior: 'Workflow mutations, gates, approvals, and run cleanup should remain auditable.',
    redaction:
      'Run context and outputs may include prompts, file paths, and generated content; redact in support bundles.',
    containsSecrets: false,
    containsPrivatePaths: true,
    containsGeneratedContent: true,
    workspaceScoped: true,
    previewSafety:
      'Show status, workflow, task link, run age, snapshot count, and active/blocked state.',
  },
  {
    id: 'notifications',
    label: 'Notifications and subscriptions',
    description:
      'Notification history, thread subscriptions, delivery state, target URLs, and dedupe keys.',
    tables: ['notifications', 'thread_subscriptions'],
    defaultRetention:
      'Retained until read/dismissed history is cleaned up by user or admin settings.',
    userControls: ['Mark read, dismiss, and inspect source task/run where exposed.'],
    adminControls: ['Retention, export, notification history cleanup, and workspace deletion.'],
    exportBehavior: 'Included in full and workspace-scoped exports.',
    deleteBehavior:
      'Preview delivered/read status, target URL category, source task, and age before cleanup.',
    auditBehavior:
      'Admin cleanup should be auditable; routine read/dismiss can remain activity-level.',
    redaction:
      'Target URLs, titles, and content may reveal private paths or task content; redact in support bundles.',
    containsSecrets: false,
    containsPrivatePaths: true,
    containsGeneratedContent: true,
    workspaceScoped: true,
    previewSafety: 'Show counts by type, delivered/read state, source task, and age.',
  },
  {
    id: 'chat',
    label: 'Chat and squad messages',
    description:
      'Board/task chat sessions, message history, squad messages, cards, tags, and model metadata.',
    tables: ['chat_sessions', 'chat_messages', 'squad_messages'],
    defaultRetention:
      'Retained with the workspace until explicitly deleted or cleaned by retention policy.',
    userControls: ['Delete sessions and export task context where supported.'],
    adminControls: ['Retention by age/session/task, export, and workspace deletion.'],
    exportBehavior: 'Included in full and workspace-scoped exports.',
    deleteBehavior: 'Preview session, task link, message count, agents, and age before cleanup.',
    auditBehavior: 'Session deletion and admin cleanup should be auditable.',
    redaction:
      'Chat content may include prompts, paths, or secrets pasted by users; redact in support bundles.',
    containsSecrets: false,
    containsPrivatePaths: true,
    containsGeneratedContent: true,
    workspaceScoped: true,
    previewSafety: 'Show metadata and counts, not full message content, in cleanup previews.',
  },
  {
    id: 'audit',
    label: 'Audit, governance, and policy records',
    description:
      'Audit entries, policy records, decisions, feedback, scoring, drift, and governance evidence.',
    tables: [
      'activity_events',
      'status_history',
      'decision_records',
      'feedback_records',
      'scoring_profiles',
      'scoring_evaluations',
      'drift_alerts',
      'drift_baselines',
      'audit_entries',
      'agent_policies',
      'tool_policies',
    ],
    defaultRetention:
      'Audit and governance records are retained longer than operational telemetry.',
    userControls: ['View governance decisions where permissions allow.'],
    adminControls: [
      'Export, workspace deletion, and explicit retention review for non-audit operational records.',
    ],
    exportBehavior: 'Included in full and workspace-scoped exports.',
    deleteBehavior: 'Audit logs should not be silently deleted by operational cleanup actions.',
    auditBehavior:
      'This class is the audit evidence; cleanup policy changes must themselves be auditable.',
    redaction:
      'Evidence details may include private paths, prompts, and model outputs; redact support previews.',
    containsSecrets: false,
    containsPrivatePaths: true,
    containsGeneratedContent: true,
    workspaceScoped: true,
    previewSafety: 'Show counts, date ranges, policy IDs, and actor IDs before any deletion.',
  },
  {
    id: 'deviceAccess',
    label: 'Device sessions and API tokens',
    description:
      'Pairing codes, device sessions, scoped API tokens, revocation state, and token hashes.',
    tables: [],
    defaultRetention:
      'Active credentials are retained until expiration or revocation; expired records are cleanup candidates.',
    userControls: ['Revoke own trusted devices or scoped tokens where permitted.'],
    adminControls: ['Revoke devices/tokens, rotate secrets, and review active sessions.'],
    exportBehavior:
      'Credential secret material and token hashes are excluded from SQLite backup exports by default.',
    deleteBehavior:
      'Revocation should happen before deletion; active session deletion must close live sockets.',
    auditBehavior: 'Create, rotate, revoke, and delete events must be auditable.',
    redaction: 'Never print token values, hashes, pairing codes, or device session secrets.',
    containsSecrets: true,
    containsPrivatePaths: false,
    containsGeneratedContent: false,
    workspaceScoped: true,
    previewSafety: 'Show device name, mode, created/last-used/expiry, and revoked state only.',
  },
  {
    id: 'configuration',
    label: 'Configuration and registries',
    description:
      'App settings, managed lists, templates, prompts, routing, policies, and local repository paths.',
    tables: [
      'app_config_documents',
      'managed_list_items',
      'task_templates',
      'prompt_templates',
      'prompt_versions',
      'prompt_usage',
    ],
    defaultRetention: 'Retained until changed or deleted by a user/admin.',
    userControls: ['Edit settings and templates where permissions allow.'],
    adminControls: ['Export/import, reset, and review path/provider settings.'],
    exportBehavior:
      'Included in full exports. Workspace-scoped exports exclude global app config unless explicitly added later.',
    deleteBehavior: 'Settings reset/import must preview scope and preserve recovery options.',
    auditBehavior: 'Admin settings, policy, and prompt registry changes should be attributable.',
    redaction:
      'Repository paths, provider names, and prompt text may be private; redact in support bundles.',
    containsSecrets: false,
    containsPrivatePaths: true,
    containsGeneratedContent: true,
    workspaceScoped: false,
    previewSafety:
      'Show keys, categories, and counts. Do not show full prompt bodies in support previews.',
  },
  {
    id: 'backupsExports',
    label: 'Backups, imports, and exports',
    description:
      'SQLite backup bundles, migration journals, export manifests, imported files, and restore reports.',
    tables: [],
    defaultRetention: 'Retained wherever the admin writes them until manually removed.',
    userControls: ['Download or move exports created through UI flows.'],
    adminControls: ['Create, verify, restore, and delete backup bundles.'],
    exportBehavior:
      'Exports must include a manifest that lists data classes, row counts, and redaction choices.',
    deleteBehavior:
      'Deleting backup bundles is a filesystem operation that requires explicit confirmation.',
    auditBehavior:
      'Backup/export/import/restore operations should be recorded with actor and path metadata.',
    redaction: 'Manifests can list paths, but support bundles should redact private path prefixes.',
    containsSecrets: false,
    containsPrivatePaths: true,
    containsGeneratedContent: true,
    workspaceScoped: false,
    previewSafety:
      'Show bundle path, created time, data classes, and size estimates before deletion.',
  },
  {
    id: 'debugBundles',
    label: 'Diagnostics and debug bundles',
    description: 'Health checks, logs, redacted support snapshots, and troubleshooting output.',
    tables: [],
    defaultRetention: 'Generated on demand and retained until the user/admin deletes the bundle.',
    userControls: ['Create and inspect diagnostics where the UI exposes it.'],
    adminControls: ['Create redacted support bundles and delete old bundles.'],
    exportBehavior: 'Must be redacted by default and include a manifest of included categories.',
    deleteBehavior: 'Delete only explicitly generated bundle files after previewing path and size.',
    auditBehavior: 'Support bundle creation should be logged without storing secret values.',
    redaction:
      'Redact tokens, cookies, API keys, private keys, local paths, URLs with credentials, and message content by default.',
    containsSecrets: true,
    containsPrivatePaths: true,
    containsGeneratedContent: true,
    workspaceScoped: false,
    previewSafety: 'Show categories and redaction state, not raw log content, before sharing.',
  },
] as const;

export function listDataLifecyclePolicies(): DataLifecyclePolicy[] {
  return DATA_LIFECYCLE_POLICIES.map((policy) => ({
    ...policy,
    tables: [...policy.tables],
    userControls: [...policy.userControls],
    adminControls: [...policy.adminControls],
  }));
}

export function buildDataLifecycleManifest(
  options: DataLifecycleManifestOptions
): DataLifecycleManifestEntry[] {
  return DATA_LIFECYCLE_POLICIES.map((policy) => ({
    id: policy.id,
    label: policy.label,
    tables: [...policy.tables],
    rowCount: policy.tables.reduce((sum, table) => sum + (options.tableCounts[table] ?? 0), 0),
    defaultRetention: policy.defaultRetention,
    exportBehavior: policy.exportBehavior,
    deleteBehavior: policy.deleteBehavior,
    redaction: policy.redaction,
    containsSecrets: policy.containsSecrets,
    containsPrivatePaths: policy.containsPrivatePaths,
    containsGeneratedContent: policy.containsGeneratedContent,
    workspaceScoped: policy.workspaceScoped,
  }));
}

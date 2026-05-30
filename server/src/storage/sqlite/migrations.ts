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
];

export function sortedMigrations(migrations: readonly SqliteMigration[]): SqliteMigration[] {
  return [...migrations].sort((a, b) => a.version - b.version);
}

import crypto from 'crypto';
import type { AgentPolicy } from '@veritas-kanban/shared';
import type { ToolPolicy } from '../../types/workflow.js';
import type { SqliteDatabase } from './database.js';

export interface SqliteAuditEntry {
  timestamp: string;
  action: string;
  actor: string;
  resource?: string;
  details?: Record<string, unknown>;
  integrity: string;
}

export interface SqliteAuditVerifyResult {
  valid: boolean;
  entries: number;
  firstBroken?: number;
}

interface AuditRow {
  entry_json: string;
}

interface AgentPolicyRow {
  policy_json: string;
}

interface ToolPolicyRow {
  policy_json: string;
}

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

export class SqliteAuditRepository {
  constructor(private readonly database: SqliteDatabase) {}

  getLastEntryLine(): string | null {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT entry_json
          FROM audit_entries
          WHERE workspace_id = 'local'
          ORDER BY id DESC
          LIMIT 1
        `
      )
      .get() as AuditRow | undefined;

    return row?.entry_json ?? null;
  }

  save(entry: SqliteAuditEntry, line: string): void {
    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO audit_entries (
            workspace_id,
            action,
            actor,
            resource,
            integrity,
            entry_json,
            created_at
          )
          VALUES ('local', ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        entry.action,
        entry.actor,
        entry.resource ?? null,
        entry.integrity,
        line,
        entry.timestamp
      );
  }

  readRecent(limit = 100): SqliteAuditEntry[] {
    const effectiveLimit = Math.min(Math.max(limit, 1), 10_000);
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT entry_json
          FROM audit_entries
          WHERE workspace_id = 'local'
          ORDER BY id DESC
          LIMIT ?
        `
      )
      .all(effectiveLimit) as unknown as AuditRow[];

    return rows.map((row) => JSON.parse(row.entry_json) as SqliteAuditEntry);
  }

  verify(): SqliteAuditVerifyResult {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT entry_json
          FROM audit_entries
          WHERE workspace_id = 'local'
          ORDER BY id ASC
        `
      )
      .all() as unknown as AuditRow[];

    let previousHash = '';
    let totalEntries = 0;

    for (let index = 0; index < rows.length; index += 1) {
      const line = rows[index].entry_json;
      totalEntries += 1;

      let entry: SqliteAuditEntry;
      try {
        entry = JSON.parse(line) as SqliteAuditEntry;
      } catch {
        return { valid: false, entries: totalEntries, firstBroken: index };
      }

      if (entry.integrity !== previousHash) {
        return { valid: false, entries: totalEntries, firstBroken: index };
      }

      previousHash = sha256(line);
    }

    return { valid: true, entries: totalEntries };
  }
}

export class SqliteAgentPolicyRepository {
  constructor(private readonly database: SqliteDatabase) {}

  list(): AgentPolicy[] {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT policy_json
          FROM agent_policies
          WHERE workspace_id = 'local'
          ORDER BY name ASC, id ASC
        `
      )
      .all() as unknown as AgentPolicyRow[];

    return rows.map((row) => JSON.parse(row.policy_json) as AgentPolicy);
  }

  get(id: string): AgentPolicy | null {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT policy_json
          FROM agent_policies
          WHERE workspace_id = 'local'
            AND id = ?
        `
      )
      .get(id) as AgentPolicyRow | undefined;

    return row ? (JSON.parse(row.policy_json) as AgentPolicy) : null;
  }

  save(policy: AgentPolicy): void {
    const now = new Date().toISOString();
    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO agent_policies (
            id,
            workspace_id,
            name,
            type,
            enabled,
            response_action,
            preset,
            policy_json,
            created_at,
            updated_at
          )
          VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            type = excluded.type,
            enabled = excluded.enabled,
            response_action = excluded.response_action,
            preset = excluded.preset,
            policy_json = excluded.policy_json,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at
        `
      )
      .run(
        policy.id,
        policy.name,
        policy.type,
        policy.enabled ? 1 : 0,
        policy.responseAction,
        policy.preset ?? null,
        JSON.stringify(policy),
        policy.createdAt ?? now,
        policy.updatedAt ?? now
      );
  }

  delete(id: string): boolean {
    const result = this.database
      .getConnection()
      .prepare(
        `
          DELETE FROM agent_policies
          WHERE workspace_id = 'local'
            AND id = ?
        `
      )
      .run(id);

    return Number(result.changes) > 0;
  }
}

export class SqliteToolPolicyRepository {
  constructor(private readonly database: SqliteDatabase) {}

  list(): ToolPolicy[] {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT policy_json
          FROM tool_policies
          WHERE workspace_id = 'local'
          ORDER BY role ASC
        `
      )
      .all() as unknown as ToolPolicyRow[];

    return rows.map((row) => JSON.parse(row.policy_json) as ToolPolicy);
  }

  get(role: string): ToolPolicy | null {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT policy_json
          FROM tool_policies
          WHERE workspace_id = 'local'
            AND role = ?
        `
      )
      .get(role) as ToolPolicyRow | undefined;

    return row ? (JSON.parse(row.policy_json) as ToolPolicy) : null;
  }

  save(policy: ToolPolicy): void {
    const normalizedPolicy: ToolPolicy = {
      ...policy,
      role: policy.role.trim().toLowerCase(),
    };
    const now = new Date().toISOString();
    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO tool_policies (
            role,
            workspace_id,
            allowed_json,
            denied_json,
            policy_json,
            created_at,
            updated_at
          )
          VALUES (?, 'local', ?, ?, ?, ?, ?)
          ON CONFLICT(role) DO UPDATE SET
            allowed_json = excluded.allowed_json,
            denied_json = excluded.denied_json,
            policy_json = excluded.policy_json,
            updated_at = excluded.updated_at
        `
      )
      .run(
        normalizedPolicy.role,
        JSON.stringify(normalizedPolicy.allowed),
        JSON.stringify(normalizedPolicy.denied),
        JSON.stringify(normalizedPolicy),
        now,
        now
      );
  }

  delete(role: string): boolean {
    const result = this.database
      .getConnection()
      .prepare(
        `
          DELETE FROM tool_policies
          WHERE workspace_id = 'local'
            AND role = ?
        `
      )
      .run(role);

    return Number(result.changes) > 0;
  }
}

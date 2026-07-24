import type {
  RunToolCatalog,
  ToolServerDefinition,
  ToolServerDiscovery,
} from '@veritas-kanban/shared';
import {
  runToolCatalogSchema,
  toolServerDefinitionSchema,
  toolServerDiscoverySchema,
} from '../../schemas/tool-control-plane-schemas.js';
import type { ToolControlPlaneRepository } from '../interfaces.js';
import type { SqliteDatabase } from './database.js';

interface JsonRow {
  document_json: string;
}

export class SqliteToolControlPlaneRepository implements ToolControlPlaneRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async listDefinitions(): Promise<ToolServerDefinition[]> {
    const rows = this.database
      .getConnection()
      .prepare('SELECT document_json FROM tool_server_definitions ORDER BY id')
      .all() as unknown as JsonRow[];
    return rows.map((row) => toolServerDefinitionSchema.parse(JSON.parse(row.document_json)));
  }

  async getDefinition(id: string): Promise<ToolServerDefinition | null> {
    return this.readOne(
      'SELECT document_json FROM tool_server_definitions WHERE id = ?',
      id,
      toolServerDefinitionSchema
    );
  }

  async saveDefinition(definition: ToolServerDefinition): Promise<ToolServerDefinition> {
    const parsed = toolServerDefinitionSchema.parse(definition);
    this.database
      .getConnection()
      .prepare(
        `INSERT INTO tool_server_definitions
           (id, version, digest, document_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           version = excluded.version,
           digest = excluded.digest,
           document_json = excluded.document_json,
           updated_at = excluded.updated_at`
      )
      .run(
        parsed.id,
        parsed.version,
        parsed.digest,
        JSON.stringify(parsed),
        parsed.createdAt,
        parsed.updatedAt
      );
    return parsed;
  }

  async deleteDefinition(id: string): Promise<boolean> {
    return (
      this.database
        .getConnection()
        .prepare('DELETE FROM tool_server_definitions WHERE id = ?')
        .run(id).changes === 1
    );
  }

  async getDiscovery(definitionDigest: string): Promise<ToolServerDiscovery | null> {
    return this.readOne(
      'SELECT document_json FROM tool_server_discoveries WHERE definition_digest = ?',
      definitionDigest,
      toolServerDiscoverySchema
    );
  }

  async saveDiscovery(discovery: ToolServerDiscovery): Promise<ToolServerDiscovery> {
    const parsed = toolServerDiscoverySchema.parse(discovery);
    this.database
      .getConnection()
      .prepare(
        `INSERT INTO tool_server_discoveries
           (definition_digest, server_id, server_version, discovery_digest, document_json, discovered_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(definition_digest) DO UPDATE SET
           server_id = excluded.server_id,
           server_version = excluded.server_version,
           discovery_digest = excluded.discovery_digest,
           document_json = excluded.document_json,
           discovered_at = excluded.discovered_at`
      )
      .run(
        parsed.definitionDigest,
        parsed.serverId,
        parsed.serverVersion,
        parsed.digest,
        JSON.stringify(parsed),
        parsed.discoveredAt
      );
    return parsed;
  }

  async getRunCatalog(taskId: string, attemptId: string): Promise<RunToolCatalog | null> {
    return this.readOne(
      'SELECT document_json FROM run_tool_catalogs WHERE task_id = ? AND attempt_id = ?',
      [taskId, attemptId],
      runToolCatalogSchema
    );
  }

  async saveRunCatalog(catalog: RunToolCatalog): Promise<RunToolCatalog> {
    const parsed = runToolCatalogSchema.parse(catalog);
    this.database
      .getConnection()
      .prepare(
        `INSERT INTO run_tool_catalogs
           (task_id, attempt_id, provider, digest, document_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(task_id, attempt_id) DO NOTHING`
      )
      .run(
        parsed.taskId,
        parsed.attemptId,
        parsed.provider,
        parsed.digest,
        JSON.stringify(parsed),
        parsed.createdAt
      );
    const persisted = await this.getRunCatalog(parsed.taskId, parsed.attemptId);
    if (!persisted) throw new Error('Run tool catalog was not persisted.');
    if (persisted.digest !== parsed.digest) {
      throw new Error('Run tool catalog identity was reused with changed evidence.');
    }
    return persisted;
  }

  private async readOne<T>(
    sql: string,
    parameter: string | string[],
    schema: { parse(value: unknown): T }
  ): Promise<T | null> {
    const params = Array.isArray(parameter) ? parameter : [parameter];
    const row = this.database
      .getConnection()
      .prepare(sql)
      .get(...params) as JsonRow | undefined;
    return row ? schema.parse(JSON.parse(row.document_json)) : null;
  }
}

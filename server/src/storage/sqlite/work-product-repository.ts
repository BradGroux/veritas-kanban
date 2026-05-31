import type { SQLInputValue } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type {
  WorkProduct,
  WorkProductListOptions,
  WorkProductVersion,
} from '@veritas-kanban/shared';
import type { SqliteDatabase } from './database.js';

interface WorkProductRow {
  product_json: string;
}

interface WorkProductVersionRow {
  version_json: string;
}

export class SqliteWorkProductRepository {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly options: { versionLimit?: number } = {}
  ) {}

  list(options: WorkProductListOptions = {}): WorkProduct[] {
    const { sql, params } = this.buildListQuery(options);
    const rows = this.database
      .getConnection()
      .prepare(sql)
      .all(...params) as unknown as WorkProductRow[];
    return rows.map((row) => JSON.parse(row.product_json) as WorkProduct);
  }

  get(id: string): WorkProduct | null {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT product_json
          FROM work_products
          WHERE workspace_id = 'local'
            AND id = ?
            AND deleted_at IS NULL
        `
      )
      .get(id) as unknown as WorkProductRow | undefined;

    return row ? (JSON.parse(row.product_json) as WorkProduct) : null;
  }

  save(product: WorkProduct, searchText: string, changeSummary?: string): WorkProduct {
    const db = this.database.getConnection();
    db.exec('BEGIN IMMEDIATE;');
    try {
      this.upsertProduct(product);
      this.recordVersion(product, 'create', searchText, changeSummary);
      this.syncSearchRow(product, searchText);
      db.exec('COMMIT;');
      return product;
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }

  update(
    product: WorkProduct,
    searchText: string,
    changeType: WorkProductVersion['changeType'],
    changeSummary?: string
  ): WorkProduct {
    const db = this.database.getConnection();
    db.exec('BEGIN IMMEDIATE;');
    try {
      this.upsertProduct(product);
      this.recordVersion(product, changeType, searchText, changeSummary);
      this.syncSearchRow(product, searchText);
      this.pruneVersions(product.id);
      db.exec('COMMIT;');
      return product;
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }

  listVersions(productId: string): WorkProductVersion[] {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT version_json
          FROM work_product_versions
          WHERE workspace_id = 'local'
            AND product_id = ?
          ORDER BY version_number DESC
        `
      )
      .all(productId) as unknown as WorkProductVersionRow[];

    return rows.map((row) => JSON.parse(row.version_json) as WorkProductVersion);
  }

  getVersion(productId: string, version: number): WorkProductVersion | null {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT version_json
          FROM work_product_versions
          WHERE workspace_id = 'local'
            AND product_id = ?
            AND version_number = ?
        `
      )
      .get(productId, version) as unknown as WorkProductVersionRow | undefined;

    return row ? (JSON.parse(row.version_json) as WorkProductVersion) : null;
  }

  archive(id: string, now: string): WorkProduct | null {
    const product = this.get(id);
    if (!product) return null;

    const archived: WorkProduct = {
      ...product,
      status: 'archived',
      archivedAt: now,
      updatedAt: now,
    };
    return this.update(archived, '', 'manual', 'Archived work product');
  }

  search(query: string, limit = 20): WorkProduct[] {
    const ftsQuery = this.toFtsQuery(query);
    if (!ftsQuery) return [];

    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT wp.product_json
          FROM work_product_search wps
          JOIN work_products wp ON wp.id = wps.product_id
          WHERE work_product_search MATCH ?
            AND wp.workspace_id = 'local'
            AND wp.status = 'active'
            AND wp.deleted_at IS NULL
          ORDER BY rank
          LIMIT ?
        `
      )
      .all(ftsQuery, Math.min(Math.max(limit, 1), 200)) as unknown as WorkProductRow[];

    return rows.map((row) => JSON.parse(row.product_json) as WorkProduct);
  }

  private buildListQuery(options: WorkProductListOptions): {
    sql: string;
    params: SQLInputValue[];
  } {
    const clauses = ["workspace_id = 'local'", 'deleted_at IS NULL'];
    const params: SQLInputValue[] = [];

    if (!options.includeArchived) {
      clauses.push("status = 'active'");
    }
    if (options.status) {
      clauses.push('status = ?');
      params.push(options.status);
    }
    if (options.taskId) {
      clauses.push('task_id = ?');
      params.push(options.taskId);
    }
    if (options.sourceRunId) {
      clauses.push('source_run_id = ?');
      params.push(options.sourceRunId);
    }
    if (options.agent) {
      clauses.push('agent = ?');
      params.push(options.agent);
    }
    if (options.kind) {
      clauses.push('kind = ?');
      params.push(options.kind);
    }
    if (options.query) {
      const like = `%${options.query}%`;
      clauses.push(
        '(title LIKE ? OR product_json LIKE ? OR render_json LIKE ? OR metadata_json LIKE ?)'
      );
      params.push(like, like, like, like);
    }

    params.push(Math.min(Math.max(options.limit ?? 100, 1), 200));
    return {
      sql: `
        SELECT product_json
        FROM work_products
        WHERE ${clauses.join(' AND ')}
        ORDER BY datetime(updated_at) DESC, id ASC
        LIMIT ?
      `,
      params,
    };
  }

  private upsertProduct(product: WorkProduct): void {
    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO work_products (
            id,
            workspace_id,
            kind,
            title,
            status,
            task_id,
            source_run_id,
            agent,
            model,
            version_number,
            redaction_json,
            source_links_json,
            metadata_json,
            render_json,
            product_json,
            created_at,
            updated_at,
            archived_at,
            deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
          ON CONFLICT(id) DO UPDATE SET
            workspace_id = excluded.workspace_id,
            kind = excluded.kind,
            title = excluded.title,
            status = excluded.status,
            task_id = excluded.task_id,
            source_run_id = excluded.source_run_id,
            agent = excluded.agent,
            model = excluded.model,
            version_number = excluded.version_number,
            redaction_json = excluded.redaction_json,
            source_links_json = excluded.source_links_json,
            metadata_json = excluded.metadata_json,
            render_json = excluded.render_json,
            product_json = excluded.product_json,
            updated_at = excluded.updated_at,
            archived_at = excluded.archived_at,
            deleted_at = NULL
        `
      )
      .run(
        product.id,
        product.workspaceId,
        product.kind,
        product.title,
        product.status,
        product.taskId ?? null,
        product.sourceRunId ?? null,
        product.agent ?? null,
        product.model ?? null,
        product.version,
        this.optionalJson(product.redaction),
        this.optionalJson(product.sourceLinks),
        this.optionalJson(product.metadata),
        JSON.stringify(product.render),
        JSON.stringify(product),
        product.createdAt,
        product.updatedAt,
        product.archivedAt ?? null
      );
  }

  private recordVersion(
    product: WorkProduct,
    changeType: WorkProductVersion['changeType'],
    _searchText: string,
    changeSummary?: string
  ): void {
    const version: WorkProductVersion = {
      id: `wpv_${randomUUID()}`,
      productId: product.id,
      workspaceId: product.workspaceId,
      version: product.version,
      changeType,
      changeSummary,
      render: product.render,
      title: product.title,
      kind: product.kind,
      agent: product.agent,
      model: product.model,
      redaction: product.redaction,
      createdAt: product.updatedAt,
    };

    this.database
      .getConnection()
      .prepare(
        `
          INSERT OR REPLACE INTO work_product_versions (
            id,
            product_id,
            workspace_id,
            version_number,
            change_type,
            change_summary,
            title,
            kind,
            agent,
            model,
            redaction_json,
            render_json,
            version_json,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        version.id,
        product.id,
        product.workspaceId,
        version.version,
        version.changeType,
        version.changeSummary ?? null,
        version.title,
        version.kind,
        version.agent ?? null,
        version.model ?? null,
        this.optionalJson(version.redaction),
        JSON.stringify(version.render),
        JSON.stringify(version),
        version.createdAt
      );
  }

  private syncSearchRow(product: WorkProduct, searchText: string): void {
    const db = this.database.getConnection();
    db.prepare('DELETE FROM work_product_search WHERE product_id = ?').run(product.id);

    if (product.status !== 'active') {
      return;
    }

    db.prepare(
      `
        INSERT INTO work_product_search (product_id, title, body)
        VALUES (?, ?, ?)
      `
    ).run(product.id, product.title, searchText);
  }

  private pruneVersions(productId: string): void {
    const limit = this.options.versionLimit ?? 25;
    if (limit < 1) return;

    this.database
      .getConnection()
      .prepare(
        `
          DELETE FROM work_product_versions
          WHERE product_id = ?
            AND version_number NOT IN (
              SELECT version_number
              FROM work_product_versions
              WHERE product_id = ?
              ORDER BY version_number DESC
              LIMIT ?
            )
        `
      )
      .run(productId, productId, limit);
  }

  private optionalJson(value: unknown): string | null {
    return value === undefined ? null : JSON.stringify(value);
  }

  private toFtsQuery(query: string): string {
    return query
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `"${term.replace(/"/g, '""')}"`)
      .join(' ');
  }
}

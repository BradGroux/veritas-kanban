import type { Attachment, Deliverable, Task } from '@veritas-kanban/shared';
import type { TaskRepository } from '../interfaces.js';
import type { SqliteDatabase } from './database.js';

export type TaskStorageState = 'active' | 'archived' | 'backlog';

interface TaskRow {
  task_json: string;
}

export class SqliteTaskRepository implements TaskRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async findAll(): Promise<Task[]> {
    return this.listByState('active');
  }

  async findById(id: string): Promise<Task | null> {
    return this.findByState(id, 'active');
  }

  async create(task: Task): Promise<Task> {
    this.save(task, 'active');
    return task;
  }

  async update(id: string, updates: Partial<Task>): Promise<Task> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error(`Task not found: ${id}`);
    }

    const updated = {
      ...existing,
      ...updates,
      updated: updates.updated ?? new Date().toISOString(),
    };
    this.save(updated, 'active');
    return updated;
  }

  async delete(id: string): Promise<void> {
    const deleted = await this.deleteActive(id);
    if (!deleted) {
      throw new Error(`Task not found: ${id}`);
    }
  }

  async search(query: string): Promise<Task[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return this.findAll();
    }

    const db = this.database.getConnection();
    const likeQuery = `%${trimmed.toLowerCase()}%`;

    try {
      const ftsQuery = this.toFtsQuery(trimmed);
      const rows = db
        .prepare(
          `
            SELECT t.task_json
            FROM tasks t
            WHERE t.workspace_id = 'local'
              AND t.storage_state = 'active'
              AND t.deleted_at IS NULL
              AND (
                lower(t.id) LIKE ?
                OR t.id IN (
                  SELECT task_id
                  FROM task_search
                  WHERE task_search MATCH ?
                )
              )
            ORDER BY t.updated_at DESC
          `
        )
        .all(likeQuery, ftsQuery) as unknown as TaskRow[];

      return rows.map((row) => this.parseTask(row));
    } catch {
      const rows = db
        .prepare(
          `
            SELECT task_json
            FROM tasks
            WHERE workspace_id = 'local'
              AND storage_state = 'active'
              AND deleted_at IS NULL
              AND (
                lower(id) LIKE ?
                OR lower(title) LIKE ?
                OR lower(description) LIKE ?
              )
            ORDER BY updated_at DESC
          `
        )
        .all(likeQuery, likeQuery, likeQuery) as unknown as TaskRow[];

      return rows.map((row) => this.parseTask(row));
    }
  }

  async listArchived(): Promise<Task[]> {
    return this.listByState('archived');
  }

  async findArchivedById(id: string): Promise<Task | null> {
    return this.findByState(id, 'archived');
  }

  async replaceActive(task: Task): Promise<Task> {
    this.save(task, 'active');
    return task;
  }

  async deleteActive(id: string): Promise<boolean> {
    const db = this.database.getConnection();
    const result = this.transaction(() => {
      this.deleteArtifactRows(id);
      this.deleteSearchRow(id);
      return db.prepare("DELETE FROM tasks WHERE id = ? AND storage_state = 'active';").run(id);
    });

    return result.changes > 0;
  }

  async archive(id: string, archivedTask?: Task): Promise<boolean> {
    const existing = await this.findById(id);
    if (!existing) {
      return false;
    }

    this.save(archivedTask ?? existing, 'archived', new Date().toISOString());
    return true;
  }

  async restore(id: string): Promise<Task | null> {
    const existing = await this.findArchivedById(id);
    if (!existing) {
      return null;
    }

    const restored = {
      ...existing,
      status: 'done' as const,
      updated: new Date().toISOString(),
      deletedAt: undefined,
      deletedBy: undefined,
      purgeAfter: undefined,
    };
    this.save(restored, 'active', null);
    return restored;
  }

  async listBacklog(): Promise<Task[]> {
    return this.listByState('backlog');
  }

  async moveToBacklog(id: string): Promise<Task | null> {
    const existing = await this.findById(id);
    if (!existing) {
      return null;
    }

    this.save(existing, 'backlog');
    return existing;
  }

  async promoteBacklog(id: string): Promise<Task | null> {
    const existing = await this.findByState(id, 'backlog');
    if (!existing) {
      return null;
    }

    const activeTask = {
      ...existing,
      status: 'todo' as const,
      updated: new Date().toISOString(),
    };
    this.save(activeTask, 'active');
    return activeTask;
  }

  private listByState(state: TaskStorageState): Task[] {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT task_json
          FROM tasks
          WHERE workspace_id = 'local'
            AND storage_state = ?
            AND deleted_at IS NULL
          ORDER BY updated_at DESC
        `
      )
      .all(state) as unknown as TaskRow[];

    return rows.map((row) => this.parseTask(row));
  }

  private findByState(id: string, state: TaskStorageState): Task | null {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT task_json
          FROM tasks
          WHERE workspace_id = 'local'
            AND id = ?
            AND storage_state = ?
            AND deleted_at IS NULL
        `
      )
      .get(id, state) as TaskRow | undefined;

    return row ? this.parseTask(row) : null;
  }

  private save(task: Task, state: TaskStorageState, archivedAt?: string | null): void {
    const db = this.database.getConnection();
    const taskJson = JSON.stringify(task);
    const archivedValue = state === 'archived' ? (archivedAt ?? new Date().toISOString()) : null;

    this.transaction(() => {
      db.prepare(
        `
          INSERT INTO tasks (
            id,
            workspace_id,
            storage_state,
            title,
            description,
            type,
            status,
            priority,
            project,
            sprint,
            position,
            task_json,
            created_at,
            updated_at,
            archived_at,
            deleted_at
          )
          VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
          ON CONFLICT(id) DO UPDATE SET
            storage_state = excluded.storage_state,
            title = excluded.title,
            description = excluded.description,
            type = excluded.type,
            status = excluded.status,
            priority = excluded.priority,
            project = excluded.project,
            sprint = excluded.sprint,
            position = excluded.position,
            task_json = excluded.task_json,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            archived_at = excluded.archived_at,
            deleted_at = NULL
        `
      ).run(
        task.id,
        state,
        task.title,
        task.description ?? '',
        task.type,
        task.status,
        task.priority,
        task.project ?? null,
        task.sprint ?? null,
        task.position ?? null,
        taskJson,
        task.created,
        task.updated,
        archivedValue
      );

      this.upsertSearchRow(task, state);
      this.syncArtifactRows(task);
    });
  }

  private syncArtifactRows(task: Task): void {
    this.deleteArtifactRows(task.id);

    const attachments = task.attachments ?? [];
    if (attachments.length > 0) {
      this.insertAttachmentRows(task, attachments);
    }

    const deliverables = task.deliverables ?? [];
    if (deliverables.length > 0) {
      this.insertDeliverableRows(task, deliverables);
    }
  }

  private insertAttachmentRows(task: Task, attachments: Attachment[]): void {
    const db = this.database.getConnection();
    const statement = db.prepare(
      `
        INSERT INTO task_attachments (
          id,
          workspace_id,
          task_id,
          filename,
          original_name,
          mime_type,
          size_bytes,
          sha256,
          storage_path,
          uploaded_at,
          uploaded_by,
          session_id,
          validation_status,
          validation_error,
          retention_status,
          cleanup_eligible,
          attachment_json,
          deleted_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `
    );

    for (const attachment of attachments) {
      statement.run(
        attachment.id,
        this.workspaceIdFor(task, attachment.workspaceId),
        task.id,
        attachment.filename,
        attachment.originalName,
        attachment.mimeType,
        attachment.size,
        attachment.sha256 ?? null,
        this.attachmentStoragePath(task.id, attachment),
        attachment.uploaded,
        attachment.uploadedBy ?? null,
        attachment.sessionId ?? null,
        attachment.validationStatus ?? 'unknown',
        attachment.validationError ?? null,
        attachment.retentionStatus ?? 'active',
        attachment.cleanupEligible === true ? 1 : 0,
        JSON.stringify(attachment)
      );
    }
  }

  private insertDeliverableRows(task: Task, deliverables: Deliverable[]): void {
    const db = this.database.getConnection();
    const statement = db.prepare(
      `
        INSERT INTO task_deliverables (
          id,
          workspace_id,
          task_id,
          title,
          type,
          status,
          path,
          agent,
          model,
          source_run_id,
          description,
          version_number,
          redaction_json,
          deliverable_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `
    );

    for (const deliverable of deliverables) {
      statement.run(
        deliverable.id,
        this.workspaceIdFor(task, deliverable.workspaceId),
        task.id,
        deliverable.title,
        deliverable.type,
        deliverable.status,
        deliverable.path ?? null,
        deliverable.agent ?? null,
        deliverable.model ?? null,
        deliverable.sourceRunId ?? null,
        deliverable.description ?? null,
        this.deliverableVersion(deliverable),
        this.optionalJson(deliverable.redaction),
        JSON.stringify(deliverable),
        deliverable.created,
        deliverable.updated ?? null
      );
    }
  }

  private deleteArtifactRows(taskId: string): void {
    const db = this.database.getConnection();
    db.prepare('DELETE FROM task_deliverables WHERE task_id = ?;').run(taskId);
    db.prepare('DELETE FROM task_attachments WHERE task_id = ?;').run(taskId);
  }

  private upsertSearchRow(task: Task, state: TaskStorageState): void {
    this.deleteSearchRow(task.id);

    if (state !== 'active') {
      return;
    }

    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO task_search (task_id, title, description)
          VALUES (?, ?, ?)
        `
      )
      .run(task.id, task.title, task.description ?? '');
  }

  private deleteSearchRow(taskId: string): void {
    this.database.getConnection().prepare('DELETE FROM task_search WHERE task_id = ?;').run(taskId);
  }

  private parseTask(row: TaskRow): Task {
    return JSON.parse(row.task_json) as Task;
  }

  private workspaceIdFor(task: Task, explicitWorkspaceId?: string): string {
    return explicitWorkspaceId ?? (task as Task & { workspaceId?: string }).workspaceId ?? 'local';
  }

  private attachmentStoragePath(taskId: string, attachment: Attachment): string {
    if (attachment.storagePath && attachment.storagePath.trim().length > 0) {
      return attachment.storagePath;
    }

    const taskPathSegment = taskId.replace(/[^a-zA-Z0-9_-]/g, '');
    return ['tasks', 'attachments', taskPathSegment, attachment.filename].join('/');
  }

  private deliverableVersion(deliverable: Deliverable): number {
    return Number.isInteger(deliverable.version) && (deliverable.version ?? 0) > 0
      ? (deliverable.version as number)
      : 1;
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

  private transaction<T>(callback: () => T): T {
    const db = this.database.getConnection();

    try {
      db.exec('BEGIN IMMEDIATE;');
      const result = callback();
      db.exec('COMMIT;');
      return result;
    } catch (error) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        // Preserve the original failure.
      }
      throw error;
    }
  }
}

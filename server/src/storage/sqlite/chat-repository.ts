import type { SQLInputValue } from 'node:sqlite';
import type { ChatMessage, ChatSession, SquadMessage } from '@veritas-kanban/shared';
import type { SqliteDatabase } from './database.js';

interface ChatSessionRow {
  id: string;
  session_json: string;
}

interface ChatMessageRow {
  message_json: string;
}

interface SquadMessageRow {
  message_json: string;
}

export class SqliteChatRepository {
  constructor(private readonly database: SqliteDatabase) {}

  getSession(sessionId: string): ChatSession | null {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT id, session_json
          FROM chat_sessions
          WHERE workspace_id = 'local'
            AND id = ?
        `
      )
      .get(sessionId) as ChatSessionRow | undefined;

    return row ? this.hydrateSession(row) : null;
  }

  getSessionForTask(taskId: string): ChatSession | null {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT id, session_json
          FROM chat_sessions
          WHERE workspace_id = 'local'
            AND task_id = ?
        `
      )
      .get(taskId) as ChatSessionRow | undefined;

    return row ? this.hydrateSession(row) : null;
  }

  listBoardSessions(): ChatSession[] {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT id, session_json
          FROM chat_sessions
          WHERE workspace_id = 'local'
            AND task_id IS NULL
          ORDER BY datetime(updated_at) DESC, id DESC
        `
      )
      .all() as unknown as ChatSessionRow[];

    return rows.map((row) => this.hydrateSession(row));
  }

  saveSession(session: ChatSession): void {
    const db = this.database.getConnection();

    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare(
        `
          INSERT INTO chat_sessions (
            id,
            workspace_id,
            task_id,
            title,
            agent,
            model,
            mode,
            session_json,
            created_at,
            updated_at
          )
          VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            task_id = excluded.task_id,
            title = excluded.title,
            agent = excluded.agent,
            model = excluded.model,
            mode = excluded.mode,
            session_json = excluded.session_json,
            updated_at = excluded.updated_at
        `
      ).run(
        session.id,
        session.taskId ?? null,
        session.title,
        session.agent,
        session.model ?? null,
        session.mode,
        JSON.stringify({ ...session, messages: [] }),
        session.created,
        session.updated
      );

      db.prepare("DELETE FROM chat_messages WHERE workspace_id = 'local' AND session_id = ?").run(
        session.id
      );

      const insertMessage = db.prepare(
        `
          INSERT INTO chat_messages (
            id,
            workspace_id,
            session_id,
            task_id,
            role,
            agent,
            model,
            message_json,
            created_at
          )
          VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?)
        `
      );

      for (const message of session.messages) {
        insertMessage.run(
          message.id,
          session.id,
          session.taskId ?? null,
          message.role,
          message.agent ?? null,
          message.model ?? null,
          JSON.stringify(message),
          message.timestamp
        );
      }

      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }

  deleteSession(sessionId: string): boolean {
    const result = this.database
      .getConnection()
      .prepare(
        `
          DELETE FROM chat_sessions
          WHERE workspace_id = 'local'
            AND id = ?
        `
      )
      .run(sessionId);

    return Number(result.changes) > 0;
  }

  appendSquadMessage(message: SquadMessage): void {
    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO squad_messages (
            id,
            workspace_id,
            agent,
            display_name,
            message,
            tags_json,
            timestamp,
            model,
            is_system,
            event,
            task_title,
            duration,
            card_json,
            message_json
          )
          VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        message.id,
        message.agent,
        message.displayName ?? null,
        message.message,
        message.tags ? JSON.stringify(message.tags) : null,
        message.timestamp,
        message.model ?? null,
        message.system ? 1 : 0,
        message.event ?? null,
        message.taskTitle ?? null,
        message.duration ?? null,
        message.card ? JSON.stringify(message.card) : null,
        JSON.stringify(message)
      );
  }

  listSquadMessages(
    options: {
      since?: string;
      agent?: string;
      limit?: number;
      includeSystem?: boolean;
    } = {}
  ): SquadMessage[] {
    const clauses = ["workspace_id = 'local'"];
    const params: SQLInputValue[] = [];
    const sinceTimestamp =
      options.since && !Number.isNaN(Date.parse(options.since)) ? options.since : null;

    if (sinceTimestamp) {
      clauses.push('timestamp >= ?');
      params.push(sinceTimestamp);
    }
    if (options.agent) {
      clauses.push('agent = ?');
      params.push(options.agent);
    }
    if (options.includeSystem === false) {
      clauses.push('is_system = 0');
    }

    const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : null;
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT message_json
          FROM squad_messages
          WHERE ${clauses.join(' AND ')}
          ORDER BY datetime(timestamp) ${limit ? 'DESC' : 'ASC'}, id ${limit ? 'DESC' : 'ASC'}
          ${limit ? 'LIMIT ?' : ''}
        `
      )
      .all(...(limit ? [...params, limit] : params)) as unknown as SquadMessageRow[];

    const messages = rows.map((row) => JSON.parse(row.message_json) as SquadMessage);
    return limit ? messages.reverse() : messages;
  }

  private hydrateSession(row: ChatSessionRow): ChatSession {
    const session = JSON.parse(row.session_json) as ChatSession;
    session.messages = this.listMessages(row.id);
    return session;
  }

  private listMessages(sessionId: string): ChatMessage[] {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT message_json
          FROM chat_messages
          WHERE workspace_id = 'local'
            AND session_id = ?
          ORDER BY datetime(created_at) ASC, id ASC
        `
      )
      .all(sessionId) as unknown as ChatMessageRow[];

    return rows.map((row) => JSON.parse(row.message_json) as ChatMessage);
  }
}

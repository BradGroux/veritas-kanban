import type { SqliteDatabase } from './database.js';

interface TransactionRow {
  payload: string;
  expires_at: number;
}

export class SqliteOpenAiOidcTransactionRepository {
  constructor(private readonly database: SqliteDatabase) {}

  store(input: { id: string; payload: string; expiresAt: number }): void {
    const db = this.database.getConnection();
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare('DELETE FROM openai_oidc_transactions WHERE expires_at <= ?').run(Date.now());
      db.prepare(
        `
          INSERT INTO openai_oidc_transactions (id, payload, expires_at, created_at)
          VALUES (?, ?, ?, ?)
        `
      ).run(input.id, input.payload, input.expiresAt, new Date().toISOString());
      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }

  consume(id: string, now = Date.now()): string | null {
    const db = this.database.getConnection();
    db.exec('BEGIN IMMEDIATE;');
    try {
      const row = db
        .prepare('SELECT payload, expires_at FROM openai_oidc_transactions WHERE id = ?')
        .get(id) as TransactionRow | undefined;
      db.prepare('DELETE FROM openai_oidc_transactions WHERE id = ?').run(id);
      db.exec('COMMIT;');
      return row && row.expires_at > now ? row.payload : null;
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }
}

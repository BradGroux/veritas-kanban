import { nanoid } from 'nanoid';
import type { ManagedListItem } from '@veritas-kanban/shared';
import type { ManagedListProvider, ManagedListRepository } from '../interfaces.js';
import type { ManagedListServiceConfig } from '../../services/managed-list-service.js';
import type { SqliteDatabase } from './database.js';

interface ManagedListRow {
  item_json: string;
}

export class SqliteManagedListRepository<
  T extends ManagedListItem,
> implements ManagedListRepository<T> {
  private readonly listName: string;
  private readonly defaults: T[];
  private readonly referenceCounter?: (id: string) => Promise<number>;

  constructor(
    private readonly database: SqliteDatabase,
    config: ManagedListServiceConfig<T>
  ) {
    this.listName = config.filename.replace(/\.[^.]+$/, '');
    this.defaults = config.defaults;
    this.referenceCounter = config.referenceCounter;
  }

  async init(): Promise<void> {
    const count = this.database
      .getConnection()
      .prepare('SELECT COUNT(*) AS count FROM managed_list_items WHERE list_name = ?')
      .get(this.listName) as { count: number };

    if (count.count === 0 && this.defaults.length > 0) {
      this.transaction(() => {
        for (const item of this.defaults) {
          this.insertItem(item);
        }
      });
    }
  }

  async list(includeHidden = false): Promise<T[]> {
    await this.init();

    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT item_json
          FROM managed_list_items
          WHERE list_name = ?
            AND (? = 1 OR is_hidden = 0)
          ORDER BY order_index ASC, item_id ASC
        `
      )
      .all(this.listName, includeHidden ? 1 : 0) as unknown as ManagedListRow[];

    return rows.map((row) => this.parseItem(row));
  }

  async get(id: string): Promise<T | null> {
    await this.init();

    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT item_json
          FROM managed_list_items
          WHERE list_name = ?
            AND item_id = ?
        `
      )
      .get(this.listName, id) as ManagedListRow | undefined;

    return row ? this.parseItem(row) : null;
  }

  async create(input: Omit<T, 'order' | 'created' | 'updated'> & { id?: string }): Promise<T> {
    await this.init();

    const now = new Date().toISOString();
    const id =
      input.id || `${this.slugify((input as Pick<ManagedListItem, 'label'>).label)}-${nanoid(6)}`;

    if (await this.get(id)) {
      throw new Error(`Item with id '${id}' already exists`);
    }

    const maxOrder = this.database
      .getConnection()
      .prepare(
        `
          SELECT MAX(order_index) AS maxOrder
          FROM managed_list_items
          WHERE list_name = ?
        `
      )
      .get(this.listName) as { maxOrder: number | null };

    const item = {
      ...input,
      id,
      order: (maxOrder.maxOrder ?? -1) + 1,
      created: now,
      updated: now,
    } as T;

    this.insertItem(item);
    return item;
  }

  async seedItem(item: T): Promise<T> {
    await this.init();
    this.insertItem(item);
    return item;
  }

  async update(id: string, patch: Partial<T>): Promise<T | null> {
    await this.init();

    const existing = await this.get(id);
    if (!existing) return null;

    const updated = {
      ...existing,
      ...patch,
      id,
      updated: new Date().toISOString(),
    } as T;

    this.upsertItem(updated);
    return updated;
  }

  async canDelete(
    id: string
  ): Promise<{ allowed: boolean; referenceCount: number; isDefault: boolean }> {
    await this.init();

    const item = await this.get(id);
    if (!item) {
      return { allowed: false, referenceCount: 0, isDefault: false };
    }

    const referenceCount = this.referenceCounter ? await this.referenceCounter(id) : 0;
    return {
      allowed: referenceCount === 0,
      referenceCount,
      isDefault: item.isDefault ?? false,
    };
  }

  async delete(id: string, force = false): Promise<{ deleted: boolean; referenceCount?: number }> {
    await this.init();

    const item = await this.get(id);
    if (!item) {
      return { deleted: false };
    }

    if (!force && this.referenceCounter) {
      const referenceCount = await this.referenceCounter(id);
      if (referenceCount > 0) {
        return { deleted: false, referenceCount };
      }
    }

    const result = this.database
      .getConnection()
      .prepare('DELETE FROM managed_list_items WHERE list_name = ? AND item_id = ?')
      .run(this.listName, id);

    return { deleted: result.changes > 0 };
  }

  async reorder(orderedIds: string[]): Promise<T[]> {
    await this.init();

    const orderMap = new Map<string, number>();
    orderedIds.forEach((id, index) => {
      orderMap.set(id, index);
    });

    const items = await this.list(true);
    const now = new Date().toISOString();

    this.transaction(() => {
      for (const item of items) {
        const newOrder = orderMap.get(item.id);
        if (newOrder !== undefined) {
          this.upsertItem({
            ...item,
            order: newOrder,
            updated: now,
          });
        }
      }
    });

    return this.list(true);
  }

  private insertItem(item: T): void {
    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO managed_list_items (
            list_name,
            item_id,
            item_json,
            order_index,
            is_default,
            is_hidden,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        this.listName,
        item.id,
        JSON.stringify(item),
        item.order,
        item.isDefault ? 1 : 0,
        item.isHidden ? 1 : 0,
        item.created,
        item.updated
      );
  }

  private upsertItem(item: T): void {
    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO managed_list_items (
            list_name,
            item_id,
            item_json,
            order_index,
            is_default,
            is_hidden,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(list_name, item_id) DO UPDATE SET
            item_json = excluded.item_json,
            order_index = excluded.order_index,
            is_default = excluded.is_default,
            is_hidden = excluded.is_hidden,
            updated_at = excluded.updated_at
        `
      )
      .run(
        this.listName,
        item.id,
        JSON.stringify(item),
        item.order,
        item.isDefault ? 1 : 0,
        item.isHidden ? 1 : 0,
        item.created,
        item.updated
      );
  }

  private parseItem(row: ManagedListRow): T {
    return JSON.parse(row.item_json) as T;
  }

  private slugify(label: string): string {
    return label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private transaction<TValue>(callback: () => TValue): TValue {
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

export class SqliteManagedListProvider implements ManagedListProvider {
  constructor(private readonly database: SqliteDatabase) {}

  create<T extends ManagedListItem>(config: ManagedListServiceConfig<T>): ManagedListRepository<T> {
    return new SqliteManagedListRepository(this.database, config);
  }
}

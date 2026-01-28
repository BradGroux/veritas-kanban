import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import type { ManagedListItem } from '@veritas-kanban/shared';

export interface ManagedListServiceConfig<T extends ManagedListItem> {
  filename: string;
  configDir: string;
  defaults: T[];
  referenceCounter?: (id: string) => Promise<number>;
}

export class ManagedListService<T extends ManagedListItem> {
  private items: T[] = [];
  private filePath: string;
  private defaults: T[];
  private referenceCounter?: (id: string) => Promise<number>;

  constructor(config: ManagedListServiceConfig<T>) {
    this.filePath = join(config.configDir, config.filename);
    this.defaults = config.defaults;
    this.referenceCounter = config.referenceCounter;
  }

  /**
   * Initialize service: ensure config dir exists and seed file if missing
   */
  async init(): Promise<void> {
    const configDir = this.filePath.substring(0, this.filePath.lastIndexOf('/'));

    if (!existsSync(configDir)) {
      await mkdir(configDir, { recursive: true });
    }

    if (!existsSync(this.filePath)) {
      // Seed with defaults
      this.items = [...this.defaults];
      await this.save();
    } else {
      await this.load();
    }
  }

  /**
   * Load items from JSON file
   */
  private async load(): Promise<void> {
    try {
      const content = await readFile(this.filePath, 'utf-8');
      this.items = JSON.parse(content);
    } catch (err) {
      console.error('Error loading managed list:', err);
      this.items = [...this.defaults];
    }
  }

  /**
   * Save items to JSON file
   */
  private async save(): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(this.items, null, 2), 'utf-8');
  }

  /**
   * Generate a slug from a label
   */
  private slugify(label: string): string {
    return label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * List all items, optionally including hidden items
   */
  async list(includeHidden = false): Promise<T[]> {
    await this.init();

    let result = [...this.items];

    if (!includeHidden) {
      result = result.filter((item) => !item.isHidden);
    }

    return result.sort((a, b) => a.order - b.order);
  }

  /**
   * Get a single item by ID
   */
  async get(id: string): Promise<T | null> {
    await this.init();
    return this.items.find((item) => item.id === id) || null;
  }

  /**
   * Create a new item
   */
  async create(input: Omit<T, 'id' | 'order' | 'created' | 'updated'>): Promise<T> {
    await this.init();

    const now = new Date().toISOString();
    // T extends ManagedListItem which has 'label'; Omit preserves it
    const slug = this.slugify((input as Pick<ManagedListItem, 'label'>).label);
    const shortId = nanoid(6);
    const id = `${slug}-${shortId}`;

    // Calculate order as max + 1
    const maxOrder = this.items.length > 0 ? Math.max(...this.items.map((item) => item.order)) : -1;

    const newItem: T = {
      ...input,
      id,
      order: maxOrder + 1,
      created: now,
      updated: now,
    } as T;

    this.items.push(newItem);
    await this.save();

    return newItem;
  }

  /**
   * Seed a pre-built item with a specific ID (for migrations)
   * Skips ID generation — caller provides the full item
   */
  async seedItem(item: T): Promise<T> {
    this.items.push(item);
    await this.save();
    return item;
  }

  /**
   * Update an existing item
   */
  async update(id: string, patch: Partial<T>): Promise<T | null> {
    await this.init();

    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) return null;

    const updated: T = {
      ...this.items[index],
      ...patch,
      id, // Preserve ID
      updated: new Date().toISOString(),
    };

    this.items[index] = updated;
    await this.save();

    return updated;
  }

  /**
   * Check if an item can be deleted
   */
  async canDelete(
    id: string
  ): Promise<{ allowed: boolean; referenceCount: number; isDefault: boolean }> {
    await this.init();

    const item = this.items.find((item) => item.id === id);
    if (!item) {
      return { allowed: false, referenceCount: 0, isDefault: false };
    }

    const isDefault = item.isDefault || false;
    const referenceCount = this.referenceCounter ? await this.referenceCounter(id) : 0;

    return {
      allowed: referenceCount === 0,
      referenceCount,
      isDefault,
    };
  }

  /**
   * Delete an item
   */
  async delete(id: string, force = false): Promise<{ deleted: boolean; referenceCount?: number }> {
    await this.init();

    const item = this.items.find((item) => item.id === id);
    if (!item) {
      return { deleted: false };
    }

    // Check references if not forced
    if (!force && this.referenceCounter) {
      const referenceCount = await this.referenceCounter(id);
      if (referenceCount > 0) {
        return { deleted: false, referenceCount };
      }
    }

    this.items = this.items.filter((item) => item.id !== id);
    await this.save();

    return { deleted: true };
  }

  /**
   * Reorder items by providing ordered IDs
   */
  async reorder(orderedIds: string[]): Promise<T[]> {
    await this.init();

    // Create a map of id -> new order
    const orderMap = new Map<string, number>();
    orderedIds.forEach((id, index) => {
      orderMap.set(id, index);
    });

    // Update order for items in the list
    this.items.forEach((item) => {
      const newOrder = orderMap.get(item.id);
      if (newOrder !== undefined) {
        item.order = newOrder;
        item.updated = new Date().toISOString();
      }
    });

    await this.save();

    return this.items.sort((a, b) => a.order - b.order);
  }
}

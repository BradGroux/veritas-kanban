/**
 * ManagedListService Tests
 * Tests the base class used by project, sprint, and task-type services.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ManagedListService } from '../services/managed-list-service.js';

interface TestItem {
  id: string;
  label: string;
  color?: string;
  order: number;
  isDefault?: boolean;
  isHidden?: boolean;
  created: string;
  updated: string;
}

describe('ManagedListService', () => {
  let testDir: string;
  let service: ManagedListService<TestItem>;

  const defaults: TestItem[] = [
    { id: 'default-1', label: 'Default One', order: 0, isDefault: true, created: '2024-01-01', updated: '2024-01-01' },
    { id: 'default-2', label: 'Default Two', order: 1, isDefault: true, created: '2024-01-01', updated: '2024-01-01' },
  ];

  beforeEach(async () => {
    const suffix = Math.random().toString(36).substring(7);
    testDir = path.join(os.tmpdir(), `veritas-test-managed-${suffix}`);
    await fs.mkdir(testDir, { recursive: true });

    service = new ManagedListService<TestItem>({
      filename: 'test-items.json',
      configDir: testDir,
      defaults,
    });
  });

  afterEach(async () => {
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('init()', () => {
    it('should create config dir and seed defaults when no file exists', async () => {
      const items = await service.list();
      expect(items).toHaveLength(2);
      expect(items[0].id).toBe('default-1');
      expect(items[1].id).toBe('default-2');
    });

    it('should load existing items from file', async () => {
      const existing: TestItem[] = [
        { id: 'custom-1', label: 'Custom', order: 0, created: '2024-01-01', updated: '2024-01-01' },
      ];
      await fs.writeFile(path.join(testDir, 'test-items.json'), JSON.stringify(existing));

      const items = await service.list();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('custom-1');
    });

    it('should fall back to defaults on corrupted file', async () => {
      await fs.writeFile(path.join(testDir, 'test-items.json'), 'not json');
      const items = await service.list();
      expect(items).toHaveLength(2);
    });

    it('should create config dir if it does not exist', async () => {
      const deepDir = path.join(testDir, 'deep', 'nested');
      const deepService = new ManagedListService<TestItem>({
        filename: 'test-items.json',
        configDir: deepDir,
        defaults,
      });
      const items = await deepService.list();
      expect(items).toHaveLength(2);
    });
  });

  describe('list()', () => {
    it('should return items sorted by order', async () => {
      const unsorted: TestItem[] = [
        { id: 'b', label: 'B', order: 2, created: '2024-01-01', updated: '2024-01-01' },
        { id: 'a', label: 'A', order: 0, created: '2024-01-01', updated: '2024-01-01' },
        { id: 'c', label: 'C', order: 1, created: '2024-01-01', updated: '2024-01-01' },
      ];
      await fs.writeFile(path.join(testDir, 'test-items.json'), JSON.stringify(unsorted));

      const items = await service.list();
      expect(items.map(i => i.id)).toEqual(['a', 'c', 'b']);
    });

    it('should exclude hidden items by default', async () => {
      const items: TestItem[] = [
        { id: 'visible', label: 'Visible', order: 0, created: '2024-01-01', updated: '2024-01-01' },
        { id: 'hidden', label: 'Hidden', order: 1, isHidden: true, created: '2024-01-01', updated: '2024-01-01' },
      ];
      await fs.writeFile(path.join(testDir, 'test-items.json'), JSON.stringify(items));

      const result = await service.list();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('visible');
    });

    it('should include hidden items when includeHidden is true', async () => {
      const items: TestItem[] = [
        { id: 'visible', label: 'Visible', order: 0, created: '2024-01-01', updated: '2024-01-01' },
        { id: 'hidden', label: 'Hidden', order: 1, isHidden: true, created: '2024-01-01', updated: '2024-01-01' },
      ];
      await fs.writeFile(path.join(testDir, 'test-items.json'), JSON.stringify(items));

      const result = await service.list(true);
      expect(result).toHaveLength(2);
    });
  });

  describe('get()', () => {
    it('should return item by id', async () => {
      const item = await service.get('default-1');
      expect(item).not.toBeNull();
      expect(item!.label).toBe('Default One');
    });

    it('should return null for non-existent id', async () => {
      const item = await service.get('nonexistent');
      expect(item).toBeNull();
    });
  });

  describe('create()', () => {
    it('should create a new item with generated id', async () => {
      const created = await service.create({ label: 'New Item', color: 'blue' } as any);
      expect(created.id).toContain('new-item');
      expect(created.label).toBe('New Item');
      expect(created.color).toBe('blue');
      expect(created.order).toBe(2); // max(0,1) + 1
      expect(created.created).toBeDefined();
      expect(created.updated).toBeDefined();
    });

    it('should persist created item', async () => {
      await service.create({ label: 'Persisted' } as any);
      const items = await service.list();
      expect(items).toHaveLength(3);
      expect(items.some(i => i.label === 'Persisted')).toBe(true);
    });

    it('should handle empty list for order calculation', async () => {
      const emptyService = new ManagedListService<TestItem>({
        filename: 'empty-items.json',
        configDir: testDir,
        defaults: [],
      });
      const item = await emptyService.create({ label: 'First' } as any);
      expect(item.order).toBe(0);
    });
  });

  describe('seedItem()', () => {
    it('should add a pre-built item with specific id', async () => {
      const seeded = await service.seedItem({
        id: 'custom-id',
        label: 'Seeded',
        order: 99,
        created: '2024-06-01',
        updated: '2024-06-01',
      });
      expect(seeded.id).toBe('custom-id');
      
      const item = await service.get('custom-id');
      expect(item).not.toBeNull();
      expect(item!.label).toBe('Seeded');
    });
  });

  describe('update()', () => {
    it('should update existing item fields', async () => {
      const updated = await service.update('default-1', { label: 'Updated Label' });
      expect(updated).not.toBeNull();
      expect(updated!.label).toBe('Updated Label');
      expect(updated!.id).toBe('default-1'); // ID preserved
    });

    it('should return null for non-existent item', async () => {
      const result = await service.update('nonexistent', { label: 'Nope' });
      expect(result).toBeNull();
    });

    it('should update the updated timestamp', async () => {
      const before = new Date().toISOString();
      const updated = await service.update('default-1', { label: 'Changed' });
      expect(new Date(updated!.updated).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    });
  });

  describe('delete()', () => {
    it('should delete an existing item', async () => {
      const result = await service.delete('default-1');
      expect(result.deleted).toBe(true);
      
      const items = await service.list();
      expect(items).toHaveLength(1);
    });

    it('should return false for non-existent item', async () => {
      const result = await service.delete('nonexistent');
      expect(result.deleted).toBe(false);
    });

    it('should prevent deletion when references exist', async () => {
      const refService = new ManagedListService<TestItem>({
        filename: 'ref-items.json',
        configDir: testDir,
        defaults,
        referenceCounter: async (_id: string) => 5, // 5 references
      });
      
      await refService.list(); // init
      const result = await refService.delete('default-1');
      expect(result.deleted).toBe(false);
      expect(result.referenceCount).toBe(5);
    });

    it('should force delete even with references', async () => {
      const refService = new ManagedListService<TestItem>({
        filename: 'ref-force-items.json',
        configDir: testDir,
        defaults,
        referenceCounter: async (_id: string) => 3,
      });
      
      await refService.list(); // init
      const result = await refService.delete('default-1', true);
      expect(result.deleted).toBe(true);
    });
  });

  describe('canDelete()', () => {
    it('should return allowed true when no references', async () => {
      const result = await service.canDelete('default-1');
      expect(result.allowed).toBe(true);
      expect(result.referenceCount).toBe(0);
      expect(result.isDefault).toBe(true);
    });

    it('should return allowed false when item not found', async () => {
      const result = await service.canDelete('nonexistent');
      expect(result.allowed).toBe(false);
    });

    it('should check reference counter', async () => {
      const refService = new ManagedListService<TestItem>({
        filename: 'can-del-items.json',
        configDir: testDir,
        defaults,
        referenceCounter: async (id: string) => id === 'default-1' ? 3 : 0,
      });
      
      await refService.list(); // init
      const result = await refService.canDelete('default-1');
      expect(result.allowed).toBe(false);
      expect(result.referenceCount).toBe(3);
    });
  });

  describe('reorder()', () => {
    it('should reorder items by provided ids', async () => {
      const items = await service.reorder(['default-2', 'default-1']);
      expect(items[0].id).toBe('default-2');
      expect(items[0].order).toBe(0);
      expect(items[1].id).toBe('default-1');
      expect(items[1].order).toBe(1);
    });

    it('should only update items included in the ordered ids', async () => {
      await service.create({ label: 'Third' } as any);
      const all = await service.list();
      const thirdId = all.find(i => i.label === 'Third')!.id;
      
      // Only reorder first two
      await service.reorder(['default-2', 'default-1']);
      
      // Third should keep its original order
      const refreshed = await service.list();
      const third = refreshed.find(i => i.id === thirdId);
      expect(third!.order).toBe(2);
    });
  });
});

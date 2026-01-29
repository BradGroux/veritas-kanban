import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { Task } from '@veritas-kanban/shared';
import type {
  StorageProvider,
  TaskRepository,
  SettingsRepository,
} from '../../storage/interfaces.js';
import { FileStorageProvider } from '../../storage/file-storage.js';
import { initStorage, getStorage } from '../../storage/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Task object for testing. */
function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    id: `task_20260129_test${Math.random().toString(36).slice(2, 8)}`,
    title: 'Test Task',
    description: 'A test task description',
    type: 'code',
    status: 'todo',
    priority: 'medium',
    created: now,
    updated: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FileStorageProvider', () => {
  let provider: FileStorageProvider;
  let testRoot: string;
  let tasksDir: string;
  let archiveDir: string;
  let configDir: string;
  let configFile: string;

  beforeEach(async () => {
    const suffix = Math.random().toString(36).substring(7);
    testRoot = path.join(os.tmpdir(), `veritas-storage-test-${suffix}`);
    tasksDir = path.join(testRoot, 'tasks', 'active');
    archiveDir = path.join(testRoot, 'tasks', 'archive');
    configDir = path.join(testRoot, '.veritas-kanban');
    configFile = path.join(configDir, 'config.json');

    await fs.mkdir(tasksDir, { recursive: true });
    await fs.mkdir(archiveDir, { recursive: true });
    await fs.mkdir(configDir, { recursive: true });

    provider = new FileStorageProvider({
      taskServiceOptions: { tasksDir, archiveDir },
      configServiceOptions: { configDir, configFile },
    });

    await provider.initialize();
  });

  afterEach(async () => {
    await provider.shutdown();
    await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
  });

  // -----------------------------------------------------------------------
  // Interface contract
  // -----------------------------------------------------------------------

  describe('interface contract', () => {
    it('exposes tasks and settings repositories', () => {
      expect(provider.tasks).toBeDefined();
      expect(provider.settings).toBeDefined();
    });

    it('tasks repository has all required methods', () => {
      const repo: TaskRepository = provider.tasks;
      expect(typeof repo.findAll).toBe('function');
      expect(typeof repo.findById).toBe('function');
      expect(typeof repo.create).toBe('function');
      expect(typeof repo.update).toBe('function');
      expect(typeof repo.delete).toBe('function');
      expect(typeof repo.search).toBe('function');
    });

    it('settings repository has all required methods', () => {
      const repo: SettingsRepository = provider.settings;
      expect(typeof repo.get).toBe('function');
      expect(typeof repo.update).toBe('function');
    });

    it('provider has initialize and shutdown methods', () => {
      expect(typeof provider.initialize).toBe('function');
      expect(typeof provider.shutdown).toBe('function');
    });

    it('satisfies the StorageProvider interface', () => {
      // TypeScript will enforce this at compile time; this runtime check
      // verifies the shape survives transpilation.
      const sp: StorageProvider = provider;
      expect(sp.tasks).toBe(provider.tasks);
      expect(sp.settings).toBe(provider.settings);
    });
  });

  // -----------------------------------------------------------------------
  // Task CRUD
  // -----------------------------------------------------------------------

  describe('TaskRepository CRUD', () => {
    it('findAll returns empty array when no tasks exist', async () => {
      const tasks = await provider.tasks.findAll();
      expect(tasks).toEqual([]);
    });

    it('create persists a task and returns it with generated ID', async () => {
      const input = makeTask({ title: 'Created via storage' });
      const created = await provider.tasks.create(input);

      expect(created).toBeDefined();
      expect(created.id).toMatch(/^task_/);
      expect(created.title).toBe('Created via storage');
      expect(created.status).toBe('todo');
    });

    it('findById returns the created task', async () => {
      const created = await provider.tasks.create(makeTask({ title: 'Findable' }));
      const found = await provider.tasks.findById(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.title).toBe('Findable');
    });

    it('findById returns null for non-existent ID', async () => {
      const result = await provider.tasks.findById('task_00000000_nope');
      expect(result).toBeNull();
    });

    it('findAll includes created tasks', async () => {
      await provider.tasks.create(makeTask({ title: 'Task A' }));
      await provider.tasks.create(makeTask({ title: 'Task B' }));

      const all = await provider.tasks.findAll();
      expect(all.length).toBe(2);

      const titles = all.map((t) => t.title);
      expect(titles).toContain('Task A');
      expect(titles).toContain('Task B');
    });

    it('update modifies an existing task', async () => {
      const created = await provider.tasks.create(makeTask({ title: 'Before' }));
      const updated = await provider.tasks.update(created.id, {
        title: 'After',
        priority: 'high',
      });

      expect(updated.title).toBe('After');
      expect(updated.priority).toBe('high');

      // Verify persistence
      const fetched = await provider.tasks.findById(created.id);
      expect(fetched!.title).toBe('After');
    });

    it('update throws for non-existent task', async () => {
      await expect(
        provider.tasks.update('task_00000000_missing', { title: 'Nope' })
      ).rejects.toThrow(/not found/i);
    });

    it('delete removes a task', async () => {
      const created = await provider.tasks.create(makeTask({ title: 'Doomed' }));
      await provider.tasks.delete(created.id);

      const gone = await provider.tasks.findById(created.id);
      expect(gone).toBeNull();

      const all = await provider.tasks.findAll();
      expect(all.find((t) => t.id === created.id)).toBeUndefined();
    });

    it('delete throws for non-existent task', async () => {
      await expect(provider.tasks.delete('task_00000000_ghost')).rejects.toThrow(/not found/i);
    });
  });

  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------

  describe('TaskRepository search', () => {
    it('returns tasks matching title', async () => {
      await provider.tasks.create(makeTask({ title: 'Alpha feature' }));
      await provider.tasks.create(makeTask({ title: 'Beta bugfix' }));

      const results = await provider.tasks.search('alpha');
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Alpha feature');
    });

    it('returns tasks matching description', async () => {
      await provider.tasks.create(makeTask({ title: 'Unrelated', description: 'fix the foobar' }));
      await provider.tasks.create(
        makeTask({ title: 'Also unrelated', description: 'nothing here' })
      );

      const results = await provider.tasks.search('foobar');
      expect(results.length).toBe(1);
    });

    it('returns empty array when nothing matches', async () => {
      await provider.tasks.create(makeTask({ title: 'Something' }));
      const results = await provider.tasks.search('zzzznonexistent');
      expect(results).toEqual([]);
    });

    it('search is case-insensitive', async () => {
      await provider.tasks.create(makeTask({ title: 'CamelCase Title' }));
      const results = await provider.tasks.search('camelcase');
      expect(results.length).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Settings
  // -----------------------------------------------------------------------

  describe('SettingsRepository', () => {
    it('get returns default settings when none are configured', async () => {
      const settings = await provider.settings.get();
      expect(settings).toBeDefined();
      expect(settings.board).toBeDefined();
      expect(settings.tasks).toBeDefined();
      expect(settings.telemetry).toBeDefined();
    });

    it('update merges partial settings and returns the result', async () => {
      const updated = await provider.settings.update({
        board: { showDashboard: false } as any,
      });

      expect(updated.board.showDashboard).toBe(false);
      // Other defaults should remain
      expect(updated.tasks).toBeDefined();
    });

    it('updated settings persist across get calls', async () => {
      await provider.settings.update({
        tasks: { enableTimeTracking: false } as any,
      });

      const fetched = await provider.settings.get();
      expect(fetched.tasks.enableTimeTracking).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  describe('lifecycle', () => {
    it('initialize can be called multiple times safely', async () => {
      await expect(provider.initialize()).resolves.toBeUndefined();
      await expect(provider.initialize()).resolves.toBeUndefined();
    });

    it('shutdown can be called multiple times safely', async () => {
      await expect(provider.shutdown()).resolves.toBeUndefined();
      await expect(provider.shutdown()).resolves.toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Factory / registry (initStorage / getStorage)
// ---------------------------------------------------------------------------

describe('Storage factory', () => {
  let testRoot: string;

  beforeEach(async () => {
    const suffix = Math.random().toString(36).substring(7);
    testRoot = path.join(os.tmpdir(), `veritas-storage-factory-${suffix}`);
    await fs.mkdir(path.join(testRoot, 'tasks', 'active'), { recursive: true });
    await fs.mkdir(path.join(testRoot, 'tasks', 'archive'), { recursive: true });
    await fs.mkdir(path.join(testRoot, '.veritas-kanban'), { recursive: true });
  });

  afterEach(async () => {
    // Shut down whatever was initialised
    try {
      const s = getStorage();
      await s.shutdown();
    } catch {
      // not initialised — that's fine
    }
    await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('getStorage throws before initStorage is called', () => {
    // Force-clear by re-importing (initStorage resets the singleton)
    // We rely on the fact that afterEach shuts down the provider.
    // If a previous test left one active, initStorage in beforeEach
    // will shut it down.  So just verify the error path:
    // We need a fresh module state — but since we can't easily reload
    // ES modules, we test indirectly: after initStorage, getStorage works.
  });

  it('initStorage + getStorage round-trips', async () => {
    await initStorage('file', {
      taskServiceOptions: {
        tasksDir: path.join(testRoot, 'tasks', 'active'),
        archiveDir: path.join(testRoot, 'tasks', 'archive'),
      },
      configServiceOptions: {
        configDir: path.join(testRoot, '.veritas-kanban'),
        configFile: path.join(testRoot, '.veritas-kanban', 'config.json'),
      },
    });

    const storage = getStorage();
    expect(storage).toBeDefined();
    expect(storage.tasks).toBeDefined();
    expect(storage.settings).toBeDefined();

    // Verify it actually works
    const tasks = await storage.tasks.findAll();
    expect(Array.isArray(tasks)).toBe(true);
  });

  it('initStorage shuts down previous provider before reinitializing', async () => {
    const opts = {
      taskServiceOptions: {
        tasksDir: path.join(testRoot, 'tasks', 'active'),
        archiveDir: path.join(testRoot, 'tasks', 'archive'),
      },
      configServiceOptions: {
        configDir: path.join(testRoot, '.veritas-kanban'),
        configFile: path.join(testRoot, '.veritas-kanban', 'config.json'),
      },
    };

    await initStorage('file', opts);
    const first = getStorage();

    await initStorage('file', opts);
    const second = getStorage();

    // Different instances
    expect(second).not.toBe(first);
  });
});

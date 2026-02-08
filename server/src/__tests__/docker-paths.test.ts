import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// Mock node:fs/promises while preserving the real module shape for Vitest
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const mocked: typeof actual = {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    stat: vi.fn().mockResolvedValue({ isDirectory: () => true, size: 0 }),
    access: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    statfs: vi.fn().mockResolvedValue({ bfree: 1024 * 1024, bsize: 1024 }),
  };
  return {
    ...mocked,
    default: mocked, // Vitest requires a default export when mocking ESM
  };
});

// Mock node:fs to prevent filesystem reads
vi.mock('node:fs', () => {
  const mockFs = {
    existsSync: vi.fn((path: string) => {
      if (typeof path === 'string' && path.includes('pnpm-workspace.yaml')) {
        return path === '/app/pnpm-workspace.yaml';
      }
      return false;
    }),
    readFileSync: vi.fn(() => ''),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
  return {
    ...mockFs,
    default: mockFs, // Provide default export
  };
});

describe('paths: Docker DATA_DIR support', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Set DATA_DIR before any imports to avoid the root === '/' check
    process.env.DATA_DIR = '/app/data';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('uses DATA_DIR as storage root for tasks and runtime state', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/app/server');

    // Force re-import to pick up mocked environment
    const paths = await import('../utils/paths.js?t=' + Date.now());

    expect(paths.getTasksActiveDir()).toBe('/app/data/tasks/active');
    expect(paths.getTasksArchiveDir()).toBe('/app/data/tasks/archive');
    expect(paths.getRuntimeDir()).toBe('/app/data/.veritas-kanban');
  });

  it('TaskService defaults to DATA_DIR-backed task directories when set', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/app/server');

    // Force re-import
    const { TaskService } = await import('../services/task-service.js?t=' + Date.now());
    const svc = new TaskService();

    // Private fields — ok for regression test
    expect((svc as any).tasksDir).toBe('/app/data/tasks/active');
    expect((svc as any).archiveDir).toBe('/app/data/tasks/archive');
  });
});

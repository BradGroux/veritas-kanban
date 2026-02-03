import { describe, it, expect, vi, afterEach } from 'vitest';

describe('paths: Docker DATA_DIR support', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('uses DATA_DIR as storage root for tasks and runtime state', async () => {
    process.env.DATA_DIR = '/app/data';

    vi.spyOn(process, 'cwd').mockReturnValue('/app/server');

    const paths = await import('../utils/paths.js');

    expect(paths.getTasksActiveDir()).toBe('/app/data/tasks/active');
    expect(paths.getTasksArchiveDir()).toBe('/app/data/tasks/archive');
    expect(paths.getRuntimeDir()).toBe('/app/data/.veritas-kanban');
  });

  it('TaskService defaults to DATA_DIR-backed task directories when set', async () => {
    process.env.DATA_DIR = '/app/data';

    vi.spyOn(process, 'cwd').mockReturnValue('/app/server');

    const { TaskService } = await import('../services/task-service.js');
    const svc = new TaskService();

    // Private fields — ok for regression test
    expect((svc as any).tasksDir).toBe('/app/data/tasks/active');
    expect((svc as any).archiveDir).toBe('/app/data/tasks/archive');
  });
});

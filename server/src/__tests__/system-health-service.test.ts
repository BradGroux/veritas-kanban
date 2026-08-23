import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const mockList = vi.fn();
const mockGetRunMetrics = vi.fn();

vi.mock('../services/agent-registry-service.js', () => ({
  getAgentRegistryService: () => ({ list: mockList }),
}));

vi.mock('../services/metrics/index.js', () => ({
  getMetricsService: () => ({ getRunMetrics: mockGetRunMetrics }),
}));

describe('SystemHealthService', () => {
  let tmpDir: string;
  let cwdSpy: any;
  let memSpy: any;

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'health-service-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    memSpy = vi
      .spyOn(process, 'memoryUsage')
      .mockReturnValue({ heapUsed: 50, heapTotal: 100 } as any);
    mockList.mockReturnValue([]);
    mockGetRunMetrics.mockResolvedValue({ runs: 0, successRate: 1, failures: 0, errors: 0 });
    process.env.DATA_DIR = 'data';
    await fs.mkdir(path.join(tmpDir, 'data', '.veritas-kanban'), { recursive: true });
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    memSpy.mockRestore();
    delete process.env.DATA_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('reports stable status when all signals are healthy', async () => {
    const mod = await import('../services/system-health-service.js');
    const status = await new mod.SystemHealthService().getStatus();
    expect(status.status).toBe('stable');
    expect(status.signals.system).toMatchObject({
      status: 'ok',
      storage: true,
      disk: true,
      memory: true,
    });
    expect(status.signals.agents).toMatchObject({ status: 'ok', total: 0, online: 0, offline: 0 });
  });

  it('degrades level for warnings, offline agents, and low success rate', async () => {
    memSpy.mockReturnValue({ heapUsed: 95, heapTotal: 100 } as any);
    mockList.mockReturnValue([{ status: 'online' }, { status: 'offline' }]);
    mockGetRunMetrics.mockResolvedValue({ runs: 10, successRate: 0.75, failures: 2, errors: 0 });

    const mod = await import('../services/system-health-service.js');
    const status = await new mod.SystemHealthService().getStatus();
    expect(status.signals.system.status).toBe('warn');
    expect(status.signals.agents.status).toBe('warn');
    expect(status.signals.operations.status).toBe('warn');
    expect(status.status).toBe('drifting');
  });

  it('returns elevated for critical agents/operations and alert for storage/disk failures', async () => {
    mockList.mockReturnValue([{ status: 'offline' }]);
    mockGetRunMetrics.mockResolvedValue({ runs: 2, successRate: 0.4, failures: 1, errors: 1 });

    const missingDir = path.join(tmpDir, 'missing');
    process.env.DATA_DIR = missingDir;

    const mod = await import('../services/system-health-service.js');
    const status = await new mod.SystemHealthService().getStatus();
    expect(status.signals.system.status).toBe('fail');
    expect(status.signals.operations.status).toBe('critical');
    expect(status.status).toBe('alert');
  });

  it('falls back safely when registry or metrics fail', async () => {
    mockList.mockImplementation(() => {
      throw new Error('registry broke');
    });
    mockGetRunMetrics.mockRejectedValue(new Error('metrics broke'));

    const mod = await import('../services/system-health-service.js');
    const status = await new mod.SystemHealthService().getStatus();
    expect(status.signals.agents).toMatchObject({ status: 'ok', total: 0, online: 0, offline: 0 });
    expect(status.signals.operations).toMatchObject({
      status: 'ok',
      recentRuns: 0,
      successRate: 100,
      failedRuns: 0,
    });
    expect(status.status).toBe('stable');
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SystemHealthService } from '../services/system-health-service.js';
import * as agentRegistryMod from '../services/agent-registry-service.js';
import * as metricsMod from '../services/metrics/index.js';
import fs from 'fs/promises';

// Mock fs/promises completely to avoid errors from other modules
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    default: {
      ...actual,
      access: vi.fn(),
      statfs: vi.fn(),
    },
    ...actual,
    access: vi.fn(),
    statfs: vi.fn(),
  };
});

describe('SystemHealthService', () => {
  let service: SystemHealthService;

  // Spies/mocks
  let accessSpy: any;
  let statfsSpy: any;
  let memoryUsageSpy: any;
  let listAgentsSpy: any;
  let getRunMetricsSpy: any;

  beforeEach(() => {
    service = new SystemHealthService();

    // Default: system all OK
    accessSpy = vi.spyOn(fs, 'access').mockResolvedValue(undefined as never);
    // 200MB free (need 100MB+)
    statfsSpy = vi.spyOn(fs, 'statfs').mockResolvedValue({
      bfree: 200 * 1024,
      bsize: 1024,
    } as any);

    // Default: memory OK (50% used)
    memoryUsageSpy = vi.spyOn(process, 'memoryUsage').mockReturnValue({
      heapUsed: 50,
      heapTotal: 100,
    } as any);

    // Default: agents OK (all online)
    listAgentsSpy = vi.fn().mockReturnValue([
      { id: 'agent-1', status: 'online' },
      { id: 'agent-2', status: 'idle' },
    ]);
    vi.spyOn(agentRegistryMod, 'getAgentRegistryService').mockReturnValue({
      list: listAgentsSpy,
    } as any);

    // Default: metrics OK (100% success rate, 10 runs)
    getRunMetricsSpy = vi.fn().mockResolvedValue({
      runs: 10,
      successRate: 1.0,
      failures: 0,
      errors: 0,
    });
    vi.spyOn(metricsMod, 'getMetricsService').mockReturnValue({
      getRunMetrics: getRunMetricsSpy,
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns stable when all systems are OK', async () => {
    const status = await service.getStatus();

    expect(status.status).toBe('stable');
    expect(status.signals.system.status).toBe('ok');
    expect(status.signals.agents.status).toBe('ok');
    expect(status.signals.operations.status).toBe('ok');
  });

  it('returns alert when storage access fails', async () => {
    accessSpy.mockRejectedValue(new Error('EACCES'));

    const status = await service.getStatus();

    expect(status.signals.system.status).toBe('fail');
    expect(status.status).toBe('alert');
  });

  it('returns alert when disk space is low', async () => {
    // 50MB free
    statfsSpy.mockResolvedValue({
      bfree: 50 * 1024,
      bsize: 1024,
    } as any);

    const status = await service.getStatus();

    expect(status.signals.system.status).toBe('fail');
    expect(status.status).toBe('alert');
  });

  it('returns reviewing when memory is high (1 warning)', async () => {
    // 95% used
    memoryUsageSpy.mockReturnValue({
      heapUsed: 95,
      heapTotal: 100,
    } as any);

    const status = await service.getStatus();

    expect(status.signals.system.status).toBe('warn');
    expect(status.status).toBe('reviewing');
  });

  it('returns elevated when all agents are offline', async () => {
    listAgentsSpy.mockReturnValue([
      { id: 'agent-1', status: 'offline' },
    ]);

    const status = await service.getStatus();

    expect(status.signals.agents.status).toBe('critical');
    expect(status.status).toBe('elevated');
  });

  it('returns drifting when some agents are offline', async () => {
    listAgentsSpy.mockReturnValue([
      { id: 'agent-1', status: 'online' },
      { id: 'agent-2', status: 'offline' },
    ]);

    const status = await service.getStatus();

    expect(status.signals.agents.status).toBe('warn');
    expect(status.status).toBe('drifting');
  });

  it('returns ok for agents when no agents exist', async () => {
    listAgentsSpy.mockReturnValue([]);

    const status = await service.getStatus();

    expect(status.signals.agents.status).toBe('ok');
    expect(status.status).toBe('stable');
  });

  it('returns alert when operations success rate < 50%', async () => {
    getRunMetricsSpy.mockResolvedValue({
      runs: 10,
      successRate: 0.4,
      failures: 6,
      errors: 0,
    });

    const status = await service.getStatus();

    expect(status.signals.operations.status).toBe('critical');
    // determineLevel says: if (system.status === 'fail' || operations.successRate < 50) return 'alert';
    expect(status.status).toBe('alert');
  });

  it('returns alert when operations status is critical (successRate < 50%)', async () => {
     getRunMetricsSpy.mockResolvedValue({
      runs: 10,
      successRate: 0.49,
      failures: 5,
      errors: 0,
    });

    const status = await service.getStatus();

    expect(status.signals.operations.status).toBe('critical');
    expect(status.status).toBe('alert');
  });

  it('returns reviewing when operations success rate is < 80% (1 warning)', async () => {
    getRunMetricsSpy.mockResolvedValue({
      runs: 10,
      successRate: 0.7,
      failures: 3,
      errors: 0,
    });

    const status = await service.getStatus();

    expect(status.signals.operations.status).toBe('warn');
    expect(status.status).toBe('reviewing');
  });

  it('returns drifting when 2+ warnings exist', async () => {
    // Warning 1: memory
    memoryUsageSpy.mockReturnValue({
      heapUsed: 95,
      heapTotal: 100,
    } as any);

    // Warning 2: operations
    getRunMetricsSpy.mockResolvedValue({
      runs: 10,
      successRate: 0.7,
      failures: 3,
      errors: 0,
    });

    const status = await service.getStatus();

    expect(status.signals.system.status).toBe('warn');
    expect(status.signals.operations.status).toBe('warn');
    expect(status.status).toBe('drifting');
  });

  it('handles registry read failure gracefully', async () => {
    listAgentsSpy.mockImplementation(() => { throw new Error('DB Down'); });

    const status = await service.getStatus();
    expect(status.signals.agents.status).toBe('ok');
    expect(status.status).toBe('stable');
  });

  it('handles operations metrics read failure gracefully', async () => {
    getRunMetricsSpy.mockRejectedValue(new Error('Metrics Down'));

    const status = await service.getStatus();
    expect(status.signals.operations.status).toBe('ok');
    expect(status.status).toBe('stable');
  });
});

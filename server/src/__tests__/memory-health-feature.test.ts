import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { MemoryPressureDiagnostics } from '@veritas-kanban/shared';

const { mockGetMemoryPressure, mockRegistry, mockMetrics } = vi.hoisted(() => ({
  mockGetMemoryPressure: vi.fn(),
  mockRegistry: { list: vi.fn() },
  mockMetrics: { getRunMetrics: vi.fn() },
}));

vi.mock('../utils/memory-pressure.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/memory-pressure.js')>()),
  getMemoryPressure: mockGetMemoryPressure,
}));

vi.mock('../services/agent-registry-service.js', () => ({
  getAgentRegistryService: () => mockRegistry,
}));

vi.mock('../services/metrics/index.js', () => ({
  getMetricsService: () => mockMetrics,
}));

import { classifyMemoryPressure } from '../utils/memory-pressure.js';
import { healthRouter } from '../routes/health.js';
import { systemHealthRouter } from '../routes/system-health.js';
import { errorHandler } from '../middleware/error-handler.js';

const healthyPressure = classifyMemoryPressure({
  heapUsedBytes: 95,
  heapAllocatedBytes: 100,
  heapLimitBytes: 1_000,
  rssBytes: 100,
  externalBytes: 5,
  effectiveMemoryLimitBytes: 2_000,
  effectiveMemoryLimitSource: 'process-constrained',
});

const warningPressure = classifyMemoryPressure({
  heapUsedBytes: 950,
  heapAllocatedBytes: 975,
  heapLimitBytes: 1_000,
  rssBytes: 100,
  externalBytes: 5,
  effectiveMemoryLimitBytes: 2_000,
  effectiveMemoryLimitSource: 'process-constrained',
});

describe('memory health feature', () => {
  let app: express.Express;
  let dataDir: string;
  const originalEnv = {
    dataDir: process.env.DATA_DIR,
    storage: process.env.VERITAS_STORAGE,
    adminKey: process.env.VERITAS_ADMIN_KEY,
    authEnabled: process.env.VERITAS_AUTH_ENABLED,
    nodeEnv: process.env.NODE_ENV,
  };

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-health-feature-'));
    const runtimeDir = path.join(dataDir, '.veritas-kanban');
    await fs.mkdir(runtimeDir, { recursive: true });
    await fs.writeFile(path.join(runtimeDir, 'tasks.json'), '[]');

    process.env.DATA_DIR = dataDir;
    process.env.VERITAS_STORAGE = 'file';
    process.env.VERITAS_ADMIN_KEY = 'test-admin-key-for-memory-health-feature';
    process.env.VERITAS_AUTH_ENABLED = 'true';
    process.env.NODE_ENV = 'development';

    mockRegistry.list.mockReturnValue([]);
    mockMetrics.getRunMetrics.mockResolvedValue({
      runs: 0,
      successRate: 1,
      failures: 0,
      errors: 0,
    });
    mockGetMemoryPressure.mockReturnValue(healthyPressure);

    app = express();
    app.use(express.json());
    app.use('/api/v1/system/health', systemHealthRouter);
    app.use('/health', healthRouter);
    app.use(errorHandler);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await fs.rm(dataDir, { recursive: true, force: true });

    restoreEnv('DATA_DIR', originalEnv.dataDir);
    restoreEnv('VERITAS_STORAGE', originalEnv.storage);
    restoreEnv('VERITAS_ADMIN_KEY', originalEnv.adminKey);
    restoreEnv('VERITAS_AUTH_ENABLED', originalEnv.authEnabled);
    restoreEnv('NODE_ENV', originalEnv.nodeEnv);
  });

  it('keeps normal V8 allocation healthy across the API and probe contracts', async () => {
    expect(healthyPressure).toMatchObject({
      status: 'ok',
      reason: 'within-limits',
      threshold: 0.9,
    });

    const [system, ready, deep] = await Promise.all([
      request(app).get('/api/v1/system/health'),
      request(app).get('/health/ready'),
      request(app).get('/health/deep').set('X-API-Key', 'test-admin-key-for-memory-health-feature'),
    ]);

    expect(system.body).toMatchObject({
      status: 'stable',
      signals: {
        system: {
          status: 'ok',
          memory: true,
          memoryPressure: healthyPressure,
        },
      },
    });
    expect(ready.body).toMatchObject({
      status: 'ok',
      checks: { memory: 'ok' },
      memoryPressure: healthyPressure,
    });
    expect(deep.body).toMatchObject({
      status: 'ok',
      checks: { memory: 'ok' },
      memoryPressure: healthyPressure,
    });
  });

  it('reports real pressure consistently without weakening one-warning severity', async () => {
    mockGetMemoryPressure.mockReturnValue(warningPressure satisfies MemoryPressureDiagnostics);

    const [system, ready, deep] = await Promise.all([
      request(app).get('/api/v1/system/health'),
      request(app).get('/health/ready'),
      request(app).get('/health/deep').set('X-API-Key', 'test-admin-key-for-memory-health-feature'),
    ]);

    expect(warningPressure).toMatchObject({
      status: 'warn',
      reason: 'v8-heap-limit',
      metric: 'heapUsed',
      usedBytes: 950,
      limitBytes: 1_000,
      utilization: 0.95,
    });
    expect(system.body).toMatchObject({
      status: 'reviewing',
      signals: { system: { status: 'warn', memory: false, memoryPressure: warningPressure } },
    });
    expect(ready.status).toBe(200);
    expect(ready.body).toMatchObject({
      status: 'degraded',
      checks: { memory: 'warn' },
      memoryPressure: warningPressure,
    });
    expect(deep.body).toMatchObject({
      status: 'degraded',
      checks: { memory: 'warn' },
      memoryPressure: warningPressure,
    });
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/**
 * Health Check Routes
 *
 * Three-tier health check system for container orchestration and monitoring:
 *   GET /health/live  — Liveness probe (unauthenticated)
 *   GET /health/ready — Readiness probe (unauthenticated)
 *   GET /health/deep  — Full diagnostics (admin only)
 */
import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { createLogger } from '../lib/logger.js';
import { authenticate, authorize, type AuthenticatedRequest } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { readRateLimit, writeRateLimit } from '../middleware/rate-limit.js';
import { getAllStatus as getCircuitBreakerStatus } from '../services/circuit-registry.js';
import { getDependencyCircuitControlService } from '../services/dependency-circuit-control-service.js';
import {
  getDependencyCircuitExecutionService,
  getDependencyCircuitRegistryService,
  storageDependencyIdentity,
} from '../services/dependency-circuit-runtime.js';
import { getSqliteStorageDiagnostics } from '../storage/sqlite/database.js';
import type { WebSocketServer } from 'ws';
import { getMemoryPressure } from '../utils/memory-pressure.js';
import { getRuntimeDir } from '../utils/paths.js';

const log = createLogger('health');
const dependencyCircuitKeySchema = z.string().trim().min(1).max(2_000);
const dependencyCircuitResetSchema = z
  .object({ reason: z.string().trim().min(8).max(1_000) })
  .strict();
const dependencyCircuitOverrideInputSchema = z
  .object({
    mode: z.enum(['allow', 'block']),
    reason: z.string().trim().min(8).max(1_000),
    durationSeconds: z.number().int().min(60).max(3_600),
  })
  .strict();

// ============================================
// WebSocket Server Reference
// ============================================
// Set by index.ts after WSS is created. Avoids circular import.
let _wss: WebSocketServer | null = null;

/**
 * Provide the WebSocket server reference for connection counting.
 * Called from index.ts after the WSS is created.
 */
export function setHealthWss(wss: WebSocketServer): void {
  _wss = wss;
}

// ============================================
// Helpers
// ============================================

/** Runtime health checks use the centralized storage-root contract. */
/**
 * Check that the data directory exists and is writable.
 */
async function checkStorage(): Promise<'ok' | 'fail'> {
  const dataDir = getRuntimeDir();
  try {
    await fs.access(dataDir, fs.constants.R_OK | fs.constants.W_OK);
    // Write and remove a temp file to verify actual write access
    const tmpFile = path.join(dataDir, `.health-check-${Date.now()}.tmp`);
    await fs.writeFile(tmpFile, 'ok');
    await fs.unlink(tmpFile);
    return 'ok';
  } catch (err) {
    log.warn({ err, dataDir }, 'Storage check failed');
    return 'fail';
  }
}

async function checkStorageThroughCircuit(): Promise<'ok' | 'fail'> {
  try {
    return await getDependencyCircuitExecutionService().execute(
      storageDependencyIdentity(process.env.VERITAS_STORAGE === 'sqlite' ? 'sqlite' : 'file'),
      async () => {
        const status = await checkStorage();
        if (status === 'fail') throw new Error('Storage health check failed.');
        return status;
      }
    );
  } catch {
    return 'fail';
  }
}

/**
 * Check that free disk space exceeds 100 MB.
 * Uses Node.js fs.statfs (available in Node 18.15+).
 */
async function checkDisk(): Promise<'ok' | 'fail'> {
  const dataDir = getRuntimeDir();
  try {
    const stats = await fs.statfs(dataDir);
    const freeBytes = stats.bfree * stats.bsize;
    const MIN_FREE_BYTES = 100 * 1024 * 1024; // 100 MB
    if (freeBytes < MIN_FREE_BYTES) {
      log.warn({ freeBytes, minRequired: MIN_FREE_BYTES }, 'Disk space low');
      return 'fail';
    }
    return 'ok';
  } catch (err) {
    log.warn({ err }, 'Disk check failed (statfs unavailable or error)');
    return 'fail';
  }
}

/**
 * Check that tasks.json is readable and valid JSON.
 */
async function checkTasksFile(): Promise<'ok' | 'fail'> {
  const dataDir = getRuntimeDir();
  const tasksPath = path.join(dataDir, 'tasks.json');
  try {
    const content = await fs.readFile(tasksPath, 'utf-8');
    JSON.parse(content);
    return 'ok';
  } catch (err) {
    // tasks.json may not exist yet in fresh installs — that's ok
    // only fail if the file exists but is corrupted
    try {
      await fs.access(tasksPath);
      // File exists but couldn't be parsed
      log.warn({ err, tasksPath }, 'tasks.json exists but is invalid');
      return 'fail';
    } catch {
      // File doesn't exist — not a failure for readiness
      return 'ok';
    }
  }
}

/**
 * Calculate the total size of the data directory (recursive).
 */
async function getDataDirSize(dirPath: string): Promise<number> {
  let totalSize = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isFile()) {
        const stat = await fs.stat(fullPath);
        totalSize += stat.size;
      } else if (entry.isDirectory()) {
        totalSize += await getDataDirSize(fullPath);
      }
    }
  } catch {
    // Ignore errors in size calculation
  }
  return totalSize;
}

// ============================================
// Router
// ============================================

export const healthRouter = Router();

/**
 * API-facing health router.
 *
 * Why this exists in addition to /health:
 * - /health is container/orchestrator friendly (live/ready/deep)
 * - /api/health is a canonical VK API signal used by dev tooling/watchdogs
 *   to distinguish "VK is healthy" from "something else is bound to :3001".
 */
export const apiHealthRouter = Router();

/**
 * GET /health/live — Liveness probe
 * Confirms process is running. Always returns 200.
 */
healthRouter.get('/live', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health/ready — Readiness probe
 * Checks storage, disk, memory, and data integrity.
 * Returns 200 if all pass, 503 if any critical check fails.
 */
healthRouter.get('/ready', async (_req, res) => {
  try {
    const [storage, disk, tasksFile] = await Promise.all([
      checkStorageThroughCircuit(),
      checkDisk(),
      checkTasksFile(),
    ]);
    const memoryPressure = getMemoryPressure();
    const memory = memoryPressure.status;
    const sqlite = getSqliteStorageDiagnostics();

    if (memory === 'warn') {
      log.warn({ memoryPressure }, 'Memory pressure high');
    }

    // Storage encompasses both the directory check and the tasks file check
    const storageStatus = storage === 'fail' || tasksFile === 'fail' ? 'fail' : 'ok';

    const checks = {
      storage: storageStatus as 'ok' | 'fail',
      memory,
      disk,
      ...(process.env.VERITAS_STORAGE === 'sqlite'
        ? { sqlite: sqlite?.healthPosture === 'refused' ? ('fail' as const) : ('ok' as const) }
        : {}),
    };

    const hasCriticalFailure =
      checks.storage === 'fail' ||
      checks.disk === 'fail' ||
      ('sqlite' in checks && checks.sqlite === 'fail');
    const status = hasCriticalFailure || memory === 'warn' ? 'degraded' : 'ok';
    const httpStatus = hasCriticalFailure ? 503 : 200;

    res.status(httpStatus).json({
      status,
      checks,
      memoryPressure,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log.error({ err }, 'Readiness check failed unexpectedly');
    res.status(503).json({
      status: 'degraded',
      checks: {
        storage: 'fail',
        memory: 'warn',
        disk: 'fail',
      },
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /health/deep — Full diagnostics (admin only)
 * Returns detailed system information. Always returns 200.
 */
async function buildDeepHealthPayload() {
  const [storage, disk, tasksFile] = await Promise.all([
    checkStorageThroughCircuit(),
    checkDisk(),
    checkTasksFile(),
  ]);
  const memoryPressure = getMemoryPressure();
  const memory = memoryPressure.status;

  const storageStatus = storage === 'fail' || tasksFile === 'fail' ? 'fail' : 'ok';
  const sqlite = getSqliteStorageDiagnostics();

  const dataDir = getRuntimeDir();
  let dataDirSize = 0;
  try {
    dataDirSize = await getDataDirSize(dataDir);
  } catch {
    // Ignore errors
  }

  // Read version from package.json
  let version = 'unknown';
  try {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
    version = pkg.version || 'unknown';
  } catch {
    // Ignore
  }

  // Get WebSocket connection count from the injected reference
  const wsConnections = _wss?.clients?.size;

  // Get circuit breaker status for all registered services
  const circuitBreakers = getCircuitBreakerStatus();
  let dependencyCircuits: Awaited<
    ReturnType<ReturnType<typeof getDependencyCircuitRegistryService>['listSnapshots']>
  > = [];
  let dependencyCircuitError: string | undefined;
  let dependencyCircuitOverrides: Awaited<
    ReturnType<ReturnType<typeof getDependencyCircuitRegistryService>['listOverrides']>
  > = [];
  try {
    [dependencyCircuits, dependencyCircuitOverrides] = await Promise.all([
      getDependencyCircuitRegistryService().listSnapshots(),
      getDependencyCircuitRegistryService().listOverrides(),
    ]);
  } catch (error) {
    dependencyCircuitError = error instanceof Error ? error.message : 'Unknown persistence error';
    log.warn({ err: error }, 'Dependency circuit diagnostics failed');
  }
  const dependencyCircuitSummary = {
    total: dependencyCircuits.length,
    closed: dependencyCircuits.filter((circuit) => circuit.state === 'closed').length,
    open: dependencyCircuits.filter((circuit) => circuit.state === 'open').length,
    halfOpen: dependencyCircuits.filter((circuit) => circuit.state === 'half-open').length,
  };

  return {
    status:
      storageStatus === 'fail' ||
      disk === 'fail' ||
      dependencyCircuitSummary.open > 0 ||
      dependencyCircuitSummary.halfOpen > 0 ||
      dependencyCircuitError !== undefined ||
      memory === 'warn' ||
      (process.env.VERITAS_STORAGE === 'sqlite' && sqlite?.healthPosture !== 'healthy')
        ? 'degraded'
        : 'ok',
    checks: {
      storage: storageStatus as 'ok' | 'fail',
      memory,
      disk,
    },
    uptime: process.uptime(),
    version,
    memoryPressure,
    memory: {
      heapUsed: memoryPressure.sample.heapUsedBytes,
      heapTotal: memoryPressure.sample.heapAllocatedBytes,
      heapSizeLimit: memoryPressure.sample.heapLimitBytes,
      rss: memoryPressure.sample.rssBytes,
      external: memoryPressure.sample.externalBytes,
      effectiveMemoryLimit: memoryPressure.sample.effectiveMemoryLimitBytes,
      effectiveMemoryLimitSource: memoryPressure.sample.effectiveMemoryLimitSource,
    },
    wsConnections,
    circuitBreakers,
    dependencyCircuits: {
      summary: dependencyCircuitSummary,
      circuits: dependencyCircuits,
      overrides: dependencyCircuitOverrides,
      error: dependencyCircuitError,
    },
    sqlite,
    node: {
      version: process.version,
      platform: process.platform,
    },
    dataDirectory: {
      path: dataDir,
      sizeBytes: dataDirSize,
    },
    timestamp: new Date().toISOString(),
  };
}

healthRouter.get('/deep', readRateLimit, authenticate, authorize('admin'), async (_req, res) => {
  const payload = await buildDeepHealthPayload();
  res.json(payload);
});

healthRouter.post(
  '/dependency-circuits/:key/reset',
  writeRateLimit,
  authenticate,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const key = dependencyCircuitKeySchema.parse(req.params.key);
    const input = dependencyCircuitResetSchema.parse(req.body);
    const reset = await getDependencyCircuitControlService().reset(
      key,
      dependencyCircuitActor(req),
      input.reason
    );
    if (!reset) {
      res.status(404).json({ error: 'Dependency circuit not found.' });
      return;
    }
    res.json({
      reset: true,
      circuit: await getDependencyCircuitRegistryService().getSnapshot(key),
    });
  })
);

healthRouter.post(
  '/dependency-circuits/:key/override',
  writeRateLimit,
  authenticate,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const key = dependencyCircuitKeySchema.parse(req.params.key);
    const input = dependencyCircuitOverrideInputSchema.parse(req.body);
    const override = await getDependencyCircuitControlService().override({
      circuitKey: key,
      actorId: dependencyCircuitActor(req),
      ...input,
    });
    res.status(201).json(override);
  })
);

healthRouter.delete(
  '/dependency-circuits/:key/override',
  writeRateLimit,
  authenticate,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const key = dependencyCircuitKeySchema.parse(req.params.key);
    const cleared = await getDependencyCircuitControlService().clearOverride(
      key,
      dependencyCircuitActor(req)
    );
    if (!cleared) {
      res.status(404).json({ error: 'Active dependency circuit override not found.' });
      return;
    }
    res.json({ cleared: true });
  })
);

function dependencyCircuitActor(req: AuthenticatedRequest): string {
  return req.auth?.userId ?? req.auth?.keyName ?? req.auth?.role ?? 'admin';
}

/**
 * GET /health — Alias for /health/live (backwards compatibility)
 */
healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// ============================================
// /api/health (canonical API signal)
// ============================================

/**
 * GET /api/health — Lightweight liveness signal for dev tooling.
 *
 * Returns a minimal JSON payload that is cheap to compute and safe to call
 * frequently.
 */
apiHealthRouter.get('/', readRateLimit, async (_req, res) => {
  // Read version from package.json (best-effort)
  let version = 'unknown';
  try {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
    version = pkg.version || 'unknown';
  } catch {
    // Ignore
  }

  res.json({
    ok: true,
    service: 'veritas-kanban',
    version,
    uptimeMs: Math.round(process.uptime() * 1000),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/health/deep — Full diagnostics (admin only).
 *
 * Same payload as /health/deep, exposed under /api for watchdogs and tooling.
 */
apiHealthRouter.get('/deep', readRateLimit, authenticate, authorize('admin'), async (_req, res) => {
  const payload = await buildDeepHealthPayload();
  res.json(payload);
});

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
import { createLogger } from '../lib/logger.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { getAllStatus as getCircuitBreakerStatus } from '../services/circuit-registry.js';
import type { WebSocketServer } from 'ws';

const log = createLogger('health');

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

/**
 * Resolve the data directory path.
 * Reads DATA_DIR from env at call time so tests can override it.
 * If DATA_DIR is relative, resolve against cwd.
 */
function getDataDir(): string {
  const dataDir = process.env.DATA_DIR || '.veritas-kanban';
  return path.resolve(process.cwd(), dataDir);
}

/**
 * Check that the data directory exists and is writable.
 */
async function checkStorage(): Promise<'ok' | 'fail'> {
  const dataDir = getDataDir();
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

/**
 * Check that free disk space exceeds 100 MB.
 * Uses Node.js fs.statfs (available in Node 18.15+).
 */
async function checkDisk(): Promise<'ok' | 'fail'> {
  const dataDir = getDataDir();
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
 * Check that memory usage is below 90% of heap.
 */
function checkMemory(): 'ok' | 'warn' {
  const mem = process.memoryUsage();
  const usedPercent = mem.heapUsed / mem.heapTotal;
  if (usedPercent > 0.9) {
    log.warn(
      { heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, usedPercent },
      'Memory usage high'
    );
    return 'warn';
  }
  return 'ok';
}

/**
 * Check that tasks.json is readable and valid JSON.
 */
async function checkTasksFile(): Promise<'ok' | 'fail'> {
  const dataDir = getDataDir();
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
      checkStorage(),
      checkDisk(),
      checkTasksFile(),
    ]);
    const memory = checkMemory();

    // Storage encompasses both the directory check and the tasks file check
    const storageStatus = storage === 'fail' || tasksFile === 'fail' ? 'fail' : 'ok';

    const checks = {
      storage: storageStatus as 'ok' | 'fail',
      memory,
      disk,
    };

    const hasCriticalFailure = checks.storage === 'fail' || checks.disk === 'fail';
    const status = hasCriticalFailure ? 'degraded' : 'ok';
    const httpStatus = hasCriticalFailure ? 503 : 200;

    res.status(httpStatus).json({
      status,
      checks,
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
healthRouter.get('/deep', authenticate, authorize('admin'), async (_req, res) => {
  const [storage, disk, tasksFile] = await Promise.all([
    checkStorage(),
    checkDisk(),
    checkTasksFile(),
  ]);
  const memory = checkMemory();
  const memUsage = process.memoryUsage();

  const storageStatus = storage === 'fail' || tasksFile === 'fail' ? 'fail' : 'ok';

  const dataDir = getDataDir();
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

  res.json({
    status: storageStatus === 'fail' || disk === 'fail' ? 'degraded' : 'ok',
    checks: {
      storage: storageStatus as 'ok' | 'fail',
      memory,
      disk,
    },
    uptime: process.uptime(),
    version,
    memory: {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      rss: memUsage.rss,
      external: memUsage.external,
    },
    wsConnections,
    circuitBreakers,
    node: {
      version: process.version,
      platform: process.platform,
    },
    dataDirectory: {
      path: dataDir,
      sizeBytes: dataDirSize,
    },
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health — Alias for /health/live (backwards compatibility)
 */
healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

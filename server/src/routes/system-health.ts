/**
 * System Health Aggregator Route
 *
 * GET /api/v1/system/health
 *
 * Aggregates system health signals (infrastructure, agents, operations)
 * into a single response for the frontend status bar.
 *
 * No auth required — mounted before auth middleware, same pattern as /health/ready.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../lib/logger.js';
import { getAgentRegistryService } from '../services/agent-registry-service.js';
import { getMetricsService } from '../services/metrics/index.js';

const log = createLogger('system-health');

// ─── Types ────────────────────────────────────────────────────

type OverallStatus = 'stable' | 'reviewing' | 'drifting' | 'elevated' | 'alert';

interface SystemSignal {
  status: 'ok' | 'warn' | 'fail';
  storage: boolean;
  disk: boolean;
  memory: boolean;
}

interface AgentSignal {
  status: 'ok' | 'warn' | 'critical';
  total: number;
  online: number;
  offline: number;
}

interface OperationsSignal {
  status: 'ok' | 'warn' | 'critical';
  recentRuns: number;
  successRate: number;
  failedRuns: number;
}

interface SystemHealthResponse {
  timestamp: string;
  status: OverallStatus;
  signals: {
    system: SystemSignal;
    agents: AgentSignal;
    operations: OperationsSignal;
  };
}

// ─── Helpers ──────────────────────────────────────────────────

function getDataDir(): string {
  const dataDir = process.env.DATA_DIR || '.veritas-kanban';
  return path.resolve(process.cwd(), dataDir);
}

async function checkStorage(): Promise<boolean> {
  const dataDir = getDataDir();
  try {
    await fs.access(dataDir, fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function checkDisk(): Promise<boolean> {
  const dataDir = getDataDir();
  try {
    const stats = await fs.statfs(dataDir);
    const freeBytes = stats.bfree * stats.bsize;
    const MIN_FREE_BYTES = 100 * 1024 * 1024; // 100 MB
    return freeBytes >= MIN_FREE_BYTES;
  } catch {
    return false;
  }
}

function checkMemory(): boolean {
  const mem = process.memoryUsage();
  return mem.heapUsed / mem.heapTotal <= 0.9;
}

function getSystemSignal(storage: boolean, disk: boolean, memory: boolean): SystemSignal {
  const anyFail = !storage || !disk;
  const anyWarn = !memory;
  const status: 'ok' | 'warn' | 'fail' = anyFail ? 'fail' : anyWarn ? 'warn' : 'ok';
  return { status, storage, disk, memory };
}

function getAgentSignal(): AgentSignal {
  try {
    const registry = getAgentRegistryService();
    const agents = registry.list();
    const total = agents.length;
    const online = agents.filter(
      (a) => a.status === 'online' || a.status === 'busy' || a.status === 'idle'
    ).length;
    const offline = total - online;

    let status: 'ok' | 'warn' | 'critical';
    if (total === 0) {
      status = 'ok'; // No agents registered is not an error
    } else if (offline === total) {
      status = 'critical';
    } else if (offline > 0) {
      status = 'warn';
    } else {
      status = 'ok';
    }

    return { status, total, online, offline };
  } catch (err) {
    log.warn({ err }, 'Failed to read agent registry');
    return { status: 'ok', total: 0, online: 0, offline: 0 };
  }
}

async function getOperationsSignal(): Promise<OperationsSignal> {
  try {
    const metrics = getMetricsService();
    const runMetrics = await metrics.getRunMetrics('24h');
    const recentRuns = runMetrics.runs;
    const successRate = runMetrics.runs > 0 ? runMetrics.successRate : 100;
    const failedRuns = runMetrics.failures + runMetrics.errors;

    let status: 'ok' | 'warn' | 'critical';
    if (successRate < 50) {
      status = 'critical';
    } else if (successRate < 80 || failedRuns > 5) {
      status = 'warn';
    } else {
      status = 'ok';
    }

    return { status, recentRuns, successRate, failedRuns };
  } catch (err) {
    log.warn({ err }, 'Failed to read operations metrics');
    return { status: 'ok', recentRuns: 0, successRate: 100, failedRuns: 0 };
  }
}

/**
 * Determine overall status from individual signals.
 *
 *   stable   = all signals ok
 *   reviewing = 1 warning signal
 *   drifting  = 2+ warnings or any agent offline
 *   elevated  = any critical signal
 *   alert     = system fail or successRate < 50%
 */
function determineOverallStatus(
  system: SystemSignal,
  agents: AgentSignal,
  operations: OperationsSignal
): OverallStatus {
  // Alert: system failure or very low success rate
  if (system.status === 'fail' || operations.successRate < 50) {
    return 'alert';
  }

  // Elevated: any critical signal
  if (agents.status === 'critical' || operations.status === 'critical') {
    return 'elevated';
  }

  // Count warnings
  const warnings = [system.status, agents.status, operations.status].filter(
    (s) => s === 'warn'
  ).length;

  // Drifting: 2+ warnings or any agent offline
  if (warnings >= 2 || agents.offline > 0) {
    return 'drifting';
  }

  // Reviewing: 1 warning
  if (warnings === 1) {
    return 'reviewing';
  }

  return 'stable';
}

// ─── Router ───────────────────────────────────────────────────

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const [storage, disk] = await Promise.all([checkStorage(), checkDisk()]);
    const memory = checkMemory();

    const system = getSystemSignal(storage, disk, memory);
    const agents = getAgentSignal();
    const operations = await getOperationsSignal();

    const status = determineOverallStatus(system, agents, operations);

    const response: SystemHealthResponse = {
      timestamp: new Date().toISOString(),
      status,
      signals: { system, agents, operations },
    };

    res.json(response);
  } catch (err) {
    log.error({ err }, 'Failed to aggregate system health');
    res.status(500).json({ status: 'unknown', error: 'Failed to aggregate health' });
  }
});

export { router as systemHealthRouter };

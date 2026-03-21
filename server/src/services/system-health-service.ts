/**
 * System Health Service
 *
 * Aggregates telemetry signals from infrastructure, the agent registry,
 * and recent task/run operations into a single `HealthStatus` payload.
 *
 * This service extracts and centralises the logic that previously lived
 * inline inside `server/src/routes/system-health.ts`.  The route now
 * delegates to `getSystemHealthService().getStatus()` so the aggregation
 * logic is reusable and unit-testable.
 */
import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../lib/logger.js';
import { getAgentRegistryService } from './agent-registry-service.js';
import { getMetricsService } from './metrics/index.js';
import type {
  HealthLevel,
  HealthStatus,
  SystemSignal,
  AgentSignal,
  OperationsSignal,
} from '@veritas-kanban/shared';

const log = createLogger('system-health-service');

// ─── Helpers ──────────────────────────────────────────────────

function getDataDir(): string {
  const dataDir = process.env.DATA_DIR || '.veritas-kanban';
  return path.resolve(process.cwd(), dataDir);
}

async function checkStorage(): Promise<boolean> {
  try {
    await fs.access(getDataDir(), fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function checkDisk(): Promise<boolean> {
  try {
    const stats = await fs.statfs(getDataDir());
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

// ─── Signal builders ──────────────────────────────────────────

function buildSystemSignal(storage: boolean, disk: boolean, memory: boolean): SystemSignal {
  const anyFail = !storage || !disk;
  const anyWarn = !memory;
  const status: 'ok' | 'warn' | 'fail' = anyFail ? 'fail' : anyWarn ? 'warn' : 'ok';
  return { status, storage, disk, memory };
}

function buildAgentSignal(): AgentSignal {
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
      status = 'ok';
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

async function buildOperationsSignal(): Promise<OperationsSignal> {
  try {
    const metrics = getMetricsService();
    const runMetrics = await metrics.getRunMetrics('24h');
    const recentRuns = runMetrics.runs;
    // runMetrics.successRate is 0-1 ratio; convert to 0-100 percentage
    const successRate = runMetrics.runs > 0 ? Math.round(runMetrics.successRate * 100) : 100;
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

// ─── Overall status determination ─────────────────────────────

/**
 * Determine the overall HealthLevel from individual signals.
 *
 *   stable    = all signals ok
 *   reviewing = 1 warning signal
 *   drifting  = 2+ warnings or any agent offline
 *   elevated  = any critical signal
 *   alert     = system fail or successRate < 50%
 */
function determineLevel(
  system: SystemSignal,
  agents: AgentSignal,
  operations: OperationsSignal
): HealthLevel {
  if (system.status === 'fail' || operations.successRate < 50) return 'alert';
  if (agents.status === 'critical' || operations.status === 'critical') return 'elevated';

  const warnings = [system.status, agents.status, operations.status].filter(
    (s) => s === 'warn'
  ).length;

  if (warnings >= 2 || agents.offline > 0) return 'drifting';
  if (warnings === 1) return 'reviewing';
  return 'stable';
}

// ─── Service ──────────────────────────────────────────────────

export class SystemHealthService {
  /**
   * Aggregate all signals and return the full `HealthStatus` payload.
   * Optional `projectId` / `agentId` filters are reserved for future
   * scoped health queries; the current implementation is global.
   */
  async getStatus(_filters?: { projectId?: string; agentId?: string }): Promise<HealthStatus> {
    const [storage, disk] = await Promise.all([checkStorage(), checkDisk()]);
    const memory = checkMemory();

    const system = buildSystemSignal(storage, disk, memory);
    const agents = buildAgentSignal();
    const operations = await buildOperationsSignal();

    const status = determineLevel(system, agents, operations);

    return {
      timestamp: new Date().toISOString(),
      status,
      signals: { system, agents, operations },
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────

let _instance: SystemHealthService | null = null;

export function getSystemHealthService(): SystemHealthService {
  if (!_instance) {
    _instance = new SystemHealthService();
  }
  return _instance;
}

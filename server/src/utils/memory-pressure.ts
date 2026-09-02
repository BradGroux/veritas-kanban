import os from 'node:os';
import v8 from 'node:v8';
import type { MemoryPressureDiagnostics } from '@veritas-kanban/shared';

/**
 * Warn only when the process is using at least 90% of an actual capacity
 * boundary. V8's currently allocated heap (`heapTotal`) is intentionally not
 * a boundary because it normally grows and shrinks around garbage collection.
 */
export const MEMORY_PRESSURE_THRESHOLD = 0.9;

export interface MemoryPressureSample {
  heapUsedBytes: number;
  heapAllocatedBytes: number;
  heapLimitBytes: number;
  rssBytes: number;
  externalBytes: number;
  effectiveMemoryLimitBytes: number;
  effectiveMemoryLimitSource: 'process-constrained' | 'host-total';
}

function ratio(usedBytes: number, limitBytes: number): number {
  return limitBytes > 0 ? usedBytes / limitBytes : 0;
}

export function classifyMemoryPressure(sample: MemoryPressureSample): MemoryPressureDiagnostics {
  const heapUtilization = ratio(sample.heapUsedBytes, sample.heapLimitBytes);
  const rssUtilization = ratio(sample.rssBytes, sample.effectiveMemoryLimitBytes);
  const useHeapMetric = heapUtilization >= rssUtilization;
  const metric = useHeapMetric ? 'heapUsed' : 'rss';
  const usedBytes = useHeapMetric ? sample.heapUsedBytes : sample.rssBytes;
  const limitBytes = useHeapMetric ? sample.heapLimitBytes : sample.effectiveMemoryLimitBytes;
  const utilization = useHeapMetric ? heapUtilization : rssUtilization;

  return {
    status: utilization >= MEMORY_PRESSURE_THRESHOLD ? 'warn' : 'ok',
    reason:
      utilization < MEMORY_PRESSURE_THRESHOLD
        ? 'within-limits'
        : metric === 'heapUsed'
          ? 'v8-heap-limit'
          : 'rss-memory-limit',
    metric,
    usedBytes,
    limitBytes,
    utilization,
    threshold: MEMORY_PRESSURE_THRESHOLD,
    sample,
  };
}

export function collectMemoryPressureSample(): MemoryPressureSample {
  const memory = process.memoryUsage();
  const heapLimitBytes = v8.getHeapStatistics().heap_size_limit;
  const hostTotalBytes = os.totalmem();
  const constrainedBytes = process.constrainedMemory();
  const hasTighterProcessLimit = constrainedBytes > 0 && constrainedBytes <= hostTotalBytes;

  return {
    heapUsedBytes: memory.heapUsed,
    heapAllocatedBytes: memory.heapTotal,
    heapLimitBytes,
    rssBytes: memory.rss,
    externalBytes: memory.external,
    effectiveMemoryLimitBytes: hasTighterProcessLimit ? constrainedBytes : hostTotalBytes,
    effectiveMemoryLimitSource: hasTighterProcessLimit ? 'process-constrained' : 'host-total',
  };
}

export function getMemoryPressure(): MemoryPressureDiagnostics {
  return classifyMemoryPressure(collectMemoryPressureSample());
}

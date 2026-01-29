/**
 * Lightweight Prometheus metrics collector.
 *
 * Implements counters, gauges, and histograms with Prometheus exposition
 * format output.  No external dependencies (prom-client, OpenTelemetry)
 * are required — everything is plain TypeScript.
 *
 * @see https://prometheus.io/docs/instrumenting/exposition_formats/
 */

// ── Metric Types ────────────────────────────────────────────────────

interface MetricMeta {
  name: string;
  help: string;
  type: 'counter' | 'gauge' | 'histogram';
}

/** Label set serialised as a sorted key=value string for Map keys. */
type LabelKey = string;

function labelKey(labels: Record<string, string>): LabelKey {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}="${v}"`).join(',');
}

function formatLabels(labels: Record<string, string>): string {
  const key = labelKey(labels);
  return key ? `{${key}}` : '';
}

// ── Counter ─────────────────────────────────────────────────────────

export class Counter {
  readonly meta: MetricMeta;
  private values = new Map<LabelKey, number>();
  private labelSets = new Map<LabelKey, Record<string, string>>();

  constructor(name: string, help: string) {
    this.meta = { name, help, type: 'counter' };
  }

  inc(labels: Record<string, string> = {}, value = 1): void {
    const key = labelKey(labels);
    this.labelSets.set(key, labels);
    this.values.set(key, (this.values.get(key) ?? 0) + value);
  }

  /** Return all (labelKey → value) pairs. */
  entries(): Array<[Record<string, string>, number]> {
    return [...this.values.entries()].map(([key, val]) => [this.labelSets.get(key)!, val]);
  }

  /** Render Prometheus text lines (without HELP/TYPE — registry adds those). */
  render(): string[] {
    const lines: string[] = [];
    for (const [key, val] of this.values) {
      const lbls = this.labelSets.get(key)!;
      lines.push(`${this.meta.name}${formatLabels(lbls)} ${val}`);
    }
    return lines;
  }
}

// ── Gauge ───────────────────────────────────────────────────────────

export class Gauge {
  readonly meta: MetricMeta;
  private values = new Map<LabelKey, number>();
  private labelSets = new Map<LabelKey, Record<string, string>>();

  constructor(name: string, help: string) {
    this.meta = { name, help, type: 'gauge' };
  }

  set(labels: Record<string, string>, value: number): void;
  set(value: number): void;
  set(labelsOrValue: Record<string, string> | number, value?: number): void {
    if (typeof labelsOrValue === 'number') {
      const key = labelKey({});
      this.labelSets.set(key, {});
      this.values.set(key, labelsOrValue);
    } else {
      const key = labelKey(labelsOrValue);
      this.labelSets.set(key, labelsOrValue);
      this.values.set(key, value!);
    }
  }

  inc(labels: Record<string, string> = {}, delta = 1): void {
    const key = labelKey(labels);
    this.labelSets.set(key, labels);
    this.values.set(key, (this.values.get(key) ?? 0) + delta);
  }

  dec(labels: Record<string, string> = {}, delta = 1): void {
    const key = labelKey(labels);
    this.labelSets.set(key, labels);
    this.values.set(key, (this.values.get(key) ?? 0) - delta);
  }

  get(labels: Record<string, string> = {}): number {
    return this.values.get(labelKey(labels)) ?? 0;
  }

  render(): string[] {
    const lines: string[] = [];
    for (const [key, val] of this.values) {
      const lbls = this.labelSets.get(key)!;
      lines.push(`${this.meta.name}${formatLabels(lbls)} ${val}`);
    }
    return lines;
  }
}

// ── Histogram ───────────────────────────────────────────────────────

interface HistogramBucket {
  le: number;
  count: number;
}

interface HistogramData {
  buckets: HistogramBucket[];
  sum: number;
  count: number;
}

export class Histogram {
  readonly meta: MetricMeta;
  readonly bucketBoundaries: number[];
  private data = new Map<LabelKey, HistogramData>();
  private labelSets = new Map<LabelKey, Record<string, string>>();

  constructor(name: string, help: string, buckets: number[]) {
    this.meta = { name, help, type: 'histogram' };
    this.bucketBoundaries = [...buckets].sort((a, b) => a - b);
  }

  private getOrCreate(labels: Record<string, string>): HistogramData {
    const key = labelKey(labels);
    if (!this.data.has(key)) {
      this.labelSets.set(key, labels);
      this.data.set(key, {
        buckets: this.bucketBoundaries.map((le) => ({ le, count: 0 })),
        sum: 0,
        count: 0,
      });
    }
    return this.data.get(key)!;
  }

  observe(labels: Record<string, string>, value: number): void;
  observe(value: number): void;
  observe(labelsOrValue: Record<string, string> | number, value?: number): void {
    let labels: Record<string, string>;
    let observedValue: number;
    if (typeof labelsOrValue === 'number') {
      labels = {};
      observedValue = labelsOrValue;
    } else {
      labels = labelsOrValue;
      observedValue = value!;
    }

    const data = this.getOrCreate(labels);
    data.sum += observedValue;
    data.count += 1;
    for (const bucket of data.buckets) {
      if (observedValue <= bucket.le) {
        bucket.count += 1;
      }
    }
  }

  render(): string[] {
    const lines: string[] = [];
    for (const [key, hd] of this.data) {
      const lbls = this.labelSets.get(key)!;
      const baseLabelStr = labelKey(lbls);

      for (const bucket of hd.buckets) {
        const bucketLabels = baseLabelStr
          ? `{${baseLabelStr},le="${bucket.le}"}`
          : `{le="${bucket.le}"}`;
        lines.push(`${this.meta.name}_bucket${bucketLabels} ${bucket.count}`);
      }
      // +Inf bucket
      const infLabels = baseLabelStr ? `{${baseLabelStr},le="+Inf"}` : `{le="+Inf"}`;
      lines.push(`${this.meta.name}_bucket${infLabels} ${hd.count}`);
      // sum & count
      const fmtLbls = baseLabelStr ? `{${baseLabelStr}}` : '';
      lines.push(`${this.meta.name}_sum${fmtLbls} ${hd.sum}`);
      lines.push(`${this.meta.name}_count${fmtLbls} ${hd.count}`);
    }
    return lines;
  }
}

// ── Registry ────────────────────────────────────────────────────────

type AnyMetric = Counter | Gauge | Histogram;

export class MetricRegistry {
  private metrics: AnyMetric[] = [];

  register<T extends AnyMetric>(metric: T): T {
    this.metrics.push(metric);
    return metric;
  }

  /**
   * Render ALL registered metrics in Prometheus exposition format.
   * Each metric gets a `# HELP` and `# TYPE` comment block.
   */
  renderAll(): string {
    const blocks: string[] = [];
    for (const m of this.metrics) {
      blocks.push(`# HELP ${m.meta.name} ${m.meta.help}`);
      blocks.push(`# TYPE ${m.meta.name} ${m.meta.type}`);
      const lines = m.render();
      blocks.push(...lines);
    }
    // Prometheus expects a trailing newline
    return blocks.join('\n') + '\n';
  }

  /** Reset all metrics (useful in tests). */
  reset(): void {
    this.metrics.length = 0;
  }
}

// ── Default Histogram Buckets ───────────────────────────────────────

/** HTTP request duration buckets (seconds). */
export const HTTP_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/** HTTP response size buckets (bytes). */
export const HTTP_RESPONSE_SIZE_BUCKETS = [
  100, 500, 1_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000,
];

// ── Global Singleton Collector ──────────────────────────────────────

export class PrometheusCollector {
  readonly registry = new MetricRegistry();

  // ── HTTP metrics ──────────────────────────────────────────────
  readonly httpRequestsTotal = this.registry.register(
    new Counter('veritas_http_requests_total', 'Total number of HTTP requests')
  );

  readonly httpRequestDurationSeconds = this.registry.register(
    new Histogram(
      'veritas_http_request_duration_seconds',
      'HTTP request duration in seconds',
      HTTP_DURATION_BUCKETS
    )
  );

  readonly httpResponseSizeBytes = this.registry.register(
    new Histogram(
      'veritas_http_response_size_bytes',
      'HTTP response size in bytes',
      HTTP_RESPONSE_SIZE_BUCKETS
    )
  );

  // ── WebSocket metrics ─────────────────────────────────────────
  readonly wsConnectionsActive = this.registry.register(
    new Gauge('veritas_ws_connections_active', 'Number of active WebSocket connections')
  );

  readonly wsMessagesSentTotal = this.registry.register(
    new Counter('veritas_ws_messages_sent_total', 'Total WebSocket messages sent')
  );

  readonly wsMessagesReceivedTotal = this.registry.register(
    new Counter('veritas_ws_messages_received_total', 'Total WebSocket messages received')
  );

  readonly wsConnectionDurationSeconds = this.registry.register(
    new Histogram(
      'veritas_ws_connection_duration_seconds',
      'WebSocket connection duration in seconds',
      [1, 5, 15, 30, 60, 300, 900, 1800, 3600]
    )
  );

  // ── Business metrics ──────────────────────────────────────────
  readonly tasksTotal = this.registry.register(
    new Gauge('veritas_tasks_total', 'Total number of tasks')
  );

  readonly tasksByStatus = this.registry.register(
    new Gauge('veritas_tasks_by_status', 'Number of tasks by status')
  );

  readonly tasksByPriority = this.registry.register(
    new Gauge('veritas_tasks_by_priority', 'Number of tasks by priority')
  );

  readonly agentsActive = this.registry.register(
    new Gauge('veritas_agents_active', 'Number of active agents')
  );

  // ── System / Node.js metrics ──────────────────────────────────
  readonly processHeapBytesUsed = this.registry.register(
    new Gauge('veritas_process_heap_bytes_used', 'Node.js heap used in bytes')
  );

  readonly processHeapBytesTotal = this.registry.register(
    new Gauge('veritas_process_heap_bytes_total', 'Node.js total heap size in bytes')
  );

  readonly processResidentMemoryBytes = this.registry.register(
    new Gauge('veritas_process_resident_memory_bytes', 'Node.js RSS in bytes')
  );

  readonly processUptimeSeconds = this.registry.register(
    new Gauge('veritas_process_uptime_seconds', 'Process uptime in seconds')
  );

  readonly processCpuUsagePercent = this.registry.register(
    new Gauge('veritas_process_cpu_usage_percent', 'Process CPU usage percent (user + system)')
  );

  readonly eventLoopLagSeconds = this.registry.register(
    new Gauge('veritas_event_loop_lag_seconds', 'Event loop lag in seconds')
  );

  // ── System snapshot ───────────────────────────────────────────
  // Track CPU baseline for delta calculation
  private lastCpuUsage: NodeJS.CpuUsage = process.cpuUsage();
  private lastCpuTimestamp: number = Date.now();

  /**
   * Refresh system metrics (call before scrape).
   * This populates gauges with current Node.js process stats.
   */
  collectSystemMetrics(): void {
    const mem = process.memoryUsage();
    this.processHeapBytesUsed.set(mem.heapUsed);
    this.processHeapBytesTotal.set(mem.heapTotal);
    this.processResidentMemoryBytes.set(mem.rss);
    this.processUptimeSeconds.set(Math.round(process.uptime()));

    // CPU usage (percentage since last call)
    const now = Date.now();
    const elapsed = (now - this.lastCpuTimestamp) / 1000; // seconds
    if (elapsed > 0) {
      const cpu = process.cpuUsage(this.lastCpuUsage);
      // cpuUsage returns microseconds; convert to seconds of CPU time
      const totalCpuSec = (cpu.user + cpu.system) / 1_000_000;
      const pct = (totalCpuSec / elapsed) * 100;
      this.processCpuUsagePercent.set(Math.round(pct * 100) / 100);
      this.lastCpuUsage = process.cpuUsage();
      this.lastCpuTimestamp = now;
    }

    // Event loop lag: measure using a setImmediate trick
    // (For the scrape endpoint we record the last known lag;
    //  the polling loop below keeps it up to date.)
  }

  // ── Event loop lag polling ────────────────────────────────────
  private lagTimer: ReturnType<typeof setInterval> | null = null;

  startEventLoopLagPolling(intervalMs = 2000): void {
    if (this.lagTimer) return;
    this.lagTimer = setInterval(() => {
      const start = performance.now();
      setImmediate(() => {
        const lagMs = performance.now() - start;
        this.eventLoopLagSeconds.set(Math.round(lagMs * 1000) / 1_000_000); // ms → seconds, 6 dp
      });
    }, intervalMs);
    // Don't block process shutdown
    if (this.lagTimer.unref) this.lagTimer.unref();
  }

  stopEventLoopLagPolling(): void {
    if (this.lagTimer) {
      clearInterval(this.lagTimer);
      this.lagTimer = null;
    }
  }

  /**
   * Full Prometheus scrape output.
   * Refreshes system metrics, then renders all registered metrics.
   */
  scrape(): string {
    this.collectSystemMetrics();
    return this.registry.renderAll();
  }
}

// ── Singleton ───────────────────────────────────────────────────────

let _collector: PrometheusCollector | null = null;

export function getPrometheusCollector(): PrometheusCollector {
  if (!_collector) {
    _collector = new PrometheusCollector();
    _collector.startEventLoopLagPolling();
  }
  return _collector;
}

/** Reset singleton (tests only). */
export function resetPrometheusCollector(): void {
  if (_collector) {
    _collector.stopEventLoopLagPolling();
  }
  _collector = null;
}

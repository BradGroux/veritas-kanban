import { describe, it, expect, beforeEach } from 'vitest';
import {
  Counter,
  Gauge,
  Histogram,
  MetricRegistry,
  PrometheusCollector,
  HTTP_DURATION_BUCKETS,
  resetPrometheusCollector,
} from '../../services/metrics/prometheus.js';

// ── Counter ─────────────────────────────────────────────────────────

describe('Counter', () => {
  let counter: Counter;

  beforeEach(() => {
    counter = new Counter('test_requests_total', 'Total test requests');
  });

  it('increments with no labels', () => {
    counter.inc();
    counter.inc();
    const lines = counter.render();
    expect(lines).toEqual(['test_requests_total 2']);
  });

  it('increments with labels', () => {
    counter.inc({ method: 'GET', status: '200' });
    counter.inc({ method: 'GET', status: '200' });
    counter.inc({ method: 'POST', status: '201' });
    const lines = counter.render();
    expect(lines).toHaveLength(2);
    expect(lines).toContain('test_requests_total{method="GET",status="200"} 2');
    expect(lines).toContain('test_requests_total{method="POST",status="201"} 1');
  });

  it('increments by a custom value', () => {
    counter.inc({}, 5);
    counter.inc({}, 3);
    const lines = counter.render();
    expect(lines).toEqual(['test_requests_total 8']);
  });

  it('returns entries', () => {
    counter.inc({ a: '1' }, 10);
    counter.inc({ a: '2' }, 20);
    const entries = counter.entries();
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual([{ a: '1' }, 10]);
    expect(entries).toContainEqual([{ a: '2' }, 20]);
  });

  it('sorts label keys alphabetically for deterministic output', () => {
    counter.inc({ z: '1', a: '2' });
    const lines = counter.render();
    expect(lines[0]).toBe('test_requests_total{a="2",z="1"} 1');
  });
});

// ── Gauge ───────────────────────────────────────────────────────────

describe('Gauge', () => {
  let gauge: Gauge;

  beforeEach(() => {
    gauge = new Gauge('test_active', 'Active items');
  });

  it('sets a scalar value', () => {
    gauge.set(42);
    expect(gauge.get()).toBe(42);
    const lines = gauge.render();
    expect(lines).toEqual(['test_active 42']);
  });

  it('sets a labelled value', () => {
    gauge.set({ host: 'a' }, 10);
    gauge.set({ host: 'b' }, 20);
    expect(gauge.get({ host: 'a' })).toBe(10);
    expect(gauge.get({ host: 'b' })).toBe(20);
    const lines = gauge.render();
    expect(lines).toContain('test_active{host="a"} 10');
    expect(lines).toContain('test_active{host="b"} 20');
  });

  it('increments and decrements', () => {
    gauge.inc();
    gauge.inc();
    gauge.dec();
    expect(gauge.get()).toBe(1);
  });

  it('inc/dec with labels', () => {
    gauge.inc({ type: 'x' }, 5);
    gauge.dec({ type: 'x' }, 2);
    expect(gauge.get({ type: 'x' })).toBe(3);
  });

  it('returns 0 for unknown labels', () => {
    expect(gauge.get({ unknown: 'label' })).toBe(0);
  });
});

// ── Histogram ───────────────────────────────────────────────────────

describe('Histogram', () => {
  let histogram: Histogram;

  beforeEach(() => {
    histogram = new Histogram('test_duration_seconds', 'Test duration', [0.1, 0.5, 1.0]);
  });

  it('records observations into correct buckets', () => {
    histogram.observe(0.05); // fits in 0.1, 0.5, 1.0
    histogram.observe(0.3); // fits in 0.5, 1.0
    histogram.observe(0.8); // fits in 1.0
    histogram.observe(2.0); // fits in none (only +Inf)

    const lines = histogram.render();

    // le=0.1 → 1, le=0.5 → 2, le=1.0 → 3, +Inf → 4
    expect(lines).toContain('test_duration_seconds_bucket{le="0.1"} 1');
    expect(lines).toContain('test_duration_seconds_bucket{le="0.5"} 2');
    expect(lines).toContain('test_duration_seconds_bucket{le="1"} 3');
    expect(lines).toContain('test_duration_seconds_bucket{le="+Inf"} 4');
    expect(lines).toContain('test_duration_seconds_sum 3.15');
    expect(lines).toContain('test_duration_seconds_count 4');
  });

  it('handles labelled observations', () => {
    histogram.observe({ method: 'GET' }, 0.05);
    histogram.observe({ method: 'GET' }, 0.3);
    histogram.observe({ method: 'POST' }, 0.8);

    const lines = histogram.render();

    // GET buckets
    expect(lines).toContain('test_duration_seconds_bucket{method="GET",le="0.1"} 1');
    expect(lines).toContain('test_duration_seconds_bucket{method="GET",le="0.5"} 2');
    expect(lines).toContain('test_duration_seconds_bucket{method="GET",le="1"} 2');
    expect(lines).toContain('test_duration_seconds_bucket{method="GET",le="+Inf"} 2');
    expect(lines).toContain('test_duration_seconds_sum{method="GET"} 0.35');
    expect(lines).toContain('test_duration_seconds_count{method="GET"} 2');

    // POST buckets
    expect(lines).toContain('test_duration_seconds_bucket{method="POST",le="0.1"} 0');
    expect(lines).toContain('test_duration_seconds_bucket{method="POST",le="0.5"} 0');
    expect(lines).toContain('test_duration_seconds_bucket{method="POST",le="1"} 1');
    expect(lines).toContain('test_duration_seconds_bucket{method="POST",le="+Inf"} 1');
  });

  it('uses sorted bucket boundaries', () => {
    const h = new Histogram('test', 'test', [1.0, 0.1, 0.5]);
    expect(h.bucketBoundaries).toEqual([0.1, 0.5, 1.0]);
  });
});

// ── MetricRegistry ──────────────────────────────────────────────────

describe('MetricRegistry', () => {
  let registry: MetricRegistry;

  beforeEach(() => {
    registry = new MetricRegistry();
  });

  it('renders HELP and TYPE comments', () => {
    const counter = registry.register(new Counter('http_requests_total', 'Total HTTP requests'));
    counter.inc({ method: 'GET' });

    const output = registry.renderAll();
    expect(output).toContain('# HELP http_requests_total Total HTTP requests');
    expect(output).toContain('# TYPE http_requests_total counter');
    expect(output).toContain('http_requests_total{method="GET"} 1');
  });

  it('renders multiple metrics', () => {
    const c = registry.register(new Counter('c_total', 'Counter'));
    const g = registry.register(new Gauge('g_value', 'Gauge'));
    c.inc();
    g.set(42);

    const output = registry.renderAll();
    expect(output).toContain('# HELP c_total Counter');
    expect(output).toContain('# TYPE c_total counter');
    expect(output).toContain('c_total 1');
    expect(output).toContain('# HELP g_value Gauge');
    expect(output).toContain('# TYPE g_value gauge');
    expect(output).toContain('g_value 42');
  });

  it('renders histograms with HELP/TYPE', () => {
    const h = registry.register(new Histogram('req_dur', 'Duration', [0.1, 0.5]));
    h.observe(0.2);

    const output = registry.renderAll();
    expect(output).toContain('# HELP req_dur Duration');
    expect(output).toContain('# TYPE req_dur histogram');
    expect(output).toContain('req_dur_bucket{le="0.1"} 0');
    expect(output).toContain('req_dur_bucket{le="0.5"} 1');
    expect(output).toContain('req_dur_bucket{le="+Inf"} 1');
    expect(output).toContain('req_dur_sum 0.2');
    expect(output).toContain('req_dur_count 1');
  });

  it('ends with a trailing newline', () => {
    registry.register(new Counter('c', 'c'));
    const output = registry.renderAll();
    expect(output.endsWith('\n')).toBe(true);
  });

  it('resets all metrics', () => {
    registry.register(new Counter('c', 'c'));
    registry.reset();
    const output = registry.renderAll();
    // Only the trailing newline remains
    expect(output).toBe('\n');
  });
});

// ── PrometheusCollector (singleton) ─────────────────────────────────

describe('PrometheusCollector', () => {
  let collector: PrometheusCollector;

  beforeEach(() => {
    resetPrometheusCollector();
    collector = new PrometheusCollector();
  });

  it('has all expected HTTP metrics registered', () => {
    expect(collector.httpRequestsTotal).toBeInstanceOf(Counter);
    expect(collector.httpRequestDurationSeconds).toBeInstanceOf(Histogram);
    expect(collector.httpResponseSizeBytes).toBeInstanceOf(Histogram);
  });

  it('has all expected WebSocket metrics registered', () => {
    expect(collector.wsConnectionsActive).toBeInstanceOf(Gauge);
    expect(collector.wsMessagesSentTotal).toBeInstanceOf(Counter);
    expect(collector.wsMessagesReceivedTotal).toBeInstanceOf(Counter);
    expect(collector.wsConnectionDurationSeconds).toBeInstanceOf(Histogram);
  });

  it('has all expected business metrics registered', () => {
    expect(collector.tasksTotal).toBeInstanceOf(Gauge);
    expect(collector.tasksByStatus).toBeInstanceOf(Gauge);
    expect(collector.tasksByPriority).toBeInstanceOf(Gauge);
    expect(collector.agentsActive).toBeInstanceOf(Gauge);
  });

  it('has all expected system metrics registered', () => {
    expect(collector.processHeapBytesUsed).toBeInstanceOf(Gauge);
    expect(collector.processHeapBytesTotal).toBeInstanceOf(Gauge);
    expect(collector.processResidentMemoryBytes).toBeInstanceOf(Gauge);
    expect(collector.processUptimeSeconds).toBeInstanceOf(Gauge);
    expect(collector.processCpuUsagePercent).toBeInstanceOf(Gauge);
    expect(collector.eventLoopLagSeconds).toBeInstanceOf(Gauge);
  });

  it('uses correct HTTP duration buckets', () => {
    expect(collector.httpRequestDurationSeconds.bucketBoundaries).toEqual(HTTP_DURATION_BUCKETS);
  });

  it('scrape() collects system metrics and returns valid output', () => {
    // Record some HTTP activity first
    collector.httpRequestsTotal.inc({ method: 'GET', route: '/api/tasks', status_code: '200' });
    collector.httpRequestDurationSeconds.observe(
      { method: 'GET', route: '/api/tasks', status_code: '200' },
      0.05
    );

    const output = collector.scrape();

    // System metrics should be populated
    expect(output).toContain('veritas_process_uptime_seconds');
    expect(output).toContain('veritas_process_heap_bytes_used');
    expect(output).toContain('veritas_process_heap_bytes_total');
    expect(output).toContain('veritas_process_resident_memory_bytes');
    expect(output).toContain('veritas_process_cpu_usage_percent');

    // HTTP metrics
    expect(output).toContain(
      'veritas_http_requests_total{method="GET",route="/api/tasks",status_code="200"} 1'
    );
    expect(output).toContain('veritas_http_request_duration_seconds_bucket');
    expect(output).toContain('veritas_http_request_duration_seconds_sum');
    expect(output).toContain('veritas_http_request_duration_seconds_count');

    // HELP/TYPE comments should be present
    expect(output).toContain('# HELP veritas_http_requests_total');
    expect(output).toContain('# TYPE veritas_http_requests_total counter');
    expect(output).toContain('# HELP veritas_http_request_duration_seconds');
    expect(output).toContain('# TYPE veritas_http_request_duration_seconds histogram');
  });

  it('records business metrics correctly', () => {
    collector.tasksTotal.set(150);
    collector.tasksByStatus.set({ status: 'in-progress' }, 5);
    collector.tasksByStatus.set({ status: 'done' }, 100);
    collector.tasksByPriority.set({ priority: 'high' }, 10);
    collector.agentsActive.set(3);

    const output = collector.scrape();

    expect(output).toContain('veritas_tasks_total 150');
    expect(output).toContain('veritas_tasks_by_status{status="in-progress"} 5');
    expect(output).toContain('veritas_tasks_by_status{status="done"} 100');
    expect(output).toContain('veritas_tasks_by_priority{priority="high"} 10');
    expect(output).toContain('veritas_agents_active 3');
  });

  it('records WebSocket metrics correctly', () => {
    collector.wsConnectionsActive.set(12);
    collector.wsMessagesSentTotal.inc({}, 100);
    collector.wsMessagesReceivedTotal.inc({}, 50);
    collector.wsConnectionDurationSeconds.observe(120);

    const output = collector.scrape();

    expect(output).toContain('veritas_ws_connections_active 12');
    expect(output).toContain('veritas_ws_messages_sent_total 100');
    expect(output).toContain('veritas_ws_messages_received_total 50');
    expect(output).toContain('veritas_ws_connection_duration_seconds_count 1');
  });
});

// ── Metrics Middleware (integration-style test) ─────────────────────

describe('metricsCollector middleware', () => {
  let collector: PrometheusCollector;

  beforeEach(async () => {
    resetPrometheusCollector();
    // Dynamically import to get the lazy singleton
    const mod = await import('../../services/metrics/prometheus.js');
    collector = mod.getPrometheusCollector();
  });

  it('records request metrics via the middleware', async () => {
    // We simulate what the middleware does manually (unit test, no Express needed)
    const method = 'GET';
    const route = '/api/tasks';
    const statusCode = '200';
    const durationSec = 0.042;
    const responseSize = 1234;

    collector.httpRequestsTotal.inc({ method, route, status_code: statusCode });
    collector.httpRequestDurationSeconds.observe(
      { method, route, status_code: statusCode },
      durationSec
    );
    collector.httpResponseSizeBytes.observe(
      { method, route, status_code: statusCode },
      responseSize
    );

    // Verify counter
    const entries = collector.httpRequestsTotal.entries();
    expect(entries).toContainEqual([{ method: 'GET', route: '/api/tasks', status_code: '200' }, 1]);

    // Verify histogram shows up in scrape output
    const output = collector.scrape();
    expect(output).toContain(
      'veritas_http_requests_total{method="GET",route="/api/tasks",status_code="200"} 1'
    );
    expect(output).toContain(
      'veritas_http_request_duration_seconds_sum{method="GET",route="/api/tasks",status_code="200"} 0.042'
    );
    expect(output).toContain(
      'veritas_http_response_size_bytes_sum{method="GET",route="/api/tasks",status_code="200"} 1234'
    );
  });

  it('accumulates multiple requests', () => {
    for (let i = 0; i < 5; i++) {
      collector.httpRequestsTotal.inc({ method: 'GET', route: '/api/tasks', status_code: '200' });
    }
    collector.httpRequestsTotal.inc({ method: 'POST', route: '/api/tasks', status_code: '201' });

    const entries = collector.httpRequestsTotal.entries();
    const getEntry = entries.find(([labels]) => labels.method === 'GET');
    const postEntry = entries.find(([labels]) => labels.method === 'POST');
    expect(getEntry![1]).toBe(5);
    expect(postEntry![1]).toBe(1);
  });
});

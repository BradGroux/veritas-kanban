import path from 'path';
import { nanoid } from 'nanoid';
import type {
  AnyTelemetryEvent,
  DriftAlert,
  DriftAnalysisResult,
  DriftBaseline,
  DriftConfig,
  DriftMetric,
  DriftMetricSnapshot,
  DriftSeverity,
  DriftTrend,
} from '@veritas-kanban/shared';
import { fileExists, mkdir, readdir, readFile, rm, writeFile } from '../storage/fs-helpers.js';
import { getDriftAlertsDir, getDriftBaselinesDir } from '../utils/paths.js';
import { getTelemetryService } from './telemetry-service.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('drift-service');

const DAY_MS = 24 * 60 * 60 * 1000;
const ANALYSIS_WINDOW_DAYS = 30;
const MIN_BASELINE_SAMPLES = 3;
const INFO_THRESHOLD = 1;
const METRICS: DriftMetric[] = [
  'action_frequency',
  'duration',
  'cost',
  'token_usage',
  'risk_score',
  'success_rate',
];

const DEFAULT_CONFIGS: DriftConfig[] = METRICS.map((metric) => ({
  metric,
  warningThreshold: 2,
  criticalThreshold: 3,
}));

interface DailyAggregate {
  actions: number;
  durationTotal: number;
  durationCount: number;
  costTotal: number;
  costCount: number;
  tokensTotal: number;
  tokensCount: number;
  runs: number;
  successes: number;
  failures: number;
  errors: number;
}

interface DriftServiceOptions {
  alertsDir?: string;
  baselinesDir?: string;
  configs?: DriftConfig[];
}

export class DriftService {
  private readonly alertsDir: string;
  private readonly baselinesDir: string;
  private readonly configs: Map<DriftMetric, DriftConfig>;

  constructor(options: DriftServiceOptions = {}) {
    this.alertsDir = options.alertsDir ?? getDriftAlertsDir();
    this.baselinesDir = options.baselinesDir ?? getDriftBaselinesDir();
    const configs = options.configs ?? DEFAULT_CONFIGS;
    this.configs = new Map(configs.map((config) => [config.metric, config]));
  }

  async listAlerts(
    filters: {
      agentId?: string;
      metric?: DriftMetric;
      severity?: DriftSeverity;
      acknowledged?: boolean;
    } = {}
  ): Promise<DriftAlert[]> {
    const alerts = await this.readCollection<DriftAlert>(this.alertsDir);
    return alerts
      .filter((alert) => {
        if (filters.agentId && alert.agentId !== filters.agentId) return false;
        if (filters.metric && alert.metric !== filters.metric) return false;
        if (filters.severity && alert.severity !== filters.severity) return false;
        if (filters.acknowledged !== undefined && alert.acknowledged !== filters.acknowledged) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  async acknowledgeAlert(id: string): Promise<DriftAlert | null> {
    const filePath = path.join(this.alertsDir, `${id}.json`);
    if (!(await fileExists(filePath))) {
      return null;
    }

    const alert = JSON.parse(await readFile(filePath, 'utf-8')) as DriftAlert;
    const updated: DriftAlert = { ...alert, acknowledged: true };
    await this.writeJson(filePath, updated);
    return updated;
  }

  async listBaselines(
    filters: { agentId?: string; metric?: DriftMetric } = {}
  ): Promise<DriftBaseline[]> {
    const baselines = await this.readCollection<DriftBaseline>(this.baselinesDir);
    return baselines
      .filter((baseline) => {
        if (filters.agentId && baseline.agentId !== filters.agentId) return false;
        if (filters.metric && baseline.metric !== filters.metric) return false;
        return true;
      })
      .sort((a, b) => a.agentId.localeCompare(b.agentId) || a.metric.localeCompare(b.metric));
  }

  async resetBaselines(agentId: string, metric?: DriftMetric): Promise<{ deleted: number }> {
    await mkdir(this.baselinesDir, { recursive: true });
    const files = await readdir(this.baselinesDir).catch(() => [] as string[]);
    const matching = files.filter((file) => {
      if (!file.endsWith('.json')) return false;
      if (!file.startsWith(`${this.toFileSegment(agentId)}__`)) return false;
      if (!metric) return true;
      return file === `${this.toFileSegment(agentId)}__${metric}.json`;
    });

    await Promise.all(
      matching.map((file) => rm(path.join(this.baselinesDir, file), { force: true }))
    );
    return { deleted: matching.length };
  }

  async analyzeAgent(agentId: string): Promise<DriftAnalysisResult> {
    const now = new Date();
    const since = new Date(now.getTime() - ANALYSIS_WINDOW_DAYS * DAY_MS).toISOString();
    const telemetry = getTelemetryService();
    const events = await telemetry.getEvents({ since, limit: 20_000 });
    const agentEvents = events.filter((event) => this.getAgentId(event) === agentId);
    const daily = this.buildDailyAggregates(agentEvents);
    const snapshots: DriftMetricSnapshot[] = [];
    const baselines: DriftBaseline[] = [];
    const newAlerts: DriftAlert[] = [];
    const existingAlerts = await this.listAlerts({ agentId, acknowledged: false });

    for (const metric of METRICS) {
      const dailyValues = this.getDailyMetricValues(metric, daily);
      if (dailyValues.length === 0) continue;

      const current = dailyValues[dailyValues.length - 1];
      const baselineSamples = dailyValues.slice(0, -1);
      if (baselineSamples.length < MIN_BASELINE_SAMPLES) continue;

      const baseline = this.buildBaseline(agentId, metric, baselineSamples);
      baselines.push(baseline);
      snapshots.push(this.buildSnapshot(agentId, metric, current, baseline));
      await this.saveBaseline(baseline);

      const severity = this.getSeverity(metric, snapshots[snapshots.length - 1].zScore);
      if (!severity) continue;

      const duplicate = existingAlerts.find(
        (alert) =>
          alert.metric === metric &&
          alert.severity === severity &&
          !alert.acknowledged &&
          Math.abs(alert.currentValue - current.value) < Number.EPSILON
      );
      if (duplicate) continue;

      const alert: DriftAlert = {
        id: `drift_${nanoid(12)}`,
        agentId,
        metric,
        currentValue: current.value,
        baselineValue: baseline.mean,
        zScore: snapshots[snapshots.length - 1].zScore,
        severity,
        timestamp: now.toISOString(),
        acknowledged: false,
      };
      newAlerts.push(alert);
      await this.saveAlert(alert);
    }

    return {
      agentId,
      analyzedAt: now.toISOString(),
      alerts: newAlerts.sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
      baselines,
      snapshots,
    };
  }

  private buildDailyAggregates(events: AnyTelemetryEvent[]): Map<string, DailyAggregate> {
    const daily = new Map<string, DailyAggregate>();

    for (const event of events) {
      const day = event.timestamp.slice(0, 10);
      const bucket = daily.get(day) ?? {
        actions: 0,
        durationTotal: 0,
        durationCount: 0,
        costTotal: 0,
        costCount: 0,
        tokensTotal: 0,
        tokensCount: 0,
        runs: 0,
        successes: 0,
        failures: 0,
        errors: 0,
      };

      if (event.type === 'run.started') {
        bucket.actions += 1;
      }

      if (event.type === 'run.completed') {
        bucket.runs += 1;
        if (event.success) bucket.successes += 1;
        else bucket.failures += 1;
        if (typeof event.durationMs === 'number' && event.durationMs >= 0) {
          bucket.durationTotal += event.durationMs;
          bucket.durationCount += 1;
        }
      }

      if (event.type === 'run.error') {
        bucket.runs += 1;
        bucket.errors += 1;
      }

      if (event.type === 'run.tokens') {
        const totalTokens = event.totalTokens ?? event.inputTokens + event.outputTokens;
        bucket.tokensTotal += totalTokens;
        bucket.tokensCount += 1;
        if (typeof event.cost === 'number') {
          bucket.costTotal += event.cost;
          bucket.costCount += 1;
        }
      }

      daily.set(day, bucket);
    }

    return new Map([...daily.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }

  private getDailyMetricValues(
    metric: DriftMetric,
    daily: Map<string, DailyAggregate>
  ): Array<{ day: string; value: number; sampleCount: number }> {
    const rows: Array<{ day: string; value: number; sampleCount: number }> = [];

    for (const [day, bucket] of daily) {
      const totalAttempts = bucket.runs;
      switch (metric) {
        case 'action_frequency':
          if (bucket.actions > 0)
            rows.push({ day, value: bucket.actions, sampleCount: bucket.actions });
          break;
        case 'duration':
          if (bucket.durationCount > 0) {
            rows.push({
              day,
              value: bucket.durationTotal / bucket.durationCount,
              sampleCount: bucket.durationCount,
            });
          }
          break;
        case 'cost':
          if (bucket.costCount > 0) {
            rows.push({
              day,
              value: bucket.costTotal / bucket.costCount,
              sampleCount: bucket.costCount,
            });
          }
          break;
        case 'token_usage':
          if (bucket.tokensCount > 0) {
            rows.push({
              day,
              value: bucket.tokensTotal / bucket.tokensCount,
              sampleCount: bucket.tokensCount,
            });
          }
          break;
        case 'risk_score':
          if (totalAttempts > 0) {
            rows.push({
              day,
              value: ((bucket.failures + bucket.errors) / totalAttempts) * 100,
              sampleCount: totalAttempts,
            });
          }
          break;
        case 'success_rate':
          if (totalAttempts > 0) {
            rows.push({
              day,
              value: (bucket.successes / totalAttempts) * 100,
              sampleCount: totalAttempts,
            });
          }
          break;
      }
    }

    return rows;
  }

  private buildBaseline(
    agentId: string,
    metric: DriftMetric,
    samples: Array<{ day: string; value: number; sampleCount: number }>
  ): DriftBaseline {
    const values = samples.map((sample) => sample.value);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance =
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(values.length, 1);

    return {
      agentId,
      metric,
      mean,
      stdDev: Math.sqrt(variance),
      sampleCount: samples.length,
      windowStart: new Date(`${samples[0].day}T00:00:00.000Z`).toISOString(),
      windowEnd: new Date(`${samples[samples.length - 1].day}T23:59:59.999Z`).toISOString(),
    };
  }

  private buildSnapshot(
    agentId: string,
    metric: DriftMetric,
    current: { day: string; value: number; sampleCount: number },
    baseline: DriftBaseline
  ): DriftMetricSnapshot {
    const zScore = this.calculateZScore(current.value, baseline.mean, baseline.stdDev);
    const delta = current.value - baseline.mean;
    const threshold = Math.max(baseline.stdDev * 0.25, Math.abs(baseline.mean) * 0.05, 0.5);
    const trend: DriftTrend =
      Math.abs(delta) <= threshold ? 'stable' : delta > 0 ? 'increasing' : 'decreasing';

    return {
      agentId,
      metric,
      value: current.value,
      sampleCount: current.sampleCount,
      windowStart: new Date(`${current.day}T00:00:00.000Z`).toISOString(),
      windowEnd: new Date(`${current.day}T23:59:59.999Z`).toISOString(),
      zScore,
      trend,
    };
  }

  private calculateZScore(currentValue: number, mean: number, stdDev: number): number {
    const denominator = stdDev > 0 ? stdDev : Math.max(Math.abs(mean) * 0.1, 1);
    return Number(((currentValue - mean) / denominator).toFixed(3));
  }

  private getSeverity(metric: DriftMetric, zScore: number): DriftSeverity | null {
    const abs = Math.abs(zScore);
    const config = this.configs.get(metric);
    if (!config) return null;
    if (abs >= config.criticalThreshold) return 'critical';
    if (abs >= config.warningThreshold) return 'warning';
    if (abs >= INFO_THRESHOLD) return 'info';
    return null;
  }

  private getAgentId(event: AnyTelemetryEvent): string | null {
    if ('agent' in event && typeof event.agent === 'string' && event.agent.length > 0) {
      return event.agent;
    }
    return null;
  }

  private async saveAlert(alert: DriftAlert): Promise<void> {
    await mkdir(this.alertsDir, { recursive: true });
    await this.writeJson(path.join(this.alertsDir, `${alert.id}.json`), alert);
  }

  private async saveBaseline(baseline: DriftBaseline): Promise<void> {
    await mkdir(this.baselinesDir, { recursive: true });
    const file = `${this.toFileSegment(baseline.agentId)}__${baseline.metric}.json`;
    await this.writeJson(path.join(this.baselinesDir, file), baseline);
  }

  private toFileSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  private async readCollection<T>(dir: string): Promise<T[]> {
    await mkdir(dir, { recursive: true });
    const files = await readdir(dir).catch(() => [] as string[]);
    const rows = await Promise.all(
      files
        .filter((file) => file.endsWith('.json'))
        .map(async (file) => {
          try {
            return JSON.parse(await readFile(path.join(dir, file), 'utf-8')) as T;
          } catch (error) {
            log.warn({ err: error, file }, 'Failed to read drift record');
            return null;
          }
        })
    );
    return rows.filter((row) => row !== null) as T[];
  }

  private async writeJson(filePath: string, value: unknown): Promise<void> {
    await writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
  }
}

let driftService: DriftService | null = null;

export function getDriftService(options?: DriftServiceOptions): DriftService {
  if (!driftService || options) {
    driftService = new DriftService(options);
  }
  return driftService;
}

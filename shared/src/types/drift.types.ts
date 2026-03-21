export type DriftMetric =
  | 'action_frequency'
  | 'duration'
  | 'cost'
  | 'token_usage'
  | 'risk_score'
  | 'success_rate';

export type DriftSeverity = 'critical' | 'warning' | 'info';

export type DriftTrend = 'increasing' | 'decreasing' | 'stable';

export interface DriftAlert {
  id: string;
  agentId: string;
  metric: DriftMetric;
  currentValue: number;
  baselineValue: number;
  zScore: number;
  severity: DriftSeverity;
  timestamp: string;
  acknowledged: boolean;
}

export interface DriftBaseline {
  agentId: string;
  metric: DriftMetric;
  mean: number;
  stdDev: number;
  sampleCount: number;
  windowStart: string;
  windowEnd: string;
}

export interface DriftConfig {
  metric: DriftMetric;
  warningThreshold: number;
  criticalThreshold: number;
}

export interface DriftMetricSnapshot {
  agentId: string;
  metric: DriftMetric;
  value: number;
  sampleCount: number;
  windowStart: string;
  windowEnd: string;
  zScore: number;
  trend: DriftTrend;
}

export interface DriftAnalysisResult {
  agentId: string;
  analyzedAt: string;
  alerts: DriftAlert[];
  baselines: DriftBaseline[];
  snapshots: DriftMetricSnapshot[];
}

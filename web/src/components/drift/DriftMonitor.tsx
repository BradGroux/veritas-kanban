import { useMemo, useState } from 'react';
import type {
  DriftAlert,
  DriftBaseline,
  DriftMetric,
  DriftSeverity,
  DriftTrend,
} from '@veritas-kanban/shared';
import { AlertTriangle, ArrowLeft, RefreshCw, ShieldAlert, TrendingUp } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useAcknowledgeDriftAlert,
  useAnalyzeDrift,
  useDriftAlerts,
  useDriftBaselines,
  useResetDriftBaselines,
} from '@/hooks/useDrift';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

interface DriftMonitorProps {
  onBack: () => void;
}

const METRIC_LABELS: Record<DriftMetric, string> = {
  action_frequency: 'Action Frequency',
  duration: 'Duration',
  cost: 'Cost',
  token_usage: 'Token Usage',
  risk_score: 'Risk Score',
  success_rate: 'Success Rate',
};

const SEVERITY_ORDER: Record<DriftSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const TREND_LABELS: Record<DriftTrend, string> = {
  increasing: 'Increasing',
  decreasing: 'Decreasing',
  stable: 'Stable',
};

function formatMetricValue(metric: DriftMetric, value: number) {
  if (metric === 'duration') return `${Math.round(value / 1000)}s`;
  if (metric === 'cost') return `$${value.toFixed(value < 1 ? 4 : 2)}`;
  if (metric === 'token_usage') return `${Math.round(value).toLocaleString()} tok`;
  if (metric === 'risk_score' || metric === 'success_rate') return `${value.toFixed(1)}%`;
  return `${value.toFixed(1)}`;
}

function severityTone(severity: DriftSeverity) {
  if (severity === 'critical') return 'destructive';
  if (severity === 'warning') return 'secondary';
  return 'outline';
}

function zScoreColor(value: number) {
  const abs = Math.abs(value);
  if (abs >= 3) return 'hsl(0 72% 51%)';
  if (abs >= 2) return 'hsl(38 92% 50%)';
  return 'hsl(var(--primary))';
}

function AlertsTable({
  alerts,
  isLoading,
  onAcknowledge,
  acknowledgingId,
}: {
  alerts: DriftAlert[];
  isLoading: boolean;
  onAcknowledge: (id: string) => void;
  acknowledgingId?: string;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        No drift alerts for the current filter.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="min-w-full text-sm">
        <thead className="border-b bg-muted/40 text-left">
          <tr>
            <th className="px-4 py-3 font-medium">Severity</th>
            <th className="px-4 py-3 font-medium">Agent</th>
            <th className="px-4 py-3 font-medium">Metric</th>
            <th className="px-4 py-3 font-medium">Current</th>
            <th className="px-4 py-3 font-medium">Baseline</th>
            <th className="px-4 py-3 font-medium">Z-Score</th>
            <th className="px-4 py-3 font-medium">Timestamp</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => (
            <tr key={alert.id} className="border-b last:border-b-0">
              <td className="px-4 py-3">
                <Badge variant={severityTone(alert.severity)}>{alert.severity}</Badge>
              </td>
              <td className="px-4 py-3 font-medium">{alert.agentId}</td>
              <td className="px-4 py-3">{METRIC_LABELS[alert.metric]}</td>
              <td className="px-4 py-3">{formatMetricValue(alert.metric, alert.currentValue)}</td>
              <td className="px-4 py-3">{formatMetricValue(alert.metric, alert.baselineValue)}</td>
              <td className="px-4 py-3 font-mono">{alert.zScore.toFixed(2)}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {new Date(alert.timestamp).toLocaleString()}
              </td>
              <td className="px-4 py-3">
                {alert.acknowledged ? (
                  <Badge variant="outline">Acknowledged</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onAcknowledge(alert.id)}
                    disabled={acknowledgingId === alert.id}
                  >
                    {acknowledgingId === alert.id ? 'Saving…' : 'Acknowledge'}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BaselineTable({
  baselines,
  isLoading,
  onReset,
  resetting,
}: {
  baselines: DriftBaseline[];
  isLoading: boolean;
  onReset: (agentId: string, metric?: DriftMetric) => void;
  resetting: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (baselines.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        No drift baselines have been computed yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="min-w-full text-sm">
        <thead className="border-b bg-muted/40 text-left">
          <tr>
            <th className="px-4 py-3 font-medium">Agent</th>
            <th className="px-4 py-3 font-medium">Metric</th>
            <th className="px-4 py-3 font-medium">Mean</th>
            <th className="px-4 py-3 font-medium">Std Dev</th>
            <th className="px-4 py-3 font-medium">Samples</th>
            <th className="px-4 py-3 font-medium">Window</th>
            <th className="px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {baselines.map((baseline) => (
            <tr key={`${baseline.agentId}-${baseline.metric}`} className="border-b last:border-b-0">
              <td className="px-4 py-3 font-medium">{baseline.agentId}</td>
              <td className="px-4 py-3">{METRIC_LABELS[baseline.metric]}</td>
              <td className="px-4 py-3">{formatMetricValue(baseline.metric, baseline.mean)}</td>
              <td className="px-4 py-3">{baseline.stdDev.toFixed(2)}</td>
              <td className="px-4 py-3">{baseline.sampleCount}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {new Date(baseline.windowStart).toLocaleDateString()} -{' '}
                {new Date(baseline.windowEnd).toLocaleDateString()}
              </td>
              <td className="px-4 py-3">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={resetting}
                  onClick={() => onReset(baseline.agentId, baseline.metric)}
                >
                  Reset
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DriftChart({ alerts, baselines }: { alerts: DriftAlert[]; baselines: DriftBaseline[] }) {
  const chartData = useMemo(() => {
    return alerts.slice(0, 12).map((alert) => ({
      id: alert.id,
      label: `${alert.agentId} · ${METRIC_LABELS[alert.metric]}`,
      zScore: Number(alert.zScore.toFixed(2)),
      fill: zScoreColor(alert.zScore),
    }));
  }, [alerts]);

  if (chartData.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        Run an analysis to generate z-score drift bars.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Trend Visualization</h3>
          <p className="text-sm text-muted-foreground">{baselines.length} baselines loaded</p>
        </div>
        <Badge variant="outline">Z-score bars</Badge>
      </div>
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 8, right: 16, left: 24, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
            <XAxis type="number" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
            <YAxis
              type="category"
              dataKey="label"
              width={170}
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            />
            <Tooltip
              formatter={(value) => [
                typeof value === 'number' ? value.toFixed(2) : String(value ?? ''),
                'Z-Score',
              ]}
              contentStyle={{ borderRadius: 12, borderColor: 'hsl(var(--border))' }}
            />
            <Bar dataKey="zScore" radius={[0, 6, 6, 0]}>
              {chartData.map((entry) => (
                <Cell key={entry.id} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function DriftMonitor({ onBack }: DriftMonitorProps) {
  const [agentId, setAgentId] = useState('');
  const [severity, setSeverity] = useState<'all' | DriftSeverity>('all');
  const { data: alerts = [], isLoading: alertsLoading } = useDriftAlerts({
    agentId: agentId || undefined,
    severity: severity === 'all' ? undefined : severity,
  });
  const { data: baselines = [], isLoading: baselinesLoading } = useDriftBaselines({
    agentId: agentId || undefined,
  });
  const acknowledgeMutation = useAcknowledgeDriftAlert();
  const analyzeMutation = useAnalyzeDrift();
  const resetMutation = useResetDriftBaselines();
  const { toast } = useToast();

  const sortedAlerts = useMemo(
    () =>
      [...alerts].sort(
        (a, b) =>
          SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
          b.timestamp.localeCompare(a.timestamp)
      ),
    [alerts]
  );

  const topSummary = useMemo(() => {
    const critical = alerts.filter(
      (alert) => alert.severity === 'critical' && !alert.acknowledged
    ).length;
    const warning = alerts.filter(
      (alert) => alert.severity === 'warning' && !alert.acknowledged
    ).length;
    const agents = new Set(baselines.map((baseline) => baseline.agentId)).size;
    return { critical, warning, agents };
  }, [alerts, baselines]);

  const latestTrend = useMemo(() => {
    const first = sortedAlerts[0];
    if (!first) return null;
    const trend: DriftTrend =
      first.currentValue > first.baselineValue
        ? 'increasing'
        : first.currentValue < first.baselineValue
          ? 'decreasing'
          : 'stable';
    return { metric: first.metric, trend };
  }, [sortedAlerts]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Board
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Behavioral Drift Monitor</h1>
            <p className="text-sm text-muted-foreground">
              Detects agent deviation across action frequency, duration, cost, tokens, risk, and
              success rates.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Agent ID"
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
            className="w-[180px]"
          />
          <div className="flex rounded-lg border bg-card p-1">
            {(['all', 'critical', 'warning', 'info'] as const).map((level) => (
              <button
                key={level}
                type="button"
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm capitalize transition-colors',
                  severity === level
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground'
                )}
                onClick={() => setSeverity(level)}
              >
                {level}
              </button>
            ))}
          </div>
          <Button
            onClick={() => {
              if (!agentId.trim()) {
                toast({
                  title: 'Agent ID required',
                  description: 'Enter an agent ID to run drift analysis.',
                });
                return;
              }
              analyzeMutation.mutate(agentId, {
                onSuccess: (result) => {
                  toast({
                    title: 'Drift analysis complete',
                    description: `${result.alerts.length} alert${result.alerts.length === 1 ? '' : 's'} generated for ${result.agentId}.`,
                  });
                },
                onError: (error) => {
                  toast({
                    title: 'Analysis failed',
                    description: error instanceof Error ? error.message : 'Unknown error',
                    variant: 'destructive',
                  });
                },
              });
            }}
            disabled={analyzeMutation.isPending}
          >
            <RefreshCw
              className={cn('mr-2 h-4 w-4', analyzeMutation.isPending && 'animate-spin')}
            />
            Analyze Agent
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldAlert className="h-4 w-4" />
            Unacknowledged Critical
          </div>
          <div className="text-3xl font-semibold">{topSummary.critical}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            Active Warnings
          </div>
          <div className="text-3xl font-semibold">{topSummary.warning}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
            <TrendingUp className="h-4 w-4" />
            Latest Direction
          </div>
          <div className="text-xl font-semibold">
            {latestTrend
              ? `${METRIC_LABELS[latestTrend.metric]} · ${TREND_LABELS[latestTrend.trend]}`
              : `${topSummary.agents} agents tracked`}
          </div>
        </div>
      </div>

      <DriftChart alerts={sortedAlerts} baselines={baselines} />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Alerts</h2>
          <Badge variant="outline">{sortedAlerts.length} total</Badge>
        </div>
        <AlertsTable
          alerts={sortedAlerts}
          isLoading={alertsLoading}
          acknowledgingId={acknowledgeMutation.variables}
          onAcknowledge={(id) =>
            acknowledgeMutation.mutate(id, {
              onError: (error) =>
                toast({
                  title: 'Failed to acknowledge alert',
                  description: error instanceof Error ? error.message : 'Unknown error',
                  variant: 'destructive',
                }),
            })
          }
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Baselines</h2>
          <Button
            variant="outline"
            disabled={!agentId || resetMutation.isPending}
            onClick={() =>
              resetMutation.mutate(
                { agentId },
                {
                  onSuccess: (result) =>
                    toast({
                      title: 'Baselines reset',
                      description: `${result.deleted} baseline file${result.deleted === 1 ? '' : 's'} removed.`,
                    }),
                  onError: (error) =>
                    toast({
                      title: 'Reset failed',
                      description: error instanceof Error ? error.message : 'Unknown error',
                      variant: 'destructive',
                    }),
                }
              )
            }
          >
            Reset Agent Baselines
          </Button>
        </div>
        <BaselineTable
          baselines={baselines}
          isLoading={baselinesLoading}
          resetting={resetMutation.isPending}
          onReset={(targetAgentId, metric) =>
            resetMutation.mutate(
              { agentId: targetAgentId, metric },
              {
                onSuccess: (result) =>
                  toast({
                    title: 'Baseline reset',
                    description: `${result.deleted} record${result.deleted === 1 ? '' : 's'} removed.`,
                  }),
                onError: (error) =>
                  toast({
                    title: 'Reset failed',
                    description: error instanceof Error ? error.message : 'Unknown error',
                    variant: 'destructive',
                  }),
              }
            )
          }
        />
      </section>
    </div>
  );
}

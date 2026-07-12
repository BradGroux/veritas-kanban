/**
 * WhereTimeWent — Breakdown of time by project (from telemetry)
 * GH #57: Dashboard "Where Time Went" breakdown panel
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/helpers';
import { formatDuration, type MetricsPeriod } from '@/hooks/useMetrics';
import { Clock } from 'lucide-react';

interface WhereTimeWentProps {
  period: MetricsPeriod;
}

const PROJECT_COLORS: string[] = [
  '#8b5cf6', // purple
  '#06b6d4', // cyan
  '#f59e0b', // amber
  '#22c55e', // green
  '#ef4444', // red
  '#3b82f6', // blue
  '#ec4899', // pink
  '#6b7280', // gray
];

interface TaskCostEntry {
  taskId: string;
  taskTitle: string;
  project: string;
  estimatedCost: number;
  totalTokens: number;
  totalDurationMs: number;
  runs: number;
}

interface TaskCostResult {
  totalCost: number;
  avgCostPerTask: number;
  tasks: TaskCostEntry[];
}

export function WhereTimeWent({ period }: WhereTimeWentProps) {
  // Pull task-level cost data which includes project and duration
  const { data: taskCost } = useQuery<TaskCostResult>({
    queryKey: ['task-cost', period],
    queryFn: () => apiFetch<TaskCostResult>(`/api/metrics/task-cost?period=${period}`),
    staleTime: 60_000,
  });

  const breakdown = useMemo(() => {
    if (!taskCost?.tasks?.length) return [];

    // Aggregate duration by project
    const byProject = new Map<string, number>();

    for (const task of taskCost.tasks) {
      const project = task.project || 'Unassigned';
      byProject.set(project, (byProject.get(project) || 0) + task.totalDurationMs);
    }

    const totalMs = Array.from(byProject.values()).reduce((s, v) => s + v, 0);

    return Array.from(byProject.entries())
      .map(([name, ms]) => ({
        name,
        ms,
        percentage: totalMs > 0 ? (ms / totalMs) * 100 : 0,
      }))
      .sort((a, b) => b.ms - a.ms);
  }, [taskCost]);

  const totalMs = breakdown.reduce((sum, b) => sum + b.ms, 0);

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
        <Clock className="w-4 h-4 text-muted-foreground" />
        Where Time Went
      </h3>

      {breakdown.length === 0 ? (
        <div className="text-xs text-muted-foreground/50 py-4 text-center">
          No time data for this period
        </div>
      ) : (
        <div className="space-y-2.5">
          {breakdown.map((item, i) => {
            const color = PROJECT_COLORS[i % PROJECT_COLORS.length];
            return (
              <div key={item.name}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium truncate">{item.name}</span>
                  <span className="text-muted-foreground shrink-0 ml-2">
                    {formatDuration(item.ms)} ({Math.round(item.percentage)}%)
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${item.percentage}%`,
                      backgroundColor: color,
                    }}
                  />
                </div>
              </div>
            );
          })}

          <div className="pt-2 border-t text-xs text-muted-foreground flex justify-between">
            <span>Total</span>
            <span className="font-medium">{formatDuration(totalMs)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

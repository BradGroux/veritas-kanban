/**
 * HourlyActivityChart — "Activity Over Time" hourly bar chart
 * GH #59: Dashboard hourly activity chart
 *
 * Shows agent activity volume per hour as a compact bar chart.
 * Uses status history entries for reliable data.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/helpers';
import { BarChart3 } from 'lucide-react';
import type { MetricsPeriod } from '@/hooks/useMetrics';

interface HourlyActivityChartProps {
  period: MetricsPeriod;
}

interface StatusHistoryEntry {
  timestamp: string;
}

export function HourlyActivityChart({ period }: HourlyActivityChartProps) {
  const { data: entries = [] } = useQuery<StatusHistoryEntry[]>({
    queryKey: ['status-history', 'hourly', period],
    queryFn: async () => {
      const res = await apiFetch<StatusHistoryEntry[]>('/api/status-history?limit=500');
      return Array.isArray(res) ? res : [];
    },
    staleTime: 60_000,
  });

  const hourlyBars = useMemo(() => {
    const hours = Array.from({ length: 24 }, () => 0);
    for (const entry of entries) {
      if (entry.timestamp) {
        hours[new Date(entry.timestamp).getHours()]++;
      }
    }
    const max = Math.max(...hours, 1);
    return hours.map((count, hour) => ({
      hour,
      count,
      height: (count / max) * 100,
      label: hour % 6 === 0 ? (hour === 0 ? '12a' : hour < 12 ? `${hour}a` : hour === 12 ? '12p' : `${hour - 12}p`) : '',
    }));
  }, [entries]);

  const totalEvents = hourlyBars.reduce((s, b) => s + b.count, 0);

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-muted-foreground" />
        Activity Over Time
        <span className="text-xs text-muted-foreground font-normal">({totalEvents} events)</span>
      </h3>

      <div className="flex items-end gap-[2px] h-[80px]">
        <span className="text-[8px] text-muted-foreground/40 self-start -mr-1 rotate-0 w-6 text-right leading-tight">Events</span>
        {hourlyBars.map((bar) => (
          <div key={bar.hour} className="flex-1 flex flex-col items-center justify-end h-full">
            <div
              className="w-full rounded-t-sm transition-all duration-300 min-h-[2px]"
              style={{
                height: `${Math.max(bar.height, 3)}%`,
                backgroundColor: bar.count > 0 ? `rgba(139, 92, 246, ${0.3 + (bar.height / 100) * 0.7})` : 'rgba(139, 92, 246, 0.08)',
              }}
              title={`${bar.hour}:00 — ${bar.count} events`}
            />
          </div>
        ))}
      </div>

      {/* X-axis labels */}
      <div className="flex justify-between text-[9px] text-muted-foreground/50 mt-1 ml-6 px-0.5">
        {hourlyBars.filter((b) => b.label).map((bar) => (
          <span key={bar.hour}>{bar.label}</span>
        ))}
      </div>
    </div>
  );
}

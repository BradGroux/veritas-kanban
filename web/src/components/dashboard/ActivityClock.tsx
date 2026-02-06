/**
 * ActivityClock — Donut chart showing activity distribution by hour
 * GH #58: Dashboard activity clock replacing timeline bar
 *
 * Shows a 24-hour ring with activity intensity per hour.
 * More activity = thicker/brighter segment.
 * Pulls from telemetry trends (which aggregates from real event data).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/helpers';
import { Clock, Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { MetricsPeriod } from '@/hooks/useMetrics';

interface ActivityClockProps {
  period: MetricsPeriod;
}

interface StatusHistoryEntry {
  timestamp: string;
  previousStatus: string;
  newStatus: string;
  durationMs?: number;
}

export function ActivityClock({ period }: ActivityClockProps) {
  // Pull from status history which has timestamps of actual agent state changes
  const { data: entries = [] } = useQuery<StatusHistoryEntry[]>({
    queryKey: ['status-history', 'clock', period],
    queryFn: async () => {
      const res = await apiFetch<StatusHistoryEntry[]>('/api/status-history?limit=500');
      return Array.isArray(res) ? res : [];
    },
    staleTime: 60_000,
  });

  const hourlyData = useMemo(() => {
    const hours = Array.from({ length: 24 }, () => 0);

    for (const entry of entries) {
      if (entry.timestamp) {
        const hour = new Date(entry.timestamp).getHours();
        hours[hour]++;
      }
    }

    const max = Math.max(...hours, 1);
    return hours.map((count, hour) => ({
      hour,
      count,
      intensity: count / max,
      label: hour === 0 ? '12a' : hour < 12 ? `${hour}a` : hour === 12 ? '12p' : `${hour - 12}p`,
    }));
  }, [entries]);

  const totalActivity = hourlyData.reduce((sum, h) => sum + h.count, 0);
  const peakHour = hourlyData.reduce((peak, h) => (h.count > peak.count ? h : peak), hourlyData[0]);

  // SVG donut chart
  const size = 180;
  const center = size / 2;
  const outerRadius = 75;
  const innerRadius = 45;

  const segments = hourlyData.map((data, i) => {
    const startAngle = (i / 24) * 360 - 90;
    const endAngle = ((i + 1) / 24) * 360 - 90;
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    const segRadius = innerRadius + (outerRadius - innerRadius) * Math.max(data.intensity, 0.15);

    const x1 = center + segRadius * Math.cos(startRad);
    const y1 = center + segRadius * Math.sin(startRad);
    const x2 = center + segRadius * Math.cos(endRad);
    const y2 = center + segRadius * Math.sin(endRad);
    const ix1 = center + innerRadius * Math.cos(startRad);
    const iy1 = center + innerRadius * Math.sin(startRad);
    const ix2 = center + innerRadius * Math.cos(endRad);
    const iy2 = center + innerRadius * Math.sin(endRad);

    const path = [
      `M ${ix1} ${iy1}`,
      `L ${x1} ${y1}`,
      `A ${segRadius} ${segRadius} 0 0 1 ${x2} ${y2}`,
      `L ${ix2} ${iy2}`,
      `A ${innerRadius} ${innerRadius} 0 0 0 ${ix1} ${iy1}`,
    ].join(' ');

    const opacity = Math.max(data.intensity * 0.9 + 0.1, 0.1);

    return (
      <path
        key={i}
        d={path}
        fill={`rgba(139, 92, 246, ${opacity})`}
        stroke="rgba(0,0,0,0.15)"
        strokeWidth="0.5"
      >
        <title>{data.label}: {data.count} transitions</title>
      </path>
    );
  });

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
        <Clock className="w-4 h-4 text-muted-foreground" />
        Activity Clock
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Info className="w-3 h-3 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[250px]">
              <p className="text-xs">
                24-hour ring showing when agent state transitions happen.
                Brighter/thicker segments = more activity at that hour.
                Midnight at top, noon at bottom. Based on status history.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </h3>

      <div className="flex items-center justify-center">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {segments}
          <text x={center} y={center - 8} textAnchor="middle" className="fill-foreground text-lg font-bold">
            {totalActivity}
          </text>
          <text x={center} y={center + 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
            transitions
          </text>
        </svg>
      </div>

      <div className="flex justify-between text-[10px] text-muted-foreground mt-2 px-2">
        <span>Peak: {peakHour.label} ({peakHour.count})</span>
        <span>24h distribution</span>
      </div>
    </div>
  );
}

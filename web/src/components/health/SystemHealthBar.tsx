/**
 * SystemHealthBar
 *
 * A thin, persistent status bar shown below the page header on ALL pages.
 * Displays the aggregated system health level with a colour-coded background,
 * an icon, and a short label.  Click to expand a detail panel that shows a
 * per-signal breakdown (infrastructure, agents, operations).
 *
 * This file lives in `components/health/` and is re-exported from the layout
 * barrel so App.tsx can import from either location.
 *
 * Placement in App.tsx (do NOT edit App.tsx — Brad will merge manually):
 *   <Header />
 *   <SystemHealthBar />   ← insert here, directly below the header
 *   <main>...</main>
 */
import { useState } from 'react';
import {
  ShieldCheck,
  Eye,
  TrendingDown,
  AlertTriangle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSystemHealth } from '@/hooks/useSystemHealth';
import type { HealthLevel } from '@veritas-kanban/shared';

// ─── Status configuration ─────────────────────────────────────

const STATUS_CONFIG: Record<
  HealthLevel,
  {
    icon: typeof ShieldCheck;
    label: string;
    barClass: string;
    iconClass: string;
  }
> = {
  stable: {
    icon: ShieldCheck,
    label: 'Stable',
    barClass: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    iconClass: 'text-emerald-600 dark:text-emerald-400',
  },
  reviewing: {
    icon: Eye,
    label: 'Reviewing',
    barClass: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
    iconClass: 'text-blue-600 dark:text-blue-400',
  },
  drifting: {
    icon: TrendingDown,
    label: 'Drifting',
    barClass: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    iconClass: 'text-amber-600 dark:text-amber-400',
  },
  elevated: {
    icon: AlertTriangle,
    label: 'Elevated',
    barClass: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
    iconClass: 'text-orange-600 dark:text-orange-400',
  },
  alert: {
    icon: AlertCircle,
    label: 'Alert',
    barClass: 'bg-red-500/10 text-red-700 dark:text-red-400',
    iconClass: 'text-red-600 dark:text-red-400',
  },
};

// ─── Signal status dot ────────────────────────────────────────

function SignalDot({ status }: { status: 'ok' | 'warn' | 'fail' | 'critical' }) {
  return (
    <span
      className={cn(
        'inline-block h-2 w-2 rounded-full',
        status === 'ok' && 'bg-emerald-500',
        status === 'warn' && 'bg-amber-500',
        (status === 'fail' || status === 'critical') && 'bg-red-500'
      )}
      aria-hidden="true"
    />
  );
}

// ─── Component ────────────────────────────────────────────────

/**
 * Global System Health Status Bar.
 *
 * - Polls `GET /api/v1/system/health` every 30 s (60 s when WebSocket is
 *   disconnected) via the `useSystemHealth` hook.
 * - Renders a thin strip (h-7) with colour, icon, and summary text.
 * - Click to expand a three-column detail panel.
 */
export function SystemHealthBar() {
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading, isError } = useSystemHealth();

  // Loading skeleton (only shown on first fetch, not on background refetches)
  if (isLoading && !data) {
    return (
      <div
        className="flex h-7 items-center justify-center border-b border-border bg-muted/30 text-xs text-muted-foreground"
        role="status"
        aria-label="Loading system health"
      >
        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden="true" />
        Checking system health…
      </div>
    );
  }

  // Silently hide when we have no data (error + no cached data)
  if ((isError && !data) || !data) return null;

  const config = STATUS_CONFIG[data.status];
  const StatusIcon = config.icon;
  const { system, agents, operations } = data.signals;

  // Build concise inline summary
  const summaryParts: string[] = [];
  if (agents.total > 0) {
    summaryParts.push(`${agents.online} agent${agents.online !== 1 ? 's' : ''} online`);
  }
  if (operations.recentRuns > 0) {
    summaryParts.push(`${Math.round(operations.successRate)}% success rate`);
  }
  const summary = summaryParts.join(' · ');

  const ToggleIcon = expanded ? ChevronUp : ChevronDown;

  return (
    <div className={cn('border-b border-border', config.barClass)}>
      {/* ── Collapsed bar ───────────────────────────────────── */}
      <button
        type="button"
        className="flex h-7 w-full items-center justify-center gap-2 px-4 text-xs
                   cursor-pointer select-none transition-opacity hover:opacity-80
                   focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-controls="system-health-details"
        aria-label={`System health: ${config.label}. ${summary}. Click to ${expanded ? 'collapse' : 'expand'} details.`}
      >
        <StatusIcon className={cn('h-3.5 w-3.5', config.iconClass)} aria-hidden="true" />
        <span className="font-medium">{config.label}</span>

        {summary && (
          <>
            <span className="opacity-40" aria-hidden="true">|</span>
            <span className="opacity-75">{summary}</span>
          </>
        )}

        <ToggleIcon className="ml-1 h-3 w-3 opacity-50" aria-hidden="true" />
      </button>

      {/* ── Expanded detail panel ────────────────────────────── */}
      {expanded && (
        <div
          id="system-health-details"
          className="border-t border-border/50 px-4 py-3"
          role="region"
          aria-label="System health details"
        >
          <div className="mx-auto grid max-w-2xl grid-cols-3 gap-4 text-xs">
            {/* Infrastructure */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 font-medium">
                <SignalDot status={system.status} />
                Infrastructure
              </div>
              <ul className="space-y-0.5 text-muted-foreground" aria-label="Infrastructure checks">
                <li>Storage: {system.storage ? 'OK' : 'Fail'}</li>
                <li>Disk: {system.disk ? 'OK' : 'Low'}</li>
                <li>Memory: {system.memory ? 'OK' : 'High'}</li>
              </ul>
            </div>

            {/* Agents */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 font-medium">
                <SignalDot status={agents.status} />
                Agents
              </div>
              <ul className="space-y-0.5 text-muted-foreground" aria-label="Agent status">
                <li>Total: {agents.total}</li>
                <li>Online: {agents.online}</li>
                <li>Offline: {agents.offline}</li>
              </ul>
            </div>

            {/* Operations */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 font-medium">
                <SignalDot status={operations.status} />
                Operations
              </div>
              <ul className="space-y-0.5 text-muted-foreground" aria-label="Operations metrics">
                <li>Recent runs: {operations.recentRuns}</li>
                <li>Success rate: {Math.round(operations.successRate)}%</li>
                <li>Failed: {operations.failedRuns}</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import {
  CheckCircle2,
  Eye,
  TrendingDown,
  AlertTriangle,
  AlertOctagon,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react';
import { useSystemHealth, type OverallStatus } from '@/hooks/useSystemHealth';

// ─── Status Configuration ─────────────────────────────────────

const STATUS_CONFIG: Record<
  OverallStatus,
  {
    icon: typeof CheckCircle2;
    label: string;
    barClass: string;
    iconClass: string;
  }
> = {
  stable: {
    icon: CheckCircle2,
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
    icon: AlertOctagon,
    label: 'Alert',
    barClass: 'bg-red-500/10 text-red-700 dark:text-red-400',
    iconClass: 'text-red-600 dark:text-red-400',
  },
};

// ─── Signal Status Dot ────────────────────────────────────────

function SignalDot({ status }: { status: 'ok' | 'warn' | 'fail' | 'critical' }) {
  const dotColor =
    status === 'ok' ? 'bg-emerald-500' : status === 'warn' ? 'bg-amber-500' : 'bg-red-500';
  return <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} />;
}

// ─── Component ────────────────────────────────────────────────

/**
 * A thin, persistent bar below the header showing aggregated system health.
 * Click to expand a detail panel with per-signal breakdown.
 */
export function SystemHealthBar() {
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading, isError } = useSystemHealth();

  // Don't render anything while loading or on error
  if (isLoading && !data) {
    return (
      <div
        className="flex h-7 items-center justify-center border-b border-border bg-muted/30 text-xs text-muted-foreground"
        role="status"
        aria-label="Loading system health"
      >
        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden="true" />
        Checking system health...
      </div>
    );
  }

  if (isError && !data) {
    return null;
  }

  if (!data) {
    return null;
  }

  const config = STATUS_CONFIG[data.status];
  const StatusIcon = config.icon;
  const { system, agents, operations } = data.signals;

  // Build summary text
  const summaryParts: string[] = [];
  if (agents.total > 0) {
    summaryParts.push(`${agents.online} agent${agents.online !== 1 ? 's' : ''} online`);
  }
  if (operations.recentRuns > 0) {
    summaryParts.push(`${Math.round(operations.successRate)}% success rate`);
  }
  const summary = summaryParts.join(' \u00B7 ');

  const ToggleIcon = expanded ? ChevronUp : ChevronDown;

  return (
    <div className={`border-b border-border ${config.barClass}`}>
      {/* Main bar */}
      <button
        className="flex h-7 w-full items-center justify-center gap-2 px-4 text-xs cursor-pointer select-none transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls="system-health-details"
        aria-label={`System health: ${config.label}. ${summary}. Click to ${expanded ? 'collapse' : 'expand'} details.`}
      >
        <StatusIcon className={`h-3.5 w-3.5 ${config.iconClass}`} aria-hidden="true" />
        <span className="font-medium">{config.label}</span>
        {summary && (
          <>
            <span className="opacity-40" aria-hidden="true">
              |
            </span>
            <span className="opacity-75">{summary}</span>
          </>
        )}
        <ToggleIcon className="ml-1 h-3 w-3 opacity-50" aria-hidden="true" />
      </button>

      {/* Detail panel */}
      {expanded && (
        <div
          id="system-health-details"
          className="border-t border-border/50 px-4 py-3"
          role="region"
          aria-label="System health details"
        >
          <div className="mx-auto grid max-w-2xl grid-cols-3 gap-4 text-xs">
            {/* System signal */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 font-medium">
                <SignalDot status={system.status} />
                Infrastructure
              </div>
              <ul className="space-y-0.5 text-muted-foreground" aria-label="Infrastructure checks">
                <li>Storage: {system.storage ? 'OK' : 'Fail'}</li>
                <li>Disk: {system.disk ? 'OK' : 'Fail'}</li>
                <li>Memory: {system.memory ? 'OK' : 'High'}</li>
              </ul>
            </div>

            {/* Agents signal */}
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

            {/* Operations signal */}
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

import { useFeatureSettings } from '@/hooks/useFeatureSettings';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import { Shield, ShieldCheck, ShieldX } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Dashboard indicator showing which enforcement gates are currently active.
 * Provides at-a-glance visibility into process enforcement state.
 */
export function EnforcementIndicator() {
  const { settings, isLoading } = useFeatureSettings();

  if (isLoading) return null;

  const enforcement = settings.enforcement ?? DEFAULT_FEATURE_SETTINGS.enforcement;

  const gates = [
    { key: 'reviewGate', label: 'Review Gate', active: enforcement.reviewGate ?? false },
    {
      key: 'closingComments',
      label: 'Closing Comments',
      active: enforcement.closingComments ?? false,
    },
    { key: 'squadChat', label: 'Squad Chat', active: enforcement.squadChat ?? false },
    { key: 'autoTelemetry', label: 'Auto Telemetry', active: enforcement.autoTelemetry ?? false },
    {
      key: 'autoTimeTracking',
      label: 'Time Tracking',
      active: enforcement.autoTimeTracking ?? false,
    },
    {
      key: 'orchestratorDelegation',
      label: 'Delegation',
      active: enforcement.orchestratorDelegation ?? false,
    },
  ];

  const activeCount = gates.filter((g) => g.active).length;
  const totalCount = gates.length;

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-card text-card-foreground">
      <div className="flex items-center gap-1.5">
        {activeCount === 0 ? (
          <ShieldX className="h-4 w-4 text-muted-foreground" />
        ) : activeCount === totalCount ? (
          <ShieldCheck className="h-4 w-4 text-green-500" />
        ) : (
          <Shield className="h-4 w-4 text-amber-500" />
        )}
        <span className="text-xs font-medium text-muted-foreground">Enforcement</span>
        <span
          className={cn(
            'text-xs font-semibold tabular-nums',
            activeCount === 0 && 'text-muted-foreground',
            activeCount > 0 && activeCount < totalCount && 'text-amber-500',
            activeCount === totalCount && 'text-green-500'
          )}
        >
          {activeCount}/{totalCount}
        </span>
      </div>
      <div className="flex gap-1">
        {gates.map((gate) => (
          <div
            key={gate.key}
            title={`${gate.label}: ${gate.active ? 'Active' : 'Off'}`}
            className={cn(
              'h-1.5 w-1.5 rounded-full transition-colors',
              gate.active ? 'bg-green-500' : 'bg-muted-foreground/30'
            )}
          />
        ))}
      </div>
    </div>
  );
}

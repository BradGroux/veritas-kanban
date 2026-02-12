import { useFeatureSettings, useDebouncedFeatureUpdate } from '@/hooks/useFeatureSettings';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import { ToggleRow, SectionHeader, SaveIndicator } from '../shared';

export function EnforcementTab() {
  const { settings } = useFeatureSettings();
  const { debouncedUpdate, isPending } = useDebouncedFeatureUpdate();

  const updateEnforcement = (key: string, value: boolean) => {
    debouncedUpdate({ enforcement: { [key]: value } });
  };

  const resetEnforcement = () => {
    debouncedUpdate({
      enforcement: DEFAULT_FEATURE_SETTINGS.enforcement,
    });
  };

  const enforcement = settings.enforcement || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionHeader title="Enforcement Gates" onReset={resetEnforcement} />
        <SaveIndicator isPending={isPending} />
      </div>
      <p className="text-sm text-muted-foreground -mt-2">
        Structural process enforcement — all gates are opt-in
      </p>

      <div className="space-y-4 mt-6">
        <div className="divide-y">
          <div>
            <ToggleRow
              label="Review Gate"
              description="Require 4x10 review scores before task completion"
              checked={enforcement.reviewGate || false}
              onCheckedChange={(v) => updateEnforcement('reviewGate', v)}
            />
            {enforcement.reviewGate && (
              <p className="text-xs text-muted-foreground bg-muted rounded-md px-3 py-2 mx-1 -mt-1 mb-3">
                ⚠️ Code task types only (code, bug, feature, automation, system). Non-code tasks
                skip this gate.
              </p>
            )}
          </div>
          <ToggleRow
            label="Closing Comments"
            description="Require deliverable summary before task completion"
            checked={enforcement.closingComments || false}
            onCheckedChange={(v) => updateEnforcement('closingComments', v)}
          />
        </div>
      </div>

      <div className="border-t my-6" />

      {/* Automation Gates */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-foreground">Automation</h3>
        <div className="divide-y">
          <ToggleRow
            label="Squad Chat"
            description="Auto-post task lifecycle events to squad chat"
            checked={enforcement.squadChat || false}
            onCheckedChange={(v) => updateEnforcement('squadChat', v)}
          />
          <ToggleRow
            label="Auto Telemetry"
            description="Auto-emit run events on status changes"
            checked={enforcement.autoTelemetry || false}
            onCheckedChange={(v) => updateEnforcement('autoTelemetry', v)}
          />
          <ToggleRow
            label="Auto Time Tracking"
            description="Auto-start/stop timers on status changes"
            checked={enforcement.autoTimeTracking || false}
            onCheckedChange={(v) => updateEnforcement('autoTimeTracking', v)}
          />
          <ToggleRow
            label="Orchestrator Delegation"
            description="Warn when orchestrator does work instead of delegating"
            checked={enforcement.orchestratorDelegation || false}
            onCheckedChange={(v) => updateEnforcement('orchestratorDelegation', v)}
          />
        </div>
      </div>
    </div>
  );
}

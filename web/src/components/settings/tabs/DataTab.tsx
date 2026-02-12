import { useFeatureSettings, useDebouncedFeatureUpdate } from '@/hooks/useFeatureSettings';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import { ToggleRow, NumberRow, SectionHeader, SaveIndicator } from '../shared';

export function DataTab() {
  const { settings } = useFeatureSettings();
  const { debouncedUpdate, isPending } = useDebouncedFeatureUpdate();

  const updateTelemetry = (key: string, value: any) => {
    debouncedUpdate({ telemetry: { [key]: value } });
  };

  const updateArchive = (key: string, value: any) => {
    debouncedUpdate({ archive: { [key]: value } });
  };

  const updateBudget = (key: string, value: any) => {
    debouncedUpdate({ budget: { [key]: value } });
  };

  const resetData = () => {
    debouncedUpdate({
      telemetry: DEFAULT_FEATURE_SETTINGS.telemetry,
      archive: DEFAULT_FEATURE_SETTINGS.archive,
      budget: DEFAULT_FEATURE_SETTINGS.budget,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SectionHeader title="Telemetry & Data" onReset={resetData} />
        <SaveIndicator isPending={isPending} />
      </div>

      {/* Telemetry */}
      <div className="divide-y">
        <ToggleRow
          label="Telemetry Collection"
          description="Master toggle for all telemetry event collection"
          checked={settings.telemetry?.enabled ?? DEFAULT_FEATURE_SETTINGS.telemetry.enabled}
          onCheckedChange={(v) => updateTelemetry('enabled', v)}
        />
        {(settings.telemetry?.enabled ?? DEFAULT_FEATURE_SETTINGS.telemetry.enabled) && (
          <>
            <NumberRow
              label="Retention Period"
              description="Auto-purge events older than N days (7-365)"
              value={
                settings.telemetry?.retentionDays ??
                DEFAULT_FEATURE_SETTINGS.telemetry.retentionDays
              }
              onChange={(v) => updateTelemetry('retentionDays', v)}
              min={7}
              max={365}
              unit="days"
              hideSpinners
              maxLength={3}
            />
            <ToggleRow
              label="Trace Collection"
              description="Enable detailed trace collection for agent runs"
              checked={
                settings.telemetry?.enableTraces ?? DEFAULT_FEATURE_SETTINGS.telemetry.enableTraces
              }
              onCheckedChange={(v) => updateTelemetry('enableTraces', v)}
            />
            <ToggleRow
              label="Activity Tracking"
              description="Log activity events for the sidebar"
              checked={
                settings.telemetry?.enableActivityTracking ??
                DEFAULT_FEATURE_SETTINGS.telemetry.enableActivityTracking
              }
              onCheckedChange={(v) => updateTelemetry('enableActivityTracking', v)}
            />
          </>
        )}
      </div>

      {/* Budget Tracking */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Budget Tracking
        </h4>
        <div className="divide-y">
          <ToggleRow
            label="Budget Tracking"
            description="Track monthly token usage against budget limits"
            checked={settings.budget?.enabled ?? DEFAULT_FEATURE_SETTINGS.budget.enabled}
            onCheckedChange={(v) => updateBudget('enabled', v)}
          />
          {(settings.budget?.enabled ?? DEFAULT_FEATURE_SETTINGS.budget.enabled) && (
            <>
              <NumberRow
                label="Monthly Token Limit"
                description="Set monthly token budget (0 = no limit)"
                value={
                  settings.budget?.monthlyTokenLimit ??
                  DEFAULT_FEATURE_SETTINGS.budget.monthlyTokenLimit
                }
                onChange={(v) => updateBudget('monthlyTokenLimit', v)}
                min={0}
                max={9_999_999_999}
                unit="tokens"
                hideSpinners
                maxLength={10}
              />
              <NumberRow
                label="Monthly Cost Limit"
                description="Set monthly cost budget in dollars (0 = no limit)"
                value={
                  settings.budget?.monthlyCostLimit ??
                  DEFAULT_FEATURE_SETTINGS.budget.monthlyCostLimit
                }
                onChange={(v) => updateBudget('monthlyCostLimit', v)}
                min={0}
                max={9_999_999_999}
                unit="USD"
                hideSpinners
                maxLength={10}
              />
              <NumberRow
                label="Warning Threshold"
                description="Show warning when usage exceeds this percentage of budget"
                value={
                  settings.budget?.warningThreshold ??
                  DEFAULT_FEATURE_SETTINGS.budget.warningThreshold
                }
                onChange={(v) => updateBudget('warningThreshold', v)}
                min={50}
                max={99}
                step={5}
                unit="%"
                hideSpinners
                maxLength={2}
              />
            </>
          )}
        </div>
      </div>

      {/* Archive */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Archive
        </h4>
        <div className="divide-y">
          <ToggleRow
            label="Auto-Archive"
            description="Automatically archive completed sprints"
            checked={
              settings.archive?.autoArchiveEnabled ??
              DEFAULT_FEATURE_SETTINGS.archive.autoArchiveEnabled
            }
            onCheckedChange={(v) => updateArchive('autoArchiveEnabled', v)}
          />
          {(settings.archive?.autoArchiveEnabled ??
            DEFAULT_FEATURE_SETTINGS.archive.autoArchiveEnabled) && (
            <NumberRow
              label="Archive After"
              description="Days after completion before auto-archiving"
              value={
                settings.archive?.autoArchiveAfterDays ??
                DEFAULT_FEATURE_SETTINGS.archive.autoArchiveAfterDays
              }
              onChange={(v) => updateArchive('autoArchiveAfterDays', v)}
              min={1}
              max={365}
              unit="days"
              hideSpinners
              maxLength={3}
            />
          )}
        </div>
      </div>
    </div>
  );
}

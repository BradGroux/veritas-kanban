import { useFeatureSettings, useDebouncedFeatureUpdate } from '@/hooks/useFeatureSettings';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import {
  ToggleRow,
  NumberRow,
  SaveIndicator,
  SettingRow,
  SettingsPage,
  SettingsSection,
} from '../shared';

export function DocFreshnessTab() {
  const { settings } = useFeatureSettings();
  const { debouncedUpdate, isPending } = useDebouncedFeatureUpdate();

  const docFreshness = settings.docFreshness || DEFAULT_FEATURE_SETTINGS.docFreshness;

  const update = (key: string, value: boolean | number) => {
    debouncedUpdate({ docFreshness: { ...docFreshness, [key]: value } });
  };

  const resetDocFreshness = () => {
    debouncedUpdate({ docFreshness: DEFAULT_FEATURE_SETTINGS.docFreshness });
  };

  return (
    <SettingsPage
      title="Doc Freshness"
      description="Track and alert on documentation staleness across projects."
    >
      <SettingsSection
        title="Freshness Policy"
        description="Set the scan cadence and response when documents become stale."
        actions={<SaveIndicator isPending={isPending} />}
        onReset={resetDocFreshness}
        divided
      >
        <ToggleRow
          label="Enable Doc Freshness"
          description="Turn on documentation freshness tracking"
          checked={docFreshness.enabled}
          onCheckedChange={(v) => update('enabled', v)}
        />
        <NumberRow
          label="Default Max Age"
          description="Days before a document is considered stale"
          value={docFreshness.defaultMaxAgeDays}
          onChange={(v) => update('defaultMaxAgeDays', v)}
          min={1}
          max={365}
          unit="days"
          hideSpinners
          maxLength={3}
        />
        <ToggleRow
          label="Alert on Stale"
          description="Generate alerts when docs pass their max age"
          checked={docFreshness.alertOnStale}
          onCheckedChange={(v) => update('alertOnStale', v)}
        />
        <ToggleRow
          label="Auto-Create Review Tasks"
          description="Automatically create review tasks for stale docs"
          checked={docFreshness.autoCreateReviewTasks}
          onCheckedChange={(v) => update('autoCreateReviewTasks', v)}
        />
        <SettingRow label="Scan Interval" description="How often to scan docs for staleness">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={168}
              step={1}
              value={docFreshness.staleScanIntervalHours}
              onChange={(e) => update('staleScanIntervalHours', Number(e.target.value))}
              className="w-36 accent-primary"
            />
            <span className="text-xs text-muted-foreground w-12 text-right">
              {docFreshness.staleScanIntervalHours}h
            </span>
          </div>
        </SettingRow>
      </SettingsSection>
    </SettingsPage>
  );
}

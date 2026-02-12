import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFeatureSettings, useDebouncedFeatureUpdate } from '@/hooks/useFeatureSettings';
import { DEFAULT_FEATURE_SETTINGS, type DashboardWidgetSettings } from '@veritas-kanban/shared';
import { SettingRow, ToggleRow, SectionHeader, SaveIndicator } from '../shared';

export function BoardTab() {
  const { settings } = useFeatureSettings();
  const { debouncedUpdate, isPending } = useDebouncedFeatureUpdate();

  const update = (key: string, value: any) => {
    debouncedUpdate({ board: { [key]: value } });
  };

  const resetBoard = () => {
    debouncedUpdate({ board: DEFAULT_FEATURE_SETTINGS.board });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionHeader title="Board & Display" onReset={resetBoard} />
        <SaveIndicator isPending={isPending} />
      </div>
      <div className="divide-y">
        <ToggleRow
          label="Show Dashboard"
          description="Display the metrics dashboard section above the board"
          checked={settings.board?.showDashboard ?? DEFAULT_FEATURE_SETTINGS.board.showDashboard}
          onCheckedChange={(v) => update('showDashboard', v)}
        />
        {(settings.board?.showDashboard ?? DEFAULT_FEATURE_SETTINGS.board.showDashboard) && (
          <>
            <div className="pl-6 border-l-2 border-muted ml-2 space-y-0 divide-y">
              {(
                [
                  ['showTokenUsage', 'Token Usage', 'Token consumption per run'],
                  ['showRunDuration', 'Run Duration', 'Average run duration and percentiles'],
                  ['showAgentComparison', 'Agent Comparison', 'Side-by-side agent performance'],
                  ['showStatusTimeline', 'Status Timeline', 'Agent activity timeline'],
                  ['showCostPerTask', 'Cost per Task', 'Dollar cost breakdown by task'],
                  ['showAgentUtilization', 'Agent Utilization', 'Active vs idle time'],
                  ['showWallTime', 'Wall Time', 'Wall clock time metrics'],
                  ['showSessionMetrics', 'Session Metrics', 'Session count and duration'],
                  ['showActivityClock', 'Activity Clock', '24-hour activity heatmap'],
                  ['showWhereTimeWent', 'Where Time Went', 'Time distribution by project'],
                  ['showHourlyActivity', 'Hourly Activity', 'Activity by hour of day'],
                  [
                    'showTrendsCharts',
                    'Trends Charts',
                    'Success rate, tokens, and duration over time',
                  ],
                ] as const
              ).map(([key, label, desc]) => (
                <ToggleRow
                  key={key}
                  label={label}
                  description={desc}
                  checked={
                    (settings.board.dashboardWidgets ??
                      DEFAULT_FEATURE_SETTINGS.board.dashboardWidgets)?.[
                      key as keyof DashboardWidgetSettings
                    ] ?? true
                  }
                  onCheckedChange={(v) =>
                    debouncedUpdate({
                      board: {
                        dashboardWidgets: {
                          ...(settings.board?.dashboardWidgets ??
                            DEFAULT_FEATURE_SETTINGS.board.dashboardWidgets),
                          [key]: v,
                        },
                      },
                    })
                  }
                />
              ))}
            </div>
          </>
        )}
        <ToggleRow
          label="Archive Suggestions"
          description="Show banner when all sprint tasks are complete"
          checked={
            settings.board?.showArchiveSuggestions ??
            DEFAULT_FEATURE_SETTINGS.board.showArchiveSuggestions
          }
          onCheckedChange={(v) => update('showArchiveSuggestions', v)}
        />
        <SettingRow label="Card Density" description="Compact cards use less space">
          <Select
            value={settings.board?.cardDensity ?? DEFAULT_FEATURE_SETTINGS.board.cardDensity}
            onValueChange={(v) => update('cardDensity', v)}
          >
            <SelectTrigger className="w-28 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="compact">Compact</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
        <ToggleRow
          label="Priority Indicators"
          description="Show priority badge on task cards"
          checked={
            settings.board?.showPriorityIndicators ??
            DEFAULT_FEATURE_SETTINGS.board.showPriorityIndicators
          }
          onCheckedChange={(v) => update('showPriorityIndicators', v)}
        />
        <ToggleRow
          label="Project Badges"
          description="Show project badge on task cards"
          checked={
            settings.board?.showProjectBadges ?? DEFAULT_FEATURE_SETTINGS.board.showProjectBadges
          }
          onCheckedChange={(v) => update('showProjectBadges', v)}
        />
        <ToggleRow
          label="Sprint Badges"
          description="Show sprint badge on task cards"
          checked={
            settings.board?.showSprintBadges ?? DEFAULT_FEATURE_SETTINGS.board.showSprintBadges
          }
          onCheckedChange={(v) => update('showSprintBadges', v)}
        />
        <ToggleRow
          label="Drag & Drop"
          description="Allow dragging cards between columns"
          checked={
            settings.board?.enableDragAndDrop ?? DEFAULT_FEATURE_SETTINGS.board.enableDragAndDrop
          }
          onCheckedChange={(v) => update('enableDragAndDrop', v)}
        />
        <ToggleRow
          label="Done Column Metrics"
          description="Show agent run count, success status, and duration on completed tasks"
          checked={
            settings.board?.showDoneMetrics ?? DEFAULT_FEATURE_SETTINGS.board.showDoneMetrics
          }
          onCheckedChange={(v) => update('showDoneMetrics', v)}
        />
      </div>
    </div>
  );
}

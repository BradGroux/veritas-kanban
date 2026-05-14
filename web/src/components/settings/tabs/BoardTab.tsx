import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFeatureSettings, useDebouncedFeatureUpdate } from '@/hooks/useFeatureSettings';
import {
  DEFAULT_FEATURE_SETTINGS,
  type BoardColumnConfig,
  type DashboardWidgetSettings,
} from '@veritas-kanban/shared';
import { SettingRow, ToggleRow, SectionHeader, SaveIndicator } from '../shared';

function slugifyColumnTitle(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'column'
  ).slice(0, 50);
}

function makeUniqueColumnId(base: string, columns: BoardColumnConfig[]): string {
  const existing = new Set(columns.map((column) => column.id));
  let id = slugifyColumnTitle(base);
  let suffix = 2;
  while (existing.has(id)) {
    id = `${slugifyColumnTitle(base)}-${suffix}`;
    suffix += 1;
  }
  return id;
}

export function BoardTab() {
  const { settings } = useFeatureSettings();
  const { debouncedUpdate, isPending } = useDebouncedFeatureUpdate();
  const board = settings.board ?? DEFAULT_FEATURE_SETTINGS.board;
  const columns = board.columns?.length ? board.columns : DEFAULT_FEATURE_SETTINGS.board.columns;
  const defaultStatus = columns.some((column) => column.id === board.defaultStatus)
    ? board.defaultStatus
    : columns[0]?.id;

  const update = (key: string, value: any) => {
    debouncedUpdate({ board: { [key]: value } });
  };

  const updateColumns = (nextColumns: BoardColumnConfig[]) => {
    debouncedUpdate({
      board: {
        columns: nextColumns,
        defaultStatus: nextColumns.some((column) => column.id === defaultStatus)
          ? defaultStatus
          : nextColumns[0]?.id,
      },
    });
  };

  const insertColumn = (index: number) => {
    const id = makeUniqueColumnId('new-column', columns);
    const nextColumns = [...columns];
    nextColumns.splice(index, 0, { id, title: 'New Column' });
    updateColumns(nextColumns);
  };

  const updateColumnTitle = (index: number, title: string) => {
    updateColumns(columns.map((column, i) => (i === index ? { ...column, title } : column)));
  };

  const updateColumnId = (index: number, id: string) => {
    const normalizedId = slugifyColumnTitle(id);
    updateColumns(
      columns.map((column, i) => (i === index ? { ...column, id: normalizedId } : column))
    );
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
        <div className="py-3 space-y-3">
          <div>
            <Label className="text-sm font-medium">Board Columns</Label>
            <p className="text-xs text-muted-foreground">
              Configure visible workflow columns. Existing task statuses are preserved.
            </p>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0"
              aria-label="Add column before first column"
              onClick={() => insertColumn(0)}
            >
              +
            </Button>
            {columns.map((column, index) => (
              <div key={`${column.id}-${index}`} className="flex items-center gap-2 shrink-0">
                <div className="rounded-md border bg-background p-2 space-y-2 w-44">
                  <Input
                    value={column.title}
                    aria-label={`Column ${index + 1} title`}
                    onChange={(event) => updateColumnTitle(index, event.target.value)}
                    className="h-8"
                  />
                  <Input
                    value={column.id}
                    aria-label={`Column ${index + 1} status ID`}
                    onChange={(event) => updateColumnId(index, event.target.value)}
                    className="h-8 font-mono text-xs"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0"
                  aria-label={`Add column after ${column.title || column.id}`}
                  onClick={() => insertColumn(index + 1)}
                >
                  +
                </Button>
              </div>
            ))}
          </div>
          <SettingRow label="Default Column" description="New tasks are created in this column">
            <Select value={defaultStatus} onValueChange={(v) => update('defaultStatus', v)}>
              <SelectTrigger className="w-40 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {columns.map((column) => (
                  <SelectItem key={column.id} value={column.id}>
                    {column.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        </div>
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

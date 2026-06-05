import { ActionIcon, Button, Group, Select, TextInput } from '@mantine/core';
import { useFeatureSettings, useDebouncedFeatureUpdate } from '@/hooks/useFeatureSettings';
import {
  DEFAULT_FEATURE_SETTINGS,
  normalizeBoardColumns,
  normalizeBoardDefaultStatus,
  type BoardColumnConfig,
  type DashboardWidgetSettings,
} from '@veritas-kanban/shared';
import { SettingRow, ToggleRow, SectionHeader, SaveIndicator } from '../shared';
import { Plus, Trash2 } from 'lucide-react';

export function BoardTab() {
  const { settings } = useFeatureSettings();
  const { debouncedUpdate, isPending } = useDebouncedFeatureUpdate();
  const boardSettings = settings.board ?? DEFAULT_FEATURE_SETTINGS.board;
  const columns = normalizeBoardColumns(boardSettings.columns);
  const defaultStatus = normalizeBoardDefaultStatus(boardSettings.defaultStatus, columns);

  const update = (key: string, value: any) => {
    debouncedUpdate({ board: { [key]: value } });
  };

  const updateBoardColumns = (
    nextColumns: BoardColumnConfig[],
    nextDefaultStatus = defaultStatus
  ) => {
    const normalizedColumns = normalizeBoardColumns(nextColumns);
    debouncedUpdate({
      board: {
        columns: normalizedColumns,
        defaultStatus: normalizeBoardDefaultStatus(nextDefaultStatus, normalizedColumns),
      },
    });
  };

  const updateColumn = (index: number, patch: Partial<BoardColumnConfig>) => {
    const previousId = columns[index]?.id;
    const nextColumns = columns.map((column, columnIndex) =>
      columnIndex === index ? { ...column, ...patch } : column
    );
    const nextDefaultStatus =
      previousId && previousId === defaultStatus && patch.id ? patch.id : defaultStatus;
    updateBoardColumns(nextColumns, nextDefaultStatus);
  };

  const addColumn = () => {
    let suffix = columns.length + 1;
    let id = `column-${suffix}`;
    const used = new Set(columns.map((column) => column.id));
    while (used.has(id)) {
      suffix += 1;
      id = `column-${suffix}`;
    }
    updateBoardColumns([...columns, { id, title: `Column ${suffix}` }]);
  };

  const removeColumn = (index: number) => {
    if (columns.length <= 1) return;
    const removedId = columns[index]?.id;
    const nextColumns = columns.filter((_, columnIndex) => columnIndex !== index);
    updateBoardColumns(
      nextColumns,
      removedId === defaultStatus ? nextColumns[0]?.id : defaultStatus
    );
  };

  const normalizeIdInput = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/^-+/, '')
      .replace(/-{2,}/g, '-')
      .slice(0, 50);

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
          checked={boardSettings.showDashboard ?? DEFAULT_FEATURE_SETTINGS.board.showDashboard}
          onCheckedChange={(v) => update('showDashboard', v)}
        />
        {(boardSettings.showDashboard ?? DEFAULT_FEATURE_SETTINGS.board.showDashboard) && (
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
                    (boardSettings.dashboardWidgets ??
                      DEFAULT_FEATURE_SETTINGS.board.dashboardWidgets)?.[
                      key as keyof DashboardWidgetSettings
                    ] ?? true
                  }
                  onCheckedChange={(v) =>
                    debouncedUpdate({
                      board: {
                        dashboardWidgets: {
                          ...(boardSettings.dashboardWidgets ??
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
            boardSettings.showArchiveSuggestions ??
            DEFAULT_FEATURE_SETTINGS.board.showArchiveSuggestions
          }
          onCheckedChange={(v) => update('showArchiveSuggestions', v)}
        />
        <SettingRow label="Card Density" description="Compact cards use less space">
          <Select
            value={boardSettings.cardDensity ?? DEFAULT_FEATURE_SETTINGS.board.cardDensity}
            onChange={(value) => value && update('cardDensity', value)}
            data={[
              { value: 'normal', label: 'Normal' },
              { value: 'compact', label: 'Compact' },
            ]}
            aria-label="Card Density"
            allowDeselect={false}
            size="xs"
            w={112}
          />
        </SettingRow>
        <SettingRow
          label="Default Status"
          description="Status assigned when a task is created without an explicit status"
        >
          <Select
            value={defaultStatus}
            onChange={(value) => value && update('defaultStatus', value)}
            data={columns.map((column) => ({ value: column.id, label: column.title }))}
            aria-label="Default task status"
            allowDeselect={false}
            size="xs"
            w={160}
          />
        </SettingRow>
        <div className="py-3">
          <Group justify="space-between" align="center" mb="xs">
            <div>
              <div className="text-sm font-medium">Board Columns</div>
              <div className="text-xs text-muted-foreground">Visible task statuses and order</div>
            </div>
            <Button
              type="button"
              variant="light"
              size="xs"
              leftSection={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={addColumn}
              disabled={columns.length >= 12}
            >
              Add
            </Button>
          </Group>
          <div className="space-y-2">
            {columns.map((column, index) => (
              <div
                key={`${column.id}-${index}`}
                className="grid grid-cols-[minmax(120px,1fr)_minmax(120px,1fr)_32px] gap-2"
              >
                <TextInput
                  aria-label={`Column ${index + 1} status ID`}
                  value={column.id}
                  onChange={(event) => {
                    const id = normalizeIdInput(event.currentTarget.value);
                    if (id) updateColumn(index, { id });
                  }}
                  size="xs"
                  maxLength={50}
                />
                <TextInput
                  aria-label={`Column ${index + 1} title`}
                  value={column.title}
                  onChange={(event) => {
                    const title = event.currentTarget.value.slice(0, 50);
                    if (title.trim()) updateColumn(index, { title });
                  }}
                  size="xs"
                  maxLength={50}
                />
                <ActionIcon
                  aria-label={`Remove ${column.title}`}
                  variant="subtle"
                  color="red"
                  size="sm"
                  onClick={() => removeColumn(index)}
                  disabled={columns.length <= 1}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </ActionIcon>
              </div>
            ))}
          </div>
        </div>
        <ToggleRow
          label="Priority Indicators"
          description="Show priority badge on task cards"
          checked={
            boardSettings.showPriorityIndicators ??
            DEFAULT_FEATURE_SETTINGS.board.showPriorityIndicators
          }
          onCheckedChange={(v) => update('showPriorityIndicators', v)}
        />
        <ToggleRow
          label="Project Badges"
          description="Show project badge on task cards"
          checked={
            boardSettings.showProjectBadges ?? DEFAULT_FEATURE_SETTINGS.board.showProjectBadges
          }
          onCheckedChange={(v) => update('showProjectBadges', v)}
        />
        <ToggleRow
          label="Sprint Badges"
          description="Show sprint badge on task cards"
          checked={
            boardSettings.showSprintBadges ?? DEFAULT_FEATURE_SETTINGS.board.showSprintBadges
          }
          onCheckedChange={(v) => update('showSprintBadges', v)}
        />
        <ToggleRow
          label="Drag & Drop"
          description="Allow dragging cards between columns"
          checked={
            boardSettings.enableDragAndDrop ?? DEFAULT_FEATURE_SETTINGS.board.enableDragAndDrop
          }
          onCheckedChange={(v) => update('enableDragAndDrop', v)}
        />
        <ToggleRow
          label="Done Column Metrics"
          description="Show agent run count, success status, and duration on completed tasks"
          checked={boardSettings.showDoneMetrics ?? DEFAULT_FEATURE_SETTINGS.board.showDoneMetrics}
          onCheckedChange={(v) => update('showDoneMetrics', v)}
        />
      </div>
    </div>
  );
}

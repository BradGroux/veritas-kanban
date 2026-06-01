import { useState } from 'react';
import { Button, Group, Select, Text, TextInput } from '@mantine/core';
import { Download } from 'lucide-react';
import type { MetricsPeriod } from '@/hooks/useMetrics';
import type { ProjectConfig } from '@veritas-kanban/shared';

interface DashboardFilterBarProps {
  period: MetricsPeriod;
  onPeriodChange: (period: MetricsPeriod, from?: string, to?: string) => void;
  project?: string;
  onProjectChange: (project?: string) => void;
  projects: ProjectConfig[];
  onExportClick: () => void;
}

type PresetPeriod = Exclude<MetricsPeriod, 'custom'>;

const PERIOD_PRESETS: { value: PresetPeriod; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '3d', label: '3 Days' },
  { value: '7d', label: '1 Week' },
  { value: '30d', label: '1 Month' },
  { value: 'wtd', label: 'WTD' },
  { value: 'mtd', label: 'MTD' },
  { value: 'ytd', label: 'YTD' },
  { value: 'all', label: 'All' },
];

export function DashboardFilterBar({
  period,
  onPeriodChange,
  project,
  onProjectChange,
  projects,
  onExportClick,
}: DashboardFilterBarProps) {
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const handlePresetClick = (preset: PresetPeriod) => {
    onPeriodChange(preset);
  };

  const handleCustomApply = () => {
    if (customFrom && customTo) {
      // Convert to ISO format for API
      const fromISO = new Date(customFrom + 'T00:00:00').toISOString();
      const toISO = new Date(customTo + 'T23:59:59').toISOString();
      onPeriodChange('custom', fromISO, toISO);
    }
  };

  const isPresetActive = (preset: PresetPeriod) => period === preset;
  const isCustomActive = period === 'custom';

  return (
    <Group className="w-full border-b pb-4" gap="sm" justify="space-between" wrap="wrap">
      {/* Left: Preset Pills */}
      <Group gap={6} className="min-w-0 shrink" wrap="wrap">
        {PERIOD_PRESETS.map((preset) => (
          <Button
            key={preset.value}
            variant={isPresetActive(preset.value) ? 'filled' : 'subtle'}
            size="sm"
            onClick={() => handlePresetClick(preset.value)}
          >
            {preset.label}
          </Button>
        ))}
      </Group>

      {/* Right: Project + Custom Range + Export */}
      <Group
        gap="sm"
        justify="flex-end"
        className="w-full min-w-0 sm:ml-auto sm:w-auto sm:shrink-0"
        wrap="wrap"
      >
        {/* Project Selector */}
        <Select
          aria-label="Dashboard project filter"
          size="sm"
          w={160}
          value={project || 'all'}
          onChange={(value) => onProjectChange(value === 'all' ? undefined : (value ?? undefined))}
          data={[
            { value: 'all', label: 'All Projects' },
            ...projects.map((p) => ({ value: p.id, label: p.label })),
          ]}
        />

        {/* Custom Date Range */}
        <Group gap={6} wrap="wrap">
          <Text size="xs" c="dimmed" className="whitespace-nowrap">
            Custom:
          </Text>
          <TextInput
            aria-label="Custom date from"
            type="date"
            size="sm"
            w={130}
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            max={customTo || undefined}
          />
          <Text size="xs" c="dimmed">
            to
          </Text>
          <TextInput
            aria-label="Custom date to"
            type="date"
            size="sm"
            w={130}
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            min={customFrom || undefined}
          />
          <Button
            size="sm"
            variant={isCustomActive ? 'filled' : 'outline'}
            onClick={handleCustomApply}
            disabled={!customFrom || !customTo}
          >
            Apply
          </Button>
        </Group>

        {/* Export Button */}
        <Button
          variant="outline"
          size="sm"
          leftSection={<Download className="h-4 w-4" />}
          onClick={onExportClick}
        >
          Export
        </Button>
      </Group>
    </Group>
  );
}

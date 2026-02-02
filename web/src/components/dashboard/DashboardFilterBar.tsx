import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Download } from 'lucide-react';
import { cn } from '@/lib/utils';
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
    <div className="flex items-center gap-3 border-b pb-4 w-full">
      {/* Left: Preset Pills */}
      <div className="flex items-center gap-1.5 shrink-0">
        {PERIOD_PRESETS.map((preset) => (
          <Button
            key={preset.value}
            variant={isPresetActive(preset.value) ? 'default' : 'ghost'}
            size="sm"
            className={cn(
              'h-8 px-3 text-xs font-medium transition-all',
              isPresetActive(preset.value) && 'shadow-sm'
            )}
            onClick={() => handlePresetClick(preset.value)}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      {/* Right: Project + Custom Range + Export */}
      <div className="flex items-center gap-3 ml-auto shrink-0">
        {/* Project Selector */}
        <Select
          value={project || 'all'}
          onValueChange={(v) => onProjectChange(v === 'all' ? undefined : v)}
        >
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue placeholder="All Projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Custom Date Range */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Custom:</span>
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className={cn(
              'h-8 px-2 text-xs rounded-md border border-input bg-background',
              'focus:outline-none focus:ring-2 focus:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
            max={customTo || undefined}
          />
          <span className="text-xs text-muted-foreground">→</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className={cn(
              'h-8 px-2 text-xs rounded-md border border-input bg-background',
              'focus:outline-none focus:ring-2 focus:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
            min={customFrom || undefined}
          />
          <Button
            size="sm"
            variant={isCustomActive ? 'default' : 'outline'}
            className="h-8 px-3 text-xs"
            onClick={handleCustomApply}
            disabled={!customFrom || !customTo}
          >
            Apply
          </Button>
        </div>

        {/* Export Button */}
        <Button variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={onExportClick}>
          <Download className="h-3 w-3 mr-1.5" />
          Export
        </Button>
      </div>
    </div>
  );
}

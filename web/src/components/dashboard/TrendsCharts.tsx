import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useTrends, type TrendsPeriod, formatShortDate } from '@/hooks/useTrends';
import { formatDuration } from '@/hooks/useMetrics';
import { Skeleton } from '@/components/ui/skeleton';
interface TrendsChartsProps {
  project?: string;
}

// Chart colors that work with dark/light themes
const COLORS = {
  runs: 'hsl(var(--primary))',
  success: 'hsl(142, 76%, 36%)', // Green
  successRate: 'hsl(142, 76%, 36%)',
  input: 'hsl(217, 91%, 60%)', // Blue
  output: 'hsl(280, 65%, 60%)', // Purple
  duration: 'hsl(38, 92%, 50%)', // Orange/Yellow
  grid: 'hsl(var(--border))',
  text: 'hsl(var(--muted-foreground))',
};

// Custom tooltip component for consistent styling
function CustomTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  formatter?: (value: number, name: string) => string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border bg-popover p-3 shadow-md">
      <p className="font-medium mb-2">{label}</p>
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center gap-2 text-sm">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium">
            {formatter ? formatter(entry.value, entry.name) : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// Runs per day bar chart
function TaskActivityChart({
  data,
}: {
  data: Array<{
    date: string;
    tasksCreated?: number;
    statusChanges?: number;
    tasksArchived?: number;
  }>;
}) {
  const chartData = data.map((d) => ({
    label: formatShortDate(d.date),
    Created: d.tasksCreated || 0,
    'Status Changes': d.statusChanges || 0,
    Archived: d.tasksArchived || 0,
  }));

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: COLORS.text, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fill: COLORS.text, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
          <Area
            type="monotone"
            dataKey="Created"
            stackId="1"
            stroke={COLORS.success}
            fill={COLORS.success}
            fillOpacity={0.6}
          />
          <Area
            type="monotone"
            dataKey="Status Changes"
            stackId="1"
            stroke={COLORS.input}
            fill={COLORS.input}
            fillOpacity={0.6}
          />
          <Area
            type="monotone"
            dataKey="Archived"
            stackId="1"
            stroke={COLORS.duration}
            fill={COLORS.duration}
            fillOpacity={0.6}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// Success rate line chart
function SuccessRateChart({ data }: { data: Array<{ date: string; successRate: number }> }) {
  const chartData = data.map((d) => ({
    ...d,
    label: formatShortDate(d.date),
    successPercent: Math.round(d.successRate * 100),
  }));

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: COLORS.text, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fill: COLORS.text, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={40}
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip content={<CustomTooltip formatter={(v) => `${v}%`} />} />
          <Line
            type="monotone"
            dataKey="successPercent"
            stroke={COLORS.successRate}
            strokeWidth={2}
            dot={{ fill: COLORS.successRate, strokeWidth: 0, r: 3 }}
            activeDot={{ r: 5 }}
            name="Success Rate"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Token usage stacked area chart
function TokensChart({
  data,
}: {
  data: Array<{ date: string; inputTokens: number; outputTokens: number }>;
}) {
  const chartData = data.map((d) => ({
    ...d,
    label: formatShortDate(d.date),
    inputK: Math.round(d.inputTokens / 1000),
    outputK: Math.round(d.outputTokens / 1000),
  }));

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: COLORS.text, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fill: COLORS.text, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={45}
            tickFormatter={(v) => `${v}K`}
          />
          <Tooltip content={<CustomTooltip formatter={(v) => `${v}K tokens`} />} />
          <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
          <Area
            type="monotone"
            dataKey="inputK"
            stackId="1"
            stroke={COLORS.input}
            fill={COLORS.input}
            fillOpacity={0.6}
            name="Input"
          />
          <Area
            type="monotone"
            dataKey="outputK"
            stackId="1"
            stroke={COLORS.output}
            fill={COLORS.output}
            fillOpacity={0.6}
            name="Output"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// Average duration trend line chart
function DurationChart({ data }: { data: Array<{ date: string; avgDurationMs: number }> }) {
  const chartData = data.map((d) => ({
    ...d,
    label: formatShortDate(d.date),
    durationSec: Math.round(d.avgDurationMs / 1000),
  }));

  // Calculate max for Y axis domain
  const maxDuration = Math.max(...chartData.map((d) => d.durationSec), 1);

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: COLORS.text, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fill: COLORS.text, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={40}
            domain={[0, Math.ceil(maxDuration * 1.1)]}
            tickFormatter={(v) => `${v}s`}
          />
          <Tooltip content={<CustomTooltip formatter={(v) => formatDuration(v * 1000)} />} />
          <Line
            type="monotone"
            dataKey="durationSec"
            stroke={COLORS.duration}
            strokeWidth={2}
            dot={{ fill: COLORS.duration, strokeWidth: 0, r: 3 }}
            activeDot={{ r: 5 }}
            name="Avg Duration"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Chart card wrapper
function ChartCard({
  title,
  children,
  extra,
}: {
  title: string;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-muted-foreground">{title}</h4>
        {extra}
      </div>
      {children}
    </div>
  );
}

export function TrendsCharts({ project }: TrendsChartsProps) {
  const period: TrendsPeriod = '7d';
  const { data, isLoading, error } = useTrends(period, project);

  if (error) {
    return <div className="p-4 text-center text-destructive">Failed to load trends data</div>;
  }

  // Check if we have any data with runs
  const hasData = data?.daily.some((d) => d.runs > 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <h3 className="text-sm font-medium text-muted-foreground">Historical Trends</h3>

      {/* Charts grid - 2x2 on larger screens, stacked on mobile */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-[250px] rounded-lg" />
          ))}
        </div>
      ) : !hasData ? (
        <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
          <p>No telemetry data available for the selected period.</p>
          <p className="text-sm mt-2">Run some tasks to see historical trends.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartCard title="Task Activity per Day">
            <TaskActivityChart data={data!.daily} />
          </ChartCard>

          <ChartCard title="Success Rate">
            <SuccessRateChart data={data!.daily} />
          </ChartCard>

          <ChartCard title="Token Usage">
            <TokensChart data={data!.daily} />
          </ChartCard>

          <ChartCard title="Average Run Duration">
            <DurationChart data={data!.daily} />
          </ChartCard>
        </div>
      )}
    </div>
  );
}

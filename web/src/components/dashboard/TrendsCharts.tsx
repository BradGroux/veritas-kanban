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
import { Group, Paper, SimpleGrid, Skeleton, Stack, Text } from '@mantine/core';
import { useTrends, type TrendsPeriod, formatShortDate } from '@/hooks/useTrends';
import { formatDuration } from '@/hooks/useMetrics';
interface TrendsChartsProps {
  project?: string;
}

// Chart colors that work with dark/light themes
const COLORS = {
  runs: 'hsl(var(--primary))',
  success: 'hsl(142, 76%, 36%)', // Green
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
    <Paper withBorder p="sm" radius="md" shadow="md">
      <Text fw={500} mb="xs">
        {label}
      </Text>
      {payload.map((entry, index) => (
        <Group key={index} gap="xs" className="text-sm">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }} />
          <Text component="span" size="sm" c="dimmed">
            {entry.name}:
          </Text>
          <Text component="span" size="sm" fw={500}>
            {formatter ? formatter(entry.value, entry.name) : entry.value}
          </Text>
        </Group>
      ))}
    </Paper>
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
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="sm">
        <Text size="sm" fw={500} c="dimmed">
          {title}
        </Text>
        {extra}
      </Group>
      {children}
    </Paper>
  );
}

export function TrendsCharts({ project }: TrendsChartsProps) {
  const period: TrendsPeriod = '7d';
  const { data, isLoading, error } = useTrends(period, project);

  if (error) {
    return (
      <Text p="md" ta="center" c="red">
        Failed to load trends data
      </Text>
    );
  }

  // Check if we have any data with runs
  const daily = data?.daily ?? [];
  const hasData = daily.some((d) => d.runs > 0);

  return (
    <Stack gap="md">
      {/* Header */}
      <Text size="sm" fw={500} c="dimmed">
        Historical Trends
      </Text>

      {/* Charts grid - 2x2 on larger screens, stacked on mobile */}
      {isLoading ? (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} h={250} radius="md" />
          ))}
        </SimpleGrid>
      ) : !hasData ? (
        <Paper withBorder p="xl" radius="md" ta="center">
          <Text c="dimmed">No telemetry data available for the selected period.</Text>
          <Text size="sm" c="dimmed" mt="xs">
            Run some tasks to see historical trends.
          </Text>
        </Paper>
      ) : (
        <Stack gap="md">
          {/* Task Activity full width */}
          <ChartCard title="Task Activity per Day">
            <TaskActivityChart data={daily} />
          </ChartCard>

          {/* Other charts in 2-col grid */}
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <ChartCard title="Token Usage">
              <TokensChart data={daily} />
            </ChartCard>

            <ChartCard title="Average Run Duration">
              <DurationChart data={daily} />
            </ChartCard>
          </SimpleGrid>
        </Stack>
      )}
    </Stack>
  );
}

import { useState } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useTrends, type TrendsPeriod, formatShortDate } from '@/hooks/useTrends';
import { useVelocity, getTrendColor, getTrendLabel, type VelocityTrend } from '@/hooks/useVelocity';
import { formatDuration } from '@/hooks/useMetrics';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
  velocity: 'hsl(var(--primary))',
  rollingAvg: 'hsl(280, 65%, 60%)', // Purple for the rolling average line
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
          <div 
            className="w-3 h-3 rounded-full" 
            style={{ backgroundColor: entry.color }}
          />
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
function RunsChart({ data }: { data: Array<{ date: string; runs: number }> }) {
  const chartData = data.map(d => ({
    ...d,
    label: formatShortDate(d.date),
  }));

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
          <Tooltip 
            content={<CustomTooltip />}
          />
          <Bar 
            dataKey="runs" 
            fill={COLORS.runs}
            radius={[4, 4, 0, 0]}
            name="Runs"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Success rate line chart
function SuccessRateChart({ data }: { data: Array<{ date: string; successRate: number }> }) {
  const chartData = data.map(d => ({
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
          <Tooltip 
            content={<CustomTooltip formatter={(v) => `${v}%`} />}
          />
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
function TokensChart({ data }: { data: Array<{ date: string; inputTokens: number; outputTokens: number }> }) {
  const chartData = data.map(d => ({
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
          <Tooltip 
            content={<CustomTooltip formatter={(v) => `${v}K tokens`} />}
          />
          <Legend 
            wrapperStyle={{ fontSize: 11 }}
            iconType="circle"
          />
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
  const chartData = data.map(d => ({
    ...d,
    label: formatShortDate(d.date),
    durationSec: Math.round(d.avgDurationMs / 1000),
  }));

  // Calculate max for Y axis domain
  const maxDuration = Math.max(...chartData.map(d => d.durationSec), 1);

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
          <Tooltip 
            content={<CustomTooltip formatter={(v) => formatDuration(v * 1000)} />}
          />
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

// Custom tick for sprint names with background badge
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SprintAxisTick(props: any) {
  const { x, y, payload } = props;
  if (!payload?.value) return null;
  
  const label = payload.value.length > 10 
    ? payload.value.slice(0, 10) + '…' 
    : payload.value;
  
  return (
    <g transform={`translate(${x},${y})`}>
      <rect
        x={-30}
        y={4}
        width={60}
        height={18}
        rx={4}
        ry={4}
        fill="hsl(var(--muted))"
      />
      <text
        x={0}
        y={16}
        textAnchor="middle"
        fill="hsl(var(--muted-foreground))"
        fontSize={10}
        fontWeight={500}
      >
        {label}
      </text>
    </g>
  );
}

// Sprint velocity chart with bar chart and rolling average line
interface VelocityChartProps {
  data: Array<{
    sprint: string;
    completed: number;
    total: number;
    rollingAverage: number;
    byType: Record<string, number>;
  }>;
  trend: VelocityTrend;
  averageVelocity: number;
}

function VelocityChart({ data, trend: _trend, averageVelocity: _averageVelocity }: VelocityChartProps) {
  // Custom tooltip for velocity chart with type breakdown
  const VelocityTooltip = ({ active, payload, label }: {
    active?: boolean;
    payload?: Array<{ name: string; value: number; color: string; payload?: { byType?: Record<string, number> } }>;
    label?: string;
  }) => {
    if (!active || !payload?.length) return null;

    const dataPoint = payload[0]?.payload;
    const byType = dataPoint?.byType || {};

    return (
      <div className="rounded-lg border bg-popover p-3 shadow-md min-w-[150px]">
        <p className="font-medium mb-2">{label}</p>
        {payload.map((entry, index) => (
          <div key={index} className="flex items-center gap-2 text-sm">
            <div 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-muted-foreground">{entry.name}:</span>
            <span className="font-medium">{entry.value}</span>
          </div>
        ))}
        {Object.keys(byType).length > 0 && (
          <>
            <div className="border-t my-2 pt-2">
              <p className="text-xs text-muted-foreground mb-1">By Type:</p>
              {Object.entries(byType).map(([type, count]) => (
                <div key={type} className="flex justify-between text-xs">
                  <span className="text-muted-foreground capitalize">{type}:</span>
                  <span>{count}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />
          <XAxis 
            dataKey="sprint" 
            tick={SprintAxisTick}
            tickLine={false}
            axisLine={false}
            interval={0}
            height={35}
          />
          <YAxis 
            tick={{ fill: COLORS.text, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={35}
          />
          <Tooltip content={<VelocityTooltip />} />
          <Legend 
            wrapperStyle={{ fontSize: 11 }}
            iconType="circle"
          />
          <Bar 
            dataKey="completed" 
            fill={COLORS.velocity}
            radius={[4, 4, 0, 0]}
            name="Completed"
          />
          <Line 
            type="monotone"
            dataKey="rollingAverage" 
            stroke={COLORS.rollingAvg}
            strokeWidth={2}
            dot={{ fill: COLORS.rollingAvg, strokeWidth: 0, r: 3 }}
            name="Rolling Avg"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// Velocity trend indicator
function VelocityTrendIndicator({ trend, averageVelocity }: { trend: VelocityTrend; averageVelocity: number }) {
  const TrendIcon = trend === 'accelerating' ? TrendingUp : trend === 'slowing' ? TrendingDown : Minus;
  const colorClass = getTrendColor(trend);
  
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className={`flex items-center gap-1 ${colorClass}`}>
        <TrendIcon className="h-4 w-4" />
        <span className="font-medium">{getTrendLabel(trend)}</span>
      </div>
      <span className="text-muted-foreground">
        Avg: {averageVelocity} tasks/sprint
      </span>
    </div>
  );
}

// Chart card wrapper
function ChartCard({ title, children, extra }: { title: string; children: React.ReactNode; extra?: React.ReactNode }) {
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
  const [period, setPeriod] = useState<TrendsPeriod>('7d');
  const { data, isLoading, error } = useTrends(period, project);
  const { data: velocityData, isLoading: velocityLoading } = useVelocity(project, 10);

  if (error) {
    return (
      <div className="p-4 text-center text-destructive">
        Failed to load trends data
      </div>
    );
  }

  // Check if we have any data with runs
  const hasData = data?.daily.some(d => d.runs > 0);
  const hasVelocityData = velocityData && velocityData.sprints.length > 0;

  return (
    <div className="space-y-4">
      {/* Header with period toggle */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Historical Trends</h3>
        <Select value={period} onValueChange={(v) => setPeriod(v as TrendsPeriod)}>
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Sprint Velocity Chart - Full width */}
      {velocityLoading ? (
        <Skeleton className="h-[280px] rounded-lg" />
      ) : hasVelocityData ? (
        <ChartCard 
          title="Sprint Velocity"
          extra={
            <VelocityTrendIndicator 
              trend={velocityData!.trend} 
              averageVelocity={velocityData!.averageVelocity} 
            />
          }
        >
          <VelocityChart 
            data={velocityData!.sprints}
            trend={velocityData!.trend}
            averageVelocity={velocityData!.averageVelocity}
          />
          {velocityData!.currentSprint && (
            <div className="mt-3 pt-3 border-t text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  Current Sprint ({velocityData!.currentSprint.sprint}):
                </span>
                <span className="font-medium">
                  {velocityData!.currentSprint.completed}/{velocityData!.currentSprint.total} tasks
                  <span className="text-muted-foreground ml-2">
                    ({velocityData!.currentSprint.percentComplete}%)
                  </span>
                  {velocityData!.currentSprint.vsAverage !== 0 && (
                    <span className={velocityData!.currentSprint.vsAverage > 0 ? 'text-green-500 ml-2' : 'text-red-500 ml-2'}>
                      {velocityData!.currentSprint.vsAverage > 0 ? '+' : ''}{velocityData!.currentSprint.vsAverage}% vs avg
                    </span>
                  )}
                </span>
              </div>
            </div>
          )}
        </ChartCard>
      ) : (
        <div className="rounded-lg border bg-card p-6 text-center text-muted-foreground">
          <p>No sprint data available yet.</p>
          <p className="text-sm mt-1">Assign tasks to sprints to see velocity metrics.</p>
        </div>
      )}

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
          <ChartCard title="Runs per Day">
            <RunsChart data={data!.daily} />
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

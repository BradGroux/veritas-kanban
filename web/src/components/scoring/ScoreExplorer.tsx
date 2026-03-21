import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { EvaluationResult, ScoringProfile } from '@veritas-kanban/shared';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useScoringHistory } from '@/hooks/useScoring';

interface ScoreExplorerProps {
  profiles: ScoringProfile[];
}

const CHART_COLORS = ['#0f766e', '#2563eb', '#ea580c', '#7c3aed', '#dc2626', '#059669'];

const formatTimestamp = (timestamp: string) =>
  new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export function ScoreExplorer({ profiles }: ScoreExplorerProps) {
  const [profileId, setProfileId] = useState<string>('all');
  const [agent, setAgent] = useState('');
  const [taskId, setTaskId] = useState('');
  const { data: history = [], isLoading } = useScoringHistory({
    profileId: profileId === 'all' ? undefined : profileId,
    agent: agent || undefined,
    taskId: taskId || undefined,
    limit: 200,
  });

  const availableAgents = useMemo(() => {
    return [
      ...new Set(
        history
          .map((result) => result.agent)
          .filter((agentName): agentName is string => typeof agentName === 'string')
      ),
    ].sort();
  }, [history]);

  const chartSeries = useMemo(() => {
    const ordered = [...history].sort((a, b) => a.created.localeCompare(b.created));
    return ordered.map((result) => ({
      label: formatTimestamp(result.created),
      created: result.created,
      composite: Number((result.compositeScore * 100).toFixed(1)),
      agent: result.agent || 'unknown',
      profileName: result.profileName,
      taskId: result.taskId || '',
      result,
    }));
  }, [history]);

  const agentLines = useMemo(() => {
    const ordered = [...history].sort((a, b) => a.created.localeCompare(b.created));
    return ordered.map((result) => {
      const key = result.agent || 'unknown';
      return {
        label: formatTimestamp(result.created),
        [key]: Number((result.compositeScore * 100).toFixed(1)),
      };
    });
  }, [history]);

  const averageScore = useMemo(() => {
    if (history.length === 0) return 0;
    const total = history.reduce((sum, result) => sum + result.compositeScore, 0);
    return Math.round((total / history.length) * 100);
  }, [history]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-[220px_220px_1fr]">
        <Select value={profileId} onValueChange={setProfileId}>
          <SelectTrigger>
            <SelectValue placeholder="Filter by profile" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All profiles</SelectItem>
            {profiles.map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                {profile.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={agent || 'all'}
          onValueChange={(value) => setAgent(value === 'all' ? '' : value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Filter by agent" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All agents</SelectItem>
            {availableAgents.map((agentName) => (
              <SelectItem key={agentName} value={agentName}>
                {agentName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          placeholder="Filter by task ID"
          value={taskId}
          onChange={(event) => setTaskId(event.target.value)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm text-muted-foreground">Evaluations</div>
          <div className="mt-2 text-3xl font-semibold">{history.length}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm text-muted-foreground">Average Composite</div>
          <div className="mt-2 text-3xl font-semibold">{averageScore}%</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm text-muted-foreground">Agents Observed</div>
          <div className="mt-2 text-3xl font-semibold">{availableAgents.length}</div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3">
            <h3 className="font-semibold">Composite Score Trend</h3>
            <p className="text-sm text-muted-foreground">
              Scores over time for the selected profile and filters
            </p>
          </div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartSeries}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" minTickGap={28} />
                <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} width={42} />
                <Tooltip
                  formatter={(value) =>
                    typeof value === 'number' ? `${value}%` : String(value ?? '')
                  }
                />
                <Line
                  type="monotone"
                  dataKey="composite"
                  stroke="#0f766e"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                  name="Composite"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3">
            <h3 className="font-semibold">Agent Comparison</h3>
            <p className="text-sm text-muted-foreground">
              Separate lines appear when multiple agents are present
            </p>
          </div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={agentLines}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" minTickGap={28} />
                <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} width={42} />
                <Tooltip
                  formatter={(value) =>
                    typeof value === 'number' ? `${value}%` : String(value ?? '')
                  }
                />
                <Legend />
                {availableAgents.map((agentName, index) => (
                  <Line
                    key={agentName}
                    type="monotone"
                    dataKey={agentName}
                    stroke={CHART_COLORS[index % CHART_COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h3 className="font-semibold">Recent Evaluations</h3>
        </div>
        <ScrollArea className="h-[360px]">
          <div className="divide-y">
            {isLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading evaluation history…</div>
            ) : history.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                No evaluations match the current filters.
              </div>
            ) : (
              history.map((result: EvaluationResult) => (
                <div key={result.id} className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium">{result.profileName}</div>
                    <Badge variant="secondary">{Math.round(result.compositeScore * 100)}%</Badge>
                    {result.agent && <Badge variant="outline">{result.agent}</Badge>}
                    {result.taskId && (
                      <Badge variant="outline" className="font-mono">
                        {result.taskId}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {formatTimestamp(result.created)}
                    </span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {result.scores.map((score) => (
                      <div key={score.scorerId} className="rounded-md border bg-muted/20 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium">{score.scorerName}</span>
                          <span className="text-sm text-muted-foreground">
                            {Math.round(score.score * 100)}%
                          </span>
                        </div>
                        <div className="mt-2 h-2 rounded-full bg-muted">
                          <div
                            className="h-2 rounded-full bg-primary"
                            style={{ width: `${Math.round(score.score * 100)}%` }}
                          />
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {score.explanation}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

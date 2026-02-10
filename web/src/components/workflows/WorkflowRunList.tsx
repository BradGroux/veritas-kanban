/**
 * WorkflowRunList - List workflow runs with filtering
 *
 * Features:
 * - List active, completed, and failed runs
 * - Filter by status
 * - Click to open detailed run view
 * - Shows: workflow name, status, started at, duration, current step
 */

import { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Clock, CheckCircle2, XCircle, AlertCircle, PlayCircle } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { WorkflowRunView } from './WorkflowRunView';

interface WorkflowRunListProps {
  workflowId: string;
  onBack: () => void;
}

type WorkflowRunStatus = 'pending' | 'running' | 'blocked' | 'completed' | 'failed';

interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: WorkflowRunStatus;
  currentStep?: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
  steps: Array<{
    stepId: string;
    status: string;
  }>;
}

export function WorkflowRunList({ workflowId, onBack }: WorkflowRunListProps) {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const { toast } = useToast();

  // Fetch runs
  useEffect(() => {
    const fetchRuns = async () => {
      try {
        const response = await fetch(`/api/workflow-runs?workflowId=${workflowId}`);
        if (!response.ok) throw new Error('Failed to fetch workflow runs');
        const json = await response.json();
        setRuns(json.data ?? json);
      } catch (error) {
        toast({
          title: '❌ Failed to load workflow runs',
          description: error instanceof Error ? error.message : 'Unknown error',
        });
      } finally {
        setIsLoading(false);
      }
    };
    fetchRuns();
  }, [workflowId, toast]);

  // Filter runs
  const filteredRuns = useMemo(() => {
    return runs.filter((run) => statusFilter === 'all' || run.status === statusFilter);
  }, [runs, statusFilter]);

  if (selectedRunId) {
    return <WorkflowRunView runId={selectedRunId} onBack={() => setSelectedRunId(null)} />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Workflows
          </Button>
          <h1 className="text-2xl font-bold">Workflow Runs</h1>
          <Badge variant="secondary">{filteredRuns.length} runs</Badge>
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="blocked">Blocked</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Run List */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : filteredRuns.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {statusFilter !== 'all' ? 'No runs match your filter' : 'No runs yet'}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRuns.map((run) => (
            <RunCard key={run.id} run={run} onClick={() => setSelectedRunId(run.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

interface RunCardProps {
  run: WorkflowRun;
  onClick: () => void;
}

function RunCard({ run, onClick }: RunCardProps) {
  const duration = run.completedAt
    ? Math.floor((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
    : Math.floor((Date.now() - new Date(run.startedAt).getTime()) / 1000);

  const completedSteps = run.steps.filter((s) => s.status === 'completed').length;
  const totalSteps = run.steps.length;

  const statusConfig = {
    pending: {
      icon: Clock,
      color: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
      label: 'Pending',
    },
    running: {
      icon: PlayCircle,
      color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      label: 'Running',
    },
    completed: {
      icon: CheckCircle2,
      color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      label: 'Completed',
    },
    failed: {
      icon: XCircle,
      color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      label: 'Failed',
    },
    blocked: {
      icon: AlertCircle,
      color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      label: 'Blocked',
    },
  };

  const config = statusConfig[run.status];
  const Icon = config.icon;

  return (
    <div
      className="p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <Badge variant="outline" className="text-xs font-mono">
              {run.id}
            </Badge>
            <Badge className={cn('text-xs', config.color)}>
              <Icon className="h-3 w-3 mr-1" />
              {config.label}
            </Badge>
          </div>

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div>Started: {new Date(run.startedAt).toLocaleString()}</div>
            <div>
              Duration: {Math.floor(duration / 60)}m {duration % 60}s
            </div>
            {run.currentStep && <div>Current: {run.currentStep}</div>}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <div className="text-sm text-muted-foreground">
              Progress: {completedSteps}/{totalSteps} steps
            </div>
            <div className="flex-1 max-w-xs h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full transition-all',
                  run.status === 'completed'
                    ? 'bg-green-500'
                    : run.status === 'failed'
                      ? 'bg-red-500'
                      : run.status === 'blocked'
                        ? 'bg-yellow-500'
                        : 'bg-blue-500'
                )}
                style={{ width: `${(completedSteps / totalSteps) * 100}%` }}
              />
            </div>
          </div>

          {run.error && <div className="mt-2 text-sm text-destructive">Error: {run.error}</div>}
        </div>
      </div>
    </div>
  );
}

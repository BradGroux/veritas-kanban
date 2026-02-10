/**
 * WorkflowRunView - Live step-by-step workflow run visualization
 *
 * Features:
 * - Live step-by-step progress
 * - Color-coded step status (green=completed, blue=running, red=failed, yellow=blocked, gray=pending)
 * - Resume button for blocked runs
 * - Auto-updates via WebSocket workflow:status events
 * - Shows overall run progress
 */

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertCircle,
  PlayCircle,
  Clock,
  Pause,
} from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useWebSocket, type WebSocketMessage } from '@/hooks/useWebSocket';

interface WorkflowRunViewProps {
  runId: string;
  onBack: () => void;
}

type WorkflowRunStatus = 'pending' | 'running' | 'blocked' | 'completed' | 'failed';
type StepRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

interface StepRun {
  stepId: string;
  status: StepRunStatus;
  agent?: string;
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  retries: number;
  output?: string;
  error?: string;
}

interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: WorkflowRunStatus;
  currentStep?: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
  steps: StepRun[];
}

interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  steps: Array<{
    id: string;
    name: string;
    agent?: string;
  }>;
}

interface WorkflowStatusMessage extends WebSocketMessage {
  type: 'workflow:status';
  data: WorkflowRun;
}

function isWorkflowStatusMessage(msg: WebSocketMessage): msg is WorkflowStatusMessage {
  return msg.type === 'workflow:status' && typeof msg.data === 'object' && msg.data !== null;
}

export function WorkflowRunView({ runId, onBack }: WorkflowRunViewProps) {
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorkflowLoading, setIsWorkflowLoading] = useState(true);
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  const { toast } = useToast();

  // Fetch run details
  const fetchRun = useCallback(async () => {
    try {
      const response = await fetch(`/api/workflow-runs/${runId}`);
      if (!response.ok) throw new Error('Failed to fetch workflow run');
      const json = await response.json();
      setRun(json.data ?? json);
    } catch (error) {
      toast({
        title: '❌ Failed to load workflow run',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsLoading(false);
    }
  }, [runId, toast]);

  // Initial fetch
  useEffect(() => {
    fetchRun();
  }, [fetchRun]);

  // Fetch workflow definition when run loads
  useEffect(() => {
    if (!run) return;

    setWorkflow(null);
    setIsWorkflowLoading(true);

    let isCancelled = false;
    const fetchWorkflow = async () => {
      try {
        const workflowResponse = await fetch(`/api/workflows/${run.workflowId}`);
        if (!workflowResponse.ok) throw new Error('Failed to fetch workflow definition');
        const json = await workflowResponse.json();
        if (!isCancelled) {
          setWorkflow(json.data ?? json);
        }
      } catch (error) {
        console.error('Failed to fetch workflow definition:', error);
        if (!isCancelled) {
          setWorkflow(null);
        }
      } finally {
        if (!isCancelled) {
          setIsWorkflowLoading(false);
        }
      }
    };

    fetchWorkflow();

    return () => {
      isCancelled = true;
    };
  }, [run?.workflowId]);

  // WebSocket subscription for live updates
  const handleWebSocketMessage = useCallback(
    (message: WebSocketMessage) => {
      if (isWorkflowStatusMessage(message) && message.data.id === runId) {
        console.log('[WorkflowRunView] Received workflow:status update', message.data);
        setRun(message.data);
      }
    },
    [runId]
  );

  useWebSocket({
    autoConnect: true,
    onMessage: handleWebSocketMessage,
  });

  const handleResume = async () => {
    try {
      const response = await fetch(`/api/workflow-runs/${runId}/resume`, {
        method: 'POST',
      });

      if (!response.ok) throw new Error('Failed to resume workflow run');

      toast({
        title: 'Workflow resumed',
        description: 'The workflow run has been resumed',
      });

      fetchRun();
    } catch (error) {
      toast({
        title: '❌ Failed to resume workflow run',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  if (isLoading || (run && isWorkflowLoading)) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!run) {
    return <div className="text-center py-12 text-muted-foreground">Workflow run not found</div>;
  }

  const workflowName = workflow?.name ?? `Workflow ${run.workflowId}`;
  const stepDefinitions =
    workflow?.steps ??
    run.steps.map((step) => ({ id: step.stepId, name: step.stepId, agent: step.agent }));

  const completedSteps = run.steps.filter((s) => s.status === 'completed').length;
  const totalSteps = run.steps.length;

  const duration = run.completedAt
    ? Math.floor((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
    : Math.floor((Date.now() - new Date(run.startedAt).getTime()) / 1000);

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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Runs
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{workflowName}</h1>
            <p className="text-sm text-muted-foreground">Run: {run.id}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Badge className={cn('text-sm', config.color)}>
            <Icon className="h-4 w-4 mr-1" />
            {config.label}
          </Badge>
          {run.status === 'blocked' && (
            <Button size="sm" onClick={handleResume}>
              <PlayCircle className="h-4 w-4 mr-1" />
              Resume
            </Button>
          )}
        </div>
      </div>

      {/* Progress Overview */}
      <div className="p-6 rounded-lg border bg-card space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Overall Progress</h2>
            <p className="text-sm text-muted-foreground">
              Step {completedSteps} of {totalSteps}
            </p>
          </div>
          <div className="text-right space-y-1">
            <div className="text-sm text-muted-foreground">
              Duration: {Math.floor(duration / 60)}m {duration % 60}s
            </div>
            <div className="text-sm text-muted-foreground">
              Started: {new Date(run.startedAt).toLocaleString()}
            </div>
          </div>
        </div>

        <div className="h-3 bg-secondary rounded-full overflow-hidden">
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

        {run.error && (
          <div className="p-3 rounded bg-destructive/10 text-destructive text-sm">
            <strong>Error:</strong> {run.error}
          </div>
        )}
      </div>

      {/* Step Timeline */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Steps</h2>
        {stepDefinitions.map((stepDef, index) => {
          const stepRun = run.steps.find((s) => s.stepId === stepDef.id);
          if (!stepRun) return null;

          return (
            <StepCard
              key={stepDef.id}
              stepDef={stepDef}
              stepRun={stepRun}
              index={index}
              isExpanded={expandedStepId === stepDef.id}
              onToggleExpand={() =>
                setExpandedStepId(expandedStepId === stepDef.id ? null : stepDef.id)
              }
            />
          );
        })}
      </div>
    </div>
  );
}

interface StepCardProps {
  stepDef: { id: string; name: string; agent?: string };
  stepRun: StepRun;
  index: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

function StepCard({ stepDef, stepRun, index, isExpanded, onToggleExpand }: StepCardProps) {
  const statusConfig = {
    pending: {
      icon: Clock,
      color: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
      borderColor: 'border-gray-300',
    },
    running: {
      icon: PlayCircle,
      color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      borderColor: 'border-blue-500',
    },
    completed: {
      icon: CheckCircle2,
      color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      borderColor: 'border-green-500',
    },
    failed: {
      icon: XCircle,
      color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      borderColor: 'border-red-500',
    },
    skipped: {
      icon: Pause,
      color: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
      borderColor: 'border-gray-300',
    },
  };

  const config = statusConfig[stepRun.status];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'p-4 rounded-lg border-2 bg-card transition-colors cursor-pointer',
        config.borderColor,
        isExpanded && 'ring-2 ring-accent'
      )}
      onClick={onToggleExpand}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggleExpand();
        }
      }}
    >
      <div className="flex items-start gap-4">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-secondary text-sm font-medium">
          {index + 1}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="font-medium">{stepDef.name}</h3>
            <Badge className={cn('text-xs', config.color)}>
              <Icon className="h-3 w-3 mr-1" />
              {stepRun.status}
            </Badge>
            {stepRun.agent && (
              <Badge variant="outline" className="text-xs">
                {stepRun.agent}
              </Badge>
            )}
            {stepRun.retries > 0 && (
              <Badge variant="secondary" className="text-xs">
                Retry {stepRun.retries}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {stepRun.startedAt && (
              <div>Started: {new Date(stepRun.startedAt).toLocaleTimeString()}</div>
            )}
            {stepRun.duration !== undefined && <div>Duration: {stepRun.duration}s</div>}
          </div>

          {stepRun.error && (
            <div className="mt-2 p-2 rounded bg-destructive/10 text-destructive text-sm">
              <strong>Error:</strong> {stepRun.error}
            </div>
          )}

          {isExpanded && stepRun.output && (
            <div className="mt-3 p-3 rounded bg-secondary text-sm font-mono whitespace-pre-wrap">
              <strong>Output:</strong>
              <br />
              {stepRun.output}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

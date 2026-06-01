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
import { API_BASE } from '@/lib/config';
import {
  Badge,
  Button,
  Group,
  Paper,
  Progress,
  Select,
  Skeleton,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { ArrowLeft, Clock, CheckCircle2, XCircle, AlertCircle, PlayCircle } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
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
        const response = await fetch(`${API_BASE}/workflows/runs?workflowId=${workflowId}`);
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
    <Stack gap="lg">
      {/* Header */}
      <Group justify="space-between" align="center">
        <Group gap="md" align="center">
          <Button
            variant="subtle"
            size="sm"
            leftSection={<ArrowLeft className="h-4 w-4" />}
            onClick={onBack}
          >
            Back to Workflows
          </Button>
          <Title order={1} className="text-2xl">
            Workflow Runs
          </Title>
          <Badge variant="light">{filteredRuns.length} runs</Badge>
        </Group>

        <Select
          aria-label="Workflow run status filter"
          className="w-[180px]"
          value={statusFilter}
          onChange={(value) => setStatusFilter(value ?? 'all')}
          data={[
            { value: 'all', label: 'All Statuses' },
            { value: 'running', label: 'Running' },
            { value: 'completed', label: 'Completed' },
            { value: 'failed', label: 'Failed' },
            { value: 'blocked', label: 'Blocked' },
            { value: 'pending', label: 'Pending' },
          ]}
        />
      </Group>

      {/* Run List */}
      {isLoading ? (
        <Stack gap="sm">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} h={96} />
          ))}
        </Stack>
      ) : filteredRuns.length === 0 ? (
        <Text ta="center" c="dimmed" py="xl">
          {statusFilter !== 'all' ? 'No runs match your filter' : 'No runs yet'}
        </Text>
      ) : (
        <Stack gap="sm">
          {filteredRuns.map((run) => (
            <RunCard key={run.id} run={run} onClick={() => setSelectedRunId(run.id)} />
          ))}
        </Stack>
      )}
    </Stack>
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

  const completedSteps = run.steps?.filter((s) => s.status === 'completed').length;
  const totalSteps = run.steps?.length ?? 0;
  const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  const statusConfig = {
    pending: {
      icon: Clock,
      color: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
      progressColor: 'gray',
      label: 'Pending',
    },
    running: {
      icon: PlayCircle,
      color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      progressColor: 'blue',
      label: 'Running',
    },
    completed: {
      icon: CheckCircle2,
      color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      progressColor: 'green',
      label: 'Completed',
    },
    failed: {
      icon: XCircle,
      color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      progressColor: 'red',
      label: 'Failed',
    },
    blocked: {
      icon: AlertCircle,
      color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      progressColor: 'yellow',
      label: 'Blocked',
    },
  };

  const config = statusConfig[run.status];
  const Icon = config.icon;

  return (
    <Paper
      className="p-4 transition-colors cursor-pointer hover:bg-accent/50"
      radius="md"
      withBorder
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
      <Group align="flex-start" justify="space-between" gap="md">
        <div className="flex-1 min-w-0">
          <Group gap="sm" mb="xs">
            <Badge variant="outline" className="text-xs font-mono">
              {run.id}
            </Badge>
            <Badge className={cn('text-xs', config.color)}>
              <Icon className="h-3 w-3 mr-1" />
              {config.label}
            </Badge>
          </Group>

          <Group gap="md" className="text-sm text-muted-foreground">
            <Text span inherit>
              Started: {new Date(run.startedAt).toLocaleString()}
            </Text>
            <Text span inherit>
              Duration: {Math.floor(duration / 60)}m {duration % 60}s
            </Text>
            {run.currentStep && (
              <Text span inherit>
                Current: {run.currentStep}
              </Text>
            )}
          </Group>

          <Group gap="xs" mt="xs">
            <Text size="sm" c="dimmed">
              Progress: {completedSteps}/{totalSteps} steps
            </Text>
            <Progress className="flex-1 max-w-xs" value={progress} color={config.progressColor} />
          </Group>

          {run.error && (
            <Text mt="xs" size="sm" c="red">
              Error: {run.error}
            </Text>
          )}
        </div>
      </Group>
    </Paper>
  );
}

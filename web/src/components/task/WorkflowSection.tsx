/**
 * WorkflowSection - Run workflows against a task
 *
 * Features:
 * - Shows available workflows
 * - Start workflow run with task context
 * - Shows active runs for this task
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Play, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import type { Task } from '@veritas-kanban/shared';

interface WorkflowSectionProps {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Workflow {
  id: string;
  name: string;
  version: number;
  description: string;
  agents: Array<{ id: string; name: string }>;
  steps: Array<{ id: string; name: string }>;
}

interface WorkflowRun {
  id: string;
  workflowId: string;
  status: 'pending' | 'running' | 'blocked' | 'completed' | 'failed';
  currentStep?: string;
  startedAt: string;
}

export function WorkflowSection({ task, open, onOpenChange }: WorkflowSectionProps) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [activeRuns, setActiveRuns] = useState<WorkflowRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;

    const fetchData = async () => {
      try {
        // Fetch available workflows
        const workflowsRes = await fetch('/api/workflows');
        if (workflowsRes.ok) {
          const wJson = await workflowsRes.json();
          setWorkflows(wJson.data ?? wJson);
        }

        // Fetch active runs for this task
        const runsRes = await fetch(`/api/workflow-runs?taskId=${task.id}`);
        if (runsRes.ok) {
          const rJson = await runsRes.json();
          const runs = rJson.data ?? rJson;
          setActiveRuns(
            runs.filter((r: WorkflowRun) => r.status === 'running' || r.status === 'blocked')
          );
        }
      } catch (error) {
        console.error('Failed to fetch workflows:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [open, task.id]);

  const handleStartWorkflow = async (workflowId: string) => {
    setIsStarting(workflowId);
    try {
      const response = await fetch(`/api/workflows/${workflowId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id }),
      });

      if (!response.ok) throw new Error('Failed to start workflow run');

      const runJson = await response.json();
      const run = runJson.data ?? runJson;
      toast({
        title: 'Workflow run started',
        description: `Run ID: ${run.id}`,
      });

      // Add to active runs
      setActiveRuns((previousRuns) => [...previousRuns, run]);
    } catch (error) {
      toast({
        title: '❌ Failed to start workflow run',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsStarting(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Run Workflow</DialogTitle>
          <DialogDescription>Select a workflow to run against this task</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Active Runs */}
            {activeRuns.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium">Active Runs</h3>
                {activeRuns.map((run) => (
                  <div
                    key={run.id}
                    className="p-3 rounded-lg border bg-card flex items-center justify-between"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs font-mono">
                          {run.id}
                        </Badge>
                        <Badge
                          variant="secondary"
                          className={run.status === 'running' ? 'bg-blue-100 text-blue-800' : ''}
                        >
                          {run.status}
                        </Badge>
                      </div>
                      {run.currentStep && (
                        <p className="text-sm text-muted-foreground mt-1">
                          Current: {run.currentStep}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Available Workflows */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Available Workflows</h3>
              {workflows.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No workflows available
                </p>
              ) : (
                workflows.map((workflow) => (
                  <div
                    key={workflow.id}
                    className="p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium">{workflow.name}</h4>
                          <Badge variant="outline" className="text-xs">
                            v{workflow.version}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">{workflow.description}</p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{workflow.agents.length} agents</span>
                          <span>{workflow.steps.length} steps</span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleStartWorkflow(workflow.id)}
                        disabled={isStarting === workflow.id}
                      >
                        {isStarting === workflow.id ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <Play className="h-3 w-3 mr-1" />
                        )}
                        Start
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
